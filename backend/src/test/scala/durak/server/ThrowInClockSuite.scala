package durak.server

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import durak.engine.*

import scala.concurrent.duration.*

class ThrowInClockSuite extends munit.FunSuite:

  private def card(rank: Rank, suit: Suit = Suit.Spades): Card = Card(suit, rank)

  private def player(id: String, hand: List[Card], hasPassed: Boolean = false): PlayerState =
    PlayerState(id = id, name = id.toUpperCase, hand = hand.toVector, hasPassed = hasPassed)

  private def state(
      players: Vector[PlayerState],
      tablePairs: Vector[TablePair],
      boutPhase: BoutPhase,
      defenderInitialHandSize: Int = 6,
      turnDeadlineMs: Long = 0L
  ): GameState =
    GameState(
      config = GameConfig(players.size, seed = 42L),
      players = players,
      talon = Vector.empty,
      trumpSuit = Suit.Spades,
      bottomTrumpCard = None,
      discardPile = Vector.empty,
      tablePairs = tablePairs,
      attackerIdx = 0,
      defenderIdx = 1,
      boutPhase = boutPhase,
      defenderInitialHandSize = defenderInitialHandSize,
      finishOrder = Vector.empty,
      turnDeadlineMs = turnDeadlineMs
    )

  private def newRoom(players: Int, seed: Long = 9L, turnSeconds: Int = 1): GameRoom =
    GameActor
      .create(
        GameConfig(playerCount = players, seed = seed),
        Vector.tabulate(players)(idx => s"P$idx"),
        turnSeconds
      )
      .unsafeRunSync()

  private def awaitState(
      room: GameRoom,
      timeout: FiniteDuration
  )(predicate: GameState => Boolean): GameState =
    val deadline = System.currentTimeMillis() + timeout.toMillis
    var current = room.stateRef.get.unsafeRunSync()
    while !predicate(current) && System.currentTimeMillis() < deadline do
      IO.sleep(25.millis).unsafeRunSync()
      current = room.stateRef.get.unsafeRunSync()
    assert(
      predicate(current),
      s"state did not arrive within $timeout (phase ${current.boutPhase})"
    )
    current

  private val six = card(Rank.Six, Suit.Spades)

  // --- Prompted seats ---

  test("every eligible thrower is on the clock during a surrender throw-in") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Ace, Suit.Clubs), card(Rank.Six, Suit.Hearts))),
        player("p1", List(card(Rank.Seven, Suit.Spades), card(Rank.Eight, Suit.Spades))),
        player("p2", List(card(Rank.Six, Suit.Diamonds), card(Rank.King, Suit.Diamonds)))
      ),
      tablePairs = Vector(TablePair(six)),
      boutPhase = BoutPhase.SurrenderThrowIn,
      defenderInitialHandSize = 2
    )

    assertEquals(gs.promptedPlayerIds, Set("p0", "p2"))
    assertEquals(gs.promptedPlayerSeats, Vector(0, 2))
    // The surrendered defender has no legal move, so it never holds the clock.
    assertEquals(PlayerGameView.forViewer(gs, "p1").legalActions, List.empty)

    // Every prompted seat reads the same live countdown.
    val clocked = gs.copy(turnDeadlineMs = 30_000L)
    assertEquals(
      PlayerGameView.forViewer(clocked, "p0", nowMs = 15_000L).turnSecondsRemaining,
      15
    )
    assertEquals(
      PlayerGameView.forViewer(clocked, "p2", nowMs = 15_000L).turnSecondsRemaining,
      15
    )
    assertEquals(
      PlayerGameView.forViewer(clocked, "p0", nowMs = 15_000L).promptedPlayerIds,
      Vector("p0", "p2")
    )
  }

  test("every eligible thrower is on the clock once every attack is covered") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Six, Suit.Hearts), card(Rank.King, Suit.Clubs))),
        player("p1", List(card(Rank.Eight, Suit.Spades), card(Rank.Nine, Suit.Spades))),
        player("p2", List(card(Rank.Six, Suit.Diamonds), card(Rank.Queen, Suit.Diamonds)))
      ),
      tablePairs = Vector(TablePair(six, Some(card(Rank.Seven, Suit.Spades)))),
      boutPhase = BoutPhase.Defense,
      defenderInitialHandSize = 2
    )

    assert(gs.isThrowInPhase, "a fully covered table must open the throw-in phase")
    assertEquals(gs.promptedPlayerIds, Set("p0", "p2"))
  }

  test("a passed, cardless or defending seat is never on the clock") {
    val gs = state(
      Vector(
        player("p0", List(card(Rank.Six, Suit.Hearts)), hasPassed = true),
        player("p1", List(card(Rank.Eight, Suit.Spades))),
        player("p2", List(card(Rank.Six, Suit.Diamonds)))
      ),
      tablePairs = Vector(TablePair(six)),
      boutPhase = BoutPhase.SurrenderThrowIn,
      defenderInitialHandSize = 1
    )

    assertEquals(gs.promptedPlayerIds, Set("p2"))

    val cardless = gs.copy(
      players = gs.players.updated(2, gs.players(2).copy(hand = Vector.empty))
    )
    assertEquals(cardless.promptedPlayerIds, Set.empty)
  }

  test("only the attacker opens a bout and only the defender answers an uncovered attack") {
    val opening = state(
      Vector(
        player("p0", List(card(Rank.Six, Suit.Hearts))),
        player("p1", List(card(Rank.Eight, Suit.Spades))),
        player("p2", List(card(Rank.Nine, Suit.Diamonds)))
      ),
      tablePairs = Vector.empty,
      boutPhase = BoutPhase.InitialAttack
    )
    assertEquals(opening.promptedPlayerIds, Set("p0"))

    val defending = opening.copy(
      tablePairs = Vector(TablePair(six)),
      boutPhase = BoutPhase.Defense
    )
    assertEquals(defending.promptedPlayerIds, Set("p1"))

    assertEquals(
      opening.copy(boutPhase = BoutPhase.GameOver).promptedPlayerIds,
      Set.empty
    )
  }

  // --- Expiry ---

  test("the clock auto-passes every waiting thrower when the throw-in clock expires") {
    val room = newRoom(players = 3)
    val now = System.currentTimeMillis()
    val waiting = state(
      Vector(
        player("p0", List(card(Rank.Ace, Suit.Clubs), card(Rank.Six, Suit.Hearts))),
        player("p1", List(card(Rank.Seven, Suit.Spades), card(Rank.Eight, Suit.Spades))),
        player("p2", List(card(Rank.Six, Suit.Diamonds), card(Rank.King, Suit.Diamonds)))
      ),
      tablePairs = Vector(TablePair(six)),
      boutPhase = BoutPhase.SurrenderThrowIn,
      defenderInitialHandSize = 2,
      turnDeadlineMs = now + 800L
    )
    assertEquals(waiting.promptedPlayerIds, Set("p0", "p2"))
    room.stateRef.set(waiting).unsafeRunSync()

    val settled = awaitState(room, 5.seconds)(_.tablePairs.isEmpty)
    GameActor.stopClock(room).unsafeRunSync()

    assertEquals(settled.boutPhase, BoutPhase.InitialAttack)
    // The surrendering defender picked up the attack card after the passes.
    assert(settled.players(1).hand.size >= 3, settled.players(1).hand.toString)

    val recorded = room.replay.get.unsafeRunSync().moves.map(_.action)
    assert(recorded.contains(GameAction.PassTurn("p0")), recorded.toString)
    assert(recorded.contains(GameAction.PassTurn("p2")), recorded.toString)
  }

  test("the clock settles a bout whose throwers were already auto-passed by the surrender") {
    val room = newRoom(players = 2)
    val now = System.currentTimeMillis()
    val waiting = state(
      Vector(
        player("p0", Nil, hasPassed = true),
        player("p1", List(card(Rank.Seven, Suit.Spades), card(Rank.Eight, Suit.Spades)))
      ),
      tablePairs = Vector(TablePair(six)),
      boutPhase = BoutPhase.SurrenderThrowIn,
      defenderInitialHandSize = 2,
      turnDeadlineMs = now + 800L
    )
    // Nobody is prompted, but one settling pass still resolves the bout.
    assertEquals(waiting.promptedPlayerIds, Set.empty)
    assertEquals(GameEngine.applyAction(waiting, GameAction.PassTurn("p0")).isRight, true)
    room.stateRef.set(waiting).unsafeRunSync()

    val settled = awaitState(room, 5.seconds)(_.tablePairs.isEmpty)
    GameActor.stopClock(room).unsafeRunSync()

    assertEquals(settled.tablePairs, Vector.empty)
    assertEquals(settled.boutPhase, BoutPhase.GameOver)
    val recorded = room.replay.get.unsafeRunSync().moves.map(_.action)
    assert(recorded.contains(GameAction.PassTurn("p0")), recorded.toString)
  }
