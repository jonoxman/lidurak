package durak.server

import cats.effect.*
import durak.engine.*

/** An in-memory registry of live game rooms, keyed by their generated game id. */
class GameManager(rooms: Ref[IO, Map[String, GameRoom]]):

  /** Creates a room with a fresh unique id and registers it. */
  def createGame(config: GameConfig, playerNames: Vector[String]): IO[GameRoom] =
    GameActor.create(config, playerNames).flatMap { room =>
      rooms
        .modify { current =>
          if current.contains(room.gameId) then (current, false)
          else (current.updated(room.gameId, room), true)
        }
        .flatMap { registered =>
          // A short id can in principle collide with a live room; draw another.
          if registered then IO.pure(room) else createGame(config, playerNames)
        }
    }

  def getRoom(gameId: String): IO[Option[GameRoom]] =
    rooms.get.map(_.get(gameId))

object GameManager:

  /** Game ids are short and shareable: exactly this many characters. */
  val GameIdLength: Int = 8

  private val GameIdAlphabet =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

  private val GameIdRandom = new java.security.SecureRandom()

  /** A fresh 8-character alphanumeric game id, e.g. `aB3dE9fZ`. */
  def generateGameId(): String =
    (1 to GameIdLength)
      .map(_ => GameIdAlphabet(GameIdRandom.nextInt(GameIdAlphabet.length)))
      .mkString

  def create: IO[GameManager] =
    Ref.of[IO, Map[String, GameRoom]](Map.empty).map(new GameManager(_))
