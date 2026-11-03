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
    DiscardAndEndgame
  )

  /** Three-player deflection: Alice attacked, Bob holds the matching six. */
  val P3pRedirectBob: String = "3p-redirect-bob"

  /** Four-player Chaos table waiting for Alice's first attack. */
  val Chaos4p: String = "chaos-4p"

  /** Bob has surrendered and Alice is being asked to throw in or pass. */
  val SurrenderHalfOff: String = "surrender-half-off"

  /** Empty talon, Carol already out, Alice's last card about to make Bob Durak. */
  val DiscardAndEndgame: String = "discard-and-endgame"

  /** The scripted position called `presetId`, or an error naming the unknown one. */
  def preset(presetId: String): Either[String, PresetGame] =
    Option(presetId).map(_.trim.toLowerCase).getOrElse("") match
      case P3pRedirectBob     => Right(redirectBobPreset)
      case Chaos4p            => Right(chaos4pPreset)
      case SurrenderHalfOff    => Right(surrenderHalfOffPreset)
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
   */
  private def chaos4pPreset: PresetGame =
    PresetGame(
      state = presetState(
        names = Vector("Alice", "Bob", "Carol", "Dave"),
        hands = Vector(
          Vector(
            card(Rank.Six, Suit.Clubs),
            card(Rank.Seven, Suit.Clubs),
            card(Rank.Eight, Suit.Clubs),
            card(Rank.Nine, Suit.Clubs),
            card(Rank.Ten, Suit.Clubs),
            card(Rank.Jack, Suit.Clubs)
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
   * `surrender-half-off`: Bob (`p1`) has surrendered against `7♠`, Alice (`p0`)
   * holds `7♥` and is asked to throw in or pass while the table stays half-off
   * towards Bob's hand.
   */
  private def surrenderHalfOffPreset: PresetGame =
    PresetGame(
      state = presetState(
        names = Vector("Alice", "Bob", "Carol"),
        hands = Vector(
          Vector(
            card(Rank.Seven, Suit.Hearts),
            card(Rank.Nine, Suit.Clubs),
            card(Rank.Jack, Suit.Clubs),
            card(Rank.Queen, Suit.Clubs),
            card(Rank.King, Suit.Clubs),
            card(Rank.Ace, Suit.Clubs)
          ),
          Vector(
            card(Rank.Eight, Suit.Hearts),
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
        tablePairs = Vector(TablePair(card(Rank.Seven, Suit.Spades))),
        attackerIdx = 0,
        defenderIdx = 1,
        boutPhase = BoutPhase.SurrenderThrowIn,
        defenderInitialHandSize = 6
      ),
      defaultPlayerId = "p0"
    )

  /**
   * `discard-and-endgame`: the talon is empty, Carol (`p2`) is already out and
   * eight cards sit in the discard pile (four of them face-up). Alice (`p0`)
   * holds one last card against Bob (`p1`), who cannot cover it, so Bob's
   * surrender ends the match and labels him `DURAK`.
   */
  private def discardAndEndgamePreset: PresetGame =
    val faceDown = Vector(
      card(Rank.Six, Suit.Clubs),
      card(Rank.Seven, Suit.Clubs),
      card(Rank.Eight, Suit.Clubs),
      card(Rank.Nine, Suit.Clubs)
    )
    val faceUp = Vector(
      card(Rank.Two, Suit.Diamonds),
      card(Rank.Three, Suit.Diamonds),
      card(Rank.Four, Suit.Diamonds),
      card(Rank.Five, Suit.Diamonds)
    )
    PresetGame(
      state = presetState(
        names = Vector("Alice", "Bob", "Carol"),
        hands = Vector(
          Vector(card(Rank.Eight, Suit.Spades)),
          Vector(card(Rank.King, Suit.Hearts), card(Rank.Queen, Suit.Hearts)),
          Vector.empty
        ),
        talon = Vector.empty,
        trumpSuit = Suit.Spades,
        bottomTrumpCard = None,
        tablePairs = Vector.empty,
        attackerIdx = 0,
        defenderIdx = 1,
        boutPhase = BoutPhase.InitialAttack,
        defenderInitialHandSize = 2,
        discardPile = faceDown ++ faceUp,
        lastDiscardCards = faceUp,
        finishOrder = Vector("p2"),
        finishRanks = Vector(None, None, Some(1))
      ),
      defaultPlayerId = "p0"
    )
