package durak.engine

import scala.util.Random

object GameEngine:

  /** Cards dealt to every player at the start of the game. */
  private val InitialHandSize = 6

  /**
   * Creates a fully initialized game: shuffled deck, hands, talon with the
   * revealed bottom trump, trump suit, and the first attacker/defender pair.
   */
  def createGame(config: GameConfig, playerNames: Vector[String]): GameState =
    createGameAt(config, playerNames, nowMs = 0L)

  /**
   * Creates a game whose turn clock is already running: it gives the opening
   * attacker a full 15 seconds starting at `nowMs`.
   */
  def createGameAt(config: GameConfig, playerNames: Vector[String], nowMs: Long): GameState =
    validate(config, playerNames)

    val playerCount = config.playerCount
    val random = new Random(config.seed)
    val shuffled = random.shuffle(Deck.forPlayerCount(playerCount))

    val players = playerNames.zipWithIndex.map { case (name, idx) =>
      PlayerState(
        id = s"p$idx",
        name = name,
        hand = shuffled.slice(idx * InitialHandSize, (idx + 1) * InitialHandSize)
      )
    }

    val remaining = shuffled.drop(playerCount * InitialHandSize)
    if remaining.isEmpty then
      throw new IllegalStateException(
        s"Deck too small to reveal a bottom trump card for $playerCount players"
      )

    // The first card left after dealing is revealed; it becomes the last card drawn.
    val bottomTrumpCard = remaining.head
    val talon = remaining.tail :+ bottomTrumpCard
    val trumpSuit = bottomTrumpCard.suit

    val attackerIdx = selectFirstAttacker(players, trumpSuit)
    val defenderIdx = (attackerIdx + 1) % playerCount

    GameState(
      config = config,
      players = players,
      talon = talon,
      trumpSuit = trumpSuit,
      bottomTrumpCard = Some(bottomTrumpCard),
      discardPile = Vector.empty,
      tablePairs = Vector.empty,
      attackerIdx = attackerIdx,
      defenderIdx = defenderIdx,
      boutPhase = BoutPhase.InitialAttack,
      defenderInitialHandSize = players(defenderIdx).hand.size,
      finishOrder = Vector.empty,
      turnDeadlineMs = if nowMs > 0 then nowMs + GameState.TurnDurationMs else 0L
    )

  /**
   * Applies a player action to the game state without touching the turn clock.
   *
   * Returns `Left(error)` when the move is illegal, leaving the caller's state
   * untouched, or `Right(newState)` for a legal move.
   */
  def applyAction(state: GameState, action: GameAction): Either[String, GameState] =
    transition(state, action)

  /**
   * Applies an action and restarts the 15-second turn clock at `nowMs`.
   * The server uses this so every accepted move gives the next player a full
   * turn; pure engine calls keep the stored deadline untouched.
   */
  def applyActionAt(
      state: GameState,
      action: GameAction,
      nowMs: Long
  ): Either[String, GameState] =
    transition(state, action).map(next => resetTurnClock(next, nowMs))

  /** Restarts (or clears, on game over) the turn clock at `nowMs`. */
  def resetTurnClock(state: GameState, nowMs: Long): GameState =
    if state.boutPhase == BoutPhase.GameOver then state.copy(turnDeadlineMs = 0L)
    else state.copy(turnDeadlineMs = nowMs + GameState.TurnDurationMs)

  private def transition(state: GameState, action: GameAction): Either[String, GameState] =
    action match
      case GameAction.InitialAttack(playerId, cards, targetDefender) =>
        applyInitialAttack(state, playerId, cards, targetDefender)
      case GameAction.CoverCard(playerId, attackIndex, defenseCard) =>
        applyCoverCard(state, playerId, attackIndex, defenseCard)
      case GameAction.RedirectAttack(playerId, cards) =>
        applyRedirectAttack(state, playerId, cards)
      case GameAction.DeclareSurrender(playerId) =>
        applyDeclareSurrender(state, playerId)
      case GameAction.ThrowInCards(playerId, cards) =>
        applyThrowInCards(state, playerId, cards)
      case GameAction.PassTurn(playerId) =>
        applyPassTurn(state, playerId)
      case other =>
        Left(s"Unsupported action: $other")

  private def applyInitialAttack(
      state: GameState,
      playerId: String,
      cards: List[Card],
      targetDefender: Option[String]
  ): Either[String, GameState] =
    for
      _ <- check(
        state.boutPhase == BoutPhase.InitialAttack,
        s"Cannot attack during ${state.boutPhase} phase"
      )
      attacker <- state.players.lift(state.attackerIdx).toRight("Invalid attacker seat")
      _ <- check(attacker.id == playerId, s"$playerId is not the attacker")
      _ <- check(cards.nonEmpty, "An initial attack must contain at least one card")
      remainingHand <- removeCards(attacker.hand, cards)
        .toRight("Attack contains cards that are not in the attacker's hand")
      _ <- check(
        cards.map(_.rank).distinct.size == 1,
        "All cards in an initial attack must share the same rank"
      )
      defenderIdx <- resolveInitialDefender(state, attacker, targetDefender)
      // Standard boutes use the recorded capacity; a chaos target resets it.
      boutCapacity =
        if state.chaosMode then Math.min(6, state.players(defenderIdx).hand.size)
        else state.maxBoutAttacks
      _ <- check(
        cards.size <= boutCapacity,
        s"An initial attack may contain at most $boutCapacity cards against this defender"
      )
    yield
      state.copy(
        players = state.players.updated(state.attackerIdx, attacker.copy(hand = remainingHand)),
        tablePairs = state.tablePairs ++ cards.map(card => TablePair(card)),
        // The bout belongs to the chosen defender; throw-ins keep targeting them.
        defenderIdx = defenderIdx,
        defenderInitialHandSize =
          if state.chaosMode then state.players(defenderIdx).hand.size
          else state.defenderInitialHandSize,
        boutPhase = BoutPhase.Defense
      )

  /**
   * Resolves who defends the opening attack. Standard rules always use the next
   * active seat clockwise; chaos mode lets the attacker name any active player
   * holding cards (defaulting to the next clockwise seat).
   */
  private def resolveInitialDefender(
      state: GameState,
      attacker: PlayerState,
      targetDefender: Option[String]
  ): Either[String, Int] =
    val naturalIdx = state.nextActivePlayerIdx(state.attackerIdx)
    if !state.chaosMode then
      targetDefender match
        case None => Right(naturalIdx)
        case Some(id) =>
          val idx = state.players.indexWhere(_.id == id)
          if idx == naturalIdx then Right(idx)
          else Left("Targeting a specific defender requires chaos mode")
    else
      val candidates = chaosDefenderCandidates(state)
      targetDefender match
        case Some(id) =>
          val idx = state.players.indexWhere(_.id == id)
          if idx == -1 then Left(s"Unknown player: $id")
          else if idx == state.attackerIdx then Left("The attacker cannot defend their own attack")
          else if !state.players(idx).isActive then Left(s"$id has already finished the game")
          else if !state.players(idx).hasCards then Left(s"$id has no cards to defend with")
          else Right(idx)
        case None =>
          if candidates.contains(naturalIdx) then Right(naturalIdx)
          else candidates.headOption.toRight("No active player has cards to defend this attack")

  /** Seats a chaos-mode attacker may target: active, holding cards, not the attacker. */
  private def chaosDefenderCandidates(state: GameState): Vector[Int] =
    state.players.indices
      .filter(idx =>
        idx != state.attackerIdx && state.players(idx).isActive && state.players(idx).hasCards
      )
      .toVector

  private def applyCoverCard(
      state: GameState,
      playerId: String,
      attackIndex: Int,
      defenseCard: Card
  ): Either[String, GameState] =
    for
      _ <- check(
        state.boutPhase == BoutPhase.Defense,
        s"Cannot cover cards during ${state.boutPhase} phase"
      )
      defender <- state.players.lift(state.defenderIdx).toRight("Invalid defender seat")
      _ <- check(defender.id == playerId, s"$playerId is not the defender")
      remainingHand <- removeCards(defender.hand, List(defenseCard))
        .toRight("Covering card is not in the defender's hand")
      pair <- state.tablePairs.lift(attackIndex).toRight(
        s"Attack index $attackIndex is out of range"
      )
      _ <- check(pair.defense.isEmpty, s"Attack at index $attackIndex is already covered")
      _ <- check(
        isLegalCover(pair.attack, defenseCard, state.trumpSuit),
        s"$defenseCard cannot cover ${pair.attack}"
      )
    yield
      state.copy(
        players = state.players.updated(state.defenderIdx, defender.copy(hand = remainingHand)),
        tablePairs = state.tablePairs.updated(attackIndex, pair.copy(defense = Some(defenseCard)))
      )

  /**
   * Defender reflects the attack onto the next active player clockwise.
   * The redirected cards join the table uncovered, and the roles rotate.
   */
  private def applyRedirectAttack(
      state: GameState,
      playerId: String,
      cards: List[Card]
  ): Either[String, GameState] =
    for
      _ <- check(
        state.boutPhase == BoutPhase.Defense,
        s"Cannot redirect during ${state.boutPhase} phase"
      )
      _ <- check(state.config.allowRedirect, "Redirecting is disabled in this game")
      defender <- state.players.lift(state.defenderIdx).toRight("Invalid defender seat")
      _ <- check(defender.id == playerId, s"$playerId is not the defender")
      _ <- check(
        state.tablePairs.forall(_.defense.isEmpty),
        "Cannot redirect once any card on the table is covered"
      )
      _ <- check(cards.nonEmpty, "A redirect must contain at least one card")
      remainingHand <- removeCards(defender.hand, cards)
        .toRight("Redirect contains cards that are not in the defender's hand")
      _ <- check(
        state.tablePairs.nonEmpty,
        "Cannot redirect when there is no attack on the table"
      )
      _ <- check(
        cards.map(_.rank).distinct.size == 1 &&
          state.tablePairs.forall(_.attack.rank == cards.head.rank),
        "Redirect cards must share the rank of the attacking cards on the table"
      )
      _ <- check(
        state.tablePairs.size + cards.size <= 6,
        "A redirect may not grow the attack beyond 6 cards"
      )
      nextDefIdx <- chooseRedirectTarget(state, cards.size)
    yield
      val players = state.players
        .updated(state.defenderIdx, defender.copy(hand = remainingHand))
        .map(_.copy(hasPassed = false))
      state.copy(
        players = players,
        tablePairs = state.tablePairs ++ cards.map(card => TablePair(card)),
        attackerIdx = state.defenderIdx,
        defenderIdx = nextDefIdx,
        defenderInitialHandSize = players(nextDefIdx).hand.size
      )

  /**
   * Picks the seat that receives a redirect: the next clockwise active player
   * under the standard rules, or a random eligible player in chaos mode.
   */
  private def chooseRedirectTarget(state: GameState, redirectCards: Int): Either[String, Int] =
    val required = state.tablePairs.size + redirectCards
    val candidates = state.redirectTargets(state.defenderIdx, required)
    if candidates.isEmpty then
      Left("No active player has enough cards to defend the redirected attack")
    else if state.chaosMode then
      Right(candidates(chaosRandom(state).nextInt(candidates.size)))
    else Right(candidates.head)

  /**
   * Defender gives up on the current bout. Throw-ins stay open to every other
   * active player, and players who cannot add anything are passed immediately.
   */
  private def applyDeclareSurrender(
      state: GameState,
      playerId: String
  ): Either[String, GameState] =
    for
      _ <- check(
        state.boutPhase == BoutPhase.Defense,
        s"Cannot surrender during ${state.boutPhase} phase"
      )
      defender <- state.players.lift(state.defenderIdx).toRight("Invalid defender seat")
      _ <- check(defender.id == playerId, s"$playerId is not the defender")
      _ <- check(
        state.tablePairs.exists(_.defense.isEmpty),
        "Cannot surrender when every attacking card is already covered"
      )
    yield
      val boutIsFull = state.tablePairs.size >= state.maxBoutAttacks
      val players = state.players.zipWithIndex.map { case (player, idx) =>
        if idx == state.defenderIdx || player.finishRank.nonEmpty then player
        else player.copy(hasPassed = player.hand.isEmpty || boutIsFull)
      }
      state.copy(players = players, boutPhase = BoutPhase.SurrenderThrowIn)

  /**
   * Any active non-defending player adds cards matching a rank already on the
   * table. During the defense phase this reopens passing for everyone else.
   */
  private def applyThrowInCards(
      state: GameState,
      playerId: String,
      cards: List[Card]
  ): Either[String, GameState] =
    val phaseAllowsThrowIn =
      state.boutPhase == BoutPhase.Defense || state.boutPhase == BoutPhase.SurrenderThrowIn

    for
      _ <- check(
        phaseAllowsThrowIn,
        s"Cannot throw in cards during ${state.boutPhase} phase"
      )
      defender <- state.players.lift(state.defenderIdx).toRight("Invalid defender seat")
      throwerIdx = state.players.indexWhere(_.id == playerId)
      _ <- check(throwerIdx != -1, s"Unknown player: $playerId")
      thrower = state.players(throwerIdx)
      _ <- check(defender.id != playerId, "The defender cannot throw in cards")
      _ <- check(thrower.finishRank.isEmpty, s"$playerId has already finished the game")
      _ <- check(cards.nonEmpty, "A throw-in must contain at least one card")
      remainingHand <- removeCards(thrower.hand, cards)
        .toRight("Throw-in contains cards that are not in the player's hand")
      tableRanks = state.tablePairs
        .flatMap(pair => pair.attack.rank :: pair.defense.map(_.rank).toList)
        .toSet
      _ <- check(
        cards.forall(card => tableRanks.contains(card.rank)),
        "Every thrown-in card must match the rank of a card on the table"
      )
      _ <- check(
        state.tablePairs.size + cards.size <= state.maxBoutAttacks,
        s"A throw-in may not grow the attack beyond ${state.maxBoutAttacks} cards"
      )
      _ <- check(
        state.boutPhase != BoutPhase.Defense ||
          state.tablePairs.count(_.defense.isEmpty) + cards.size <= defender.hand.size,
        "The defender does not have enough cards to cover the thrown-in cards"
      )
    yield
      val players = state.players.zipWithIndex.map { case (player, idx) =>
        val updated = if idx == throwerIdx then player.copy(hand = remainingHand) else player
        if state.boutPhase == BoutPhase.Defense &&
            idx != state.defenderIdx &&
            updated.finishRank.isEmpty
        then updated.copy(hasPassed = false)
        else updated
      }
      state.copy(
        players = players,
        tablePairs = state.tablePairs ++ cards.map(card => TablePair(card))
      )

  /**
   * A non-defending player declares they have nothing more to add this bout.
   * Once every active non-defender has passed, the bout resolves.
   */
  private def applyPassTurn(state: GameState, playerId: String): Either[String, GameState] =
    val passablePhase =
      state.boutPhase == BoutPhase.Defense || state.boutPhase == BoutPhase.SurrenderThrowIn
    val playerIdx = state.players.indexWhere(_.id == playerId)

    // A surrender auto-passes every non-defender who can no longer act, which
    // can settle the bout without any further move. Passing is then idempotent:
    // the bout resolves instead of being rejected as a second pass.
    val boutAlreadySettled =
      passablePhase &&
        playerIdx != -1 &&
        playerIdx != state.defenderIdx &&
        state.players(playerIdx).isActive &&
        boutIsComplete(state)

    if boutAlreadySettled then Right(resolveBout(state))
    else
      for
        _ <- check(passablePhase, s"Cannot pass during ${state.boutPhase} phase")
        passer <- state.players.lift(playerIdx).toRight(s"Unknown player: $playerId")
        _ <- check(passer.isActive, s"$playerId has already finished the game")
        _ <- check(playerIdx != state.defenderIdx, "The defender cannot pass")
        _ <- check(!passer.hasPassed, s"$playerId has already passed")
        _ <- check(
          state.boutPhase != BoutPhase.Defense ||
            state.tablePairs.forall(_.defense.isDefined) ||
            state.tablePairs.size >= state.maxBoutAttacks,
          "Cannot pass while attacking cards are still uncovered"
        )
      yield
        settlePasses(
          state.copy(players = state.players.updated(playerIdx, passer.copy(hasPassed = true)))
        )

  /** True when every active non-defender has already passed this bout. */
  private def boutIsComplete(state: GameState): Boolean =
    val nonDefenders = state.players.zipWithIndex.filter { case (player, idx) =>
      idx != state.defenderIdx && player.isActive
    }
    nonDefenders.nonEmpty && nonDefenders.forall(_._1.hasPassed)

  /**
   * Auto-passes players that cannot act (empty hand or a full table) and
   * resolves the bout once every active non-defender has passed.
   */
  private def settlePasses(state: GameState): GameState =
    val tableIsFull = state.tablePairs.size >= state.maxBoutAttacks
    val players = state.players.zipWithIndex.map { case (player, idx) =>
      val cantAct = player.hand.isEmpty || tableIsFull
      if idx != state.defenderIdx && player.isActive && cantAct then
        player.copy(hasPassed = true)
      else player
    }
    val settled = state.copy(players = players)
    val nonDefenders = players.zipWithIndex.filter { case (player, idx) =>
      idx != state.defenderIdx && player.isActive
    }
    if nonDefenders.forall(_._1.hasPassed) then resolveBout(settled) else settled

  /**
   * Ends the current bout: clears the table (discarding it after a successful
   * defense or handing it to a surrendering defender), refills hands in draw
   * order, applies the endgame rules, and — while the game goes on — rotates
   * the roles and opens the next bout's initial attack.
   */
  private def resolveBout(state: GameState): GameState =
    val surrendered = state.boutPhase == BoutPhase.SurrenderThrowIn
    val tableCards = state.tablePairs.flatMap(pair => pair.attack :: pair.defense.toList)

    val afterTable =
      if surrendered then
        val defender = state.players(state.defenderIdx)
        state.copy(
          players = state.players
            .updated(state.defenderIdx, defender.copy(hand = defender.hand ++ tableCards)),
          tablePairs = Vector.empty
        )
      else
        state.copy(tablePairs = Vector.empty, discardPile = state.discardPile ++ tableCards)

    val drawn = drawHands(afterTable, includeDefender = !surrendered)
    val cleared = drawn.copy(players = drawn.players.map(_.copy(hasPassed = false)))

    if isTwoPlayerDraw(cleared, successfulDefense = !surrendered) then
      val rank = cleared.finishOrder.size + 1
      cleared.copy(
        players = cleared.players.map(_.copy(finishRank = Some(rank))),
        finishOrder = cleared.finishOrder ++ cleared.players.map(_.id),
        isDraw = true,
        boutPhase = BoutPhase.GameOver
      )
    else
      val roster =
        if cleared.talon.isEmpty then eliminateEmptyHands(cleared) else cleared
      val remaining = roster.activePlayersWithCards

      if remaining.size <= 1 then
        val finished =
          if remaining.size == 1 then crownDurak(roster, remaining.head) else roster
        finished.copy(boutPhase = BoutPhase.GameOver)
      else
        // Rotate only among players left in the game: a defender who just went
        // out cannot be handed the next attack or defense.
        val defenderIdx = roster.defenderIdx
        val newAttackerIdx =
          if surrendered || !roster.players(defenderIdx).isActive then
            roster.nextActivePlayerIdx(defenderIdx)
          else defenderIdx
        val newDefenderIdx = roster.nextActivePlayerIdx(newAttackerIdx)
        roster.copy(
          attackerIdx = newAttackerIdx,
          defenderIdx = newDefenderIdx,
          boutPhase = BoutPhase.InitialAttack,
          defenderInitialHandSize = roster.players(newDefenderIdx).hand.size
        )

  /**
   * Two players going out on the same successful defense is a draw: both are
   * ranked equally and the game is over.
   */
  private def isTwoPlayerDraw(state: GameState, successfulDefense: Boolean): Boolean =
    successfulDefense &&
      state.talon.isEmpty &&
      state.players.size == 2 &&
      state.players.forall(player => player.isActive && player.hand.isEmpty)

  /** Finishes every active player with an empty hand, in seat order. */
  private def eliminateEmptyHands(state: GameState): GameState =
    state.players.indices.foldLeft(state) { (current, idx) =>
      val player = current.players(idx)
      if player.isActive && !player.hasCards then
        val rank = current.finishOrder.size + 1
        current.copy(
          players = current.players.updated(
            idx,
            player.copy(finishRank = Some(rank), hasPassed = false)
          ),
          finishOrder = current.finishOrder :+ player.id
        )
      else current
    }

  /** Records the last player still holding cards as the Durak (last place). */
  private def crownDurak(state: GameState, durak: PlayerState): GameState =
    val idx = state.players.indexWhere(_.id == durak.id)
    val rank = state.finishOrder.size + 1
    state.copy(
      players = state.players.updated(idx, state.players(idx).copy(finishRank = Some(rank))),
      finishOrder = state.finishOrder :+ durak.id
    )

  /**
   * Refills hands to six from the talon: the primary attacker first, then the
   * other active non-defenders clockwise, and the defender last.
   */
  private def drawHands(state: GameState, includeDefender: Boolean): GameState =
    val attackerIdx = state.attackerIdx
    val others = (1 until state.players.size)
      .map(offset => (attackerIdx + offset) % state.players.size)
      .filter(idx => idx != state.defenderIdx && state.players(idx).isActive)
      .toVector
    val defenderOrder =
      if includeDefender && state.players(state.defenderIdx).isActive then
        Vector(state.defenderIdx)
      else Vector.empty

    (attackerIdx +: (others ++ defenderOrder)).foldLeft(state) { (current, idx) =>
      drawToHandSize(current, idx, InitialHandSize)
    }

  /** Draws from the talon until the player holds `target` cards or it empties. */
  private def drawToHandSize(state: GameState, playerIdx: Int, target: Int): GameState =
    val player = state.players(playerIdx)
    val missing = Math.max(0, target - player.hand.size)
    val (drawn, remaining) = state.talon.splitAt(missing)
    state.copy(
      players = state.players.updated(playerIdx, player.copy(hand = player.hand ++ drawn)),
      talon = remaining,
      // The bottom trump is the last card drawn; once the talon is gone it is no longer shown.
      bottomTrumpCard = if remaining.isEmpty then None else state.bottomTrumpCard
    )

  /** Legal cover: same suit with a higher rank, or a trump against a non-trump. */
  private def isLegalCover(attack: Card, defense: Card, trumpSuit: Suit): Boolean =
    (defense.suit == attack.suit && defense.rank.value > attack.rank.value) ||
      (defense.suit == trumpSuit && attack.suit != trumpSuit)

  /**
   * The move the engine makes for the player on the clock once their 15 seconds
   * expire: a random legal attack card, an automatic surrender for the defender,
   * or a pass for a non-defending player.
   */
  def defaultAction(state: GameState): Option[GameAction] =
    state.boutPhase match
      case BoutPhase.InitialAttack =>
        state.players.lift(state.attackerIdx).filter(_.hasCards).map { attacker =>
          val card = attacker.hand(chaosRandom(state).nextInt(attacker.hand.size))
          GameAction.InitialAttack(attacker.id, List(card), chaosTargetFor(state))
        }
      case BoutPhase.Defense =>
        if state.tablePairs.exists(_.defense.isEmpty) then
          state.players
            .lift(state.defenderIdx)
            .filter(_.isActive)
            .map(defender => GameAction.DeclareSurrender(defender.id))
        else autoPassAction(state)
      case BoutPhase.SurrenderThrowIn => autoPassAction(state)
      case BoutPhase.BoutOver | BoutPhase.GameOver => None

  /**
   * The automatic follow-up the current state calls for, if any. A defender
   * with no legal cover and no legal redirect has no move left but to surrender.
   */
  def pendingAutoAction(state: GameState): Option[GameAction] =
    if state.boutPhase != BoutPhase.Defense then None
    else
      val uncovered = state.tablePairs.exists(_.defense.isEmpty)
      state.players.lift(state.defenderIdx).filter(_.isActive) match
        case Some(defender)
            if uncovered && !canDefenderCover(state) && !canDefenderRedirect(state) =>
          Some(GameAction.DeclareSurrender(defender.id))
        case _ => None

  /** True when the defender can legally cover at least one uncovered attack. */
  def canDefenderCover(state: GameState): Boolean =
    state.players.lift(state.defenderIdx).exists { defender =>
      state.tablePairs.exists { pair =>
        pair.defense.isEmpty &&
          defender.hand.exists(card => isLegalCover(pair.attack, card, state.trumpSuit))
      }
    }

  /** True when the defender can redirect at least one card to an eligible seat. */
  def canDefenderRedirect(state: GameState): Boolean =
    state.config.allowRedirect &&
      state.tablePairs.nonEmpty &&
      state.tablePairs.forall(_.defense.isEmpty) &&
      state.tablePairs.size + 1 <= 6 &&
      state.players.lift(state.defenderIdx).exists { defender =>
        defender.hand.exists(card => state.tablePairs.forall(_.attack.rank == card.rank))
      } &&
      state.redirectTargets(state.defenderIdx, state.tablePairs.size + 1).nonEmpty

  private def autoPassAction(state: GameState): Option[GameAction] =
    state.players.zipWithIndex
      .collectFirst {
        case (player, idx) if idx != state.defenderIdx && player.isActive && !player.hasPassed =>
          GameAction.PassTurn(player.id)
      }

  /** Random legal target for a chaos-mode opening attack, if any. */
  private def chaosTargetFor(state: GameState): Option[String] =
    if !state.chaosMode then None
    else
      val candidates = chaosDefenderCandidates(state)
      if candidates.isEmpty then None
      else Some(state.players(candidates(chaosRandom(state).nextInt(candidates.size))).id)

  /** Deterministic pseudo-randomness derived from the state, for chaos effects. */
  private def chaosRandom(state: GameState): Random =
    new Random(
      mixSeed(
        state.config.seed ^
          (state.tablePairs.size.toLong * 0x9E3779B1L) ^
          (state.defenderIdx.toLong << 16) ^
          (state.finishOrder.size.toLong << 32) ^
          state.players.map(_.hand.size).sum.toLong
      )
    )

  /** SplitMix64 finalizer so nearby seeds still produce spread-out choices. */
  private def mixSeed(seed: Long): Long =
    val shifted = seed + 0x9E3779B97F4A7C15L
    val first = (shifted ^ (shifted >>> 30)) * 0xBF58476D1CE4E5B9L
    val second = (first ^ (first >>> 27)) * 0x94D049BB133111EBL
    second ^ (second >>> 31)

  private def check(condition: Boolean, error: String): Either[String, Unit] =
    Either.cond(condition, (), error)

  /**
   * Removes one occurrence of each card in `cards` from `hand`.
   * Returns `None` if any card (counting duplicates) is not present.
   */
  private def removeCards(hand: Vector[Card], cards: List[Card]): Option[Vector[Card]] =
    cards.foldLeft(Option(hand)) { (acc, card) =>
      acc.flatMap { remaining =>
        remaining.indexOf(card) match
          case -1  => None
          case idx => Some(remaining.patch(idx, Nil, 1))
      }
    }

  private def validate(config: GameConfig, playerNames: Vector[String]): Unit =
    if playerNames.size != config.playerCount then
      throw new IllegalArgumentException(
        s"Expected ${config.playerCount} player names, got ${playerNames.size}"
      )
    if !Set(2, 3, 4).contains(config.playerCount) then
      throw new IllegalArgumentException(
        s"Unsupported player count: ${config.playerCount} (expected 2, 3, or 4)"
      )
    if config.chaosMode && config.playerCount <= 2 then
      throw new IllegalArgumentException(
        "Chaos mode requires more than 2 players"
      )

  /** Index of the player holding the lowest-rank trump card, or 0 if nobody has one. */
  private def selectFirstAttacker(players: Vector[PlayerState], trumpSuit: Suit): Int =
    players.zipWithIndex
      .flatMap { case (player, idx) =>
        player.hand
          .filter(_.suit == trumpSuit)
          .minByOption(_.rank.value)
          .map(card => (card.rank.value, idx))
      }
      .minByOption(_._1)
      .map(_._2)
      .getOrElse(0)
