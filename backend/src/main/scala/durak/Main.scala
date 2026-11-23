package durak

import cats.effect.*
import cats.syntax.all.*
import com.comcast.ip4s.*
import durak.http.{MultiplayerRoutes, QaPresetRoutes}
import durak.lobby.QuickPairingService
import durak.rooms.RoomManager
import durak.server.{GameManager, GameRoutes}
import durak.session.{SessionRoutes, SessionStore}
import fs2.Stream
import io.circe.parser
import org.http4s.*
import org.http4s.dsl.io.*
import org.http4s.ember.server.EmberServerBuilder
import org.http4s.server.websocket.WebSocketBuilder2

import java.nio.charset.StandardCharsets
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
      quickPairing <- Resource.eval(QuickPairingService.create[IO](rooms))
      server <- EmberServerBuilder
        .default[IO]
        .withHost(host"0.0.0.0")
        .withPort(port"8080")
        .withIdleTimeout(IdleTimeout)
        .withHttpWebSocketApp { ws =>
          given WebSocketBuilder2[IO] = ws
          httpApp(
            local = GameRoutes.routes(manager),
            multiplayer = MultiplayerRoutes.routes(sessions, rooms, quickPairing),
            sessions = SessionRoutes.routes(sessions),
            presets = QaPresetRoutes.routes(sessions, rooms)
          ).orNotFound
        }
        .build
    yield server).use { _ =>
      IO.println("Durak server running on 0.0.0.0:8080") *> IO.never
    }

  /**
   * The complete route tree of the server: every M1 router and every M2 router,
   * side by side.
   *
   * `multiplayer` is mounted in its own right, not only through the
   * `POST /api/games` dispatcher, so `/api/lobby`, `/api/games/:gameId`,
   * `/api/games/:gameId/join|leave`, `/api/quick-pair` and both WebSockets are
   * served by the running app.
   *
   * `local` comes first among the routers proper because `GameRoutes` is the
   * legacy surface for local/bot tables. The only path both milestones share is
   * `POST /api/games`, which `sharedGameCreation` resolves before either router
   * sees it; every other M1 path (`/api/games/:gameId/view`, `/ws/games/…/:seat`)
   * is more specific than its M2 neighbour, so neither shadows the other.
   */
  private[durak] def httpApp(
      local: HttpRoutes[IO],
      multiplayer: HttpRoutes[IO],
      sessions: HttpRoutes[IO],
      presets: HttpRoutes[IO]
  ): HttpRoutes[IO] =
    sharedGameCreation(local, multiplayer) <+>
      local <+>
      multiplayer <+>
      sessions <+>
      presets

  /**
   * `POST /api/games` predates M2 and still creates the local/bot table of the
   * single-player UI, while M2 creates a shareable room from the same path.
   * The body tells them apart: only the legacy request carries `playerNames`,
   * so the body is read once and handed to whichever router owns that shape.
   */
  private def sharedGameCreation(
      local: HttpRoutes[IO],
      multiplayer: HttpRoutes[IO]
  ): HttpRoutes[IO] = HttpRoutes.of[IO] {
    case req @ POST -> Root / "api" / "games" =>
      req.body.compile.to(Array).flatMap { bytes =>
        val isLocal = parser
          .parse(String(bytes, StandardCharsets.UTF_8))
          .toOption
          .exists(_.hcursor.downField("playerNames").succeeded)
        val target = if isLocal then local else multiplayer
        target.orNotFound(
          req.withBodyStream(Stream.emits(bytes.toIndexedSeq).covary[IO])
        )
      }
  }
