package durak.engine

case class GameState(
  config: GameConfig,
  players: Vector[PlayerState],
  talon: Vector[Card],          // Remaining draw pile (hidden)
  trumpSuit: Suit,
  bottomTrumpCard: Option[Card], // Last card of talon, shown face-up
  discardPile: Vector[Card],
  tablePairs: Vector[TablePair],
  attackerIdx: Int,
  defenderIdx: Int,
  boutPhase: BoutPhase,
  defenderInitialHandSize: Int,
  finishOrder: Vector[String],   // Player IDs in order of finishing
  isDraw: Boolean = false,
  /**
   * Absolute epoch-millisecond deadline of the current turn's 15-second clock.
   * `0` means no clock is running (idle table, between bouts).
   */
  turnDeadlineMs: Long = 0L
):

  /** Players still in the game (have not finished). */
  def activePlayers: Vector[PlayerState] =
    players.filter(_.finishRank.isEmpty)

  /** Active players that still hold cards. */
  def activePlayersWithCards: Vector[PlayerState] =
    activePlayers.filter(_.hand.nonEmpty)

  /** True when this game runs the "Chaos Mode" variant. */
  def chaosMode: Boolean = config.chaosMode

  /** Maximum number of attacking cards allowed in the current bout. */
  def maxBoutAttacks: Int =
    Math.min(6, defenderInitialHandSize)

  /** Next seat clockwise from `fromIdx` that is still active, wrapping around. */
  def nextActivePlayerIdx(fromIdx: Int): Int =
    val n = players.size
    if n == 0 then fromIdx
    else
      val start = Math.floorMod(fromIdx, n)
      (1 until n)
        .map(offset => (start + offset) % n)
        .find(idx => players(idx).finishRank.isEmpty)
        .getOrElse(start)

  /**
   * Seats that may receive a redirect and hold at least `requiredCards` cards.
   * Chaos mode offers every active player except the redirecting one; the
   * standard rules only ever offer the next active seat clockwise.
   */
  def redirectTargets(excludeIdx: Int, requiredCards: Int): Vector[Int] =
    if config.chaosMode then
      players.indices
        .filter(idx =>
          idx != excludeIdx && players(idx).isActive && players(idx).hand.size >= requiredCards
        )
        .toVector
    else
      val nextIdx = nextActivePlayerIdx(excludeIdx)
      val eligible =
        nextIdx != excludeIdx &&
          players(nextIdx).isActive &&
          players(nextIdx).hand.size >= requiredCards
      if eligible then Vector(nextIdx) else Vector.empty

  /** True while a turn clock is running. */
  def hasRunningClock: Boolean =
    turnDeadlineMs > 0

  /** True once `nowMs` has reached the current turn's deadline. */
  def isTurnExpired(nowMs: Long): Boolean =
    turnDeadlineMs > 0 && nowMs >= turnDeadlineMs

  /**
   * Whole seconds left on the turn clock, clamped to `0..15`. An idle table
   * reports the full 15 seconds; a finished game reports 0.
   */
  def turnSecondsRemaining(nowMs: Long): Int =
    if boutPhase == BoutPhase.GameOver then 0
    else if turnDeadlineMs <= 0 then GameState.TurnDurationSeconds
    else
      val remaining = turnDeadlineMs - nowMs
      if remaining <= 0 then 0
      else Math.min(GameState.TurnDurationSeconds, Math.ceil(remaining.toDouble / 1000.0).toInt)

object GameState:

  /** Length of one turn on the 15-second clock. */
  val TurnDurationMs: Long = 15000L

  /** The same duration in whole seconds, used for display. */
  val TurnDurationSeconds: Int = 15
