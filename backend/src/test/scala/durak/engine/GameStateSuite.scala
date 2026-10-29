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

  private def state(players: Vector[PlayerState]): GameState =
    GameState(
      config = GameConfig(players.size, seed = 42L),
      players = players,
      talon = Vector.empty,
      trumpSuit = Suit.Spades,
      bottomTrumpCard = None,
      discardPile = Vector.empty,
      tablePairs = Vector.empty,
      attackerIdx = 0,
      defenderIdx = 1,
      boutPhase = BoutPhase.InitialAttack,
      defenderInitialHandSize = players.headOption.map(_.hand.size).getOrElse(0),
      finishOrder = Vector.empty
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
