package durak.engine

/**
 * Immutable match settings.
 *
 * `playerTypes` names who plays each seat (`"human"`, `"randomBot"` or
 * `"basicBot"`). It may be empty or shorter than `playerCount`: any seat it does
 * not name is human.
 *
 * `chaosMode` opens every opening attack and every redirect to any other seat
 * that still holds cards, instead of only the clockwise neighbour.
 *
 * `transparentMode` deals every hand face-up: each player's projection then
 * carries the other seats' actual cards, so a reviewer can see all hands.
 *
 * `devMode` keeps the local POV switcher open during live play. When it is off,
 * the server rejects a point-of-view switch until the match is over and in
 * review mode, so the seat cannot be changed from the client.
 */
case class GameConfig(
  playerCount: Int,
  allowRedirect: Boolean = true,
  seed: Long = System.currentTimeMillis(),
  playerTypes: Vector[String] = Vector.empty,
  chaosMode: Boolean = false,
  transparentMode: Boolean = false,
  devMode: Boolean = true
):

  /** The raw seat type of `seatIdx`, defaulting to a human. */
  def playerType(seatIdx: Int): String =
    playerTypes.lift(seatIdx).filter(_.trim.nonEmpty).getOrElse(GameConfig.HumanSeat)

  /** The canonical seat type of `seatIdx`: `"human"`, `"randomBot"` or `"basicBot"`. */
  def seatType(seatIdx: Int): String = GameConfig.canonicalSeatType(playerType(seatIdx))

  /** True when the seat at `seatIdx` is played by a bot (random or basic). */
  def isBotSeat(seatIdx: Int): Boolean = GameConfig.isBotType(playerType(seatIdx))

object GameConfig:

  /** Seat type of a human player. */
  val HumanSeat: String = "human"

  /** Seat type of the uniformly random bot. */
  val RandomBotSeat: String = "randomBot"

  /** Seat type of the simple-policy bot. */
  val BasicBotSeat: String = "basicBot"

  /**
   * Every `playerTypes` value that marks a computer-controlled seat. `"bot"` is
   * accepted as a shorthand for the random bot.
   */
  val BotSeats: Set[String] = Set("randombot", "bot", "basicbot")

  /** True when `value` names a bot seat type, ignoring case and padding. */
  def isBotType(value: String): Boolean = BotSeats.contains(value.trim.toLowerCase)

  /**
   * Maps any accepted spelling to its canonical seat type. Unrecognised values
   * fall back to a human seat, so a bad request can never invent a new seat kind.
   */
  def canonicalSeatType(value: String): String =
    value.trim.toLowerCase match
      case "basicbot"          => BasicBotSeat
      case "randombot" | "bot" => RandomBotSeat
      case _                   => HumanSeat

  /**
   * `playerTypes` padded or truncated to exactly `playerCount` canonical
   * entries of `"human"`, `"randomBot"` or `"basicBot"`.
   */
  def normalizePlayerTypes(playerCount: Int, types: Vector[String]): Vector[String] =
    (0 until Math.max(0, playerCount))
      .map(idx => types.lift(idx).filter(_.trim.nonEmpty).getOrElse(HumanSeat))
      .map(canonicalSeatType)
      .toVector
