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

  private def pass(gs: GameState, playerId: String): GameState =
    GameEngine.applyAction(gs, GameAction.PassTurn(playerId)) match
      case Right(next) => next
      case Left(error) => fail(s"pass by $playerId was rejected: $error")

  // --- Surrender ---

  test("a defender surrendering with one card picks up the attack card") {
    val attack = card(Rank.Six, Suit.Spades)
    val heldCard = card(Rank.Seven, Suit.Hearts)
    val gs = twoPlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs), card(Rank.King, Suit.Clubs)),
      defenderHand = List(heldCard),
      tablePairs = Vector(TablePair(attack)),
      defenderInitialHandSize = 1
    )

    // The bout is already at its card limit, so nobody can throw in — but the
    // cards stay on the table until the delayed auto-pass settles the bout.
    val surrendered = GameEngine
      .applyAction(gs, GameAction.DeclareSurrender("p1"))
      .getOrElse(fail("expected a valid surrender"))
    assertEquals(surrendered.boutPhase, BoutPhase.SurrenderThrowIn)
    assertEquals(GameEngine.playersNeedingAutoPass(surrendered), Vector("p0"))

    val next = GameEngine.autoPassSurrenderThrowers(surrendered)

    assertEquals(next.tablePairs, Vector.empty)
    assertEquals(next.discardPile, Vector.empty)
    assertEquals(next.players(1).hand.toSet, Set(heldCard, attack))
    assertEquals(next.players(1).hand.size, 2)
    // The defender must not be mistaken for a finished player next turn.
    assertEquals(next.players(1).finishRank, None)
    assert(next.boutPhase != BoutPhase.GameOver)
  }

  test("a surrendering defender picks up covered and uncovered table cards") {
    val six = card(Rank.Six, Suit.Spades)
    val cover = card(Rank.Seven, Suit.Spades)
    val secondAttack = card(Rank.Six, Suit.Hearts)
    val heldCard = card(Rank.Nine, Suit.Diamonds)
    val gs = twoPlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs)),
      defenderHand = List(heldCard),
      tablePairs = Vector(TablePair(six, Some(cover)), TablePair(secondAttack)),
      defenderInitialHandSize = 2
    )

    // The bout is at its card limit, so only the delayed auto-pass settles it.
    val next = GameEngine.autoPassSurrenderThrowers(
      GameEngine
        .applyAction(gs, GameAction.DeclareSurrender("p1"))
        .getOrElse(fail("expected a valid surrender"))
    )

    assertEquals(next.tablePairs, Vector.empty)
    assertEquals(next.discardPile, Vector.empty)
    assertEquals(next.players(1).hand.toSet, Set(heldCard, six, cover, secondAttack))
    assertEquals(next.players(1).hand.size, 4)
  }

  test("a valid surrender opens the surrender throw-in phase") {
    val attack = card(Rank.Six, Suit.Spades)
    val gs = twoPlayer(
      // p0 still holds a matching six, so the phase stays open for a throw-in.
      attackerHand = List(card(Rank.Six, Suit.Hearts), card(Rank.Ace, Suit.Clubs)),
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
      // p0 can still throw in a matching six, so only the cardless p2 is passed.
      attackerHand = List(card(Rank.Six, Suit.Hearts), card(Rank.Ace, Suit.Clubs)),
      defenderHand = List(card(Rank.Seven, Suit.Hearts)),
      thirdHand = Nil,
      tablePairs = Vector(TablePair(card(Rank.Six, Suit.Spades))),
      attackerPassed = false,
      thirdPassed = false
    )

    val result = GameEngine.applyAction(gs, GameAction.DeclareSurrender("p1"))

    assert(result.isRight, result)
    val next = result.getOrElse(fail("expected a valid surrender"))
    assertEquals(next.players(0).hasPassed, false)
    assertEquals(next.players(2).hasPassed, true)
    assertEquals(next.players(1).hasPassed, false)
  }

  test("a full bout keeps every non-defender unpassed until the delayed auto-pass") {
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
    val surrendered = result.getOrElse(fail("expected a valid surrender"))
    // With no room for another card every thrower is queued for the delayed
    // auto-pass; only that pass resolves the surrender and hands the table over.
    assertEquals(gs.maxBoutAttacks, 2)
    assertEquals(surrendered.boutPhase, BoutPhase.SurrenderThrowIn)
    assertEquals(surrendered.players(0).hasPassed, false)
    assertEquals(surrendered.players(2).hasPassed, false)
    assertEquals(GameEngine.playersNeedingAutoPass(surrendered), Vector("p0", "p2"))

    val next = GameEngine.autoPassSurrenderThrowers(surrendered)
    assertEquals(next.tablePairs, Vector.empty)
    assertEquals(next.discardPile, Vector.empty)
    assertEquals(
      next.players(1).hand.toSet,
      Set(card(Rank.Seven, Suit.Hearts), card(Rank.Six, Suit.Spades), card(Rank.Six, Suit.Hearts))
    )
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
      // A second matching six keeps the throw-in phase open after the first.
      attackerHand = List(thrown, card(Rank.Six, Suit.Clubs), card(Rank.Ace, Suit.Clubs)),
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
      // p0 already passed, so only p2 — still holding a matching six — can act.
      attackerHand = List(card(Rank.Ace, Suit.Clubs)),
      defenderHand = List(
        card(Rank.Seven, Suit.Spades),
        card(Rank.Eight, Suit.Spades)
      ),
      thirdHand = List(thrown, card(Rank.King, Suit.Diamonds)),
      tablePairs = Vector(TablePair(card(Rank.Six, Suit.Spades))),
      attackerPassed = true,
      thirdPassed = false
    )

    val result = GameEngine.applyAction(gs, GameAction.ThrowInCards("p2", List(thrown)))

    assert(result.isRight, result)
    val next = result.getOrElse(fail("expected a valid throw-in"))
    // The throw-in reopens the window for the seat that had already passed.
    assertEquals(next.players(0).hasPassed, false)
    assertEquals(next.players(2).hasPassed, false)
  }

  test("a surrender-phase throw-in reopens the window for every thrower with cards") {
    val thrown = card(Rank.Six, Suit.Clubs)
    val gs = threePlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs)),
      defenderHand = List(card(Rank.Seven, Suit.Spades)),
      // p2 keeps a second matching six and has not passed, so the bout stays open.
      thirdHand = List(thrown, card(Rank.Six, Suit.Diamonds), card(Rank.King, Suit.Diamonds)),
      tablePairs = Vector(TablePair(card(Rank.Six, Suit.Spades))),
      attackerPassed = true,
      thirdPassed = false,
      boutPhase = BoutPhase.SurrenderThrowIn
    )

    val result = GameEngine.applyAction(gs, GameAction.ThrowInCards("p2", List(thrown)))

    assert(result.isRight, result)
    val next = result.getOrElse(fail("expected a valid throw-in"))
    assertEquals(next.boutPhase, BoutPhase.SurrenderThrowIn)
    // p0 already passed, but a new throw-in gives every seat holding cards its
    // throw-in window back; the seat that just threw in keeps its own window.
    assertEquals(next.players(0).hasPassed, false)
    assertEquals(next.players(2).hasPassed, false)
    assertEquals(GameEngine.playersNeedingAutoPass(next), Vector("p0"))
  }

  // --- The surrendering defender has no legal actions ---

  test("a surrendering defender cannot surrender, cover, redirect, throw in or pass") {
    val six = card(Rank.Six, Suit.Spades)
    val sixHearts = card(Rank.Six, Suit.Hearts)
    val kingHearts = card(Rank.King, Suit.Hearts)
    val gs = twoPlayer(
      // p0 can still throw in, so the surrendered bout stays open for this test.
      attackerHand = List(card(Rank.Six, Suit.Clubs), card(Rank.Ace, Suit.Clubs)),
      defenderHand = List(sixHearts, kingHearts),
      tablePairs = Vector(TablePair(six))
    )

    val surrendered = GameEngine
      .applyAction(gs, GameAction.DeclareSurrender("p1"))
      .getOrElse(fail("expected a valid surrender"))
    assertEquals(surrendered.boutPhase, BoutPhase.SurrenderThrowIn)

    val attempts = List(
      GameAction.DeclareSurrender("p1"),
      GameAction.CoverCard("p1", 0, kingHearts),
      GameAction.RedirectAttack("p1", List(sixHearts)),
      GameAction.PassTurn("p1"),
      GameAction.ThrowInCards("p1", List(sixHearts))
    )
    attempts.foreach { action =>
      assert(
        GameEngine.applyAction(surrendered, action).isLeft,
        s"the surrendering defender must not be able to play $action"
      )
    }
    assertEquals(GameEngine.legalActions(surrendered, "p1"), Nil)
    assertEquals(RandomBot.legalActionsFor(surrendered, "p1"), Vector.empty)
    assertEquals(PlayerGameView.forViewer(surrendered, "p1").legalActions, List.empty)
  }

  test("a seat can never cover its own attack") {
    val six = card(Rank.Six, Suit.Spades)
    val seven = card(Rank.Seven, Suit.Spades)
    val gs = twoPlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs)),
      defenderHand = List(seven),
      tablePairs = Vector(TablePair(six))
    )

    // The attacker never gets to cover, and only the defender may.
    assert(GameEngine.applyAction(gs, GameAction.CoverCard("p0", 0, seven)).isLeft)
    // A seat that is both attacker and defender must not answer its own attack.
    val sameSeat = gs.copy(defenderIdx = gs.attackerIdx)
    assert(
      GameEngine.applyAction(sameSeat, GameAction.CoverCard("p0", 0, seven)).isLeft,
      "a seat that is both attacker and defender must not cover its own attack"
    )
  }

  test("a surrender auto-passes an opponent that attacked with its last card") {
    val attack = card(Rank.Six, Suit.Spades)
    val held = card(Rank.Seven, Suit.Hearts)
    val gs = twoPlayer(
      attackerHand = Nil,
      defenderHand = List(held),
      tablePairs = Vector(TablePair(attack)),
      defenderInitialHandSize = 1
    )

    // A cardless attacker has no throw-in at all, so the surrender resolves
    // inside the declaring move instead of waiting for a settling pass.
    val settled = GameEngine
      .applyAction(gs, GameAction.DeclareSurrender("p1"))
      .getOrElse(fail("expected a valid surrender"))

    assertEquals(settled.tablePairs, Vector.empty)
    assertEquals(settled.discardPile, Vector.empty)
    assertEquals(settled.players(0).hand, Vector.empty)
    assertEquals(settled.players(1).hand.toSet, Set(held, attack))
    // The cardless attacker went out, so the defender is the last one in.
    assertEquals(settled.durak, Some("p1"))
  }

  test("a defense-phase throw-in is rejected when the defender cannot cover it") {
    val thrown = card(Rank.Six, Suit.Hearts)
    val gs = twoPlayer(
      attackerHand = List(thrown),
      defenderHand = List(card(Rank.Seven, Suit.Spades)),
      tablePairs = Vector(TablePair(card(Rank.Six, Suit.Spades)))
    )

    // The defender owns a single card and already faces one uncovered attack.
    val result = GameEngine.applyAction(gs, GameAction.ThrowInCards("p0", List(thrown)))

    assert(result.isLeft, result)
  }

  // --- ITEM-1a: throw-in legality is never offered to an ineligible seat ---

  test("a passed non-defender has no throw-in or pass legal action") {
    val attack = card(Rank.Six, Suit.Spades)
    val thrown = card(Rank.Six, Suit.Clubs)
    val gs = threePlayer(
      attackerHand = List(card(Rank.Ace, Suit.Clubs)),
      defenderHand = List(card(Rank.Seven, Suit.Spades), card(Rank.Eight, Suit.Spades)),
      thirdHand = List(thrown, card(Rank.King, Suit.Diamonds)),
      tablePairs = Vector(TablePair(attack)),
      thirdPassed = true
    )

    assertEquals(GameEngine.canPlayerThrowIn(gs, 2), false)
    assertEquals(GameEngine.legalActions(gs, "p2"), Nil)
    assertEquals(PlayerGameView.forViewer(gs, "p2").legalActions, List.empty)
    // The engine refuses a passed seat's throw-in outright, not just the view.
    assert(GameEngine.applyAction(gs, GameAction.ThrowInCards("p2", List(thrown))).isLeft)
  }

  test("the defender and a seat holding no matching rank offer no throw-in") {
    val attack = card(Rank.Six, Suit.Spades)
    val gs = threePlayer(
      attackerHand = List(card(Rank.King, Suit.Clubs)),
      defenderHand = List(
        card(Rank.Six, Suit.Hearts),
        card(Rank.Eight, Suit.Hearts),
        card(Rank.Nine, Suit.Hearts)
      ),
      thirdHand = List(card(Rank.King, Suit.Diamonds)),
      tablePairs = Vector(TablePair(attack))
    )

    // The bout has room and the defender can answer, so the missing rank — and
    // the defender's own role — are the only reasons no throw-in is offered.
    assertEquals(gs.tablePairs.size < gs.maxBoutAttacks, true)
    assertEquals(GameEngine.canPlayerThrowIn(gs, 0), false)
    assertEquals(GameEngine.canPlayerThrowIn(gs, 1), false)
    assertEquals(GameEngine.canPlayerThrowIn(gs, 2), false)
    assertEquals(PlayerGameView.forViewer(gs, "p0").legalActions, List.empty)
    assertEquals(PlayerGameView.forViewer(gs, "p2").legalActions, List.empty)
    assert(
      !GameEngine.legalActions(gs, "p1").exists(_.isInstanceOf[GameAction.ThrowInCards]),
      GameEngine.legalActions(gs, "p1").toString
    )
  }

  // --- ITEM-5: one move may deploy several matching cards ---

  test("two matching cards can be thrown in together during the defense phase") {
    val attack = card(Rank.Seven, Suit.Spades)
    val first = card(Rank.Seven, Suit.Hearts)
    val second = card(Rank.Seven, Suit.Diamonds)
    val gs = twoPlayer(
      attackerHand = List(first, second, card(Rank.Ace, Suit.Clubs)),
      defenderHand = List(
        card(Rank.Eight, Suit.Spades),
        card(Rank.Nine, Suit.Spades),
        card(Rank.Ten, Suit.Spades)
      ),
      tablePairs = Vector(TablePair(attack))
    )

    val result = GameEngine.applyAction(gs, GameAction.ThrowInCards("p0", List(first, second)))

    assert(result.isRight, result)
    val next = result.getOrElse(fail("expected a valid multi-card throw-in"))
    assertEquals(next.tablePairs.map(_.attack), Vector(attack, first, second))
    assertEquals(next.players(0).hand, Vector(card(Rank.Ace, Suit.Clubs)))
    assertEquals(next.boutPhase, BoutPhase.Defense)
  }

  test("two matching cards can be thrown in together during a surrender throw-in") {
    val attack = card(Rank.Seven, Suit.Spades)
    val first = card(Rank.Seven, Suit.Hearts)
    val second = card(Rank.Seven, Suit.Diamonds)
    val gs = twoPlayer(
      attackerHand = List(first, second, card(Rank.Ace, Suit.Clubs)),
      defenderHand = List(card(Rank.Eight, Suit.Spades)),
      tablePairs = Vector(TablePair(attack)),
      boutPhase = BoutPhase.SurrenderThrowIn
    )

    val result = GameEngine.applyAction(gs, GameAction.ThrowInCards("p0", List(first, second)))

    assert(result.isRight, result)
    val next = result.getOrElse(fail("expected a valid multi-card throw-in"))
    assertEquals(next.tablePairs.map(_.attack), Vector(attack, first, second))
    assertEquals(next.players(0).hand.size, 1)
    // The thrower keeps the window open because it still holds cards.
    assertEquals(next.boutPhase, BoutPhase.SurrenderThrowIn)
    assertEquals(next.players(0).hasPassed, false)
  }

  test("a multi-card throw-in containing an off-rank card is rejected") {
    val attack = card(Rank.Seven, Suit.Spades)
    val first = card(Rank.Seven, Suit.Hearts)
    val offRank = card(Rank.King, Suit.Diamonds)
    val gs = twoPlayer(
      attackerHand = List(first, offRank),
      defenderHand = List(
        card(Rank.Eight, Suit.Spades),
        card(Rank.Nine, Suit.Spades),
        card(Rank.Ten, Suit.Spades)
      ),
      tablePairs = Vector(TablePair(attack))
    )

    val result = GameEngine.applyAction(gs, GameAction.ThrowInCards("p0", List(first, offRank)))

    assert(result.isLeft, result)
  }

  // --- T-90-feedback-20261106_161731-1: atomic multi-card surrender throw-ins ---

  test("a multi-card surrender throw-in hands every card to the defender") {
    val attack = card(Rank.Seven, Suit.Spades)
    val first = card(Rank.Seven, Suit.Hearts)
    val second = card(Rank.Seven, Suit.Diamonds)
    val defenderHand = List(
      card(Rank.Eight, Suit.Spades),
      card(Rank.Nine, Suit.Spades),
      card(Rank.Ten, Suit.Spades)
    )
    val gs = twoPlayer(
      attackerHand = List(first, second, card(Rank.Ace, Suit.Clubs)),
      defenderHand = defenderHand,
      tablePairs = Vector(TablePair(attack)),
      boutPhase = BoutPhase.SurrenderThrowIn
    )

    val thrown = GameEngine
      .applyAction(gs, GameAction.ThrowInCards("p0", List(first, second)))
      .getOrElse(fail("expected a legal multi-card surrender throw-in"))
    assertEquals(thrown.boutPhase, BoutPhase.SurrenderThrowIn)
    assertEquals(thrown.tablePairs.map(_.attack), Vector(attack, first, second))
    assertEquals(thrown.players(0).hand, Vector(card(Rank.Ace, Suit.Clubs)))

    // Passing settles the surrender: the defender takes the whole table.
    val settled = pass(thrown, "p0")
    assertEquals(settled.tablePairs, Vector.empty)
    assertEquals(settled.discardPile, Vector.empty)
    assertEquals(
      settled.players(1).hand.toSet,
      (defenderHand ++ List(attack, first, second)).toSet
    )
  }

  test("an over-capacity or mixed-invalid surrender throw-in is rejected atomically") {
    val attack = card(Rank.Seven, Suit.Spades)
    val first = card(Rank.Seven, Suit.Hearts)
    val second = card(Rank.Seven, Suit.Diamonds)
    val third = card(Rank.Seven, Suit.Clubs)
    val king = card(Rank.King, Suit.Diamonds)
    val gs = twoPlayer(
      attackerHand = List(first, second, third, king),
      defenderHand = List(
        card(Rank.Eight, Suit.Spades),
        card(Rank.Nine, Suit.Spades),
        card(Rank.Ten, Suit.Spades)
      ),
      tablePairs = Vector(TablePair(attack)),
      defenderInitialHandSize = 3,
      boutPhase = BoutPhase.SurrenderThrowIn
    )
    // maxBoutAttacks = 3 and one card sits on the table, so capacity is two.
    assertEquals(GameEngine.throwInCapacity(gs, "p0"), 2)

    val tooMany =
      GameEngine.applyAction(gs, GameAction.ThrowInCards("p0", List(first, second, third)))
    assert(tooMany.isLeft, tooMany)

    val mixed = GameEngine.applyAction(gs, GameAction.ThrowInCards("p0", List(first, king)))
    assert(mixed.isLeft, mixed)

    // Neither rejected move applied anything partially.
    assertEquals(gs.tablePairs.map(_.attack), Vector(attack))
    assertEquals(gs.players(0).hand.size, 4)
    assertEquals(gs.players(1).hand.size, 3)
    assertEquals(gs.boutPhase, BoutPhase.SurrenderThrowIn)
  }
