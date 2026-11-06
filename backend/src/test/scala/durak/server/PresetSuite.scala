package durak.server

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import durak.engine.*
import durak.engine.JsonCodecs.given
import io.circe.Json
import io.circe.syntax.*
import org.http4s.*
import org.http4s.circe.CirceEntityDecoder.*
import org.http4s.circe.CirceEntityEncoder.*
import org.http4s.headers.`Content-Type`

import scala.concurrent.duration.*

class PresetSuite extends munit.FunSuite:

  private def newManager: GameManager =
    GameManager
      .create(BotTiming(randomBotDelay = 5.millis, initialBotStartDelay = 5.millis))
      .unsafeRunSync()

  private def send(manager: GameManager, request: Request[IO]): (Status, Json) =
    GameRoutes
      .restRoutes(manager)
      .orNotFound
      .run(request)
      .flatMap(response => response.as[Json].map(json => (response.status, json)))
      .unsafeRunSync()

  private def post(manager: GameManager, path: String, body: Json): (Status, Json) =
    send(
      manager,
      Request[IO](Method.POST, Uri.unsafeFromString(path))
        .withEntity(body)
        .withContentType(`Content-Type`(MediaType.application.json))
    )

  private def view(manager: GameManager, gameId: String, playerId: String): PlayerGameView =
    val (status, json) = send(
      manager,
      Request[IO](
        Method.GET,
        Uri.unsafeFromString(s"/api/games/$gameId/view?player=$playerId")
      )
    )
    assertEquals(status, Status.Ok)
    json.as[PlayerGameView].getOrElse(fail(s"invalid view body: ${json.noSpaces}"))

  /** Polls a room until `predicate` holds, failing once `timeout` elapses. */
  private def awaitRoomState(room: GameRoom, timeout: FiniteDuration)(
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

  private def startPreset(manager: GameManager, presetId: String): (String, Json) =
    val (status, json) = post(
      manager,
      "/api/games/preset",
      Json.obj("preset" -> presetId.asJson)
    )
    assertEquals(status, Status.Ok, json.noSpaces)
    val gameId = json.hcursor
      .get[String]("gameId")
      .getOrElse(fail(s"missing gameId in ${json.noSpaces}"))
    (gameId, json)

  test("POST /api/games/preset starts the 3p deflection scenario on Bob") {
    val manager = newManager
    val (gameId, json) = startPreset(manager, "3p-redirect-bob")

    assert(gameId.matches("^[A-Za-z0-9]{8}$"), s"invalid game id: $gameId")
    assertEquals(json.hcursor.get[String]("defaultPlayerId").toOption, Some("p1"))
    assertEquals(
      json.hcursor.downField("players").as[List[Json]].map(_.size).toOption,
      Some(3)
    )
    assertEquals(
      json.hcursor.downField("playerTypes").as[List[String]].toOption,
      Some(List("human", "human", "human"))
    )

    val bob = view(manager, gameId, "p1")
    assertEquals(bob.myId, "p1")
    assertEquals(bob.myName, "Bob")
    assertEquals(bob.boutPhase, BoutPhase.Defense)
    assertEquals(bob.tablePairs.map(_.attack), Vector(Card(Suit.Spades, Rank.Six)))
    assert(bob.myHand.contains(Card(Suit.Hearts, Rank.Six)), bob.myHand.toString)
    // Bob can reflect the six onto Carol, who sits clockwise after him.
    assertEquals(bob.redirectTargetId, Some("p2"))
    assertEquals(bob.eligibleTargetIds, Vector.empty)
    assert(bob.legalActions.contains("redirect"), bob.legalActions.toString)
    assertEquals(bob.isBot, false)
    assertEquals(bob.chaosMode, false)
  }

  test("POST /api/games/preset starts the 4p Chaos scenario on Alice") {
    val manager = newManager
    val (gameId, json) = startPreset(manager, "chaos-4p")

    assertEquals(json.hcursor.get[String]("defaultPlayerId").toOption, Some("p0"))
    assertEquals(
      json.hcursor.downField("players").as[List[Json]].map(_.size).toOption,
      Some(4)
    )

    val alice = view(manager, gameId, "p0")
    assertEquals(alice.boutPhase, BoutPhase.InitialAttack)
    assertEquals(alice.chaosMode, true)
    assertEquals(alice.allowRedirect, true)
    assertEquals(alice.eligibleTargetIds, Vector("p1", "p2", "p3"))
    assertEquals(alice.myHand.size, 6)
    assert(alice.legalActions.contains("attack"), alice.legalActions.toString)

    // Every opponent is a legal target for the opening attack.
    val card = alice.myHand.head
    val (status, _) = post(
      manager,
      s"/api/games/$gameId/action",
      Json.obj(
        "type" -> "initialAttack".asJson,
        "playerId" -> "p0".asJson,
        "cards" -> Json.arr(card.asJson),
        "targetPlayerId" -> "p3".asJson
      )
    )
    assertEquals(status, Status.Ok)
    assertEquals(view(manager, gameId, "p3").defenderIdx, 3)
  }

  test("POST /api/games/preset starts the half-off surrender scenario on a defenseless Bob") {
    val manager = newManager
    val (gameId, json) = startPreset(manager, "surrender-half-off")

    // ITEM-PREV-4a: the scenario opens on the defender, not on the thrower.
    assertEquals(json.hcursor.get[String]("defaultPlayerId").toOption, Some("p1"))

    val bob = view(manager, gameId, "p1")
    assertEquals(bob.myName, "Bob")
    assertEquals(bob.boutPhase, BoutPhase.Defense)
    assertEquals(bob.myHand.size, 6)
    assertEquals(bob.myFinishRank, None)
    assertEquals(bob.trumpSuit, Suit.Clubs)
    // Two covered pairs plus the uncovered attack keep the cluster on the felt.
    assertEquals(bob.tablePairs.size, 3)
    assertEquals(bob.tablePairs.count(_.defense.isEmpty), 1)
    assertEquals(
      bob.tablePairs.map(pair => (pair.attack, pair.defense)),
      Vector(
        (Card(Suit.Spades, Rank.Seven), None),
        (Card(Suit.Clubs, Rank.Six), Some(Card(Suit.Clubs, Rank.Nine))),
        (Card(Suit.Hearts, Rank.Eight), Some(Card(Suit.Hearts, Rank.Jack)))
      )
    )
    assert(bob.tablePairs.size < bob.maxBoutAttacks, bob.maxBoutAttacks.toString)
    // ITEM-PREV-4a: no legal cover and no redirect, so surrender is the only
    // action — the 3-second auto-surrender and a manual click both work.
    assertEquals(bob.defenderDefenseless, true)
    assertEquals(bob.legalActions, List("surrender"))
    // The 9♠ that could have covered the 7♠ is swapped with the discard's 10♦.
    assert(!bob.myHand.contains(Card(Suit.Spades, Rank.Nine)), bob.myHand.toString)
    assert(bob.myHand.contains(Card(Suit.Diamonds, Rank.Ten)), bob.myHand.toString)

    val room = manager.getRoom(gameId).unsafeRunSync().getOrElse(fail("room is missing"))
    val state = room.stateRef.get.unsafeRunSync()
    // 36-card conservation across hands + table + talon + discard pile, with
    // every card distinct.
    val tableCards = state.tablePairs.flatMap(pair => pair.attack :: pair.defense.toList)
    val allCards =
      state.players.flatMap(_.hand) ++ tableCards ++ state.talon ++ state.discardPile
    assertEquals(
      state.players.map(_.hand.size).sum + tableCards.size + state.talon.size + state.discardPile.size,
      36
    )
    assertEquals(allCards.size, 36)
    assertEquals(allCards.distinct.size, 36)
    assertEquals(state.talon.size, 6)
    assertEquals(state.discardPile.size, 7)
    assertEquals(state.bottomTrumpCard, Some(Card(Suit.Clubs, Rank.Seven)))
    // Carol holds no rank on the table, so she never has a legal throw-in.
    assertEquals(GameEngine.canPlayerThrowIn(state, 2), false)
    // Alice, the attacker, still holds 7♥ — a rank that is on the table.
    assertEquals(state.players(0).hand.contains(Card(Suit.Hearts, Rank.Seven)), true)
    assertEquals(GameEngine.canPlayerThrowIn(state, 0), true)

    val (status, actionJson) = post(
      manager,
      s"/api/games/$gameId/action",
      Json.obj("type" -> "declareSurrender".asJson, "playerId" -> "p1".asJson)
    )
    assertEquals(status, Status.Ok, actionJson.noSpaces)

    // ITEM-PREV-4b: nothing is auto-passed at 0 ms — the cards stay straddling
    // the felt border and only Carol is queued for the delayed auto-pass.
    val surrendered = room.stateRef.get.unsafeRunSync()
    assertEquals(surrendered.boutPhase, BoutPhase.SurrenderThrowIn)
    assertEquals(surrendered.durak, None)
    assertEquals(surrendered.tablePairs.size, 3)
    assertEquals(surrendered.players(2).hasPassed, false)
    assertEquals(GameEngine.playersNeedingAutoPass(surrendered), Vector("p2"))

    // One second later Carol is PASSED while Alice keeps the throw-in window.
    val afterDelay = awaitRoomState(room, 5.seconds)(_.players(2).hasPassed)
    assertEquals(afterDelay.boutPhase, BoutPhase.SurrenderThrowIn)
    assertEquals(afterDelay.tablePairs.size, 3)
    assert(GameEngine.canPlayerThrowIn(afterDelay, 0), afterDelay.players.toString)

    val alice = view(manager, gameId, "p0")
    assertEquals(alice.boutPhase, BoutPhase.SurrenderThrowIn)
    assert(alice.legalActions.contains("throwIn"), alice.legalActions.toString)
    assert(alice.legalActions.contains("pass"), alice.legalActions.toString)
    assertEquals(alice.promptedPlayerIds, Vector("p0"))
    assertEquals(view(manager, gameId, "p2").myHasPassed, true)
    // The surrendered defender cannot act any more.
    assertEquals(view(manager, gameId, "p1").legalActions, List.empty)
  }

  test("POST /api/games/preset starts a defenseless defender the client auto-surrenders") {
    val manager = newManager
    val (gameId, json) = startPreset(manager, "defenseless-surrender")

    // T-90 ITEM-PREV-4a: the scenario opens on the defenseless defender.
    assertEquals(json.hcursor.get[String]("defaultPlayerId").toOption, Some("p1"))

    val bob = view(manager, gameId, "p1")
    assertEquals(bob.myName, "Bob")
    assertEquals(bob.boutPhase, BoutPhase.Defense)
    assertEquals(bob.tablePairs.size, 3)
    assertEquals(bob.tablePairs.head.attack, Card(Suit.Spades, Rank.Jack))
    // No legal cover (9♠ cannot beat J♠) and no redirect (two covered pairs),
    // so Surrender is the only action and the client's 3 s timer arms.
    assertEquals(bob.defenderDefenseless, true)
    assert(bob.legalActions.contains("surrender"), bob.legalActions.toString)
    assert(!bob.legalActions.contains("cover"), bob.legalActions.toString)
    assert(!bob.legalActions.contains("redirect"), bob.legalActions.toString)
    assert(!bob.legalActions.contains("throwIn"), bob.legalActions.toString)
    assertEquals(bob.myHasPassed, false)

    val room = manager.getRoom(gameId).unsafeRunSync().getOrElse(fail("room is missing"))
    val state = room.stateRef.get.unsafeRunSync()
    val tableCards = state.tablePairs.flatMap(pair => pair.attack :: pair.defense.toList)
    // 36-card conservation across hands + table + talon + discard pile.
    assertEquals(
      state.players.map(_.hand.size).sum + tableCards.size + state.talon.size + state.discardPile.size,
      36
    )
    assertEquals(state.talon.size, 6)
    assertEquals(state.discardPile.size, 7)
  }

  test("POST /api/games/preset starts the discard endgame with Bob DURAK after one throw-in") {
    val manager = newManager
    val (gameId, json) = startPreset(manager, "discard-and-endgame")

    assertEquals(json.hcursor.get[String]("defaultPlayerId").toOption, Some("p0"))

    val alice = view(manager, gameId, "p0")
    assertEquals(alice.talonCount, 0)
    assertEquals(alice.boutPhase, BoutPhase.SurrenderThrowIn)
    assertEquals(alice.myHand, List(Card(Suit.Hearts, Rank.Seven)))
    assertEquals(alice.myFinishRank, None)
    assertEquals(alice.myHasPassed, false)
    assertEquals(alice.winners, List("p2"))
    // ITEM-PREV-7c: a deep pile whose last four cards are revealed face-up.
    assertEquals(alice.discardCount, 31)
    assertEquals(alice.lastDiscardCards.size, 4)
    assertEquals(alice.discardCount - alice.lastDiscardCards.size, 27)
    assert(alice.legalActions.contains("throwIn"), alice.legalActions.toString)

    // ITEM-ADD-8b: Carol is out with 0 cards, Bob holds 3 and is not a winner.
    val carolSeat = alice.opponents.filter(_.id != "p1")
    assertEquals(carolSeat.map(_.id), List("p2"))
    assertEquals(carolSeat.head.cardCount, 0)
    assertEquals(carolSeat.head.finishRank, Some(1))

    val bob = view(manager, gameId, "p1")
    assertEquals(bob.myHand.size, 3)
    assertEquals(bob.myFinishRank, None)
    assert(!bob.winners.contains("p1"), bob.winners.toString)
    assertEquals(bob.opponents.find(_.id == "p2").map(_.finishRank), Some(Some(1)))

    val room = manager.getRoom(gameId).unsafeRunSync().getOrElse(fail("room is missing"))
    val state = room.stateRef.get.unsafeRunSync()
    assertEquals(state.talon, Vector.empty)
    assertEquals(state.tablePairs.size, 1)
    assertEquals(state.tablePairs.head.defense, None)
    assertEquals(
      state.players.map(_.hand.size).sum + state.tablePairs.size + state.discardPile.size,
      36
    )

    // One throw-in of Alice's last card settles the surrendered bout: she goes
    // out and Bob is left holding cards.
    val lastCard = alice.myHand.head
    val (status, actionJson) = post(
      manager,
      s"/api/games/$gameId/action",
      Json.obj(
        "type" -> "throwInCards".asJson,
        "playerId" -> "p0".asJson,
        "cards" -> Json.arr(lastCard.asJson)
      )
    )
    assertEquals(status, Status.Ok, actionJson.noSpaces)
    val finished = actionJson
      .as[PlayerGameView]
      .getOrElse(fail(s"invalid view body: ${actionJson.noSpaces}"))
    assertEquals(finished.boutPhase, BoutPhase.GameOver)
    assertEquals(finished.myHand, List.empty)
    assertEquals(finished.myFinishRank, Some(2))
    assertEquals(finished.myHasPassed, false)
    assertEquals(finished.durak, Some("p1"))
    assertEquals(finished.winners, List("p2", "p0"))
    assertEquals(finished.legalActions, List.empty)
    // Bob holds cards, so no seat ever sees him as OUT.
    assertEquals(finished.opponents.find(_.id == "p1").map(_.finishRank), Some(None))
    assertEquals(finished.opponents.find(_.id == "p1").map(_.cardCount), Some(5))

    // The last player standing carries the DURAK label from every seat's view.
    assertEquals(view(manager, gameId, "p0").durak, Some("p1"))
    assertEquals(view(manager, gameId, "p2").durak, Some("p1"))
    assertEquals(view(manager, gameId, "p2").myFinishRank, Some(1))
  }

  test("POST /api/games/preset starts a Transparent Mode table on Alice") {
    val manager = newManager
    val (gameId, json) = startPreset(manager, "transparent-mode")

    assertEquals(json.hcursor.get[String]("defaultPlayerId").toOption, Some("p0"))
    assertEquals(json.hcursor.get[Boolean]("transparentMode").toOption, Some(true))
    assertEquals(json.hcursor.get[Boolean]("devMode").toOption, Some(true))
    assertEquals(
      json.hcursor.downField("players").as[List[Json]].map(_.size).toOption,
      Some(3)
    )

    val alice = view(manager, gameId, "p0")
    assertEquals(alice.transparentMode, true)
    assertEquals(alice.devMode, true)
    assertEquals(alice.allowRedirect, true)
    assertEquals(alice.boutPhase, BoutPhase.InitialAttack)
    assertEquals(alice.myHand.size, 6)
    assertEquals(alice.opponents.size, 2)
    // Both opponents hold a deterministic mix of trump and off-suit cards, so
    // the low-detail opponent faces show both kinds at once.
    alice.opponents.foreach { opponent =>
      assertEquals(opponent.cards.size, 6)
      assertEquals(opponent.cards.size, opponent.cardCount)
      assert(opponent.cards.exists(_.suit == Suit.Diamonds), opponent.toString)
      assert(opponent.cards.exists(_.suit != Suit.Diamonds), opponent.toString)
    }

    val room = manager.getRoom(gameId).unsafeRunSync().getOrElse(fail("room is missing"))
    val state = room.stateRef.get.unsafeRunSync()
    assertEquals(state.talon.size, 18)
    assertEquals(state.bottomTrumpCard, state.talon.lastOption)
    assertEquals(state.bottomTrumpCard.map(_.suit), Some(Suit.Diamonds))
    val allCards = state.players.flatMap(_.hand) ++ state.talon
    assertEquals(allCards.size, 36)
    assertEquals(allCards.distinct.size, 36)

    // Transparent Mode is a match setting, so every seat sees the same reveal.
    val bob = view(manager, gameId, "p1")
    assertEquals(bob.transparentMode, true)
    assert(bob.opponents.forall(_.cards.size == 6), bob.opponents.toString)
    assert(bob.myName == "Bob")
  }

  test("an unknown preset is rejected with 400 and an error message") {
    val manager = newManager

    val (status, json) = post(manager, "/api/games/preset", Json.obj("preset" -> "nope".asJson))

    assertEquals(status, Status.BadRequest)
    assert(json.hcursor.get[String]("error").exists(_.nonEmpty), json.noSpaces)
  }

  test("POST /api/games reads chaosMode and opens every seat as a target") {
    val manager = newManager

    val (status, json) = post(
      manager,
      "/api/games",
      Json.obj(
        "playerCount" -> 4.asJson,
        "playerNames" -> List("Alice", "Bob", "Carol", "Dave").asJson,
        "chaosMode" -> true.asJson
      )
    )
    assertEquals(status, Status.Ok)
    val gameId = json.hcursor
      .get[String]("gameId")
      .getOrElse(fail(s"missing gameId in ${json.noSpaces}"))

    val room = manager.getRoom(gameId).unsafeRunSync().getOrElse(fail("room is missing"))
    val view = PlayerGameView.forViewer(room.stateRef.get.unsafeRunSync(), room.playerIds.head)
    assertEquals(view.chaosMode, true)
    assertEquals(view.eligibleTargetIds.size, 3)
  }

  test("a client cannot submit a move for a bot seat") {
    val manager = newManager

    val (createStatus, createJson) = post(
      manager,
      "/api/games",
      Json.obj(
        "playerCount" -> 2.asJson,
        "playerNames" -> List("Bot", "Alice").asJson,
        "playerTypes" -> List("randomBot", "human").asJson
      )
    )
    assertEquals(createStatus, Status.Ok)
    val gameId = createJson.hcursor
      .get[String]("gameId")
      .getOrElse(fail(s"missing gameId in ${createJson.noSpaces}"))

    // The bot seat reports itself, exposes no legal actions and refuses input.
    val bot = view(manager, gameId, "p0")
    assertEquals(bot.isBot, true)
    assertEquals(bot.legalActions, List.empty)
    assertEquals(bot.playerTypes, Vector("randomBot", "human"))

    val (status, json) = post(
      manager,
      s"/api/games/$gameId/action",
      Json.obj(
        "type" -> "initialAttack".asJson,
        "playerId" -> "p0".asJson,
        "cards" -> Json.arr(bot.myHand.head.asJson)
      )
    )

    assertEquals(status, Status.BadRequest)
    assertEquals(
      json.hcursor.get[String]("error").toOption,
      Some(GameActor.BotSeatInputError)
    )

    // The human seat still plays normally.
    val human = view(manager, gameId, "p1")
    assert(!human.isBot)
  }

  test("surrender-half-off gives Alice two rank-7 cards for one multi-card throw-in") {
    val manager = newManager
    val (gameId, _) = startPreset(manager, "surrender-half-off")

    val alice = view(manager, gameId, "p0")
    assertEquals(alice.myName, "Alice")
    assertEquals(alice.myHand.size, 6)
    // ITEM-5: both sevens are in her hand while 7♠ sits on the table.
    assert(alice.myHand.contains(Card(Suit.Hearts, Rank.Seven)), alice.myHand.toString)
    assert(alice.myHand.contains(Card(Suit.Diamonds, Rank.Seven)), alice.myHand.toString)
    assert(alice.legalActions.contains("throwIn"), alice.legalActions.toString)

    val room = manager.getRoom(gameId).unsafeRunSync().getOrElse(fail("room is missing"))
    val state = room.stateRef.get.unsafeRunSync()
    assertEquals(GameEngine.canPlayerThrowIn(state, 0), true)
    // The position stays card-conserving: 7♦ moved from the discard into her hand.
    val tableCards = state.tablePairs.flatMap(pair => pair.attack :: pair.defense.toList)
    val allCards = state.players.flatMap(_.hand) ++ tableCards ++ state.talon ++ state.discardPile
    assertEquals(state.players.map(_.hand.size).sum, 18)
    assertEquals(state.discardPile.size, 7)
    assertEquals(allCards.size, 36)
    assertEquals(allCards.distinct.size, 36)

    // Bob surrenders; Carol holds no rank on the table and is auto-passed.
    val (surrenderStatus, surrenderJson) = post(
      manager,
      s"/api/games/$gameId/action",
      Json.obj("type" -> "declareSurrender".asJson, "playerId" -> "p1".asJson)
    )
    assertEquals(surrenderStatus, Status.Ok, surrenderJson.noSpaces)
    awaitRoomState(room, 5.seconds)(_.players(2).hasPassed)

    val beforeThrowIn = view(manager, gameId, "p0")
    assertEquals(beforeThrowIn.boutPhase, BoutPhase.SurrenderThrowIn)
    assertEquals(beforeThrowIn.tablePairs.size, 3)

    val sevens = List(Card(Suit.Hearts, Rank.Seven), Card(Suit.Diamonds, Rank.Seven))
    val (status, afterJson) = post(
      manager,
      s"/api/games/$gameId/action",
      Json.obj(
        "type" -> "throwInCards".asJson,
        "playerId" -> "p0".asJson,
        "cards" -> sevens.asJson
      )
    )
    assertEquals(status, Status.Ok, afterJson.noSpaces)
    val after = afterJson
      .as[PlayerGameView]
      .getOrElse(fail(s"invalid view body: ${afterJson.noSpaces}"))
    assertEquals(after.boutPhase, BoutPhase.SurrenderThrowIn)
    assertEquals(after.tablePairs.size, 5)
    assertEquals(after.tablePairs.map(_.attack).takeRight(2), sevens.toVector)
    assertEquals(after.myHand.size, 4)
  }

  test("POST /api/games/preset/:presetId starts full-hand-pickup with a near-full-deck hand") {
    val manager = newManager
    val (status, json) = post(manager, "/api/games/preset/full-hand-pickup", Json.obj())

    assertEquals(status, Status.Ok, json.noSpaces)
    val gameId = json.hcursor
      .get[String]("gameId")
      .getOrElse(fail(s"missing gameId in ${json.noSpaces}"))
    assertEquals(json.hcursor.get[String]("defaultPlayerId").toOption, Some("p0"))
    assertEquals(
      json.hcursor.downField("players").as[List[Json]].map(_.size).toOption,
      Some(2)
    )

    val alice = view(manager, gameId, "p0")
    assertEquals(alice.myName, "Alice")
    assertEquals(alice.opponents.size, 1)
    assertEquals(alice.boutPhase, BoutPhase.InitialAttack)
    assertEquals(alice.attackerIdx, 0)
    assertEquals(alice.defenderIdx, 1)
    assertEquals(alice.talonCount, 0)
    // A near-full-deck hand, with the defender keeping the remaining 6-8 cards.
    assert(alice.myHand.size >= 28 && alice.myHand.size <= 30, alice.myHand.size.toString)
    val bob = alice.opponents.head
    assertEquals(bob.id, "p1")
    assert(bob.cardCount >= 6 && bob.cardCount <= 8, bob.cardCount.toString)
    assertEquals(alice.myHand.size + bob.cardCount + alice.talonCount, 36)
    // The opening attack is live, so every card in that hand is playable.
    assert(alice.legalActions.contains("attack"), alice.legalActions.toString)

    val room = manager.getRoom(gameId).unsafeRunSync().getOrElse(fail("room is missing"))
    val state = room.stateRef.get.unsafeRunSync()
    assertEquals(state.players.map(_.hand.size).sum, 36)
    assertEquals(state.players.flatMap(_.hand).distinct.size, 36)
    assertEquals(state.talon, Vector.empty)

    // The debug alias starts the very same scripted position.
    val (debugStatus, debugJson) =
      post(manager, "/api/debug/preset/full-hand-pickup", Json.obj())
    assertEquals(debugStatus, Status.Ok, debugJson.noSpaces)
    val debugGameId = debugJson.hcursor
      .get[String]("gameId")
      .getOrElse(fail(s"missing gameId in ${debugJson.noSpaces}"))
    assertEquals(view(manager, debugGameId, "p0").myHand.size, alice.myHand.size)
  }

  test("POST /api/games/preset/:presetId rejects an unknown preset with 400") {
    val manager = newManager

    val (status, json) = post(manager, "/api/games/preset/nope", Json.obj())

    assertEquals(status, Status.BadRequest)
    assert(json.hcursor.get[String]("error").exists(_.nonEmpty), json.noSpaces)
  }

  // --- T-90-feedback-20261106_111512-1: throw-in eligibility & huge-hand presets ---

  test("throw-in-visibility-4p exposes throw-ins only to the legal thrower") {
    val manager = newManager
    val (gameId, json) = startPreset(manager, "throw-in-visibility-4p")

    assertEquals(json.hcursor.get[String]("defaultPlayerId").toOption, Some("p0"))
    assertEquals(
      json.hcursor.downField("players").as[List[Json]].map(_.size).toOption,
      Some(4)
    )
    assertEquals(
      json.hcursor.downField("playerTypes").as[List[String]].toOption,
      Some(List("human", "human", "human", "human"))
    )

    val alice = view(manager, gameId, "p0")
    assertEquals(alice.myName, "Alice")
    assertEquals(
      alice.myHand,
      List(
        Card(Suit.Hearts, Rank.Seven),
        Card(Suit.Diamonds, Rank.Seven),
        Card(Suit.Diamonds, Rank.Nine),
        Card(Suit.Spades, Rank.King),
        Card(Suit.Hearts, Rank.Queen),
        Card(Suit.Clubs, Rank.Six)
      )
    )
    assertEquals(alice.boutPhase, BoutPhase.Defense)
    assertEquals(alice.trumpSuit, Suit.Clubs)
    assertEquals(alice.attackerIdx, 0)
    assertEquals(alice.defenderIdx, 1)
    assertEquals(
      alice.tablePairs.map(pair => (pair.attack, pair.defense)),
      Vector((Card(Suit.Spades, Rank.Seven), Some(Card(Suit.Spades, Rank.Nine))))
    )
    assertEquals(
      alice.throwInCards,
      List(
        Card(Suit.Hearts, Rank.Seven),
        Card(Suit.Diamonds, Rank.Seven),
        Card(Suit.Diamonds, Rank.Nine)
      )
    )
    assertEquals(alice.throwInCapacity, 3)
    assertEquals(alice.canThrowIn, true)

    // The defender holds a matching 9 but never qualifies.
    val bob = view(manager, gameId, "p1")
    assertEquals(bob.myHand.size, 6)
    assert(bob.myHand.contains(Card(Suit.Hearts, Rank.Nine)), bob.myHand.toString)
    assertEquals(bob.throwInCards, Nil)
    assertEquals(bob.throwInCapacity, 0)
    assertEquals(bob.canThrowIn, false)

    // Carol holds no 7 or 9, so she has nothing to throw in.
    val carol = view(manager, gameId, "p2")
    assertEquals(carol.myHand.size, 6)
    assertEquals(carol.throwInCards, Nil)
    assertEquals(carol.throwInCapacity, 0)
    assertEquals(carol.canThrowIn, false)

    // Dave holds 7♣ but already passed.
    val dave = view(manager, gameId, "p3")
    assertEquals(dave.myHasPassed, true)
    assert(dave.myHand.contains(Card(Suit.Clubs, Rank.Seven)), dave.myHand.toString)
    assertEquals(dave.throwInCards, Nil)
    assertEquals(dave.throwInCapacity, 0)
    assertEquals(dave.canThrowIn, false)

    val room = manager.getRoom(gameId).unsafeRunSync().getOrElse(fail("room is missing"))
    val state = room.stateRef.get.unsafeRunSync()
    val tableCards = state.tablePairs.flatMap(pair => pair.attack :: pair.defense.toList)
    val allCards = state.players.flatMap(_.hand) ++ tableCards ++ state.talon ++ state.discardPile
    assertEquals(state.talon.size, 26)
    assertEquals(state.bottomTrumpCard, state.talon.lastOption)
    assertEquals(state.bottomTrumpCard.map(_.suit), Some(Suit.Clubs))
    assertEquals(allCards.size, 52)
    assertEquals(allCards.distinct.size, 52)
  }

  test("throw-in-capacity-cap exposes a capacity of two against four matching cards") {
    val manager = newManager
    val (gameId, json) = startPreset(manager, "throw-in-capacity-cap")

    assertEquals(json.hcursor.get[String]("defaultPlayerId").toOption, Some("p0"))

    val alice = view(manager, gameId, "p0")
    assertEquals(
      alice.myHand,
      List(
        Card(Suit.Hearts, Rank.Seven),
        Card(Suit.Diamonds, Rank.Seven),
        Card(Suit.Clubs, Rank.Seven),
        Card(Suit.Diamonds, Rank.Nine),
        Card(Suit.Spades, Rank.King),
        Card(Suit.Hearts, Rank.Queen)
      )
    )
    assertEquals(alice.tablePairs.size, 1)
    assertEquals(alice.tablePairs.head.attack, Card(Suit.Spades, Rank.Seven))
    assertEquals(alice.tablePairs.head.defense, Some(Card(Suit.Spades, Rank.Nine)))
    assertEquals(alice.throwInCapacity, 2)
    assertEquals(alice.throwInCards.size, 4)
    assertEquals(alice.canThrowIn, true)

    val bob = view(manager, gameId, "p1")
    assertEquals(bob.myHand, List(Card(Suit.Hearts, Rank.Eight), Card(Suit.Diamonds, Rank.Ten)))
    assertEquals(bob.throwInCapacity, 0)
    assertEquals(bob.canThrowIn, false)

    val room = manager.getRoom(gameId).unsafeRunSync().getOrElse(fail("room is missing"))
    val state = room.stateRef.get.unsafeRunSync()
    val tableCards = state.tablePairs.flatMap(pair => pair.attack :: pair.defense.toList)
    val allCards = state.players.flatMap(_.hand) ++ tableCards ++ state.talon ++ state.discardPile
    assertEquals(state.talon.size, 26)
    assertEquals(state.bottomTrumpCard.map(_.suit), Some(Suit.Clubs))
    assertEquals(allCards.size, 36)
    assertEquals(allCards.distinct.size, 36)
  }

  test("huge-hand-36 loads a defender holding all 34 remaining cards") {
    val manager = newManager
    val (gameId, json) = startPreset(manager, "huge-hand-36")

    assertEquals(json.hcursor.get[String]("defaultPlayerId").toOption, Some("p1"))

    val alice = view(manager, gameId, "p0")
    assertEquals(alice.myHand, List(Card(Suit.Diamonds, Rank.Six)))
    assertEquals(alice.tablePairs.map(_.attack), Vector(Card(Suit.Spades, Rank.Six)))
    assertEquals(alice.tablePairs.head.defense, None)
    assertEquals(alice.boutPhase, BoutPhase.Defense)
    assertEquals(alice.talonCount, 0)
    assertEquals(alice.discardCount, 0)
    assertEquals(alice.trumpSuit, Suit.Hearts)

    val bob = view(manager, gameId, "p1")
    assertEquals(bob.myName, "Bob")
    assertEquals(bob.opponents.size, 1)
    assertEquals(bob.talonCount, 0)
    assertEquals(bob.discardCount, 0)
    val expectedBobHand = Deck
      .forPlayerCount(2)
      .filterNot(card => card == Card(Suit.Diamonds, Rank.Six) || card == Card(Suit.Spades, Rank.Six))
    assertEquals(bob.myHand, expectedBobHand.toList)
    assertEquals(bob.myHand.size, 34)
    // The defender never sees a throw-in, however many cards are in hand.
    assertEquals(bob.throwInCards, Nil)
    assertEquals(bob.canThrowIn, false)

    assertEquals(alice.myHand.size + bob.myHand.size + 1, 36)
    assertEquals((alice.myHand ++ bob.myHand :+ Card(Suit.Spades, Rank.Six)).distinct.size, 36)
  }

  test("huge-hand-52 loads a defender holding all 46 remaining cards") {
    val manager = newManager
    val (gameId, json) = startPreset(manager, "huge-hand-52")

    assertEquals(json.hcursor.get[String]("defaultPlayerId").toOption, Some("p1"))
    assertEquals(
      json.hcursor.downField("players").as[List[Json]].map(_.size).toOption,
      Some(4)
    )

    val alice = view(manager, gameId, "p0")
    assertEquals(
      alice.myHand,
      List(Card(Suit.Diamonds, Rank.Two), Card(Suit.Diamonds, Rank.Three))
    )
    assertEquals(alice.tablePairs.map(_.attack), Vector(Card(Suit.Spades, Rank.Two)))
    assertEquals(alice.tablePairs.head.defense, None)
    assertEquals(alice.boutPhase, BoutPhase.Defense)
    assertEquals(alice.talonCount, 0)
    assertEquals(alice.discardCount, 0)
    assertEquals(alice.trumpSuit, Suit.Hearts)

    val carol = view(manager, gameId, "p2")
    assertEquals(
      carol.myHand,
      List(Card(Suit.Diamonds, Rank.Four), Card(Suit.Diamonds, Rank.Five))
    )

    val dave = view(manager, gameId, "p3")
    assertEquals(dave.myHand, List(Card(Suit.Diamonds, Rank.Six)))

    val bob = view(manager, gameId, "p1")
    assertEquals(bob.myName, "Bob")
    assertEquals(bob.myHand.size, 46)
    assertEquals(bob.throwInCards, Nil)
    assertEquals(bob.canThrowIn, false)
    assertEquals(alice.myHand.size + bob.myHand.size + carol.myHand.size + dave.myHand.size + 1, 52)
    assertEquals(
      (alice.myHand ++ bob.myHand ++ carol.myHand ++ dave.myHand :+ Card(Suit.Spades, Rank.Two)).distinct.size,
      52
    )
  }
