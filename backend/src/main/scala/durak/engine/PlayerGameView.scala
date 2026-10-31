package durak.engine

/** A non-viewing player, reduced to public information only. */
case class PublicPlayerSummary(
  id: String,
  name: String,
  cardCount: Int,
  hasPassed: Boolean,
  finishRank: Option[Int],
  status: String = PlayerStatus.Active
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
  durak: Option[String]
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
  def forViewer(state: GameState, viewerId: String): PlayerGameView =
    val viewerIdx = state.players.indexWhere(_.id == viewerId)
    if viewerIdx == -1 then
      throw new IllegalArgumentException(s"Unknown player: $viewerId")
    val viewer = state.players(viewerIdx)

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
            status = other.status
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
      legalActions = legalActionsFor(state, viewer, viewerIdx),
      finishOrder = state.finishOrder,
      isDraw = state.isDraw,
      maxBoutAttacks = state.maxBoutAttacks,
      myStatus = viewer.status,
      myFinishRank = viewer.finishRank,
      winners = state.winners,
      durak = state.durak
    )

  private def legalActionsFor(
      state: GameState,
      viewer: PlayerState,
      viewerIdx: Int
  ): List[String] =
    val available = availableActions(state, viewer, viewerIdx)
    ActionOrder.filter(available.contains)

  private def availableActions(
      state: GameState,
      viewer: PlayerState,
      viewerIdx: Int
  ): Set[String] =
    if !viewer.isActive then Set.empty
    else
      state.boutPhase match
        case BoutPhase.InitialAttack =>
          val isAttacker = viewerIdx == state.attackerIdx
          if isAttacker && viewer.hasCards && state.maxBoutAttacks > 0 then Set("attack")
          else Set.empty
        case BoutPhase.Defense =>
          if viewerIdx == state.defenderIdx then
            Set(
              Option.when(canCoverAny(state, viewer))("cover"),
              Option.when(canRedirect(state, viewer))("redirect"),
              Option.when(state.tablePairs.exists(_.defense.isEmpty))("surrender")
            ).flatten
          else
            Set(
              Option.when(canPassDefense(state, viewer))("pass"),
              Option.when(canThrowIn(state, viewer))("throwIn")
            ).flatten
        case BoutPhase.SurrenderThrowIn =>
          if viewerIdx == state.defenderIdx then Set.empty
          else
            Set(
              Option.when(!viewer.hasPassed)("pass"),
              Option.when(canThrowIn(state, viewer))("throwIn")
            ).flatten
        case BoutPhase.BoutOver | BoutPhase.GameOver =>
          Set.empty

  /** True when at least one uncovered attack can be covered from this hand. */
  private def canCoverAny(state: GameState, defender: PlayerState): Boolean =
    state.tablePairs.exists { pair =>
      pair.defense.isEmpty &&
      defender.hand.exists(card => isLegalCover(pair.attack, card, state.trumpSuit))
    }

  /** True when a single-card redirect is legal right now. */
  private def canRedirect(state: GameState, defender: PlayerState): Boolean =
    val nextDefIdx = state.nextActivePlayerIdx(state.defenderIdx)
    val nextDefender = state.players.lift(nextDefIdx)
    state.config.allowRedirect &&
    state.tablePairs.nonEmpty &&
    state.tablePairs.forall(_.defense.isEmpty) &&
    state.tablePairs.size + 1 <= 6 &&
    defender.hand.exists(card => state.tablePairs.forall(_.attack.rank == card.rank)) &&
    nextDefender.exists(_.hand.size >= state.tablePairs.size + 1)

  /** Passing is only possible once the table is covered or the bout is full. */
  private def canPassDefense(state: GameState, player: PlayerState): Boolean =
    !player.hasPassed &&
      (state.tablePairs.forall(_.defense.isDefined) ||
        state.tablePairs.size >= state.maxBoutAttacks)

  /** True when this player could add at least one card matching the table. */
  private def canThrowIn(state: GameState, player: PlayerState): Boolean =
    val tableRanks = state.tablePairs
      .flatMap(pair => pair.attack.rank :: pair.defense.map(_.rank).toList)
      .toSet
    val defenderCanCover =
      state.boutPhase != BoutPhase.Defense ||
        state.players(state.defenderIdx).hand.size >
          state.tablePairs.count(_.defense.isEmpty)
    tableRanks.nonEmpty &&
    player.hand.exists(card => tableRanks.contains(card.rank)) &&
    state.tablePairs.size < state.maxBoutAttacks &&
    defenderCanCover

  /** Legal cover: same suit with a higher rank, or a trump against a non-trump. */
  private def isLegalCover(attack: Card, defense: Card, trumpSuit: Suit): Boolean =
    (defense.suit == attack.suit && defense.rank.value > attack.rank.value) ||
      (defense.suit == trumpSuit && attack.suit != trumpSuit)
