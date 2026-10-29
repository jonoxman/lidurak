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

  test("cards order by rank value then suit") {
    assert(Card(Suit.Hearts, Rank.Six) < Card(Suit.Hearts, Rank.Ace))
    assert(Card(Suit.Clubs, Rank.Six) < Card(Suit.Hearts, Rank.Six))
  }

  test("ranks order by their pip value") {
    assert(Rank.Six < Rank.King)
    assertEquals(Rank.values.max, Rank.Ace)
  }
