package durak.server

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import durak.engine.*
import fs2.Stream

import scala.concurrent.duration.*

class GameActorSuite extends munit.FunSuite:

  private def newRoom(
      seed: Long = 7L,
      turnSeconds: Int = GameActor.DefaultTurnSeconds
  ): GameRoom =
    GameActor
      .create(GameConfig(playerCount = 2, seed = seed), Vector("Alice", "Bob"), turnSeconds)
      .unsafeRunSync()

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

  test("game ids are exactly 8 alphanumeric characters") {
    val ids = (1 to 20).map(_ => GameManager.generateGameId()) :+ newRoom().gameId

    ids.foreach { id =>
      assertEquals(id.length, 8, s"game id is not 8 characters: $id")
      assert(id.matches("^[A-Za-z0-9]{8}$"), s"game id is not alphanumeric: $id")
    }
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

  // --- Turn clock ---

  test("a new room starts with a running turn clock on the acting player") {
    val room = newRoom()
    val state = room.stateRef.get.unsafeRunSync()
    GameActor.stopClock(room).unsafeRunSync()

    assert(state.turnDeadlineMs > 0L, s"clock not started: ${state.turnDeadlineMs}")
    assertEquals(state.turnPlayerId, state.players.lift(state.attackerIdx).map(_.id))
  }

  test("every valid action restarts the turn clock for the next player") {
    val room = newRoom()
    val start = room.stateRef.get.unsafeRunSync()
    val attacker = start.players(start.attackerIdx)

    IO.sleep(30.millis).unsafeRunSync()
    val after = GameActor
      .applyAction(room, GameAction.InitialAttack(attacker.id, List(attacker.hand.head)))
      .unsafeRunSync()
      .getOrElse(fail("initial attack was rejected"))
    GameActor.stopClock(room).unsafeRunSync()

    assert(
      after.turnDeadlineMs > start.turnDeadlineMs,
      s"clock did not restart: ${after.turnDeadlineMs} vs ${start.turnDeadlineMs}"
    )
    assertEquals(after.turnPlayerId, Some(start.players(start.defenderIdx).id))
  }

  test("an expired turn clock auto-plays a legal move and broadcasts it") {
    val room = newRoom(turnSeconds = 1)
    val start = room.stateRef.get.unsafeRunSync()

    val broadcast = room.topic
      .subscribe(16)
      .take(1)
      .concurrently(Stream.eval(IO.sleep(2500.millis)))
      .compile
      .last
      .unsafeRunSync()
    val after = room.stateRef.get.unsafeRunSync()
    GameActor.stopClock(room).unsafeRunSync()

    assertEquals(start.boutPhase, BoutPhase.InitialAttack)
    // The attacker attacks on expiry, so the bout moves on to defense.
    assertEquals(after.boutPhase, BoutPhase.Defense)
    assertEquals(after.tablePairs.size, 1)
    assert(
      after.turnDeadlineMs > start.turnDeadlineMs,
      s"the auto-played move did not restart the clock: ${after.turnDeadlineMs}"
    )
    assertEquals(broadcast.map(_.boutPhase), Some(BoutPhase.Defense))
  }

  test("a defenseless defender is auto-surrendered once the grace period elapses") {
    val room = newRoom(turnSeconds = 15)
    val start = room.stateRef.get.unsafeRunSync()
    val now = System.currentTimeMillis()

    // A defender who can neither cover nor redirect: surrender is their only move.
    // The attack is a king whose suit the defender cannot beat with a low card.
    val defenderLowCard = Card(Suit.values.find(_ != start.trumpSuit).getOrElse(Suit.Clubs), Rank.Six)
    val desperate = start.copy(
      players = start.players.zipWithIndex.map { case (seat, idx) =>
        if idx == start.defenderIdx then seat.copy(hand = Vector(defenderLowCard))
        else seat.copy(hand = Vector(Card(Suit.Clubs, Rank.Ace)))
      },
      tablePairs = Vector(TablePair(Card(Suit.Clubs, Rank.King))),
      boutPhase = BoutPhase.Defense,
      // The turn started three seconds ago, so the grace period has just elapsed.
      turnDeadlineMs = now + 12_000L
    )
    assert(desperate.defenderIsDefenseless)
    room.stateRef.set(desperate).unsafeRunSync()

    val after = (IO.sleep(1000.millis) *> room.stateRef.get).unsafeRunSync()
    GameActor.stopClock(room).unsafeRunSync()

    assertEquals(after.boutPhase, BoutPhase.SurrenderThrowIn)
    assert(
      after.turnDeadlineMs > desperate.turnDeadlineMs,
      s"the auto-surrender did not restart the clock: ${after.turnDeadlineMs}"
    )
  }
