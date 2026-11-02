package durak.engine

import scala.util.Random

class RandomBotSuite extends munit.FunSuite:

  private def card(rank: Rank, suit: Suit = Suit.Spades): Card = Card(suit, rank)

  private def player(
      id: String,
      hand: List[Card],
      hasPassed: Boolean = false,
      finishRank: Option[Int] = None
  ): PlayerState =
    PlayerState(id, id.toUpperCase, hand.toVector, hasPassed, finishRank)

  private def state(
      players: Vector[PlayerState],
      tablePairs: Vector[TablePair] = Vector.empty,
      attackerIdx: Int = 0,
      defenderIdx: Int = 1,
      boutPhase: BoutPhase = BoutPhase.Defense,
      trumpSuit: Suit = Suit.Spades,
      allowRedirect: Boolean = true,
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

  private def assertAllLegal(gs: GameState, actions: Vector[GameAction]): Unit =
    actions.foreach { action =>
      assert(
        GameEngine.applyAction(gs, action).isRight,
        s"bot offered an action the engine rejects: $action"
      )
    }

  // --- Attacking ---

  test("an attacker can open the bout with any card in hand") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Six), card(Rank.Seven, Suit.Hearts))),
        player("p1", List(card(Rank.Eight))),
        player("p2", List(card(Rank.Nine)))
      ),
      boutPhase = BoutPhase.InitialAttack
    )

    val actions = RandomBot.legalActionsFor(gs, "p0")

    assertEquals(
      actions.toSet,
      Set(
        GameAction.InitialAttack("p0", List(card(Rank.Six))),
        GameAction.InitialAttack("p0", List(card(Rank.Seven, Suit.Hearts)))
      )
    )
    assertAllLegal(gs, actions)
    assertEquals(RandomBot.legalActionsFor(gs, "p1"), Vector.empty)
  }

  test("a finished player has nothing to play") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Six)), finishRank = Some(1)),
        player("p1", List(card(Rank.Eight)))
      ),
      boutPhase = BoutPhase.InitialAttack
    )

    assertEquals(RandomBot.legalActionsFor(gs, "p0"), Vector.empty)
  }

  // --- Defending ---

  test("a defender can cover, redirect or surrender") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.King))),
        player("p1", List(card(Rank.Seven), card(Rank.Six, Suit.Clubs))),
        player("p2", List(card(Rank.Eight, Suit.Diamonds), card(Rank.Nine, Suit.Diamonds)))
      ),
      tablePairs = Vector(TablePair(card(Rank.Six)))
    )

    val actions = RandomBot.legalActionsFor(gs, "p1")

    assertEquals(
      actions.toSet,
      Set(
        GameAction.CoverCard("p1", 0, card(Rank.Seven)),
        GameAction.RedirectAttack("p1", List(card(Rank.Six, Suit.Clubs))),
        GameAction.DeclareSurrender("p1")
      )
    )
    assertAllLegal(gs, actions)
  }

  test("a defender never offers a redirect when redirects are disabled") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.King))),
        player("p1", List(card(Rank.Six, Suit.Clubs))),
        player("p2", List(card(Rank.Eight), card(Rank.Nine)))
      ),
      tablePairs = Vector(TablePair(card(Rank.Six))),
      allowRedirect = false
    )

    assertEquals(
      RandomBot.legalActionsFor(gs, "p1").toSet,
      Set(GameAction.DeclareSurrender("p1"))
    )
  }

  test("a thrower may pass or throw in once every attack is covered") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.King))),
        player("p1", List(card(Rank.Seven))),
        player("p2", List(card(Rank.Six, Suit.Hearts), card(Rank.Nine, Suit.Clubs)))
      ),
      tablePairs = Vector(TablePair(card(Rank.Six), Some(card(Rank.Seven))))
    )

    val actions = RandomBot.legalActionsFor(gs, "p2")

    assertEquals(
      actions.toSet,
      Set(
        GameAction.PassTurn("p2"),
        GameAction.ThrowInCards("p2", List(card(Rank.Six, Suit.Hearts)))
      )
    )
    assertAllLegal(gs, actions)
  }

  // --- Surrender throw-ins ---

  test("a thrower may pass or throw in while the bout is in surrender throw-ins") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.King))),
        player("p1", List(card(Rank.Seven))),
        player("p2", List(card(Rank.Six, Suit.Hearts), card(Rank.Nine, Suit.Clubs)))
      ),
      tablePairs = Vector(TablePair(card(Rank.Six))),
      boutPhase = BoutPhase.SurrenderThrowIn
    )

    assertEquals(
      RandomBot.legalActionsFor(gs, "p2").toSet,
      Set(
        GameAction.PassTurn("p2"),
        GameAction.ThrowInCards("p2", List(card(Rank.Six, Suit.Hearts)))
      )
    )
    // The surrendering defender has already lost the bout.
    assertEquals(RandomBot.legalActionsFor(gs, "p1"), Vector.empty)
  }

  // --- Choosing ---

  test("chooseAction only returns legal actions and is deterministic for a seed") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.King))),
        player("p1", List(card(Rank.Seven), card(Rank.Six, Suit.Clubs)))
      ),
      tablePairs = Vector(TablePair(card(Rank.Six)))
    )
    val legal = RandomBot.legalActionsFor(gs, "p1").toSet

    val chosen = RandomBot.chooseAction(gs, "p1", new Random(7L))

    assert(chosen.exists(legal.contains), chosen.toString)
    assertEquals(
      RandomBot.chooseAction(gs, "p1", new Random(7L)),
      RandomBot.chooseAction(gs, "p1", new Random(7L))
    )
  }

  test("chooseAction offers nothing once the game is over or the seat cannot act") {
    val defending = state(
      Vector(player("p0", List(card(Rank.King))), player("p1", List(card(Rank.Seven))))
    )
    assertEquals(RandomBot.chooseAction(defending, "p1", new Random(1L)), None)

    val over = defending.copy(boutPhase = BoutPhase.GameOver)
    assertEquals(RandomBot.chooseAction(over, "p0", new Random(1L)), None)
    assertEquals(RandomBot.chooseAction(defending, "ghost", new Random(1L)), None)
  }

  test("a bot-only self-play game only ever plays legal moves") {
    var current = GameEngine.createGame(
      GameConfig(
        playerCount = 2,
        seed = 11L,
        playerTypes = Vector("randomBot", "randomBot")
      ),
      Vector("a", "b")
    )
    val random = new Random(3L)
    var moves = 0

    while !current.isGameOver && moves < 2000 do
      val next = current.players.indices.iterator
        .flatMap(idx => RandomBot.chooseAction(current, current.players(idx).id, random))
        .nextOption()

      next match
        case None => moves = 2000
        case Some(action) =>
          GameEngine.applyAction(current, action) match
            case Right(advanced) =>
              current = advanced
              moves += 1
            case Left(error) =>
              fail(s"bot played an illegal action $action: $error")

    assert(moves > 0, "the bot never played a move")
  }

  // --- Strict legal-move invariants ---

  test("a surrendering defender is offered no moves at all") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.King))),
        player("p1", List(card(Rank.Six, Suit.Hearts), card(Rank.Seven))),
        player("p2", List(card(Rank.Six, Suit.Clubs)))
      ),
      tablePairs = Vector(TablePair(card(Rank.Six))),
      boutPhase = BoutPhase.SurrenderThrowIn
    )

    assertEquals(RandomBot.legalActionsFor(gs, "p1"), Vector.empty)
    assertEquals(RandomBot.chooseAction(gs, "p1", new Random(5L)), None)
    // The non-defenders may still throw in or settle the bout.
    assert(RandomBot.legalActionsFor(gs, "p2").nonEmpty)
  }

  test("a bot never offers a redirect to a cardless opponent") {
    val gs = state(
      Vector(
        player("p0", Nil),
        player("p1", List(card(Rank.Six, Suit.Hearts), card(Rank.Seven)))
      ),
      tablePairs = Vector(TablePair(card(Rank.Six)))
    )

    val actions = RandomBot.legalActionsFor(gs, "p1")

    assert(actions.nonEmpty, "the defender can still cover or surrender")
    assert(
      !actions.exists(_.isInstanceOf[GameAction.RedirectAttack]),
      s"a cardless opponent must not be redirected to: $actions"
    )
    assertAllLegal(gs, actions)
  }

  test("bot self-play never produces an illegal redirect, self-cover or repeated surrender") {
    for
      playerCount <- 2 to 4
      seed <- 1L to 8L
    do
      val start = GameEngine.createGame(
        GameConfig(
          playerCount = playerCount,
          seed = seed,
          playerTypes = Vector.fill(playerCount)("randomBot")
        ),
        Vector.tabulate(playerCount)(idx => s"b$idx")
      )
      val random = new Random(seed * 31L + playerCount)
      var current = start
      var moves = 0
      var surrenderedInBout: Option[String] = None

      while !current.isGameOver && moves < 3000 do
        if current.boutPhase == BoutPhase.InitialAttack then surrenderedInBout = None
        surrenderedInBout.foreach { defenderId =>
          assertEquals(
            RandomBot.legalActionsFor(current, defenderId),
            Vector.empty,
            s"the surrendering defender $defenderId was offered a move in ${current.boutPhase}"
          )
        }

        val actor = current.players.indices
          .map(idx => current.players(idx).id)
          .find(playerId => RandomBot.legalActionsFor(current, playerId).nonEmpty)
          .getOrElse(
            fail(
              s"no seat could act: $playerCount players, seed $seed, phase ${current.boutPhase}"
            )
          )
        val action = RandomBot
          .chooseAction(current, actor, random)
          .getOrElse(fail(s"chooseAction returned nothing for $actor"))

        action match
          case GameAction.CoverCard(playerId, _, _) =>
            assertEquals(playerId, current.players(current.defenderIdx).id)
          case GameAction.RedirectAttack(playerId, cards) =>
            assertEquals(playerId, current.players(current.defenderIdx).id)
            assert(cards.nonEmpty, "a redirect must contain at least one card")
            assert(
              current.nextActivePlayerIdx(current.defenderIdx) != current.defenderIdx,
              s"a redirect must never target the redirecting seat: $action"
            )
          case _ => ()

        current = GameEngine.applyAction(current, actor, action) match
          case Right(advanced) => advanced
          case Left(error)      => fail(s"bot $actor played an illegal $action: $error")

        action match
          case GameAction.DeclareSurrender(playerId) => surrenderedInBout = Some(playerId)
          case _                                      => ()
        moves += 1

      assert(
        current.isGameOver,
        s"the $playerCount-player bot match for seed $seed did not finish in $moves moves"
      )
  }
