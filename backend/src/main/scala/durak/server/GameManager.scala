package durak.server

import cats.effect.*
import durak.engine.*

/** A scripted QA position that can be started in one click. */
case class PresetGame(state: GameState, defaultPlayerId: String)

/** An in-memory registry of live game rooms, keyed by their generated game id. */
class GameManager(rooms: Ref[IO, Map[String, GameRoom]]):

  /** Creates a room with a fresh unique id and registers it. */
  def createGame(config: GameConfig, playerNames: Vector[String]): IO[GameRoom] =
    register(GameActor.create(config, playerNames), GameActor.create(config, playerNames))

  /**
   * Starts the scripted QA position `presetId` in a fresh room, so a reviewer can
   * jump straight into an endgame, a Chaos table or a half-off surrender without
   * playing a whole match.
   */
  def createPreset(presetId: String): IO[Either[String, GameRoom]] =
    GameManager.preset(presetId) match
      case Left(error) => IO.pure(Left(error))
      case Right(preset) =>
        val build = GameActor.createFrom(
          preset.state,
          defaultPlayerId = Some(preset.defaultPlayerId)
        )
        register(build, build).map(room => Right(room))

  def getRoom(gameId: String): IO[Option[GameRoom]] =
    rooms.get.map(_.get(gameId))

  /**
   * Stores `room` unless its id is taken. Ids are 8 characters, so a collision is
   * only possible in theory; `onCollision` then builds the same game again under
   * a fresh id.
   */
  private def register(room: IO[GameRoom], onCollision: IO[GameRoom]): IO[GameRoom] =
    room.flatMap { created =>
      rooms
        .modify { current =>
          if current.contains(created.gameId) then (current, false)
          else (current.updated(created.gameId, created), true)
        }
        .flatMap { registered =>
          if registered then IO.pure(created) else register(onCollision, onCollision)
        }
    }

object GameManager:

  /** Game ids are short and shareable: exactly this many characters. */
  val GameIdLength: Int = 8

  private val GameIdAlphabet =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

  private val GameIdRandom = new java.security.SecureRandom()

  /** A fresh 8-character alphanumeric game id, e.g. `aB3dE9fZ`. */
  def generateGameId(): String =
    (1 to GameIdLength)
      .map(_ => GameIdAlphabet(GameIdRandom.nextInt(GameIdAlphabet.length)))
      .mkString

  def create: IO[GameManager] =
    Ref.of[IO, Map[String, GameRoom]](Map.empty).map(new GameManager(_))

  // --- QA Scenario presets ---

  /** Every scripted position `POST /api/games/preset` can start. */
  val Presets: Vector[String] = Vector(
    P3pRedirectBob,
    Chaos4p,
    SurrenderHalfOff,
    DefenselessSurrender,
    DiscardAndEndgame
  )

  /** Three-player deflection: Alice attacked, Bob holds the matching six. */
  val P3pRedirectBob: String = "3p-redirect-bob"

  /** Four-player Chaos table waiting for Alice's first attack. */
  val Chaos4p: String = "chaos-4p"

  /** Bob has surrendered and Alice is being asked to throw in or pass. */
  val SurrenderHalfOff: String = "surrender-half-off"

  /** Bob on defense with no legal cover or redirect: the client auto-surrenders. */
  val DefenselessSurrender: String = "defenseless-surrender"

  /** Empty talon, Carol already out, Alice's last card about to make Bob Durak. */
  val DiscardAndEndgame: String = "discard-and-endgame"

  /** The scripted position called `presetId`, or an error naming the unknown one. */
  def preset(presetId: String): Either[String, PresetGame] =
    Option(presetId).map(_.trim.toLowerCase).getOrElse("") match
      case P3pRedirectBob     => Right(redirectBobPreset)
      case Chaos4p            => Right(chaos4pPreset)
      case SurrenderHalfOff    => Right(surrenderHalfOffPreset)
      case DefenselessSurrender => Right(defenselessSurrenderPreset)
      case DiscardAndEndgame  => Right(discardAndEndgamePreset)
      case other =>
        Left(
          s"Unknown preset: $other (expected one of ${Presets.mkString(", ")})"
        )

  private def card(rank: Rank, suit: Suit): Card = Card(suit, rank)

  /**
   * Builds a fully spelled-out position: the hands, table, talon and finishing
   * order are exactly what the reviewer should see, so the preset does not
   * depend on a shuffled deal.
   */
  private def presetState(
      names: Vector[String],
      hands: Vector[Vector[Card]],
      talon: Vector[Card],
      trumpSuit: Suit,
      bottomTrumpCard: Option[Card],
      tablePairs: Vector[TablePair],
      attackerIdx: Int,
      defenderIdx: Int,
      boutPhase: BoutPhase,
      defenderInitialHandSize: Int,
      allowRedirect: Boolean = true,
      chaosMode: Boolean = false,
      discardPile: Vector[Card] = Vector.empty,
      lastDiscardCards: Vector[Card] = Vector.empty,
      finishOrder: Vector[String] = Vector.empty,
      finishRanks: Vector[Option[Int]] = Vector.empty
  ): GameState =
    GameState(
      config = GameConfig(
        playerCount = names.size,
        allowRedirect = allowRedirect,
        seed = 20261102L,
        playerTypes = Vector.fill(names.size)(GameConfig.HumanSeat),
        chaosMode = chaosMode
      ),
      players = names.zipWithIndex.map { case (name, idx) =>
        PlayerState(
          id = s"p$idx",
          name = name,
          hand = hands.lift(idx).getOrElse(Vector.empty),
          finishRank = finishRanks.lift(idx).flatten
        )
      },
      talon = talon,
      trumpSuit = trumpSuit,
      bottomTrumpCard = bottomTrumpCard,
      discardPile = discardPile,
      tablePairs = tablePairs,
      attackerIdx = attackerIdx,
      defenderIdx = defenderIdx,
      boutPhase = boutPhase,
      defenderInitialHandSize = defenderInitialHandSize,
      finishOrder = finishOrder,
      lastDiscardCards = lastDiscardCards
    )

  /**
   * `3p-redirect-bob`: Alice (`p0`) has attacked Bob (`p1`) with `6♠`, Bob holds
   * `6♥` and Carol (`p2`) can take the combined attack, so the table points its
   * reflection arrow at Carol even though she sits the other way round.
   */
  private def redirectBobPreset: PresetGame =
    PresetGame(
      state = presetState(
        names = Vector("Alice", "Bob", "Carol"),
        hands = Vector(
          Vector(
            card(Rank.Nine, Suit.Clubs),
            card(Rank.Jack, Suit.Clubs),
            card(Rank.Queen, Suit.Clubs),
            card(Rank.King, Suit.Clubs),
            card(Rank.Ace, Suit.Clubs)
          ),
          Vector(
            card(Rank.Six, Suit.Hearts),
            card(Rank.Nine, Suit.Hearts),
            card(Rank.Ten, Suit.Hearts),
            card(Rank.Jack, Suit.Hearts),
            card(Rank.Queen, Suit.Hearts),
            card(Rank.King, Suit.Hearts)
          ),
          Vector(
            card(Rank.Nine, Suit.Spades),
            card(Rank.Ten, Suit.Spades),
            card(Rank.Jack, Suit.Spades),
            card(Rank.Queen, Suit.Spades),
            card(Rank.King, Suit.Spades),
            card(Rank.Ace, Suit.Spades)
          )
        ),
        talon = Vector(
          card(Rank.Seven, Suit.Diamonds),
          card(Rank.Eight, Suit.Diamonds),
          card(Rank.Nine, Suit.Diamonds),
          card(Rank.Ten, Suit.Diamonds),
          card(Rank.Jack, Suit.Diamonds),
          card(Rank.Queen, Suit.Diamonds),
          card(Rank.King, Suit.Diamonds),
          card(Rank.Ace, Suit.Diamonds),
          card(Rank.Six, Suit.Diamonds)
        ),
        trumpSuit = Suit.Diamonds,
        bottomTrumpCard = Some(card(Rank.Six, Suit.Diamonds)),
        tablePairs = Vector(TablePair(card(Rank.Six, Suit.Spades))),
        attackerIdx = 0,
        defenderIdx = 1,
        boutPhase = BoutPhase.Defense,
        // Bob's hand held six cards when Alice opened the bout.
        defenderInitialHandSize = 6
      ),
      defaultPlayerId = "p1"
    )

  /**
   * `chaos-4p`: a four-player Chaos table at Alice's opening attack, so every
   * other seat (`p1`, `p2`, `p3`) shows a target outline.
   *
   * Alice's (`p0`) six-card hand deliberately covers the four low ranks `2`, `3`,
   * `4` and `5` that only exist in the 52-card four-player deck (T-90
   * ITEM-3b QA): the active hand therefore shows the tightened pip layouts for
   * those ranks in one click, next to a court card (`K`) and an ace (`A`).
   */
  private def chaos4pPreset: PresetGame =
    PresetGame(
      state = presetState(
        names = Vector("Alice", "Bob", "Carol", "Dave"),
        hands = Vector(
          Vector(
            card(Rank.Two, Suit.Clubs),
            card(Rank.Three, Suit.Clubs),
            card(Rank.Four, Suit.Clubs),
            card(Rank.Five, Suit.Clubs),
            card(Rank.King, Suit.Clubs),
            card(Rank.Ace, Suit.Clubs)
          ),
          Vector(
            card(Rank.Six, Suit.Hearts),
            card(Rank.Seven, Suit.Hearts),
            card(Rank.Eight, Suit.Hearts),
            card(Rank.Nine, Suit.Hearts),
            card(Rank.Ten, Suit.Hearts),
            card(Rank.Jack, Suit.Hearts)
          ),
          Vector(
            card(Rank.Six, Suit.Spades),
            card(Rank.Seven, Suit.Spades),
            card(Rank.Eight, Suit.Spades),
            card(Rank.Nine, Suit.Spades),
            card(Rank.Ten, Suit.Spades),
            card(Rank.Jack, Suit.Spades)
          ),
          Vector(
            card(Rank.Six, Suit.Diamonds),
            card(Rank.Seven, Suit.Diamonds),
            card(Rank.Eight, Suit.Diamonds),
            card(Rank.Nine, Suit.Diamonds),
            card(Rank.Ten, Suit.Diamonds),
            card(Rank.Jack, Suit.Diamonds)
          )
        ),
        talon = Vector(
          card(Rank.Queen, Suit.Clubs),
          card(Rank.Queen, Suit.Hearts),
          card(Rank.Queen, Suit.Spades),
          card(Rank.Six, Suit.Spades)
        ),
        trumpSuit = Suit.Diamonds,
        bottomTrumpCard = Some(card(Rank.Six, Suit.Diamonds)),
        tablePairs = Vector.empty,
        attackerIdx = 0,
        defenderIdx = 1,
        boutPhase = BoutPhase.InitialAttack,
        defenderInitialHandSize = 6,
        chaosMode = true
      ),
      defaultPlayerId = "p0"
    )

  /**
   * `surrender-half-off` (ITEM-PREV-4a): Bob (`p1`) is defending with three
   * pairs on the felt — `6♣`/`9♣`, `8♥`/`J♥` and the uncovered `7♠` — at
   * `trumpSuit = Clubs`.
   *
   * Bob's hand holds no spade above the `7♠` and not a single trump (`♣`), so
   * nothing he has can cover the attack, and the two covered pairs rule out a
   * reflection: he is `defenderDefenseless`, `legalActions = ["surrender"]`, and
   * both the 3-second auto-surrender and a manual `Surrender` click are
   * available from the first frame. (`9♠`, which would have covered the `7♠`, is
   * swapped with the discard pile's `10♦`, so all 36 cards stay unique.)
   *
   * Carol (`p2`) holds no `6`, `7`, `8`, `9` or `J` at all, so she has no legal
   * throw-in and is auto-passed by the server one second after the surrender,
   * while Alice (`p0`) keeps `7♥` — a rank on the table — so the bout stays in
   * [[BoutPhase.SurrenderThrowIn]] on her 15-second clock, with the cards
   * straddling the felt border 50% on / 50% off.
   */
  private def surrenderHalfOffPreset: PresetGame =
    PresetGame(
      state = presetState(
        names = Vector("Alice", "Bob", "Carol"),
        hands = Vector(
          Vector(
            card(Rank.Seven, Suit.Hearts),
            card(Rank.Six, Suit.Hearts),
            card(Rank.Nine, Suit.Hearts),
            card(Rank.Ace, Suit.Hearts),
            card(Rank.Six, Suit.Spades),
            card(Rank.Queen, Suit.Spades)
          ),
          // No trump and no spade above the uncovered 7♠: no cover, no redirect.
          Vector(
            card(Rank.Ten, Suit.Hearts),
            card(Rank.Queen, Suit.Hearts),
            card(Rank.King, Suit.Hearts),
            card(Rank.Ten, Suit.Diamonds),
            card(Rank.Queen, Suit.Diamonds),
            card(Rank.King, Suit.Diamonds)
          ),
          // Only 10/Q/K/A: no rank that appears on the table.
          Vector(
            card(Rank.Ten, Suit.Clubs),
            card(Rank.Queen, Suit.Clubs),
            card(Rank.King, Suit.Clubs),
            card(Rank.Ace, Suit.Clubs),
            card(Rank.Ten, Suit.Spades),
            card(Rank.Ace, Suit.Spades)
          )
        ),
        talon = Vector(
          card(Rank.Eight, Suit.Diamonds),
          card(Rank.Nine, Suit.Diamonds),
          card(Rank.Jack, Suit.Diamonds),
          card(Rank.Ace, Suit.Diamonds),
          card(Rank.Eight, Suit.Clubs),
          card(Rank.Seven, Suit.Clubs)
        ),
        trumpSuit = Suit.Clubs,
        bottomTrumpCard = Some(card(Rank.Seven, Suit.Clubs)),
        tablePairs = Vector(
          TablePair(card(Rank.Seven, Suit.Spades)),
          TablePair(card(Rank.Six, Suit.Clubs), Some(card(Rank.Nine, Suit.Clubs))),
          TablePair(card(Rank.Eight, Suit.Hearts), Some(card(Rank.Jack, Suit.Hearts)))
        ),
        attackerIdx = 0,
        defenderIdx = 1,
        boutPhase = BoutPhase.Defense,
        // Bob's hand held six cards when Alice opened the bout, so the bout can
        // still grow past the three cards already on the table.
        defenderInitialHandSize = 6,
        discardPile = Vector(
          card(Rank.Six, Suit.Diamonds),
          card(Rank.Seven, Suit.Diamonds),
          card(Rank.Eight, Suit.Spades),
          card(Rank.Nine, Suit.Spades),
          card(Rank.Jack, Suit.Spades),
          card(Rank.King, Suit.Spades),
          card(Rank.Jack, Suit.Clubs)
        ),
        lastDiscardCards = Vector(
          card(Rank.King, Suit.Spades),
          card(Rank.Jack, Suit.Clubs)
        )
      ),
      defaultPlayerId = "p1"
    )

  /**
   * `defenseless-surrender` (T-90 ITEM-PREV-4a): Bob (`p1`, `defaultPlayerId`) is
   * defending Alice's (`p0`) `J♠` with `9♠` — the same suit but a lower rank —
   * and every other card in his hand is an off-suit non-trump, so he has no
   * legal cover. The two covered pairs rule out a redirect, which leaves
   * `surrender` as his only legal action: the view reports
   * `defenderDefenseless = true` and the client's `CLIENT_AUTO_SURRENDER_DELAY_MS`
   * timer counts `3 → 2 → 1` on the `Surrender` button before it declares the
   * surrender for him. The position keeps the 36-card conservation invariant
   * (hands 18 + table 5 + talon 6 + discard 7).
   */
  private def defenselessSurrenderPreset: PresetGame =
    PresetGame(
      state = presetState(
        names = Vector("Alice", "Bob", "Carol"),
        hands = Vector(
          Vector(
            card(Rank.Seven, Suit.Hearts),
            card(Rank.Six, Suit.Clubs),
            card(Rank.Eight, Suit.Clubs),
            card(Rank.Nine, Suit.Clubs),
            card(Rank.Queen, Suit.Clubs),
            card(Rank.King, Suit.Clubs)
          ),
          Vector(
            card(Rank.Nine, Suit.Spades),
            card(Rank.Six, Suit.Hearts),
            card(Rank.Eight, Suit.Hearts),
            card(Rank.Nine, Suit.Hearts),
            card(Rank.Ten, Suit.Hearts),
            card(Rank.Jack, Suit.Hearts)
          ),
          Vector(
            card(Rank.Six, Suit.Spades),
            card(Rank.Eight, Suit.Spades),
            card(Rank.Ten, Suit.Spades),
            card(Rank.Seven, Suit.Spades),
            card(Rank.Ace, Suit.Spades),
            card(Rank.Six, Suit.Diamonds)
          )
        ),
        talon = Vector(
          card(Rank.Seven, Suit.Clubs),
          card(Rank.Ace, Suit.Clubs),
          card(Rank.Queen, Suit.Hearts),
          card(Rank.King, Suit.Hearts),
          card(Rank.Ace, Suit.Hearts),
          card(Rank.Seven, Suit.Diamonds)
        ),
        trumpSuit = Suit.Diamonds,
        bottomTrumpCard = Some(card(Rank.Seven, Suit.Diamonds)),
        tablePairs = Vector(
          TablePair(card(Rank.Jack, Suit.Spades)),
          TablePair(card(Rank.Ten, Suit.Clubs), Some(card(Rank.Jack, Suit.Clubs))),
          TablePair(card(Rank.Queen, Suit.Spades), Some(card(Rank.King, Suit.Spades)))
        ),
        attackerIdx = 0,
        defenderIdx = 1,
        boutPhase = BoutPhase.Defense,
        defenderInitialHandSize = 6,
        discardPile = Vector(
          card(Rank.Ace, Suit.Diamonds),
          card(Rank.King, Suit.Diamonds),
          card(Rank.Queen, Suit.Diamonds),
          card(Rank.Jack, Suit.Diamonds),
          card(Rank.Ten, Suit.Diamonds),
          card(Rank.Nine, Suit.Diamonds),
          card(Rank.Eight, Suit.Diamonds)
        ),
        lastDiscardCards = Vector(
          card(Rank.Nine, Suit.Diamonds),
          card(Rank.Eight, Suit.Diamonds)
        )
      ),
      defaultPlayerId = "p1"
    )

  /**
   * `discard-and-endgame` (ITEM-ADD-8b / ITEM-PREV-7c): the talon is empty,
   * Carol (`p2`) has already gone out with `0` cards (`finishOrder = ["p2"]`, so
   * she is `WINNER`), and 31 cards sit in the discard pile with the last four
   * face-up. Bob (`p1`) surrendered while defending, holding `3` cards and
   * carrying no finishing rank — never `OUT` while he still has cards.
   *
   * Alice (`p0`) opened that bout with `7♠` and holds one last card, `7♥`, so a
   * single throw-in ends the bout: the surrender settles at once, Alice leaves
   * the game with `0` cards (`OUT`), and Bob is the last player holding cards,
   * which labels him `DURAK`.
   */
  private def discardAndEndgamePreset: PresetGame =
    val aliceHand = Vector(card(Rank.Seven, Suit.Hearts))
    val bobHand = Vector(
      card(Rank.Six, Suit.Clubs),
      card(Rank.Eight, Suit.Clubs),
      card(Rank.Nine, Suit.Clubs)
    )
    val aliceAttack = card(Rank.Seven, Suit.Spades)
    // Everything else has already been played; the 3-player deck holds exactly
    // 36 cards, so the pile keeps the position card-conserving (4 + 1 + 31).
    val discardPile = Deck
      .forPlayerCount(3)
      .filterNot(card =>
        aliceHand.contains(card) || bobHand.contains(card) || card == aliceAttack
      )
    PresetGame(
      state = presetState(
        names = Vector("Alice", "Bob", "Carol"),
        hands = Vector(aliceHand, bobHand, Vector.empty),
        talon = Vector.empty,
        trumpSuit = Suit.Diamonds,
        bottomTrumpCard = None,
        tablePairs = Vector(TablePair(aliceAttack)),
        attackerIdx = 0,
        defenderIdx = 1,
        boutPhase = BoutPhase.SurrenderThrowIn,
        defenderInitialHandSize = bobHand.size,
        discardPile = discardPile,
        // Four revealed cards of the previous bout, so the box renders both the
        // face-down stack (27) and the face-up row (4) immediately.
        lastDiscardCards = discardPile.takeRight(4),
        finishOrder = Vector("p2"),
        finishRanks = Vector(None, None, Some(1))
      ),
      defaultPlayerId = "p0"
    )
