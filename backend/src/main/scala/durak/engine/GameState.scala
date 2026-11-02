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
  turnDeadlineMs: Long = 0L,     // Epoch ms when the acting player's clock expires (0 = idle)
  presentPlayers: Set[String] = Set.empty, // Human seats that reported an open connection
  // Cards of the most recent bout that ended in a successful defense. Kept as
  // the tail slice of `discardPile`, so no card is ever counted twice.
  lastDiscardCards: Vector[Card] = Vector.empty,
  // Overall game clock: starts on the first move, stops once the game is over.
  gameStartedAtMs: Option[Long] = None,
  gameEndedAtMs: Option[Long] = None
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

  // --- Presence ---

  /**
   * True when the seat is currently present: bots always are, humans are once
   * they report an open connection and until they report otherwise.
   */
  def isPresentSeat(seatIdx: Int): Boolean =
    config.isBotSeat(seatIdx) ||
      players.lift(seatIdx).exists(player => presentPlayers.contains(player.id))

  /** True when `playerId` is a present seat; unknown ids are never present. */
  def isPlayerPresent(playerId: String): Boolean =
    isPresentSeat(players.indexWhere(_.id == playerId))

  /** Ids of every present seat, in seat order. */
  def presentPlayerIds: Vector[String] =
    players.indices.collect { case idx if isPresentSeat(idx) => players(idx).id }.toVector

  // --- Turn clock ---

  /** True while a turn clock is running (it is cleared once the game is over). */
  def hasTurnClock: Boolean = turnDeadlineMs > 0L

  /**
   * True while the table is open to throw-ins from every other active seat:
   * either the defender has surrendered, or every attacking card is already
   * covered and the bout is only waiting for the throwers to pass.
   */
  def isThrowInPhase: Boolean =
    boutPhase == BoutPhase.SurrenderThrowIn ||
      (boutPhase == BoutPhase.Defense &&
        tablePairs.nonEmpty &&
        tablePairs.forall(_.defense.isDefined))

  /**
   * Every seat the game is currently waiting on. Unlike [[turnPlayerIdx]] this
   * can hold several seats at once: during a throw-in phase every active
   * non-defender who may still throw in or pass is on the clock together, so
   * each of them sees the full turn deadline and is auto-passed on expiry.
   */
  def promptedPlayerIds: Set[String] =
    if isGameOver then Set.empty
    else if isThrowInPhase then throwInPlayerIds
    else
      boutPhase match
        case BoutPhase.InitialAttack => players.lift(attackerIdx).map(_.id).toSet
        case BoutPhase.Defense =>
          if tablePairs.isEmpty then players.lift(attackerIdx).map(_.id).toSet
          else if tablePairs.exists(_.defense.isEmpty) then
            players.lift(defenderIdx).map(_.id).toSet
          else Set.empty
        case BoutPhase.SurrenderThrowIn        => throwInPlayerIds
        case BoutPhase.BoutOver | BoutPhase.GameOver => Set.empty

  /** Seats currently on the clock, in seat order. */
  def promptedPlayerSeats: Vector[Int] =
    players.indices.filter(idx => promptedPlayerIds.contains(players(idx).id)).toVector

  /**
   * Active non-defenders with something left to do this bout: they still hold
   * cards, have not passed, and the engine accepts a `PassTurn` for them.
   */
  private def throwInPlayerIds: Set[String] =
    val defenderId = players.lift(defenderIdx).map(_.id)
    players.iterator
      .filter(player => player.isActive && player.hasCards && !player.hasPassed)
      .filterNot(player => defenderId.contains(player.id))
      .map(_.id)
      .filter(id => GameEngine.legalActions(this, id).contains(GameAction.PassTurn(id)))
      .toSet

  /**
   * The seat the clock is waiting on this turn: the attacker while an initial
   * attack is pending, the defender while a defense is pending, and the next
   * non-defender who has not passed during surrender throw-ins.
   */
  def turnPlayerIdx: Option[Int] =
    boutPhase match
      case BoutPhase.InitialAttack => Some(attackerIdx)
      case BoutPhase.Defense       => Some(defenderIdx)
      case BoutPhase.SurrenderThrowIn =>
        players.indices.find(idx =>
          idx != defenderIdx && players(idx).isActive && !players(idx).hasPassed
        )
      case BoutPhase.BoutOver | BoutPhase.GameOver => None

  /** The id of the player the clock is waiting on, if any. */
  def turnPlayerId: Option[String] = turnPlayerIdx.flatMap(players.lift).map(_.id)

  // --- Defense availability ---

  /**
   * True when the defender could reflect the attack onto the next active
   * player: redirects are enabled, nothing on the table is covered yet, the
   * defender holds a card of the attacking rank, and the next player can take
   * the combined attack.
   */
  def canDefenderRedirect: Boolean =
    val combinedSize = tablePairs.size + 1
    val defender = players.lift(defenderIdx)
    val nextDefIdx = nextActivePlayerIdx(defenderIdx)
    val nextDefender = players.lift(nextDefIdx)

    config.allowRedirect &&
      attackerIdx != defenderIdx &&
      tablePairs.nonEmpty &&
      tablePairs.forall(_.defense.isEmpty) &&
      combinedSize <= 6 &&
      defender.exists(_.hand.exists(card => tablePairs.forall(_.attack.rank == card.rank))) &&
      // The attack always moves on: never back to the seat that reflects it,
      // and never to a seat that could not answer the combined attack.
      nextDefIdx != defenderIdx &&
      nextDefender.exists(seat => seat.isActive && seat.hand.size >= combinedSize)

  /**
   * True when the defender is under attack and cannot cover a single uncovered
   * card nor redirect: the only legal defensive move left is to surrender.
   */
  def defenderIsDefenseless: Boolean =
    boutPhase == BoutPhase.Defense &&
      players.lift(defenderIdx).exists { defender =>
        val uncovered = tablePairs.filter(_.defense.isEmpty)
        uncovered.nonEmpty &&
          !uncovered.exists(pair => defender.hand.exists(_.covers(pair.attack, trumpSuit))) &&
          !canDefenderRedirect
      }
