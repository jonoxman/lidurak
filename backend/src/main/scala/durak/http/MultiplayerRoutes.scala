package durak.http

import cats.effect.{IO, Ref, Resource}
import cats.effect.std.Queue
import cats.syntax.all.*
import durak.lobby.{QuickPairOutcome, QuickPairRequest, QuickPairingService}
import durak.protocol.ProtocolCodecs.given
import durak.protocol.{LobbyRoomSummary, WsClientMessage, WsServerMessage}
import durak.rooms.{ActionRejected, CreateRoomConfig, RoomManager, UnknownRoom}
import durak.session.{GuestSession, SessionCookie, SessionStore}
import fs2.{Pipe, Stream}
import io.circe.{Decoder, Json, parser}
import io.circe.syntax.*
import org.http4s.*
import org.http4s.circe.CirceEntityDecoder.*
import org.http4s.circe.CirceEntityEncoder.*
import org.http4s.dsl.io.*
import org.http4s.server.websocket.WebSocketBuilder2
import org.http4s.websocket.WebSocketFrame

import java.util.UUID
import scala.concurrent.duration.*

/** Body of the M2 `POST /api/games` (create a shareable room). */
final case class CreateRoomRequestBody(
    playerCount: Int,
    allowRedirect: Boolean = true,
    turnTimeoutSeconds: Int = 15,
    isPublic: Boolean = true
):

  /** The room configuration this request asks for. */
  def toConfig: CreateRoomConfig =
    CreateRoomConfig(playerCount, allowRedirect, turnTimeoutSeconds, isPublic)

object CreateRoomRequestBody:

  /** Missing optional fields fall back to the standard public room preset. */
  given Decoder[CreateRoomRequestBody] = Decoder.instance { cursor =>
    for
      playerCount <- cursor.downField("playerCount").as[Int]
      allowRedirect <- cursor
        .downField("allowRedirect")
        .as[Option[Boolean]]
        .map(_.getOrElse(true))
      turnTimeoutSeconds <- cursor
        .downField("turnTimeoutSeconds")
        .as[Option[Int]]
        .map(_.getOrElse(15))
      isPublic <- cursor
        .downField("isPublic")
        .as[Option[Boolean]]
        .map(_.getOrElse(true))
    yield CreateRoomRequestBody(
      playerCount,
      allowRedirect,
      turnTimeoutSeconds,
      isPublic
    )
  }

/**
 * The M2 multiplayer surface: the shareable-room REST API and the two live
 * WebSockets.
 *
 * Every response is either a lobby summary or an already-projected
 * [[durak.protocol.PlayerGameView]]; there is no route that can serialize the
 * authoritative `GameState`. Sessions are resolved from the `lidurak_session`
 * cookie (or the `X-Guest-Token` header) and a freshly minted guest is cookie'd
 * on the very response that created it.
 */
object MultiplayerRoutes:

  /** How often a keepalive `Ping` is pushed down an idle socket. */
  val KeepAliveInterval: FiniteDuration = 20.seconds

  /** The code a malformed or unknown client frame is rejected with. */
  val InvalidPayloadCode: String = "INVALID_PAYLOAD"

  /** The full M2 app: REST endpoints plus the lobby and game WebSockets. */
  def routes(
      store: SessionStore[IO],
      roomManager: RoomManager[IO],
      quickPairing: QuickPairingService[IO]
  )(using webSockets: WebSocketBuilder2[IO]): HttpRoutes[IO] =
    restRoutes(store, roomManager, quickPairing) <+>
      webSocketRoutes(store, roomManager, quickPairing)(using webSockets)

  // --- REST ----------------------------------------------------------------

  /** The REST half, split out so it can be exercised without a WS builder. */
  def restRoutes(
      store: SessionStore[IO],
      roomManager: RoomManager[IO],
      quickPairing: QuickPairingService[IO]
  ): HttpRoutes[IO] = HttpRoutes.of[IO] {

    // The open public pool. Public data only, but a first-time visitor still
    // receives their guest cookie here so the very next request is already
    // backed by the session they keep for the rest of the match.
    case req @ GET -> Root / "api" / "lobby" =>
      withSession(req, store) { (_, _) =>
        roomManager.listOpenPublicRooms.flatMap(rooms => Ok(rooms.asJson))
      }

    case req @ POST -> Root / "api" / "games" =>
      jsonBody(req).flatMap {
        case Left(error) => BadRequest(errorJson(error))
        case Right(json) =>
          json.as[CreateRoomRequestBody] match
            case Left(error) =>
              BadRequest(errorJson(s"Invalid create request: ${describe(error)}"))
            case Right(body) =>
              withSession(req, store) { (session, _) =>
                roomManager.createRoom(session, body.toConfig).flatMap {
                  case Left(error) => BadRequest(errorJson(error))
                  case Right((room, seatIndex)) =>
                    Created(
                      Json.obj(
                        "gameId" -> room.gameId.asJson,
                        "seatIndex" -> seatIndex.asJson,
                        "inviteUrl" -> s"/g/${room.gameId}".asJson
                      )
                    )
                }
              }
      }

    // The caller's own projection of one room. Never the raw game state.
    case req @ GET -> Root / "api" / "games" / gameId =>
      withSession(req, store) { (session, _) =>
        roomManager.getRoomView(gameId, session.playerId).flatMap {
          case Some(view) => Ok(view.asJson)
          case None =>
            NotFound(errorJson(RoomManager.unknownRoomMessage(gameId)))
        }
      }

    case req @ POST -> Root / "api" / "games" / gameId / "join" =>
      withSession(req, store) { (session, _) =>
        roomManager.getRoom(gameId).flatMap {
          case None => NotFound(errorJson(RoomManager.unknownRoomMessage(gameId)))
          case Some(_) =>
            roomManager.joinSeat(gameId, session).flatMap {
              case Right((view, seatIndex)) =>
                Ok(
                  Json.obj(
                    "gameId" -> gameId.asJson,
                    "seatIndex" -> seatIndex.asJson,
                    "view" -> view.asJson
                  )
                )
              case Left(error) => Conflict(errorJson(error))
            }
        }
      }

    case req @ POST -> Root / "api" / "games" / gameId / "leave" =>
      withSession(req, store) { (session, _) =>
        roomManager.getRoom(gameId).flatMap {
          case None => NotFound(errorJson(RoomManager.unknownRoomMessage(gameId)))
          case Some(_) =>
            roomManager.leaveSeat(gameId, session.playerId).flatMap {
              case Right(())   => NoContent()
              case Left(error) => Conflict(errorJson(error))
            }
        }
      }

    case req @ POST -> Root / "api" / "quick-pair" =>
      jsonBody(req).flatMap {
        case Left(error) => BadRequest(errorJson(error))
        case Right(json) =>
          json.as[QuickPairRequest] match
            case Left(error) =>
              BadRequest(errorJson(s"Invalid quick-pair request: ${describe(error)}"))
            case Right(pairRequest) =>
              withSession(req, store) { (session, _) =>
                quickPairing.pair(session, pairRequest).flatMap {
                  case Right(QuickPairOutcome.Matched(gameId, seatIndex)) =>
                    Ok(
                      Json.obj(
                        "status" -> "matched".asJson,
                        "gameId" -> gameId.asJson,
                        "seatIndex" -> seatIndex.asJson
                      )
                    )
                  case Right(
                        QuickPairOutcome.Searching(
                          playerCount,
                          turnTimeoutSeconds,
                          allowRedirect
                        )
                      ) =>
                    Ok(
                      Json.obj(
                        "status" -> "searching".asJson,
                        "playerCount" -> playerCount.asJson,
                        "turnTimeoutSeconds" -> turnTimeoutSeconds.asJson,
                        "allowRedirect" -> allowRedirect.asJson
                      )
                    )
                  case Left(error) => BadRequest(errorJson(error))
                }
              }
      }

    // Fallback status check for a client whose lobby socket cannot carry
    // targeted frames (for example a socket opened before its guest cookie
    // existed). `idle` means not queued and not matched.
    case req @ GET -> Root / "api" / "quick-pair" =>
      withSession(req, store) { (session, _) =>
        quickPairing.status(session.playerId).flatMap {
          case None =>
            Ok(Json.obj("status" -> "idle".asJson))
          case Some(QuickPairOutcome.Matched(gameId, seatIndex)) =>
            Ok(
              Json.obj(
                "status" -> "matched".asJson,
                "gameId" -> gameId.asJson,
                "seatIndex" -> seatIndex.asJson
              )
            )
          case Some(
                QuickPairOutcome.Searching(playerCount, turnTimeoutSeconds, allowRedirect)
              ) =>
            Ok(
              Json.obj(
                "status" -> "searching".asJson,
                "playerCount" -> playerCount.asJson,
                "turnTimeoutSeconds" -> turnTimeoutSeconds.asJson,
                "allowRedirect" -> allowRedirect.asJson
              )
            )
        }
      }

    case req @ DELETE -> Root / "api" / "quick-pair" =>
      withSession(req, store) { (session, _) =>
        quickPairing.cancel(session) *> NoContent()
      }
  }

  // --- WebSockets ----------------------------------------------------------

  /** The two live sockets; both are anonymous-readable, the game one personal. */
  def webSocketRoutes(
      store: SessionStore[IO],
      roomManager: RoomManager[IO],
      quickPairing: QuickPairingService[IO]
  )(using webSockets: WebSocketBuilder2[IO]): HttpRoutes[IO] = HttpRoutes.of[IO] {

    // The lobby socket authenticates the guest cookie so a queued quick-pair
    // player can receive a targeted `quickPairMatched` frame on the socket
    // they opened (or reopened) while waiting.
    case req @ GET -> Root / "ws" / "lobby" =>
      sessionPlayerFor(req, store).flatMap { playerId =>
        webSockets.build(
          lobbyMessages(roomManager, quickPairing, playerId).map(toFrame).merge(keepAlive),
          (incoming: Stream[IO, WebSocketFrame]) => incoming.drain
        )
      }

    case req @ GET -> Root / "ws" / "games" / gameId =>
      viewerFor(req, store).flatMap { viewerId =>
        openGameSocket(roomManager, gameId, viewerId)(using webSockets)
      }
  }

  /**
   * The lobby stream: one `LobbySnapshot` with the rooms open right now, a
   * `LobbyUpdated` frame for every later change to the pool, and the targeted
   * `quickPairMatched` frames of the authenticated player (if any).
   */
  private[http] def lobbyMessages(
      roomManager: RoomManager[IO],
      quickPairing: QuickPairingService[IO],
      playerId: Option[String]  ): Stream[IO, WsServerMessage] =
    val poolStream =
      Stream
        .eval(roomManager.listOpenPublicRooms)
        .map(WsServerMessage.LobbySnapshot.apply) ++
        roomManager.lobbyUpdates.map(WsServerMessage.LobbyUpdated.apply)
    // The pool stream never ends, so the player's match frames have to run
    // concurrently with it: `++` would never reach this branch.
    val matchStream =
      playerId.fold(Stream.empty.covaryAll[IO, WsServerMessage])(quickPairing.matchedEvents)
    poolStream.merge(matchStream)

  /**
   * Streams one viewer's projected room and applies their incoming frames.
   *
   * The [[RoomManager.subscribe]] resource is acquired before the upgrade and
   * released by whichever of the outgoing or incoming stream finishes first, so
   * presence flips back to `isConnected = false` on an abrupt disconnect too.
   * Rejections and pongs go through a connection-local queue, which means they
   * reach exactly the client that sent the frame and never its peers.
   */
  /**
   * One live game socket: the frames it pushes to its client and the sink its
   * incoming frames are applied to.
   */
  private[http] final case class GameSocket(
      messages: Stream[IO, WsServerMessage],
      handle: Pipe[IO, WebSocketFrame, Unit]
  )

  /**
   * Subscribes `viewerId` to `gameId` for as long as the returned resource is
   * open.
   *
   * Presence is tied to that lifetime, not to a stream: acquiring subscribes
   * the viewer so peers see `isConnected = true`, and releasing removes them so
   * peers see `false`, even when the client drops without a close handshake.
   * The outgoing stream interleaves the room's projected frames with the
   * replies generated by this connection (pongs, rejections), which is why a
   * rejection can only ever travel to the client that caused it.
   */
  private[http] def gameSocket(
      roomManager: RoomManager[IO],
      gameId: String,
      viewerId: String
  ): Resource[IO, GameSocket] =
    for
      outbound <- Resource.eval(Queue.unbounded[IO, WsServerMessage])
      subscription <- roomManager.subscribe(gameId, viewerId)
    yield
      val (frames, _initialView) = subscription
      GameSocket(
        messages = frames.merge(Stream.fromQueueUnterminated(outbound)),
        handle = stream =>
          stream.evalMap(frame =>
            handleClientFrame(roomManager, gameId, viewerId, outbound, frame)
          )
      )

  private def openGameSocket(
      roomManager: RoomManager[IO],
      gameId: String,
      viewerId: String
  )(using webSockets: WebSocketBuilder2[IO]): IO[Response[IO]] =
    gameSocket(roomManager, gameId, viewerId).allocated.attempt.flatMap {
      case Left(_: UnknownRoom) =>
        IO.pure(
          Response[IO](Status.NotFound)
            .withEntity(errorJson(RoomManager.unknownRoomMessage(gameId)))
        )
      case Left(other) => IO.raiseError(other)
      case Right((socket, release)) =>
        Ref.of[IO, Boolean](false).flatMap { released =>
          // Both streams finalize on disconnect; only the first release runs.
          val releaseOnce =
            released.getAndSet(true).flatMap(already => if already then IO.unit else release)
          webSockets.build(
            socket.messages.map(toFrame).merge(keepAlive).onFinalize(releaseOnce),
            stream => socket.handle(stream).onFinalize(releaseOnce)
          )
        }
    }

  /**
   * Decodes one client frame.
   *
   * `Ping` is answered with `Pong`; game actions are routed through the
   * room manager, which derives the acting seat from `viewerId` and answers a
   * rejection to this socket alone. A malformed payload is rejected the same
   * way instead of failing the stream.
   */
  private def handleClientFrame(
      roomManager: RoomManager[IO],
      gameId: String,
      viewerId: String,
      outbound: Queue[IO, WsServerMessage],
      frame: WebSocketFrame
  ): IO[Unit] =
    frame match
      case WebSocketFrame.Text(text, _) =>
        parser.parse(text) match
          case Left(error) =>
            reject(outbound, s"Malformed JSON payload: ${describe(error)}")
          case Right(json) =>
            json.as[WsClientMessage] match
              case Left(error) =>
                reject(outbound, s"Unsupported client message: ${describe(error)}")
              case Right(WsClientMessage.Ping) =>
                outbound.offer(WsServerMessage.Pong).void
              case Right(message) =>
                roomManager
                  .handleAction(gameId, viewerId, message)
                  .flatMap {
                    case Left(rejected) =>
                      outbound
                        .offer(WsServerMessage.ActionRejected(rejected.code, rejected.message))
                        .void
                    case Right(()) => IO.unit
                  }
                  .handleErrorWith(error => reject(outbound, describe(error)))
      case _ => IO.unit

  /** The viewer id behind this socket: their guest, or a fresh spectator. */
  private def viewerFor(req: Request[IO], store: SessionStore[IO]): IO[String] =
    sessionPlayerFor(req, store).map(_.getOrElse(ephemeralSpectatorId))

  /** The authenticated player behind this socket, when it carries a session. */
  private def sessionPlayerFor(
      req: Request[IO],
      store: SessionStore[IO]
  ): IO[Option[String]] =
    tokenOf(req) match
      case None        => IO.pure(None)
      case Some(token) => store.touchAndFind(token).map(_.map(_.playerId))

  /**
   * The guest token on a WebSocket upgrade: the cookie first (browsers send it
   * with the handshake), then the `?token=` fallback for native clients.
   */
  private def tokenOf(req: Request[IO]): Option[String] =
    SessionCookie.extractToken(req).orElse(
      req.uri.query.params.get("token").map(_.trim).filter(_.nonEmpty)
    )

  /** A throwaway read-only identity for a viewer without any session yet. */
  private def ephemeralSpectatorId: String = s"spectator-${UUID.randomUUID()}"

  // --- Shared helpers ------------------------------------------------------

  private def keepAlive: Stream[IO, WebSocketFrame] =
    Stream
      .awakeEvery[IO](KeepAliveInterval)
      .map(_ => WebSocketFrame.Ping())

  private def toFrame(message: WsServerMessage): WebSocketFrame =
    WebSocketFrame.Text(message.asJson.noSpaces)

  private def reject(
      outbound: Queue[IO, WsServerMessage],
      message: String
  ): IO[Unit] =
    outbound
      .offer(WsServerMessage.ActionRejected(InvalidPayloadCode, message))
      .void

  /**
   * Resolves the caller's guest (minting one when necessary) and attaches the
   * `HttpOnly; SameSite=Strict` cookie to the response that created it.
   */
  private def withSession(
      req: Request[IO],
      store: SessionStore[IO]
  )(respond: (GuestSession, Boolean) => IO[Response[IO]]): IO[Response[IO]] =
    SessionCookie.resolveOrCreate(req, store).flatMap { case (session, created) =>
      respond(session, created).map { response =>
        if created then response.addCookie(SessionCookie.build(session.token))
        else response
      }
    }

  private def jsonBody(req: Request[IO]): IO[Either[String, Json]] =
    req.as[Json].attempt.map(
      _.leftMap(error => s"Invalid JSON body: ${describe(error)}")
    )

  private def errorJson(message: String): Json =
    Json.obj("error" -> Json.fromString(message))

  private def describe(error: Throwable): String =
    Option(error.getMessage).getOrElse(error.getClass.getSimpleName)
