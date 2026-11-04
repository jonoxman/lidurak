package durak.engine

/**
 * A non-viewing player, reduced to public information only.
 *
 * `cards` stays empty in an ordinary live projection. Transparent Mode (and a
 * replay in review mode) fills it with the seat's actual hand, so the table can
 * draw the low-detail suit/rank faces of every player's cards.
 */
case class PublicPlayerSummary(
  id: String,
  name: String,
  cardCount: Int,
  hasPassed: Boolean,
  finishRank: Option[Int],
  status: String = PlayerStatus.Active,
  isTurn: Boolean = false,
  // True while the opponent is connected (bots are always present).
  isPresent: Boolean = false,
  // Revealed hand: only Transparent Mode / review mode ever populates it.
  cards: Vector[Card] = Vector.empty
)

/**
 * The strictly filtered projection of [[GameState]] a single viewer may see:
 * their own hand, public summaries of the other players, and public table and
 * talon information. Opponent hands and the talon order never appear.
 */
case class PlayerGameView(
  myId: String,
  // The viewer's own display name, so the UI can label every seat (POV menu)
  // without falling back to a raw seat id. Defaults to "" for older payloads.
  myName: String = "",
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
  // The viewer's own pass flag and finishing rank, so the PLAYERS list labels
  // the active user exactly like it labels the opponents (ITEM-ADD-8a).
  myHasPassed: Boolean = false,
  myFinishRank: Option[Int] = None,
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
  promptedPlayerIds: Vector[String] = Vector.empty,
  // True when the viewer's seat is played by a computer: it accepts no input.
  isBot: Boolean = false,
  // Canonical seat types ("human", "randomBot", "basicBot") for every seat,
  // so a rematch can seat the same players and bots again.
  playerTypes: Vector[String] = Vector.empty,
  // Match settings the table needs to draw itself.
  allowRedirect: Boolean = true,
  chaosMode: Boolean = false,
  // Transparent Mode: every opponent's `cards` list is populated face-up.
  transparentMode: Boolean = false,
  // Dev Mode: the POV switcher is open during live play. When false the server
  // only allows a mid-game POV switch once the match is over.
  devMode: Boolean = true,
  // Seats the current attacker may aim at. Populated during the initial attack
  // (a single clockwise defender normally, every other seat in Chaos mode).
  eligibleTargetIds: Vector[String] = Vector.empty,
  // The seat a redirect would land on, so the table can point the arrow at it.
  redirectTargetId: Option[String] = None
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
      nowMs: Long = System.currentTimeMillis(),
      // Review mode (the replay viewer of a finished match) reveals every hand,
      // because there is nothing left to protect once the game is over.
      reviewMode: Boolean = false
  ): PlayerGameView =
    val viewerIdx = state.players.indexWhere(_.id == viewerId)
    if viewerIdx == -1 then
      throw new IllegalArgumentException(s"Unknown player: $viewerId")
    val viewer = state.players(viewerIdx)
    val revealHands = state.config.transparentMode || reviewMode
    val prompted = state.promptedPlayerIds
    // A finished game has no turn: its clock and its prompts are always idle,
    // whatever the caller's state was last stamped with.
    val gameOver = state.boutPhase == BoutPhase.GameOver
    // Bots compute their own moves from `GameState`; a client looking at a bot
    // seat must never be offered (or be able to send) a move for it.
    val isBotSeat = state.config.isBotSeat(viewerIdx)

    PlayerGameView(
      myId = viewer.id,
      myName = viewer.name,
      myHand = viewer.hand.toList,
      opponents = state.players.zipWithIndex.collect {
        case (other, idx) if idx != viewerIdx =>
          PublicPlayerSummary(
            id = other.id,
            name = other.name,
            cardCount = other.hand.size,
            hasPassed = other.hasPassed,
            finishRank = finishRankFor(state, other),
            status = other.status,
            isTurn = prompted.contains(other.id),
            isPresent = state.isPresentSeat(idx),
            // Hidden hands never leak outside Transparent Mode / review mode.
            cards = if revealHands then other.hand else Vector.empty
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
      legalActions = if isBotSeat then List.empty else legalActionsFor(state, viewer.id),
      finishOrder = state.finishOrder,
      isDraw = state.isDraw,
      maxBoutAttacks = state.maxBoutAttacks,
      myStatus = viewer.status,
      myHasPassed = viewer.hasPassed,
      myFinishRank = finishRankFor(state, viewer),
      winners = state.winners,
      durak = state.durak,
      turnPlayerId = if gameOver then None else state.turnPlayerId,
      turnDeadlineMs = if gameOver then 0L else state.turnDeadlineMs,
      turnSecondsRemaining = if gameOver then 0 else secondsRemaining(state, nowMs),
      defenderDefenseless = state.defenderIsDefenseless,
      presentPlayers = state.presentPlayerIds,
      discardCount = state.discardPile.size,
      lastDiscardCards = state.lastDiscardCards,
      gameStartedAtMs = state.gameStartedAtMs,
      gameEndedAtMs = state.gameEndedAtMs,
      promptedPlayerIds = state.promptedPlayerSeats.map(idx => state.players(idx).id),
      isBot = isBotSeat,
      playerTypes = GameConfig.normalizePlayerTypes(
        state.players.size,
        state.config.playerTypes
      ),
      allowRedirect = state.config.allowRedirect,
      chaosMode = state.config.chaosMode,
      transparentMode = state.config.transparentMode,
      devMode = state.config.devMode,
      eligibleTargetIds =
        if state.boutPhase == BoutPhase.InitialAttack then
          GameEngine.eligibleInitialTargets(state).map(idx => state.players(idx).id)
        else Vector.empty,
      redirectTargetId = redirectTargetIdFor(state)
    )

  /**
   * A seat's finishing rank, read from `finishOrder`, and only once the seat has
   * no cards left (ITEM-ADD-8b). Any seat still holding cards is projected as
   * unfinished, whatever a stale `finishRank` field says, so the WINNER / OUT /
   * PASSED labels can never contradict the card count shown next to them.
   */
  private def finishRankFor(state: GameState, player: PlayerState): Option[Int] =
    if player.hand.nonEmpty then None
    else
      state.finishOrder.indexOf(player.id) match
        case idx if idx >= 0 => Some(idx + 1)
        case _               => None

  /**
   * The seat the defender's redirect would send the attack to: the single
   * clockwise neighbour in a standard game, the deterministic eligible pick in
   * Chaos mode. Empty whenever a redirect is not on offer.
   */
  private def redirectTargetIdFor(state: GameState): Option[String] =
    if state.boutPhase != BoutPhase.Defense || !state.config.allowRedirect then None
    else
      val targetIdx =
        if state.config.chaosMode then GameEngine.deterministicRedirectTarget(state)
        else GameEngine.eligibleRedirectTargets(state).headOption
      targetIdx.map(idx => state.players(idx).id)

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
