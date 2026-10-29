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
      case other =>
        Left(s"Unsupported action: $other")

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

  /** Legal cover: same suit with a higher rank, or a trump against a non-trump. */
  private def isLegalCover(attack: Card, defense: Card, trumpSuit: Suit): Boolean =
    (defense.suit == attack.suit && defense.rank.value > attack.rank.value) ||
      (defense.suit == trumpSuit && attack.suit != trumpSuit)

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
