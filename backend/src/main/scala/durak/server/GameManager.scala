package durak.server

import cats.effect.*
import durak.engine.*

import scala.concurrent.duration.*

/**
 * A scripted QA position that can be started in one click.
 *
 * `turnSecondsOverride` arms the room with a shorter turn clock than the
 * ordinary fifteen seconds, so a preset whose clock must expire during a review
 * (`qa-surrender-timer`) resolves with no manual move.
 */
case class PresetGame(
    state: GameState,
    defaultPlayerId: String,
    turnSecondsOverride: Option[Int] = None
)

/**
 * Bot pacing every room the manager creates. Production uses the GameActor
 * defaults (`50 ms` between RandomBot moves, `500 ms` before the first one,
 * ITEM-NEW3); a test suite can build a manager with tiny values so bot matches
 * stay fast.
 */
case class BotTiming(
    randomBotDelay: FiniteDuration = GameActor.DefaultRandomBotDelay,
    initialBotStartDelay: FiniteDuration = GameActor.DefaultInitialBotStartDelay
)

object BotTiming:
  /** The production pacing: fast RandomBot play after a half-second start pause. */
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
          turnSeconds = preset.turnSecondsOverride.getOrElse(GameActor.DefaultTurnSeconds),
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
   * Every scripted position `POST /api/games/preset` can start: the four curated
   * scenarios of the current QA round (ITEM-9) plus the two feedback positions
   * for covered-pair edge collapsing (`qa-table-collapse-right`) and the live
   * surrender timer (`qa-surrender-timer`). Every preset of the previous rounds
   * has been pruned, and the engine positions those old tests reasoned about now
   * live as test-only fixtures under
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

  /**
   * `"Table Collapse Right"`: a 4p table whose tapped defender sits `top-right`
   * from Alice's POV, with two covered and two uncovered pairs on the felt.
   */
  val QaTableCollapseRight: String = "qa-table-collapse-right"

  /**
   * `"Surrender Timer"`: the active Alice surrenders a four-card incoming bout
   * while Bob and Carol hold live throw-ins and the turn clock keeps ticking.
   */
  val QaSurrenderTimer: String = "qa-surrender-timer"

  /**
   * `"Fast Bots (75% Faster)"`: a four-seat table where Alice is the only human
   * and Bob, Carol and Dave are `basicBot` seats, with Bob already on turn to
   * open against Carol. The bots play at the ITEM-NEW3 cadence, so a reviewer
   * watches attacks, defenses, throw-ins and passes chain together in seconds.
   */
  val QaFastBots: String = "qa-fast-bots"

  /**
   * Turn-clock length of the `qa-surrender-timer` room. Three seconds is short
   * enough that the surrendered bout resolves while a reviewer watches it: the
   * clock auto-passes Bob and Carol, Alice picks up the five table cards and
   * the bout clears. Every other room keeps the fifteen-second default.
   */
  val QaSurrenderTimerTurnSeconds: Int = 3

  val Presets: Vector[String] = Vector(
    QaNormal6Actions,
    QaMedium14Expand,
    QaLarge30Compress,
    QaSingleCard,
    QaTableCollapseRight,
    QaSurrenderTimer,
    QaFastBots
  )

  /** The scripted position called `presetId`, or an error naming the unknown one. */
  def preset(presetId: String): Either[String, PresetGame] =
    Option(presetId).map(_.trim.toLowerCase).getOrElse("") match
      case QaNormal6Actions      => Right(qaNormal6ActionsPreset)
      case QaMedium14Expand      => Right(qaMedium14ExpandPreset)
      case QaLarge30Compress     => Right(qaLarge30CompressPreset)
      case QaSingleCard          => Right(qaSingleCardPreset)
      case QaTableCollapseRight  => Right(qaTableCollapseRightPreset)
      case QaSurrenderTimer      => Right(qaSurrenderTimerPreset)
      case QaFastBots            => Right(qaFastBotsPreset)
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
      passedSeats: Set[Int] = Set.empty,
      // Seat types, e.g. one human plus three `basicBot` seats; empty is all-human.
      playerTypes: Vector[String] = Vector.empty
  ): GameState =
    GameState(
      config = GameConfig(
        playerCount = names.size,
        allowRedirect = allowRedirect,
        seed = 20261102L,
        playerTypes = playerTypes,
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

  /**
   * `qa-table-collapse-right` — "Table Collapse Right".
   *
   * A four-seat hotseat table over the 52-card deck (`trumpSuit = Hearts`) with
   * two covered pairs and two uncovered attacks on the felt, opened on Alice
   * (`p0`, the default POV, the attacker). The defender Dave (`p3`) sits
   * `top-right` from Alice's view, so the covered pairs must collapse toward the
   * **right** edge; switching the POV to Bob (`p1`), Carol (`p2`) or Dave (`p3`)
   * moves Dave to `top-center`, `top-left` and the active bottom seat, and the
   * same covered pairs must then collapse to the **left** edge.
   *
   * The covered ten (`10♣` under `J♣`) keeps its full rank and suit readable in
   * the collapsed stack. Dave holds trump covering cards for both uncovered
   * attacks (`7♥` and `8♦`), so covering one makes it snap to the edge, and
   * Alice holds `7♣` and `8♥`, both matching a rank already on the table, so she
   * may throw in one and then the other (ITEM-NEW1). Dave opened the bout with
   * six cards and has covered two of them, leaving the four cards the reviewer
   * expects on his seat. With four cards on the felt, `maxBoutAttacks = 6`
   * leaves two free throw-in slots, and `4 remaining - 2 uncovered = 2`, so both
   * matching cards are genuinely legal under the Durak capacity rules.
   */
  private def qaTableCollapseRightPreset: PresetGame =
    val aliceHand = Vector(
      card(Rank.Seven, Suit.Clubs),
      card(Rank.Eight, Suit.Hearts),
      card(Rank.Two, Suit.Spades),
      card(Rank.Three, Suit.Spades),
      card(Rank.Four, Suit.Spades),
      card(Rank.Five, Suit.Spades)
    )
    val bobHand = Vector(
      card(Rank.Six, Suit.Spades),
      card(Rank.Six, Suit.Clubs),
      card(Rank.Two, Suit.Diamonds),
      card(Rank.Three, Suit.Diamonds),
      card(Rank.Four, Suit.Diamonds),
      card(Rank.Five, Suit.Diamonds)
    )
    val carolHand = Vector(
      card(Rank.Queen, Suit.Hearts),
      card(Rank.Three, Suit.Clubs),
      card(Rank.Four, Suit.Clubs),
      card(Rank.Five, Suit.Clubs),
      card(Rank.Six, Suit.Hearts),
      card(Rank.Seven, Suit.Spades)
    )
    val daveHand = Vector(
      card(Rank.Nine, Suit.Hearts),
      card(Rank.Ten, Suit.Hearts),
      card(Rank.Jack, Suit.Hearts),
      card(Rank.Two, Suit.Clubs)
    )
    val tablePairs = Vector(
      TablePair(card(Rank.Ten, Suit.Clubs), Some(card(Rank.Jack, Suit.Clubs))),
      TablePair(card(Rank.Eight, Suit.Spades), Some(card(Rank.Queen, Suit.Spades))),
      TablePair(card(Rank.Seven, Suit.Hearts)),
      TablePair(card(Rank.Eight, Suit.Diamonds))
    )
    val used = aliceHand ++ bobHand ++ carolHand ++ daveHand ++
      tablePairs.flatMap(pair => pair.attack :: pair.defense.toList)
    val talon = suitBottomTalon(4, used, Suit.Hearts)
    PresetGame(
      state = presetState(
        names = Vector("Alice", "Bob", "Carol", "Dave"),
        hands = Vector(aliceHand, bobHand, carolHand, daveHand),
        talon = talon,
        trumpSuit = Suit.Hearts,
        bottomTrumpCard = talon.lastOption,
        tablePairs = tablePairs,
        attackerIdx = 0,
        defenderIdx = 3,
        boutPhase = BoutPhase.Defense,
        defenderInitialHandSize = 6
      ),
      defaultPlayerId = "p0"
    )

  /**
   * `qa-surrender-timer` — "Surrender Timer".
   *
   * A three-seat hotseat table (`trumpSuit = Hearts`) where Carol (`p2`) has
   * attacked with four tens, Alice (`p0`, the default POV and the active bottom
   * user) covered one of them with `J♣` and then surrendered. The bout sits in
   * `SurrenderThrowIn` with four incoming pairs (one covered, three uncovered),
   * so Alice's hand and the turn clock above it are both populated while she is
   * surrendering.
   *
   * Bob (`p1`) holds `J♠`/`J♥` and Carol holds `J♦`, all matching the `J♣` on
   * the table, so their throw-in window stays open (`promptedPlayerIds` is
   * non-empty) and the room's turn clock is armed from the first frame instead
   * of settling the surrendered bout immediately.
   *
   * The room runs on a three-second clock ([[QaSurrenderTimerTurnSeconds]]) so
   * the throw-in window really expires during a QA step: Bob and Carol are
   * auto-passed, the bout resolves and the five table cards move into Alice's
   * hand (`6 -> 11`).
   */
  private def qaSurrenderTimerPreset: PresetGame =
    val aliceHand = Vector(
      card(Rank.Nine, Suit.Hearts),
      card(Rank.Eight, Suit.Hearts),
      card(Rank.Seven, Suit.Hearts),
      card(Rank.Six, Suit.Diamonds),
      card(Rank.Ace, Suit.Spades),
      card(Rank.King, Suit.Spades)
    )
    val bobHand = Vector(
      card(Rank.Jack, Suit.Spades),
      card(Rank.Jack, Suit.Hearts),
      card(Rank.Six, Suit.Spades),
      card(Rank.Seven, Suit.Spades),
      card(Rank.Eight, Suit.Spades),
      card(Rank.Nine, Suit.Spades)
    )
    val carolHand = Vector(
      card(Rank.Jack, Suit.Diamonds),
      card(Rank.Six, Suit.Hearts),
      card(Rank.Queen, Suit.Hearts),
      card(Rank.King, Suit.Hearts),
      card(Rank.Nine, Suit.Diamonds),
      card(Rank.Ace, Suit.Diamonds)
    )
    val tablePairs = Vector(
      TablePair(card(Rank.Ten, Suit.Clubs), Some(card(Rank.Jack, Suit.Clubs))),
      TablePair(card(Rank.Ten, Suit.Spades)),
      TablePair(card(Rank.Ten, Suit.Diamonds)),
      TablePair(card(Rank.Ten, Suit.Hearts))
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
        attackerIdx = 2,
        defenderIdx = 0,
        boutPhase = BoutPhase.SurrenderThrowIn,
        defenderInitialHandSize = 6
      ),
      defaultPlayerId = "p0",
      turnSecondsOverride = Some(QaSurrenderTimerTurnSeconds)
    )

  /**
   * `qa-fast-bots` — "Fast Bots (75% Faster)".
   *
   * A four-seat table over the 52-card deck (`trumpSuit = Hearts`) where Alice
   * (`p0`, the only human seat and the default POV) sits out of the opening
   * bout: Bob (`p1`), Carol (`p2`) and Dave (`p3`) are `basicBot` seats, Bob is
   * the attacker and Carol the defender, and the bout is still in
   * `InitialAttack`, so the bot driver is on Bob's seat from the very first
   * frame.
   *
   * The hands are chosen so the bots show the whole loop at the ITEM-NEW3
   * cadence within seconds: Bob opens with a club, Carol covers with a trump,
   * Dave matches the `6` on the table with his `6♦` throw-in, and Alice holds
   * only `2`–`5` cards, so her throw-in window closes without a manual move.
   * A 28-card talon keeps the deck healthy mid-game and the bottom-trump badge
   * visible.
   */
  private def qaFastBotsPreset: PresetGame =
    val aliceHand = Vector(
      card(Rank.Two, Suit.Spades),
      card(Rank.Three, Suit.Spades),
      card(Rank.Four, Suit.Spades),
      card(Rank.Five, Suit.Spades),
      card(Rank.Two, Suit.Diamonds),
      card(Rank.Three, Suit.Diamonds)
    )
    val bobHand = Vector(
      card(Rank.Six, Suit.Clubs),
      card(Rank.Seven, Suit.Clubs),
      card(Rank.Eight, Suit.Clubs),
      card(Rank.Nine, Suit.Clubs),
      card(Rank.Ten, Suit.Clubs),
      card(Rank.Jack, Suit.Clubs)
    )
    val carolHand = Vector(
      card(Rank.Nine, Suit.Hearts),
      card(Rank.Ten, Suit.Hearts),
      card(Rank.Jack, Suit.Hearts),
      card(Rank.Queen, Suit.Hearts),
      card(Rank.King, Suit.Hearts),
      card(Rank.Ace, Suit.Hearts)
    )
    val daveHand = Vector(
      card(Rank.Four, Suit.Clubs),
      card(Rank.Five, Suit.Clubs),
      card(Rank.Six, Suit.Diamonds),
      card(Rank.Seven, Suit.Diamonds),
      card(Rank.Eight, Suit.Diamonds),
      card(Rank.Queen, Suit.Spades)
    )
    val used = aliceHand ++ bobHand ++ carolHand ++ daveHand
    val talon = suitBottomTalon(4, used, Suit.Hearts)
    PresetGame(
      state = presetState(
        names = Vector("Alice", "Bob", "Carol", "Dave"),
        hands = Vector(aliceHand, bobHand, carolHand, daveHand),
        talon = talon,
        trumpSuit = Suit.Hearts,
        bottomTrumpCard = talon.lastOption,
        tablePairs = Vector.empty,
        attackerIdx = 1,
        defenderIdx = 2,
        boutPhase = BoutPhase.InitialAttack,
        defenderInitialHandSize = carolHand.size,
        playerTypes = Vector(
          GameConfig.HumanSeat,
          GameConfig.BasicBotSeat,
          GameConfig.BasicBotSeat,
          GameConfig.BasicBotSeat
        )
      ),
      defaultPlayerId = "p0"
    )
