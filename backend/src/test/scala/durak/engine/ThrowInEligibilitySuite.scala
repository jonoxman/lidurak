package durak.engine

import durak.server.GameManager

/**
 * T-90-feedback-20261106_111512-1: the backend is the single source of truth for
 * throw-in eligibility (QA Playbook #1) and for the largest atomic multi-card
 * throw-in a seat may deploy (new #4).
 */
class ThrowInEligibilitySuite extends munit.FunSuite:

  private def card(rank: Rank, suit: Suit): Card = Card(suit, rank)

  private val sevenHearts = card(Rank.Seven, Suit.Hearts)
  private val sevenDiamonds = card(Rank.Seven, Suit.Diamonds)
  private val sevenClubs = card(Rank.Seven, Suit.Clubs)
  private val nineDiamonds = card(Rank.Nine, Suit.Diamonds)
  private val kingSpades = card(Rank.King, Suit.Spades)

  private def preset(presetId: String): GameState =
    GameManager.preset(presetId) match
      case Right(game) => game.state
      case Left(error) => fail(error)

  private val visibility = preset("throw-in-visibility-4p")
  private val capacityCap = preset("throw-in-capacity-cap")

  // --- QA Playbook #1: who sees the throw-in outline ---

  test("Alice sees exactly the matching cards she may throw in") {
    val view = PlayerGameView.forViewer(visibility, "p0")

    assertEquals(view.throwInCards, List(sevenHearts, sevenDiamonds, nineDiamonds))
    assertEquals(view.throwInCapacity, 3)
    assertEquals(view.canThrowIn, true)
    // The engine helpers and the projection agree.
    assertEquals(GameEngine.legalThrowInCards(visibility, "p0"), view.throwInCards)
    assertEquals(GameEngine.throwInCapacity(visibility, "p0"), view.throwInCapacity)
    assertEquals(GameEngine.canPlayerThrowIn(visibility, 0), true)
  }

  test("the defender never qualifies, even holding a matching rank") {
    val bob = PlayerGameView.forViewer(visibility, "p1")

    // Bob defends and holds 9♥, a rank that is on the table.
    assert(bob.myHand.contains(card(Rank.Nine, Suit.Hearts)), bob.myHand.toString)
    assertEquals(bob.throwInCards, Nil)
    assertEquals(bob.throwInCapacity, 0)
    assertEquals(bob.canThrowIn, false)
    assertEquals(GameEngine.canPlayerThrowIn(visibility, 1), false)
  }

  test("a seat holding no rank on the table sees no throw-in") {
    val carol = PlayerGameView.forViewer(visibility, "p2")

    assertEquals(carol.myHand.size, 6)
    assert(!carol.myHand.exists(_.rank == Rank.Seven), carol.myHand.toString)
    assert(!carol.myHand.exists(_.rank == Rank.Nine), carol.myHand.toString)
    assertEquals(carol.throwInCards, Nil)
    assertEquals(carol.throwInCapacity, 0)
    assertEquals(carol.canThrowIn, false)
    assertEquals(GameEngine.canPlayerThrowIn(visibility, 2), false)
  }

  test("a seat that already passed sees no throw-in") {
    val dave = PlayerGameView.forViewer(visibility, "p3")

    // Dave holds 7♣, but he has already passed the bout.
    assertEquals(dave.myHasPassed, true)
    assert(dave.myHand.contains(sevenClubs), dave.myHand.toString)
    assertEquals(dave.throwInCards, Nil)
    assertEquals(dave.throwInCapacity, 0)
    assertEquals(dave.canThrowIn, false)
    assertEquals(GameEngine.canPlayerThrowIn(visibility, 3), false)
  }

  test("passing clears a seat's own throw-in projection") {
    val passed = GameEngine
      .applyAction(visibility, GameAction.PassTurn("p0"))
      .getOrElse(fail("expected a legal pass"))

    assertEquals(passed.boutPhase, BoutPhase.Defense)
    val view = PlayerGameView.forViewer(passed, "p0")
    assertEquals(view.myHasPassed, true)
    assertEquals(view.throwInCards, Nil)
    assertEquals(view.throwInCapacity, 0)
    assertEquals(view.canThrowIn, false)
  }

  test("an unknown seat and a seat outside the throw-in phases have no capacity") {
    assertEquals(GameEngine.throwInCapacity(visibility, "p9"), 0)
    assertEquals(GameEngine.legalThrowInCards(visibility, "p9"), Nil)
    assertEquals(GameEngine.throwInCapacity(visibility.copy(boutPhase = BoutPhase.InitialAttack), "p0"), 0)
    assertEquals(GameEngine.throwInCapacity(visibility.copy(boutPhase = BoutPhase.GameOver), "p0"), 0)
  }

  // --- New #4: atomic multi-card throw-in, capped by throwInCapacity ---

  test("throw-in-capacity-cap exposes the exact atomic capacity") {
    assertEquals(GameEngine.throwInCapacity(capacityCap, "p0"), 2)
    assertEquals(
      GameEngine.legalThrowInCards(capacityCap, "p0"),
      List(sevenHearts, sevenDiamonds, sevenClubs, nineDiamonds)
    )
    assertEquals(PlayerGameView.forViewer(capacityCap, "p0").throwInCapacity, 2)
  }

  test("every count up to the capacity succeeds and one more is rejected") {
    val legal = GameEngine.legalThrowInCards(capacityCap, "p0")
    val capacity = GameEngine.throwInCapacity(capacityCap, "p0")

    (1 to capacity).foreach { count =>
      val result = GameEngine.applyAction(
        capacityCap,
        GameAction.ThrowInCards("p0", legal.take(count))
      )
      assert(result.isRight, s"$count cards were rejected: $result")
      assertEquals(result.toOption.get.tablePairs.size, 1 + count)
    }

    val tooMany = GameEngine.applyAction(
      capacityCap,
      GameAction.ThrowInCards("p0", legal.take(capacity + 1))
    )
    assert(tooMany.isLeft, tooMany)
    // Nothing partial happened: the original position still holds one table
    // card and Alice's full six-card hand.
    assertEquals(capacityCap.tablePairs.size, 1)
    assertEquals(capacityCap.players(0).hand.size, 6)
  }

  test("a throw-in with an illegal or duplicated card is rejected atomically") {
    val illegal = GameEngine.applyAction(
      capacityCap,
      GameAction.ThrowInCards("p0", List(sevenHearts, sevenDiamonds, kingSpades))
    )
    assert(illegal.isLeft, illegal)

    val duplicate = GameEngine.applyAction(
      capacityCap,
      GameAction.ThrowInCards("p0", List(sevenHearts, sevenHearts))
    )
    assert(duplicate.isLeft, duplicate)

    assertEquals(capacityCap.tablePairs.size, 1)
    assertEquals(capacityCap.players(0).hand.size, 6)
    assertEquals(capacityCap.boutPhase, BoutPhase.Defense)
  }

  // --- New #4: multi-card equals the same cards thrown one at a time ---

  test("a multi-card throw-in equals one-by-one throw-ins in the defense phase") {
    val multi = GameEngine
      .applyAction(visibility, GameAction.ThrowInCards("p0", List(sevenHearts, sevenDiamonds)))
      .getOrElse(fail("expected a legal multi-card throw-in"))

    val sequential = GameEngine
      .applyAction(visibility, GameAction.ThrowInCards("p0", List(sevenHearts)))
      .flatMap(next => GameEngine.applyAction(next, GameAction.ThrowInCards("p0", List(sevenDiamonds))))
      .getOrElse(fail("expected legal single-card throw-ins"))

    assertEquals(multi, sequential)
    assertEquals(multi.tablePairs.map(_.attack).takeRight(2), Vector(sevenHearts, sevenDiamonds))
    assertEquals(multi.players(0).hand.size, 4)
  }

  test("a multi-card throw-in equals one-by-one throw-ins while surrendering") {
    val surrendered = GameEngine
      .applyAction(preset("surrender-half-off"), GameAction.DeclareSurrender("p1"))
      .getOrElse(fail("expected a legal surrender"))
    assertEquals(surrendered.boutPhase, BoutPhase.SurrenderThrowIn)
    // Three cards sit on the table, so the bout has exactly three free slots.
    assertEquals(GameEngine.throwInCapacity(surrendered, "p0"), 3)

    val multi = GameEngine
      .applyAction(surrendered, GameAction.ThrowInCards("p0", List(sevenHearts, sevenDiamonds)))
      .getOrElse(fail("expected a legal multi-card throw-in"))

    val sequential = GameEngine
      .applyAction(surrendered, GameAction.ThrowInCards("p0", List(sevenHearts)))
      .flatMap(next => GameEngine.applyAction(next, GameAction.ThrowInCards("p0", List(sevenDiamonds))))
      .getOrElse(fail("expected legal single-card throw-ins"))

    assertEquals(multi, sequential)
    assertEquals(multi.boutPhase, BoutPhase.SurrenderThrowIn)
    assertEquals(multi.tablePairs.map(_.attack).takeRight(2), Vector(sevenHearts, sevenDiamonds))
    // The surrendered defender picks up exactly the cards of both variants.
    assertEquals(multi.players(1).hand, sequential.players(1).hand)
  }
