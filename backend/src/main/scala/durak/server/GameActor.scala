package durak.server

import cats.effect.*
import durak.engine.*
import fs2.concurrent.Topic

import java.util.UUID
import scala.concurrent.duration.*

/** A live game: its authoritative state, its broadcast topic, and its seats. */
case class GameRoom(
  gameId: String,
  stateRef: Ref[IO, GameState],
  topic: Topic[IO, GameState],
  playerIds: Vector[String],
  /** Background turn-clock fiber, present when the server owns the room. */
  clock: Option[FiberIO[Unit]] = None
)

object GameActor:

  /** Machine-initiated transitions wait this long so they are not abrupt. */
  val AutoActionDelay: FiniteDuration = 3.seconds

  /** How often the server polls the turn clock. */
  val ClockInterval: FiniteDuration = 1.second

  /**
   * Creates a room holding the engine's initial state for `config`. All player
   * ids are derived from the engine's seat naming (`p0`, `p1`, ...).
   */
  def create(config: GameConfig, playerNames: Vector[String]): IO[GameRoom] =
    createAt(config, playerNames, System.currentTimeMillis())

  /** Creates a room whose opening turn clock starts at `nowMs`. */
  def createAt(
      config: GameConfig,
      playerNames: Vector[String],
      nowMs: Long
  ): IO[GameRoom] =
    IO.delay(GameEngine.createGameAt(config, playerNames, nowMs)).flatMap { initialState =>
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

  /** Creates a room and starts its 15-second turn clock (used by the server). */
  def createWithClock(config: GameConfig, playerNames: Vector[String]): IO[GameRoom] =
    create(config, playerNames).flatMap { room =>
      startClock(room).map(fiber => room.copy(clock = Some(fiber)))
    }

  /**
   * Validates and applies `action` atomically against the wall clock. A rejected
   * action leaves the stored state untouched; a successful one publishes the
   * new state to the room's topic for every subscriber.
   */
  def applyAction(room: GameRoom, action: GameAction): IO[Either[String, GameState]] =
    applyActionAt(room, action, System.currentTimeMillis())

  /** Applies `action` and restarts the 15-second clock at `nowMs`. */
  def applyActionAt(
      room: GameRoom,
      action: GameAction,
      nowMs: Long
  ): IO[Either[String, GameState]] =
    room.stateRef
      .modify { current =>
        GameEngine.applyActionAt(current, action, nowMs) match
          case Right(next)  => (next, Right(next): Either[String, GameState])
          case Left(error)  => (current, Left(error): Either[String, GameState])
      }
      .flatMap {
        case Right(next) =>
          room.topic.publish1(next).void.as(Right(next): Either[String, GameState])
        case rejected @ Left(_) =>
          IO.pure(rejected)
      }

  /**
   * Applies the timeout default for the player on the clock once the 15-second
   * deadline has passed, after the 3-second auto-action delay.
   *
   * Defaults: a random legal attack card for the opening attacker (against a
   * random target in chaos mode), an automatic surrender for the defender, and
   * a pass for a non-defending player.
   */
  def tick(
      room: GameRoom,
      nowMs: Long,
      delay: FiniteDuration = AutoActionDelay
  ): IO[Option[GameState]] =
    room.stateRef.get.flatMap { state =>
      if !state.isTurnExpired(nowMs) then IO.pure(None)
      else
        GameEngine.defaultAction(state) match
          case None => IO.pure(None)
          case Some(action) =>
            IO.sleep(delay) *>
              applyActionAt(room, action, nowMs + delay.toMillis).map(_.toOption)
    }

  /**
   * Applies a forced follow-up the engine is waiting on — for example a defender
   * with no legal defense who must auto-surrender — after the 3-second delay.
   */
  def settleAutoActions(
      room: GameRoom,
      nowMs: Long,
      delay: FiniteDuration = AutoActionDelay
  ): IO[Option[GameState]] =
    room.stateRef.get.flatMap { state =>
      GameEngine.pendingAutoAction(state) match
        case None => IO.pure(None)
        case Some(action) =>
          IO.sleep(delay) *>
            applyActionAt(room, action, nowMs + delay.toMillis).map(_.toOption)
    }

  /** Polls the turn clock forever: one timeout check and auto-action per tick. */
  def clockLoop(
      room: GameRoom,
      interval: FiniteDuration = ClockInterval
  ): IO[Unit] =
    (IO.sleep(interval) *>
      tick(room, System.currentTimeMillis()) *>
      settleAutoActions(room, System.currentTimeMillis())).foreverM

  /** Starts the room's clock in the background and returns its fiber. */
  def startClock(
      room: GameRoom,
      interval: FiniteDuration = ClockInterval
  ): IO[FiberIO[Unit]] =
    clockLoop(room, interval).start

  /** The seat that issued `action`. */
  def actorId(action: GameAction): String =
    action match
      case GameAction.InitialAttack(playerId, _, _) => playerId
      case GameAction.CoverCard(playerId, _, _)     => playerId
      case GameAction.RedirectAttack(playerId, _)   => playerId
      case GameAction.ThrowInCards(playerId, _)     => playerId
      case GameAction.DeclareSurrender(playerId)    => playerId
      case GameAction.PassTurn(playerId)            => playerId
