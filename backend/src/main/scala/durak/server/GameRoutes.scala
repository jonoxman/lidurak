package durak.server

import cats.effect.IO
import cats.syntax.all.*
import durak.engine.*
import durak.engine.JsonCodecs.given
import fs2.{Pipe, Stream}
import io.circe.{Decoder, Json, parser}
import io.circe.generic.semiauto.deriveDecoder
import io.circe.syntax.*
import org.http4s.*
import org.http4s.circe.CirceEntityDecoder.*
import org.http4s.circe.CirceEntityEncoder.*
import org.http4s.dsl.io.*
import org.http4s.server.websocket.WebSocketBuilder2
import org.http4s.websocket.WebSocketFrame

/** Body of `POST /api/game/create`. */
case class CreateGameRequest(
  playerCount: Int,
  playerNames: List[String],
  allowRedirect: Boolean = true
)

object CreateGameRequest:
  given Decoder[CreateGameRequest] = deriveDecoder[CreateGameRequest]

object GameRoutes:

  /** The full app: REST endpoints plus the live-game WebSocket. */
  def routes(manager: GameManager)(using webSockets: WebSocketBuilder2[IO]): HttpRoutes[IO] =
    restRoutes(manager) <+> webSocketRoutes(manager, webSockets)

  /** REST endpoints, split out so they can be exercised without a WebSocket builder. */
  def restRoutes(manager: GameManager): HttpRoutes[IO] = HttpRoutes.of[IO] {

    case req @ POST -> Root / "api" / "game" / "create" =>
      req.as[Json].attempt.flatMap {
        case Left(error) =>
          BadRequest(errorBody(s"Invalid JSON body: ${describe(error)}"))
        case Right(json) =>
          json.as[CreateGameRequest] match
            case Left(error) =>
              BadRequest(errorBody(s"Invalid create request: ${error.getMessage}"))
            case Right(request) =>
              manager
                .createGame(
                  GameConfig(request.playerCount, request.allowRedirect),
                  request.playerNames.toVector
                )
                .flatMap(room => Ok(createResponse(room, request.playerNames)))
                .handleErrorWith(failure => errorResponse(failure))
      }

    case GET -> Root / "api" / "game" / gameId / "view" / playerId =>
      withRoom(manager, gameId) { room =>
        room.stateRef.get.flatMap { state =>
          if state.players.exists(_.id == playerId) then
            Ok(PlayerGameView.forViewer(state, playerId).asJson)
          else NotFound(errorBody(s"Unknown player: $playerId"))
        }
      }

    case req @ POST -> Root / "api" / "game" / gameId / "action" =>
      withRoom(manager, gameId) { room =>
        req.as[Json].attempt.flatMap {
          case Left(error) =>
            BadRequest(errorBody(s"Invalid JSON body: ${describe(error)}"))
          case Right(json) =>
            json.as[GameAction] match
              case Left(error) =>
                BadRequest(errorBody(s"Invalid game action: ${error.getMessage}"))
              case Right(action) =>
                GameActor.applyAction(room, action).flatMap {
                  case Left(error) => BadRequest(errorBody(error))
                  case Right(state) =>
                    val viewerId = GameActor.actorId(action)
                    if state.players.exists(_.id == viewerId) then
                      Ok(PlayerGameView.forViewer(state, viewerId).asJson)
                    else NotFound(errorBody(s"Unknown player: $viewerId"))
                }
        }
      }
  }

  /**
   * Streams the viewer's filtered projection: the current state once on
   * connect, then every subsequent state published to the room's topic.
   * Incoming text frames are decoded as [[GameAction]]s and applied.
   */
  private def webSocketRoutes(
      manager: GameManager,
      webSockets: WebSocketBuilder2[IO]
  ): HttpRoutes[IO] = HttpRoutes.of[IO] {

    case GET -> Root / "ws" / "game" / gameId / playerId =>
      withRoom(manager, gameId) { room =>
        room.stateRef.get.flatMap { state =>
          if !state.players.exists(_.id == playerId) then
            NotFound(errorBody(s"Unknown player: $playerId"))
          else
            val views: Stream[IO, WebSocketFrame] =
              (Stream.eval(room.stateRef.get) ++ room.topic.subscribe(64))
                .map { current =>
                  WebSocketFrame.Text(
                    PlayerGameView.forViewer(current, playerId).asJson.noSpaces
                  )
                }
            val commands: Pipe[IO, WebSocketFrame, Unit] =
              _.collect { case WebSocketFrame.Text(text, _) => text }
                .evalMap { text =>
                  parser.decode[GameAction](text) match
                    case Right(action) => GameActor.applyAction(room, action).void
                    case Left(error) =>
                      GameActor.logRejected(
                        s"Invalid action payload in game $gameId from player $playerId: ${describe(error)}"
                      )
                }
            webSockets.build(views, commands)
        }
      }
  }

  private def withRoom(manager: GameManager, gameId: String)(
      handle: GameRoom => IO[Response[IO]]
  ): IO[Response[IO]] =
    manager.getRoom(gameId).flatMap {
      case Some(room) => handle(room)
      case None       => NotFound(errorBody(s"Unknown game: $gameId"))
    }

  private def createResponse(room: GameRoom, names: List[String]): Json =
    val players = room.playerIds.zipWithIndex.map { case (id, idx) =>
      Json.obj(
        "id" -> Json.fromString(id),
        "name" -> Json.fromString(names.lift(idx).getOrElse(""))
      )
    }
    Json.obj(
      "gameId" -> Json.fromString(room.gameId),
      "players" -> Json.fromValues(players)
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
