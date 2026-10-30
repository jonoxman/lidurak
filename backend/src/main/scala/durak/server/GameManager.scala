package durak.server

import cats.effect.*
import durak.engine.*

/** An in-memory registry of live game rooms, keyed by their generated game id. */
class GameManager(rooms: Ref[IO, Map[String, GameRoom]]):

  /** Creates a room with a fresh unique id and registers it. */
  def createGame(config: GameConfig, playerNames: Vector[String]): IO[GameRoom] =
    GameActor.create(config, playerNames).flatMap { room =>
      rooms.update(current => current.updated(room.gameId, room)).as(room)
    }

  def getRoom(gameId: String): IO[Option[GameRoom]] =
    rooms.get.map(_.get(gameId))

object GameManager:

  def create: IO[GameManager] =
    Ref.of[IO, Map[String, GameRoom]](Map.empty).map(new GameManager(_))
