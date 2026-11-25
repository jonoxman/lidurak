package durak.engine

class GameInitSuite extends munit.FunSuite:

  private def names(n: Int): Vector[String] = Vector.tabulate(n)(i => s"Player$i")

  private def game(playerCount: Int, seed: Long): GameState =
    GameEngine.createGame(GameConfig(playerCount, seed = seed), names(playerCount))

  /** Lowest trump rank held by the given player, if any. */
  private def lowestTrumpRank(state: GameState, playerIdx: Int): Option[Int] =
    state.players(playerIdx).hand
      .filter(_.suit == state.trumpSuit)
      .map(_.rank.value)
      .minOption

  /** Finds the first seed whose game satisfies the predicate. */
  private def findSeed(playerCount: Int)(pred: GameState => Boolean): Long =
    val maxSeeds = 20000L
    (0L until maxSeeds)
      .find(seed => pred(game(playerCount, seed)))
      .getOrElse(fail(s"No seed below $maxSeeds satisfied the predicate"))

  test("same seed produces identical states") {
    val first = game(3, 1234L)
    val second = game(3, 1234L)
    assertEquals(first, second)
  }

  test("every player receives exactly 6 cards") {
    for n <- 2 to 4 do
      val state = game(n, 42L)
      state.players.foreach { player =>
        assertEquals(player.hand.size, 6, s"player ${player.id} in a $n-player game")
      }
  }

  test("all cards across hands and talon are unique and complete") {
    for n <- 2 to 4 do
      val state = game(n, 99L)
      val deck = Deck.forPlayerCount(n)
      val allCards = state.players.flatMap(_.hand) ++ state.talon
      assertEquals(allCards.size, deck.size)
      assertEquals(allCards.distinct.size, allCards.size)
      assertEquals(allCards.toSet, deck.toSet)
      assertEquals(state.talon.size, deck.size - 6 * n)
  }

  test("trumpSuit matches the bottom trump card suit") {
    for n <- 2 to 4 do
      val state = game(n, 7L)
      assertEquals(state.bottomTrumpCard.map(_.suit), Some(state.trumpSuit))
  }

  test("bottom trump card is the last card of the talon") {
    for n <- 2 to 4 do
      val state = game(n, 7L)
      assert(state.bottomTrumpCard.isDefined)
      assertEquals(state.talon.last, state.bottomTrumpCard.get)
  }

  test("first attacker holds the lowest trump rank") {
    val seed = findSeed(2)(state =>
      state.players.exists(_.hand.exists(_.suit == state.trumpSuit))
    )
    val state = game(2, seed)
    val lowest = state.players
      .flatMap(_.hand.filter(_.suit == state.trumpSuit).map(_.rank.value))
      .min
    assertEquals(lowestTrumpRank(state, state.attackerIdx), Some(lowest))
  }

  test("first attacker holds the lowest trump rank in a 4-player game") {
    val seed = findSeed(4)(state =>
      state.players.exists(_.hand.exists(_.suit == state.trumpSuit))
    )
    val state = game(4, seed)
    val lowest = state.players
      .flatMap(_.hand.filter(_.suit == state.trumpSuit).map(_.rank.value))
      .min
    assertEquals(lowestTrumpRank(state, state.attackerIdx), Some(lowest))
  }

  test("attacker falls back to seat 0 when nobody holds a trump") {
    val seed = findSeed(2)(state =>
      state.players.forall(!_.hand.exists(_.suit == state.trumpSuit))
    )
    val state = game(2, seed)
    assertEquals(state.attackerIdx, 0)
  }

  test("defender is the next active player clockwise") {
    for n <- 2 to 4 do
      for seed <- Vector(0L, 1L, 17L, 2024L) do
        val state = game(n, seed)
        assertEquals(state.defenderIdx, (state.attackerIdx + 1) % n)
  }

  test("bout starts in InitialAttack with the defender's hand size recorded") {
    for n <- 2 to 4 do
      val state = game(n, 555L)
      assertEquals(state.boutPhase, BoutPhase.InitialAttack)
      assertEquals(state.defenderInitialHandSize, state.players(state.defenderIdx).hand.size)
      assertEquals(state.defenderInitialHandSize, 6)
  }

  test("player names and seats are preserved") {
    val state = game(3, 1L)
    assertEquals(state.players.map(_.name), names(3))
    assertEquals(state.players.map(_.id).distinct.size, 3)
  }

  test("mismatched player name count throws") {
    intercept[IllegalArgumentException] {
      GameEngine.createGame(GameConfig(3, seed = 1L), names(2))
    }
  }

  test("unsupported player count throws") {
    intercept[IllegalArgumentException] {
      GameEngine.createGame(GameConfig(5, seed = 1L), names(5))
    }
  }

  // --- Configured deck size (ITEM-6a) --------------------------------------

  private def deckedGame(playerCount: Int, deckSize: Option[Int], seed: Long = 42L): GameState =
    GameEngine.createGame(
      GameConfig(playerCount, seed = seed, deckSize = deckSize),
      names(playerCount)
    )

  test("a two-player 52-card game leaves a 40-card talon") {
    val state = deckedGame(2, Some(52))
    assertEquals(state.players.map(_.hand.size), Vector(6, 6))
    assertEquals(state.talon.size, 40)

    val allCards = state.players.flatMap(_.hand) ++ state.talon
    assertEquals(allCards.size, 52)
    assertEquals(allCards.distinct.size, 52)
    assertEquals(allCards.toSet, Deck.standard52.toSet)
  }

  test("a three-player 52-card game leaves a 34-card talon") {
    val state = deckedGame(3, Some(52))
    assertEquals(state.players.map(_.hand.size), Vector(6, 6, 6))
    assertEquals(state.talon.size, 34)
    assertEquals((state.players.flatMap(_.hand) ++ state.talon).toSet, Deck.standard52.toSet)
  }

  test("two- and three-player games still default to the 36-card deck") {
    assertEquals(deckedGame(2, None).talon.size, 24)
    assertEquals(deckedGame(3, None).talon.size, 18)
    assertEquals(deckedGame(2, Some(36)).talon.size, 24)
    assertEquals(deckedGame(4, None).talon.size, 28)
  }

  test("an explicitly requested 52-card deck keeps every trump rule") {
    val state = deckedGame(3, Some(52), seed = 7L)
    assertEquals(state.bottomTrumpCard.map(_.suit), Some(state.trumpSuit))
    assertEquals(state.talon.last, state.bottomTrumpCard.get)
    assertEquals(state.defenderIdx, (state.attackerIdx + 1) % 3)
    assertEquals(state.defenderInitialHandSize, 6)
  }

  test("createGame rejects an invalid deck setting") {
    intercept[IllegalArgumentException] {
      GameEngine.createGame(GameConfig(2, seed = 1L, deckSize = Some(40)), names(2))
    }
    val fourPlayer36 = intercept[IllegalArgumentException] {
      GameEngine.createGame(GameConfig(4, seed = 1L, deckSize = Some(36)), names(4))
    }
    assert(fourPlayer36.getMessage.contains("four-player"), fourPlayer36.getMessage)
  }

  test("createGame stores the deck setting and the seat types on the config") {
    val config = GameConfig(
      playerCount = 2,
      seed = 5L,
      playerTypes = Vector(GameConfig.HumanSeat, GameConfig.BasicBotSeat),
      deckSize = Some(52)
    )
    val state = GameEngine.createGame(config, names(2))
    assertEquals(state.config.deckSize, Some(52))
    assertEquals(state.config.seatType(1), GameConfig.BasicBotSeat)
    assert(state.config.isBotSeat(1))
    assert(!state.config.isBotSeat(0))
  }
