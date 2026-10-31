package durak.engine

class AttackDefenseSuite extends munit.FunSuite:

  private def card(rank: Rank, suit: Suit = Suit.Spades): Card = Card(suit, rank)

  private def player(id: String, hand: List[Card]): PlayerState =
    PlayerState(id = id, name = id.toUpperCase, hand = hand.toVector)

  private def state(
      players: Vector[PlayerState],
      tablePairs: Vector[TablePair] = Vector.empty,
      trumpSuit: Suit = Suit.Spades,
      attackerIdx: Int = 0,
      defenderIdx: Int = 1,
      boutPhase: BoutPhase = BoutPhase.InitialAttack,
      defenderInitialHandSize: Int = 6,
      chaosMode: Boolean = false
  ): GameState =
    GameState(
      config = GameConfig(players.size, seed = 42L, chaosMode = chaosMode),
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

  /** Two-player state in the initial attack phase with the usual seats. */
  private def attacking(
      attackerHand: List[Card],
      defenderHand: List[Card] = List(card(Rank.Six, Suit.Hearts)),
      defenderInitialHandSize: Int = 6
  ): GameState =
    state(
      Vector(
        player("p0", attackerHand),
        player("p1", defenderHand)
      ),
      defenderInitialHandSize = defenderInitialHandSize
    )

  /** Two-player state in the defense phase with the given uncovered attacks on the table. */
  private def defending(
      attackCards: List[Card],
      defenderHand: List[Card],
      trumpSuit: Suit = Suit.Spades,
      tablePairs: Vector[TablePair] = Vector.empty
  ): GameState =
    state(
      Vector(
        player("p0", List(card(Rank.Six, Suit.Hearts))),
        player("p1", defenderHand)
      ),
      tablePairs = if tablePairs.isEmpty then attackCards.map(TablePair(_)).toVector else tablePairs,
      trumpSuit = trumpSuit,
      boutPhase = BoutPhase.Defense
    )

  // --- Initial attack ---

  test("a single-card initial attack lands on the table and opens the defense phase") {
    val sixSpades = card(Rank.Six)
    val gs = attacking(List(sixSpades, card(Rank.Seven, Suit.Clubs)))

    val result = GameEngine.applyAction(gs, GameAction.InitialAttack("p0", List(sixSpades)))

    assert(result.isRight, result)
    val next = result.getOrElse(fail("expected a valid attack"))
    assertEquals(next.tablePairs, Vector(TablePair(sixSpades, None)))
    assertEquals(next.boutPhase, BoutPhase.Defense)
    assertEquals(next.players(0).hand, Vector(card(Rank.Seven, Suit.Clubs)))
    assertEquals(next.players(1).hand, gs.players(1).hand)
  }

  test("a multi-card attack of the same rank succeeds") {
    val sixSpades = card(Rank.Six, Suit.Spades)
    val sixHearts = card(Rank.Six, Suit.Hearts)
    val gs = attacking(List(sixSpades, sixHearts, card(Rank.Ace, Suit.Clubs)))

    val result =
      GameEngine.applyAction(gs, GameAction.InitialAttack("p0", List(sixSpades, sixHearts)))

    assert(result.isRight, result)
    val next = result.getOrElse(fail("expected a valid attack"))
    assertEquals(next.tablePairs, Vector(TablePair(sixSpades, None), TablePair(sixHearts, None)))
    assertEquals(next.boutPhase, BoutPhase.Defense)
    assertEquals(next.players(0).hand, Vector(card(Rank.Ace, Suit.Clubs)))
  }

  test("initial attack is rejected when a non-attacker plays") {
    val gs = attacking(List(card(Rank.Six)))

    val result = GameEngine.applyAction(gs, GameAction.InitialAttack("p1", List(card(Rank.Six))))

    assert(result.isLeft, result)
  }

  test("initial attack is rejected outside the initial attack phase") {
    val gs = attacking(List(card(Rank.Six))).copy(boutPhase = BoutPhase.Defense)

    val result = GameEngine.applyAction(gs, GameAction.InitialAttack("p0", List(card(Rank.Six))))

    assert(result.isLeft, result)
  }

  test("initial attack is rejected when a card is not in the attacker's hand") {
    val gs = attacking(List(card(Rank.Six)))

    val result =
      GameEngine.applyAction(gs, GameAction.InitialAttack("p0", List(card(Rank.Ace, Suit.Clubs))))

    assert(result.isLeft, result)
  }

  test("initial attack is rejected when cards have different ranks") {
    val gs = attacking(List(card(Rank.Six), card(Rank.Seven)))

    val result = GameEngine.applyAction(
      gs,
      GameAction.InitialAttack("p0", List(card(Rank.Six), card(Rank.Seven)))
    )

    assert(result.isLeft, result)
  }

  test("initial attack is rejected when it exceeds maxBoutAttacks") {
    val fours = List.fill(3)(card(Rank.Four))
    val gs = attacking(fours, defenderInitialHandSize = 2)

    val result = GameEngine.applyAction(gs, GameAction.InitialAttack("p0", fours))

    assert(result.isLeft, result)
    assertEquals(gs.maxBoutAttacks, 2)
  }

  test("initial attack is rejected when it is empty") {
    val gs = attacking(List(card(Rank.Six)))

    val result = GameEngine.applyAction(gs, GameAction.InitialAttack("p0", Nil))

    assert(result.isLeft, result)
  }

  // --- Chaos mode targeting ---

  test("chaos mode lets the opening attacker choose a non-adjacent defender") {
    val six = card(Rank.Six, Suit.Clubs)
    val gs = state(
      Vector(
        player("p0", List(six, card(Rank.Ace, Suit.Clubs))),
        player("p1", List(card(Rank.Seven, Suit.Hearts))),
        player("p2", List(card(Rank.Eight, Suit.Hearts), card(Rank.Nine, Suit.Hearts)))
      ),
      chaosMode = true
    )

    val result =
      GameEngine.applyAction(gs, GameAction.InitialAttack("p0", List(six), Some("p2")))

    assert(result.isRight, result)
    val next = result.getOrElse(fail("expected a valid chaos attack"))
    assertEquals(next.defenderIdx, 2)
    assertEquals(next.players(next.defenderIdx).id, "p2")
    assertEquals(next.defenderInitialHandSize, 2)
    assertEquals(next.maxBoutAttacks, 2)
    assertEquals(next.tablePairs, Vector(TablePair(six)))
    assertEquals(next.boutPhase, BoutPhase.Defense)
  }

  test("chaos mode defaults to the next clockwise player when no target is given") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Six))),
        player("p1", List(card(Rank.Seven))),
        player("p2", List(card(Rank.Eight)))
      ),
      chaosMode = true
    )

    val result = GameEngine.applyAction(gs, GameAction.InitialAttack("p0", List(card(Rank.Six))))

    assert(result.isRight, result)
    assertEquals(result.toOption.map(_.defenderIdx), Some(1))
  }

  test("chaos mode rejects targeting an inactive or cardless player") {
    val base = state(
      Vector(
        player("p0", List(card(Rank.Six))),
        player("p1", List(card(Rank.Seven))),
        player("p2", Nil)
      ),
      chaosMode = true
    )

    val cardless =
      GameEngine.applyAction(base, GameAction.InitialAttack("p0", List(card(Rank.Six)), Some("p2")))
    val finished = GameEngine.applyAction(
      base.copy(players = base.players.updated(1, base.players(1).copy(finishRank = Some(1)))),
      GameAction.InitialAttack("p0", List(card(Rank.Six)), Some("p1"))
    )

    assert(cardless.isLeft, cardless)
    assert(finished.isLeft, finished)
  }

  test("chaos mode rejects targeting the attacker themselves") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Six))),
        player("p1", List(card(Rank.Seven))),
        player("p2", List(card(Rank.Eight)))
      ),
      chaosMode = true
    )

    val result =
      GameEngine.applyAction(gs, GameAction.InitialAttack("p0", List(card(Rank.Six)), Some("p0")))

    assert(result.isLeft, result)
  }

  test("the opening attack is capped by the chosen defender's hand size") {
    val sixes = List(card(Rank.Six, Suit.Spades), card(Rank.Six, Suit.Hearts))
    val gs = state(
      Vector(
        player("p0", sixes),
        player("p1", List(card(Rank.Seven))),
        player("p2", List(card(Rank.Eight, Suit.Clubs)))
      ),
      chaosMode = true
    )

    val tooMany =
      GameEngine.applyAction(gs, GameAction.InitialAttack("p0", sixes, Some("p2")))
    val single =
      GameEngine.applyAction(gs, GameAction.InitialAttack("p0", List(sixes.head), Some("p2")))

    assert(tooMany.isLeft, tooMany)
    assert(single.isRight, single)
    assertEquals(single.toOption.map(_.maxBoutAttacks), Some(1))
  }

  test("standard mode rejects an explicit non-adjacent target") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Six))),
        player("p1", List(card(Rank.Seven))),
        player("p2", List(card(Rank.Eight)))
      )
    )

    val result =
      GameEngine.applyAction(gs, GameAction.InitialAttack("p0", List(card(Rank.Six)), Some("p2")))

    assert(result.isLeft, result)
  }

  test("standard mode accepts naming the natural defender explicitly") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Six))),
        player("p1", List(card(Rank.Seven))),
        player("p2", List(card(Rank.Eight)))
      )
    )

    val result =
      GameEngine.applyAction(gs, GameAction.InitialAttack("p0", List(card(Rank.Six)), Some("p1")))

    assert(result.isRight, result)
    assertEquals(result.toOption.map(_.defenderIdx), Some(1))
  }

  // --- Cover card ---

  test("a same-suit higher rank covers the attack") {
    val attack = card(Rank.Six, Suit.Clubs)
    val cover = card(Rank.Eight, Suit.Clubs)
    val gs = defending(List(attack), List(cover, card(Rank.Nine, Suit.Hearts)))

    val result = GameEngine.applyAction(gs, GameAction.CoverCard("p1", 0, cover))

    assert(result.isRight, result)
    val next = result.getOrElse(fail("expected a valid cover"))
    assertEquals(next.tablePairs, Vector(TablePair(attack, Some(cover))))
    assertEquals(next.players(1).hand, Vector(card(Rank.Nine, Suit.Hearts)))
    assertEquals(next.players(0), gs.players(0))
    assertEquals(next.boutPhase, BoutPhase.Defense)
  }

  test("a trump covers a non-trump attack of any rank") {
    val attack = card(Rank.Ace, Suit.Clubs)
    val trump = card(Rank.Six, Suit.Spades)
    val gs = defending(List(attack), List(trump, card(Rank.Nine, Suit.Hearts)))

    val result = GameEngine.applyAction(gs, GameAction.CoverCard("p1", 0, trump))

    assert(result.isRight, result)
    assertEquals(
      result.getOrElse(fail("expected a valid cover")).tablePairs,
      Vector(TablePair(attack, Some(trump)))
    )
  }

  test("a same-suit lower rank cannot cover") {
    val gs = defending(List(card(Rank.Ten, Suit.Clubs)), List(card(Rank.Nine, Suit.Clubs)))

    val result =
      GameEngine.applyAction(gs, GameAction.CoverCard("p1", 0, card(Rank.Nine, Suit.Clubs)))

    assert(result.isLeft, result)
  }

  test("a different non-trump suit cannot cover") {
    val gs = defending(List(card(Rank.Six, Suit.Clubs)), List(card(Rank.Ace, Suit.Hearts)))

    val result =
      GameEngine.applyAction(gs, GameAction.CoverCard("p1", 0, card(Rank.Ace, Suit.Hearts)))

    assert(result.isLeft, result)
  }

  test("trump over trump still requires a higher rank") {
    val gs = defending(
      List(card(Rank.Ten, Suit.Spades)),
      List(card(Rank.Nine, Suit.Spades)),
      trumpSuit = Suit.Spades
    )

    val result =
      GameEngine.applyAction(gs, GameAction.CoverCard("p1", 0, card(Rank.Nine, Suit.Spades)))

    assert(result.isLeft, result)
  }

  test("covering is rejected when the card is not in the defender's hand") {
    val gs = defending(List(card(Rank.Six, Suit.Clubs)), List(card(Rank.Eight, Suit.Clubs)))

    val result =
      GameEngine.applyAction(gs, GameAction.CoverCard("p1", 0, card(Rank.Ace, Suit.Clubs)))

    assert(result.isLeft, result)
  }

  test("covering an already covered attack is rejected") {
    val attack = card(Rank.Six, Suit.Clubs)
    val gs = defending(
      Nil,
      List(card(Rank.Nine, Suit.Clubs)),
      tablePairs = Vector(TablePair(attack, Some(card(Rank.Eight, Suit.Clubs))))
    )

    val result =
      GameEngine.applyAction(gs, GameAction.CoverCard("p1", 0, card(Rank.Nine, Suit.Clubs)))

    assert(result.isLeft, result)
  }

  test("covering is rejected when the attack index is out of range") {
    val gs = defending(List(card(Rank.Six, Suit.Clubs)), List(card(Rank.Eight, Suit.Clubs)))

    val result =
      GameEngine.applyAction(gs, GameAction.CoverCard("p1", 5, card(Rank.Eight, Suit.Clubs)))

    assert(result.isLeft, result)
  }

  test("covering is rejected when the actor is not the defender") {
    val gs = defending(List(card(Rank.Six, Suit.Clubs)), List(card(Rank.Eight, Suit.Clubs)))

    val result =
      GameEngine.applyAction(gs, GameAction.CoverCard("p0", 0, card(Rank.Eight, Suit.Clubs)))

    assert(result.isLeft, result)
  }

  test("covering is rejected outside the defense phase") {
    val gs =
      defending(List(card(Rank.Six, Suit.Clubs)), List(card(Rank.Eight, Suit.Clubs)))
        .copy(boutPhase = BoutPhase.InitialAttack)

    val result =
      GameEngine.applyAction(gs, GameAction.CoverCard("p1", 0, card(Rank.Eight, Suit.Clubs)))

    assert(result.isLeft, result)
  }

  test("covering a later pair leaves earlier pairs untouched") {
    val first = TablePair(card(Rank.Six, Suit.Clubs), Some(card(Rank.Seven, Suit.Clubs)))
    val second = card(Rank.Six, Suit.Hearts)
    val cover = card(Rank.Eight, Suit.Hearts)
    val gs = defending(
      Nil,
      List(cover),
      tablePairs = Vector(first, TablePair(second))
    )

    val result = GameEngine.applyAction(gs, GameAction.CoverCard("p1", 1, cover))

    assert(result.isRight, result)
    assertEquals(
      result.getOrElse(fail("expected a valid cover")).tablePairs,
      Vector(first, TablePair(second, Some(cover)))
    )
  }
