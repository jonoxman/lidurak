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

  test("chaos mode is rejected for two-player games") {
    intercept[IllegalArgumentException] {
      GameEngine.createGame(GameConfig(2, seed = 1L, chaosMode = true), names(2))
    }
  }

  test("chaos mode is accepted for three and four players") {
    for n <- 3 to 4 do
      assert(GameEngine.createGame(GameConfig(n, seed = 1L, chaosMode = true), names(n)).chaosMode)
  }
