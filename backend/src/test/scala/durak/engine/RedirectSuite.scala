package durak.engine

class RedirectSuite extends munit.FunSuite:

  private def card(rank: Rank, suit: Suit = Suit.Spades): Card = Card(suit, rank)

  private def player(id: String, hand: List[Card], hasPassed: Boolean = false): PlayerState =
    PlayerState(id = id, name = id.toUpperCase, hand = hand.toVector, hasPassed = hasPassed)

  private def state(
      players: Vector[PlayerState],
      tablePairs: Vector[TablePair],
      attackerIdx: Int = 0,
      defenderIdx: Int = 1,
      allowRedirect: Boolean = true,
      trumpSuit: Suit = Suit.Spades,
      boutPhase: BoutPhase = BoutPhase.Defense,
      defenderInitialHandSize: Int = 6
  ): GameState =
    GameState(
      config = GameConfig(players.size, allowRedirect = allowRedirect, seed = 42L),
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
      allowRedirect: Boolean = true
  ): GameState =
    state(
      Vector(player("p0", attackerHand), player("p1", defenderHand)),
      tablePairs,
      allowRedirect = allowRedirect
    )

  /** Three-player defense state: p0 attacks, p1 defends, p2 sits clockwise after p1. */
  private def threePlayer(
      attackerHand: List[Card],
      defenderHand: List[Card],
      nextHand: List[Card],
      tablePairs: Vector[TablePair]
  ): GameState =
    state(
      Vector(
        player("p0", attackerHand),
        player("p1", defenderHand),
        player("p2", nextHand)
      ),
      tablePairs
    )

  // --- Valid redirects ---

  test("a 2-player redirect swaps the roles and moves the card to the table") {
    val sixSpades = card(Rank.Six, Suit.Spades)
    val sixHearts = card(Rank.Six, Suit.Hearts)
    val filler = card(Rank.King, Suit.Clubs)
    val gs = twoPlayer(
      attackerHand = List(filler, card(Rank.Queen, Suit.Clubs)),
      defenderHand = List(sixHearts, filler),
      tablePairs = Vector(TablePair(sixSpades))
    )

    val result = GameEngine.applyAction(gs, GameAction.RedirectAttack("p1", List(sixHearts)))

    assert(result.isRight, result)
    val next = result.getOrElse(fail("expected a valid redirect"))
    assertEquals(next.tablePairs, Vector(TablePair(sixSpades), TablePair(sixHearts)))
    assertEquals(next.attackerIdx, 1)
    assertEquals(next.defenderIdx, 0)
    assertEquals(next.players(1).hand, Vector(filler))
    assertEquals(next.players(0).hand, gs.players(0).hand)
    assertEquals(next.boutPhase, BoutPhase.Defense)
    assertEquals(next.defenderInitialHandSize, gs.players(0).hand.size)
  }

  test("a 3-player redirect passes the defense to the next clockwise player") {
    val sixSpades = card(Rank.Six, Suit.Spades)
    val sixHearts = card(Rank.Six, Suit.Hearts)
    val gs = threePlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs), card(Rank.King, Suit.Clubs)),
      defenderHand = List(sixHearts, card(Rank.King, Suit.Hearts)),
      nextHand = List(card(Rank.Ace, Suit.Spades), card(Rank.King, Suit.Diamonds)),
      tablePairs = Vector(TablePair(sixSpades))
    )

    val result = GameEngine.applyAction(gs, GameAction.RedirectAttack("p1", List(sixHearts)))

    assert(result.isRight, result)
    val next = result.getOrElse(fail("expected a valid redirect"))
    assertEquals(next.attackerIdx, 1)
    assertEquals(next.defenderIdx, 2)
    assertEquals(next.tablePairs, Vector(TablePair(sixSpades), TablePair(sixHearts)))
    assertEquals(next.players(1).hand, Vector(card(Rank.King, Suit.Hearts)))
  }

  test("multiple same-rank redirect cards are all added to the table") {
    val sixSpades = card(Rank.Six, Suit.Spades)
    val sixHearts = card(Rank.Six, Suit.Hearts)
    val sixClubs = card(Rank.Six, Suit.Clubs)
    val gs = threePlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs), card(Rank.King, Suit.Clubs)),
      defenderHand = List(sixHearts, sixClubs, card(Rank.King, Suit.Hearts)),
      nextHand = List(card(Rank.Ace, Suit.Spades), card(Rank.King, Suit.Diamonds), card(Rank.Queen, Suit.Diamonds)),
      tablePairs = Vector(TablePair(sixSpades))
    )

    val result =
      GameEngine.applyAction(gs, GameAction.RedirectAttack("p1", List(sixHearts, sixClubs)))

    assert(result.isRight, result)
    val next = result.getOrElse(fail("expected a valid redirect"))
    assertEquals(next.tablePairs.map(_.attack), Vector(sixSpades, sixHearts, sixClubs))
    assertEquals(next.players(1).hand, Vector(card(Rank.King, Suit.Hearts)))
    assertEquals(next.defenderInitialHandSize, 3)
  }

  // --- Rejections ---

  test("redirect is rejected when the game disables it") {
    val sixSpades = card(Rank.Six, Suit.Spades)
    val sixHearts = card(Rank.Six, Suit.Hearts)
    val gs = twoPlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs), card(Rank.King, Suit.Clubs)),
      defenderHand = List(sixHearts),
      tablePairs = Vector(TablePair(sixSpades)),
      allowRedirect = false
    )

    val result = GameEngine.applyAction(gs, GameAction.RedirectAttack("p1", List(sixHearts)))

    assert(result.isLeft, result)
    assertEquals(gs.config.allowRedirect, false)
  }

  test("redirect is rejected when a card on the table is already covered") {
    val sixSpades = card(Rank.Six, Suit.Spades)
    val sixHearts = card(Rank.Six, Suit.Hearts)
    val coveredTable = Vector(TablePair(sixSpades, Some(card(Rank.Eight, Suit.Spades))))
    val gs = twoPlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs), card(Rank.King, Suit.Clubs)),
      defenderHand = List(sixHearts),
      tablePairs = coveredTable
    )

    val result = GameEngine.applyAction(gs, GameAction.RedirectAttack("p1", List(sixHearts)))

    assert(result.isLeft, result)
  }

  test("redirect is rejected when the cards do not match the attacking rank") {
    val sixSpades = card(Rank.Six, Suit.Spades)
    val gs = twoPlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs), card(Rank.King, Suit.Clubs)),
      defenderHand = List(card(Rank.Seven, Suit.Hearts)),
      tablePairs = Vector(TablePair(sixSpades))
    )

    val result =
      GameEngine.applyAction(gs, GameAction.RedirectAttack("p1", List(card(Rank.Seven, Suit.Hearts))))

    assert(result.isLeft, result)
  }

  test("redirect is rejected when the redirect cards have mixed ranks") {
    val sixSpades = card(Rank.Six, Suit.Spades)
    val sixHearts = card(Rank.Six, Suit.Hearts)
    val gs = twoPlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs), card(Rank.King, Suit.Clubs)),
      defenderHand = List(sixHearts, card(Rank.Seven, Suit.Hearts)),
      tablePairs = Vector(TablePair(sixSpades))
    )

    val result = GameEngine.applyAction(
      gs,
      GameAction.RedirectAttack("p1", List(sixHearts, card(Rank.Seven, Suit.Hearts)))
    )

    assert(result.isLeft, result)
  }

  test("redirect is rejected when the next defender has too few cards") {
    val sixSpades = card(Rank.Six, Suit.Spades)
    val sixHearts = card(Rank.Six, Suit.Hearts)
    val gs = twoPlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs)),
      defenderHand = List(sixHearts),
      tablePairs = Vector(TablePair(sixSpades))
    )

    val result = GameEngine.applyAction(gs, GameAction.RedirectAttack("p1", List(sixHearts)))

    assert(result.isLeft, result)
  }

  test("redirect is rejected when the total would exceed six attacking cards") {
    val attacks = List(
      card(Rank.Six, Suit.Spades),
      card(Rank.Six, Suit.Hearts),
      card(Rank.Six, Suit.Clubs),
      card(Rank.Six, Suit.Diamonds),
      card(Rank.Six, Suit.Spades)
    )
    val redirectCards = List(card(Rank.Six, Suit.Hearts), card(Rank.Six, Suit.Diamonds))
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Ace, Suit.Clubs))),
        player("p1", redirectCards),
        player("p2", List.fill(10)(card(Rank.King, Suit.Clubs)))
      ),
      tablePairs = attacks.map(TablePair(_)).toVector
    )

    val result = GameEngine.applyAction(gs, GameAction.RedirectAttack("p1", redirectCards))

    assert(result.isLeft, result)
  }

  test("redirect is rejected when a card is not in the defender's hand") {
    val sixSpades = card(Rank.Six, Suit.Spades)
    val gs = twoPlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs), card(Rank.King, Suit.Clubs)),
      defenderHand = List(card(Rank.King, Suit.Hearts)),
      tablePairs = Vector(TablePair(sixSpades))
    )

    val result =
      GameEngine.applyAction(gs, GameAction.RedirectAttack("p1", List(card(Rank.Six, Suit.Hearts))))

    assert(result.isLeft, result)
  }

  test("redirect is rejected when the actor is not the defender") {
    val sixSpades = card(Rank.Six, Suit.Spades)
    val sixHearts = card(Rank.Six, Suit.Hearts)
    val gs = twoPlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs), card(Rank.King, Suit.Clubs)),
      defenderHand = List(sixHearts),
      tablePairs = Vector(TablePair(sixSpades))
    )

    val result = GameEngine.applyAction(gs, GameAction.RedirectAttack("p0", List(sixHearts)))

    assert(result.isLeft, result)
  }

  test("redirect is rejected outside the defense phase") {
    val sixSpades = card(Rank.Six, Suit.Spades)
    val sixHearts = card(Rank.Six, Suit.Hearts)
    val gs = twoPlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs), card(Rank.King, Suit.Clubs)),
      defenderHand = List(sixHearts),
      tablePairs = Vector(TablePair(sixSpades))
    ).copy(boutPhase = BoutPhase.InitialAttack)

    val result = GameEngine.applyAction(gs, GameAction.RedirectAttack("p1", List(sixHearts)))

    assert(result.isLeft, result)
  }

  test("redirect is rejected when it contains no cards") {
    val sixSpades = card(Rank.Six, Suit.Spades)
    val gs = twoPlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs), card(Rank.King, Suit.Clubs)),
      defenderHand = List(card(Rank.Six, Suit.Hearts)),
      tablePairs = Vector(TablePair(sixSpades))
    )

    val result = GameEngine.applyAction(gs, GameAction.RedirectAttack("p1", Nil))

    assert(result.isLeft, result)
  }

  // --- Role rotation details ---

  test("role rotation is correct after a redirect (old defender attacks, next clockwise defends)") {
    val sixSpades = card(Rank.Six, Suit.Spades)
    val sixHearts = card(Rank.Six, Suit.Hearts)
    val gs = threePlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs), card(Rank.King, Suit.Clubs)),
      defenderHand = List(sixHearts),
      nextHand = List(card(Rank.Ace, Suit.Spades), card(Rank.King, Suit.Diamonds)),
      tablePairs = Vector(TablePair(sixSpades))
    )

    val result = GameEngine.applyAction(gs, GameAction.RedirectAttack("p1", List(sixHearts)))

    assert(result.isRight, result)
    val next = result.getOrElse(fail("expected a valid redirect"))
    assertEquals(next.players(next.attackerIdx).id, "p1")
    assertEquals(next.players(next.defenderIdx).id, "p2")
  }

  test("defenderInitialHandSize becomes the new defender's hand size after a redirect") {
    val sixSpades = card(Rank.Six, Suit.Spades)
    val sixHearts = card(Rank.Six, Suit.Hearts)
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Ace, Suit.Clubs))),
        player("p1", List(sixHearts)),
        player(
          "p2",
          List(
            card(Rank.Ace, Suit.Spades),
            card(Rank.King, Suit.Diamonds),
            card(Rank.Queen, Suit.Diamonds),
            card(Rank.Jack, Suit.Diamonds)
          )
        )
      ),
      tablePairs = Vector(TablePair(sixSpades)),
      defenderInitialHandSize = 6
    )

    val result = GameEngine.applyAction(gs, GameAction.RedirectAttack("p1", List(sixHearts)))

    assert(result.isRight, result)
    val next = result.getOrElse(fail("expected a valid redirect"))
    assertEquals(next.defenderInitialHandSize, 4)
    assertEquals(next.maxBoutAttacks, 4)
  }

  test("a redirect resets every player's passed flag") {
    val sixSpades = card(Rank.Six, Suit.Spades)
    val sixHearts = card(Rank.Six, Suit.Hearts)
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Ace, Suit.Clubs)), hasPassed = true),
        player("p1", List(sixHearts), hasPassed = true),
        player("p2", List(card(Rank.Ace, Suit.Spades), card(Rank.King, Suit.Diamonds)), hasPassed = true)
      ),
      tablePairs = Vector(TablePair(sixSpades))
    )

    val result = GameEngine.applyAction(gs, GameAction.RedirectAttack("p1", List(sixHearts)))

    assert(result.isRight, result)
    val next = result.getOrElse(fail("expected a valid redirect"))
    assert(next.players.forall(!_.hasPassed), next.players.map(_.hasPassed))
  }

  test("a 3-player chain redirect sends the attack back to the original attacker") {
    val sixSpades = card(Rank.Six, Suit.Spades)
    val sixHearts = card(Rank.Six, Suit.Hearts)
    val sixDiamonds = card(Rank.Six, Suit.Diamonds)
    val originalAttackerHand = List(
      card(Rank.Ace, Suit.Clubs),
      card(Rank.King, Suit.Clubs),
      card(Rank.Queen, Suit.Clubs),
      card(Rank.Jack, Suit.Clubs)
    )
    val gs = threePlayer(
      attackerHand = originalAttackerHand,
      defenderHand = List(sixHearts, card(Rank.King, Suit.Hearts)),
      nextHand = List(sixDiamonds, card(Rank.Ace, Suit.Spades), card(Rank.King, Suit.Diamonds)),
      tablePairs = Vector(TablePair(sixSpades))
    )

    val first = GameEngine.applyAction(gs, GameAction.RedirectAttack("p1", List(sixHearts)))
    assert(first.isRight, first)
    val afterFirst = first.getOrElse(fail("expected the first redirect to succeed"))
    assertEquals(afterFirst.attackerIdx, 1)
    assertEquals(afterFirst.defenderIdx, 2)

    // P2 may redirect only because every table pair is still uncovered.
    val second =
      GameEngine.applyAction(afterFirst, GameAction.RedirectAttack("p2", List(sixDiamonds)))

    assert(second.isRight, second)
    val afterSecond = second.getOrElse(fail("expected the chain redirect to succeed"))
    assertEquals(afterSecond.tablePairs.size, 3)
    assertEquals(afterSecond.players(afterSecond.attackerIdx).id, "p2")
    assertEquals(afterSecond.players(afterSecond.defenderIdx).id, "p0")
    assertEquals(afterSecond.defenderInitialHandSize, originalAttackerHand.size)
    assertEquals(afterSecond.players(2).hand, Vector(card(Rank.Ace, Suit.Spades), card(Rank.King, Suit.Diamonds)))
  }
