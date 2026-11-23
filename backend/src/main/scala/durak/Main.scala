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
          val local = GameRoutes.routes(manager)
          val multiplayer = MultiplayerRoutes.routes(sessions, rooms, quickPairing)
          val app =
            sharedGameCreation(local, multiplayer) <+>
              local <+>
              SessionRoutes.routes(sessions) <+>
              QaPresetRoutes.routes(sessions, rooms)
          app.orNotFound
        }
        .build
    yield server).use { _ =>
      IO.println("Durak server running on 0.0.0.0:8080") *> IO.never
    }

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
