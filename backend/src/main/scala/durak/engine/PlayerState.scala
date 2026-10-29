package durak.engine

case class PlayerState(
  id: String,
  name: String,
  hand: Vector[Card],
  hasPassed: Boolean = false,
  finishRank: Option[Int] = None  // 1 = first out, etc. Last = Durak
):

  /** A player is "active" (still in the game) iff they have not finished. */
  def isActive: Boolean = finishRank.isEmpty

  /** A player "has cards" iff their hand is non-empty. */
  def hasCards: Boolean = hand.nonEmpty
