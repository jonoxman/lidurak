package durak.engine

class EndgameSuite extends munit.FunSuite:

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
      discardPile: Vector[Card] = Vector.empty,
      attackerIdx: Int = 0,
      defenderIdx: Int = 1,
      boutPhase: BoutPhase = BoutPhase.Defense,
      trumpSuit: Suit = Suit.Spades,
      defenderInitialHandSize: Int = 6,
      finishOrder: Vector[String] = Vector.empty
  ): GameState =
    GameState(
      config = GameConfig(players.size, seed = 42L),
      players = players,
      talon = talon,
      trumpSuit = trumpSuit,
      bottomTrumpCard = None,
      discardPile = discardPile,
      tablePairs = tablePairs,
      attackerIdx = attackerIdx,
      defenderIdx = defenderIdx,
      boutPhase = boutPhase,
      defenderInitialHandSize = defenderInitialHandSize,
      finishOrder = finishOrder
    )

  private def applyOrFail(gs: GameState, action: GameAction): GameState =
    GameEngine.applyAction(gs, action) match
      case Right(next) => next
      case Left(error) => fail(s"$action was rejected: $error")

  private def legalCover(attack: Card, defense: Card, trumpSuit: Suit): Boolean =
    (defense.suit == attack.suit && defense.rank.value > attack.rank.value) ||
      (defense.suit == trumpSuit && attack.suit != trumpSuit)

  /**
   * Declares a pass by every active non-defender that still has to pass, so the
   * bout resolves. Falls back to a settled player's pass when a surrender has
   * already auto-passed everyone.
   */
  private def passRound(start: GameState): GameState =
    var state = start
    var keepGoing = true
    while keepGoing do
      val pending = state.players.zipWithIndex.find { case (p, idx) =>
        idx != state.defenderIdx && p.isActive && !p.hasPassed
      }
      val anyNonDefender = state.players.zipWithIndex.find { case (p, idx) =>
        idx != state.defenderIdx && p.isActive
      }
      val next = pending.orElse(anyNonDefender)
      if state.boutPhase == BoutPhase.InitialAttack ||
          state.boutPhase == BoutPhase.GameOver ||
          next.isEmpty
      then keepGoing = false
      else
        val before = state
        state = applyOrFail(state, GameAction.PassTurn(next.get._1.id))
        if state == before then keepGoing = false
    state

  /**
   * Plays a whole game with a deterministic policy: the attacker always leads
   * its first card, the defender covers whenever it can and otherwise
   * surrenders, and every non-defender passes. No throw-ins or redirects.
   */
  private def runGame(start: GameState, maxSteps: Int = 5000): GameState =
    var state = start
    var steps = 0
    while state.boutPhase != BoutPhase.GameOver && steps < maxSteps do
      steps += 1
      state = state.boutPhase match
        case BoutPhase.InitialAttack =>
          val attacker = state.players(state.attackerIdx)
          assert(
            attacker.hand.nonEmpty,
            s"attacker ${attacker.id} has no cards while the game is in ${state.boutPhase}"
          )
          applyOrFail(state, GameAction.InitialAttack(attacker.id, List(attacker.hand.head)))
        case BoutPhase.Defense =>
          val defender = state.players(state.defenderIdx)
          state.tablePairs.zipWithIndex.find(_._1.defense.isEmpty) match
            case None => passRound(state)
            case Some((pair, attackIndex)) =>
              defender.hand.find(card => legalCover(pair.attack, card, state.trumpSuit)) match
                case Some(cover) =>
                  applyOrFail(state, GameAction.CoverCard(defender.id, attackIndex, cover))
                case None =>
                  applyOrFail(state, GameAction.DeclareSurrender(defender.id))
        case BoutPhase.SurrenderThrowIn =>
          passRound(state)
        case other =>
          fail(s"unexpected phase during the simulation: $other")
    state

  private val six = card(Rank.Six)
  private val seven = card(Rank.Seven)
  private val coveredTable = Vector(TablePair(six, Some(seven)))

  // --- Elimination ---

  test("a player with an empty hand finishes once the talon is depleted") {
    val gs = state(
      Vector(
        player("p0", Nil),
        player("p1", List(card(Rank.King, Suit.Hearts))),
        player("p2", List(card(Rank.Queen, Suit.Diamonds)))
      ),
      tablePairs = coveredTable
    )

    val next = applyOrFail(gs, GameAction.PassTurn("p2"))

    assertEquals(next.players(0).finishRank, Some(1))
    assertEquals(next.finishOrder, Vector("p0"))
    assertEquals(next.boutPhase, BoutPhase.InitialAttack)
  }

  test("a player who is still holding cards is not eliminated") {
    val gs = state(
      Vector(
        player("p0", Nil),
        player("p1", List(card(Rank.King, Suit.Hearts))),
        player("p2", List(card(Rank.Queen, Suit.Diamonds)))
      ),
      tablePairs = coveredTable,
      talon = Vector(card(Rank.Eight, Suit.Diamonds))
    )

    val next = applyOrFail(gs, GameAction.PassTurn("p2"))

    // The talon still had a card, so nobody leaves the game yet.
    assertEquals(next.finishOrder, Vector.empty)
    assert(next.players.forall(_.finishRank.isEmpty), next.players.map(_.finishRank))
  }

  test("the first player to finish gets finishRank 1") {
    val gs = state(
      Vector(
        player("p0", Nil),
        player("p1", List(card(Rank.King, Suit.Hearts))),
        player("p2", List(card(Rank.Queen, Suit.Diamonds)))
      ),
      tablePairs = coveredTable
    )

    val afterFirstPass = applyOrFail(gs, GameAction.PassTurn("p0"))
    val next = applyOrFail(afterFirstPass, GameAction.PassTurn("p2"))

    assertEquals(next.players(0).finishRank, Some(1))
    assertEquals(next.players(1).finishRank, None)
    assertEquals(next.players(2).finishRank, None)
  }

  test("players finishing in the same bout are ranked in seat order") {
    val gs = state(
      Vector(
        player("p0", Nil),
        player("p1", List(card(Rank.King, Suit.Hearts))),
        player("p2", Nil),
        player("p3", List(card(Rank.Queen, Suit.Diamonds)))
      ),
      tablePairs = coveredTable
    )

    val next = applyOrFail(gs, GameAction.PassTurn("p3"))

    assertEquals(next.players(0).finishRank, Some(1))
    assertEquals(next.players(2).finishRank, Some(2))
    assertEquals(next.finishOrder, Vector("p0", "p2"))
  }

  test("finish ranks continue after an earlier finisher") {
    val gs = state(
      Vector(
        player("p0", Nil),
        player("p1", List(card(Rank.King, Suit.Hearts))),
        player("p2", List(card(Rank.Jack, Suit.Diamonds))),
        player("p3", Nil, finishRank = Some(1))
      ),
      tablePairs = coveredTable,
      finishOrder = Vector("p3")
    )

    val next = applyOrFail(gs, GameAction.PassTurn("p2"))

    assertEquals(next.players(0).finishRank, Some(2))
    assertEquals(next.finishOrder, Vector("p3", "p0"))
  }

  // --- Durak and game over ---

  test("the last player with cards becomes the Durak") {
    val gs = state(
      Vector(
        player("p0", Nil),
        player("p1", List(card(Rank.King, Suit.Hearts)))
      ),
      tablePairs = coveredTable
    )

    val next = applyOrFail(gs, GameAction.PassTurn("p0"))

    assertEquals(next.players(0).finishRank, Some(1))
    assertEquals(next.players(1).finishRank, Some(2))
    assertEquals(next.finishOrder, Vector("p0", "p1"))
  }

  test("the game phase becomes GameOver once one player is left with cards") {
    val gs = state(
      Vector(
        player("p0", Nil),
        player("p1", List(card(Rank.King, Suit.Hearts))),
        player("p2", Nil)
      ),
      tablePairs = coveredTable
    )

    val next = applyOrFail(gs, GameAction.PassTurn("p2"))

    assertEquals(next.boutPhase, BoutPhase.GameOver)
    assertEquals(next.players(2).finishRank, Some(2))
    assertEquals(next.players(1).finishRank, Some(3))
    assertEquals(next.finishOrder, Vector("p0", "p2", "p1"))
  }

  test("the Durak has the highest finish rank") {
    val gs = state(
      Vector(
        player("p0", Nil),
        player("p1", List(card(Rank.King, Suit.Hearts))),
        player("p2", Nil)
      ),
      tablePairs = coveredTable
    )

    val next = applyOrFail(gs, GameAction.PassTurn("p2"))
    val ranks = next.finishOrder.map(id => next.players.find(_.id == id).flatMap(_.finishRank))

    assertEquals(ranks, Vector(Some(1), Some(2), Some(3)))
  }

  // --- Two-player draw ---

  test("both players covering their last cards in the same bout is a draw") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Six, Suit.Spades))),
        player("p1", List(card(Rank.Seven, Suit.Spades)))
      ),
      boutPhase = BoutPhase.InitialAttack,
      defenderInitialHandSize = 1
    )

    val attacked = applyOrFail(
      gs,
      GameAction.InitialAttack("p0", List(card(Rank.Six, Suit.Spades)))
    )
    val defended = applyOrFail(
      attacked,
      GameAction.CoverCard("p1", 0, card(Rank.Seven, Suit.Spades))
    )
    val next = applyOrFail(defended, GameAction.PassTurn("p0"))

    assert(next.isDraw)
    assertEquals(next.players(0).finishRank, Some(1))
    assertEquals(next.players(1).finishRank, Some(1))
    assertEquals(next.finishOrder.toSet, Set("p0", "p1"))
    assertEquals(next.finishOrder.size, 2)
    assertEquals(next.boutPhase, BoutPhase.GameOver)
  }

  // --- Multi-player endgame ---

  test("a three-player game eliminates players over successive bouts until one Durak remains") {
    // Bout 1: a covered attack. The defender takes over the attack, nobody is out.
    val boutOne = state(
      Vector(
        player("p0", List(card(Rank.Ace, Suit.Clubs))),
        player("p1", List(card(Rank.King, Suit.Hearts))),
        player("p2", List(card(Rank.Queen, Suit.Diamonds)))
      ),
      tablePairs = coveredTable
    )
    val afterFirstBout = applyOrFail(
      applyOrFail(boutOne, GameAction.PassTurn("p0")),
      GameAction.PassTurn("p2")
    )
    assertEquals(afterFirstBout.finishOrder, Vector.empty)
    assertEquals(afterFirstBout.players(afterFirstBout.attackerIdx).id, "p1")
    assertEquals(afterFirstBout.players(afterFirstBout.defenderIdx).id, "p2")

    // Bout 2: p1 plays its last card, p2 surrenders, and p1 goes out first.
    val attacked = applyOrFail(
      afterFirstBout,
      GameAction.InitialAttack("p1", List(card(Rank.King, Suit.Hearts)))
    )
    val surrendered = applyOrFail(attacked, GameAction.DeclareSurrender("p2"))
    val afterSecondBout = applyOrFail(surrendered, GameAction.PassTurn("p0"))

    assertEquals(afterSecondBout.players(1).finishRank, Some(1))
    assertEquals(afterSecondBout.finishOrder, Vector("p1"))
    assertEquals(afterSecondBout.boutPhase, BoutPhase.InitialAttack)
    assertEquals(afterSecondBout.players(afterSecondBout.attackerIdx).id, "p0")
    assertEquals(afterSecondBout.players(afterSecondBout.defenderIdx).id, "p2")

    // Bout 3: p0 plays its last card, p2 takes it, and p2 is left as the Durak.
    val attackedAgain = applyOrFail(
      afterSecondBout,
      GameAction.InitialAttack("p0", List(card(Rank.Ace, Suit.Clubs)))
    )
    val surrenderedAgain = applyOrFail(attackedAgain, GameAction.DeclareSurrender("p2"))
    val finished = applyOrFail(surrenderedAgain, GameAction.PassTurn("p0"))

    assertEquals(finished.finishOrder, Vector("p1", "p0", "p2"))
    assertEquals(finished.players(1).finishRank, Some(1))
    assertEquals(finished.players(0).finishRank, Some(2))
    assertEquals(finished.players(2).finishRank, Some(3))
    assertEquals(finished.boutPhase, BoutPhase.GameOver)
    assert(finished.activePlayersWithCards.isEmpty)
  }

  test("a four-player game eliminates players in rank order over several bouts") {
    // Bout 1: p0 is out of cards, so it finishes first and p1 takes the attack.
    val boutOne = state(
      Vector(
        player("p0", Nil),
        player("p1", List(card(Rank.King, Suit.Hearts))),
        player("p2", List(card(Rank.Queen, Suit.Diamonds))),
        player("p3", List(card(Rank.Jack, Suit.Clubs)))
      ),
      tablePairs = coveredTable
    )
    val afterFirstBout = applyOrFail(
      applyOrFail(boutOne, GameAction.PassTurn("p2")),
      GameAction.PassTurn("p3")
    )

    assertEquals(afterFirstBout.finishOrder, Vector("p0"))
    assertEquals(afterFirstBout.players(0).finishRank, Some(1))
    assertEquals(afterFirstBout.players(afterFirstBout.attackerIdx).id, "p1")
    assertEquals(afterFirstBout.players(afterFirstBout.defenderIdx).id, "p2")
    assertEquals(afterFirstBout.boutPhase, BoutPhase.InitialAttack)

    // Bout 2: p1 plays its last card, p2 surrenders, so p1 finishes second and
    // the game carries on with p2 and p3.
    val attacked = applyOrFail(
      afterFirstBout,
      GameAction.InitialAttack("p1", List(card(Rank.King, Suit.Hearts)))
    )
    val surrendered = applyOrFail(attacked, GameAction.DeclareSurrender("p2"))
    val afterSecondBout = applyOrFail(surrendered, GameAction.PassTurn("p3"))

    assertEquals(afterSecondBout.finishOrder, Vector("p0", "p1"))
    assertEquals(afterSecondBout.players(1).finishRank, Some(2))
    assertEquals(afterSecondBout.players(2).finishRank, None)
    assertEquals(afterSecondBout.players(3).finishRank, None)
    assertEquals(afterSecondBout.boutPhase, BoutPhase.InitialAttack)
    assertEquals(afterSecondBout.players(afterSecondBout.attackerIdx).id, "p3")
    assertEquals(afterSecondBout.players(afterSecondBout.defenderIdx).id, "p2")
  }

  test("a full two-player game played deterministically reaches GameOver") {
    def newGame: GameState =
      GameEngine.createGame(GameConfig(playerCount = 2, seed = 2024L), Vector("a", "b"))

    val end = runGame(newGame)

    assertEquals(end.boutPhase, BoutPhase.GameOver)
    assertEquals(end.talon, Vector.empty)
    assertEquals(end.finishOrder.size, 2)
    assertEquals(end.finishOrder.toSet, Set("p0", "p1"))

    val ranks = end.players.flatMap(_.finishRank)
    assertEquals(ranks.size, 2)
    if end.isDraw then assertEquals(ranks.sorted, Vector(1, 1))
    else assertEquals(ranks.sorted, Vector(1, 2))

    // The same seed and the same policy replay the same game.
    assertEquals(runGame(newGame).finishOrder, end.finishOrder)
  }
