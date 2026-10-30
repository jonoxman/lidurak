package durak

import cats.effect.*
import com.comcast.ip4s.*
import durak.server.{GameManager, GameRoutes}
import org.http4s.ember.server.EmberServerBuilder

object Main extends IOApp.Simple:
  def run: IO[Unit] =
    (for
      manager <- Resource.eval(GameManager.create)
      server <- EmberServerBuilder
        .default[IO]
        .withHost(host"0.0.0.0")
        .withPort(port"8080")
        .withHttpWebSocketApp(ws => GameRoutes.routes(manager)(using ws).orNotFound)
        .build
    yield server).use { _ =>
      IO.println("Durak server running on 0.0.0.0:8080") *> IO.never
    }
