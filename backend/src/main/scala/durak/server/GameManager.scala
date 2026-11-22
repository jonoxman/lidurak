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
   * jump straight into one of the curated positions of the current QA round
   * without playing a whole match.
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

  /**
   * Every scripted position `POST /api/games/preset` can start: exactly the four
   * curated scenarios of the current QA round (ITEM-9). Every preset of the
   * previous rounds has been pruned, and the engine positions those old tests
   * reasoned about now live as test-only fixtures under
   * `backend/src/test/scala/durak/engine/ThrowInFixtures.scala`.
   */
  /** `"6-Card 10s & Actions"`: a 3p table with a throw-in and both action seats. */
  val QaNormal6Actions: String = "qa-normal-6-actions"

  /** `"14-Card Expand Box"`: Alice opens a 2p bout holding fourteen cards. */
  val QaMedium14Expand: String = "qa-medium-14-expand"

  /** `"30-Card Compress & Part"`: Alice defends a lone `9♣` with thirty cards. */
  val QaLarge30Compress: String = "qa-large-30-compress"

  /** `"1-Card Hand (No Part)"`: Alice opens a 2p bout with a single `10♠`. */
  val QaSingleCard: String = "qa-single-card"

  val Presets: Vector[String] = Vector(
    QaNormal6Actions,
    QaMedium14Expand,
    QaLarge30Compress,
    QaSingleCard
  )

  /** The scripted position called `presetId`, or an error naming the unknown one. */
  def preset(presetId: String): Either[String, PresetGame] =
    Option(presetId).map(_.trim.toLowerCase).getOrElse("") match
      case QaNormal6Actions  => Right(qaNormal6ActionsPreset)
      case QaMedium14Expand  => Right(qaMedium14ExpandPreset)
      case QaLarge30Compress => Right(qaLarge30CompressPreset)
      case QaSingleCard      => Right(qaSingleCardPreset)
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

  /** The cards of the `playerCount` deck nobody holds, ordered trump last. */
  private def suitBottomTalon(
      playerCount: Int,
      used: Vector[Card],
      trumpSuit: Suit
  ): Vector[Card] =
    val remaining = Deck.forPlayerCount(playerCount).filterNot(used.contains)
    remaining.filterNot(_.suit == trumpSuit) ++ remaining.filter(_.suit == trumpSuit)

  /**
   * `qa-normal-6-actions` — "6-Card 10s & Actions".
   *
   * A three-player hotseat table (`trumpSuit = Hearts`) with a non-empty talon,
   * opened on Alice (`p0`, the default POV), whose six-card hand holds `10♣` and
   * the two jacks that match the covered `10♠`/`J♠` bout: she is a non-defender
   * on an open throw-in window, so she sees `["pass", "throwIn"]` with a
   * three-card multi-select capacity in the default six-card hand box
   * (ITEMS #2, #3, #4, #5, #6, #8 and the lower-table Pass button of #7).
   *
   * Bob (`p1`) defends with six cards and two tens (`10♥`, a trump, and `10♦`)
   * next to unplayable filler, so the same seat still shows the mixed
   * playable/unplayable card faces.
   *
   * The engine keeps surrender and pass mutually exclusive by rule: a defender
   * may only surrender while an attacking card is uncovered, and a non-defender
   * may only pass once every attacking card is covered (`GameEngine.applyPassTurn`
   * rejects a pass "while attacking cards are still uncovered"). The surrendered
   * half-off table, and with it the lower-table Surrender button, is
   * `qa-large-30-compress`, whose defending Alice holds `"cover"` and
   * `"surrender"` on a 30-card hand.
   */
  private def qaNormal6ActionsPreset: PresetGame =
    val aliceHand = Vector(
      card(Rank.Ten, Suit.Clubs),
      card(Rank.Jack, Suit.Diamonds),
      card(Rank.Jack, Suit.Clubs),
      card(Rank.Nine, Suit.Diamonds),
      card(Rank.Queen, Suit.Clubs),
      card(Rank.Six, Suit.Diamonds)
    )
    val bobHand = Vector(
      card(Rank.Ten, Suit.Hearts),
      card(Rank.Ten, Suit.Diamonds),
      card(Rank.Nine, Suit.Spades),
      card(Rank.Six, Suit.Clubs),
      card(Rank.Seven, Suit.Diamonds),
      card(Rank.Queen, Suit.Diamonds)
    )
    val carolHand = Vector(
      card(Rank.Eight, Suit.Spades),
      card(Rank.Eight, Suit.Hearts),
      card(Rank.Eight, Suit.Diamonds),
      card(Rank.King, Suit.Spades),
      card(Rank.Ace, Suit.Spades),
      card(Rank.Seven, Suit.Spades)
    )
    val tablePairs = Vector(
      TablePair(card(Rank.Ten, Suit.Spades), Some(card(Rank.Jack, Suit.Spades)))
    )
    val used = aliceHand ++ bobHand ++ carolHand ++
      tablePairs.flatMap(pair => pair.attack :: pair.defense.toList)
    val talon = suitBottomTalon(3, used, Suit.Hearts)
    PresetGame(
      state = presetState(
        names = Vector("Alice", "Bob", "Carol"),
        hands = Vector(aliceHand, bobHand, carolHand),
        talon = talon,
        trumpSuit = Suit.Hearts,
        bottomTrumpCard = talon.lastOption,
        tablePairs = tablePairs,
        attackerIdx = 0,
        defenderIdx = 1,
        boutPhase = BoutPhase.Defense,
        // Bob held seven cards when the bout opened and has covered with `J♠`.
        defenderInitialHandSize = 7
      ),
      defaultPlayerId = "p0"
    )

  /**
   * `qa-medium-14-expand` — "14-Card Expand Box".
   *
   * A two-player hotseat table (`trumpSuit = Hearts`, non-empty talon) waiting
   * for Alice's (`p0`, the default POV) opening attack. Her fourteen cards hold
   * all four tens plus paired nines and jacks, so the hand box can expand past
   * the default six-card box toward the maximal box at full card size
   * (ITEMS #2, #3, #4, #5 Option B, #6, #8).
   */
  private def qaMedium14ExpandPreset: PresetGame =
    val aliceHand = Vector(
      card(Rank.Ten, Suit.Spades),
      card(Rank.Ten, Suit.Hearts),
      card(Rank.Ten, Suit.Diamonds),
      card(Rank.Ten, Suit.Clubs),
      card(Rank.Nine, Suit.Spades),
      card(Rank.Nine, Suit.Clubs),
      card(Rank.Jack, Suit.Diamonds),
      card(Rank.Jack, Suit.Clubs),
      card(Rank.Six, Suit.Hearts),
      card(Rank.Seven, Suit.Hearts),
      card(Rank.Queen, Suit.Spades),
      card(Rank.King, Suit.Spades),
      card(Rank.Ace, Suit.Diamonds),
      card(Rank.Six, Suit.Diamonds)
    )
    val bobHand = Vector(
      card(Rank.Eight, Suit.Spades),
      card(Rank.Eight, Suit.Hearts),
      card(Rank.Eight, Suit.Diamonds),
      card(Rank.King, Suit.Hearts),
      card(Rank.Ace, Suit.Hearts),
      card(Rank.Seven, Suit.Clubs)
    )
    val talon = suitBottomTalon(2, aliceHand ++ bobHand, Suit.Hearts)
    PresetGame(
      state = presetState(
        names = Vector("Alice", "Bob"),
        hands = Vector(aliceHand, bobHand),
        talon = talon,
        trumpSuit = Suit.Hearts,
        bottomTrumpCard = talon.lastOption,
        tablePairs = Vector.empty,
        attackerIdx = 0,
        defenderIdx = 1,
        boutPhase = BoutPhase.InitialAttack,
        defenderInitialHandSize = bobHand.size
      ),
      defaultPlayerId = "p0"
    )

  /**
   * `qa-large-30-compress` — "30-Card Compress & Part".
   *
   * Bob (`p1`) has attacked with a lone uncovered `9♣` at `trumpSuit = Hearts`
   * and Alice (`p0`, the default POV, on the turn clock) defends with 30 of the
   * 36 cards, this time including all four tens. Thirteen cards cover the nine
   * (the clubs above it plus every heart trump) and seventeen cannot, so the
   * overlap must compress past the maximal allowable overlap at constant full
   * card size, and `["cover", "surrender"]` are both legal on the very first
   * frame (ITEMS #2, #3, #4, #5, #6, #7, #8).
   *
   * The talon keeps three cards (the bottom trump is the `6♥`), so the deck is
   * conserved: 30 in Alice's hand, 2 in Bob's, 3 in the talon and 1 on the table.
   */
  private def qaLarge30CompressPreset: PresetGame =
    val bobHand = Vector(
      card(Rank.Eight, Suit.Spades),
      card(Rank.Nine, Suit.Spades)
    )
    val talon = Vector(
      card(Rank.Eight, Suit.Diamonds),
      card(Rank.Nine, Suit.Diamonds),
      card(Rank.Six, Suit.Hearts)
    )
    val attack = card(Rank.Nine, Suit.Clubs)
    val used = bobHand ++ talon :+ attack
    val aliceHand = Deck.forPlayerCount(2).filterNot(used.contains)
    PresetGame(
      state = presetState(
        names = Vector("Alice", "Bob"),
        hands = Vector(aliceHand, bobHand),
        talon = talon,
        trumpSuit = Suit.Hearts,
        bottomTrumpCard = talon.lastOption,
        tablePairs = Vector(TablePair(attack)),
        attackerIdx = 1,
        defenderIdx = 0,
        boutPhase = BoutPhase.Defense,
        defenderInitialHandSize = aliceHand.size
      ),
      defaultPlayerId = "p0"
    )

  /**
   * `qa-single-card` — "1-Card Hand (No Part)".
   *
   * A two-player table with an empty talon where Alice (`p0`, the default POV
   * and the attacker on the turn clock) holds exactly one card, `10♠`, so the
   * single-card hand must never part under the pointer (ITEM #6). Bob (`p1`)
   * holds `A♥` and `K♦`; the other 33 cards are the resolved discard pile, so
   * the position still conserves the whole 36-card deck.
   */
  private def qaSingleCardPreset: PresetGame =
    val aliceHand = Vector(card(Rank.Ten, Suit.Spades))
    val bobHand = Vector(
      card(Rank.Ace, Suit.Hearts),
      card(Rank.King, Suit.Diamonds)
    )
    val discardPile = Deck.forPlayerCount(2).filterNot((aliceHand ++ bobHand).contains)
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
        defenderInitialHandSize = bobHand.size,
        discardPile = discardPile
      ),
      defaultPlayerId = "p0"
    )
