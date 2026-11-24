package durak.protocol

import durak.engine.{
  BoutPhase,
  Card,
  GameAction,
  GameEngine,
  GameState,
  PlayerState,
  PlayerStatus,
  Suit,
  TablePair
}

/** Where a room currently is in its lifecycle. */
enum RoomStatus:
  case WaitingForPlayers
  case InProgress
  case Finished

object RoomStatus:

  /** Stable lower-camel wire name used by the JSON codecs. */
  def wireName(status: RoomStatus): String = status match
    case WaitingForPlayers => "waitingForPlayers"
    case InProgress        => "inProgress"
    case Finished          => "finished"

  /** Parses either a wire name or the Scala enum name, ignoring case. */
  def fromWire(raw: String): Option[RoomStatus] =
    val normalized = raw.trim
    values.find { status =>
      wireName(status).equalsIgnoreCase(normalized) ||
      status.toString.equalsIgnoreCase(normalized)
    }

/** The public match settings every client is allowed to see. */
final case class RoomConfigView(
    playerCount: Int,
    allowRedirect: Boolean = true,
    turnTimeoutSeconds: Int = 15,
    isPublic: Boolean = true
)

/**
 * A player reduced to public information only.
 *
 * There is deliberately no card list here: every opponent hand must travel
 * through `PlayerGameView.hand` only, and only for its own viewer.
 */
final case class PublicPlayerSummary(
    id: String,
    name: String,
    rating: Option[Int] = None,
    cardCount: Int = 0,
    isConnected: Boolean = false,
    hasPassed: Boolean = false,
    finishRank: Option[Int] = None,
    seatIndex: Int = 0,
    status: String = PlayerStatus.Active,
    isTurn: Boolean = false
)

/** One seat of the lobby, occupied or not. */
final case class RoomSeatView(
    seatIndex: Int,
    playerId: Option[String] = None,
    displayName: Option[String] = None,
    isConnected: Boolean = false
)

/**
 * The strictly filtered projection of a room that a single viewer may receive.
 *
 * It carries every public and viewer-safe field the full Milestone 1 gameplay
 * table needs (legal actions, throw-in eligibility, targets, discard history,
 * turn/game clocks, finish order, winners, durak and prompt state) while the
 * anti-cheat invariants stay enforced by [[PlayerGameView.forViewer]]:
 *   - `hand` is exactly the viewer's own cards, and `Nil` for spectators.
 *   - `legalActions`, `throwInCards`, `throwInCapacity` and `canThrowIn` are
 *     computed for the viewer's own seat only, and stay empty/false for
 *     spectators.
 *   - `players` carries public counts and status only (never cards).
 *   - the hidden talon is only a count, plus the face-up bottom trump card
 *     while the talon still has cards.
 *   - no raw `GameState` is reachable from this type.
 */
final case class PlayerGameView(
    gameId: String,
    status: RoomStatus,
    config: RoomConfigView,
    viewerId: String,
    viewerSeat: Option[Int],
    hand: List[Card],
    players: Vector[PublicPlayerSummary],
    seats: Vector[RoomSeatView],
    tablePairs: Vector[TablePair],
    talonCount: Int,
    bottomTrumpCard: Option[Card],
    trumpSuit: Option[Suit],
    attackerIdx: Option[Int],
    defenderIdx: Option[Int],
    boutPhase: Option[String],
    maxBoutAttacks: Int,
    legalActions: List[String] = Nil,
    finishOrder: Vector[String] = Vector.empty,
    isDraw: Boolean = false,
    winners: List[String] = Nil,
    durak: Option[String] = None,
    turnPlayerId: Option[String] = None,
    turnDeadlineMs: Long = 0L,
    turnSecondsRemaining: Int = 0,
    defenderDefenseless: Boolean = false,
    promptedPlayerIds: Vector[String] = Vector.empty,
    discardCount: Int = 0,
    lastDiscardCards: Vector[Card] = Vector.empty,
    gameStartedAtMs: Option[Long] = None,
    gameEndedAtMs: Option[Long] = None,
    eligibleTargetIds: Vector[String] = Vector.empty,
    redirectTargetId: Option[String] = None,
    throwInCards: List[Card] = Nil,
    throwInCapacity: Int = 0,
    canThrowIn: Boolean = false,
    myHasPassed: Boolean = false,
    myFinishRank: Option[Int] = None,
    myStatus: String = PlayerStatus.Active
)

object PlayerGameView:

  /** Canonical ordering of the action identifiers returned in `legalActions`. */
  private val ActionOrder: List[String] =
    List("attack", "cover", "pass", "surrender", "redirect", "throwIn")

  /**
   * Builds the lobby projection for a room that has not been dealt yet.
   *
   * No cards exist and no game state is consulted: every occupied seat becomes
   * a public summary with `cardCount = 0`, and the viewer only receives their
   * seat index (never a hand). Every gameplay field is idle, and the
   * viewer-scoped action lists are empty.
   */
  def forWaitingRoom(
      gameId: String,
      config: RoomConfigView,
      seats: Vector[RoomSeatView],
      viewerId: String,
      connectedPlayerIds: Set[String] = Set.empty,
      ratings: Map[String, Int] = Map.empty
  ): PlayerGameView =
    val projectedSeats = withPresence(seats, connectedPlayerIds)
    val playerSummaries = projectedSeats.flatMap { seat =>
      seat.playerId.map { playerId =>
        PublicPlayerSummary(
          id = playerId,
          name = seat.displayName.getOrElse(playerId),
          rating = ratings.get(playerId),
          cardCount = 0,
          isConnected = seat.isConnected,
          hasPassed = false,
          finishRank = None,
          seatIndex = seat.seatIndex,
          status = PlayerStatus.Active,
          isTurn = false
        )
      }
    }
    val viewerSeat = viewerSeatOf(seats, viewerId)

    PlayerGameView(
      gameId = gameId,
      status = RoomStatus.WaitingForPlayers,
      config = config,
      viewerId = viewerId,
      viewerSeat = viewerSeat,
      hand = Nil,
      players = playerSummaries,
      seats = projectedSeats,
      tablePairs = Vector.empty,
      talonCount = 0,
      bottomTrumpCard = None,
      trumpSuit = None,
      attackerIdx = None,
      defenderIdx = None,
      boutPhase = None,
      maxBoutAttacks = 0,
      // No match exists yet, so no viewer-scoped move is ever on offer.
      legalActions = Nil,
      finishOrder = Vector.empty,
      isDraw = false,
      winners = Nil,
      durak = None,
      turnPlayerId = None,
      turnDeadlineMs = 0L,
      turnSecondsRemaining = 0,
      defenderDefenseless = false,
      promptedPlayerIds = Vector.empty,
      discardCount = 0,
      lastDiscardCards = Vector.empty,
      gameStartedAtMs = None,
      gameEndedAtMs = None,
      eligibleTargetIds = Vector.empty,
      redirectTargetId = None,
      throwInCards = Nil,
      throwInCapacity = 0,
      canThrowIn = false,
      myHasPassed = false,
      myFinishRank = None,
      myStatus = if viewerSeat.nonEmpty then PlayerStatus.Active else ""
    )

  /**
   * Projects `state` for exactly one viewer.
   *
   * `viewerSeat` is resolved only through `seats`, so a spectator (or an id
   * that is not seated here) can never be mistaken for a player. The hand is
   * copied from that one seat and from no other: there is no code path that
   * can put an opponent's cards into the payload. Every viewer-scoped action
   * list is likewise derived from that single seat, and is empty for a
   * spectator.
   *
   * `turnDeadlineMs` is the absolute epoch-ms deadline the room maintains; the
   * whole-second countdown is computed from `nowMs` so it counts down on every
   * read.
   */
  def forViewer(
      gameId: String,
      config: RoomConfigView,
      seats: Vector[RoomSeatView],
      state: GameState,
      viewerId: String,
      connectedPlayerIds: Set[String] = Set.empty,
      turnDeadlineMs: Option[Long] = None,
      ratings: Map[String, Int] = Map.empty,
      nowMs: Long = System.currentTimeMillis()
  ): PlayerGameView =
    val gameOver = state.isGameOver
    val viewerSeat = viewerSeatOf(seats, viewerId)

    // Strictly the viewer's own seat. The extra id check means a mis-stamped
    // seat can only downgrade the viewer to a spectator, never reveal a hand.
    val viewer =
      viewerSeat
        .flatMap(state.players.lift)
        .filter(_.id == viewerId)

    val hand = viewer.map(_.hand.toList).getOrElse(Nil)

    val publicPlayers = state.players.zipWithIndex.map { case (player, seatIndex) =>
      PublicPlayerSummary(
        id = player.id,
        name = player.name,
        rating = ratings.get(player.id),
        cardCount = player.hand.size,
        isConnected = connectedPlayerIds.contains(player.id),
        hasPassed = player.hasPassed,
        finishRank = finishRankOf(state, player),
        seatIndex = seatIndex,
        status = player.status,
        isTurn = !gameOver && state.promptedPlayerIds.contains(player.id)
      )
    }

    // Throw-in eligibility is the engine's own answer, never a re-derivation:
    // a card is offered only when `ThrowInCards(viewer, List(card))` is
    // accepted right now. Spectators never receive any of it.
    val throwInCards =
      if gameOver then Nil
      else
        viewer
          .map { player =>
            GameEngine
              .legalThrowInCards(state, player.id)
              .filter(card =>
                GameEngine
                  .applyAction(
                    state,
                    player.id,
                    GameAction.ThrowInCards(player.id, List(card))
                  )
                  .isRight
              )
          }
          .getOrElse(Nil)
    val throwInCapacity =
      if throwInCards.isEmpty then 0
      else viewer.map(player => GameEngine.throwInCapacity(state, player.id)).getOrElse(0)

    val activeDeadline =
      if gameOver then 0L else turnDeadlineMs.filter(_ > 0L).getOrElse(0L)

    PlayerGameView(
      gameId = gameId,
      status = if gameOver then RoomStatus.Finished else RoomStatus.InProgress,
      config = config,
      viewerId = viewerId,
      viewerSeat = viewerSeat,
      hand = hand,
      players = publicPlayers,
      seats = withPresence(seats, connectedPlayerIds),
      tablePairs = state.tablePairs,
      talonCount = state.talon.size,
      // The bottom trump stays public only while cards can still be drawn.
      bottomTrumpCard = if state.talon.nonEmpty then state.bottomTrumpCard else None,
      // The trump suit is public knowledge from the deal onwards.
      trumpSuit = Some(state.trumpSuit),
      attackerIdx = if state.players.nonEmpty then Some(state.attackerIdx) else None,
      defenderIdx = if state.players.nonEmpty then Some(state.defenderIdx) else None,
      boutPhase = Some(phaseName(state)),
      maxBoutAttacks = state.maxBoutAttacks,
      // Legal actions are derived for the viewer's own seat only: a spectator
      // (or an unseated id) is offered nothing.
      legalActions = viewer.map(player => legalActionIdsFor(state, player.id)).getOrElse(Nil),
      finishOrder = state.finishOrder,
      isDraw = state.isDraw,
      winners = state.winners,
      durak = state.durak,
      turnPlayerId = if gameOver then None else state.turnPlayerId,
      turnDeadlineMs = activeDeadline,
      turnSecondsRemaining = secondsRemaining(activeDeadline, nowMs),
      defenderDefenseless = state.defenderIsDefenseless,
      promptedPlayerIds = state.promptedPlayerSeats.map(idx => state.players(idx).id),
      discardCount = state.discardPile.size,
      lastDiscardCards = state.lastDiscardCards,
      gameStartedAtMs = state.gameStartedAtMs,
      gameEndedAtMs = state.gameEndedAtMs,
      // Public targeting metadata: empty for spectators, so no seat-scoped
      // affordance is ever offered to someone who cannot act.
      eligibleTargetIds =
        if viewer.isEmpty then Vector.empty
        else if state.boutPhase == BoutPhase.InitialAttack then
          GameEngine.eligibleInitialTargets(state).map(idx => state.players(idx).id)
        else Vector.empty,
      redirectTargetId = if viewer.isEmpty then None else redirectTargetIdFor(state),
      throwInCards = throwInCards,
      throwInCapacity = throwInCapacity,
      canThrowIn = throwInCards.nonEmpty && throwInCapacity > 0,
      myHasPassed = viewer.exists(_.hasPassed),
      myFinishRank = viewer.flatMap(player => finishRankOf(state, player)),
      myStatus = viewer.map(_.status).getOrElse("")
    )

  /** Resolves a viewer's seat from the lobby seats, never from game state. */
  private def viewerSeatOf(seats: Vector[RoomSeatView], viewerId: String): Option[Int] =
    seats.find(_.playerId.contains(viewerId)).map(_.seatIndex)

  /** Recomputes connection flags from the live socket registry. */
  private def withPresence(
      seats: Vector[RoomSeatView],
      connectedPlayerIds: Set[String]
  ): Vector[RoomSeatView] =
    seats.map(seat =>
      seat.copy(isConnected = seat.playerId.exists(connectedPlayerIds.contains))
    )

  /**
   * A seat's 1-based finishing place, read from `finishOrder`. A seat that
   * still holds cards is never ranked, whatever the order contains, so the
   * public label can never contradict the card count next to it.
   */
  private def finishRankOf(state: GameState, player: PlayerState): Option[Int] =
    if player.hand.nonEmpty then None
    else
      state.finishOrder.indexOf(player.id) match
        case idx if idx >= 0 => Some(idx + 1)
        case _               => None

  /** Lower-camel phase name used by the wire contract. */
  private def phaseName(state: GameState): String =
    val raw = state.boutPhase.toString
    if raw.isEmpty then raw else s"${raw.head.toLower}${raw.tail}"

  /** Whole seconds left on the turn clock, rounded up and never negative. */
  private def secondsRemaining(deadlineMs: Long, nowMs: Long): Int =
    if deadlineMs <= 0L then 0
    else Math.max(0L, (deadlineMs - nowMs + 999L) / 1000L).toInt

  /**
   * Action ids the engine accepts for this seat right now. Every candidate
   * comes from [[GameEngine.legalActions]], which filters each one through
   * `GameEngine.applyAction(state, viewerId, action)`, so the projection can
   * never advertise a move the engine would reject for this seat.
   */
  private def legalActionIdsFor(state: GameState, viewerId: String): List[String] =
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
