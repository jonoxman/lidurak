package durak.server

import cats.effect.*
import durak.engine.*
import fs2.concurrent.Topic
import org.slf4j.LoggerFactory

import scala.concurrent.duration.*

/**
 * A live game: its authoritative state, its broadcast topic, its seats, its
 * turn clock and its bot driver. The clock wakes up for whichever player the
 * game is waiting on and plays a legal move if they do not; the bot driver does
 * the same, sooner and after a human-like pause, for computer-controlled seats.
 */
case class GameRoom(
  gameId: String,
  stateRef: Ref[IO, GameState],
  topic: Topic[IO, GameState],
  playerIds: Vector[String],
  turnSeconds: Int,
  clockStop: Deferred[IO, Unit],
  botDelayMin: FiniteDuration = GameActor.DefaultBotDelayMin,
  botDelayMax: FiniteDuration = GameActor.DefaultBotDelayMax
)

object GameActor:

  /** Seconds a player has to act before the server plays for them. */
  val DefaultTurnSeconds: Int = 15

  /** Grace period a defender with no legal defense gets before auto-surrender. */
  val DefenselessGraceSeconds: Int = 3

  /** Shortest pause a bot takes before it plays, so moves stay readable. */
  val DefaultBotDelayMin: FiniteDuration = 500.millis

  /** Longest pause a bot takes before it plays. */
  val DefaultBotDelayMax: FiniteDuration = 2000.millis

  /** How often the clock re-reads the room state while a turn is running. */
  private val ClockPollMillis: Long = 250L

  /** How often the bot driver checks whether the state moved on. */
  private val BotPollMillis: Long = 50L

  private val logger = LoggerFactory.getLogger("durak.server.GameActor")

  private val botRandom = new scala.util.Random()

  /**
   * Records a rejected client action as a warning. The line goes to SLF4J and
   * to stdout, so invalid traffic stays visible without a log binding.
   */
  def logRejected(message: String): IO[Unit] =
    IO.delay {
      logger.warn(message)
      println(message)
    }.void

  /** Name of the action's variant, e.g. `InitialAttack`, used in log lines. */
  def actionType(action: GameAction): String = action.productPrefix

  /**
   * Creates a room holding the engine's initial state for `config`, with a fresh
   * 8-character game id, and starts its turn clock and bot driver.
   */
  def create(
      config: GameConfig,
      playerNames: Vector[String],
      turnSeconds: Int = DefaultTurnSeconds,
      botDelayMin: FiniteDuration = DefaultBotDelayMin,
      botDelayMax: FiniteDuration = DefaultBotDelayMax
  ): IO[GameRoom] =
    IO.delay(GameEngine.createGame(config, playerNames)).flatMap { initialState =>
      nowMs.flatMap { now =>
        for
          stateRef <- Ref.of[IO, GameState](
            initialState.copy(turnDeadlineMs = now + turnSeconds.toLong * 1000L)
          )
          topic <- Topic[IO, GameState]
          clockStop <- Deferred[IO, Unit]
          room = GameRoom(
            gameId = GameManager.generateGameId(),
            stateRef = stateRef,
            topic = topic,
            playerIds = initialState.players.map(_.id),
            turnSeconds = turnSeconds,
            clockStop = clockStop,
            botDelayMin = botDelayMin,
            botDelayMax = botDelayMax
          )
          _ <- startClock(room)
          _ <- startBots(room)
        yield room
      }
    }

  /**
   * Validates and applies `action` atomically. A rejected action leaves the
   * stored state untouched; a successful one restarts the turn clock for the
   * next acting player and publishes the new state to the room's topic.
   */
  def applyAction(room: GameRoom, action: GameAction): IO[Either[String, GameState]] =
    nowMs.flatMap { now =>
      room.stateRef
        .modify { current =>
          GameEngine.applyAction(current, action) match
            case Right(next) =>
              val clocked = withTurnClock(room, next, now)
              (clocked, Right(clocked): Either[String, GameState])
            case Left(error) =>
              (current, Left(error): Either[String, GameState])
        }
        .flatMap {
          case Right(next) =>
            room.topic.publish1(next).void.as(Right(next): Either[String, GameState])
          case rejected @ Left(error) =>
            logRejected(
              s"Invalid action ${actionType(action)} from player ${actorId(action)}: $error"
            ).as(rejected)
        }
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

  // --- Presence ---

  /**
   * Records whether a human seat is connected, publishing a fresh projection so
   * every subscriber's presence dots update. Bot seats are always present, and
   * presence for an unknown seat or an unchanged value is a no-op.
   */
  def setPresence(room: GameRoom, playerId: String, isPresent: Boolean): IO[Unit] =
    room.stateRef
      .modify { current =>
        val known = current.players.exists(_.id == playerId)
        val changed = current.presentPlayers.contains(playerId) != isPresent
        if !known || !changed then (current, None)
        else
          val updated = current.copy(
            presentPlayers =
              if isPresent then current.presentPlayers + playerId
              else current.presentPlayers - playerId
          )
          (updated, Some(updated))
      }
      .flatMap {
        case Some(updated) => room.topic.publish1(updated).void
        case None          => IO.unit
      }

  // --- Turn clock ---

  /** Starts the room's turn clock in the background. */
  def startClock(room: GameRoom): IO[Unit] = clockLoop(room).start.void

  /** Stops the room's turn clock, so no further auto-play happens. */
  def stopClock(room: GameRoom): IO[Unit] = room.clockStop.complete(()).void

  /** Restarts the clock for the next acting player, or clears it once the game is over. */
  private def withTurnClock(room: GameRoom, state: GameState, nowMs: Long): GameState =
    if state.isGameOver then state.copy(turnDeadlineMs = 0L)
    else state.copy(turnDeadlineMs = nowMs + room.turnSeconds.toLong * 1000L)

  /**
   * Watches the acting player's deadline in short slices, so a state change
   * (including a defender becoming defenseless) is picked up promptly. Once the
   * effective deadline passes, one legal move is played on their behalf.
   */
  private def clockLoop(room: GameRoom): IO[Unit] =
    room.stateRef.get.flatMap { state =>
      if state.isGameOver || !state.hasTurnClock then IO.unit
      else
        nowMs.flatMap { now =>
          val remainingMs = effectiveDeadlineMs(room, state) - now
          val pollMs = Math.max(0L, Math.min(ClockPollMillis, remainingMs))
          IO.sleep(pollMs.millis).race(room.clockStop.get).flatMap {
            case Right(_) => IO.unit // the clock was stopped
            case Left(_) =>
              nowMs.flatMap { wake =>
                room.stateRef.get.flatMap { current =>
                  if current.isGameOver || effectiveDeadlineMs(room, current) > wake then
                    clockLoop(room)
                  else
                    autoPlay(room, current).flatMap {
                      case true  => clockLoop(room)
                      // The clocked player has no legal move: back off, then re-check.
                      case false => IO.sleep(ClockPollMillis.millis) *> clockLoop(room)
                    }
                }
              }
          }
        }
    }

  /**
   * When the clock fires: the turn deadline, pulled earlier once the defender
   * has no defense at all, so they get a short grace period to surrender.
   */
  private def effectiveDeadlineMs(room: GameRoom, state: GameState): Long =
    if !state.defenderIsDefenseless then state.turnDeadlineMs
    else
      val turnStartMs = state.turnDeadlineMs - room.turnSeconds.toLong * 1000L
      Math.min(state.turnDeadlineMs, turnStartMs + DefenselessGraceSeconds.toLong * 1000L)

  /** Plays one move for the clocked player; returns whether an action was applied. */
  private def autoPlay(room: GameRoom, state: GameState): IO[Boolean] =
    state.turnPlayerId match
      case None => IO.pure(false)
      case Some(playerId) =>
        autoActionFor(state, playerId) match
          case None => IO.pure(false)
          case Some(action) =>
            IO.delay(
              logger.info(
                s"Turn clock expired in game ${room.gameId}: auto-playing " +
                  s"${actionType(action)} for $playerId"
              )
            ).void *> applyAction(room, action).as(true)

  /**
   * The move the server plays on expiry: surrender when the defender is
   * defenseless (their only legal defense), otherwise any random legal move.
   */
  private def autoActionFor(state: GameState, playerId: String): Option[GameAction] =
    val isDefending = state.players.lift(state.defenderIdx).exists(_.id == playerId)
    val surrender =
      Option
        .when(state.defenderIsDefenseless && isDefending)(
          GameAction.DeclareSurrender(playerId)
        )
        .filter(action => GameEngine.applyAction(state, action).isRight)

    surrender.orElse(GameEngine.randomLegalAction(state, playerId, new scala.util.Random()))

  // --- Bots ---

  /** Starts the room's bot driver in the background when any seat is a bot. */
  def startBots(room: GameRoom): IO[Unit] =
    room.stateRef.get.flatMap { state =>
      if state.players.indices.exists(state.config.isBotSeat) then botLoop(room).start.void
      else IO.unit
    }

  /**
   * The seat the game is waiting on, when that seat is a bot with something to
   * play: the attacker during an opening attack, the defender while attacks are
   * uncovered, and otherwise any thrower who has not passed yet.
   */
  def promptedBotId(state: GameState): Option[String] =
    if state.isGameOver then None
    else
      val candidates = state.boutPhase match
        case BoutPhase.InitialAttack  => Vector(state.attackerIdx)
        case BoutPhase.Defense        =>
          if state.tablePairs.exists(_.defense.isEmpty) then Vector(state.defenderIdx)
          else throwerSeats(state)
        case BoutPhase.SurrenderThrowIn => throwerSeats(state)
        case BoutPhase.BoutOver | BoutPhase.GameOver => Vector.empty

      candidates.flatMap(seat => botIdAt(state, seat)).headOption

  /** Non-defending active seats that still have to pass or throw in. */
  private def throwerSeats(state: GameState): Vector[Int] =
    state.players.indices
      .filter { idx =>
        val seat = state.players(idx)
        idx != state.defenderIdx && seat.isActive && seat.hasCards && !seat.hasPassed
      }
      .toVector

  /** The bot id at `seatIdx` when that seat is a bot with a legal move. */
  private def botIdAt(state: GameState, seatIdx: Int): Option[String] =
    Option
      .when(state.config.isBotSeat(seatIdx))(state.players.lift(seatIdx).map(_.id))
      .flatten
      .filter(playerId => RandomBot.legalActionsFor(state, playerId).nonEmpty)

  /**
   * Drives every bot seat for the whole game. A single fiber owns all bot moves,
   * so a pending move can never race another one: each iteration re-reads the
   * state, and a state transition during the pause ends the pending move before
   * it can play for a position that no longer exists.
   */
  private def botLoop(room: GameRoom): IO[Unit] =
    room.stateRef.get.flatMap { state =>
      if state.isGameOver then IO.unit
      else
        promptedBotId(state) match
          case None => awaitStateChange(room, state) *> botLoop(room)
          case Some(botId) =>
            IO.sleep(randomBotDelay(room)).race(awaitStateChange(room, state)).flatMap {
              case Right(_) => botLoop(room) // the table moved on: reconsider
              case Left(_) =>
                room.stateRef.get.flatMap { current =>
                  if current != state then botLoop(room)
                  else
                    RandomBot.chooseAction(current, botId) match
                      case None => awaitStateChange(room, current) *> botLoop(room)
                      case Some(action) => playBotAction(room, action) *> botLoop(room)
                }
            }
    }

  /** Waits until the room's state differs from `previous`. */
  private def awaitStateChange(room: GameRoom, previous: GameState): IO[Unit] =
    IO.sleep(BotPollMillis.millis) *> room.stateRef.get.flatMap { current =>
      if current == previous then awaitStateChange(room, previous) else IO.unit
    }

  /** A random pause in the room's configured bot delay window. */
  private def randomBotDelay(room: GameRoom): FiniteDuration =
    val minMs = Math.max(0L, room.botDelayMin.toMillis)
    val maxMs = Math.max(minMs, room.botDelayMax.toMillis)
    (minMs + Math.floorMod(botRandom.nextLong(), maxMs - minMs + 1)).millis

  /** Submits a bot's move through the same pipeline as a client action. */
  private def playBotAction(room: GameRoom, action: GameAction): IO[Unit] =
    IO.delay(
      logger.info(
        s"RandomBot plays ${actionType(action)} as ${actorId(action)} in game ${room.gameId}"
      )
    ).void *> applyAction(room, action).void

  private def nowMs: IO[Long] = IO.realTime.map(_.toMillis)
