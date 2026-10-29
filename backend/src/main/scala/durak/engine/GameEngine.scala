package durak.engine

import scala.util.Random

object GameEngine:

  /** Cards dealt to every player at the start of the game. */
  private val InitialHandSize = 6

  /**
   * Creates a fully initialized game: shuffled deck, hands, talon with the
   * revealed bottom trump, trump suit, and the first attacker/defender pair.
   */
  def createGame(config: GameConfig, playerNames: Vector[String]): GameState =
    validate(config, playerNames)

    val playerCount = config.playerCount
    val random = new Random(config.seed)
    val shuffled = random.shuffle(Deck.forPlayerCount(playerCount))

    val players = playerNames.zipWithIndex.map { case (name, idx) =>
      PlayerState(
        id = s"p$idx",
        name = name,
        hand = shuffled.slice(idx * InitialHandSize, (idx + 1) * InitialHandSize)
      )
    }

    val remaining = shuffled.drop(playerCount * InitialHandSize)
    if remaining.isEmpty then
      throw new IllegalStateException(
        s"Deck too small to reveal a bottom trump card for $playerCount players"
      )

    // The first card left after dealing is revealed; it becomes the last card drawn.
    val bottomTrumpCard = remaining.head
    val talon = remaining.tail :+ bottomTrumpCard
    val trumpSuit = bottomTrumpCard.suit

    val attackerIdx = selectFirstAttacker(players, trumpSuit)
    val defenderIdx = (attackerIdx + 1) % playerCount

    GameState(
      config = config,
      players = players,
      talon = talon,
      trumpSuit = trumpSuit,
      bottomTrumpCard = Some(bottomTrumpCard),
      discardPile = Vector.empty,
      tablePairs = Vector.empty,
      attackerIdx = attackerIdx,
      defenderIdx = defenderIdx,
      boutPhase = BoutPhase.InitialAttack,
      defenderInitialHandSize = players(defenderIdx).hand.size,
      finishOrder = Vector.empty
    )

  private def validate(config: GameConfig, playerNames: Vector[String]): Unit =
    if playerNames.size != config.playerCount then
      throw new IllegalArgumentException(
        s"Expected ${config.playerCount} player names, got ${playerNames.size}"
      )
    if !Set(2, 3, 4).contains(config.playerCount) then
      throw new IllegalArgumentException(
        s"Unsupported player count: ${config.playerCount} (expected 2, 3, or 4)"
      )

  /** Index of the player holding the lowest-rank trump card, or 0 if nobody has one. */
  private def selectFirstAttacker(players: Vector[PlayerState], trumpSuit: Suit): Int =
    players.zipWithIndex
      .flatMap { case (player, idx) =>
        player.hand
          .filter(_.suit == trumpSuit)
          .minByOption(_.rank.value)
          .map(card => (card.rank.value, idx))
      }
      .minByOption(_._1)
      .map(_._2)
      .getOrElse(0)
