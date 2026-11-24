package durak.protocol

import durak.engine.{Card, GameState, PlayerState, Suit, TablePair}

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
    seatIndex: Int = 0
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
 * Anti-cheat invariants enforced by [[PlayerGameView.forViewer]]:
 *   - `hand` is exactly the viewer's own cards, and `Nil` for spectators.
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
    discardCount: Int,
    phase: Option[String],
    attackerIdx: Option[Int],
    defenderIdx: Option[Int],
    maxBoutAttacks: Int,
    finishOrder: Vector[String],
    isDraw: Boolean,
    durakId: Option[String],
    turnDeadlineEpochMs: Option[Long],
    // --- T-95-audit-gap: M1 table fields (public, or the viewer's own) ---
    // The Milestone 1 table needs these to draw itself. Every field below is
    // either public information (ids, counts, the revealed discard) or the
    // viewer's own projection (`legalActions`, `throwInCards`); an opponent's
    // hand and the undealt talon are never reachable from here.
    myName: String = "",
    myHasPassed: Boolean = false,
    myFinishRank: Option[Int] = None,
    winners: Vector[String] = Vector.empty,
    legalActions: Vector[String] = Vector.empty,
    throwInCards: Vector[Card] = Vector.empty,
    throwInCapacity: Int = 0,
    canThrowIn: Boolean = false,
    defenderDefenseless: Boolean = false,
    promptedPlayerIds: Vector[String] = Vector.empty,
    eligibleTargetIds: Vector[String] = Vector.empty,
    redirectTargetId: Option[String] = None,
    turnPlayerId: Option[String] = None,
    turnSecondsRemaining: Int = 0,
    lastDiscardCards: Vector[Card] = Vector.empty,
    gameStartedAtMs: Option[Long] = None,
    gameEndedAtMs: Option[Long] = None
)

object PlayerGameView:

  /**
   * Builds the lobby projection for a room that has not been dealt yet.
   *
   * No cards exist and no game state is consulted: every occupied seat becomes
   * a public summary with `cardCount = 0`, and the viewer only receives their
   * seat index (never a hand).
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
          seatIndex = seat.seatIndex
        )
      }
    }

    PlayerGameView(
      gameId = gameId,
      status = RoomStatus.WaitingForPlayers,
      config = config,
      viewerId = viewerId,
      viewerSeat = viewerSeatOf(seats, viewerId),
      hand = Nil,
      players = playerSummaries,
      seats = projectedSeats,
      tablePairs = Vector.empty,
      talonCount = 0,
      bottomTrumpCard = None,
      trumpSuit = None,
      discardCount = 0,
      phase = None,
      attackerIdx = None,
      defenderIdx = None,
      maxBoutAttacks = 0,
      finishOrder = Vector.empty,
      isDraw = false,
      durakId = None,
      turnDeadlineEpochMs = None
    )

  /**
   * Projects `state` for exactly one viewer.
   *
   * `viewerSeat` is resolved only through `seats`, so a spectator (or an id
   * that is not seated here) can never be mistaken for a player. The hand is
   * copied from that one seat and from no other: there is no code path that
   * can put an opponent's cards into the payload.
   */
  def forViewer(
      gameId: String,
      config: RoomConfigView,
      seats: Vector[RoomSeatView],
      state: GameState,
      viewerId: String,
      connectedPlayerIds: Set[String] = Set.empty,
      turnDeadlineEpochMs: Option[Long] = None,
      ratings: Map[String, Int] = Map.empty,
      nowMs: Long = System.currentTimeMillis()
  ): PlayerGameView =
    val gameOver = state.isGameOver
    val viewerSeat = viewerSeatOf(seats, viewerId)

    // Strictly the viewer's own seat. The extra id check means a mis-stamped
    // seat can only downgrade the viewer to a spectator, never reveal a hand.
    val viewerPlayer =
      viewerSeat
        .flatMap(state.players.lift)
        .filter(_.id == viewerId)
    val hand = viewerPlayer.map(_.hand.toList).getOrElse(Nil)
    // The engine projection of the viewer's own seat is the single source of
    // truth for the action surface (legal actions, throw-in cards, redirect
    // target). It is only ever computed for a seated viewer, and only its
    // own-seat fields are copied below, so it cannot widen what leaks.
    val engineView = viewerPlayer.map(_ => durak.engine.PlayerGameView.forViewer(state, viewerId))

    val publicPlayers = state.players.zipWithIndex.map { case (player, seatIndex) =>
      PublicPlayerSummary(
        id = player.id,
        name = player.name,
        rating = ratings.get(player.id),
        cardCount = player.hand.size,
        isConnected = connectedPlayerIds.contains(player.id),
        hasPassed = player.hasPassed,
        finishRank = finishRankOf(state, player),
        seatIndex = seatIndex
      )
    }

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
      discardCount = state.discardPile.size,
      phase = Some(phaseName(state)),
      attackerIdx = if state.players.nonEmpty then Some(state.attackerIdx) else None,
      defenderIdx = if state.players.nonEmpty then Some(state.defenderIdx) else None,
      maxBoutAttacks = state.maxBoutAttacks,
      finishOrder = state.finishOrder,
      isDraw = state.isDraw,
      durakId = state.durak,
      turnDeadlineEpochMs =
        if gameOver then None else turnDeadlineEpochMs.filter(_ > 0L),
      myName = viewerPlayer.map(_.name).getOrElse(""),
      myHasPassed = viewerPlayer.exists(_.hasPassed),
      myFinishRank = viewerPlayer.flatMap(finishRankOf(state, _)),
      winners = state.winners.toVector,
      legalActions = engineView.map(_.legalActions.toVector).getOrElse(Vector.empty),
      throwInCards = engineView.map(_.throwInCards.toVector).getOrElse(Vector.empty),
      throwInCapacity = engineView.map(_.throwInCapacity).getOrElse(0),
      canThrowIn = engineView.exists(_.canThrowIn),
      defenderDefenseless = engineView.exists(_.defenderDefenseless),
      promptedPlayerIds = state.promptedPlayerSeats.map(idx => state.players(idx).id),
      eligibleTargetIds = engineView.map(_.eligibleTargetIds).getOrElse(Vector.empty),
      redirectTargetId = engineView.flatMap(_.redirectTargetId),
      turnPlayerId = if gameOver then None else state.turnPlayerId,
      turnSecondsRemaining =
        if gameOver then 0
        else
          turnDeadlineEpochMs
            .filter(_ > 0L)
            .map(deadline => Math.max(0L, (deadline - nowMs + 999L) / 1000L).toInt)
            .getOrElse(0),
      lastDiscardCards = state.lastDiscardCards,
      gameStartedAtMs = state.gameStartedAtMs,
      gameEndedAtMs = state.gameEndedAtMs
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
