package durak

import cats.effect.*
import com.comcast.ip4s.*
import durak.server.{GameManager, GameRoutes}
import org.http4s.ember.server.EmberServerBuilder

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
      server <- EmberServerBuilder
        .default[IO]
        .withHost(host"0.0.0.0")
        .withPort(port"8080")
        .withIdleTimeout(IdleTimeout)
        .withHttpWebSocketApp(ws => GameRoutes.routes(manager)(using ws).orNotFound)
        .build
    yield server).use { _ =>
      IO.println("Durak server running on 0.0.0.0:8080") *> IO.never
    }
