package durak.engine

class ChaosModeSuite extends munit.FunSuite:

  private def card(rank: Rank, suit: Suit = Suit.Spades): Card = Card(suit, rank)

  private def player(id: String, hand: List[Card], hasPassed: Boolean = false): PlayerState =
    PlayerState(id = id, name = id.toUpperCase, hand = hand.toVector, hasPassed = hasPassed)

  private def state(
      players: Vector[PlayerState],
      tablePairs: Vector[TablePair] = Vector.empty,
      attackerIdx: Int = 0,
      defenderIdx: Int = 1,
      boutPhase: BoutPhase = BoutPhase.InitialAttack,
      chaosMode: Boolean = true,
      talon: Vector[Card] = Vector.empty,
      discardPile: Vector[Card] = Vector.empty,
      defenderInitialHandSize: Int = 6
  ): GameState =
    GameState(
      config = GameConfig(players.size, seed = 42L, chaosMode = chaosMode),
      players = players,
      talon = talon,
      trumpSuit = Suit.Spades,
      bottomTrumpCard = None,
      discardPile = discardPile,
      tablePairs = tablePairs,
      attackerIdx = attackerIdx,
      defenderIdx = defenderIdx,
      boutPhase = boutPhase,
      defenderInitialHandSize = defenderInitialHandSize,
      finishOrder = Vector.empty
    )

  private def fourSeats(chaosMode: Boolean = true): GameState =
    state(
      Vector(
        player("p0", List(card(Rank.Six), card(Rank.Seven, Suit.Clubs))),
        player("p1", List(card(Rank.Eight, Suit.Hearts), card(Rank.Nine, Suit.Hearts))),
        player("p2", List(card(Rank.Ten, Suit.Diamonds), card(Rank.Jack, Suit.Diamonds))),
        player("p3", List(card(Rank.Queen, Suit.Clubs), card(Rank.King, Suit.Clubs)))
      ),
      chaosMode = chaosMode
    )

  private val sixSpades = card(Rank.Six, Suit.Spades)
  private val sixHearts = card(Rank.Six, Suit.Hearts)

  // --- Opening attack targets ---

  test("a standard game only ever offers the clockwise defender as a target") {
    val gs = fourSeats(chaosMode = false)

    assertEquals(GameEngine.eligibleInitialTargets(gs), Vector(1))
  }

  test("chaos mode offers every other seat that still holds cards, clockwise") {
    val gs = fourSeats()

    assertEquals(GameEngine.eligibleInitialTargets(gs), Vector(1, 2, 3))
  }

  test("chaos mode skips cardless seats and never offers the attacker itself") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Six))),
        player("p1", Nil),
        player("p2", List(card(Rank.Eight))),
        player("p3", List(card(Rank.Nine)))
      )
    )

    assertEquals(GameEngine.eligibleInitialTargets(gs), Vector(2, 3))
  }

  test("no opening target is offered outside the initial attack phase") {
    val gs = fourSeats().copy(boutPhase = BoutPhase.Defense)

    assertEquals(GameEngine.eligibleInitialTargets(gs), Vector.empty)
  }

  test("a chaos opening attack is aimed at the seat the attacker names") {
    val gs = fourSeats()

    val result = GameEngine.applyAction(
      gs,
      GameAction.InitialAttack("p0", List(card(Rank.Six)), Some("p3"))
    )

    assert(result.isRight, result)
    val next = result.getOrElse(fail("expected the chaos attack to be legal"))
    assertEquals(next.defenderIdx, 3)
    assertEquals(next.players(next.defenderIdx).id, "p3")
    assertEquals(next.defenderInitialHandSize, gs.players(3).hand.size)
    assertEquals(next.boutPhase, BoutPhase.Defense)
    assertEquals(next.tablePairs.map(_.attack), Vector(card(Rank.Six)))
  }

  test("a chaos opening attack without a target keeps the current defender") {
    val gs = fourSeats()

    val result = GameEngine.applyAction(gs, GameAction.InitialAttack("p0", List(card(Rank.Six))))

    assert(result.isRight, result)
    assertEquals(result.getOrElse(fail("expected a legal attack")).defenderIdx, gs.defenderIdx)
  }

  test("a chaos opening attack cannot be aimed at the attacker or a cardless seat") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Six))),
        player("p1", Nil),
        player("p2", List(card(Rank.Eight)))
      )
    )

    assert(
      GameEngine.applyAction(gs, GameAction.InitialAttack("p0", List(card(Rank.Six)), Some("p0"))).isLeft
    )
    assert(
      GameEngine.applyAction(gs, GameAction.InitialAttack("p0", List(card(Rank.Six)), Some("p1"))).isLeft
    )
    assert(
      GameEngine.applyAction(gs, GameAction.InitialAttack("p0", List(card(Rank.Six)), Some("ghost"))).isLeft
    )
  }

  test("a standard game rejects an opening attack aimed past its defender") {
    val gs = fourSeats(chaosMode = false)

    val past = GameEngine.applyAction(
      gs,
      GameAction.InitialAttack("p0", List(card(Rank.Six)), Some("p2"))
    )
    val atDefender = GameEngine.applyAction(
      gs,
      GameAction.InitialAttack("p0", List(card(Rank.Six)), Some("p1"))
    )

    assert(past.isLeft, past)
    assert(atDefender.isRight, atDefender)
  }

  // --- Redirect targets ---

  test("a standard redirect only ever targets the next clockwise player") {
    val gs = fourSeats(chaosMode = false).copy(
      boutPhase = BoutPhase.Defense,
      tablePairs = Vector(TablePair(sixSpades))
    )

    assertEquals(GameEngine.eligibleRedirectTargets(gs), Vector(2))
  }

  test("a chaos redirect targets every other seat that can answer the attack") {
    val gs = fourSeats().copy(
      boutPhase = BoutPhase.Defense,
      tablePairs = Vector(TablePair(sixSpades))
    )

    assertEquals(GameEngine.eligibleRedirectTargets(gs), Vector(0, 2, 3))
  }

  test("a chaos redirect skips seats that cannot answer the combined attack") {
    val gs = state(
      Vector(
        player(
          "p0",
          List(card(Rank.Ace, Suit.Clubs), card(Rank.King, Suit.Clubs), card(Rank.Queen, Suit.Clubs))
        ),
        player("p1", List(sixHearts)),
        player("p2", List(card(Rank.Eight))),
        player(
          "p3",
          List(card(Rank.Nine), card(Rank.Ten), card(Rank.Jack, Suit.Diamonds))
        )
      ),
      tablePairs = Vector(TablePair(sixSpades), TablePair(card(Rank.Six, Suit.Diamonds))),
      boutPhase = BoutPhase.Defense
    )

    // Answering the redirect needs a third card: p2 holds one, p0 and p3 can take it.
    assertEquals(GameEngine.eligibleRedirectTargets(gs), Vector(0, 3))
  }

  test("a chaos redirect lands deterministically on an eligible seat") {
    val gs = fourSeats().copy(
      players = fourSeats().players.updated(1, player("p1", List(sixHearts, card(Rank.King, Suit.Hearts)))),
      boutPhase = BoutPhase.Defense,
      tablePairs = Vector(TablePair(sixSpades)),
      defenderInitialHandSize = 2
    )

    val first = GameEngine.applyAction(gs, GameAction.RedirectAttack("p1", List(sixHearts)))
    val second = GameEngine.applyAction(gs, GameAction.RedirectAttack("p1", List(sixHearts)))

    assert(first.isRight, first)
    val next = first.getOrElse(fail("expected the chaos redirect to be legal"))
    assert(Set(0, 2, 3).contains(next.defenderIdx), next.defenderIdx.toString)
    assertEquals(next.attackerIdx, 1)
    assertEquals(next.defenderIdx, second.toOption.map(_.defenderIdx).getOrElse(-1))
    assertEquals(GameEngine.deterministicRedirectTarget(gs), Some(next.defenderIdx))
    assertEquals(next.tablePairs.size, 2)
  }

  test("a chaos redirect to the only eligible seat is forced") {
    val gs = state(
      Vector(
        player("p0", Nil),
        player("p1", List(sixHearts)),
        player("p2", List(card(Rank.Eight), card(Rank.Nine)))
      ),
      tablePairs = Vector(TablePair(sixSpades)),
      boutPhase = BoutPhase.Defense
    )

    val result = GameEngine.applyAction(gs, GameAction.RedirectAttack("p1", List(sixHearts)))

    assert(result.isRight, result)
    assertEquals(result.toOption.map(_.defenderIdx), Some(2))
  }

  // --- Bots ---

  test("a chaos-mode bot enumerates one opening attack per card and per target") {
    val gs = threeSeatChaos()

    val attacks = RandomBot.legalActionsFor(gs, "p0").collect {
      case attack: GameAction.InitialAttack => attack
    }

    assertEquals(attacks.size, gs.players(0).hand.size * 2)
    assertEquals(
      attacks.map(_.targetPlayerId).toSet,
      Set(Some("p1"), Some("p2"))
    )
    attacks.foreach(attack => assert(GameEngine.applyAction(gs, attack).isRight, attack.toString))
  }

  test("a standard bot still opens without naming a target") {
    val gs = threeSeatChaos().copy(config = GameConfig(3, seed = 42L, chaosMode = false))

    RandomBot.legalActionsFor(gs, "p0").foreach {
      case attack: GameAction.InitialAttack => assertEquals(attack.targetPlayerId, None)
      case _                                => ()
    }
  }

  private def threeSeatChaos(): GameState =
    state(
      Vector(
        player("p0", List(card(Rank.Six), card(Rank.Seven, Suit.Clubs))),
        player("p1", List(card(Rank.Eight, Suit.Hearts))),
        player("p2", List(card(Rank.Nine, Suit.Diamonds)))
      )
    )

  // --- Projection ---

  test("the view projects the chaos flag and every eligible target") {
    val gs = fourSeats()

    val view = PlayerGameView.forViewer(gs, "p0")

    assertEquals(view.chaosMode, true)
    assertEquals(view.allowRedirect, true)
    assertEquals(view.playerTypes, Vector("human", "human", "human", "human"))
    assertEquals(view.eligibleTargetIds, Vector("p1", "p2", "p3"))
    assertEquals(view.redirectTargetId, None)
    assert(view.legalActions.contains("attack"), view.legalActions.toString)
  }

  test("a standard initial attack projects the single defender as its target") {
    val gs = fourSeats(chaosMode = false)

    assertEquals(PlayerGameView.forViewer(gs, "p0").eligibleTargetIds, Vector("p1"))
  }

  test("an opening attack projects no targets once the bout is under way") {
    val gs = fourSeats().copy(
      boutPhase = BoutPhase.Defense,
      tablePairs = Vector(TablePair(sixSpades))
    )

    assertEquals(PlayerGameView.forViewer(gs, "p0").eligibleTargetIds, Vector.empty)
  }

  test("the view names the seat a redirect would move the attack to") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Ace, Suit.Clubs))),
        player("p1", List(sixHearts, card(Rank.King, Suit.Hearts))),
        player("p2", List(card(Rank.Eight), card(Rank.Nine)))
      ),
      tablePairs = Vector(TablePair(sixSpades)),
      boutPhase = BoutPhase.Defense
    )

    // The table draws one arrow, so every seat is told where it points.
    assertEquals(PlayerGameView.forViewer(gs, "p1").redirectTargetId, Some("p2"))
    assertEquals(PlayerGameView.forViewer(gs, "p0").redirectTargetId, Some("p2"))
  }

  test("no redirect target is projected when redirects are disabled") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Ace, Suit.Clubs))),
        player("p1", List(sixHearts, card(Rank.King, Suit.Hearts))),
        player("p2", List(card(Rank.Eight), card(Rank.Nine)))
      ),
      tablePairs = Vector(TablePair(sixSpades)),
      boutPhase = BoutPhase.Defense
    ).copy(config = GameConfig(3, allowRedirect = false, seed = 42L))

    assertEquals(PlayerGameView.forViewer(gs, "p1").redirectTargetId, None)
  }
