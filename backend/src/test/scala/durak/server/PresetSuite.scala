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

class PresetSuite extends munit.FunSuite:

  private def newManager: GameManager = GameManager.create.unsafeRunSync()

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

  test("POST /api/games/preset starts the half-off surrender scenario on Bob's defense") {
    val manager = newManager
    val (gameId, json) = startPreset(manager, "surrender-half-off")

    // ITEM-ADD-4a: the scenario opens on the defender, not on the thrower.
    assertEquals(json.hcursor.get[String]("defaultPlayerId").toOption, Some("p1"))

    val bob = view(manager, gameId, "p1")
    assertEquals(bob.myName, "Bob")
    assertEquals(bob.boutPhase, BoutPhase.Defense)
    assertEquals(bob.myHand.size, 6)
    assertEquals(bob.myFinishRank, None)
    // Two covered pairs plus the uncovered attack keep the cluster on the felt.
    assertEquals(bob.tablePairs.size, 3)
    assertEquals(bob.tablePairs.count(_.defense.isEmpty), 1)
    assertEquals(
      bob.tablePairs.map(_.attack),
      Vector(
        Card(Suit.Spades, Rank.Seven),
        Card(Suit.Clubs, Rank.Ten),
        Card(Suit.Spades, Rank.Queen)
      )
    )
    assert(bob.tablePairs.size < bob.maxBoutAttacks, bob.maxBoutAttacks.toString)
    // A legal cover exists, so Surrender is on screen and nothing auto-surrenders.
    assert(bob.myHand.contains(Card(Suit.Spades, Rank.Nine)), bob.myHand.toString)
    assert(bob.legalActions.contains("cover"), bob.legalActions.toString)
    assert(bob.legalActions.contains("surrender"), bob.legalActions.toString)
    assertEquals(bob.defenderDefenseless, false)

    val room = manager.getRoom(gameId).unsafeRunSync().getOrElse(fail("room is missing"))
    val state = room.stateRef.get.unsafeRunSync()
    // 36-card conservation across hands + table + talon + discard pile.
    val tableCards = state.tablePairs.flatMap(pair => pair.attack :: pair.defense.toList)
    assertEquals(
      state.players.map(_.hand.size).sum + tableCards.size + state.talon.size + state.discardPile.size,
      36
    )
    assertEquals(state.talon.size, 6)
    assertEquals(state.discardPile.size, 7)
    // Alice, the attacker, still holds a rank that is on the table.
    assert(GameEngine.canPlayerThrowIn(state, 0))
    assert(
      state.players(0).hand.exists(handCard => state.tableRanks.contains(handCard.rank)),
      state.players(0).hand.toString
    )

    // ITEM-ADD-4a: the surrender lands in the throw-in phase and stays there.
    val afterSurrender = GameEngine
      .applyAction(state, "p1", GameAction.DeclareSurrender("p1"))
      .getOrElse(fail("the surrender was rejected"))
    assertEquals(afterSurrender.boutPhase, BoutPhase.SurrenderThrowIn)
    assertEquals(afterSurrender.durak, None)
    assertEquals(afterSurrender.tablePairs.size, 3)
    assert(GameEngine.canPlayerThrowIn(afterSurrender, 0))

    val (status, actionJson) = post(
      manager,
      s"/api/games/$gameId/action",
      Json.obj("type" -> "declareSurrender".asJson, "playerId" -> "p1".asJson)
    )
    assertEquals(status, Status.Ok, actionJson.noSpaces)

    // Alice is asked to throw in or pass; the surrendered defender cannot act.
    val alice = view(manager, gameId, "p0")
    assertEquals(alice.boutPhase, BoutPhase.SurrenderThrowIn)
    assert(alice.legalActions.contains("throwIn"), alice.legalActions.toString)
    assert(alice.legalActions.contains("pass"), alice.legalActions.toString)
    assert(alice.promptedPlayerIds.contains("p0"), alice.promptedPlayerIds.toString)
    assertEquals(view(manager, gameId, "p1").legalActions, List.empty)
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
