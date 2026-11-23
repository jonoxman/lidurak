package durak

import cats.data.OptionT
import cats.effect.*
import cats.syntax.all.*
import com.comcast.ip4s.*
import durak.http.{MultiplayerRoutes, QaPresetRoutes}
import durak.lobby.QuickPairingService
import durak.rooms.RoomManager
import durak.server.{GameManager, GameRoutes}
import durak.session.{SessionRoutes, SessionStore}
import io.circe.Json
import org.http4s.*
import org.http4s.circe.CirceEntityDecoder.*
import org.http4s.circe.CirceEntityEncoder.*
import org.http4s.ember.server.EmberServerBuilder
import org.http4s.server.websocket.WebSocketBuilder2

import scala.concurrent.duration.*

object Main extends IOApp.Simple:

  /**
   * Ember's 60-second default closes any connection that stays quiet that long,
   * which killed live games (`java.util.concurrent.TimeoutException`) while a
   * table sat idle. Idle sockets are kept alive by the WebSocket `Ping`
   * heartbeat instead, so only genuinely dead connections time out.
   */
  val IdleTimeout: FiniteDuration = 10.minutes

  def run: IO[Unit] =
    (for
      manager <- Resource.eval(GameManager.create)
      sessions <- Resource.eval(SessionStore.inMemory[IO])
      rooms <- Resource.eval(RoomManager.create[IO]())
      quickPair <- Resource.eval(QuickPairingService.create[IO](rooms))
      server <- EmberServerBuilder
        .default[IO]
        .withHost(host"0.0.0.0")
        .withPort(port"8080")
        .withIdleTimeout(IdleTimeout)
        .withHttpWebSocketApp { webSockets =>
          given WebSocketBuilder2[IO] = webSockets
          app(manager, sessions, rooms, quickPair).orNotFound
        }
        .build
    yield server).use { _ =>
      IO.println("Durak server running on 0.0.0.0:8080") *> IO.never
    }

  /**
   * The whole M2 app plus the M1 local/inspector routes.
   *
   * M2 owns the multiplayer surface, including `POST /api/games`, which creates
   * a shareable room. The M1 hotseat client still posts a `playerNames` body to
   * that same path, so those requests are dispatched to the M1 routes first;
   * every other M1 endpoint (`/ws/game/...`, `/api/games/:id/view`,
   * `/api/games/:id/action`, presets, replays) keeps working unchanged.
   */
  private def app(
      manager: GameManager,
      sessions: SessionStore[IO],
      rooms: RoomManager[IO],
      quickPair: QuickPairingService[IO]
  )(using WebSocketBuilder2[IO]): HttpRoutes[IO] =
    val legacy = GameRoutes.routes(manager)
    val multiplayer = MultiplayerRoutes.routes(sessions, rooms, quickPair)
    val presets = QaPresetRoutes.routes(sessions, rooms)
    val sessionRoutes = SessionRoutes.routes(sessions)
    val everything = sessionRoutes <+> presets <+> multiplayer <+> legacy

    HttpRoutes[IO] { request =>
      if request.method == Method.POST &&
        request.uri.path.renderString == "/api/games"
      then
        OptionT {
          request.as[Json].attempt.flatMap {
            case Right(body) if isLegacyCreate(body) =>
              legacy.run(request.withEntity(body)).value
            case Right(body) =>
              multiplayer.run(request.withEntity(body)).value
            case Left(_) =>
              multiplayer.run(request).value
          }
        }
      else everything.run(request)
    }

  /** The M1 hotseat create payload names its seats explicitly. */
  private def isLegacyCreate(body: Json): Boolean =
    body.hcursor.downField("playerNames").focus.isDefined
