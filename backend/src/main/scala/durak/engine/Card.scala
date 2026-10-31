package durak.engine

case class Card(suit: Suit, rank: Rank):

  /**
   * True when this card legally covers `attack`: the same suit with a higher
   * rank, or a trump against a non-trump. Shared by the engine, the projection
   * and the defenseless check so they can never disagree.
   */
  def covers(attack: Card, trumpSuit: Suit): Boolean =
    (suit == attack.suit && rank.value > attack.rank.value) ||
      (suit == trumpSuit && attack.suit != trumpSuit)

object Card:
  given Ordering[Card] = Ordering.by(card => (card.rank.value, card.suit.ordinal))
