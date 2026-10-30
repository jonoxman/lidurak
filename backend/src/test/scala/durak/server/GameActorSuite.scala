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
