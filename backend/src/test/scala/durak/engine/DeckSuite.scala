package durak.engine

import scala.math.Ordering.Implicits.infixOrderingOps

class DeckSuite extends munit.FunSuite:

  test("standard36 has exactly 36 unique cards starting at Six") {
    val cards = Deck.standard36
    assertEquals(cards.size, 36)
    assertEquals(cards.distinct.size, cards.size)
    assertEquals(cards.map(_.rank).min, Rank.Six)
  }

  test("standard52 has exactly 52 unique cards starting at Two") {
    val cards = Deck.standard52
    assertEquals(cards.size, 52)
    assertEquals(cards.distinct.size, cards.size)
    assertEquals(cards.map(_.rank).min, Rank.Two)
  }

  test("forPlayerCount returns 36 cards for 2 and 3 players") {
    assertEquals(Deck.forPlayerCount(2), Deck.standard36)
    assertEquals(Deck.forPlayerCount(3), Deck.standard36)
  }

  test("forPlayerCount returns 52 cards for 4 players") {
    assertEquals(Deck.forPlayerCount(4), Deck.standard52)
  }

  test("forPlayerCount rejects unsupported player counts") {
    intercept[IllegalArgumentException](Deck.forPlayerCount(5))
  }

  // --- Configured deck size (ITEM-6a) --------------------------------------

  test("forConfig keeps the player-count default when no deck size is set") {
    assertEquals(Deck.forConfig(GameConfig(2)), Deck.standard36)
    assertEquals(Deck.forConfig(GameConfig(3)), Deck.standard36)
    assertEquals(Deck.forConfig(GameConfig(4)), Deck.standard52)
    // An explicit 36 is the same deck a 2- or 3-player game already plays.
    assertEquals(Deck.forConfig(GameConfig(2, deckSize = Some(36))), Deck.standard36)
    assertEquals(Deck.forConfig(GameConfig(3, deckSize = Some(36))), Deck.standard36)
  }

  test("forConfig plays all 52 cards in a 2- or 3-player game when asked") {
    assertEquals(Deck.forConfig(GameConfig(2, deckSize = Some(52))), Deck.standard52)
    assertEquals(Deck.forConfig(GameConfig(3, deckSize = Some(52))), Deck.standard52)
    // A four-player game always plays 52 cards, explicitly requested or not.
    assertEquals(Deck.forConfig(GameConfig(4, deckSize = Some(52))), Deck.standard52)
    assertEquals(Deck.forGame(3, Some(52)), Deck.standard52)
  }

  test("forConfig rejects an unsupported deck size") {
    intercept[IllegalArgumentException](Deck.forConfig(GameConfig(2, deckSize = Some(40))))
    intercept[IllegalArgumentException](Deck.forConfig(GameConfig(3, deckSize = Some(0))))
    intercept[IllegalArgumentException](Deck.forConfig(GameConfig(2, deckSize = Some(53))))
  }

  test("forConfig rejects the 36-card deck for four players") {
    val error = intercept[IllegalArgumentException](
      Deck.forConfig(GameConfig(4, deckSize = Some(36)))
    )
    assert(error.getMessage.contains("four-player"), error.getMessage)
  }

  test("forConfig rejects unsupported player counts") {
    intercept[IllegalArgumentException](Deck.forConfig(GameConfig(5)))
    intercept[IllegalArgumentException](Deck.forConfig(GameConfig(1, deckSize = Some(52))))
  }

  test("effectiveDeckSize reflects the player count and the explicit setting") {
    assertEquals(GameConfig(2).effectiveDeckSize, 36)
    assertEquals(GameConfig(3, deckSize = Some(52)).effectiveDeckSize, 52)
    assertEquals(GameConfig(4).effectiveDeckSize, 52)
    assertEquals(GameConfig(4, deckSize = Some(52)).effectiveDeckSize, 52)
  }

  test("cards order by rank value then suit") {
    assert(Card(Suit.Hearts, Rank.Six) < Card(Suit.Hearts, Rank.Ace))
    assert(Card(Suit.Clubs, Rank.Six) < Card(Suit.Hearts, Rank.Six))
  }

  test("ranks order by their pip value") {
    assert(Rank.Six < Rank.King)
    assertEquals(Rank.values.max, Rank.Ace)
  }
