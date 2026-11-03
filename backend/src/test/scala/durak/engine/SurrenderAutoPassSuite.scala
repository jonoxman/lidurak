package durak.engine

class SurrenderAutoPassSuite extends munit.FunSuite:

  private def card(rank: Rank, suit: Suit = Suit.Spades): Card = Card(suit, rank)

  private def player(id: String, hand: List[Card], hasPassed: Boolean = false): PlayerState =
    PlayerState(id = id, name = id.toUpperCase, hand = hand.toVector, hasPassed = hasPassed)

  private def state(
      players: Vector[PlayerState],
      tablePairs: Vector[TablePair],
      attackerIdx: Int = 0,
      defenderIdx: Int = 1,
      boutPhase: BoutPhase = BoutPhase.Defense,
      talon: Vector[Card] = Vector.empty,
      defenderInitialHandSize: Int = 6
  ): GameState =
    GameState(
      config = GameConfig(players.size, seed = 42L),
      players = players,
      talon = talon,
      trumpSuit = Suit.Spades,
      bottomTrumpCard = None,
      discardPile = Vector.empty,
      tablePairs = tablePairs,
      attackerIdx = attackerIdx,
      defenderIdx = defenderIdx,
      boutPhase = boutPhase,
      defenderInitialHandSize = defenderInitialHandSize,
      finishOrder = Vector.empty
    )

  private def threePlayer(
      attackerHand: List[Card],
      defenderHand: List[Card],
      thirdHand: List[Card],
      tablePairs: Vector[TablePair],
      boutPhase: BoutPhase = BoutPhase.Defense,
      defenderInitialHandSize: Int = 6
  ): GameState =
    state(
      Vector(
        player("p0", attackerHand),
        player("p1", defenderHand),
        player("p2", thirdHand)
      ),
      tablePairs,
      boutPhase = boutPhase,
      defenderInitialHandSize = defenderInitialHandSize
    )

  private val sixSpades = card(Rank.Six, Suit.Spades)
  private val sixHearts = card(Rank.Six, Suit.Hearts)
  private val sixClubs = card(Rank.Six, Suit.Clubs)

  // --- The throw-in predicate ---

  test("a seat with a matching rank can throw in") {
    val gs = threePlayer(
      attackerHand = List(sixHearts, card(Rank.Ace, Suit.Clubs)),
      // The defender must still be able to answer one more attacking card.
      defenderHand = List(card(Rank.Seven, Suit.Hearts), card(Rank.Eight, Suit.Hearts)),
      thirdHand = List(card(Rank.King, Suit.Diamonds)),
      tablePairs = Vector(TablePair(sixSpades))
    )

    assertEquals(GameEngine.canPlayerThrowIn(gs, 0), true)
    assertEquals(GameEngine.canPlayerThrowIn(gs, 2), false)
  }

  test("the defender can never throw in") {
    val gs = threePlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs)),
      defenderHand = List(sixHearts),
      thirdHand = List(sixClubs),
      tablePairs = Vector(TablePair(sixSpades))
    )

    assertEquals(GameEngine.canPlayerThrowIn(gs, 1), false)
  }

  test("a full bout leaves no room for another throw-in") {
    val gs = threePlayer(
      attackerHand = List(sixHearts),
      defenderHand = List(card(Rank.Seven, Suit.Hearts)),
      thirdHand = List(sixClubs),
      tablePairs = Vector(TablePair(sixSpades)),
      defenderInitialHandSize = 1
    )

    assertEquals(gs.maxBoutAttacks, 1)
    assertEquals(GameEngine.canPlayerThrowIn(gs, 0), false)
    assertEquals(GameEngine.canPlayerThrowIn(gs, 2), false)
  }

  test("a finished seat cannot throw in") {
    val base = threePlayer(
      attackerHand = List(sixHearts),
      defenderHand = List(card(Rank.Seven, Suit.Hearts)),
      thirdHand = List(sixClubs),
      tablePairs = Vector(TablePair(sixSpades))
    )
    val gs = base.copy(players = base.players.updated(0, base.players(0).copy(finishRank = Some(1))))

    assertEquals(GameEngine.canPlayerThrowIn(gs, 0), false)
  }

  // --- Delayed settlement (ITEM-PREV-4b: 1-second auto-pass) ---

  test("a surrender keeps the cards on the table when nobody holds a matching rank") {
    val gs = threePlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs)),
      defenderHand = List(card(Rank.Seven, Suit.Hearts), card(Rank.Eight, Suit.Hearts)),
      thirdHand = List(card(Rank.King, Suit.Diamonds)),
      tablePairs = Vector(TablePair(sixSpades))
    )

    val result = GameEngine.applyAction(gs, GameAction.DeclareSurrender("p1"))

    assert(result.isRight, result)
    val surrendered = result.getOrElse(fail("expected a valid surrender"))
    // Nobody can throw in, yet nobody is passed at 0 ms: the half-off cards
    // stay on the felt until the server's 1-second auto-pass delay elapses.
    assertEquals(surrendered.boutPhase, BoutPhase.SurrenderThrowIn)
    assertEquals(surrendered.tablePairs, gs.tablePairs)
    assertEquals(GameEngine.playersNeedingAutoPass(surrendered), Vector("p0", "p2"))
    assert(surrendered.players.forall(!_.hasPassed), surrendered.players.map(_.hasPassed))
    assertEquals(surrendered.promptedPlayerIds, Set("p0", "p2"))

    // The delayed auto-pass is what settles the bout.
    val next = GameEngine.autoPassSurrenderThrowers(surrendered)
    assertEquals(next.boutPhase, BoutPhase.InitialAttack)
    assertEquals(next.tablePairs, Vector.empty)
    assertEquals(next.discardPile, Vector.empty)
    assertEquals(next.players(1).hand.toSet, Set(card(Rank.Seven, Suit.Hearts), sixSpades, card(Rank.Eight, Suit.Hearts)))
    assert(next.players.forall(!_.hasPassed), next.players.map(_.hasPassed))
  }

  test("a surrender stays open while a thrower still holds a matching rank") {
    val gs = threePlayer(
      attackerHand = List(sixHearts, card(Rank.Ace, Suit.Clubs)),
      defenderHand = List(card(Rank.Seven, Suit.Hearts)),
      thirdHand = List(card(Rank.King, Suit.Diamonds)),
      tablePairs = Vector(TablePair(sixSpades)),
      defenderInitialHandSize = 6
    )

    val result = GameEngine.applyAction(gs, GameAction.DeclareSurrender("p1"))

    assert(result.isRight, result)
    val next = result.getOrElse(fail("expected a valid surrender"))
    assertEquals(next.boutPhase, BoutPhase.SurrenderThrowIn)
    assertEquals(next.players(0).hasPassed, false)
    // The seat without a matching rank is NOT passed inside the surrender.
    assertEquals(next.players(2).hasPassed, false)
    assertEquals(next.promptedPlayerIds, Set("p0", "p2"))
    assertEquals(GameEngine.playersNeedingAutoPass(next), Vector("p2"))

    // One second later the server passes it, while Alice keeps her throw-in.
    val afterDelay = GameEngine.autoPassSurrenderThrowers(next)
    assertEquals(afterDelay.boutPhase, BoutPhase.SurrenderThrowIn)
    assertEquals(afterDelay.players(0).hasPassed, false)
    assertEquals(afterDelay.players(2).hasPassed, true)
    assertEquals(afterDelay.promptedPlayerIds, Set("p0"))
    assertEquals(GameEngine.playersNeedingAutoPass(afterDelay), Vector.empty)
  }

  test("a throw-in that exhausts the matching cards settles after the delayed auto-pass") {
    val gs = threePlayer(
      attackerHand = List(sixHearts, card(Rank.Ace, Suit.Clubs)),
      defenderHand = List(card(Rank.Seven, Suit.Hearts)),
      // Nobody else holds a six, so p0's throw-in is the bout's last action.
      thirdHand = List(card(Rank.King, Suit.Diamonds), card(Rank.Queen, Suit.Diamonds)),
      tablePairs = Vector(TablePair(sixSpades)),
      boutPhase = BoutPhase.SurrenderThrowIn
    )

    val result = GameEngine.applyAction(gs, GameAction.ThrowInCards("p0", List(sixHearts)))

    assert(result.isRight, result)
    val thrown = result.getOrElse(fail("expected a valid throw-in"))
    // p0 has no second six and p2 cannot throw in either, but both keep their
    // pass window: the throw-in does not settle the bout at 0 ms.
    assertEquals(thrown.boutPhase, BoutPhase.SurrenderThrowIn)
    assertEquals(thrown.tablePairs.size, 2)
    assertEquals(GameEngine.playersNeedingAutoPass(thrown), Vector("p0", "p2"))

    // The delayed auto-pass is the action that ends the bout.
    val next = GameEngine.autoPassSurrenderThrowers(thrown)
    assertEquals(next.boutPhase, BoutPhase.InitialAttack)
    assertEquals(next.tablePairs, Vector.empty)
    assertEquals(next.players(1).hand.toSet, Set(card(Rank.Seven, Suit.Hearts), sixSpades, sixHearts))
  }

  test("the delayed auto-pass resolves the throw-in that ended the matching cards") {
    val gs = threePlayer(
      attackerHand = List(sixHearts, card(Rank.Ace, Suit.Clubs)),
      defenderHand = List(card(Rank.Seven, Suit.Hearts)),
      thirdHand = List(card(Rank.King, Suit.Diamonds), card(Rank.Queen, Suit.Diamonds)),
      tablePairs = Vector(TablePair(sixSpades)),
      boutPhase = BoutPhase.SurrenderThrowIn
    )

    val afterThrowIn = GameEngine
      .applyAction(gs, GameAction.ThrowInCards("p0", List(sixHearts)))
      .getOrElse(fail("expected the throw-in to be legal"))
    // p0 is out of matching cards, but the bout still waits on the auto-pass.
    assertEquals(afterThrowIn.boutPhase, BoutPhase.SurrenderThrowIn)
    assertEquals(afterThrowIn.tablePairs.size, 2)

    val settled = GameEngine.autoPassSurrenderThrowers(afterThrowIn)
    assertEquals(settled.boutPhase, BoutPhase.InitialAttack)
    assertEquals(settled.players(1).hand.toSet, Set(card(Rank.Seven, Suit.Hearts), sixSpades, sixHearts))
  }

  test("a player with no matching rank is passed only after the 1-second delay") {
    val gs = threePlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs)),
      defenderHand = List(card(Rank.Seven, Suit.Hearts)),
      thirdHand = List(card(Rank.King, Suit.Diamonds)),
      tablePairs = Vector(TablePair(sixSpades))
    )

    val surrendered = GameEngine
      .applyAction(gs, GameAction.DeclareSurrender("p1"))
      .getOrElse(fail("expected a valid surrender"))

    // Nobody can throw in, so every non-defender is queued for the delayed
    // auto-pass instead of being passed inside the surrender.
    assertEquals(surrendered.boutPhase, BoutPhase.SurrenderThrowIn)
    assertEquals(surrendered.tablePairs, gs.tablePairs)
    assertEquals(surrendered.players(2).hasPassed, false)
    assertEquals(GameEngine.playersNeedingAutoPass(surrendered), Vector("p0", "p2"))

    val settled = GameEngine.autoPassSurrenderThrowers(surrendered)
    assertEquals(settled.boutPhase, BoutPhase.InitialAttack)
    assertEquals(settled.tablePairs, Vector.empty)
    assert(settled.players(1).hand.nonEmpty, settled.players.toString)
  }

  // --- Durak labelling ---

  test("the last player out is labelled DURAK when the game ends") {
    val gs = state(
      Vector(
        player("p0", List(sixSpades)),
        player("p1", List(card(Rank.King, Suit.Hearts), card(Rank.Queen, Suit.Hearts)))
      ),
      tablePairs = Vector.empty,
      boutPhase = BoutPhase.InitialAttack,
      defenderInitialHandSize = 2
    )

    val attacked = GameEngine
      .applyAction(gs, GameAction.InitialAttack("p0", List(sixSpades)))
      .getOrElse(fail("expected the attack to be legal"))
    val surrendered = GameEngine
      .applyAction(attacked, GameAction.DeclareSurrender("p1"))
      .getOrElse(fail("expected the surrender to be legal"))

    assertEquals(surrendered.boutPhase, BoutPhase.GameOver)
    assertEquals(surrendered.durak, Some("p1"))
    assertEquals(surrendered.players(1).finishRank, Some(2))
    assertEquals(surrendered.winners, List("p0"))
    assertEquals(PlayerGameView.forViewer(surrendered, "p0").durak, Some("p1"))
    assertEquals(PlayerGameView.forViewer(surrendered, "p1").durak, Some("p1"))
  }

  test("a two-player draw keeps the DURAK label off both players") {
    val gs = state(
      Vector(
        player("p0", List(sixSpades)),
        player("p1", List(card(Rank.Seven, Suit.Spades)))
      ),
      tablePairs = Vector.empty,
      boutPhase = BoutPhase.InitialAttack,
      defenderInitialHandSize = 1
    )

    val attacked = GameEngine
      .applyAction(gs, GameAction.InitialAttack("p0", List(sixSpades)))
      .getOrElse(fail("expected the attack to be legal"))
    val covered = GameEngine
      .applyAction(attacked, GameAction.CoverCard("p1", 0, card(Rank.Seven, Suit.Spades)))
      .getOrElse(fail("expected the cover to be legal"))
    val drawn = GameEngine
      .applyAction(covered, GameAction.PassTurn("p0"))
      .getOrElse(fail("expected the pass to be legal"))

    assert(drawn.isDraw)
    assertEquals(drawn.durak, None)
    assertEquals(PlayerGameView.forViewer(drawn, "p0").durak, None)
  }
