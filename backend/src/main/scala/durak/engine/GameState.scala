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

  /** True once the game has reached its final state. */
  def isGameOver: Boolean = boutPhase == BoutPhase.GameOver

  /**
   * The last player still holding cards once the game is over, i.e. the Durak.
   * `None` while the game is still running, and `None` for a draw (the final
   * players emptied their hands at the same time, so nobody is last).
   */
  def durak: Option[String] =
    if !isGameOver || isDraw then None
    else
      finishOrder.lastOption.filter { id =>
        players.exists(player => player.id == id && player.hasCards)
      }

  /**
   * Players who finished ahead of the Durak, in the order they went out (first
   * out = 1st place). While the game is still running this is every finisher
   * so far; for a draw every finisher is a winner.
   */
  def winners: List[String] =
    durak match
      case Some(lastPlace) => finishOrder.filterNot(_ == lastPlace).toList
      case None            => finishOrder.toList

  /**
   * Next seat clockwise from `fromIdx` that is still part of the turn rotation,
   * wrapping around. Finished players are always skipped; once the talon is
   * depleted a player with no cards left can no longer attack or defend either.
   */
  def nextActivePlayerIdx(fromIdx: Int): Int =
    val n = players.size
    if n == 0 then fromIdx
    else
      val start = Math.floorMod(fromIdx, n)
      (1 until n)
        .map(offset => (start + offset) % n)
        .find(idx => isInRotation(players(idx)))
        .getOrElse(start)

  /** True while the player may still be handed the attack or the defense. */
  private def isInRotation(player: PlayerState): Boolean =
    player.isActive && (talon.nonEmpty || player.hasCards)
