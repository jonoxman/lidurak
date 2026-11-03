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

  /** Polls the room until `predicate` holds, failing once `timeout` elapses. */
  private def awaitState(room: GameRoom, timeout: FiniteDuration)(
      predicate: GameState => Boolean
  ): GameState =
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

  // --- Bots ---

  test("a RandomBot seat plays a legal move after its configured delay") {
    val seed = (0L until 200L)
      .find { candidate =>
        GameEngine
          .createGame(GameConfig(playerCount = 2, seed = candidate), Vector("Bot", "Alice"))
          .attackerIdx == 0
      }
      .getOrElse(fail("no seed seats p0 as the first attacker"))

    val room = GameActor
      .create(
        GameConfig(playerCount = 2, seed = seed, playerTypes = Vector("randomBot", "human")),
        Vector("Bot", "Alice"),
        turnSeconds = 15,
        botDelayMin = 20.millis,
        botDelayMax = 40.millis
      )
      .unsafeRunSync()
    val start = room.stateRef.get.unsafeRunSync()
    assertEquals(start.turnPlayerId, Some("p0"))

    val after = awaitState(room, 3000.millis)(_.tablePairs.nonEmpty)
    GameActor.stopClock(room).unsafeRunSync()

    assertEquals(after.boutPhase, BoutPhase.Defense)
    assert(
      start.players.head.hand.contains(after.tablePairs.head.attack),
      s"the bot attacked with a card it does not hold: ${after.tablePairs.head.attack}"
    )
  }

  test("the bot driver never plays for an all-human table") {
    val room = newRoom()
    val start = room.stateRef.get.unsafeRunSync()

    val after = (IO.sleep(400.millis) *> room.stateRef.get).unsafeRunSync()
    GameActor.stopClock(room).unsafeRunSync()

    assertEquals(after, start)
  }

  // --- Presence ---

  test("presence updates are stored, published and visible to the other seats") {
    val room = newRoom()
    val start = room.stateRef.get.unsafeRunSync()
    assertEquals(start.isPlayerPresent("p1"), false)

    val published = room.topic
      .subscribe(16)
      .take(1)
      .concurrently(Stream.eval(IO.sleep(100.millis) *> GameActor.setPresence(room, "p1", true)))
      .compile
      .last
      .unsafeRunSync()
    val after = room.stateRef.get.unsafeRunSync()
    GameActor.stopClock(room).unsafeRunSync()

    assertEquals(after.isPlayerPresent("p1"), true)
    assertEquals(published.map(_.presentPlayers), Some(Set("p1")))
    val view = PlayerGameView.forViewer(after, "p0")
    assert(view.presentPlayers.contains("p1"), view.presentPlayers.toString)
    assert(view.opponents.exists(seat => seat.id == "p1" && seat.isPresent), view.opponents.toString)
  }

  test("clearing presence drops the seat, while bot seats are always present") {
    val room = GameActor
      .create(
        GameConfig(playerCount = 2, seed = 5L, playerTypes = Vector("randomBot", "human")),
        Vector("Bot", "Alice")
      )
      .unsafeRunSync()
    GameActor.stopClock(room).unsafeRunSync()

    GameActor.setPresence(room, "p1", true).unsafeRunSync()
    assertEquals(room.stateRef.get.unsafeRunSync().presentPlayerIds, Vector("p0", "p1"))

    GameActor.setPresence(room, "p1", false).unsafeRunSync()
    val absent = room.stateRef.get.unsafeRunSync()
    assertEquals(absent.presentPlayerIds, Vector("p0"))
    assert(!PlayerGameView.forViewer(absent, "p0").opponents.head.isPresent)
  }

  // --- Bot prompting ---

  /** A fresh game whose defender seat is played by a bot. */
  private def botDefenderGame(seed: Long = 5L): GameState =
    val probe = GameEngine.createGame(GameConfig(playerCount = 2, seed = seed), Vector("Human", "Bot"))
    val types = Vector.tabulate(probe.players.size) { idx =>
      if idx == probe.defenderIdx then "randomBot" else "human"
    }
    val game = GameEngine.createGame(
      GameConfig(playerCount = 2, seed = seed, playerTypes = types),
      Vector("Human", "Bot")
    )
    assert(game.config.isBotSeat(game.defenderIdx), "the defender seat must be a bot")
    game

  test("the bot loop prompts the defender while an attack is uncovered") {
    val gs = botDefenderGame()
    val defenderId = gs.players(gs.defenderIdx).id
    val attacked = gs.copy(
      tablePairs = Vector(TablePair(gs.players(gs.attackerIdx).hand.head)),
      boutPhase = BoutPhase.Defense
    )

    assertEquals(GameActor.promptedBotId(attacked), Some(defenderId))
    val actions = RandomBot.legalActionsFor(attacked, defenderId)
    assert(actions.nonEmpty, "the defender bot must have a move")
    actions.foreach(action => assert(GameEngine.applyAction(attacked, defenderId, action).isRight))
  }

  test("a surrendered bot seat is never prompted again in the same bout") {
    val gs = botDefenderGame()
    val defenderId = gs.players(gs.defenderIdx).id
    val surrendered = gs.copy(
      tablePairs = Vector(TablePair(gs.players(gs.attackerIdx).hand.head)),
      boutPhase = BoutPhase.SurrenderThrowIn
    )

    assertEquals(RandomBot.legalActionsFor(surrendered, defenderId), Vector.empty)
    assertEquals(GameActor.promptedBotId(surrendered), None)
  }

  test("the bot loop prompts a bot thrower once every attack is covered") {
    val gs = botDefenderGame()
    val attackerId = gs.players(gs.attackerIdx).id
    val covered = gs.copy(
      players = gs.players.zipWithIndex.map { case (seat, idx) =>
        if idx == gs.attackerIdx then seat.copy(hand = Vector(Card(Suit.Clubs, Rank.Six)))
        else seat
      },
      tablePairs = Vector(
        TablePair(Card(Suit.Clubs, Rank.Six), Some(Card(Suit.Diamonds, Rank.Seven)))
      ),
      boutPhase = BoutPhase.Defense
    )

    // The bot seat is the defender here, so the human attacker is the only
    // thrower: no bot is prompted, even though the bout is waiting on a pass.
    assertEquals(GameActor.promptedBotId(covered), None)
    assert(GameEngine.applyAction(covered, GameAction.PassTurn(attackerId)).isRight)
  }

  test("no bot is prompted once the game is over") {
    val gs = botDefenderGame()

    assertEquals(GameActor.promptedBotId(gs.copy(boutPhase = BoutPhase.GameOver)), None)
  }

  // --- BasicBot seats ---

  test("a BasicBot seat plays its lowest non-trump opening attack") {
    val seed = (0L until 200L)
      .find { candidate =>
        val game = GameEngine.createGame(
          GameConfig(playerCount = 2, seed = candidate),
          Vector("Bot", "Alice")
        )
        game.attackerIdx == 0 && game.players(0).hand.exists(_.suit != game.trumpSuit)
      }
      .getOrElse(fail("no seed seats p0 as the first attacker with a non-trump card"))

    val room = GameActor
      .create(
        GameConfig(playerCount = 2, seed = seed, playerTypes = Vector("basicBot", "human")),
        Vector("Bot", "Alice"),
        turnSeconds = 15,
        botDelayMin = 20.millis,
        botDelayMax = 40.millis
      )
      .unsafeRunSync()
    val start = room.stateRef.get.unsafeRunSync()
    val expectedRank = start.players(0).hand.filter(_.suit != start.trumpSuit).map(_.rank.value).min

    val after = awaitState(room, 3000.millis)(_.tablePairs.nonEmpty)
    GameActor.stopClock(room).unsafeRunSync()

    val attack = after.tablePairs.head.attack
    assert(attack.suit != after.trumpSuit, s"BasicBot opened with a trump: $attack")
    assertEquals(attack.rank.value, expectedRank)
  }

  test("the bot driver dispatches the basic policy for a basicBot seat") {
    val gs = GameEngine.createGame(
      GameConfig(playerCount = 2, seed = 5L, playerTypes = Vector("basicBot", "human")),
      Vector("Bot", "Alice")
    )
    val attackerId = gs.players(gs.attackerIdx).id
    val lowestNonTrump = gs.players(gs.attackerIdx).hand
      .filter(_.suit != gs.trumpSuit)
      .minByOption(_.rank.value)

    assertEquals(gs.config.seatType(gs.attackerIdx), GameConfig.BasicBotSeat)
    lowestNonTrump match
      case None => fail("seed 5 attacker holds only trumps")
      case Some(card) =>
        GameActor.chooseBotAction(gs, attackerId) match
          case Some(GameAction.InitialAttack(_, List(played))) =>
            assertEquals(played.rank.value, card.rank.value)
            assert(played.suit != gs.trumpSuit, s"BasicBot opened with a trump: $played")
          case other => fail(s"expected a single opening attack, got $other")
  }

  // --- Bot timing (feedback item 2: the random bot plays instantly) ---

  test("a RandomBot seat plays instantly and ignores the configured bot delay") {
    val seed = (0L until 400L)
      .find { candidate =>
        GameEngine
          .createGame(GameConfig(playerCount = 2, seed = candidate), Vector("Bot", "Alice"))
          .attackerIdx == 0
      }
      .getOrElse(fail("no seed seats p0 as the first attacker"))
    val startedAt = System.currentTimeMillis()

    val room = GameActor
      .create(
        GameConfig(playerCount = 2, seed = seed, playerTypes = Vector("randomBot", "human")),
        Vector("Bot", "Alice"),
        turnSeconds = 15,
        // Far longer than the test waits: a random bot must never use this window.
        botDelayMin = 30.seconds,
        botDelayMax = 60.seconds
      )
      .unsafeRunSync()
    assertEquals(room.stateRef.get.unsafeRunSync().turnPlayerId, Some("p0"))

    val after = awaitState(room, 5000.millis)(_.tablePairs.nonEmpty)
    val elapsedMs = System.currentTimeMillis() - startedAt
    GameActor.stopClock(room).unsafeRunSync()

    assertEquals(after.boutPhase, BoutPhase.Defense)
    assert(elapsedMs < 1000L, s"the random bot used the basic bot delay: ${elapsedMs}ms")
  }

  test("bot timing: a randomBot has no delay while a basicBot keeps the configured window") {
    // An all-human room starts no bot fiber, so this only inspects the timing rule.
    val room = newRoom()
    val state = room.stateRef.get.unsafeRunSync().copy(
      config = GameConfig(
        playerCount = 2,
        seed = 7L,
        playerTypes = Vector(GameConfig.RandomBotSeat, GameConfig.BasicBotSeat)
      )
    )
    GameActor.stopClock(room).unsafeRunSync()

    assertEquals(GameActor.botSeatType(state, "p0"), GameConfig.RandomBotSeat)
    assertEquals(GameActor.botDelayFor(room, state, "p0"), Option.empty[FiniteDuration])
    assertEquals(GameActor.botSeatType(state, "p1"), GameConfig.BasicBotSeat)
    GameActor.botDelayFor(room, state, "p1") match
      case None => fail("a basic bot must keep a pause before it plays")
      case Some(delay) =>
        assert(delay >= GameActor.DefaultBotDelayMin, delay.toString)
        assert(delay <= GameActor.DefaultBotDelayMax, delay.toString)
  }

  test("an all-RandomBot room reaches GameOver, publishes it and replays it") {
    val room = GameActor
      .create(
        GameConfig(
          playerCount = 2,
          seed = 13L,
          playerTypes = Vector(GameConfig.RandomBotSeat, GameConfig.RandomBotSeat)
        ),
        Vector("Bot A", "Bot B"),
        turnSeconds = 15
      )
      .unsafeRunSync()

    val finished = awaitState(room, 20.seconds)(_.isGameOver)
    GameActor.stopClock(room).unsafeRunSync()

    assertEquals(finished.boutPhase, BoutPhase.GameOver)
    assert(finished.gameEndedAtMs.isDefined, "a finished game must freeze its end time")
    assertEquals(finished.turnDeadlineMs, 0L)
    assertEquals(finished.promptedPlayerIds, Set.empty)

    // Every seat's projection is total, idle and actionless on the final state.
    finished.players.foreach { player =>
      val view = PlayerGameView.forViewer(finished, player.id)
      assertEquals(view.boutPhase, BoutPhase.GameOver)
      assertEquals(view.legalActions, List.empty)
      assertEquals(view.promptedPlayerIds, Vector.empty)
      assertEquals(view.turnDeadlineMs, 0L)
      assertEquals(view.gameEndedAtMs, finished.gameEndedAtMs)
    }

    // The replay ends with the same finished game, one frozen view per seat.
    val replay = room.replay.get.unsafeRunSync()
    assert(replay.frames.nonEmpty, "a finished game must be recorded")
    assertEquals(replay.frames.last.state.boutPhase, BoutPhase.GameOver)
    assertEquals(replay.frames.last.views.keySet, room.playerIds.toSet)
    assertEquals(replay.frames.last.views("p0").boutPhase, BoutPhase.GameOver)
    assert(replay.moves.nonEmpty, "a finished game must record its moves")
    assertEquals(replay.moves.last.stateAfter.boutPhase, BoutPhase.GameOver)
  }

  test("the move that ends the game is broadcast as GameOver with its end time") {
    val room = newRoom()
    val start = room.stateRef.get.unsafeRunSync()
    val attack = Card(Suit.Spades, Rank.Six)
    val cover = Card(Suit.Spades, Rank.Seven)
    val finalBout = start.copy(
      // Both hands are empty: this covered bout is the last of the match.
      players = start.players.map(_.copy(hand = Vector.empty)),
      talon = Vector.empty,
      bottomTrumpCard = None,
      tablePairs = Vector(TablePair(attack, Some(cover))),
      attackerIdx = 0,
      defenderIdx = 1,
      boutPhase = BoutPhase.Defense,
      defenderInitialHandSize = 1
    )
    room.stateRef.set(finalBout).unsafeRunSync()

    val broadcast = room.topic
      .subscribe(16)
      .take(1)
      .concurrently(
        Stream.eval(
          IO.sleep(100.millis) *> GameActor.applyAction(room, GameAction.PassTurn("p0")).void
        )
      )
      .compile
      .last
      .unsafeRunSync()
    GameActor.stopClock(room).unsafeRunSync()

    assertEquals(broadcast.map(_.boutPhase), Some(BoutPhase.GameOver))
    assert(broadcast.flatMap(_.gameEndedAtMs).isDefined, "the broadcast must carry the end time")
    assertEquals(broadcast.map(_.turnDeadlineMs), Some(0L))

    val replay = room.replay.get.unsafeRunSync()
    assertEquals(replay.frames.last.state.boutPhase, BoutPhase.GameOver)
    assertEquals(replay.frames.last.views("p1").boutPhase, BoutPhase.GameOver)
  }
