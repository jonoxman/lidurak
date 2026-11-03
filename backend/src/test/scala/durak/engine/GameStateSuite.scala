package durak.engine

class GameStateSuite extends munit.FunSuite:

  private def card(rank: Rank, suit: Suit = Suit.Spades): Card = Card(suit, rank)

  private def player(
      id: String,
      handSize: Int = 6,
      finishRank: Option[Int] = None
  ): PlayerState =
    PlayerState(
      id = id,
      name = id.toUpperCase,
      hand = Vector.fill(handSize)(card(Rank.Six)),
      finishRank = finishRank
    )

  private def state(
      players: Vector[PlayerState],
      talon: Vector[Card] = Vector.empty,
      tablePairs: Vector[TablePair] = Vector.empty,
      boutPhase: BoutPhase = BoutPhase.InitialAttack,
      defenderInitialHandSize: Option[Int] = None,
      finishOrder: Vector[String] = Vector.empty,
      isDraw: Boolean = false
  ): GameState =
    GameState(
      config = GameConfig(players.size, seed = 42L),
      players = players,
      talon = talon,
      trumpSuit = Suit.Spades,
      bottomTrumpCard = None,
      discardPile = Vector.empty,
      tablePairs = tablePairs,
      attackerIdx = 0,
      defenderIdx = 1,
      boutPhase = boutPhase,
      defenderInitialHandSize = defenderInitialHandSize
        .getOrElse(players.headOption.map(_.hand.size).getOrElse(0)),
      finishOrder = finishOrder,
      isDraw = isDraw
    )

  test("activePlayers filters out finished players") {
    val gs = state(
      Vector(
        player("p0"),
        player("p1", finishRank = Some(1)),
        player("p2"),
        player("p3", finishRank = Some(2))
      )
    )
    assertEquals(gs.activePlayers.map(_.id), Vector("p0", "p2"))
  }

  test("activePlayersWithCards filters out empty hands") {
    val gs = state(
      Vector(
        player("p0"),
        player("p1", handSize = 0),
        player("p2", handSize = 3),
        player("p3", handSize = 0, finishRank = Some(1))
      )
    )
    assertEquals(gs.activePlayersWithCards.map(_.id), Vector("p0", "p2"))
  }

  test("maxBoutAttacks returns min(6, defenderInitialHandSize)") {
    val base = state(Vector(player("p0"), player("p1")))
    assertEquals(base.copy(defenderInitialHandSize = 7).maxBoutAttacks, 6)
    assertEquals(base.copy(defenderInitialHandSize = 6).maxBoutAttacks, 6)
    assertEquals(base.copy(defenderInitialHandSize = 4).maxBoutAttacks, 4)
    assertEquals(base.copy(defenderInitialHandSize = 1).maxBoutAttacks, 1)
    assertEquals(base.copy(defenderInitialHandSize = 0).maxBoutAttacks, 0)
  }

  test("nextActivePlayerIdx wraps around for 2 players") {
    val gs = state(Vector(player("p0"), player("p1")))
    assertEquals(gs.nextActivePlayerIdx(0), 1)
    assertEquals(gs.nextActivePlayerIdx(1), 0)
  }

  test("nextActivePlayerIdx wraps around for 3 players") {
    val gs = state(Vector(player("p0"), player("p1"), player("p2")))
    assertEquals(gs.nextActivePlayerIdx(0), 1)
    assertEquals(gs.nextActivePlayerIdx(1), 2)
    assertEquals(gs.nextActivePlayerIdx(2), 0)
  }

  test("nextActivePlayerIdx wraps around for 4 players") {
    val gs = state(Vector(player("p0"), player("p1"), player("p2"), player("p3")))
    assertEquals(gs.nextActivePlayerIdx(0), 1)
    assertEquals(gs.nextActivePlayerIdx(1), 2)
    assertEquals(gs.nextActivePlayerIdx(2), 3)
    assertEquals(gs.nextActivePlayerIdx(3), 0)
  }

  test("nextActivePlayerIdx skips finished players") {
    val gs = state(
      Vector(
        player("p0"),
        player("p1", finishRank = Some(1)),
        player("p2"),
        player("p3", finishRank = Some(2))
      )
    )
    assertEquals(gs.nextActivePlayerIdx(0), 2)
    assertEquals(gs.nextActivePlayerIdx(2), 0)
  }

  test("nextActivePlayerIdx returns the only active seat when all others finished") {
    val gs = state(Vector(player("p0"), player("p1", finishRank = Some(1))))
    assertEquals(gs.nextActivePlayerIdx(0), 0)
  }

  test("nextActivePlayerIdx keeps cardless players in rotation while the talon lasts") {
    val gs = state(
      Vector(player("p0"), player("p1", handSize = 0), player("p2", handSize = 3)),
      talon = Vector(card(Rank.Eight, Suit.Diamonds))
    )

    assertEquals(gs.nextActivePlayerIdx(0), 1)
  }

  test("nextActivePlayerIdx skips cardless players once the talon is depleted") {
    val gs = state(
      Vector(player("p0"), player("p1", handSize = 0), player("p2", handSize = 3))
    )

    assertEquals(gs.nextActivePlayerIdx(0), 2)
    assertEquals(gs.nextActivePlayerIdx(2), 0)
  }

  // --- Winners & Durak ---

  test("winners lists the finishers ahead of the Durak in finish order") {
    val gs = state(
      Vector(
        player("p0", handSize = 0, finishRank = Some(1)),
        player("p1", handSize = 0, finishRank = Some(2)),
        player("p2", handSize = 4, finishRank = Some(3)),
        player("p3", handSize = 0, finishRank = Some(4))
      ),
      boutPhase = BoutPhase.GameOver,
      finishOrder = Vector("p0", "p1", "p3", "p2")
    )

    assertEquals(gs.durak, Some("p2"))
    assertEquals(gs.winners, List("p0", "p1", "p3"))
  }

  test("winners holds every finisher while the game is still running") {
    val gs = state(
      Vector(
        player("p0", handSize = 0, finishRank = Some(1)),
        player("p1", handSize = 3),
        player("p2", handSize = 2)
      ),
      finishOrder = Vector("p0")
    )

    assertEquals(gs.isGameOver, false)
    assertEquals(gs.durak, None)
    assertEquals(gs.winners, List("p0"))
  }

  test("a draw has no Durak and every finisher is a winner") {
    val gs = state(
      Vector(
        player("p0", handSize = 0, finishRank = Some(1)),
        player("p1", handSize = 0, finishRank = Some(1))
      ),
      boutPhase = BoutPhase.GameOver,
      finishOrder = Vector("p0", "p1"),
      isDraw = true
    )

    assertEquals(gs.durak, None)
    assertEquals(gs.winners, List("p0", "p1"))
  }

  test("a game that ends with nobody holding cards has no Durak") {
    val gs = state(
      Vector(
        player("p0", handSize = 0, finishRank = Some(1)),
        player("p1", handSize = 0, finishRank = Some(2)),
        player("p2", handSize = 0, finishRank = Some(3))
      ),
      boutPhase = BoutPhase.GameOver,
      finishOrder = Vector("p0", "p1", "p2")
    )

    assertEquals(gs.durak, None)
    assertEquals(gs.winners, List("p0", "p1", "p2"))
  }

  // --- Card conservation ---

  private def tableCardCount(gs: GameState): Int =
    gs.tablePairs.map(pair => 1 + pair.defense.size).sum

  private def totalCards(gs: GameState): Int =
    gs.talon.size + gs.discardPile.size + gs.players.map(_.hand.size).sum + tableCardCount(gs)

  private def deckCardCount(playerCount: Int): Int = Deck.forPlayerCount(playerCount).size

  /** Applies `action`, asserting that the card total stays at `expected`. */
  private def keepTotal(gs: GameState, action: GameAction, expected: Int): GameState =
    val next = GameEngine.applyAction(gs, action) match
      case Right(state) => state
      case Left(error)  => fail(s"$action was rejected: $error")
    assertEquals(totalCards(next), expected, s"card total drifted after $action")
    next

  test("attack, redirect, throw-in, cover, surrender and pass all conserve every card") {
    val six = card(Rank.Six, Suit.Clubs)
    val seven = card(Rank.Seven, Suit.Clubs)
    val eight = card(Rank.Eight, Suit.Spades)
    val nine = card(Rank.Nine, Suit.Spades)
    val redirectCard = card(Rank.Six, Suit.Diamonds)
    val thrownCard = card(Rank.Six, Suit.Hearts)
    val talon = Vector(card(Rank.Ten, Suit.Diamonds), card(Rank.Jack, Suit.Diamonds))

    val start = state(
      Vector(
        player("p0").copy(hand = Vector(thrownCard, card(Rank.Ace, Suit.Clubs))),
        player("p1").copy(hand = Vector(redirectCard, nine)),
        player("p2").copy(hand = Vector(seven, eight, card(Rank.Queen, Suit.Hearts)))
      ),
      talon = talon,
      tablePairs = Vector(TablePair(six)),
      boutPhase = BoutPhase.Defense,
      defenderInitialHandSize = Some(3)
    )
    val expected = totalCards(start)

    val redirected = keepTotal(
      start,
      GameAction.RedirectAttack("p1", List(redirectCard)),
      expected
    )
    assertEquals(redirected.defenderIdx, 2)

    val thrownIn = keepTotal(redirected, GameAction.ThrowInCards("p0", List(thrownCard)), expected)
    assertEquals(thrownIn.tablePairs.size, 3)

    val covered = keepTotal(thrownIn, GameAction.CoverCard("p2", 0, seven), expected)
    val coveredAgain = keepTotal(covered, GameAction.CoverCard("p2", 1, eight), expected)

    // The table is full and no other seat holds a matching rank, so nobody is
    // passed inside the surrender: the delayed auto-pass settles it and the
    // defender picks up all five table cards on top of the one still held.
    val surrendered = keepTotal(
      coveredAgain,
      GameAction.DeclareSurrender("p2"),
      expected
    )
    assertEquals(surrendered.boutPhase, BoutPhase.SurrenderThrowIn)
    val settled = GameEngine.autoPassSurrenderThrowers(surrendered)
    assertEquals(totalCards(settled), expected)
    assertEquals(settled.tablePairs, Vector.empty)
    assertEquals(settled.discardPile, Vector.empty)
    assertEquals(settled.players(2).hand.size, 6)
  }

  /** Every plausible action for the current phase; illegal ones are filtered out. */
  private def candidateActions(gs: GameState): List[GameAction] =
    val defenderIdx = gs.defenderIdx
    def handOf(index: Int): List[Card] = gs.players(index).hand.toList
    val others = gs.players.zipWithIndex.collect {
      case (player, idx) if idx != defenderIdx => (player.id, idx)
    }.toList

    gs.players.lift(defenderIdx) match
      case None => Nil
      case Some(defender) =>
        gs.boutPhase match
          case BoutPhase.InitialAttack =>
            gs.players.lift(gs.attackerIdx).toList.flatMap { attacker =>
              handOf(gs.attackerIdx).map(card => GameAction.InitialAttack(attacker.id, List(card)))
            }
          case BoutPhase.Defense =>
            val defenderActions =
              gs.tablePairs.indices.toList.flatMap { idx =>
                handOf(defenderIdx).map(card => GameAction.CoverCard(defender.id, idx, card))
              } ++
                handOf(defenderIdx).map(card => GameAction.RedirectAttack(defender.id, List(card))) :+
                GameAction.DeclareSurrender(defender.id)
            val throwIns = others.flatMap { case (id, idx) =>
              handOf(idx).map(card => GameAction.ThrowInCards(id, List(card)))
            }
            defenderActions ++ throwIns ++ others.map { case (id, _) => GameAction.PassTurn(id) }
          case BoutPhase.SurrenderThrowIn =>
            val throwIns = others.flatMap { case (id, idx) =>
              handOf(idx).map(card => GameAction.ThrowInCards(id, List(card)))
            }
            throwIns ++ others.map { case (id, _) => GameAction.PassTurn(id) }
          case BoutPhase.BoutOver | BoutPhase.GameOver =>
            Nil

  /** Plays a full game with random legal actions, checking the total after every move. */
  private def randomPlaythrough(playerCount: Int, seed: Long, maxSteps: Int = 4000): GameState =
    val names = (1 to playerCount).map(index => s"Player$index").toVector
    val start = GameEngine.createGame(GameConfig(playerCount, seed = seed), names)
    val expected = deckCardCount(playerCount)
    assertEquals(totalCards(start), expected, s"the deal must use the whole $playerCount-player deck")

    val random = new scala.util.Random(seed + 1L)
    var gs = start
    var steps = 0
    while gs.boutPhase != BoutPhase.GameOver && steps < maxSteps do
      steps += 1
      val legal = candidateActions(gs).filter(action => GameEngine.applyAction(gs, action).isRight)
      assert(
        legal.nonEmpty,
        s"no legal action at step $steps of a $playerCount-player game (${gs.boutPhase})"
      )
      val action = legal(random.nextInt(legal.size))
      gs = keepTotal(gs, action, expected)
    gs

  test("full random playthroughs conserve all 36 (or 52) cards on every action") {
    assertEquals(deckCardCount(2), 36)
    assertEquals(deckCardCount(3), 36)
    assertEquals(deckCardCount(4), 52)

    val endings = List(
      randomPlaythrough(playerCount = 2, seed = 11L),
      randomPlaythrough(playerCount = 3, seed = 22L),
      randomPlaythrough(playerCount = 4, seed = 33L)
    )

    endings.foreach { end =>
      assertEquals(end.boutPhase, BoutPhase.GameOver)
      assertEquals(totalCards(end), deckCardCount(end.players.size))
      assertEquals(end.finishOrder.size, end.players.size)
      end.durak.foreach { id =>
        val durakPlayer = end.players.find(_.id == id).getOrElse(fail(s"unknown durak $id"))
        assert(durakPlayer.hasCards, "the Durak must still hold cards")
      }
      assertEquals(end.winners.size + end.durak.size, end.finishOrder.size)
    }
  }
