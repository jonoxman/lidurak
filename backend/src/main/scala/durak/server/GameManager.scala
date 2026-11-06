package durak.server

import cats.effect.*
import durak.engine.*

import scala.concurrent.duration.*

/** A scripted QA position that can be started in one click. */
case class PresetGame(state: GameState, defaultPlayerId: String)

/**
 * Bot pacing every room the manager creates. Production uses the GameActor
 * defaults (`200 ms` between RandomBot moves, `2 s` before the first one); a
 * test suite can build a manager with tiny values so bot matches stay fast.
 */
case class BotTiming(
    randomBotDelay: FiniteDuration = GameActor.DefaultRandomBotDelay,
    initialBotStartDelay: FiniteDuration = GameActor.DefaultInitialBotStartDelay
)

object BotTiming:
  /** The production pacing: fast RandomBot play after a 2-second start pause. */
  val Default: BotTiming = BotTiming()

/** An in-memory registry of live game rooms, keyed by their generated game id. */
class GameManager(
    rooms: Ref[IO, Map[String, GameRoom]],
    botTiming: BotTiming = BotTiming.Default
):

  /** Creates a room with a fresh unique id and registers it. */
  def createGame(config: GameConfig, playerNames: Vector[String]): IO[GameRoom] =
    def build: IO[GameRoom] =
      GameActor.create(
        config,
        playerNames,
        randomBotDelay = botTiming.randomBotDelay,
        initialBotStartDelay = botTiming.initialBotStartDelay
      )
    register(build, build)

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
          defaultPlayerId = Some(preset.defaultPlayerId),
          randomBotDelay = botTiming.randomBotDelay,
          initialBotStartDelay = botTiming.initialBotStartDelay
        )
        register(build, build).map(room => Right(room))

  def getRoom(gameId: String): IO[Option[GameRoom]] =
    rooms.get.map(_.get(gameId))

  /**
   * Starts a fresh match with the room's seats, names and settings, so a rematch
   * keeps `allowRedirect`, `chaosMode`, `transparentMode`, `devMode` and the
   * per-seat human / bot split exactly as they were. Only the deal seed is
   * renewed. An unknown id returns `None`, which the route answers with a 404.
   */
  def rematch(gameId: String): IO[Option[GameRoom]] =
    getRoom(gameId).flatMap {
      case None => IO.pure(None)
      case Some(room) =>
        room.stateRef.get.flatMap { state =>
          val config = state.config.copy(seed = System.currentTimeMillis())
          createGame(config, state.players.map(_.name)).map(Some(_))
        }
    }

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

  /** A manager with the production bot pacing. */
  def create: IO[GameManager] = create(BotTiming.Default)

  /** A manager with explicit bot pacing, so tests can keep bot matches fast. */
  def create(botTiming: BotTiming): IO[GameManager] =
    Ref.of[IO, Map[String, GameRoom]](Map.empty).map(new GameManager(_, botTiming))

  // --- QA Scenario presets ---

  /** Every scripted position `POST /api/games/preset` can start. */
  val Presets: Vector[String] = Vector(
    P3pRedirectBob,
    Chaos4p,
    SurrenderHalfOff,
    DefenselessSurrender,
    DiscardAndEndgame,
    TransparentMode,
    FullHandPickup,
    ThrowInVisibility4p,
    ThrowInCapacityCap,
    HugeHand36,
    HugeHand52
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

  /**
   * Transparent Mode table: Alice sees Bob's and Carol's real hands, each a
   * deterministic mix of trump and non-trump cards.
   */
  val TransparentMode: String = "transparent-mode"

  /**
   * A two-player table where Alice holds 29 of the 36 cards, so the reviewer can
   * check that a near-full-deck hand still fits the felt (T-90 ITEM-4).
   */
  val FullHandPickup: String = "full-hand-pickup"

  /**
   * Alice may throw in `7♥ 7♦ 9♦`, while the defender Bob, the unmatched Carol
   * and the already-passed Dave must see no throw-in outline at all (ITEM-1a).
   */
  val ThrowInVisibility4p: String = "throw-in-visibility-4p"

  /**
   * Alice holds four matching cards, but the bout only has room for two: the
   * UI must cap her multi-selection at two (ITEM-5).
   */
  val ThrowInCapacityCap: String = "throw-in-capacity-cap"

  /**
   * A two-player table whose defender holds 34 of the 36 cards, so the reviewer
   * can check that an enormous hand still fits the felt (ITEM-4 / new #3).
   */
  val HugeHand36: String = "huge-hand-36"

  /**
   * The same enormous-hand check on the 52-card deck: Bob holds 46 cards while
   * the other three seats share five (ITEM-4 / new #3).
   */
  val HugeHand52: String = "huge-hand-52"

  /** The scripted position called `presetId`, or an error naming the unknown one. */
  def preset(presetId: String): Either[String, PresetGame] =
    Option(presetId).map(_.trim.toLowerCase).getOrElse("") match
      case P3pRedirectBob     => Right(redirectBobPreset)
      case Chaos4p            => Right(chaos4pPreset)
      case SurrenderHalfOff    => Right(surrenderHalfOffPreset)
      case DefenselessSurrender => Right(defenselessSurrenderPreset)
      case DiscardAndEndgame  => Right(discardAndEndgamePreset)
      case TransparentMode    => Right(transparentModePreset)
      case FullHandPickup     => Right(fullHandPickupPreset)
      case ThrowInVisibility4p => Right(throwInVisibility4pPreset)
      case ThrowInCapacityCap => Right(throwInCapacityCapPreset)
      case HugeHand36         => Right(hugeHand36Preset)
      case HugeHand52         => Right(hugeHand52Preset)
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
      transparentMode: Boolean = false,
      devMode: Boolean = true,
      discardPile: Vector[Card] = Vector.empty,
      lastDiscardCards: Vector[Card] = Vector.empty,
      finishOrder: Vector[String] = Vector.empty,
      finishRanks: Vector[Option[Int]] = Vector.empty,
      // Seats that already declared a pass, by seat index.
      passedSeats: Set[Int] = Set.empty
  ): GameState =
    GameState(
      config = GameConfig(
        playerCount = names.size,
        allowRedirect = allowRedirect,
        seed = 20261102L,
        playerTypes = Vector.fill(names.size)(GameConfig.HumanSeat),
        chaosMode = chaosMode,
        transparentMode = transparentMode,
        devMode = devMode
      ),
      players = names.zipWithIndex.map { case (name, idx) =>
        PlayerState(
          id = s"p$idx",
          name = name,
          hand = hands.lift(idx).getOrElse(Vector.empty),
          hasPassed = passedSeats.contains(idx),
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
   * while Alice (`p0`) keeps `7♥` and `7♦` — both a rank on the table — so the
   * bout stays in [[BoutPhase.SurrenderThrowIn]] on her 15-second clock, with the
   * cards straddling the felt border 50% on / 50% off.
   *
   * T-90 ITEM-5: Alice holding two rank-7 cards lets the reviewer click-select
   * both and double-click to deploy them in one `ThrowInCards` action (or throw
   * one in and still see the outline until she runs out of legal cards).
   */
  private def surrenderHalfOffPreset: PresetGame =
    PresetGame(
      state = presetState(
        names = Vector("Alice", "Bob", "Carol"),
        hands = Vector(
          Vector(
            // Two rank-7 cards: a multi-card throw-in can deploy both at once.
            card(Rank.Seven, Suit.Hearts),
            card(Rank.Seven, Suit.Diamonds),
            card(Rank.Six, Suit.Hearts),
            card(Rank.Nine, Suit.Hearts),
            card(Rank.Ace, Suit.Hearts),
            card(Rank.Six, Suit.Spades)
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
          // The `7♦` now sits in Alice's hand, so `Q♠` takes its place here and
          // all 36 cards stay unique.
          card(Rank.Queen, Suit.Spades),
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
   * `transparent-mode` (ITEM-10a): a three-player table in Transparent Mode,
   * opened on Alice (`p0`) at her opening attack. Alice sees Bob's and Carol's
   * real hands, each a deterministic mix of trumps (`♦`) and off-suit cards, so
   * a reviewer can inspect every low-detail opponent card in one click.
   *
   * The deal covers 18 of the 36 cards; the remaining 18 form the talon with the
   * diamonds at the bottom, so `bottomTrumpCard` is the last card to be drawn.
   */
  private def transparentModePreset: PresetGame =
    val aliceHand = Vector(
      card(Rank.Six, Suit.Clubs),
      card(Rank.Eight, Suit.Clubs),
      card(Rank.Ten, Suit.Clubs),
      card(Rank.Queen, Suit.Clubs),
      card(Rank.Seven, Suit.Diamonds),
      card(Rank.Ace, Suit.Hearts)
    )
    val bobHand = Vector(
      card(Rank.Six, Suit.Hearts),
      card(Rank.Eight, Suit.Hearts),
      card(Rank.Jack, Suit.Hearts),
      card(Rank.King, Suit.Hearts),
      card(Rank.Nine, Suit.Diamonds),
      card(Rank.Queen, Suit.Diamonds)
    )
    val carolHand = Vector(
      card(Rank.Six, Suit.Spades),
      card(Rank.Seven, Suit.Spades),
      card(Rank.Nine, Suit.Spades),
      card(Rank.Ten, Suit.Spades),
      card(Rank.Jack, Suit.Spades),
      card(Rank.Ten, Suit.Diamonds)
    )
    val used = aliceHand ++ bobHand ++ carolHand
    val remaining = Deck.forPlayerCount(3).filterNot(used.contains)
    val talon =
      remaining.filterNot(_.suit == Suit.Diamonds) ++ remaining.filter(_.suit == Suit.Diamonds)
    PresetGame(
      state = presetState(
        names = Vector("Alice", "Bob", "Carol"),
        hands = Vector(aliceHand, bobHand, carolHand),
        talon = talon,
        trumpSuit = Suit.Diamonds,
        bottomTrumpCard = talon.lastOption,
        tablePairs = Vector.empty,
        attackerIdx = 0,
        defenderIdx = 1,
        boutPhase = BoutPhase.InitialAttack,
        defenderInitialHandSize = 6,
        allowRedirect = true,
        transparentMode = true
      ),
      defaultPlayerId = "p0"
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

  /**
   * `full-hand-pickup` (T-90 ITEM-4): Alice (`p0`, `defaultPlayerId`) has picked
   * up almost the whole deck — 29 of the 36 cards — against Bob's (`p1`) 7, with
   * an empty talon and no bottom trump left to show. The table opens on Alice's
   * initial attack, so every card in that enormous hand is playable and the
   * reviewer can check in one click that the hand fan keeps each card's
   * left-side rank and suit visible without running off screen.
   *
   * The position is deterministic and card-conserving: `Deck.forPlayerCount(2)`
   * minus Bob's seven cards is exactly Alice's twenty-nine.
   */
  private def fullHandPickupPreset: PresetGame =
    val bobHand = Vector(
      card(Rank.Six, Suit.Hearts),
      card(Rank.Seven, Suit.Hearts),
      card(Rank.Eight, Suit.Diamonds),
      card(Rank.Nine, Suit.Diamonds),
      card(Rank.Ten, Suit.Spades),
      card(Rank.Jack, Suit.Spades),
      card(Rank.Queen, Suit.Clubs)
    )
    val aliceHand = Deck.forPlayerCount(2).filterNot(bobHand.contains)
    PresetGame(
      state = presetState(
        names = Vector("Alice", "Bob"),
        hands = Vector(aliceHand, bobHand),
        talon = Vector.empty,
        trumpSuit = Suit.Hearts,
        bottomTrumpCard = None,
        tablePairs = Vector.empty,
        attackerIdx = 0,
        defenderIdx = 1,
        boutPhase = BoutPhase.InitialAttack,
        defenderInitialHandSize = bobHand.size
      ),
      defaultPlayerId = "p0"
    )

  /**
   * The cards of the `playerCount` deck nobody holds yet, ordered so the very
   * last one is a trump (`♣`): that card becomes the bottom trump and is drawn
   * last, exactly like a dealt game.
   */
  private def clubBottomTalon(playerCount: Int, used: Vector[Card]): Vector[Card] =
    val remaining = Deck.forPlayerCount(playerCount).filterNot(used.contains)
    remaining.filterNot(_.suit == Suit.Clubs) ++ remaining.filter(_.suit == Suit.Clubs)

  /**
   * `throw-in-visibility-4p` (ITEM-1a): Bob (`p1`) has covered Alice's (`p0`)
   * `7♠` with `9♠` at `trumpSuit = Clubs`, and Dave (`p3`) already passed.
   *
   * Alice holds `7♥`, `7♦` and `9♦` — all matching a rank on the table — so she
   * is the only seat that may throw in. Bob is the defender (his `9♥` never
   * qualifies), Carol holds no `7` or `9`, and Dave has passed, so none of them
   * sees a throw-in outline. The position conserves all 52 cards (26 in hands
   * and on the table, 26 in the talon with a club at the bottom).
   */
  private def throwInVisibility4pPreset: PresetGame =
    val aliceHand = Vector(
      card(Rank.Seven, Suit.Hearts),
      card(Rank.Seven, Suit.Diamonds),
      card(Rank.Nine, Suit.Diamonds),
      card(Rank.King, Suit.Spades),
      card(Rank.Queen, Suit.Hearts),
      card(Rank.Six, Suit.Clubs)
    )
    val bobHand = Vector(
      card(Rank.Nine, Suit.Hearts),
      card(Rank.Ten, Suit.Diamonds),
      card(Rank.Jack, Suit.Spades),
      card(Rank.Eight, Suit.Hearts),
      card(Rank.Six, Suit.Diamonds),
      card(Rank.Ace, Suit.Diamonds)
    )
    val carolHand = Vector(
      card(Rank.Eight, Suit.Spades),
      card(Rank.Ten, Suit.Clubs),
      card(Rank.Jack, Suit.Hearts),
      card(Rank.Queen, Suit.Diamonds),
      card(Rank.King, Suit.Diamonds),
      card(Rank.Ace, Suit.Spades)
    )
    val daveHand = Vector(
      card(Rank.Seven, Suit.Clubs),
      card(Rank.Eight, Suit.Diamonds),
      card(Rank.Ten, Suit.Hearts),
      card(Rank.Jack, Suit.Diamonds),
      card(Rank.Queen, Suit.Spades),
      card(Rank.King, Suit.Hearts)
    )
    val tablePairs = Vector(
      TablePair(card(Rank.Seven, Suit.Spades), Some(card(Rank.Nine, Suit.Spades)))
    )
    val used = aliceHand ++ bobHand ++ carolHand ++ daveHand ++
      tablePairs.flatMap(pair => pair.attack :: pair.defense.toList)
    val talon = clubBottomTalon(4, used)
    PresetGame(
      state = presetState(
        names = Vector("Alice", "Bob", "Carol", "Dave"),
        hands = Vector(aliceHand, bobHand, carolHand, daveHand),
        talon = talon,
        trumpSuit = Suit.Clubs,
        bottomTrumpCard = talon.lastOption,
        tablePairs = tablePairs,
        attackerIdx = 0,
        defenderIdx = 1,
        boutPhase = BoutPhase.Defense,
        // Bob held seven cards when the bout opened, so capacity is five.
        defenderInitialHandSize = 7,
        passedSeats = Set(3)
      ),
      defaultPlayerId = "p0"
    )

  /**
   * `throw-in-capacity-cap` (ITEM-5): the same covered `7♠`/`9♠` table in a
   * two-player game, but the bout only has room for two more attacks.
   *
   * Alice holds `7♥ 7♦ 7♣ 9♦` — four matching cards — while
   * `maxBoutAttacks = min(6, defenderInitialHandSize = 3) = 3` and the table
   * already holds one card, so `throwInCapacity` is exactly `2`. Throwing two
   * cards at once succeeds; three are rejected. The position conserves all 36
   * cards (10 in hands and on the table, 26 in the talon).
   */
  private def throwInCapacityCapPreset: PresetGame =
    val aliceHand = Vector(
      card(Rank.Seven, Suit.Hearts),
      card(Rank.Seven, Suit.Diamonds),
      card(Rank.Seven, Suit.Clubs),
      card(Rank.Nine, Suit.Diamonds),
      card(Rank.King, Suit.Spades),
      card(Rank.Queen, Suit.Hearts)
    )
    val bobHand = Vector(
      card(Rank.Eight, Suit.Hearts),
      card(Rank.Ten, Suit.Diamonds)
    )
    val tablePairs = Vector(
      TablePair(card(Rank.Seven, Suit.Spades), Some(card(Rank.Nine, Suit.Spades)))
    )
    val used = aliceHand ++ bobHand ++
      tablePairs.flatMap(pair => pair.attack :: pair.defense.toList)
    val talon = clubBottomTalon(2, used)
    PresetGame(
      state = presetState(
        names = Vector("Alice", "Bob"),
        hands = Vector(aliceHand, bobHand),
        talon = talon,
        trumpSuit = Suit.Clubs,
        bottomTrumpCard = talon.lastOption,
        tablePairs = tablePairs,
        attackerIdx = 0,
        defenderIdx = 1,
        boutPhase = BoutPhase.Defense,
        defenderInitialHandSize = 3
      ),
      defaultPlayerId = "p0"
    )

  /**
   * `huge-hand-36` (ITEM-4 / new #3): Alice (`p0`) has opened with `6♠` and
   * holds only `6♦`, while Bob (`p1`, the default POV) defends with all 34
   * remaining cards of the 36-card deck. The talon and the discard pile are
   * empty, so the hand fan is the whole game.
   */
  private def hugeHand36Preset: PresetGame =
    val aliceHand = Vector(card(Rank.Six, Suit.Diamonds))
    val attack = card(Rank.Six, Suit.Spades)
    val bobHand = Deck.forPlayerCount(2).filterNot(card => aliceHand.contains(card) || card == attack)
    PresetGame(
      state = presetState(
        names = Vector("Alice", "Bob"),
        hands = Vector(aliceHand, bobHand),
        talon = Vector.empty,
        trumpSuit = Suit.Hearts,
        bottomTrumpCard = None,
        tablePairs = Vector(TablePair(attack)),
        attackerIdx = 0,
        defenderIdx = 1,
        boutPhase = BoutPhase.Defense,
        defenderInitialHandSize = bobHand.size
      ),
      defaultPlayerId = "p1"
    )

  /**
   * `huge-hand-52` (ITEM-4 / new #3): the four-player variant. Alice (`p0`)
   * opened with `2♠` and holds `2♦ 3♦`; Bob (`p1`, the default POV) defends
   * with all 46 remaining cards, while Carol (`p2`) holds `4♦ 5♦` and Dave
   * (`p3`) holds `6♦`. The talon and discard pile are empty and all 52 cards
   * are conserved.
   */
  private def hugeHand52Preset: PresetGame =
    val aliceHand = Vector(
      card(Rank.Two, Suit.Diamonds),
      card(Rank.Three, Suit.Diamonds)
    )
    val carolHand = Vector(
      card(Rank.Four, Suit.Diamonds),
      card(Rank.Five, Suit.Diamonds)
    )
    val daveHand = Vector(card(Rank.Six, Suit.Diamonds))
    val attack = card(Rank.Two, Suit.Spades)
    val used = aliceHand ++ carolHand ++ daveHand :+ attack
    val bobHand = Deck.forPlayerCount(4).filterNot(used.contains)
    PresetGame(
      state = presetState(
        names = Vector("Alice", "Bob", "Carol", "Dave"),
        hands = Vector(aliceHand, bobHand, carolHand, daveHand),
        talon = Vector.empty,
        trumpSuit = Suit.Hearts,
        bottomTrumpCard = None,
        tablePairs = Vector(TablePair(attack)),
        attackerIdx = 0,
        defenderIdx = 1,
        boutPhase = BoutPhase.Defense,
        defenderInitialHandSize = bobHand.size
      ),
      defaultPlayerId = "p1"
    )
