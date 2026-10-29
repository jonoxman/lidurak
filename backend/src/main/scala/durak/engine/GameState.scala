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
  isDraw: Boolean = false
):

  /** Players still in the game (have not finished). */
  def activePlayers: Vector[PlayerState] =
    players.filter(_.finishRank.isEmpty)

  /** Active players that still hold cards. */
  def activePlayersWithCards: Vector[PlayerState] =
    activePlayers.filter(_.hand.nonEmpty)

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
