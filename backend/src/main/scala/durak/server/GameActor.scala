package durak.server

import cats.effect.*
import cats.effect.std.Semaphore
import durak.engine.*
import fs2.concurrent.Topic
import org.slf4j.LoggerFactory

import scala.concurrent.duration.*

/**
 * A live game: its authoritative state, its broadcast topic, its recorded
 * replay history, its seats, its turn clock and its bot driver. The clock wakes
 * up for whichever players the game is waiting on and plays legal moves if they
 * do not; the bot driver does the same for computer-controlled seats, instantly
 * for a [[GameConfig.RandomBotSeat]] and after a human-like pause for a
 * [[GameConfig.BasicBotSeat]].
 */
case class GameRoom(
  gameId: String,
  stateRef: Ref[IO, GameState],
  topic: Topic[IO, GameState],
  replay: Ref[IO, SerializedGame],
  // Serialises every submitted move, so a multi-card action applies as one unit.
  lock: Semaphore[IO],
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
        val gameId = GameManager.generateGameId()
        for
          stateRef <- Ref.of[IO, GameState](
            initialState.copy(turnDeadlineMs = now + turnSeconds.toLong * 1000L)
          )
          topic <- Topic[IO, GameState]
          // The replay starts from the pristine deal, before any move or clock.
          replay <- Ref.of[IO, SerializedGame](GameReplay.initial(gameId, initialState))
          lock <- Semaphore[IO](1)
          clockStop <- Deferred[IO, Unit]
          room = GameRoom(
            gameId = gameId,
            stateRef = stateRef,
            topic = topic,
            replay = replay,
            lock = lock,
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
   * Validates and applies `action` atomically, one move at a time. A rejected
   * action leaves the stored state untouched; a successful one stamps the game
   * timer, restarts the turn clock for the next acting players, appends to the
   * replay history and publishes the new state to the room's topic.
   *
   * A multi-card [[GameAction.ThrowInCards]] is split into a single-card move
   * per card, so every thrown-in card becomes its own step in the replay.
   */
  def applyAction(room: GameRoom, action: GameAction): IO[Either[String, GameState]] =
    room.lock.permit.use { _ =>
      nowMs.flatMap { now =>
        room.stateRef.get.flatMap { current =>
          GameEngine.applyAction(current, action) match
            case Left(error) =>
              logRejected(
                s"Invalid action ${actionType(action)} from player ${actorId(action)}: $error"
              ).as(Left(error): Either[String, GameState])
            case Right(_) =>
              applyPieces(room, atomicPieces(action), now)
        }
      }
    }

  /**
   * Splits one client action into the atomic moves that get recorded: a
   * throw-in of several cards becomes one throw-in per card, everything else is
   * already atomic.
   */
  def atomicPieces(action: GameAction): List[GameAction] = action match
    case GameAction.ThrowInCards(playerId, cards) if cards.size > 1 =>
      cards.map(card => GameAction.ThrowInCards(playerId, List(card)))
    case other => List(other)

  /** Applies `pieces` in order, stopping at the first rejected move. */
  private def applyPieces(
      room: GameRoom,
      pieces: List[GameAction],
      now: Long
  ): IO[Either[String, GameState]] =
    def loop(
        rest: List[GameAction],
        previous: Option[GameState]
    ): IO[Either[String, GameState]] =
      rest match
        case Nil =>
          previous match
            case Some(state) => IO.pure(Right(state))
            case None        => room.stateRef.get.map(state => Right(state))
        case piece :: tail =>
          applyAtomicAction(room, piece, now).flatMap {
            case Right(next) => loop(tail, Some(next))
            case rejected    => IO.pure(rejected)
          }

    loop(pieces, None)

  /**
   * Applies one atomic move under the room's lock: the overall timer and the
   * turn clock are stamped on the new state, the move joins the replay history,
   * and the result is published to every subscriber.
   */
  private def applyAtomicAction(
      room: GameRoom,
      action: GameAction,
      now: Long
  ): IO[Either[String, GameState]] =
    room.stateRef
      .modify { current =>
        GameEngine.applyAction(current, action) match
          case Right(next) =>
            val timed = withGameTimers(current, next, now)
            val clocked = withTurnClock(room, timed, now)
            (clocked, Right(clocked): Either[String, GameState])
          case Left(error) =>
            (current, Left(error): Either[String, GameState])
      }
      .flatMap {
        case Right(next) =>
          room.replay
            .update(replay => GameReplay.appendMove(replay, action, next, now)) *>
            room.topic.publish1(next).void.as(Right(next): Either[String, GameState])
        case rejected @ Left(error) =>
          logRejected(
            s"Invalid action ${actionType(action)} from player ${actorId(action)}: $error"
          ).as(rejected)
      }

  /** The seat that issued `action`. */
  def actorId(action: GameAction): String = GameEngine.actorId(action)

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
   * Stamps the overall game clock: it starts with the first move and keeps that
   * start time on every later move, while the end time is frozen as soon as a
   * move reaches [[BoutPhase.GameOver]].
   */
  private def withGameTimers(previous: GameState, next: GameState, nowMs: Long): GameState =
    val startedAt = next.gameStartedAtMs.orElse(previous.gameStartedAtMs).orElse(Some(nowMs))
    val endedAt = next.gameEndedAtMs.orElse(Option.when(next.isGameOver)(nowMs))
    next.copy(gameStartedAtMs = startedAt, gameEndedAtMs = endedAt)

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

  /**
   * Plays every move the expired clock owes: one auto-action for the seat it
   * was waiting on, or a `PassTurn` for every throw-in player who is still on
   * the clock, so a bout never stalls with several throwers waiting.
   * Returns whether at least one move was applied.
   */
  private def autoPlay(room: GameRoom, state: GameState): IO[Boolean] =
    val actions = autoActionsFor(state)
    if actions.isEmpty then IO.pure(false)
    else
      def play(rest: List[GameAction], played: Boolean): IO[Boolean] =
        rest match
          case Nil => IO.pure(played)
          case action :: tail =>
            IO.delay(
              logger.info(
                s"Turn clock expired in game ${room.gameId}: auto-playing " +
                  s"${actionType(action)} for ${actorId(action)}"
              )
            ).void *> applyAction(room, action).flatMap {
              case Right(_) => play(tail, true)
              // The bout moved on (or the move was refused): stop here.
              case Left(_)  => IO.pure(played)
            }

      play(actions, false)

  /** The moves the server plays when the clock of `state`'s prompted seats expires. */
  private def autoActionsFor(state: GameState): List[GameAction] =
    val prompted = state.promptedPlayerIds
    if state.isThrowInPhase then
      val passes = state.players
        .filter(player => prompted.contains(player.id))
        .map(player => GameAction.PassTurn(player.id))
        .toList
      if passes.nonEmpty then passes else settlingPassFor(state).toList
    else
      state.players
        .filter(player => prompted.contains(player.id))
        .flatMap(player => autoActionFor(state, player.id))
        .toList

  /**
   * A surrender can auto-pass every thrower at once, which leaves nobody on the
   * clock while the bout still needs one settling pass. The engine accepts that
   * pass from any active non-defender, so send it for the first one.
   */
  private def settlingPassFor(state: GameState): Option[GameAction] =
    state.players.zipWithIndex
      .collectFirst {
        case (player, idx) if idx != state.defenderIdx && player.isActive =>
          GameAction.PassTurn(player.id)
      }
      .filter(action => GameEngine.applyAction(state, action).isRight)

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
        .filter(action => GameEngine.applyAction(state, playerId, action).isRight)

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
   * uncovered (and only before a surrender), and otherwise a non-defending
   * thrower. A bot is never prompted once the game is over or from the
   * surrendering defender's seat.
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

  /**
   * Non-defending active seats, un-passed throwers first. Seats that already
   * passed stay in the list because a passed (or cardless) seat may still hold
   * the single settling `PassTurn` that ends a bout whose throw-ins are done;
   * [[botIdAt]] drops every seat without an engine-accepted move.
   */
  private def throwerSeats(state: GameState): Vector[Int] =
    state.players.indices
      .filter { idx =>
        val seat = state.players(idx)
        idx != state.defenderIdx && seat.isActive
      }
      .sortBy { idx =>
        val seat = state.players(idx)
        (if seat.hasPassed then 1 else 0, idx)
      }
      .toVector

  /** The bot id at `seatIdx` when that seat is a bot with a legal move. */
  private def botIdAt(state: GameState, seatIdx: Int): Option[String] =
    Option
      .when(state.config.isBotSeat(seatIdx))(state.players.lift(seatIdx).map(_.id))
      .flatten
      .filter(playerId => RandomBot.legalActionsFor(state, playerId).nonEmpty)

  /**
   * The move a bot seat plays: [[BasicBot]]'s policy for a `"basicBot"` seat and
   * [[RandomBot]]'s uniform pick for a `"randomBot"` seat. Both bots enumerate the
   * same engine-accepted move set, so the action can be submitted as-is.
   */
  def chooseBotAction(
      state: GameState,
      botId: String,
      rng: scala.util.Random = botRandom
  ): Option[GameAction] =
    val seatIdx = state.players.indexWhere(_.id == botId)
    state.config.seatType(seatIdx) match
      case GameConfig.BasicBotSeat => BasicBot.chooseAction(state, botId, rng)
      case _                       => RandomBot.chooseAction(state, botId, rng)

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
            botDelayFor(room, state, botId) match
              // A random bot plays instantly. Yielding first keeps fiber
              // scheduling fair, so the HTTP and WebSocket handlers of the same
              // runtime are never starved during an all-RandomBot game.
              case None =>
                IO.cede *> room.stateRef.get.flatMap { current =>
                  // Never play for a superseded position, and never after game over.
                  if current != state || current.isGameOver then botLoop(room)
                  else playBotMove(room, current, botId) *> botLoop(room)
                }
              case Some(delay) =>
                IO.sleep(delay).race(awaitStateChange(room, state)).flatMap {
                  case Right(_) => botLoop(room) // the table moved on: reconsider
                  case Left(_) =>
                    room.stateRef.get.flatMap { current =>
                      // Never play for a superseded position, and never after game over.
                      if current != state || current.isGameOver then botLoop(room)
                      else playBotMove(room, current, botId) *> botLoop(room)
                    }
                }
    }

  /** Plays the bot's move for `state`, or waits when the position no longer has one. */
  private def playBotMove(room: GameRoom, state: GameState, botId: String): IO[Unit] =
    chooseBotAction(state, botId) match
      case None         => awaitStateChange(room, state)
      case Some(action) => playBotAction(room, action)

  /**
   * The pause a bot seat takes before it plays. A `"randomBot"` seat returns
   * `None` and therefore plays with no delay at all; a `"basicBot"` seat keeps
   * the room's human-like pause, a random value in `minBotDelay..maxBotDelay`
   * (`500 ms`–`2000 ms` unless the room was constructed with other bounds).
   */
  def botDelayFor(room: GameRoom, state: GameState, botId: String): Option[FiniteDuration] =
    botSeatType(state, botId) match
      case GameConfig.BasicBotSeat => Some(randomBotDelay(room))
      case _                       => None

  /** The canonical seat type of the seat played by `botId` (human when unknown). */
  def botSeatType(state: GameState, botId: String): String =
    val seatIdx = state.players.indexWhere(_.id == botId)
    if seatIdx < 0 then GameConfig.HumanSeat else state.config.seatType(seatIdx)

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
        s"Bot ${actorId(action)} plays ${actionType(action)} in game ${room.gameId}"
      )
    ).void *> applyAction(room, action).void

  private def nowMs: IO[Long] = IO.realTime.map(_.toMillis)
