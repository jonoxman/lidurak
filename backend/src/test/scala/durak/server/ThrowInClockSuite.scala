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

  // --- Delayed auto-pass (ITEM-PREV-4b) ---

  test("a seat with no legal throw-in is auto-passed only after the 1-second delay") {
    val room = GameActor
      .create(GameConfig(playerCount = 3, seed = 9L), Vector("Alice", "Bob", "Carol"), 15)
      .unsafeRunSync()
    val now = System.currentTimeMillis()
    // Bob surrendered. Alice still holds a six (a rank on the table), while
    // Carol holds only a king and a queen, so she has no throw-in at all.
    val surrendered = state(
      Vector(
        player("p0", List(card(Rank.Six, Suit.Hearts), card(Rank.Seven, Suit.Hearts))),
        player("p1", List(card(Rank.Seven, Suit.Spades), card(Rank.Eight, Suit.Spades))),
        player("p2", List(card(Rank.King, Suit.Diamonds), card(Rank.Queen, Suit.Diamonds)))
      ),
      tablePairs = Vector(TablePair(six)),
      boutPhase = BoutPhase.SurrenderThrowIn,
      defenderInitialHandSize = 6,
      turnDeadlineMs = now + 15_000L
    )
    assertEquals(GameEngine.playersNeedingAutoPass(surrendered), Vector("p2"))
    room.stateRef.set(surrendered).unsafeRunSync()
    val startedAt = System.currentTimeMillis()

    // 0 ms: nobody was passed inside the surrender transition.
    val immediate = room.stateRef.get.unsafeRunSync()
    assertEquals(immediate.players(2).hasPassed, false)
    assertEquals(immediate.tablePairs, surrendered.tablePairs)

    val afterDelay = awaitState(room, 5.seconds)(_.players(2).hasPassed)
    val elapsedMs = System.currentTimeMillis() - startedAt
    GameActor.stopClock(room).unsafeRunSync()

    // The pass waited for the full 1-second `noThrowInAutoPassDelay`.
    assert(elapsedMs >= 900L, s"the auto-pass did not wait for the delay: ${elapsedMs}ms")
    // The bout stays in the throw-in phase, still waiting on Alice's throw-in.
    assertEquals(afterDelay.boutPhase, BoutPhase.SurrenderThrowIn)
    assertEquals(afterDelay.tablePairs, surrendered.tablePairs)
    assertEquals(afterDelay.players(0).hasPassed, false)
    assertEquals(afterDelay.promptedPlayerIds, Set("p0"))
    assertEquals(PlayerGameView.forViewer(afterDelay, "p0").promptedPlayerIds, Vector("p0"))

    // The auto-pass is recorded like any other move.
    val replay = room.replay.get.unsafeRunSync()
    val recorded = (replay.moves ++ replay.skippedMoves).map(_.action)
    assert(recorded.contains(GameAction.PassTurn("p2")), recorded.toString)
  }

  test("a surrendered bout resolves one second after its last thrower is auto-passed") {
    val room = newRoom(players = 2, turnSeconds = 15)
    val now = System.currentTimeMillis()
    // p0 holds nothing matching the six, so the whole bout waits on its pass.
    val waiting = state(
      Vector(
        player("p0", List(card(Rank.Ace, Suit.Clubs), card(Rank.King, Suit.Clubs))),
        player("p1", List(card(Rank.Seven, Suit.Spades), card(Rank.Eight, Suit.Spades)))
      ),
      tablePairs = Vector(TablePair(six)),
      boutPhase = BoutPhase.SurrenderThrowIn,
      defenderInitialHandSize = 6,
      turnDeadlineMs = now + 15_000L
    )
    room.stateRef.set(waiting).unsafeRunSync()

    // The straddling cards stay on the table for the delay.
    assertEquals(room.stateRef.get.unsafeRunSync().tablePairs, Vector(TablePair(six)))

    val settled = awaitState(room, 5.seconds)(_.tablePairs.isEmpty)
    GameActor.stopClock(room).unsafeRunSync()

    assertEquals(settled.boutPhase, BoutPhase.InitialAttack)
    assert(settled.players(1).hand.contains(six), settled.players(1).hand.toString)
  }

  test("the delayed auto-pass honours the room's configured noThrowInAutoPassDelay") {
    val room = GameActor
      .create(
        GameConfig(playerCount = 2, seed = 9L),
        Vector("Alice", "Bob"),
        turnSeconds = 15,
        noThrowInAutoPassDelay = 100.millis
      )
      .unsafeRunSync()
    val now = System.currentTimeMillis()
    val waiting = state(
      Vector(
        player("p0", List(card(Rank.Ace, Suit.Clubs))),
        player("p1", List(card(Rank.Seven, Suit.Spades)))
      ),
      tablePairs = Vector(TablePair(six)),
      boutPhase = BoutPhase.SurrenderThrowIn,
      defenderInitialHandSize = 6,
      turnDeadlineMs = now + 15_000L
    )
    assertEquals(room.noThrowInAutoPassDelay, 100.millis)
    room.stateRef.set(waiting).unsafeRunSync()
    val startedAt = System.currentTimeMillis()

    val settled = awaitState(room, 5.seconds)(_.tablePairs.isEmpty)
    val elapsedMs = System.currentTimeMillis() - startedAt
    GameActor.stopClock(room).unsafeRunSync()

    assert(elapsedMs < 900L, s"the configured auto-pass delay was ignored: ${elapsedMs}ms")
    assertEquals(settled.boutPhase, BoutPhase.InitialAttack)
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

    val replay = room.replay.get.unsafeRunSync()
    // Both waiters were passed, but only the pass that cleared the table is a
    // visible replay step; the redundant one is kept as bookkeeping only.
    val applied = (replay.moves ++ replay.skippedMoves).map(_.action)
    assert(applied.contains(GameAction.PassTurn("p0")), applied.toString)
    assert(applied.contains(GameAction.PassTurn("p2")), applied.toString)
    assert(
      !replay.moves.map(_.action).contains(GameAction.PassTurn("p0")),
      replay.moves.map(_.action).toString
    )
    assert(
      replay.frames.forall(frame =>
        frame.action.forall {
          case GameAction.PassTurn(_) => frame.state.tablePairs.isEmpty
          case _                      => true
        }
      ),
      replay.frames.map(_.action).toString
    )
  }

  test("the clock still settles a bout whose throwers were all passed already") {
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

  // --- T-90-feedback-20261106_161731-1: multi-card throw-in clock parity ---

  test("a multi-card throw-in restarts the clock exactly like a single-card throw-in") {
    val singleRoom = newRoom(players = 3)
    val multiRoom = newRoom(players = 3)
    val base = state(
      Vector(
        player(
          "p0",
          List(
            card(Rank.Seven, Suit.Hearts),
            card(Rank.Seven, Suit.Diamonds),
            card(Rank.Ace, Suit.Clubs)
          )
        ),
        player("p1", List(card(Rank.Eight, Suit.Spades), card(Rank.Nine, Suit.Spades))),
        player("p2", List(card(Rank.King, Suit.Diamonds)))
      ),
      tablePairs = Vector(TablePair(card(Rank.Seven, Suit.Spades))),
      boutPhase = BoutPhase.SurrenderThrowIn,
      defenderInitialHandSize = 3
    )
    singleRoom.stateRef.set(base).unsafeRunSync()
    multiRoom.stateRef.set(base).unsafeRunSync()

    val before = System.currentTimeMillis()
    val single = GameActor
      .applyAction(singleRoom, GameAction.ThrowInCards("p0", List(card(Rank.Seven, Suit.Hearts))))
      .unsafeRunSync()
      .getOrElse(fail("expected a legal single-card throw-in"))
    val multi = GameActor
      .applyAction(
        multiRoom,
        GameAction.ThrowInCards(
          "p0",
          List(card(Rank.Seven, Suit.Hearts), card(Rank.Seven, Suit.Diamonds))
        )
      )
      .unsafeRunSync()
      .getOrElse(fail("expected a legal multi-card throw-in"))
    GameActor.stopClock(singleRoom).unsafeRunSync()
    GameActor.stopClock(multiRoom).unsafeRunSync()

    // Both keep the same surrender window open for the same seats and both
    // restart the throw-in clock on the move itself.
    assertEquals(single.boutPhase, BoutPhase.SurrenderThrowIn)
    assertEquals(multi.boutPhase, BoutPhase.SurrenderThrowIn)
    assertEquals(single.promptedPlayerIds, multi.promptedPlayerIds)
    assertEquals(single.promptedPlayerIds, Set("p0", "p2"))
    assert(single.turnDeadlineMs > before, single.turnDeadlineMs.toString)
    assert(multi.turnDeadlineMs > before, multi.turnDeadlineMs.toString)
    // The single-card throw-in leaves Alice one more matching card, while the
    // two-card throw-in spends both; the waiting seats are unchanged.
    assertEquals(GameEngine.canPlayerThrowIn(single, 0), true)
    assertEquals(GameEngine.canPlayerThrowIn(multi, 0), false)
    assertEquals(single.players(2).hasPassed, false)
    assertEquals(multi.players(2).hasPassed, false)
  }
