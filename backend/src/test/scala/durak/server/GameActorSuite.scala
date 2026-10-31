package durak.server

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import durak.engine.*
import fs2.Stream

import scala.concurrent.duration.*

class GameActorSuite extends munit.FunSuite:

  private def newRoom(seed: Long = 7L): GameRoom =
    GameActor
      .create(GameConfig(playerCount = 2, seed = seed), Vector("Alice", "Bob"))
      .unsafeRunSync()

  private def newRoomAt(nowMs: Long): GameRoom =
    GameActor
      .createAt(GameConfig(playerCount = 2, seed = 7L), Vector("Alice", "Bob"), nowMs)
      .unsafeRunSync()

  private def card(rank: Rank, suit: Suit): Card = Card(suit, rank)

  test("a created room starts in the initial attack phase with both seats") {
    val room = newRoom()
    val state = room.stateRef.get.unsafeRunSync()

    assert(room.gameId.nonEmpty)
    assertEquals(room.playerIds, Vector("p0", "p1"))
    assertEquals(state.players.map(_.id), Vector("p0", "p1"))
    assertEquals(state.players.map(_.hand.size), Vector(6, 6))
    assertEquals(state.boutPhase, BoutPhase.InitialAttack)
  }

  test("every room gets its own unique game id") {
    assertNotEquals(newRoom().gameId, newRoom().gameId)
  }

  test("a valid initial attack updates the room state") {
    val room = newRoom()
    val before = room.stateRef.get.unsafeRunSync()
    val attacker = before.players(before.attackerIdx)
    val attack = List(attacker.hand.head)

    val result = GameActor
      .applyAction(room, GameAction.InitialAttack(attacker.id, attack))
      .unsafeRunSync()

    val after = result.getOrElse(fail(s"initial attack was rejected: $result"))
    assertEquals(after.boutPhase, BoutPhase.Defense)
    assertEquals(after.tablePairs.map(_.attack).toList, attack)
    assertEquals(room.stateRef.get.unsafeRunSync(), after)
  }

  test("a successful action publishes the new state to the topic") {
    val room = newRoom()
    val before = room.stateRef.get.unsafeRunSync()
    val attacker = before.players(before.attackerIdx)
    val action = GameAction.InitialAttack(attacker.id, List(attacker.hand.head))

    val published = room.topic
      .subscribe(16)
      .take(1)
      .concurrently(
        Stream.eval(IO.sleep(100.millis) *> GameActor.applyAction(room, action).void)
      )
      .compile
      .last
      .unsafeRunSync()

    assertEquals(published.map(_.boutPhase), Some(BoutPhase.Defense))
    assertEquals(
      published.map(_.tablePairs.map(_.attack).toList),
      Some(List(attacker.hand.head))
    )
  }

  test("an invalid action is rejected and leaves the state unchanged") {
    val room = newRoom()
    val before = room.stateRef.get.unsafeRunSync()
    val defender = before.players(before.defenderIdx)

    val result = GameActor
      .applyAction(room, GameAction.CoverCard(defender.id, 0, defender.hand.head))
      .unsafeRunSync()

    assert(result.isLeft, s"covering with no attack should fail, got $result")
    assertEquals(room.stateRef.get.unsafeRunSync(), before)
  }

  // --- 15-second turn clock ---

  test("a created room gives the opening attacker a full 15-second clock") {
    val now = 1_000_000L
    val room = newRoomAt(now)
    val state = room.stateRef.get.unsafeRunSync()

    assertEquals(state.turnDeadlineMs, now + GameState.TurnDurationMs)
    assertEquals(PlayerGameView.forViewer(state, "p0", now).turnSecondsRemaining, 15)
  }

  test("every accepted action resets the turn clock to 15 seconds") {
    val now = 2_000_000L
    val room = newRoomAt(now)
    val start = room.stateRef.get.unsafeRunSync()
    val attacker = start.players(start.attackerIdx)
    val actionAt = now + 5_000L

    val result = GameActor
      .applyActionAt(room, GameAction.InitialAttack(attacker.id, List(attacker.hand.head)), actionAt)
      .unsafeRunSync()

    val state = result.getOrElse(fail(s"attack was rejected: $result"))
    assertEquals(state.turnDeadlineMs, actionAt + GameState.TurnDurationMs)
    assertEquals(PlayerGameView.forViewer(state, attacker.id, actionAt).turnSecondsRemaining, 15)
    assertEquals(
      PlayerGameView.forViewer(state, attacker.id, actionAt + 14_000L).turnSecondsRemaining,
      1
    )
  }

  test("a rejected action leaves the turn clock untouched") {
    val now = 3_000_000L
    val room = newRoomAt(now)
    val before = room.stateRef.get.unsafeRunSync()

    val result =
      GameActor.applyActionAt(room, GameAction.PassTurn("p0"), now + 5_000L).unsafeRunSync()

    assert(result.isLeft, result)
    assertEquals(room.stateRef.get.unsafeRunSync().turnDeadlineMs, before.turnDeadlineMs)
  }

  test("a timeout plays a random legal attack card and restarts the clock") {
    val now = 4_000_000L
    val room = newRoomAt(now)
    val start = room.stateRef.get.unsafeRunSync()

    assertEquals(GameActor.tick(room, now + 5_000L, Duration.Zero).unsafeRunSync(), None)

    val after = GameActor
      .tick(room, now + GameState.TurnDurationMs, Duration.Zero)
      .unsafeRunSync()
      .getOrElse(fail("the timeout did not play a default attack"))

    assertEquals(after.boutPhase, BoutPhase.Defense)
    assertEquals(after.tablePairs.size, 1)
    assert(
      start.players(start.attackerIdx).hand.contains(after.tablePairs.head.attack),
      s"${after.tablePairs.head.attack} was not in the attacker's hand"
    )
    assertEquals(after.turnDeadlineMs, now + 2 * GameState.TurnDurationMs)
  }

  test("a timeout makes the defender surrender") {
    val now = 5_000_000L
    val room = newRoomAt(now)
    val start = room.stateRef.get.unsafeRunSync()
    val attacker = start.players(start.attackerIdx)

    GameActor
      .applyActionAt(room, GameAction.InitialAttack(attacker.id, List(attacker.hand.head)), now)
      .unsafeRunSync()
      .getOrElse(fail("attack was rejected"))

    val after = GameActor
      .tick(room, now + GameState.TurnDurationMs, Duration.Zero)
      .unsafeRunSync()
      .getOrElse(fail("the timeout did not make the defender act"))

    assertEquals(after.boutPhase, BoutPhase.SurrenderThrowIn)
  }

  test("a timeout makes a non-defender pass once the table is covered") {
    val now = 6_000_000L
    val covered = GameState(
      config = GameConfig(playerCount = 3, seed = 11L),
      players = Vector(
        PlayerState("p0", "Alice", Vector(card(Rank.Nine, Suit.Clubs))),
        PlayerState("p1", "Bob", Vector(card(Rank.Eight, Suit.Hearts))),
        PlayerState("p2", "Cara", Vector(card(Rank.Seven, Suit.Spades)))
      ),
      talon = Vector.empty,
      trumpSuit = Suit.Spades,
      bottomTrumpCard = None,
      discardPile = Vector.empty,
      tablePairs = Vector(
        TablePair(card(Rank.Six, Suit.Hearts), Some(card(Rank.Seven, Suit.Hearts)))
      ),
      attackerIdx = 0,
      defenderIdx = 1,
      boutPhase = BoutPhase.Defense,
      defenderInitialHandSize = 6,
      finishOrder = Vector.empty,
      turnDeadlineMs = now + GameState.TurnDurationMs
    )
    val room = newRoomAt(now)
    room.stateRef.set(covered).unsafeRunSync()

    val after = GameActor
      .tick(room, now + GameState.TurnDurationMs, Duration.Zero)
      .unsafeRunSync()
      .getOrElse(fail("the timeout did not make a non-defender pass"))

    assert(after.players(0).hasPassed, after.players.map(_.hasPassed))
    assert(!after.players(2).hasPassed, after.players.map(_.hasPassed))
  }

  test("automatic follow-ups wait before changing the table") {
    assertEquals(GameActor.AutoActionDelay, 3.seconds)

    val now = 7_000_000L
    val stuck = GameState(
      config = GameConfig(playerCount = 2, seed = 7L),
      players = Vector(
        PlayerState("p0", "Alice", Vector(card(Rank.Nine, Suit.Clubs))),
        // Seven of clubs cannot cover a six of hearts, and the attacker cannot
        // take a two-card redirect, so the defender has no legal move.
        PlayerState("p1", "Bob", Vector(card(Rank.Seven, Suit.Clubs)))
      ),
      talon = Vector.empty,
      trumpSuit = Suit.Spades,
      bottomTrumpCard = None,
      discardPile = Vector.empty,
      tablePairs = Vector(TablePair(card(Rank.Six, Suit.Hearts))),
      attackerIdx = 0,
      defenderIdx = 1,
      boutPhase = BoutPhase.Defense,
      defenderInitialHandSize = 1,
      finishOrder = Vector.empty,
      turnDeadlineMs = now + GameState.TurnDurationMs
    )
    val room = newRoomAt(now)
    room.stateRef.set(stuck).unsafeRunSync()

    assert(GameEngine.pendingAutoAction(stuck).isDefined)

    val fiber = GameActor.settleAutoActions(room, now, 300.millis).start.unsafeRunSync()
    IO.sleep(50.millis).unsafeRunSync()
    assertEquals(room.stateRef.get.unsafeRunSync().boutPhase, BoutPhase.Defense)

    val applied = fiber.joinWithNever.unsafeRunSync()
    assertEquals(applied.map(_.boutPhase), Some(BoutPhase.SurrenderThrowIn))
  }

  test("attack, cover and pass advance the game to the next bout") {
    val room = newRoom()
    val start = room.stateRef.get.unsafeRunSync()
    val attacker = start.players(start.attackerIdx)
    val defender = start.players(start.defenderIdx)

    def covers(attack: Card, defense: Card): Boolean =
      (defense.suit == attack.suit && defense.rank.value > attack.rank.value) ||
        (defense.suit == start.trumpSuit && attack.suit != start.trumpSuit)

    val pairing = (for
      attack <- attacker.hand
      defense <- defender.hand
      if covers(attack, defense)
    yield (attack, defense)).headOption

    val (attackCard, defenseCard) =
      pairing.getOrElse(fail("seed 7 produced no coverable opening attack"))

    val attacked = GameActor
      .applyAction(room, GameAction.InitialAttack(attacker.id, List(attackCard)))
      .unsafeRunSync()
      .getOrElse(fail("initial attack was rejected"))
    assertEquals(attacked.boutPhase, BoutPhase.Defense)

    val covered = GameActor
      .applyAction(room, GameAction.CoverCard(defender.id, 0, defenseCard))
      .unsafeRunSync()
      .getOrElse(fail("cover was rejected"))
    assertEquals(covered.tablePairs.head.defense, Some(defenseCard))

    val resolved = GameActor
      .applyAction(room, GameAction.PassTurn(attacker.id))
      .unsafeRunSync()
      .getOrElse(fail("pass was rejected"))

    assertEquals(resolved.tablePairs, Vector.empty)
    assertEquals(resolved.boutPhase, BoutPhase.InitialAttack)
    assertEquals(resolved.attackerIdx, start.defenderIdx)
    assertEquals(room.stateRef.get.unsafeRunSync(), resolved)
  }
