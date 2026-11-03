package durak.engine

class BoutResolutionSuite extends munit.FunSuite:

  private def card(rank: Rank, suit: Suit = Suit.Spades): Card = Card(suit, rank)

  private def player(
      id: String,
      hand: List[Card],
      hasPassed: Boolean = false,
      finishRank: Option[Int] = None
  ): PlayerState =
    PlayerState(
      id = id,
      name = id.toUpperCase,
      hand = hand.toVector,
      hasPassed = hasPassed,
      finishRank = finishRank
    )

  private def state(
      players: Vector[PlayerState],
      tablePairs: Vector[TablePair] = Vector.empty,
      talon: Vector[Card] = Vector.empty,
      bottomTrumpCard: Option[Card] = None,
      discardPile: Vector[Card] = Vector.empty,
      attackerIdx: Int = 0,
      defenderIdx: Int = 1,
      boutPhase: BoutPhase = BoutPhase.Defense,
      trumpSuit: Suit = Suit.Spades,
      defenderInitialHandSize: Int = 6
  ): GameState =
    GameState(
      config = GameConfig(players.size, seed = 42L),
      players = players,
      talon = talon,
      trumpSuit = trumpSuit,
      bottomTrumpCard = bottomTrumpCard,
      discardPile = discardPile,
      tablePairs = tablePairs,
      attackerIdx = attackerIdx,
      defenderIdx = defenderIdx,
      boutPhase = boutPhase,
      defenderInitialHandSize = defenderInitialHandSize,
      finishOrder = Vector.empty
    )

  private def pass(gs: GameState, playerId: String): GameState =
    GameEngine.applyAction(gs, GameAction.PassTurn(playerId)) match
      case Right(next) => next
      case Left(error) => fail(s"pass by $playerId was rejected: $error")

  /** Two-player defense state: p0 attacks, p1 defends. */
  private def twoPlayer(
      attackerHand: List[Card],
      defenderHand: List[Card],
      tablePairs: Vector[TablePair],
      talon: Vector[Card] = Vector.empty,
      bottomTrumpCard: Option[Card] = None,
      attackerPassed: Boolean = false,
      boutPhase: BoutPhase = BoutPhase.Defense,
      defenderInitialHandSize: Int = 6
  ): GameState =
    state(
      Vector(
        player("p0", attackerHand, hasPassed = attackerPassed),
        player("p1", defenderHand)
      ),
      tablePairs = tablePairs,
      talon = talon,
      bottomTrumpCard = bottomTrumpCard,
      boutPhase = boutPhase,
      defenderInitialHandSize = defenderInitialHandSize
    )

  /** Three-player defense state: p0 attacks, p1 defends, p2 sits clockwise after p1. */
  private def threePlayer(
      attackerHand: List[Card],
      defenderHand: List[Card],
      thirdHand: List[Card],
      tablePairs: Vector[TablePair],
      talon: Vector[Card] = Vector.empty,
      bottomTrumpCard: Option[Card] = None,
      attackerPassed: Boolean = false,
      thirdPassed: Boolean = false,
      boutPhase: BoutPhase = BoutPhase.Defense,
      defenderInitialHandSize: Int = 6
  ): GameState =
    state(
      Vector(
        player("p0", attackerHand, hasPassed = attackerPassed),
        player("p1", defenderHand),
        player("p2", thirdHand, hasPassed = thirdPassed)
      ),
      tablePairs = tablePairs,
      talon = talon,
      bottomTrumpCard = bottomTrumpCard,
      boutPhase = boutPhase,
      defenderInitialHandSize = defenderInitialHandSize
    )

  private val six = card(Rank.Six)
  private val seven = card(Rank.Seven)
  private val coveredTable = Vector(TablePair(six, Some(seven)))
  private val uncoveredTable = Vector(TablePair(six))

  // --- Pass tests ---

  test("a non-defender can pass once every attacking card is covered") {
    val gs = threePlayer(
      attackerHand = List.fill(5)(card(Rank.Ace, Suit.Clubs)),
      defenderHand = List.fill(5)(card(Rank.King, Suit.Hearts)),
      thirdHand = List.fill(5)(card(Rank.Queen, Suit.Diamonds)),
      tablePairs = coveredTable
    )

    val next = pass(gs, "p0")

    assertEquals(next.players(0).hasPassed, true)
    assertEquals(next.players(2).hasPassed, false)
    assertEquals(next.boutPhase, BoutPhase.Defense)
    assertEquals(next.tablePairs, coveredTable)
  }

  test("a non-defender can pass during the surrender throw-in phase") {
    val gs = threePlayer(
      attackerHand = List.fill(5)(card(Rank.Ace, Suit.Clubs)),
      defenderHand = List.fill(5)(card(Rank.King, Suit.Hearts)),
      // p2 still holds a matching six, so the bout stays open after p0 passes.
      thirdHand = List(card(Rank.Six, Suit.Diamonds), card(Rank.Queen, Suit.Diamonds)),
      tablePairs = uncoveredTable,
      boutPhase = BoutPhase.SurrenderThrowIn
    )

    val next = pass(gs, "p0")

    assertEquals(next.players(0).hasPassed, true)
    assertEquals(next.players(2).hasPassed, false)
    assertEquals(next.boutPhase, BoutPhase.SurrenderThrowIn)
  }

  test("passing is rejected while attacking cards remain uncovered") {
    val gs = threePlayer(
      attackerHand = List.fill(5)(card(Rank.Ace, Suit.Clubs)),
      defenderHand = List.fill(5)(card(Rank.King, Suit.Hearts)),
      thirdHand = List.fill(5)(card(Rank.Queen, Suit.Diamonds)),
      tablePairs = uncoveredTable
    )

    val result = GameEngine.applyAction(gs, GameAction.PassTurn("p0"))

    assert(result.isLeft, result)
  }

  test("the defender cannot pass") {
    val gs = threePlayer(
      attackerHand = List.fill(5)(card(Rank.Ace, Suit.Clubs)),
      defenderHand = List.fill(5)(card(Rank.King, Suit.Hearts)),
      thirdHand = List.fill(5)(card(Rank.Queen, Suit.Diamonds)),
      tablePairs = coveredTable
    )

    val result = GameEngine.applyAction(gs, GameAction.PassTurn("p1"))

    assert(result.isLeft, result)
  }

  test("a player cannot pass twice") {
    val gs = threePlayer(
      attackerHand = List.fill(5)(card(Rank.Ace, Suit.Clubs)),
      defenderHand = List.fill(5)(card(Rank.King, Suit.Hearts)),
      thirdHand = List.fill(5)(card(Rank.Queen, Suit.Diamonds)),
      tablePairs = coveredTable
    )

    val once = pass(gs, "p0")
    val result = GameEngine.applyAction(once, GameAction.PassTurn("p0"))

    assert(result.isLeft, result)
  }

  test("passing is rejected outside the defense and surrender phases") {
    val gs = twoPlayer(
      attackerHand = List.fill(5)(card(Rank.Ace, Suit.Clubs)),
      defenderHand = List.fill(5)(card(Rank.King, Suit.Hearts)),
      tablePairs = Vector.empty,
      boutPhase = BoutPhase.InitialAttack
    )

    val result = GameEngine.applyAction(gs, GameAction.PassTurn("p0"))

    assert(result.isLeft, result)
  }

  test("an unknown player cannot pass") {
    val gs = threePlayer(
      attackerHand = List.fill(5)(card(Rank.Ace, Suit.Clubs)),
      defenderHand = List.fill(5)(card(Rank.King, Suit.Hearts)),
      thirdHand = List.fill(5)(card(Rank.Queen, Suit.Diamonds)),
      tablePairs = coveredTable
    )

    val result = GameEngine.applyAction(gs, GameAction.PassTurn("nobody"))

    assert(result.isLeft, result)
  }

  test("players with empty hands are auto-passed") {
    val gs = threePlayer(
      attackerHand = List.fill(5)(card(Rank.Ace, Suit.Clubs)),
      defenderHand = List.fill(5)(card(Rank.King, Suit.Hearts)),
      thirdHand = Nil,
      tablePairs = coveredTable
    )

    val next = pass(gs, "p0")

    // p2 is auto-passed, so the last pending non-defender cleared the bout.
    assertEquals(next.tablePairs, Vector.empty)
    assertEquals(next.discardPile, coveredTable.flatMap(pair => pair.attack :: pair.defense.toList))
    assertEquals(next.boutPhase, BoutPhase.InitialAttack)
    assert(next.players.forall(!_.hasPassed), next.players.map(_.hasPassed))
  }

  // --- Successful defense ---

  test("table cards move to the discard pile after a successful defense") {
    val gs = twoPlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs)),
      defenderHand = List(card(Rank.King, Suit.Hearts)),
      tablePairs = coveredTable
    )

    val next = pass(gs, "p0")

    assertEquals(next.tablePairs, Vector.empty)
    assertEquals(next.discardPile, Vector(six, seven))
  }

  test("successful defense rotates the defender into the attacker seat") {
    val gs = twoPlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs)),
      defenderHand = List(card(Rank.King, Suit.Hearts)),
      tablePairs = coveredTable
    )

    val next = pass(gs, "p0")

    assertEquals(next.players(next.attackerIdx).id, "p1")
    assertEquals(next.players(next.defenderIdx).id, "p0")
    assertEquals(next.boutPhase, BoutPhase.InitialAttack)
    assertEquals(next.defenderInitialHandSize, next.players(next.defenderIdx).hand.size)
  }

  test("players draw in order: attacker, other non-defenders clockwise, then defender") {
    val attackerCard = card(Rank.Ace, Suit.Clubs)
    val defenderCard = card(Rank.King, Suit.Hearts)
    val thirdCard = card(Rank.Queen, Suit.Diamonds)
    val first = card(Rank.Six, Suit.Diamonds)
    val second = card(Rank.Seven, Suit.Diamonds)
    val third = card(Rank.Six, Suit.Clubs)
    val fourth = card(Rank.Seven, Suit.Clubs)
    val bottom = card(Rank.Six, Suit.Hearts)

    val gs = threePlayer(
      attackerHand = List(attackerCard, card(Rank.Jack, Suit.Clubs), card(Rank.Ten, Suit.Clubs),
        card(Rank.Nine, Suit.Clubs), card(Rank.Eight, Suit.Clubs)),
      defenderHand = List(defenderCard, card(Rank.Jack, Suit.Hearts), card(Rank.Ten, Suit.Hearts),
        card(Rank.Nine, Suit.Hearts), card(Rank.Eight, Suit.Hearts)),
      thirdHand = List(thirdCard, card(Rank.Jack, Suit.Diamonds), card(Rank.Ten, Suit.Diamonds),
        card(Rank.Nine, Suit.Diamonds), card(Rank.Eight, Suit.Diamonds)),
      tablePairs = coveredTable,
      talon = Vector(first, second, third, fourth, bottom),
      bottomTrumpCard = Some(bottom)
    )

    val afterFirstPass = pass(gs, "p0")
    assertEquals(afterFirstPass.attackerIdx, gs.attackerIdx)
    val next = pass(afterFirstPass, "p2")

    assertEquals(next.players(0).hand.size, 6)
    assertEquals(next.players(0).hand.last, first)
    assertEquals(next.players(2).hand.size, 6)
    assertEquals(next.players(2).hand.last, second)
    assertEquals(next.players(1).hand.size, 6)
    assertEquals(next.players(1).hand.last, third)
    assertEquals(next.talon, Vector(fourth, bottom))
    assertEquals(next.bottomTrumpCard, Some(bottom))
  }

  test("drawing stops when the talon empties and clears the bottom trump") {
    val first = card(Rank.Six, Suit.Diamonds)
    val bottom = card(Rank.Six, Suit.Hearts)
    val gs = twoPlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs), card(Rank.King, Suit.Clubs),
        card(Rank.Queen, Suit.Clubs)),
      defenderHand = List(card(Rank.King, Suit.Hearts), card(Rank.Queen, Suit.Hearts),
        card(Rank.Jack, Suit.Hearts), card(Rank.Ten, Suit.Hearts), card(Rank.Nine, Suit.Hearts)),
      tablePairs = coveredTable,
      talon = Vector(first, bottom),
      bottomTrumpCard = Some(bottom)
    )

    val next = pass(gs, "p0")

    assertEquals(next.talon, Vector.empty)
    assertEquals(next.bottomTrumpCard, None)
    assertEquals(next.players(0).hand.size, 5)
    assertEquals(next.players(0).hand.takeRight(2), Vector(first, bottom))
    // The defender's hand was already five cards; the talon ran out first.
    assertEquals(next.players(1).hand.size, 5)
  }

  test("the bottom trump is drawn last when it is the final talon card") {
    val bottom = card(Rank.Six, Suit.Hearts)
    val gs = twoPlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs), card(Rank.King, Suit.Clubs),
        card(Rank.Queen, Suit.Clubs), card(Rank.Jack, Suit.Clubs), card(Rank.Ten, Suit.Clubs)),
      defenderHand = List(card(Rank.King, Suit.Hearts), card(Rank.Queen, Suit.Hearts),
        card(Rank.Jack, Suit.Hearts), card(Rank.Ten, Suit.Hearts), card(Rank.Nine, Suit.Hearts)),
      tablePairs = coveredTable,
      talon = Vector(bottom),
      bottomTrumpCard = Some(bottom)
    )

    val next = pass(gs, "p0")

    assertEquals(next.players(0).hand.last, bottom)
    assertEquals(next.players(1).hand.size, 5)
    assertEquals(next.talon, Vector.empty)
    assertEquals(next.bottomTrumpCard, None)
  }

  // --- Surrender ---

  test("a surrendering defender picks up every table card") {
    val gs = twoPlayer(
      attackerHand = List.fill(5)(card(Rank.Ace, Suit.Clubs)),
      defenderHand = List.fill(4)(card(Rank.King, Suit.Hearts)),
      tablePairs = uncoveredTable
    )
    // p0 holds cards but no matching rank, so it is not passed inside the
    // surrender: the bout waits for the server's 1-second auto-pass delay.
    val surrendered = GameEngine
      .applyAction(gs, GameAction.DeclareSurrender("p1"))
      .getOrElse(fail("expected a valid surrender"))
    assertEquals(surrendered.boutPhase, BoutPhase.SurrenderThrowIn)
    assertEquals(surrendered.tablePairs, uncoveredTable)
    assertEquals(GameEngine.playersNeedingAutoPass(surrendered), Vector("p0"))

    val next = GameEngine.autoPassSurrenderThrowers(surrendered)

    assertEquals(next.tablePairs, Vector.empty)
    assertEquals(next.players(1).hand.size, 5)
    assertEquals(next.players(1).hand.last, six)
    assertEquals(next.discardPile, Vector.empty)
    assertEquals(next.boutPhase, BoutPhase.InitialAttack)
  }

  test("non-defenders draw after a surrender while the defender does not") {
    val first = card(Rank.Six, Suit.Diamonds)
    val second = card(Rank.Seven, Suit.Diamonds)
    val bottom = card(Rank.Six, Suit.Hearts)
    val gs = threePlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs), card(Rank.King, Suit.Clubs),
        card(Rank.Queen, Suit.Clubs), card(Rank.Jack, Suit.Clubs), card(Rank.Ten, Suit.Clubs)),
      defenderHand = List(card(Rank.King, Suit.Hearts), card(Rank.Queen, Suit.Hearts),
        card(Rank.Jack, Suit.Hearts), card(Rank.Nine, Suit.Hearts)),
      thirdHand = List(card(Rank.Queen, Suit.Diamonds), card(Rank.Jack, Suit.Diamonds),
        card(Rank.Ten, Suit.Diamonds), card(Rank.Nine, Suit.Diamonds), card(Rank.Eight, Suit.Diamonds)),
      tablePairs = uncoveredTable,
      talon = Vector(first, second, bottom),
      bottomTrumpCard = Some(bottom)
    )
    // Neither non-defender holds a matching rank, so both are passed by the
    // delayed auto-pass — which is what settles the bout and draws for them.
    val surrendered = GameEngine
      .applyAction(gs, GameAction.DeclareSurrender("p1"))
      .getOrElse(fail("expected a valid surrender"))
    assertEquals(GameEngine.playersNeedingAutoPass(surrendered), Vector("p0", "p2"))

    val next = GameEngine.autoPassSurrenderThrowers(surrendered)

    assertEquals(next.players(0).hand.last, first)
    assertEquals(next.players(0).hand.size, 6)
    assertEquals(next.players(2).hand.last, second)
    assertEquals(next.players(2).hand.size, 6)
    assertEquals(next.players(1).hand.size, 5)
    assertEquals(next.players(1).hand.last, six)
    assertEquals(next.talon, Vector(bottom))
    assertEquals(next.bottomTrumpCard, Some(bottom))
    assertEquals(next.discardPile, Vector.empty)
  }

  test("a surrendering defender is skipped for the next attack") {
    val gs = threePlayer(
      attackerHand = List.fill(5)(card(Rank.Ace, Suit.Clubs)),
      defenderHand = List.fill(4)(card(Rank.King, Suit.Hearts)),
      thirdHand = List.fill(5)(card(Rank.Queen, Suit.Diamonds)),
      tablePairs = uncoveredTable
    )
    // Nobody can throw in, but the surrender only settles after the delayed
    // auto-pass has passed both throwers.
    val surrendered = GameEngine
      .applyAction(gs, GameAction.DeclareSurrender("p1"))
      .getOrElse(fail("expected a valid surrender"))
    assertEquals(surrendered.boutPhase, BoutPhase.SurrenderThrowIn)
    assertEquals(GameEngine.playersNeedingAutoPass(surrendered), Vector("p0", "p2"))

    val next = GameEngine.autoPassSurrenderThrowers(surrendered)

    assertEquals(next.players(next.attackerIdx).id, "p2")
    assertEquals(next.players(next.defenderIdx).id, "p0")
    assertEquals(next.boutPhase, BoutPhase.InitialAttack)
    assertEquals(next.defenderInitialHandSize, next.players(next.defenderIdx).hand.size)
  }

  // --- Three-player role rotation ---

  test("successful defense cycles the attack clockwise through a three-player game") {
    val gs = threePlayer(
      attackerHand = List.fill(5)(card(Rank.Ace, Suit.Clubs)),
      defenderHand = List.fill(5)(card(Rank.King, Suit.Hearts)),
      thirdHand = List.fill(5)(card(Rank.Queen, Suit.Diamonds)),
      tablePairs = coveredTable
    )

    val next = pass(pass(gs, "p0"), "p2")

    assertEquals(next.attackerIdx, 1)
    assertEquals(next.defenderIdx, 2)
    assertEquals(next.players(next.attackerIdx).id, "p1")
    assertEquals(next.players(next.defenderIdx).id, "p2")
  }

  test("role rotation skips finished players") {
    val gs = threePlayer(
      attackerHand = List.fill(5)(card(Rank.Ace, Suit.Clubs)),
      defenderHand = List.fill(5)(card(Rank.King, Suit.Hearts)),
      thirdHand = List.fill(5)(card(Rank.Queen, Suit.Diamonds)),
      tablePairs = coveredTable
    )

    val withFinishedThird = gs.copy(
      players = gs.players.updated(2, gs.players(2).copy(finishRank = Some(1)))
    )
    val next = pass(withFinishedThird, "p0")

    assertEquals(next.attackerIdx, 1)
    assertEquals(next.defenderIdx, 0)
  }
