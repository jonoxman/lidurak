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

  /** Public status shown in the player view. */
  def status: String = if isActive then PlayerStatus.Active else PlayerStatus.Finished

/** The public status values a player can be projected with. */
object PlayerStatus:
  val Active: String = "active"
  val Finished: String = "finished"
