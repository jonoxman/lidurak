package durak.http

import cats.effect.IO
import cats.effect.std.Queue
import cats.effect.{Ref, Resource}
import cats.syntax.all.*
import durak.lobby.{QuickPairRequest, QuickPairingService}
import durak.protocol.*
import durak.protocol.ProtocolCodecs.given
import durak.rooms.{CreateRoomConfig, RoomManager}
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

/** Body of `POST /api/games`: a shareable room's match settings. */
final case class CreateRoomBody(
    playerCount: Int,
    allowRedirect: Boolean = true,
    turnTimeoutSeconds: Int = 15,
    isPublic: Boolean = true
):

  /** The room configuration this body asks for. */
  def toConfig: CreateRoomConfig =
    CreateRoomConfig(
      playerCount = playerCount,
      allowRedirect = allowRedirect,
      turnTimeoutSeconds = turnTimeoutSeconds,
      isPublic = isPublic
    )

object CreateRoomBody:

  /** Every optional setting falls back to its production default. */
  given Decoder[CreateRoomBody] = Decoder.instance { cursor =>
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
    yield CreateRoomBody(playerCount, allowRedirect, turnTimeoutSeconds, isPublic)
  }

/** Body of `POST /api/quick-pair`. */
final case class QuickPairBody(
    playerCount: Int,
    turnTimeoutSeconds: Int = 15,
    allowRedirect: Boolean = true
):

  /** The pairing request this body asks for. */
  def toRequest: QuickPairRequest =
    QuickPairRequest(playerCount, turnTimeoutSeconds, allowRedirect)

object QuickPairBody:

  given Decoder[QuickPairBody] = Decoder.instance { cursor =>
    for
      playerCount <- cursor.downField("playerCount").as[Int]
      turnTimeoutSeconds <- cursor
        .downField("turnTimeoutSeconds")
        .as[Option[Int]]
        .map(_.getOrElse(15))
      allowRedirect <- cursor
        .downField("allowRedirect")
        .as[Option[Boolean]]
        .map(_.getOrElse(true))
    yield QuickPairBody(playerCount, turnTimeoutSeconds, allowRedirect)
  }

/**
 * The M2 multiplayer surface.
 *
 * Every session-scoped endpoint resolves the caller's guest through
 * [[SessionCookie.resolveOrCreate]], minting and cookie-ing one when the
 * request carries no usable token. No endpoint ever renders a raw
 * `durak.engine.GameState`: the only game payload is the already-filtered
 * [[PlayerGameView]].
 */
object MultiplayerRoutes:

  /** Code of a WebSocket frame that is not a valid client message. */
  val InvalidPayloadCode: String = "INVALID_PAYLOAD"

  /** REST routes, split out so they can be exercised without a WS builder. */
  def restRoutes(
      sessions: SessionStore[IO],
      rooms: RoomManager[IO],
      quickPair: QuickPairingService[IO]
  ): HttpRoutes[IO] = HttpRoutes.of[IO] {

    case GET -> Root / "api" / "lobby" =>
      rooms.listOpenPublicRooms.flatMap(open => Ok(open.asJson))

    case req @ POST -> Root / "api" / "games" =>
      withGuest(req, sessions) { (session, _) =>
        readJson[CreateRoomBody](req).flatMap {
          case Left(error) => error
          case Right(body) =>
            rooms.createRoom(session, body.toConfig).flatMap {
              case Left(error) => BadRequest(errorBody(error))
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

    case req @ GET -> Root / "api" / "games" / gameId =>
      withGuest(req, sessions) { (session, _) =>
        rooms.getRoomView(gameId, session.playerId).flatMap {
          case Some(view) => Ok(view.asJson)
          case None       => unknownRoom(gameId)
        }
      }

    case req @ POST -> Root / "api" / "games" / gameId / "join" =>
      withGuest(req, sessions) { (session, _) =>
        rooms.joinSeat(gameId, session).flatMap {
          case Right((view, seatIndex)) =>
            Ok(
              Json.obj(
                "gameId" -> gameId.asJson,
                "seatIndex" -> seatIndex.asJson,
                "view" -> view.asJson
              )
            )
          case Left(error) => conflictOrUnknown(rooms, gameId, error)
        }
      }

    case req @ POST -> Root / "api" / "games" / gameId / "leave" =>
      withGuest(req, sessions) { (session, _) =>
        rooms.leaveSeat(gameId, session.playerId).flatMap {
          case Right(_)    => NoContent()
          case Left(error) => conflictOrUnknown(rooms, gameId, error)
        }
      }

    case req @ POST -> Root / "api" / "quick-pair" =>
      withGuest(req, sessions) { (session, _) =>
        readJson[QuickPairBody](req).flatMap {
          case Left(error) => error
          case Right(body) =>
            quickPair.pair(session, body.toRequest).flatMap {
              case Right((gameId, seatIndex)) =>
                Ok(
                  Json.obj(
                    "gameId" -> gameId.asJson,
                    "seatIndex" -> seatIndex.asJson
                  )
                )
              case Left(error) => BadRequest(errorBody(error))
            }
        }
      }

    case req @ DELETE -> Root / "api" / "quick-pair" =>
      withGuest(req, sessions) { (session, _) =>
        quickPair.cancel(session) *> NoContent()
      }
  }

  /** REST plus the two live WebSocket endpoints. */
  def routes(
      sessions: SessionStore[IO],
      rooms: RoomManager[IO],
      quickPair: QuickPairingService[IO]
  )(using webSockets: WebSocketBuilder2[IO]): HttpRoutes[IO] =
    restRoutes(sessions, rooms, quickPair) <+>
      webSocketRoutes(sessions, rooms)

  /**
   * The live sockets.
   *
   * `/ws/lobby` opens with a [[WsServerMessage.LobbySnapshot]] of the current
   * pool and then relays every [[WsServerMessage.LobbyUpdated]] snapshot.
   *
   * `/ws/games/:gameId` subscribes for exactly one viewer, streams that
   * viewer's [[PlayerGameView]] frames, answers `Ping` with `Pong`, routes game
   * actions through [[RoomManager.handleAction]] (so seat ownership is enforced
   * server-side), and rejects malformed frames without dropping the socket.
   */
  def webSocketRoutes(
      sessions: SessionStore[IO],
      rooms: RoomManager[IO]
  )(using webSockets: WebSocketBuilder2[IO]): HttpRoutes[IO] = HttpRoutes.of[IO] {

    case GET -> Root / "ws" / "lobby" =>
      val snapshot =
        Stream.eval(rooms.listOpenPublicRooms.map(WsServerMessage.LobbySnapshot(_)))
      val live = rooms.lobbyUpdates.map(WsServerMessage.LobbyUpdated(_))
      val send = (snapshot ++ live).map(textFrame)
      webSockets.build(send, _.evalMap(_ => IO.unit))

    case req @ GET -> Root / "ws" / "games" / gameId =>
      rooms.getRoom(gameId).flatMap {
        case None => unknownRoom(gameId)
        case Some(_) =>
          viewerFor(req, sessions).flatMap { viewerId =>
            openGameSocket(rooms, gameId, viewerId)
          }
      }
  }

  /**
   * Opens one viewer's socket.
   *
   * The subscription is acquired here and released from the finalizer of both
   * directions, so an abrupt disconnect still flips the player's `isConnected`
   * flag for their peers. Downstream frames come from the room; replies that
   * belong to this client only (`Pong`, `ActionRejected`) travel through a
   * per-connection outbox and are merged into the same send stream.
   */
  private def openGameSocket(
      rooms: RoomManager[IO],
      gameId: String,
      viewerId: String
  )(using webSockets: WebSocketBuilder2[IO]): IO[Response[IO]] =
    rooms.subscribe(gameId, viewerId).allocated.flatMap {
      case ((frames, _), release) =>
        for
          released <- Ref.of[IO, Boolean](false)
          outbox <- Queue.unbounded[IO, WsServerMessage]
          releaseOnce = released.getAndSet(true).flatMap { done =>
            if done then IO.unit else release
          }
          views = frames.map(textFrame)
          replies = Stream.fromQueueUnterminated(outbox).map(textFrame)
          send = views.mergeHaltBoth(replies).onFinalize(releaseOnce)
          receive: Pipe[IO, WebSocketFrame, Unit] =
            _.evalMap(frame => handleFrame(rooms, gameId, viewerId, frame, outbox))
              .onFinalize(releaseOnce)
          response <- webSockets.build(send, receive)
        yield response
    }

  /** Decodes one inbound frame; failures answer only the sending client. */
  private def handleFrame(
      rooms: RoomManager[IO],
      gameId: String,
      viewerId: String,
      frame: WebSocketFrame,
      outbox: Queue[IO, WsServerMessage]
  ): IO[Unit] =
    frame match
      case WebSocketFrame.Text(text, _) =>
        handleText(rooms, gameId, viewerId, text, outbox)
      case _ =>
        IO.unit

  private def handleText(
      rooms: RoomManager[IO],
      gameId: String,
      viewerId: String,
      text: String,
      outbox: Queue[IO, WsServerMessage]
  ): IO[Unit] =
    def reject(message: String): IO[Unit] =
      outbox.offer(WsServerMessage.ActionRejected(InvalidPayloadCode, message)).void

    parser.parse(text) match
      case Left(error) =>
        reject(s"Malformed JSON payload: ${describe(error)}")
      case Right(json) =>
        json.as[WsClientMessage] match
          case Left(error) =>
            reject(s"Invalid client message: ${describe(error)}")
          case Right(WsClientMessage.Ping) =>
            outbox.offer(WsServerMessage.Pong).void
          case Right(message) =>
            rooms.handleAction(gameId, viewerId, message).flatMap {
              case Left(rejected) =>
                outbox.offer(
                  WsServerMessage.ActionRejected(rejected.code, rejected.message)
                ).void
              case Right(_) => IO.unit
            }

  /**
   * The identity a game socket streams for: the guest behind the session
   * cookie (or the `X-Guest-Token` header), with an optional `?token=` query
   * parameter fallback for non-browser WebSocket clients.
   *
   * A viewer with no usable token becomes an ephemeral spectator id, so an
   * anonymous link still opens a read-only table instead of failing.
   */
  private def viewerFor(
      req: Request[IO],
      sessions: SessionStore[IO]
  ): IO[String] =
    val queryToken = req.uri.query.params.get("token").map(_.trim).filter(_.nonEmpty)
    SessionCookie.extractToken(req).orElse(queryToken) match
      case None => IO.pure(ephemeralSpectatorId())
      case Some(token) =>
        sessions.touchAndFind(token).map { session =>
          session.map(_.playerId).getOrElse(ephemeralSpectatorId())
        }

  private def ephemeralSpectatorId(): String =
    s"spectator-${UUID.randomUUID()}"

  /** Runs `handle` with the caller's guest, cookie-ing a newly minted one. */
  private def withGuest(
      req: Request[IO],
      sessions: SessionStore[IO]
  )(handle: (GuestSession, Boolean) => IO[Response[IO]]): IO[Response[IO]] =
    SessionCookie.resolveOrCreate(req, sessions).flatMap { case (session, created) =>
      handle(session, created).map { response =>
        if created then response.addCookie(SessionCookie.build(session.token))
        else response
      }
    }

  private def readJson[A: Decoder](
      req: Request[IO]
  ): IO[Either[IO[Response[IO]], A]] =
    req.as[Json].attempt.map {
      case Left(error) =>
        Left(BadRequest(errorBody(s"Invalid JSON body: ${describe(error)}")))
      case Right(json) =>
        json.as[A] match
          case Left(error) =>
            Left(BadRequest(errorBody(s"Invalid request: ${describe(error)}")))
          case Right(value) => Right(value)
    }

  /** A missing room is a 404; any other rejection is a 409 conflict. */
  private def conflictOrUnknown(
      rooms: RoomManager[IO],
      gameId: String,
      message: String
  ): IO[Response[IO]] =
    rooms.getRoom(gameId).flatMap {
      case None    => unknownRoom(gameId)
      case Some(_) => Conflict(errorBody(message))
    }

  private def unknownRoom(gameId: String): IO[Response[IO]] =
    NotFound(errorBody(RoomManager.unknownRoomMessage(gameId)))

  private def textFrame(message: WsServerMessage): WebSocketFrame =
    WebSocketFrame.Text(message.asJson.noSpaces)

  private def errorBody(message: String): Json =
    Json.obj("error" -> Json.fromString(message))

  private def describe(error: Throwable): String =
    Option(error.getMessage).getOrElse(error.getClass.getSimpleName)
