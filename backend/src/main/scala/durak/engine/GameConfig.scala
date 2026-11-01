package durak.engine

/**
 * Immutable match settings.
 *
 * `playerTypes` names who plays each seat (`"human"` or `"randomBot"`). It may
 * be empty or shorter than `playerCount`: any seat it does not name is human.
 */
case class GameConfig(
  playerCount: Int,
  allowRedirect: Boolean = true,
  seed: Long = System.currentTimeMillis(),
  playerTypes: Vector[String] = Vector.empty
):

  /** The seat type of `seatIdx`, defaulting to a human. */
  def playerType(seatIdx: Int): String =
    playerTypes.lift(seatIdx).filter(_.trim.nonEmpty).getOrElse(GameConfig.HumanSeat)

  /** True when the seat at `seatIdx` is played by a bot. */
  def isBotSeat(seatIdx: Int): Boolean = GameConfig.isBotType(playerType(seatIdx))

object GameConfig:

  /** Seat type of a human player. */
  val HumanSeat: String = "human"

  /** Every `playerTypes` value that marks a computer-controlled seat. */
  val BotSeats: Set[String] = Set("randombot", "bot")

  /** True when `value` names a bot seat type, ignoring case and padding. */
  def isBotType(value: String): Boolean = BotSeats.contains(value.trim.toLowerCase)

  /** `playerTypes` padded or truncated to exactly `playerCount` entries. */
  def normalizePlayerTypes(playerCount: Int, types: Vector[String]): Vector[String] =
    (0 until Math.max(0, playerCount))
      .map(idx => types.lift(idx).filter(_.trim.nonEmpty).getOrElse(HumanSeat))
      .toVector
