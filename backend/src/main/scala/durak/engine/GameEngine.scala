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
   * Seats an opening attack may be aimed at. Nothing once the bout has left the
   * [[BoutPhase.InitialAttack]] phase, only the clockwise defender in a standard
   * game, and every other seat that still holds cards in Chaos mode — in
   * clockwise order starting from the attacker.
   */
  def eligibleInitialTargets(state: GameState): Vector[Int] =
    if state.boutPhase != BoutPhase.InitialAttack then Vector.empty
    else if !state.config.chaosMode then Vector(state.defenderIdx)
    else
      val n = state.players.size
      (1 until n)
        .map(offset => (state.attackerIdx + offset) % n)
        .filter(idx => idx != state.attackerIdx && state.players(idx).hand.nonEmpty)
        .toVector

  /**
   * Seats that could take over a redirect: every other active seat holding
   * enough cards to answer the combined attack. A standard game can only ever
   * move the attack to the next clockwise player; Chaos mode lets any seat take
   * it, which is what the reflected-arrow outline in the UI shows.
   */
  def eligibleRedirectTargets(state: GameState): Vector[Int] =
    val required = state.tablePairs.size + 1
    def canTake(idx: Int): Boolean =
      idx != state.defenderIdx &&
        state.players.lift(idx).exists(seat => seat.isActive && seat.hand.size >= required)

    if state.config.chaosMode then state.players.indices.filter(canTake).toVector
    else
      val next = state.nextActivePlayerIdx(state.defenderIdx)
      if canTake(next) then Vector(next) else Vector.empty

  /**
   * The seat a Chaos-mode redirect lands on. The pick is derived from the seed,
   * the talon and discard sizes and the current table, so [[applyAction]] stays
   * pure: the same state always redirects to the same seat and a replay
   * reproduces every frame exactly. `extraCards` is the number of cards being
   * reflected, so the chosen seat can always answer the combined attack.
   */
  def deterministicRedirectTarget(state: GameState, extraCards: Int = 1): Option[Int] =
    val required = state.tablePairs.size + extraCards
    val candidates = eligibleRedirectTargets(state)
      .filter(idx => state.players(idx).hand.size >= required)
    if candidates.isEmpty then None
    else
      val seed = state.config.seed * 31L +
        state.talon.size.toLong * 17L +
        state.discardPile.size.toLong * 7L +
        state.tablePairs.hashCode.toLong
      val random = new Random(seed)
      Some(candidates(random.nextInt(candidates.size)))

  /**
   * Applies a player action to the game state.
   *
   * Returns `Left(error)` when the move is illegal, leaving the caller's state
   * untouched, or `Right(newState)` for a legal move.
   */
  def applyAction(state: GameState, action: GameAction): Either[String, GameState] =
    action match
      case GameAction.InitialAttack(playerId, cards, targetPlayerId) =>
        applyInitialAttack(state, playerId, cards, targetPlayerId)
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
   * Applies `action` on behalf of `playerId`, rejecting anything that names a
   * different seat. This is the seat guard every caller uses: a move can only
   * ever be applied for the seat that issued it, so nobody can act out of turn.
   */
  def applyAction(
      state: GameState,
      playerId: String,
      action: GameAction
  ): Either[String, GameState] =
    val actor = actorId(action)
    if actor != playerId then Left(s"$playerId cannot submit a move for $actor")
    else applyAction(state, action)

  /** The seat that issued `action`. */
  def actorId(action: GameAction): String =
    action match
      case GameAction.InitialAttack(playerId, _, _) => playerId
      case GameAction.CoverCard(playerId, _, _)   => playerId
      case GameAction.RedirectAttack(playerId, _) => playerId
      case GameAction.ThrowInCards(playerId, _)   => playerId
      case GameAction.DeclareSurrender(playerId)  => playerId
      case GameAction.PassTurn(playerId)          => playerId

  /**
   * Every action `playerId` could legally take right now, generated from their
   * role in the current phase and filtered through [[applyAction]] for that same
   * seat, so each returned action is guaranteed to be accepted by the engine.
   */
  def legalActions(state: GameState, playerId: String): List[GameAction] =
    candidateActions(state, playerId).filter(action => applyAction(state, playerId, action).isRight)

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
            if state.config.chaosMode then
              val targets = eligibleInitialTargets(state)
              player.hand.toList.flatMap(card =>
                targets.map(targetIdx =>
                  GameAction.InitialAttack(
                    playerId,
                    List(card),
                    Some(state.players(targetIdx).id)
                  )
                )
              )
            else player.hand.toList.map(card => GameAction.InitialAttack(playerId, List(card)))
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
          // Throw-ins stay open to every active non-defender while cards sit on
          // the table. A seat that already passed gets no action at all — not a
          // second pass and not a throw-in — until another throw-in reopens the
          // window (ITEM-1a).
          case BoutPhase.Defense | BoutPhase.SurrenderThrowIn
              if playerIdx != state.defenderIdx &&
                state.tablePairs.nonEmpty &&
                !player.hasPassed =>
            val tableRanks = state.tablePairs
              .flatMap(pair => pair.attack.rank :: pair.defense.map(_.rank).toList)
              .toSet
            val throwIns = player.hand.toList
              .filter(card => tableRanks.contains(card.rank))
              .map(card => GameAction.ThrowInCards(playerId, List(card)))
            GameAction.PassTurn(playerId) :: throwIns
          case _ => Nil

  /**
   * Opens a bout. In a standard game the attack always aims at the clockwise
   * defender; a target naming any other seat is rejected. In Chaos mode the
   * attacker may name any seat [[eligibleInitialTargets]] allows, and an empty
   * target falls back to the seat that is already the defender.
   */
  private def applyInitialAttack(
      state: GameState,
      playerId: String,
      cards: List[Card],
      targetPlayerId: Option[String] = None
  ): Either[String, GameState] =
    val targetIdx = targetPlayerId.map(_.trim).filter(_.nonEmpty)
      .map(targetId => state.players.indexWhere(_.id == targetId))
    val chaosTargets = eligibleInitialTargets(state)

    val resolvedDefenderIdx = targetIdx match
      case None         => state.defenderIdx
      case Some(target) => target

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
      _ <- targetIdx match
        case None => check(true, "")
        case Some(target) if target < 0 =>
          Left(s"Unknown attack target: ${targetPlayerId.getOrElse("")}")
        case Some(target) =>
          if state.config.chaosMode then
            check(
              chaosTargets.contains(target),
              s"${state.players.lift(target).map(_.name).getOrElse("That player")} is not a valid attack target"
            )
          else
            check(
              target == state.defenderIdx &&
                state.players(target).id == state.players(state.defenderIdx).id,
              s"${state.players.lift(target).map(_.name).getOrElse("That player")} is not the defender"
            )
      _ <- check(
        resolvedDefenderIdx != state.attackerIdx,
        "The attacker cannot defend its own attack"
      )
    yield
      val attacked = state.copy(
        players = state.players.updated(state.attackerIdx, attacker.copy(hand = remainingHand)),
        tablePairs = state.tablePairs ++ cards.map(card => TablePair(card)),
        boutPhase = BoutPhase.Defense
      )
      if resolvedDefenderIdx == state.defenderIdx then attacked
      else
        // A Chaos-mode attack names a new defender: the bout capacity follows
        // that seat's hand, exactly as a redirect's would.
        attacked.copy(
          defenderIdx = resolvedDefenderIdx,
          defenderInitialHandSize = attacked.players(resolvedDefenderIdx).hand.size
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
      // A seat can never both attack and defend the same bout, so a player can
      // never cover its own attacking cards.
      _ <- check(
        state.attackerIdx != state.defenderIdx,
        "A player cannot attack and defend the same bout"
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
   *
   * A redirect is only legal while nothing is covered yet, and only when a
   * different active seat can take the combined attack; a cardless (or nearly
   * cardless) next player would otherwise become the defender with no way to
   * cover, and the redirecting seat would end up defending its own cards.
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
      _ <- check(
        state.attackerIdx != state.defenderIdx,
        "A player cannot attack and defend the same bout"
      )
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
      // Chaos mode reflects onto any eligible seat, chosen deterministically so
      // the engine stays pure; a standard game always moves on clockwise.
      nextDefIdx <-
        if state.config.chaosMode then
          deterministicRedirectTarget(state, cards.size)
            .toRight("No player can take the redirected attack")
        else Right(state.nextActivePlayerIdx(state.defenderIdx))
      // A redirect always moves the attack to somebody else: the redirecting
      // seat can never become the defender of the cards it just threw in.
      _ <- check(
        nextDefIdx != state.defenderIdx,
        "A player cannot redirect an attack to themselves"
      )
      nextDefender <- state.players.lift(nextDefIdx).toRight("Invalid next defender seat")
      _ <- check(nextDefender.isActive, s"${nextDefender.name} is no longer in the game")
      _ <- check(
        nextDefender.hand.size >= state.tablePairs.size + cards.size,
        s"${nextDefender.name} does not have enough cards to defend the redirected attack"
      )
      // The target must also be able to answer the smallest possible attack.
      _ <- check(
        nextDefender.hand.size >= state.tablePairs.size + 1,
        s"${nextDefender.name} has too few cards to defend the redirected attack"
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
   * active player, and nobody is passed inside this same transition.
   *
   * The phase moves to [[BoutPhase.SurrenderThrowIn]], where the surrendering
   * defender has no legal action left (it can neither cover, redirect, throw
   * in, pass nor surrender again). Every other active player keeps
   * `hasPassed = false`, even when it holds no matching rank at all, so the
   * table shows the half-off surrender for a moment; the server passes the
   * seats reported by [[playersNeedingAutoPass]] after its 1-second delay. A
   * seat with no cards at all can never act again, so it is passed right away,
   * and when no other active player holds any card the bout resolves in this
   * same move (there is nobody to wait for).
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
      _ <- check(
        state.attackerIdx != state.defenderIdx,
        "A player cannot attack and defend the same bout"
      )
      defender <- state.players.lift(state.defenderIdx).toRight("Invalid defender seat")
      _ <- check(defender.id == playerId, s"$playerId is not the defender")
      _ <- check(
        state.tablePairs.exists(_.defense.isEmpty),
        "Cannot surrender when every attacking card is already covered"
      )
    yield
      val players = state.players.zipWithIndex.map { case (player, idx) =>
        if idx == state.defenderIdx || player.finishRank.nonEmpty then player
        else player.copy(hasPassed = player.hand.isEmpty)
      }
      // A non-defender with cards stays unpassed even without a legal throw-in:
      // the server passes those seats after its 1-second auto-pass delay. When
      // every non-defender is already settled (no cards left), this resolves
      // the surrender in the same move.
      resolveSurrenderBout(
        state.copy(players = players, boutPhase = BoutPhase.SurrenderThrowIn)
      )

  /**
   * True when `seatIdx` still has a legitimate throw-in: it is an active
   * non-defender that has not passed, the table still holds attacking cards,
   * it holds a card whose rank is on the table, the bout still has room for
   * another attacking card, and — while the defender is still answering — the
   * defender could cover it.
   *
   * This is the single definition the projection, the UI outline and the
   * server's auto-pass all read, so a seat that is the defender, already passed
   * or holds no matching rank never sees a throw-in outline (ITEM-1a).
   */
  def canPlayerThrowIn(state: GameState, seatIdx: Int): Boolean =
    if seatIdx == state.defenderIdx then false
    else
      state.players.lift(seatIdx).exists { player =>
        val surrendered = state.boutPhase == BoutPhase.SurrenderThrowIn
        val defenderHand = state.players.lift(state.defenderIdx).map(_.hand.size).getOrElse(0)
        player.isActive &&
          player.hand.nonEmpty &&
          !player.hasPassed &&
          state.tablePairs.nonEmpty &&
          state.tablePairs.size < state.maxBoutAttacks &&
          (surrendered || state.uncoveredCount < defenderHand) &&
          player.hand.exists(card => state.tableRanks.contains(card.rank))
      }

  /**
   * Seats the server passes on a short delay instead of the engine passing them
   * inside the transition that caused them: active non-defenders that still
   * hold cards, have not passed, and have no legal throw-in (no rank on the
   * table, no room left under `maxBoutAttacks`, or a full bout).
   *
   * Only an open throw-in window can produce such a seat — the surrender phase
   * itself, or a defense phase whose attacking cards are all covered. The
   * engine never marks these seats passed synchronously, so the surrendered
   * cards keep straddling the felt border for the length of that delay before
   * the bout settles.
   */
  def playersNeedingAutoPass(state: GameState): Vector[String] =
    if !state.isThrowInPhase then Vector.empty
    else
      state.players.zipWithIndex.collect {
        case (player, idx)
            if idx != state.defenderIdx &&
              player.isActive &&
              player.hand.nonEmpty &&
              !player.hasPassed &&
              !canPlayerThrowIn(state, idx) =>
          player.id
      }

  /**
   * Passes every thrower who cannot add anything during a surrender throw-in
   * and resolves the surrender once nobody is left to act. This is the delayed
   * settlement step: [[durak.server.GameActor]] calls it only after its
   * 1-second `noThrowInAutoPassDelay`, so the engine itself never auto-passes a
   * player in the same transition that opens — or grows — the throw-in window.
   */
  def autoPassSurrenderThrowers(state: GameState): GameState =
    if state.boutPhase != BoutPhase.SurrenderThrowIn then state
    else
      val updated = state.copy(
        players = state.players.zipWithIndex.map { case (player, idx) =>
          val cannotThrowIn =
            idx != state.defenderIdx && player.isActive && !canPlayerThrowIn(state, idx)
          if cannotThrowIn && !player.hasPassed then player.copy(hasPassed = true) else player
        }
      )
      resolveSurrenderBout(updated)

  /** Resolves a surrendered bout once every thrower has been settled. */
  private def resolveSurrenderBout(state: GameState): GameState =
    if state.boutPhase == BoutPhase.SurrenderThrowIn && boutIsComplete(state) then
      resolveBout(state)
    else state

  /**
   * Any active non-defending player adds cards matching a rank already on the
   * table. During the defense phase this reopens passing for everyone else.
   *
   * One call deploys 1..n cards at once, so a client can multi-select matching
   * cards and throw them in as a single move (ITEM-5). A seat that already
   * passed cannot throw in until a throw-in by somebody else reopens passing.
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
      _ <- check(!thrower.hasPassed, s"$playerId has already passed")
      _ <- check(cards.nonEmpty, "A throw-in must contain at least one card")
      remainingHand <- removeCards(thrower.hand, cards)
        .toRight("Throw-in contains cards that are not in the player's hand")
      tableRanks = state.tableRanks
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
        else if state.boutPhase == BoutPhase.SurrenderThrowIn &&
            idx != state.defenderIdx &&
            updated.finishRank.isEmpty
        // Reopen the throw-in window for everybody still holding cards; a seat
        // that just spent its last card has nothing left to wait for.
        then updated.copy(hasPassed = updated.hand.isEmpty)
        else updated
      }
      val next = state.copy(
        players = players,
        tablePairs = state.tablePairs ++ cards.map(card => TablePair(card))
      )
      // A surrender throw-in reopens the window for every non-defender that
      // still holds cards: the thrower may add another matching card or pass,
      // and anybody who cannot throw in is auto-passed by the server after its
      // 1-second delay instead of being passed inside this transition. Only a
      // seat left with no cards at all is settled right away, and when that
      // leaves nobody unpassed the bout resolves here.
      if state.boutPhase == BoutPhase.SurrenderThrowIn then resolveSurrenderBout(next)
      else next

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
        val passed =
          state.copy(players = state.players.updated(playerIdx, passer.copy(hasPassed = true)))
        // A pass only settles the table once every other thrower has passed too;
        // seats that cannot throw in are left to the server's delayed auto-pass.
        if state.boutPhase == BoutPhase.SurrenderThrowIn then resolveSurrenderBout(passed)
        else settlePasses(passed)

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
   *
   * A successful defense appends the bout to `discardPile` and publishes it as
   * `lastDiscardCards`; a surrender hands the cards to the defender instead, so
   * both the pile and the last visible discard stay untouched.
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
        // A successful defense discards the whole bout and makes those cards the
        // publicly visible discard, while the pile also keeps every earlier bout.
        state.copy(
          tablePairs = Vector.empty,
          discardPile = state.discardPile ++ tableCards,
          lastDiscardCards = tableCards
        )

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
