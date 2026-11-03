package durak.engine

import scala.util.Random

class BasicBotSuite extends munit.FunSuite:

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

  private def assertLegal(gs: GameState, action: GameAction): Unit =
    assert(
      GameEngine.applyAction(gs, action).isRight,
      s"BasicBot offered an action the engine rejects: $action"
    )

  // --- Opening attacks ---

  test("an opening attack uses the lowest-ranked non-trump card") {
    val sixClubs = card(Rank.Six, Suit.Clubs)
    val gs = state(
      Vector(
        player(
          "p0",
          List(card(Rank.King, Suit.Hearts), sixClubs, card(Rank.Nine, Suit.Diamonds))
        ),
        player("p1", List(card(Rank.Seven, Suit.Hearts)))
      ),
      boutPhase = BoutPhase.InitialAttack
    )

    val chosen = BasicBot.chooseAction(gs, "p0", new Random(1L))

    assertEquals(chosen, Some(GameAction.InitialAttack("p0", List(sixClubs))))
    chosen.foreach(action => assertLegal(gs, action))
  }

  test("an opening attack skips trumps while a non-trump card is available") {
    val sixSpades = card(Rank.Six, Suit.Spades) // trump
    val tenClubs = card(Rank.Ten, Suit.Clubs)
    val gs = state(
      Vector(
        player("p0", List(sixSpades, tenClubs)),
        player("p1", List(card(Rank.Seven, Suit.Hearts)))
      ),
      boutPhase = BoutPhase.InitialAttack
    )

    assertEquals(
      BasicBot.chooseAction(gs, "p0", new Random(2L)),
      Some(GameAction.InitialAttack("p0", List(tenClubs)))
    )
  }

  test("an opening attack picks a trump card when the hand holds only trumps") {
    val sixSpades = card(Rank.Six, Suit.Spades)
    val aceSpades = card(Rank.Ace, Suit.Spades)
    val gs = state(
      Vector(
        player("p0", List(sixSpades, aceSpades)),
        player("p1", List(card(Rank.Seven, Suit.Hearts)))
      ),
      boutPhase = BoutPhase.InitialAttack
    )

    (0 until 20).foreach { seed =>
      BasicBot.chooseAction(gs, "p0", new Random(seed.toLong)) match
        case Some(action @ GameAction.InitialAttack("p0", List(attack), _)) =>
          assertEquals(attack.suit, Suit.Spades)
          assert(Set(sixSpades, aceSpades).contains(attack), s"unexpected trump: $attack")
          assertLegal(gs, action)
        case other => fail(s"expected a single trump opening attack, got $other")
    }

    // The trump pick must come from the RNG rather than always being the lowest
    // trump: every index the RNG returns selects that trump, lowest or not.
    def pickWith(index: Int): Option[GameAction] =
      BasicBot.chooseAction(gs, "p0", new Random { override def nextInt(bound: Int): Int = index })

    assertEquals(pickWith(0), Some(GameAction.InitialAttack("p0", List(sixSpades))))
    assertEquals(pickWith(1), Some(GameAction.InitialAttack("p0", List(aceSpades))))
  }

  // --- Defending ---

  test("a defender covers with the cheapest non-trump card instead of surrendering") {
    val attack = card(Rank.Six, Suit.Spades)
    val sevenSpades = card(Rank.Seven, Suit.Spades)
    val nineSpades = card(Rank.Nine, Suit.Spades)
    val kingHearts = card(Rank.King, Suit.Hearts) // trump, also a legal cover
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Ace, Suit.Clubs))),
        player("p1", List(nineSpades, sevenSpades, kingHearts))
      ),
      tablePairs = Vector(TablePair(attack)),
      trumpSuit = Suit.Hearts
    )

    (0 until 10).foreach { seed =>
      val chosen = BasicBot.chooseAction(gs, "p1", new Random(seed.toLong))
      assertEquals(chosen, Some(GameAction.CoverCard("p1", 0, sevenSpades)))
      chosen.foreach(action => assertLegal(gs, action))
    }
  }

  test("a defender redirects rather than surrendering when it cannot cover") {
    val sixClubs = card(Rank.Six, Suit.Clubs)
    val gs = state(
      Vector(
        player(
          "p0",
          List(card(Rank.Ace, Suit.Clubs), card(Rank.King, Suit.Clubs), card(Rank.Queen, Suit.Clubs))
        ),
        player("p1", List(sixClubs, card(Rank.King, Suit.Spades))),
        player(
          "p2",
          List(card(Rank.Ace, Suit.Hearts), card(Rank.King, Suit.Spades), card(Rank.Queen, Suit.Spades))
        )
      ),
      tablePairs = Vector(TablePair(card(Rank.Six, Suit.Diamonds))),
      trumpSuit = Suit.Hearts
    )

    val chosen = BasicBot.chooseAction(gs, "p1", new Random(3L))

    assertEquals(chosen, Some(GameAction.RedirectAttack("p1", List(sixClubs))))
    chosen.foreach(action => assertLegal(gs, action))
  }

  test("a defender surrenders only when it cannot cover or redirect") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Ace, Suit.Clubs))),
        player("p1", List(card(Rank.Seven, Suit.Clubs), card(Rank.Eight, Suit.Diamonds)))
      ),
      tablePairs = Vector(TablePair(card(Rank.Six, Suit.Spades))),
      trumpSuit = Suit.Hearts
    )

    assertEquals(
      BasicBot.chooseAction(gs, "p1", new Random(4L)),
      Some(GameAction.DeclareSurrender("p1"))
    )
  }

  // --- Throw-ins ---

  test("throw-ins after a surrender use non-trump cards and never trumps") {
    val sixDiamonds = card(Rank.Six, Suit.Diamonds) // non-trump, matches the table rank
    val sixHearts = card(Rank.Six, Suit.Hearts)     // trump, also matches
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Ace, Suit.Clubs))),
        player("p1", List(card(Rank.Seven, Suit.Clubs))),
        player("p2", List(sixHearts, sixDiamonds))
      ),
      tablePairs = Vector(TablePair(card(Rank.Six, Suit.Spades))),
      boutPhase = BoutPhase.SurrenderThrowIn,
      trumpSuit = Suit.Hearts
    )

    (0 until 10).foreach { seed =>
      assertEquals(
        BasicBot.chooseAction(gs, "p2", new Random(seed.toLong)),
        Some(GameAction.ThrowInCards("p2", List(sixDiamonds)))
      )
    }
  }

  test("a thrower passes with only trump throw-ins left after a surrender") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Ace, Suit.Clubs))),
        player("p1", List(card(Rank.Seven, Suit.Clubs))),
        player("p2", List(card(Rank.Six, Suit.Hearts)))
      ),
      tablePairs = Vector(TablePair(card(Rank.Six, Suit.Spades))),
      boutPhase = BoutPhase.SurrenderThrowIn,
      trumpSuit = Suit.Hearts
    )

    assertEquals(
      BasicBot.chooseAction(gs, "p2", new Random(5L)),
      Some(GameAction.PassTurn("p2"))
    )
  }

  test("a surrendering defender has no move at all") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Six, Suit.Clubs))),
        player("p1", List(card(Rank.Seven, Suit.Clubs)))
      ),
      tablePairs = Vector(TablePair(card(Rank.Six, Suit.Spades))),
      boutPhase = BoutPhase.SurrenderThrowIn
    )

    assertEquals(BasicBot.legalActionsFor(gs, "p1"), Vector.empty)
    assertEquals(BasicBot.chooseAction(gs, "p1", new Random(6L)), None)
  }

  // --- Seat types ---

  test("basicBot is a bot seat type that survives normalization") {
    val config = GameConfig(
      playerCount = 2,
      playerTypes = GameConfig.normalizePlayerTypes(2, Vector("basicBot", "human"))
    )

    assertEquals(config.seatType(0), GameConfig.BasicBotSeat)
    assert(config.isBotSeat(0))
    assert(!config.isBotSeat(1))
    assertEquals(config.seatType(1), GameConfig.HumanSeat)
    assertEquals(
      GameConfig.normalizePlayerTypes(3, Vector("basicBot")),
      Vector("basicBot", "human", "human")
    )
    assertEquals(
      GameConfig.normalizePlayerTypes(2, Vector("randomBot", "BasicBot")),
      Vector("randomBot", "basicBot")
    )
  }

  // --- Full games ---

  test("full BasicBot games always complete with legal moves") {
    for
      playerCount <- 2 to 4
      seed <- 1L to 6L
    do
      val start = GameEngine.createGame(
        GameConfig(
          playerCount = playerCount,
          seed = seed,
          playerTypes = Vector.fill(playerCount)("basicBot")
        ),
        Vector.tabulate(playerCount)(idx => s"b$idx")
      )
      val random = new Random(seed * 17L + playerCount)
      var current = start
      var moves = 0
      var surrenderedInBout: Option[String] = None

      while !current.isGameOver && moves < 3000 do
        if current.boutPhase == BoutPhase.InitialAttack then surrenderedInBout = None
        surrenderedInBout.foreach { defenderId =>
          assertEquals(
            BasicBot.legalActionsFor(current, defenderId),
            Vector.empty,
            s"the surrendering defender $defenderId was offered a move in ${current.boutPhase}"
          )
        }

        val action = current.players.indices.iterator
          .flatMap(idx => BasicBot.chooseAction(current, current.players(idx).id, random))
          .nextOption()
          .getOrElse(
            fail(
              s"BasicBot had no move: $playerCount players, seed $seed, phase ${current.boutPhase}"
            )
          )

        action match
          case GameAction.InitialAttack(_, List(opening), _) =>
            if current.boutPhase == BoutPhase.InitialAttack then
              val hand = current.players(current.attackerIdx).hand
              val nonTrump = hand.filter(_.suit != current.trumpSuit)
              if nonTrump.nonEmpty then
                assert(opening.suit != current.trumpSuit, s"opened with a trump: $action")
                assertEquals(opening.rank.value, nonTrump.map(_.rank.value).min)
          case GameAction.ThrowInCards(_, cards) =>
            if current.boutPhase == BoutPhase.SurrenderThrowIn then
              assert(
                cards.forall(_.suit != current.trumpSuit),
                s"threw in a trump after a surrender: $action"
              )
          case GameAction.DeclareSurrender(playerId) =>
            val defenses = BasicBot.legalActionsFor(current, playerId).collect {
              case cover: GameAction.CoverCard         => cover
              case redirect: GameAction.RedirectAttack => redirect
            }
            assertEquals(defenses, Vector.empty, s"surrendered with a legal defense: $action")
          case _ => ()

        current = GameEngine.applyAction(current, action) match
          case Right(advanced) => advanced
          case Left(error)      => fail(s"BasicBot played an illegal $action: $error")

        action match
          case GameAction.DeclareSurrender(playerId) => surrenderedInBout = Some(playerId)
          case _                                      => ()
        moves += 1

      assert(
        current.isGameOver,
        s"the $playerCount-player BasicBot match for seed $seed did not finish in $moves moves"
      )
  }
