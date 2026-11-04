package durak.server

import cats.effect.IO
import cats.syntax.all.*
import durak.engine.*
import durak.engine.JsonCodecs.given
import fs2.{Pipe, Stream}
import io.circe.{Decoder, Json, parser}
import io.circe.syntax.*
import org.http4s.*
import org.http4s.circe.CirceEntityDecoder.*
import org.http4s.circe.CirceEntityEncoder.*
import org.http4s.dsl.impl.OptionalQueryParamDecoderMatcher
import org.http4s.dsl.io.*
import org.http4s.server.websocket.WebSocketBuilder2
import org.http4s.websocket.WebSocketFrame

import scala.concurrent.duration.*

/** Body of `POST /api/games` (and its `POST /api/game/create` alias). */
case class CreateGameRequest(
  playerCount: Int,
  playerNames: List[String],
  allowRedirect: Boolean = true,
  playerTypes: Option[Vector[String]] = None,
  chaosMode: Boolean = false,
  // Transparent Mode: every hand is projected face-up. Off by default.
  transparentMode: Option[Boolean] = None,
  // Dev Mode: POV switching during live play. On by default while we test.
  devMode: Option[Boolean] = None
)

object CreateGameRequest:
  /**
   * Decodes a create request. `allowRedirect` defaults to `true`, `chaosMode` to
   * `false`, `playerTypes` to no bots, `transparentMode` to `false` and
   * `devMode` to `true`, so older clients keep working unchanged.
   */
  given Decoder[CreateGameRequest] = Decoder.instance { cursor =>
    for
      playerCount <- cursor.downField("playerCount").as[Int]
      playerNames <- cursor.downField("playerNames").as[List[String]]
      allowRedirect <- cursor.downField("allowRedirect").as[Option[Boolean]].map(_.getOrElse(true))
      playerTypes <- cursor.downField("playerTypes").as[Option[Vector[String]]]
      chaosMode <- cursor.downField("chaosMode").as[Option[Boolean]].map(_.getOrElse(false))
      transparentMode <- cursor.downField("transparentMode").as[Option[Boolean]]
      devMode <- cursor.downField("devMode").as[Option[Boolean]]
    yield CreateGameRequest(
      playerCount,
      playerNames,
      allowRedirect,
      playerTypes,
      chaosMode,
      transparentMode,
      devMode
    )
  }

/** Body of `POST /api/games/preset`. */
case class PresetRequest(preset: String)

object PresetRequest:
  given Decoder[PresetRequest] = Decoder.instance { cursor =>
    cursor.downField("preset").as[String].map(PresetRequest.apply)
  }

/** Body of `POST /api/games/:gameId/presence`. */
case class PresenceRequest(playerId: String, isPresent: Boolean = true)

object PresenceRequest:
  /** Accepts `isPresent` or the shorter `active` flag, defaulting to present. */
  given Decoder[PresenceRequest] = Decoder.instance { cursor =>
    for
      playerId <- cursor.downField("playerId").as[String]
      isPresent <- cursor.downField("isPresent").as[Option[Boolean]]
      active <- cursor.downField("active").as[Option[Boolean]]
    yield PresenceRequest(playerId, isPresent.orElse(active).getOrElse(true))
  }

object GameRoutes:

  /** How often a keepalive `Ping` is pushed down an open WebSocket. */
  val KeepAliveInterval: FiniteDuration = 20.seconds

  /** Seat a view request is projected for when no player is named. */
  val DefaultViewerId: String = "p0"

  /** The full app: REST endpoints plus the live-game WebSocket. */
  def routes(manager: GameManager)(using webSockets: WebSocketBuilder2[IO]): HttpRoutes[IO] =
    restRoutes(manager) <+> webSocketRoutes(manager, webSockets)

  /** REST endpoints, split out so they can be exercised without a WebSocket builder. */
  def restRoutes(manager: GameManager): HttpRoutes[IO] = HttpRoutes.of[IO] {

    // Readiness probe: the frontend waits for this before it offers game creation.
    case GET -> Root / "api" / "health" =>
      Ok(Json.obj("status" -> Json.fromString("ok")))

    case req @ POST -> Root / "api" / "games" =>
      createRoom(manager, req)

    case req @ POST -> Root / "api" / "games" / "preset" =>
      createPresetRoom(manager, req)

    case req @ POST -> Root / "api" / "game" / "create" =>
      createRoom(manager, req)

    case req @ GET -> Root / "api" / "games" / gameId / "view" :? PlayerQueryParam(requestedViewer) =>
      viewOf(manager, gameId, requestedViewer, requesterOf(req))

    // Documented seat-in-path form (ITEM-14a): the same projection and POV lock.
    case req @ GET -> Root / "api" / "games" / gameId / "view" / playerId =>
      viewOf(manager, gameId, Some(playerId), requesterOf(req))

    case GET -> Root / "api" / "games" / gameId / "replay" =>
      replayOf(manager, gameId)

    case GET -> Root / "api" / "game" / gameId / "replay" =>
      replayOf(manager, gameId)

    case req @ GET -> Root / "api" / "game" / gameId / "view" / playerId =>
      viewOf(manager, gameId, Some(playerId), requesterOf(req))

    case req @ POST -> Root / "api" / "games" / gameId / "action" =>
      submitAction(manager, gameId, req)

    case req @ POST -> Root / "api" / "game" / gameId / "action" =>
      submitAction(manager, gameId, req)

    case req @ POST -> Root / "api" / "games" / gameId / "presence" =>
      updatePresence(manager, gameId, req)

    case POST -> Root / "api" / "games" / gameId / "rematch" =>
      rematch(manager, gameId)
  }

  // --- REST handlers ---

  private def createRoom(manager: GameManager, req: Request[IO]): IO[Response[IO]] =
    req.as[Json].attempt.flatMap {
      case Left(error) =>
        BadRequest(errorBody(s"Invalid JSON body: ${describe(error)}"))
      case Right(json) =>
        json.as[CreateGameRequest] match
          case Left(error) =>
            BadRequest(errorBody(s"Invalid create request: ${error.getMessage}"))
          case Right(request) =>
            val config = configFor(request)
            manager
              .createGame(config, request.playerNames.toVector)
              .flatMap(room =>
                Ok(createResponse(room, request.playerNames, config.playerTypes))
              )
              .handleErrorWith(failure => errorResponse(failure))
    }

  /**
   * Seat types are normalized to exactly `playerCount` entries of `"human"`,
   * `"randomBot"` or `"basicBot"` (unknown values fall back to a human seat),
   * `chaosMode` opens every attack to any seat holding cards, `transparentMode`
   * deals every hand face-up and `devMode` keeps POV switching open during live
   * play (both default to the production values when the client omits them).
   */
  private def configFor(request: CreateGameRequest): GameConfig =
    GameConfig(
      playerCount = request.playerCount,
      allowRedirect = request.allowRedirect,
      playerTypes = GameConfig.normalizePlayerTypes(
        request.playerCount,
        request.playerTypes.getOrElse(Vector.empty)
      ),
      chaosMode = request.chaosMode,
      transparentMode = request.transparentMode.getOrElse(false),
      devMode = request.devMode.getOrElse(true)
    )

  /**
   * Starts one of the scripted QA positions in a fresh room, so a reviewer can
   * jump straight to a Chaos table, a half-off surrender or an endgame.
   */
  private def createPresetRoom(manager: GameManager, req: Request[IO]): IO[Response[IO]] =
    req.as[Json].attempt.flatMap {
      case Left(error) =>
        BadRequest(errorBody(s"Invalid JSON body: ${describe(error)}"))
      case Right(json) =>
        json.as[PresetRequest] match
          case Left(error) =>
            BadRequest(errorBody(s"Invalid preset request: ${error.getMessage}"))
          case Right(request) =>
            manager
              .createPreset(request.preset)
              .flatMap {
                case Left(error) => BadRequest(errorBody(error))
                case Right(room) =>
                  room.stateRef.get.flatMap(state => Ok(presetResponse(room, state)))
              }
              .handleErrorWith(failure => errorResponse(failure))
    }

  /** The preset's room plus the seat the table should open on. */
  private def presetResponse(room: GameRoom, state: GameState): Json =
    val players = state.players.map { player =>
      Json.obj("id" -> player.id.asJson, "name" -> player.name.asJson)
    }
    Json.obj(
      "gameId" -> room.gameId.asJson,
      "players" -> Json.fromValues(players),
      "playerTypes" -> Json.fromValues(state.players.indices.map { idx =>
        Json.fromString(state.config.seatType(idx))
      }),
      "transparentMode" -> state.config.transparentMode.asJson,
      "devMode" -> state.config.devMode.asJson,
      "defaultPlayerId" -> room.defaultPlayerId
        .filter(state.players.map(_.id).contains)
        .getOrElse(state.players.headOption.map(_.id).getOrElse("p0"))
        .asJson
    )

  /**
   * The projection for one seat. An omitted or blank `?player=` falls back to
   * `p0`, so a finished table stays readable from a bare game URL; only a
   * non-blank id that names no seat is a 404.
   *
   * `requester` names the seat that is asking (ITEM-14a). Outside Dev Mode a
   * mid-game request for any other seat — or a second seat after the first was
   * claimed — is rejected with `403 Forbidden`.
   */
  private def viewOf(
      manager: GameManager,
      gameId: String,
      requestedViewer: Option[String],
      requester: Option[String]
  ): IO[Response[IO]] =
    withRoom(manager, gameId) { room =>
      room.stateRef.get.flatMap { state =>
        val viewerId =
          requestedViewer.map(_.trim).filter(_.nonEmpty).getOrElse(DefaultViewerId)
        if !state.players.exists(_.id == viewerId) then
          NotFound(errorBody(s"Unknown player: $viewerId"))
        else
          GameActor.authorizePov(room, viewerId, requester).flatMap {
            case Left(error) => Forbidden(errorBody(error))
            case Right(_)    => Ok(PlayerGameView.forViewer(state, viewerId).asJson)
          }
      }
    }.handleErrorWith(errorResponse)

  /**
   * `POST /api/games/:gameId/rematch`: a fresh deal with the same seats, names
   * and match settings — including `allowRedirect`, `chaosMode`,
   * `transparentMode` and `devMode` — under a new game id (ITEM-10a / ITEM-14a).
   */
  private def rematch(manager: GameManager, gameId: String): IO[Response[IO]] =
    manager.rematch(gameId).flatMap {
      case None => NotFound(errorBody(s"Unknown game: $gameId"))
      case Some(created) =>
        created.stateRef.get.flatMap { fresh =>
          Ok(
            Json.obj(
              "gameId" -> created.gameId.asJson,
              "players" -> Json.fromValues(fresh.players.map { player =>
                Json.obj("id" -> player.id.asJson, "name" -> player.name.asJson)
              }),
              "playerTypes" -> Json.fromValues(fresh.players.indices.map { idx =>
                Json.fromString(fresh.config.seatType(idx))
              }),
              "defaultPlayerId" -> fresh.players.headOption.map(_.id).getOrElse("p0").asJson,
              "allowRedirect" -> fresh.config.allowRedirect.asJson,
              "chaosMode" -> fresh.config.chaosMode.asJson,
              "transparentMode" -> fresh.config.transparentMode.asJson,
              "devMode" -> fresh.config.devMode.asJson
            )
          )
        }
    }.handleErrorWith(errorResponse)

  private def submitAction(      manager: GameManager,
      gameId: String,
      req: Request[IO]
  ): IO[Response[IO]] =
    withRoom(manager, gameId) { room =>
      req.as[Json].attempt.flatMap {
        case Left(error) =>
          BadRequest(errorBody(s"Invalid JSON body: ${describe(error)}"))
        case Right(json) =>
          json.as[GameAction] match
            case Left(error) =>
              BadRequest(errorBody(s"Invalid game action: ${error.getMessage}"))
            case Right(action) =>
              // Only a human seat may be driven from the outside; a bot seat is
              // played by the room's own bot driver.
              GameActor.submitClientAction(room, action).flatMap {
                case Left(error) => BadRequest(errorBody(error))
                case Right(state) =>
                  val viewerId = GameActor.actorId(action)
                  if state.players.exists(_.id == viewerId) then
                    Ok(PlayerGameView.forViewer(state, viewerId).asJson)
                  else NotFound(errorBody(s"Unknown player: $viewerId"))
              }
      }
    }

  private def updatePresence(
      manager: GameManager,
      gameId: String,
      req: Request[IO]
  ): IO[Response[IO]] =
    withRoom(manager, gameId) { room =>
      req.as[Json].attempt.flatMap {
        case Left(error) =>
          BadRequest(errorBody(s"Invalid JSON body: ${describe(error)}"))
        case Right(json) =>
          json.as[PresenceRequest] match
            case Left(error) =>
              BadRequest(errorBody(s"Invalid presence request: ${error.getMessage}"))
            case Right(presence) =>
              room.stateRef.get.flatMap { state =>
                if !state.players.exists(_.id == presence.playerId) then
                  NotFound(errorBody(s"Unknown player: ${presence.playerId}"))
                else
                  GameActor.setPresence(room, presence.playerId, presence.isPresent) *>
                    room.stateRef.get.flatMap { current =>
                      Ok(PlayerGameView.forViewer(current, presence.playerId).asJson)
                    }
              }
      }
    }

  /**
   * The full move-by-move history of a game: the deal, every recorded move with
   * its elapsed time and resulting state, and one frozen projection per seat
   * for every frame, so a replay viewer never needs the live room.
   */
  private def replayOf(manager: GameManager, gameId: String): IO[Response[IO]] =
    withRoom(manager, gameId) { room =>
      room.replay.get.flatMap(replay => Ok(replay.asJson))
    }.handleErrorWith(errorResponse)

  // --- WebSocket ---

  /**
   * Streams the viewer's filtered projection: the current state once on
   * connect, then every subsequent state published to the room's topic, with a
   * periodic `Ping` so neither Ember nor a proxy drops the idle connection.
   * Incoming text frames are control messages or [[GameAction]]s.
   */
  private def webSocketRoutes(
      manager: GameManager,
      webSockets: WebSocketBuilder2[IO]
  ): HttpRoutes[IO] = HttpRoutes.of[IO] {

    case req @ GET -> Root / "ws" / "game" / gameId / playerId =>
      handleSocket(manager, webSockets, gameId, playerId, requesterOf(req))

    // The ticket's plural spelling of the same live-game socket (ITEM-14a).
    case req @ GET -> Root / "ws" / "games" / gameId / playerId =>
      handleSocket(manager, webSockets, gameId, playerId, requesterOf(req))
  }

  /** Applies the POV lock, then opens the viewer's filtered live socket. */
  private def handleSocket(
      manager: GameManager,
      webSockets: WebSocketBuilder2[IO],
      gameId: String,
      playerId: String,
      requester: Option[String]
  ): IO[Response[IO]] =
    withRoom(manager, gameId) { room =>
      room.stateRef.get.flatMap { state =>
        if !state.players.exists(_.id == playerId) then
          NotFound(errorBody(s"Unknown player: $playerId"))
        else
          GameActor.authorizePov(room, playerId, requester).flatMap {
            case Left(error) => Forbidden(errorBody(error))
            case Right(_)    => openSocket(room, gameId, playerId, webSockets)
          }
      }
    }

  /** Streams the viewer's filtered projection down an open WebSocket. */
  private def openSocket(
      room: GameRoom,
      gameId: String,
      playerId: String,
      webSockets: WebSocketBuilder2[IO]
  ): IO[Response[IO]] =
            val views: Stream[IO, WebSocketFrame] =
              (Stream.eval(room.stateRef.get) ++ room.topic.subscribe(64))
                .map { current =>
                  WebSocketFrame.Text(
                    PlayerGameView.forViewer(current, playerId).asJson.noSpaces
                  )
                }
            val keepAlive: Stream[IO, WebSocketFrame] =
              Stream
                .awakeEvery[IO](KeepAliveInterval)
                .map(_ => WebSocketFrame.Ping())
            val commands: Pipe[IO, WebSocketFrame, Unit] = frames =>
              frames
                .evalMap(frame => handleFrame(room, gameId, playerId, frame))
                // A closed socket marks the human away until they reconnect.
                .onFinalize(GameActor.setPresence(room, playerId, false))

            // An open socket means the human is watching this table.
            GameActor.setPresence(room, playerId, true) *>
              webSockets.build(views.merge(keepAlive), commands)

  /** Pings and pongs keep the pipe alive; only text frames carry commands. */
  private def handleFrame(
      room: GameRoom,
      gameId: String,
      playerId: String,
      frame: WebSocketFrame
  ): IO[Unit] =
    frame match
      case WebSocketFrame.Ping(_) | WebSocketFrame.Pong(_) => IO.unit
      case WebSocketFrame.Text(text, _)                    => handleTextFrame(room, gameId, playerId, text)
      case _                                               => IO.unit

  private def handleTextFrame(
      room: GameRoom,
      gameId: String,
      playerId: String,
      text: String
  ): IO[Unit] =
    parser.parse(text) match
      case Left(error) =>
        GameActor.logRejected(
          s"Invalid frame in game $gameId from player $playerId: ${describe(error)}"
        )
      case Right(json) =>
        controlFrame(json) match
          case Some(ControlFrame.Ping) =>
            IO.unit // keepalive acknowledgement
          case Some(ControlFrame.Presence(isPresent)) =>
            GameActor.setPresence(room, playerId, isPresent)
          case None =>
            json.as[GameAction] match
              case Right(action) => GameActor.submitClientAction(room, action).void
              case Left(error) =>
                GameActor.logRejected(
                  s"Invalid action payload in game $gameId from player $playerId: ${describe(error)}"
                )

  /** Control messages a client may send instead of a move. */
  private enum ControlFrame:
    case Ping
    case Presence(isPresent: Boolean)

  /** `{"type":"ping"}` or `{"type":"presence","isPresent":true|false}`. */
  private def controlFrame(json: Json): Option[ControlFrame] =
    val cursor = json.hcursor
    cursor.downField("type").as[String].toOption.map(_.toLowerCase.trim) match
      case Some("ping") => Some(ControlFrame.Ping)
      case Some("presence") =>
        val isPresent = cursor
          .downField("isPresent")
          .as[Boolean]
          .toOption
          .orElse(cursor.downField("active").as[Boolean].toOption)
          .getOrElse(true)
        Some(ControlFrame.Presence(isPresent))
      case _ => None

  // --- Shared helpers ---

  /**
   * Matches the optional `?player=:playerId` on the documented
   * `GET /api/games/.../view` route; a missing or blank value means `p0`.
   */
  private object PlayerQueryParam extends OptionalQueryParamDecoderMatcher[String]("player")

  /** The optional `?requester=<seat>` naming the seat that asked for a view. */
  private def requesterOf(req: Request[IO]): Option[String] =
    req.uri.query.params.get("requester").map(_.trim).filter(_.nonEmpty)

  private def withRoom(manager: GameManager, gameId: String)(
      handle: GameRoom => IO[Response[IO]]
  ): IO[Response[IO]] =
    manager.getRoom(gameId).flatMap {
      case Some(room) => handle(room)
      case None       => NotFound(errorBody(s"Unknown game: $gameId"))
    }

  private def createResponse(
      room: GameRoom,
      names: List[String],
      seatTypes: Vector[String]
  ): Json =
    val players = room.playerIds.zipWithIndex.map { case (id, idx) =>
      Json.obj(
        "id" -> Json.fromString(id),
        "name" -> Json.fromString(names.lift(idx).getOrElse(""))
      )
    }
    Json.obj(
      "gameId" -> Json.fromString(room.gameId),
      "players" -> Json.fromValues(players),
      "playerTypes" -> Json.fromValues(room.playerIds.indices.map { idx =>
        Json.fromString(seatTypes.lift(idx).getOrElse(GameConfig.HumanSeat))
      })
    )

  private def errorBody(message: String): Json =
    Json.obj("error" -> Json.fromString(message))

  private def errorResponse(error: Throwable): IO[Response[IO]] =
    error match
      case _: IllegalArgumentException | _: IllegalStateException =>
        BadRequest(errorBody(describe(error)))
      case _ =>
        InternalServerError(errorBody("Internal server error"))

  private def describe(error: Throwable): String =
    Option(error.getMessage).getOrElse(error.getClass.getSimpleName)
