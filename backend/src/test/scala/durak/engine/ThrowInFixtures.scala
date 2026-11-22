package durak.engine

/**
 * Test-only scripted tables that used to be QA presets.
 *
 * The production catalog (`durak.server.GameManager.Presets`) exposes only the
 * four curated scenarios of the current QA round, so the positions the engine
 * suites reason about — throw-in visibility, the atomic throw-in capacity cap, a
 * surrendered multi-card throw-in and the 30-card hands — are spelled out here
 * as local fixtures instead.
 */
object ThrowInFixtures:

  private def card(rank: Rank, suit: Suit): Card = Card(suit, rank)

  private val names = Vector("Alice", "Bob", "Carol", "Dave")

  private def state(
      hands: Vector[Vector[Card]],
      tablePairs: Vector[TablePair] = Vector.empty,
      trumpSuit: Suit = Suit.Clubs,
      attackerIdx: Int = 0,
      defenderIdx: Int = 1,
      boutPhase: BoutPhase = BoutPhase.Defense,
      defenderInitialHandSize: Int = 6,
      passedSeats: Set[Int] = Set.empty
  ): GameState =
    GameState(
      config = GameConfig(
        playerCount = hands.size,
        seed = 20261106L,
        playerTypes = Vector.fill(hands.size)(GameConfig.HumanSeat)
      ),
      players = hands.zipWithIndex.map { case (hand, idx) =>
        PlayerState(
          id = s"p$idx",
          name = names.lift(idx).getOrElse(s"Player $idx"),
          hand = hand,
          hasPassed = passedSeats.contains(idx)
        )
      },
      talon = Vector.empty,
      trumpSuit = trumpSuit,
      bottomTrumpCard = None,
      discardPile = Vector.empty,
      tablePairs = tablePairs,
      attackerIdx = attackerIdx,
      defenderIdx = defenderIdx,
      boutPhase = boutPhase,
      defenderInitialHandSize = defenderInitialHandSize,
      finishOrder = Vector.empty
    )

  /**
   * Four-player throw-in visibility: Bob (`p1`) has covered Alice's (`p0`) `7♠`
   * with `9♠` at `trumpSuit = Clubs` and Dave (`p3`) already passed, so only
   * Alice — holding `7♥`, `7♦` and `9♦` — sees the throw-in outline.
   */
  val visibility4p: GameState = state(
    hands = Vector(
      Vector(
        card(Rank.Seven, Suit.Hearts),
        card(Rank.Seven, Suit.Diamonds),
        card(Rank.Nine, Suit.Diamonds),
        card(Rank.King, Suit.Spades),
        card(Rank.Queen, Suit.Hearts),
        card(Rank.Six, Suit.Clubs)
      ),
      Vector(
        card(Rank.Nine, Suit.Hearts),
        card(Rank.Ten, Suit.Diamonds),
        card(Rank.Jack, Suit.Spades),
        card(Rank.Eight, Suit.Hearts),
        card(Rank.Six, Suit.Diamonds),
        card(Rank.Ace, Suit.Diamonds)
      ),
      Vector(
        card(Rank.Eight, Suit.Spades),
        card(Rank.Ten, Suit.Clubs),
        card(Rank.Jack, Suit.Hearts),
        card(Rank.Queen, Suit.Diamonds),
        card(Rank.King, Suit.Diamonds),
        card(Rank.Ace, Suit.Spades)
      ),
      Vector(
        card(Rank.Seven, Suit.Clubs),
        card(Rank.Eight, Suit.Diamonds),
        card(Rank.Ten, Suit.Hearts),
        card(Rank.Jack, Suit.Diamonds),
        card(Rank.Queen, Suit.Spades),
        card(Rank.King, Suit.Hearts)
      )
    ),
    tablePairs = Vector(
      TablePair(card(Rank.Seven, Suit.Spades), Some(card(Rank.Nine, Suit.Spades)))
    ),
    trumpSuit = Suit.Clubs,
    // Bob held seven cards when the bout opened, so capacity is five.
    defenderInitialHandSize = 7,
    passedSeats = Set(3)
  )

  /**
   * The atomic throw-in capacity cap: Alice holds four matching cards while
   * `maxBoutAttacks = min(6, 3) = 3` and one card already sits on the table, so
   * at most two cards may be deployed in one action.
   */
  val capacityCap: GameState = state(
    hands = Vector(
      Vector(
        card(Rank.Seven, Suit.Hearts),
        card(Rank.Seven, Suit.Diamonds),
        card(Rank.Seven, Suit.Clubs),
        card(Rank.Nine, Suit.Diamonds),
        card(Rank.King, Suit.Spades),
        card(Rank.Queen, Suit.Hearts)
      ),
      Vector(
        card(Rank.Eight, Suit.Hearts),
        card(Rank.Ten, Suit.Diamonds)
      )
    ),
    tablePairs = Vector(
      TablePair(card(Rank.Seven, Suit.Spades), Some(card(Rank.Nine, Suit.Spades)))
    ),
    trumpSuit = Suit.Clubs,
    defenderInitialHandSize = 3
  )

  /**
   * A half-off surrendered table: Bob (`p1`) defends `6♣`/`9♣`, `8♥`/`J♥` and
   * the uncovered `7♠` at `trumpSuit = Clubs` with no cover and no redirect, so
   * a surrender opens the throw-in window for Alice's (`p0`) four matching cards
   * across the bout's three free slots.
   */
  val surrenderHalfOff: GameState = state(
    hands = Vector(
      Vector(
        card(Rank.Seven, Suit.Hearts),
        card(Rank.Seven, Suit.Diamonds),
        card(Rank.Six, Suit.Hearts),
        card(Rank.Nine, Suit.Hearts),
        card(Rank.Ace, Suit.Hearts),
        card(Rank.Six, Suit.Spades)
      ),
      Vector(
        card(Rank.Ten, Suit.Hearts),
        card(Rank.Queen, Suit.Hearts),
        card(Rank.King, Suit.Hearts),
        card(Rank.Ten, Suit.Diamonds),
        card(Rank.Queen, Suit.Diamonds),
        card(Rank.King, Suit.Diamonds)
      ),
      Vector(
        card(Rank.Ten, Suit.Clubs),
        card(Rank.Queen, Suit.Clubs),
        card(Rank.King, Suit.Clubs),
        card(Rank.Ace, Suit.Clubs),
        card(Rank.Ten, Suit.Spades),
        card(Rank.Ace, Suit.Spades)
      )
    ),
    tablePairs = Vector(
      TablePair(card(Rank.Seven, Suit.Spades)),
      TablePair(card(Rank.Six, Suit.Clubs), Some(card(Rank.Nine, Suit.Clubs))),
      TablePair(card(Rank.Eight, Suit.Hearts), Some(card(Rank.Jack, Suit.Hearts)))
    ),
    trumpSuit = Suit.Clubs,
    defenderInitialHandSize = 6
  )

  /**
   * Three-player throw-in table: the only pair is `7♠`/`8♠` at
   * `trumpSuit = Hearts`, Alice (`p0`) holds `7♥ 7♦ 7♣` plus two fillers, Bob
   * defends without a matching rank and Charlie (`p2`) holds no `7` or `8`.
   */
  val multiQa: GameState = state(
    hands = Vector(
      Vector(
        card(Rank.Seven, Suit.Hearts),
        card(Rank.Seven, Suit.Diamonds),
        card(Rank.Seven, Suit.Clubs),
        card(Rank.King, Suit.Spades),
        card(Rank.Queen, Suit.Clubs)
      ),
      Vector(
        card(Rank.Nine, Suit.Spades),
        card(Rank.Ten, Suit.Spades),
        card(Rank.Jack, Suit.Diamonds),
        card(Rank.Queen, Suit.Diamonds),
        card(Rank.Ace, Suit.Clubs)
      ),
      Vector(
        card(Rank.Nine, Suit.Clubs),
        card(Rank.Ten, Suit.Clubs),
        card(Rank.Jack, Suit.Spades),
        card(Rank.Ace, Suit.Diamonds)
      )
    ),
    tablePairs = Vector(
      TablePair(card(Rank.Seven, Suit.Spades), Some(card(Rank.Eight, Suit.Spades)))
    ),
    trumpSuit = Suit.Hearts,
    defenderInitialHandSize = 6
  )

  /**
   * A 30-card defending hand: Bob (`p1`) attacked with the uncovered `9♣` at
   * `trumpSuit = Hearts` and Alice (`p0`) defends with 30 of the 36 cards — 14
   * playable covers (the clubs above the nine and every trump) and 16 that
   * cannot cover it.
   */
  val largeHand30: GameState =
    val bobHand = Vector(
      card(Rank.Ten, Suit.Spades),
      card(Rank.Jack, Suit.Spades),
      card(Rank.Queen, Suit.Spades),
      card(Rank.King, Suit.Spades),
      card(Rank.Ace, Suit.Spades)
    )
    val attack = card(Rank.Nine, Suit.Clubs)
    val aliceClubs = Vector(
      card(Rank.Six, Suit.Clubs),
      card(Rank.Ten, Suit.Clubs),
      card(Rank.Seven, Suit.Clubs),
      card(Rank.Jack, Suit.Clubs),
      card(Rank.Eight, Suit.Clubs),
      card(Rank.Queen, Suit.Clubs),
      card(Rank.King, Suit.Clubs),
      card(Rank.Ace, Suit.Clubs)
    )
    val aliceHearts = Vector(
      Rank.Six, Rank.Seven, Rank.Eight, Rank.Nine, Rank.Ten,
      Rank.Jack, Rank.Queen, Rank.King, Rank.Ace
    ).map(rank => card(rank, Suit.Hearts))
    val aliceSpades = Vector(
      card(Rank.Six, Suit.Spades),
      card(Rank.Seven, Suit.Spades),
      card(Rank.Eight, Suit.Spades),
      card(Rank.Nine, Suit.Spades)
    )
    val aliceDiamonds = Vector(
      Rank.Six, Rank.Seven, Rank.Eight, Rank.Nine, Rank.Ten,
      Rank.Jack, Rank.Queen, Rank.King, Rank.Ace
    ).map(rank => card(rank, Suit.Diamonds))
    val aliceHand = aliceClubs ++ aliceHearts ++ aliceSpades ++ aliceDiamonds
    state(
      hands = Vector(aliceHand, bobHand),
      tablePairs = Vector(TablePair(attack)),
      trumpSuit = Suit.Hearts,
      attackerIdx = 1,
      defenderIdx = 0,
      defenderInitialHandSize = aliceHand.size
    )

  /**
   * Three-player throw-in visibility: the only pair is `7♠`/`8♠` at
   * `trumpSuit = Hearts`; Alice (`p0`) holds `7♥ 7♦ 7♣` plus `K♠ Q♣`, while Bob
   * and Carol hold no rank on the table.
   */
  val visibility3p: GameState = state(
    hands = Vector(
      Vector(
        card(Rank.Seven, Suit.Hearts),
        card(Rank.Seven, Suit.Diamonds),
        card(Rank.Seven, Suit.Clubs),
        card(Rank.King, Suit.Spades),
        card(Rank.Queen, Suit.Clubs)
      ),
      Vector(
        card(Rank.Nine, Suit.Spades),
        card(Rank.Ten, Suit.Spades),
        card(Rank.Jack, Suit.Diamonds),
        card(Rank.Queen, Suit.Diamonds),
        card(Rank.King, Suit.Clubs)
      ),
      Vector(
        card(Rank.Ten, Suit.Clubs),
        card(Rank.Jack, Suit.Spades),
        card(Rank.King, Suit.Diamonds),
        card(Rank.Ace, Suit.Clubs)
      )
    ),
    tablePairs = Vector(
      TablePair(card(Rank.Seven, Suit.Spades), Some(card(Rank.Eight, Suit.Spades)))
    ),
    trumpSuit = Suit.Hearts,
    defenderInitialHandSize = 6
  )

  /**
   * A 30-card defending hand against a lone `7♠` at `trumpSuit = Hearts`: 12
   * cards cover it (the spades above the seven plus every trump) and 18 do not.
   */
  val megaHand30: GameState =
    val bobHand = Vector(
      card(Rank.Ten, Suit.Spades),
      card(Rank.Jack, Suit.Spades),
      card(Rank.Queen, Suit.Spades),
      card(Rank.King, Suit.Spades),
      card(Rank.Ace, Suit.Clubs)
    )
    val attack = card(Rank.Seven, Suit.Spades)
    val aliceHand =
      Deck.forPlayerCount(2).filterNot(card => bobHand.contains(card) || card == attack)
    state(
      hands = Vector(aliceHand, bobHand),
      tablePairs = Vector(TablePair(attack)),
      trumpSuit = Suit.Hearts,
      attackerIdx = 1,
      defenderIdx = 0,
      defenderInitialHandSize = aliceHand.size
    )
