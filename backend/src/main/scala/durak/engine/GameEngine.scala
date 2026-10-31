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
      finishOrder = Vector.empty
    )

  /**
   * Applies a player action to the game state.
   *
   * Returns `Left(error)` when the move is illegal, leaving the caller's state
   * untouched, or `Right(newState)` for a legal move.
   */
  def applyAction(state: GameState, action: GameAction): Either[String, GameState] =
    action match
      case GameAction.InitialAttack(playerId, cards) =>
        applyInitialAttack(state, playerId, cards)
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

  /**
   * Every action `playerId` could legally take right now, generated from their
   * role in the current phase and filtered through [[applyAction]], so each
   * returned action is guaranteed to be accepted by the engine.
   */
  def legalActions(state: GameState, playerId: String): List[GameAction] =
    candidateActions(state, playerId).filter(action => applyAction(state, action).isRight)

  /**
   * A random legal action for `playerId`, used when their turn clock expires.
   * Returns `None` when the player has no legal move at all.
   */
  def randomLegalAction(
      state: GameState,
      playerId: String,
      random: Random = Random()
  ): Option[GameAction] =
    val actions = legalActions(state, playerId)
    if actions.isEmpty then None else Some(actions(random.nextInt(actions.size)))

  /** Plausible moves for the player's role and phase; legality is checked by the caller. */
  private def candidateActions(state: GameState, playerId: String): List[GameAction] =
    val playerIdx = state.players.indexWhere(_.id == playerId)
    if playerIdx == -1 then Nil
    else
      val player = state.players(playerIdx)
      if !player.isActive then Nil
      else
        state.boutPhase match
          case BoutPhase.InitialAttack if playerIdx == state.attackerIdx =>
            player.hand.toList.map(card => GameAction.InitialAttack(playerId, List(card)))
          case BoutPhase.Defense if playerIdx == state.defenderIdx =>
            val covers = for
              (pair, index) <- state.tablePairs.zipWithIndex.toList
              if pair.defense.isEmpty
              card <- player.hand.toList
              if card.covers(pair.attack, state.trumpSuit)
            yield GameAction.CoverCard(playerId, index, card)
            val redirects = player.hand.toList
              .filter(card => state.tablePairs.nonEmpty && state.tablePairs.forall(_.attack.rank == card.rank))
              .map(card => GameAction.RedirectAttack(playerId, List(card)))
            val surrenders =
              if state.tablePairs.exists(_.defense.isEmpty) then
                List(GameAction.DeclareSurrender(playerId))
              else Nil
            covers ++ redirects ++ surrenders
          case BoutPhase.Defense | BoutPhase.SurrenderThrowIn =>
            val tableRanks = state.tablePairs
              .flatMap(pair => pair.attack.rank :: pair.defense.map(_.rank).toList)
              .toSet
            val throwIns = player.hand.toList
              .filter(card => tableRanks.contains(card.rank))
              .map(card => GameAction.ThrowInCards(playerId, List(card)))
            GameAction.PassTurn(playerId) :: throwIns
          case _ => Nil

  private def applyInitialAttack(
      state: GameState,
      playerId: String,
      cards: List[Card]
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
      _ <- check(
        cards.size <= state.maxBoutAttacks,
        s"An initial attack may contain at most ${state.maxBoutAttacks} cards"
      )
    yield
      state.copy(
        players = state.players.updated(state.attackerIdx, attacker.copy(hand = remainingHand)),
        tablePairs = state.tablePairs ++ cards.map(card => TablePair(card)),
        boutPhase = BoutPhase.Defense
      )

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
      nextDefIdx = state.nextActivePlayerIdx(state.defenderIdx)
      nextDefender <- state.players.lift(nextDefIdx).toRight("Invalid next defender seat")
      _ <- check(
        nextDefender.hand.size >= state.tablePairs.size + cards.size,
        s"${nextDefender.name} does not have enough cards to defend the redirected attack"
      )
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
    defense.covers(attack, trumpSuit)

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
