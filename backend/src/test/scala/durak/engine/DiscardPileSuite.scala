package durak.engine

import io.circe.syntax.*
import JsonCodecs.given

class DiscardPileSuite extends munit.FunSuite:

  private def card(rank: Rank, suit: Suit = Suit.Spades): Card = Card(suit, rank)

  private def player(id: String, hand: List[Card]): PlayerState =
    PlayerState(id = id, name = id.toUpperCase, hand = hand.toVector)

  private def state(
      players: Vector[PlayerState],
      tablePairs: Vector[TablePair] = Vector.empty,
      discardPile: Vector[Card] = Vector.empty,
      lastDiscardCards: Vector[Card] = Vector.empty,
      boutPhase: BoutPhase = BoutPhase.Defense,
      defenderInitialHandSize: Int = 6
  ): GameState =
    GameState(
      config = GameConfig(players.size, seed = 42L),
      players = players,
      talon = Vector.empty,
      trumpSuit = Suit.Spades,
      bottomTrumpCard = None,
      discardPile = discardPile,
      tablePairs = tablePairs,
      attackerIdx = 0,
      defenderIdx = 1,
      boutPhase = boutPhase,
      defenderInitialHandSize = defenderInitialHandSize,
      finishOrder = Vector.empty,
      lastDiscardCards = lastDiscardCards
    )

  private def apply(gs: GameState, action: GameAction): GameState =
    GameEngine.applyAction(gs, action) match
      case Right(next) => next
      case Left(error) => fail(s"$action was rejected: $error")

  private val six = card(Rank.Six, Suit.Spades)
  private val seven = card(Rank.Seven, Suit.Spades)

  /** Two-player bout whose table is fully covered, so one pass resolves it. */
  private def coveredBout(
      attackerHand: List[Card],
      defenderHand: List[Card],
      discardPile: Vector[Card] = Vector.empty,
      lastDiscardCards: Vector[Card] = Vector.empty,
      tablePairs: Vector[TablePair] = Vector(TablePair(six, Some(seven)))
  ): GameState =
    state(
      Vector(player("p0", attackerHand), player("p1", defenderHand)),
      tablePairs = tablePairs,
      discardPile = discardPile,
      lastDiscardCards = lastDiscardCards,
      defenderInitialHandSize = defenderHand.size
    )

  // --- Initial state ---

  test("a new game starts with an empty discard pile and no visible discard") {
    val gs = GameEngine.createGame(
      GameConfig(playerCount = 2, seed = 11L),
      Vector("Alice", "Bob")
    )

    assertEquals(gs.discardPile, Vector.empty)
    assertEquals(gs.lastDiscardCards, Vector.empty)

    val view = PlayerGameView.forViewer(gs, "p0")
    assertEquals(view.discardCount, 0)
    assertEquals(view.lastDiscardCards, Vector.empty)
  }

  // --- Successful defense ---

  test("a successful defense discards the bout and makes it the visible discard") {
    val gs = coveredBout(
      attackerHand = List(
        card(Rank.Ace, Suit.Clubs),
        card(Rank.King, Suit.Clubs),
        card(Rank.Queen, Suit.Clubs),
        card(Rank.Jack, Suit.Clubs)
      ),
      defenderHand = List(
        card(Rank.Eight, Suit.Spades),
        card(Rank.Nine, Suit.Spades),
        card(Rank.Ten, Suit.Spades)
      )
    )

    val next = apply(gs, GameAction.PassTurn("p0"))

    assertEquals(next.discardPile, Vector(six, seven))
    assertEquals(next.lastDiscardCards, Vector(six, seven))

    val view = PlayerGameView.forViewer(next, "p0")
    assertEquals(view.discardCount, 2)
    assertEquals(view.lastDiscardCards, Vector(six, seven))
  }

  test("a second successful defense replaces the visible discard while the pile keeps both bouts") {
    val firstBout = Vector(six, seven)
    val secondBout = Vector(card(Rank.Eight, Suit.Spades), card(Rank.Nine, Suit.Spades))
    val gs = coveredBout(
      attackerHand = List(
        card(Rank.Nine, Suit.Spades),
        card(Rank.Ten, Suit.Spades),
        card(Rank.King, Suit.Clubs),
        card(Rank.Queen, Suit.Clubs)
      ),
      defenderHand = List(
        card(Rank.Eight, Suit.Spades),
        card(Rank.Jack, Suit.Hearts),
        card(Rank.Queen, Suit.Hearts)
      )
    )

    val afterFirst = apply(gs, GameAction.PassTurn("p0"))
    assertEquals(afterFirst.discardPile, firstBout)
    assertEquals(afterFirst.lastDiscardCards, firstBout)
    // A successful defense hands the attack to the old defender.
    assertEquals(afterFirst.attackerIdx, 1)
    assertEquals(afterFirst.defenderIdx, 0)

    val attacked = apply(
      afterFirst,
      GameAction.InitialAttack("p1", List(card(Rank.Eight, Suit.Spades)))
    )
    val covered = apply(
      attacked,
      GameAction.CoverCard("p0", 0, card(Rank.Nine, Suit.Spades))
    )
    val afterSecond = apply(covered, GameAction.PassTurn("p1"))

    assertEquals(afterSecond.discardPile, firstBout ++ secondBout)
    assertEquals(afterSecond.lastDiscardCards, secondBout)
    assertEquals(PlayerGameView.forViewer(afterSecond, "p1").discardCount, 4)
    assertEquals(PlayerGameView.forViewer(afterSecond, "p1").lastDiscardCards, secondBout)
  }

  // --- Surrender ---

  test("a surrender leaves the discard pile and the visible discard untouched") {
    val previous = Vector(card(Rank.Six, Suit.Clubs), card(Rank.Seven, Suit.Clubs))
    val gs = state(
      Vector(
        player(
          "p0",
          List(
            card(Rank.Ace, Suit.Clubs),
            card(Rank.King, Suit.Clubs),
            card(Rank.Queen, Suit.Clubs),
            card(Rank.Jack, Suit.Clubs)
          )
        ),
        player(
          "p1",
          List(
            card(Rank.Eight, Suit.Spades),
            card(Rank.Nine, Suit.Spades),
            card(Rank.Ten, Suit.Spades),
            card(Rank.Jack, Suit.Spades)
          )
        )
      ),
      tablePairs = Vector(TablePair(card(Rank.Six, Suit.Hearts))),
      discardPile = previous,
      lastDiscardCards = previous,
      defenderInitialHandSize = 4
    )

    val surrendered = apply(gs, GameAction.DeclareSurrender("p1"))
    assertEquals(surrendered.lastDiscardCards, previous)
    assertEquals(surrendered.discardPile, previous)

    val settled = apply(surrendered, GameAction.PassTurn("p0"))

    assertEquals(settled.tablePairs, Vector.empty)
    assertEquals(settled.discardPile, previous)
    assertEquals(settled.lastDiscardCards, previous)
    assertEquals(PlayerGameView.forViewer(settled, "p0").discardCount, previous.size)
  }

  test("a surrender of a fresh bout keeps an empty discard pile empty") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Ace, Suit.Clubs), card(Rank.King, Suit.Clubs))),
        player("p1", List(card(Rank.Eight, Suit.Spades), card(Rank.Nine, Suit.Spades)))
      ),
      tablePairs = Vector(TablePair(six)),
      defenderInitialHandSize = 2
    )

    val surrendered = apply(gs, GameAction.DeclareSurrender("p1"))
    val settled = apply(surrendered, GameAction.PassTurn("p0"))

    assertEquals(settled.discardPile, Vector.empty)
    assertEquals(settled.lastDiscardCards, Vector.empty)
    assertEquals(PlayerGameView.forViewer(settled, "p0").discardCount, 0)
  }

  // --- Card conservation ---

  test("the visible discard is exactly the tail of the discard pile, never counted twice") {
    val earlier = Vector(card(Rank.Six, Suit.Clubs), card(Rank.Seven, Suit.Clubs))
    val bout = Vector(card(Rank.Six, Suit.Hearts), card(Rank.Seven, Suit.Hearts))
    val gs = coveredBout(
      attackerHand = List(
        card(Rank.Ace, Suit.Clubs),
        card(Rank.King, Suit.Clubs),
        card(Rank.Queen, Suit.Clubs),
        card(Rank.Jack, Suit.Clubs)
      ),
      defenderHand = List(
        card(Rank.Ten, Suit.Spades),
        card(Rank.Jack, Suit.Spades),
        card(Rank.Queen, Suit.Spades)
      ),
      discardPile = earlier,
      lastDiscardCards = earlier,
      tablePairs = Vector(TablePair(bout.head, Some(bout(1))))
    )

    val next = apply(gs, GameAction.PassTurn("p0"))

    assertEquals(next.lastDiscardCards, bout)
    assertEquals(next.discardPile, earlier ++ bout)
    assertEquals(next.lastDiscardCards, next.discardPile.takeRight(next.lastDiscardCards.size))
    assertEquals(next.discardPile.distinct.size, next.discardPile.size)
  }

  // --- Hidden information ---

  test("the view exposes the visible discard but never the hidden earlier discards") {
    val hiddenFirst = card(Rank.Six, Suit.Clubs)
    val hiddenSecond = card(Rank.Seven, Suit.Clubs)
    val visible = Vector(card(Rank.Eight, Suit.Diamonds), card(Rank.Nine, Suit.Diamonds))
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Ace, Suit.Clubs), card(Rank.King, Suit.Clubs))),
        player("p1", List(card(Rank.Ten, Suit.Spades), card(Rank.Jack, Suit.Spades)))
      ),
      discardPile = Vector(hiddenFirst, hiddenSecond) ++ visible,
      lastDiscardCards = visible,
      defenderInitialHandSize = 4
    )

    val view = PlayerGameView.forViewer(gs, "p0")
    assertEquals(view.discardCount, 4)
    assertEquals(view.lastDiscardCards, visible)

    val encoded = view.asJson.noSpaces
    assert(!encoded.contains(hiddenFirst.asJson.noSpaces), s"the view leaked a hidden discard: $encoded")
    assert(!encoded.contains(hiddenSecond.asJson.noSpaces), s"the view leaked a hidden discard: $encoded")
    assert(encoded.contains(visible.head.asJson.noSpaces), s"the visible discard is missing: $encoded")
  }
