package durak.server

import cats.effect.*
import durak.engine.*
import fs2.concurrent.Topic

import java.util.UUID

/** A live game: its authoritative state, its broadcast topic, and its seats. */
case class GameRoom(
  gameId: String,
  stateRef: Ref[IO, GameState],
  topic: Topic[IO, GameState],
  playerIds: Vector[String]
)

object GameActor:

  /**
   * Creates a room holding the engine's initial state for `config`. All player
   * ids are derived from the engine's seat naming (`p0`, `p1`, ...).
   */
  def create(config: GameConfig, playerNames: Vector[String]): IO[GameRoom] =
    IO.delay(GameEngine.createGame(config, playerNames)).flatMap { initialState =>
      for
        stateRef <- Ref.of[IO, GameState](initialState)
        topic <- Topic[IO, GameState]
      yield GameRoom(
        gameId = UUID.randomUUID().toString,
        stateRef = stateRef,
        topic = topic,
        playerIds = initialState.players.map(_.id)
      )
    }

  /**
   * Validates and applies `action` atomically. A rejected action leaves the
   * stored state untouched; a successful one publishes the new state to the
   * room's topic for every subscriber.
   */
  def applyAction(room: GameRoom, action: GameAction): IO[Either[String, GameState]] =
    room.stateRef
      .modify { current =>
        GameEngine.applyAction(current, action) match
          case Right(next)  => (next, Right(next): Either[String, GameState])
          case Left(error)  => (current, Left(error): Either[String, GameState])
      }
      .flatMap {
        case Right(next) =>
          room.topic.publish1(next).void.as(Right(next): Either[String, GameState])
        case rejected @ Left(_) =>
          IO.pure(rejected)
      }

  /** The seat that issued `action`. */
  def actorId(action: GameAction): String =
    action match
      case GameAction.InitialAttack(playerId, _)  => playerId
      case GameAction.CoverCard(playerId, _, _)   => playerId
      case GameAction.RedirectAttack(playerId, _) => playerId
      case GameAction.ThrowInCards(playerId, _)   => playerId
      case GameAction.DeclareSurrender(playerId)  => playerId
      case GameAction.PassTurn(playerId)          => playerId
