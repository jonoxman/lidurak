package durak.engine

object Deck:

  private val allSuits: Vector[Suit] = Suit.values.toVector
  private val allRanks: Vector[Rank] = Rank.values.toVector

  /** The 36-card deck used for 2- and 3-player games: Six through Ace. */
  def standard36: Vector[Card] =
    for
      suit <- allSuits
      rank <- allRanks
      if rank.value >= Rank.Six.value
    yield Card(suit, rank)

  /** The full 52-card deck used for 4-player games: Two through Ace. */
  def standard52: Vector[Card] =
    for
      suit <- allSuits
      rank <- allRanks
    yield Card(suit, rank)

  /** The deck for the given number of players, unshuffled. */
  def forPlayerCount(n: Int): Vector[Card] = n match
    case 2 | 3 => standard36
    case 4     => standard52
    case other =>
      throw new IllegalArgumentException(
        s"Unsupported player count: $other (expected 2, 3, or 4)"
      )
