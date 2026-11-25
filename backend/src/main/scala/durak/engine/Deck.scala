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

  /**
   * The deck a match is dealt from, honouring the explicit deck setting.
   *
   * A two- or three-player game plays 36 cards unless it asks for 52; a
   * four-player game always plays the full 52-card deck and rejects an explicit
   * 36-card request instead of silently ignoring it.
   */
  def forConfig(config: GameConfig): Vector[Card] =
    forGame(config.playerCount, config.deckSize)

  /** The deck for a player count plus an optional explicit deck setting. */
  def forGame(playerCount: Int, deckSize: Option[Int]): Vector[Card] =
    if !Set(2, 3, 4).contains(playerCount) then
      throw new IllegalArgumentException(
        s"Unsupported player count: $playerCount (expected 2, 3, or 4)"
      )
    deckSize.foreach { size =>
      if !GameConfig.SupportedDeckSizes.contains(size) then
        throw new IllegalArgumentException(
          s"Unsupported deck size: $size (expected ${GameConfig.ShortDeckSize} or ${GameConfig.FullDeckSize})"
        )
    }
    if playerCount == 4 && deckSize.contains(GameConfig.ShortDeckSize) then
      throw new IllegalArgumentException(
        s"A four-player game requires the ${GameConfig.FullDeckSize}-card deck"
      )
    if playerCount == 4 || deckSize.contains(GameConfig.FullDeckSize) then standard52
    else standard36
