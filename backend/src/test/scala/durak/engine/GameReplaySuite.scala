package durak.engine

import cats.effect.unsafe.implicits.global
import durak.server.{GameActor, GameRoom}
import io.circe.parser
import io.circe.syntax.*
import JsonCodecs.given

class GameReplaySuite extends munit.FunSuite:

  private def card(rank: Rank, suit: Suit = Suit.Spades): Card = Card(suit, rank)

  private def player(id: String, hand: List[Card]): PlayerState =
    PlayerState(id = id, name = id.toUpperCase, hand = hand.toVector)

  private def newRoom(players: Int = 2, seed: Long = 7L, turnSeconds: Int = 15): GameRoom =
    GameActor
      .create(
        GameConfig(playerCount = players, seed = seed),
        Vector.tabulate(players)(idx => s"P$idx"),
        turnSeconds
      )
      .unsafeRunSync()

  private def applyAction(room: GameRoom, action: GameAction): GameState =
    GameActor.applyAction(room, action).unsafeRunSync() match
      case Right(next) => next
      case Left(error) => fail(s"$action was rejected: $error")

  private def replayOf(room: GameRoom): SerializedGame = room.replay.get.unsafeRunSync()

  /** The first attack/defense pairing the deal allows, for a scripted bout. */
  private def coverablePairing(state: GameState): (Card, Card) =
    val attacker = state.players(state.attackerIdx)
    val defender = state.players(state.defenderIdx)
    (for
      attack <- attacker.hand
      defense <- defender.hand
      if defense.covers(attack, state.trumpSuit)
    yield (attack, defense)).headOption.getOrElse(fail("this deal has no coverable opening attack"))

  /** A three-player bout where `p2` holds two cards matching the table rank. */
  private def pairedThrowInTable(room: GameRoom): GameState =
    val six = card(Rank.Six, Suit.Spades)
    val sixHearts = card(Rank.Six, Suit.Hearts)
    val sixDiamonds = card(Rank.Six, Suit.Diamonds)
    val base = GameEngine
      .createGame(GameConfig(playerCount = 3, seed = 5L), Vector("P0", "P1", "P2"))
      .copy(
        players = Vector(
          player("p0", List(card(Rank.Ace, Suit.Clubs), card(Rank.King, Suit.Clubs))),
          player(
            "p1",
            List(
              card(Rank.Seven, Suit.Spades),
              card(Rank.Eight, Suit.Spades),
              card(Rank.Nine, Suit.Spades)
            )
          ),
          player("p2", List(sixHearts, sixDiamonds, card(Rank.King, Suit.Diamonds)))
        ),
        talon = Vector.empty,
        bottomTrumpCard = None,
        tablePairs = Vector(TablePair(six)),
        attackerIdx = 0,
        defenderIdx = 1,
        boutPhase = BoutPhase.Defense,
        defenderInitialHandSize = 3,
        turnDeadlineMs = 0L
      )
    room.stateRef.set(base).unsafeRunSync()
    base

  // --- The deal frame ---

  test("a fresh replay holds only the deal frame with one frozen view per seat") {
    val room = newRoom()
    val replay = replayOf(room)
    GameActor.stopClock(room).unsafeRunSync()

    assertEquals(replay.gameId, room.gameId)
    assertEquals(replay.moves, Vector.empty)
    assertEquals(replay.frames.size, 1)

    val deal = replay.frames.head
    assertEquals(deal.moveIndex, 0)
    assertEquals(deal.playerId, None)
    assertEquals(deal.action, None)
    assertEquals(deal.elapsedMs, 0L)
    assertEquals(deal.state, replay.initialState)
    assertEquals(deal.views.keySet, Set("p0", "p1"))
    assertEquals(deal.views("p0").myHand, replay.initialState.players.head.hand.toList)
    assertEquals(deal.views("p0").gameStartedAtMs, Some(0L))
    assertEquals(deal.views("p0").gameEndedAtMs, Some(0L))
    assertEquals(deal.views("p0").turnDeadlineMs, 0L)
    assertEquals(deal.views("p0").turnSecondsRemaining, 0)
  }

  // --- Move recording ---

  test("every move is recorded with its index, seat, elapsed time and resulting state") {
    val room = newRoom()
    val start = room.stateRef.get.unsafeRunSync()
    val (attack, defense) = coverablePairing(start)

    val attacked = applyAction(
      room,
      GameAction.InitialAttack(start.players(start.attackerIdx).id, List(attack))
    )
    assertEquals(attacked.gameStartedAtMs.isDefined, true)
    assertEquals(attacked.gameEndedAtMs, None)

    // Backdate the overall timer so the next move's elapsed time is measurable.
    val backdated = attacked.copy(
      gameStartedAtMs = Some(attacked.gameStartedAtMs.getOrElse(0L) - 5000L)
    )
    room.stateRef.set(backdated).unsafeRunSync()

    val covered = applyAction(
      room,
      GameAction.CoverCard(start.players(start.defenderIdx).id, 0, defense)
    )
    GameActor.stopClock(room).unsafeRunSync()

    val replay = replayOf(room)
    assertEquals(replay.moves.map(_.moveIndex), Vector(1, 2))
    assertEquals(replay.moves.map(_.playerId), Vector(start.players(start.attackerIdx).id, start.players(start.defenderIdx).id))
    assertEquals(replay.moves.head.elapsedMs, 0L)
    assert(
      replay.moves(1).elapsedMs >= 5000L,
      s"the elapsed time was not measured from the game start: ${replay.moves(1).elapsedMs}"
    )
    assert(
      replay.moves(1).elapsedMs < 10_000L,
      s"suspicious elapsed time: ${replay.moves(1).elapsedMs}"
    )
    assertEquals(covered.gameStartedAtMs, backdated.gameStartedAtMs)
    assertEquals(replay.moves(1).stateAfter, covered)

    assertEquals(replay.frames.map(_.moveIndex), Vector(0, 1, 2))
    assertEquals(replay.frames(1).playerId, Some(start.players(start.attackerIdx).id))
    assertEquals(
      replay.frames(1).action,
      Some(GameAction.InitialAttack(start.players(start.attackerIdx).id, List(attack)))
    )
    assertEquals(replay.frames(2).state, covered)
    assertEquals(replay.frames(1).elapsedMs, 0L)
  }

  test("the game timer starts with the first move and survives later moves") {
    val room = newRoom()
    assertEquals(room.stateRef.get.unsafeRunSync().gameStartedAtMs, None)

    val start = room.stateRef.get.unsafeRunSync()
    val (attack, _) = coverablePairing(start)
    val attacked = applyAction(
      room,
      GameAction.InitialAttack(start.players(start.attackerIdx).id, List(attack))
    )
    GameActor.stopClock(room).unsafeRunSync()

    assert(attacked.gameStartedAtMs.isDefined, "the first move must start the game clock")
    val view = PlayerGameView.forViewer(attacked, "p0")
    assertEquals(view.gameStartedAtMs, attacked.gameStartedAtMs)
    assertEquals(view.gameEndedAtMs, None)
  }

  test("a move that ends the game also stops the overall timer") {
    val room = newRoom()
    val attack = card(Rank.Six, Suit.Spades)
    val cover = card(Rank.Seven, Suit.Spades)
    val finalBout = GameEngine
      .createGame(GameConfig(playerCount = 2, seed = 7L), Vector("P0", "P1"))
      .copy(
        // Both players hold nothing: their last cards are already on the table,
        // so the successful defense ends the game in a draw.
        players = Vector(
          player("p0", Nil),
          player("p1", Nil)
        ),
        talon = Vector.empty,
        bottomTrumpCard = None,
        tablePairs = Vector(TablePair(attack, Some(cover))),
        attackerIdx = 0,
        defenderIdx = 1,
        boutPhase = BoutPhase.Defense,
        defenderInitialHandSize = 1,
        turnDeadlineMs = 0L
      )
    room.stateRef.set(finalBout).unsafeRunSync()

    val settled = applyAction(room, GameAction.PassTurn("p0"))
    GameActor.stopClock(room).unsafeRunSync()

    assertEquals(settled.boutPhase, BoutPhase.GameOver)
    assert(settled.gameStartedAtMs.isDefined, "the first move must start the game clock")
    assert(settled.gameEndedAtMs.isDefined, "game over must stop the game clock")
    assert(
      settled.gameEndedAtMs.getOrElse(0L) >= settled.gameStartedAtMs.getOrElse(0L),
      s"the game ended before it started: ${settled.gameStartedAtMs} -> ${settled.gameEndedAtMs}"
    )
    assertEquals(
      PlayerGameView.forViewer(settled, "p0").gameEndedAtMs,
      settled.gameEndedAtMs
    )
  }

  // --- Paired / rapid throw-ins ---

  test("a multi-card throw-in is recorded as one atomic move per card") {
    val room = newRoom(players = 3, seed = 5L)
    pairedThrowInTable(room)

    val sixHearts = card(Rank.Six, Suit.Hearts)
    val sixDiamonds = card(Rank.Six, Suit.Diamonds)
    val after = applyAction(room, GameAction.ThrowInCards("p2", List(sixHearts, sixDiamonds)))
    GameActor.stopClock(room).unsafeRunSync()

    val replay = replayOf(room)
    assertEquals(replay.moves.map(_.moveIndex), Vector(1, 2))
    assertEquals(
      replay.moves.map(_.action),
      Vector(
        GameAction.ThrowInCards("p2", List(sixHearts)),
        GameAction.ThrowInCards("p2", List(sixDiamonds))
      )
    )
    assertEquals(replay.moves.map(_.playerId), Vector("p2", "p2"))
    assertEquals(replay.moves.head.stateAfter.tablePairs.size, 2)
    assertEquals(replay.moves(1).stateAfter.tablePairs.size, 3)
    assertEquals(after.tablePairs.size, 3)
    assertEquals(after.players(2).hand, Vector(card(Rank.King, Suit.Diamonds)))
  }

  test("two quick single-card throw-ins are recorded as separate moves") {
    val room = newRoom(players = 3, seed = 5L)
    pairedThrowInTable(room)

    val sixHearts = card(Rank.Six, Suit.Hearts)
    val sixDiamonds = card(Rank.Six, Suit.Diamonds)
    applyAction(room, GameAction.ThrowInCards("p2", List(sixHearts)))
    val afterSecond = applyAction(room, GameAction.ThrowInCards("p2", List(sixDiamonds)))
    GameActor.stopClock(room).unsafeRunSync()

    val replay = replayOf(room)
    assertEquals(replay.moves.map(_.moveIndex), Vector(1, 2))
    assertEquals(replay.moves.map(_.playerId), Vector("p2", "p2"))
    assertEquals(replay.moves.head.stateAfter.tablePairs.size, 2)
    assertEquals(replay.moves(1).stateAfter.tablePairs.size, 3)
    assertEquals(afterSecond.tablePairs.map(_.attack).takeRight(2), Vector(sixHearts, sixDiamonds))
  }

  test("a multi-card throw-in recorded as one action replays deterministically") {
    val room = newRoom(players = 3, seed = 5L)
    val start = pairedThrowInTable(room)
    val sixHearts = card(Rank.Six, Suit.Hearts)
    val sixDiamonds = card(Rank.Six, Suit.Diamonds)
    val action = GameAction.ThrowInCards("p2", List(sixHearts, sixDiamonds))
    val next = GameEngine
      .applyAction(start, action)
      .getOrElse(fail("expected a legal multi-card throw-in"))

    val replay = GameReplay.appendMove(GameReplay.initial(room.gameId, start), action, next, 1L)
    GameActor.stopClock(room).unsafeRunSync()

    assertEquals(replay.moves.size, 1)
    assertEquals(replay.moves.head.action, action)
    assertEquals(replay.moves.head.stateAfter.tablePairs.size, 3)

    val verified = GameReplay.verifyReplay(replay)
    assert(verified.isRight, verified)
    assertEquals(verified.map(_.size), Right(2))
    assertEquals(verified.map(_.last.tablePairs), Right(next.tablePairs))
  }

  // --- Serialization & verification ---

  test("the serialized game round-trips through JSON and replays deterministically") {
    val room = newRoom()
    val start = room.stateRef.get.unsafeRunSync()
    val (attack, defense) = coverablePairing(start)
    val attackerId = start.players(start.attackerIdx).id
    val defenderId = start.players(start.defenderIdx).id

    applyAction(room, GameAction.InitialAttack(attackerId, List(attack)))
    applyAction(room, GameAction.CoverCard(defenderId, 0, defense))
    applyAction(room, GameAction.PassTurn(attackerId))
    GameActor.stopClock(room).unsafeRunSync()

    val replay = replayOf(room)
    assertEquals(replay.moves.size, 3)

    val decoded = parser
      .decode[SerializedGame](replay.asJson.noSpaces)
      .fold(error => fail(error.getMessage), identity)
    assertEquals(decoded, replay)

    val verified = GameReplay.verifyReplay(decoded)
    assert(verified.isRight, verified)
    assertEquals(verified.map(_.size), Right(4))
    verified.foreach { states =>
      assertEquals(states.last.tablePairs, replay.moves.last.stateAfter.tablePairs)
      assertEquals(states.last.discardPile, replay.moves.last.stateAfter.discardPile)
      assertEquals(states.last.boutPhase, replay.moves.last.stateAfter.boutPhase)
      assertEquals(states.last.players, replay.moves.last.stateAfter.players)
    }

    replay.frames.foreach { frame =>
      assertEquals(frame.views.keySet, Set("p0", "p1"))
      frame.views.values.foreach { view =>
        assertEquals(view.turnDeadlineMs, 0L)
        assertEquals(view.turnSecondsRemaining, 0)
        assertEquals(view.gameStartedAtMs, Some(0L))
        assertEquals(view.gameEndedAtMs, Some(frame.elapsedMs))
      }
    }
  }

  test("verifyReplay rejects a history whose recorded state was tampered with") {
    val room = newRoom()
    val start = room.stateRef.get.unsafeRunSync()
    val (attack, _) = coverablePairing(start)
    applyAction(room, GameAction.InitialAttack(start.players(start.attackerIdx).id, List(attack)))
    GameActor.stopClock(room).unsafeRunSync()

    val replay = replayOf(room)
    assertEquals(replay.moves.size, 1)
    assertEquals(GameReplay.verifyReplay(replay).map(_.size), Right(2))

    val tampered = replay.copy(
      moves = replay.moves.updated(
        0,
        replay.moves.head.copy(
          stateAfter = replay.moves.head.stateAfter.copy(
            discardPile = Vector(card(Rank.Ace, Suit.Hearts))
          )
        )
      )
    )

    assert(GameReplay.verifyReplay(tampered).isLeft, "a tampered state must not verify")
  }

  test("verifyReplay rejects a history with a gap in its move indices") {
    val room = newRoom()
    val start = room.stateRef.get.unsafeRunSync()
    val (attack, _) = coverablePairing(start)
    applyAction(room, GameAction.InitialAttack(start.players(start.attackerIdx).id, List(attack)))
    GameActor.stopClock(room).unsafeRunSync()

    val replay = replayOf(room)
    val gapped = replay.copy(moves = replay.moves.updated(0, replay.moves.head.copy(moveIndex = 2)))

    assert(GameReplay.verifyReplay(gapped).isLeft, "a gap in the indices must not verify")
  }

  // --- Finished games in the recorded history (feedback items 9 / 12) ---

  test("the final frame of a finished game freezes a GameOver view for every seat") {
    val room = newRoom()
    val attack = card(Rank.Six, Suit.Spades)
    val cover = card(Rank.Seven, Suit.Spades)
    val finalBout = GameEngine
      .createGame(GameConfig(playerCount = 2, seed = 7L), Vector("P0", "P1"))
      .copy(
        // Both hands are empty: the covered bout is the last of the match.
        players = Vector(player("p0", Nil), player("p1", Nil)),
        talon = Vector.empty,
        bottomTrumpCard = None,
        tablePairs = Vector(TablePair(attack, Some(cover))),
        attackerIdx = 0,
        defenderIdx = 1,
        boutPhase = BoutPhase.Defense,
        defenderInitialHandSize = 1,
        turnDeadlineMs = 0L
      )
    room.stateRef.set(finalBout).unsafeRunSync()

    val finished = applyAction(room, GameAction.PassTurn("p0"))
    GameActor.stopClock(room).unsafeRunSync()
    assertEquals(finished.boutPhase, BoutPhase.GameOver)

    val replay = replayOf(room)
    val last = replay.frames.last
    assertEquals(last.state.boutPhase, BoutPhase.GameOver)
    assertEquals(last.views.keySet, Set("p0", "p1"))
    last.views.foreach { case (seat, view) =>
      assertEquals(seat, view.myId)
      assertEquals(view.boutPhase, BoutPhase.GameOver)
      assertEquals(view.legalActions, List.empty)
      assertEquals(view.promptedPlayerIds, Vector.empty)
      assertEquals(view.turnPlayerId, None)
      assertEquals(view.turnDeadlineMs, 0L)
      assertEquals(view.turnSecondsRemaining, 0)
      assertEquals(view.gameEndedAtMs, Some(last.elapsedMs))
    }
    // `verifyReplay` re-derives the history from the deal frame, so it only
    // applies to games played out from the deal; this one starts from a
    // scripted final position. The recorded finish must still round-trip.

    val decoded = parser
      .decode[SerializedGame](replay.asJson.noSpaces)
      .fold(error => fail(error.getMessage), identity)
    assertEquals(decoded.frames.last.state.boutPhase, BoutPhase.GameOver)
    assertEquals(decoded.frames.last.views("p0").boutPhase, BoutPhase.GameOver)
  }

  test("a four-seat finished game projects every seat and every frozen view") {
    val finished = GameEngine
      .createGame(GameConfig(playerCount = 4, seed = 21L), Vector("P0", "P1", "P2", "P3"))
      .copy(
        players = Vector.tabulate(4)(idx => player(s"p$idx", Nil).copy(finishRank = Some(idx + 1))),
        talon = Vector.empty,
        bottomTrumpCard = None,
        tablePairs = Vector.empty,
        boutPhase = BoutPhase.GameOver,
        defenderInitialHandSize = 0,
        defenderIdx = 0,
        attackerIdx = 1,
        finishOrder = Vector("p0", "p1", "p2", "p3"),
        isDraw = true,
        turnDeadlineMs = 5_000L,
        gameEndedAtMs = Some(4_200L)
      )

    finished.players.foreach { seat =>
      val view = PlayerGameView.forViewer(finished, seat.id)
      assertEquals(view.boutPhase, BoutPhase.GameOver)
      assertEquals(view.legalActions, List.empty)
      assertEquals(view.turnDeadlineMs, 0L)
      assertEquals(view.gameEndedAtMs, Some(4_200L))
    }

    val views = GameReplay.frozenViews(finished, 1_234L)
    assertEquals(views.keySet, Set("p0", "p1", "p2", "p3"))
    views.values.foreach { view =>
      assertEquals(view.boutPhase, BoutPhase.GameOver)
      assertEquals(view.legalActions, List.empty)
      assertEquals(view.turnDeadlineMs, 0L)
    }
  }
