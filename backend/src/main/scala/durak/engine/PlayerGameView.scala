package durak.engine

/** A non-viewing player, reduced to public information only. */
case class PublicPlayerSummary(
  id: String,
  name: String,
  cardCount: Int,
  hasPassed: Boolean,
  finishRank: Option[Int],
  status: String = PlayerStatus.Active,
  isTurn: Boolean = false,
  // True while the opponent is connected (bots are always present).
  isPresent: Boolean = false
)

/**
 * The strictly filtered projection of [[GameState]] a single viewer may see:
 * their own hand, public summaries of the other players, and public table and
 * talon information. Opponent hands and the talon order never appear.
 */
case class PlayerGameView(
  myId: String,
  myHand: List[Card],
  opponents: List[PublicPlayerSummary],
  tablePairs: Vector[TablePair],
  talonCount: Int,
  bottomTrumpCard: Option[Card],
  trumpSuit: Suit,
  attackerIdx: Int,
  defenderIdx: Int,
  boutPhase: BoutPhase,
  legalActions: List[String],
  finishOrder: Vector[String],
  isDraw: Boolean,
  maxBoutAttacks: Int,
  myStatus: String,
  myFinishRank: Option[Int],
  winners: List[String],
  durak: Option[String],
  // Turn clock: absolute epoch-ms deadline (0 when idle) plus a rounded-down view of it.
  turnPlayerId: Option[String] = None,
  turnDeadlineMs: Long = 0L,
  turnSecondsRemaining: Int = 0,
  // True while the defender has no cover and no redirect, so only surrender is legal.
  defenderDefenseless: Boolean = false,
  // Ids of every seat currently present, for the green/grey presence dots.
  presentPlayers: Vector[String] = Vector.empty,
  // Size of the discard pile plus the bout that ended in the last successful defense.
  discardCount: Int = 0,
  lastDiscardCards: Vector[Card] = Vector.empty,
  // Overall game clock: started with the first move and frozen at game over.
  gameStartedAtMs: Option[Long] = None,
  gameEndedAtMs: Option[Long] = None,
  // Every seat the game is waiting on right now (several during a throw-in).
  promptedPlayerIds: Vector[String] = Vector.empty
)

object PlayerGameView:

  /** Canonical ordering of the action identifiers returned in `legalActions`. */
  private val ActionOrder =
    List("attack", "cover", "pass", "surrender", "redirect", "throwIn")

  /**
   * Builds the view for `viewerId`. Their own hand is included; every other
   * player is reduced to a [[PublicPlayerSummary]], and the talon is exposed
   * only as a count plus the (public) bottom trump card.
   */
  def forViewer(
      state: GameState,
      viewerId: String,
      nowMs: Long = System.currentTimeMillis()
  ): PlayerGameView =
    val viewerIdx = state.players.indexWhere(_.id == viewerId)
    if viewerIdx == -1 then
      throw new IllegalArgumentException(s"Unknown player: $viewerId")
    val viewer = state.players(viewerIdx)
    val prompted = state.promptedPlayerIds

    PlayerGameView(
      myId = viewer.id,
      myHand = viewer.hand.toList,
      opponents = state.players.zipWithIndex.collect {
        case (other, idx) if idx != viewerIdx =>
          PublicPlayerSummary(
            id = other.id,
            name = other.name,
            cardCount = other.hand.size,
            hasPassed = other.hasPassed,
            finishRank = other.finishRank,
            status = other.status,
            isTurn = prompted.contains(other.id),
            isPresent = state.isPresentSeat(idx)
          )
      }.toList,
      tablePairs = state.tablePairs,
      talonCount = state.talon.size,
      // The bottom trump is only public while there are still cards to draw.
      bottomTrumpCard = if state.talon.nonEmpty then state.bottomTrumpCard else None,
      trumpSuit = state.trumpSuit,
      attackerIdx = state.attackerIdx,
      defenderIdx = state.defenderIdx,
      boutPhase = state.boutPhase,
      legalActions = legalActionsFor(state, viewer.id),
      finishOrder = state.finishOrder,
      isDraw = state.isDraw,
      maxBoutAttacks = state.maxBoutAttacks,
      myStatus = viewer.status,
      myFinishRank = viewer.finishRank,
      winners = state.winners,
      durak = state.durak,
      turnPlayerId = state.turnPlayerId,
      turnDeadlineMs = state.turnDeadlineMs,
      turnSecondsRemaining = secondsRemaining(state, nowMs),
      defenderDefenseless = state.defenderIsDefenseless,
      presentPlayers = state.presentPlayerIds,
      discardCount = state.discardPile.size,
      lastDiscardCards = state.lastDiscardCards,
      gameStartedAtMs = state.gameStartedAtMs,
      gameEndedAtMs = state.gameEndedAtMs,
      promptedPlayerIds = state.promptedPlayerSeats.map(idx => state.players(idx).id)
    )

  /** Whole seconds left on the turn clock, rounded up and never negative. */
  private def secondsRemaining(state: GameState, nowMs: Long): Int =
    if state.turnDeadlineMs <= 0L then 0
    else Math.max(0L, (state.turnDeadlineMs - nowMs + 999L) / 1000L).toInt

  /**
   * Action ids the engine accepts for this seat right now. Every candidate comes
   * from [[GameEngine.legalActions]], which filters each one through
   * `GameEngine.applyAction(state, viewerId, action)`, so the projection can
   * never advertise a move the engine would reject for this seat (a redirect to
   * itself, a cover of its own attack, any action after a surrender, and so on).
   * A seat with nothing to play — including a surrendering defender — gets an
   * empty list.
   */
  private def legalActionsFor(state: GameState, viewerId: String): List[String] =
    val available = GameEngine.legalActions(state, viewerId).iterator.map(actionId).toSet
    ActionOrder.filter(available.contains)

  /** The wire name of an engine action, as used by `legalActions`. */
  private def actionId(action: GameAction): String =
    action match
      case _: GameAction.InitialAttack    => "attack"
      case _: GameAction.CoverCard        => "cover"
      case _: GameAction.PassTurn         => "pass"
      case _: GameAction.DeclareSurrender => "surrender"
      case _: GameAction.RedirectAttack   => "redirect"
      case _: GameAction.ThrowInCards     => "throwIn"
