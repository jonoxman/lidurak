package durak.engine

class SurrenderThrowInSuite extends munit.FunSuite:

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
      tablePairs: Vector[TablePair],
      attackerIdx: Int = 0,
      defenderIdx: Int = 1,
      trumpSuit: Suit = Suit.Spades,
      boutPhase: BoutPhase = BoutPhase.Defense,
      defenderInitialHandSize: Int = 6
  ): GameState =
    GameState(
      config = GameConfig(players.size, seed = 42L),
      players = players,
      talon = Vector.empty,
      trumpSuit = trumpSuit,
      bottomTrumpCard = None,
      discardPile = Vector.empty,
      tablePairs = tablePairs,
      attackerIdx = attackerIdx,
      defenderIdx = defenderIdx,
      boutPhase = boutPhase,
      defenderInitialHandSize = defenderInitialHandSize,
      finishOrder = Vector.empty
    )

  /** Two-player defense state: p0 attacks, p1 defends. */
  private def twoPlayer(
      attackerHand: List[Card],
      defenderHand: List[Card],
      tablePairs: Vector[TablePair],
      attackerPassed: Boolean = false,
      defenderInitialHandSize: Int = 6,
      boutPhase: BoutPhase = BoutPhase.Defense
  ): GameState =
    state(
      Vector(
        player("p0", attackerHand, hasPassed = attackerPassed),
        player("p1", defenderHand)
      ),
      tablePairs,
      boutPhase = boutPhase,
      defenderInitialHandSize = defenderInitialHandSize
    )

  /** Three-player defense state: p0 attacks, p1 defends, p2 sits clockwise after p1. */
  private def threePlayer(
      attackerHand: List[Card],
      defenderHand: List[Card],
      thirdHand: List[Card],
      tablePairs: Vector[TablePair],
      attackerPassed: Boolean = false,
      thirdPassed: Boolean = false,
      thirdFinishRank: Option[Int] = None,
      boutPhase: BoutPhase = BoutPhase.Defense,
      defenderInitialHandSize: Int = 6
  ): GameState =
    state(
      Vector(
        player("p0", attackerHand, hasPassed = attackerPassed),
        player("p1", defenderHand),
        player("p2", thirdHand, hasPassed = thirdPassed, finishRank = thirdFinishRank)
      ),
      tablePairs,
      boutPhase = boutPhase,
      defenderInitialHandSize = defenderInitialHandSize
    )

  // --- Surrender ---

  test("a valid surrender opens the surrender throw-in phase") {
    val attack = card(Rank.Six, Suit.Spades)
    val gs = twoPlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs)),
      defenderHand = List(card(Rank.Seven, Suit.Hearts)),
      tablePairs = Vector(TablePair(attack))
    )

    val result = GameEngine.applyAction(gs, GameAction.DeclareSurrender("p1"))

    assert(result.isRight, result)
    val next = result.getOrElse(fail("expected a valid surrender"))
    assertEquals(next.boutPhase, BoutPhase.SurrenderThrowIn)
    assertEquals(next.tablePairs, gs.tablePairs)
    assertEquals(next.players(1).hand, gs.players(1).hand)
  }

  test("a non-defender cannot surrender") {
    val gs = twoPlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs)),
      defenderHand = List(card(Rank.Seven, Suit.Hearts)),
      tablePairs = Vector(TablePair(card(Rank.Six, Suit.Spades)))
    )

    val result = GameEngine.applyAction(gs, GameAction.DeclareSurrender("p0"))

    assert(result.isLeft, result)
  }

  test("surrender is rejected outside the defense phase") {
    val gs = twoPlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs)),
      defenderHand = List(card(Rank.Seven, Suit.Hearts)),
      tablePairs = Vector(TablePair(card(Rank.Six, Suit.Spades))),
      boutPhase = BoutPhase.InitialAttack
    )

    val result = GameEngine.applyAction(gs, GameAction.DeclareSurrender("p1"))

    assert(result.isLeft, result)
  }

  test("surrender is rejected when every attacking card is already covered") {
    val gs = twoPlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs)),
      defenderHand = List(card(Rank.Seven, Suit.Hearts)),
      tablePairs = Vector(
        TablePair(card(Rank.Six, Suit.Spades), Some(card(Rank.Eight, Suit.Spades)))
      )
    )

    val result = GameEngine.applyAction(gs, GameAction.DeclareSurrender("p1"))

    assert(result.isLeft, result)
  }

  test("surrender auto-passes cardless non-defenders and keeps the rest unpassed") {
    val gs = threePlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs)),
      defenderHand = List(card(Rank.Seven, Suit.Hearts)),
      thirdHand = Nil,
      tablePairs = Vector(TablePair(card(Rank.Six, Suit.Spades))),
      attackerPassed = true,
      thirdPassed = false
    )

    val result = GameEngine.applyAction(gs, GameAction.DeclareSurrender("p1"))

    assert(result.isRight, result)
    val next = result.getOrElse(fail("expected a valid surrender"))
    assertEquals(next.players(0).hasPassed, false)
    assertEquals(next.players(2).hasPassed, true)
    assertEquals(next.players(1).hasPassed, false)
  }

  test("surrender auto-passes every non-defender once the bout is full") {
    val attacks = Vector(
      TablePair(card(Rank.Six, Suit.Spades)),
      TablePair(card(Rank.Six, Suit.Hearts))
    )
    val gs = threePlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs)),
      defenderHand = List(card(Rank.Seven, Suit.Hearts)),
      thirdHand = List(card(Rank.Six, Suit.Clubs)),
      tablePairs = attacks,
      defenderInitialHandSize = 2
    )

    val result = GameEngine.applyAction(gs, GameAction.DeclareSurrender("p1"))

    assert(result.isRight, result)
    val next = result.getOrElse(fail("expected a valid surrender"))
    assertEquals(next.maxBoutAttacks, 2)
    assertEquals(next.players(0).hasPassed, true)
    assertEquals(next.players(2).hasPassed, true)
  }

  // --- Throw-ins ---

  test("a matching card can be thrown in during the defense phase") {
    val attack = card(Rank.Six, Suit.Spades)
    val thrown = card(Rank.Six, Suit.Hearts)
    val gs = twoPlayer(
      attackerHand = List(thrown, card(Rank.Ace, Suit.Clubs)),
      defenderHand = List(
        card(Rank.Seven, Suit.Spades),
        card(Rank.Eight, Suit.Spades),
        card(Rank.Nine, Suit.Spades)
      ),
      tablePairs = Vector(TablePair(attack))
    )

    val result = GameEngine.applyAction(gs, GameAction.ThrowInCards("p0", List(thrown)))

    assert(result.isRight, result)
    val next = result.getOrElse(fail("expected a valid throw-in"))
    assertEquals(next.tablePairs, Vector(TablePair(attack), TablePair(thrown)))
    assertEquals(next.players(0).hand, Vector(card(Rank.Ace, Suit.Clubs)))
    assertEquals(next.boutPhase, BoutPhase.Defense)
  }

  test("a throw-in card may match the rank of a covering card") {
    val six = card(Rank.Six, Suit.Spades)
    val cover = card(Rank.Nine, Suit.Spades)
    val thrown = card(Rank.Nine, Suit.Hearts)
    val gs = twoPlayer(
      attackerHand = List(thrown, card(Rank.Ace, Suit.Clubs)),
      defenderHand = List(card(Rank.Eight, Suit.Spades)),
      tablePairs = Vector(TablePair(six, Some(cover)))
    )

    val result = GameEngine.applyAction(gs, GameAction.ThrowInCards("p0", List(thrown)))

    assert(result.isRight, result)
    assertEquals(
      result.getOrElse(fail("expected a valid throw-in")).tablePairs,
      Vector(TablePair(six, Some(cover)), TablePair(thrown))
    )
  }

  test("a valid throw-in is allowed during the surrender throw-in phase") {
    val attack = card(Rank.Six, Suit.Spades)
    val thrown = card(Rank.Six, Suit.Diamonds)
    val gs = twoPlayer(
      attackerHand = List(thrown, card(Rank.Ace, Suit.Clubs)),
      defenderHand = List(card(Rank.Seven, Suit.Hearts)),
      tablePairs = Vector(TablePair(attack)),
      boutPhase = BoutPhase.SurrenderThrowIn
    )

    val result = GameEngine.applyAction(gs, GameAction.ThrowInCards("p0", List(thrown)))

    assert(result.isRight, result)
    val next = result.getOrElse(fail("expected a valid throw-in"))
    assertEquals(next.tablePairs, Vector(TablePair(attack), TablePair(thrown)))
    assertEquals(next.boutPhase, BoutPhase.SurrenderThrowIn)
  }

  test("a non-attacker, non-defender may throw in during a three-player bout") {
    val attack = card(Rank.Six, Suit.Spades)
    val thrown = card(Rank.Six, Suit.Clubs)
    val gs = threePlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs)),
      defenderHand = List(
        card(Rank.Seven, Suit.Spades),
        card(Rank.Eight, Suit.Spades)
      ),
      thirdHand = List(thrown, card(Rank.King, Suit.Diamonds)),
      tablePairs = Vector(TablePair(attack))
    )

    val result = GameEngine.applyAction(gs, GameAction.ThrowInCards("p2", List(thrown)))

    assert(result.isRight, result)
    val next = result.getOrElse(fail("expected a valid throw-in"))
    assertEquals(next.players(2).hand, Vector(card(Rank.King, Suit.Diamonds)))
    assertEquals(next.tablePairs.map(_.attack), Vector(attack, thrown))
  }

  test("the defender cannot throw in cards") {
    val gs = twoPlayer(
      attackerHand = List(card(Rank.Six, Suit.Clubs)),
      defenderHand = List(card(Rank.Six, Suit.Hearts)),
      tablePairs = Vector(TablePair(card(Rank.Six, Suit.Spades)))
    )

    val result =
      GameEngine.applyAction(gs, GameAction.ThrowInCards("p1", List(card(Rank.Six, Suit.Hearts))))

    assert(result.isLeft, result)
  }

  test("a throw-in card with a rank absent from the table is rejected") {
    val gs = twoPlayer(
      attackerHand = List(card(Rank.Seven, Suit.Hearts)),
      defenderHand = List(card(Rank.Eight, Suit.Hearts)),
      tablePairs = Vector(TablePair(card(Rank.Six, Suit.Spades)))
    )

    val result =
      GameEngine.applyAction(gs, GameAction.ThrowInCards("p0", List(card(Rank.Seven, Suit.Hearts))))

    assert(result.isLeft, result)
  }

  test("a throw-in that would exceed maxBoutAttacks is rejected") {
    val attacks = Vector(
      TablePair(card(Rank.Six, Suit.Spades)),
      TablePair(card(Rank.Six, Suit.Hearts))
    )
    val gs = twoPlayer(
      attackerHand = List(card(Rank.Six, Suit.Clubs)),
      defenderHand = List(
        card(Rank.Seven, Suit.Spades),
        card(Rank.Eight, Suit.Spades),
        card(Rank.Nine, Suit.Spades)
      ),
      tablePairs = attacks,
      defenderInitialHandSize = 2
    )

    val result =
      GameEngine.applyAction(gs, GameAction.ThrowInCards("p0", List(card(Rank.Six, Suit.Clubs))))

    assert(result.isLeft, result)
    assertEquals(gs.maxBoutAttacks, 2)
  }

  test("a throw-in of cards missing from the player's hand is rejected") {
    val gs = twoPlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs)),
      defenderHand = List(card(Rank.Eight, Suit.Hearts)),
      tablePairs = Vector(TablePair(card(Rank.Six, Suit.Spades)))
    )

    val result =
      GameEngine.applyAction(gs, GameAction.ThrowInCards("p0", List(card(Rank.Six, Suit.Hearts))))

    assert(result.isLeft, result)
  }

  test("a throw-in is rejected outside defense and surrender phases") {
    val thrown = card(Rank.Six, Suit.Hearts)
    val gs = twoPlayer(
      attackerHand = List(thrown),
      defenderHand = List(card(Rank.Eight, Suit.Hearts)),
      tablePairs = Vector(TablePair(card(Rank.Six, Suit.Spades))),
      boutPhase = BoutPhase.InitialAttack
    )

    val result = GameEngine.applyAction(gs, GameAction.ThrowInCards("p0", List(thrown)))

    assert(result.isLeft, result)
  }

  test("a throw-in from a finished player is rejected") {
    val thrown = card(Rank.Six, Suit.Clubs)
    val gs = threePlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs)),
      defenderHand = List(card(Rank.Eight, Suit.Spades)),
      thirdHand = List(thrown),
      tablePairs = Vector(TablePair(card(Rank.Six, Suit.Spades))),
      thirdFinishRank = Some(1)
    )

    val result = GameEngine.applyAction(gs, GameAction.ThrowInCards("p2", List(thrown)))

    assert(result.isLeft, result)
  }

  test("an empty throw-in is rejected") {
    val gs = twoPlayer(
      attackerHand = List(card(Rank.Six, Suit.Clubs)),
      defenderHand = List(card(Rank.Eight, Suit.Spades)),
      tablePairs = Vector(TablePair(card(Rank.Six, Suit.Spades)))
    )

    val result = GameEngine.applyAction(gs, GameAction.ThrowInCards("p0", Nil))

    assert(result.isLeft, result)
  }

  test("a defense-phase throw-in resets every non-defender passed flag") {
    val thrown = card(Rank.Six, Suit.Clubs)
    val gs = threePlayer(
      attackerHand = List(thrown),
      defenderHand = List(
        card(Rank.Seven, Suit.Spades),
        card(Rank.Eight, Suit.Spades)
      ),
      thirdHand = List(card(Rank.King, Suit.Diamonds), card(Rank.Queen, Suit.Diamonds)),
      tablePairs = Vector(TablePair(card(Rank.Six, Suit.Spades))),
      attackerPassed = true,
      thirdPassed = true
    )

    val result = GameEngine.applyAction(gs, GameAction.ThrowInCards("p0", List(thrown)))

    assert(result.isRight, result)
    val next = result.getOrElse(fail("expected a valid throw-in"))
    assertEquals(next.players(0).hasPassed, false)
    assertEquals(next.players(2).hasPassed, false)
  }

  test("a surrender-phase throw-in leaves passed flags untouched") {
    val thrown = card(Rank.Six, Suit.Clubs)
    val gs = threePlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs)),
      defenderHand = List(card(Rank.Seven, Suit.Spades)),
      thirdHand = List(thrown, card(Rank.King, Suit.Diamonds)),
      tablePairs = Vector(TablePair(card(Rank.Six, Suit.Spades))),
      attackerPassed = true,
      thirdPassed = true,
      boutPhase = BoutPhase.SurrenderThrowIn
    )

    val result = GameEngine.applyAction(gs, GameAction.ThrowInCards("p2", List(thrown)))

    assert(result.isRight, result)
    val next = result.getOrElse(fail("expected a valid throw-in"))
    assertEquals(next.players(0).hasPassed, true)
    assertEquals(next.players(2).hasPassed, true)
  }
