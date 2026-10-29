package durak.engine

case class Card(suit: Suit, rank: Rank)

object Card:
  given Ordering[Card] = Ordering.by(card => (card.rank.value, card.suit.ordinal))
