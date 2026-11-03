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

  test("POST /api/games/preset starts the half-off surrender scenario on Alice") {
    val manager = newManager
    val (gameId, json) = startPreset(manager, "surrender-half-off")

    assertEquals(json.hcursor.get[String]("defaultPlayerId").toOption, Some("p0"))

    val alice = view(manager, gameId, "p0")
    assertEquals(alice.boutPhase, BoutPhase.SurrenderThrowIn)
    assertEquals(alice.tablePairs.map(_.attack), Vector(Card(Suit.Spades, Rank.Seven)))
    assert(alice.myHand.contains(Card(Suit.Hearts, Rank.Seven)), alice.myHand.toString)
    assert(alice.legalActions.contains("throwIn"), alice.legalActions.toString)
    assert(alice.legalActions.contains("pass"), alice.legalActions.toString)
    assert(alice.promptedPlayerIds.contains("p0"), alice.promptedPlayerIds.toString)

    // Bob, the surrendering defender, has nothing to do.
    val bob = view(manager, gameId, "p1")
    assertEquals(bob.legalActions, List.empty)
  }

  test("POST /api/games/preset starts the discard endgame and Bob ends up DURAK") {
    val manager = newManager
    val (gameId, json) = startPreset(manager, "discard-and-endgame")

    assertEquals(json.hcursor.get[String]("defaultPlayerId").toOption, Some("p0"))

    val alice = view(manager, gameId, "p0")
    assertEquals(alice.talonCount, 0)
    assertEquals(alice.discardCount, 8)
    assertEquals(alice.lastDiscardCards.size, 4)
    assertEquals(alice.winners, List("p2"))
    assertEquals(alice.myHand.size, 1)
    assert(alice.legalActions.contains("attack"), alice.legalActions.toString)

    val lastCard = alice.myHand.head
    val (attackStatus, _) = post(
      manager,
      s"/api/games/$gameId/action",
      Json.obj(
        "type" -> "initialAttack".asJson,
        "playerId" -> "p0".asJson,
        "cards" -> Json.arr(lastCard.asJson)
      )
    )
    assertEquals(attackStatus, Status.Ok)

    // Bob cannot cover the last card, so surrendering ends the match.
    val bobBefore = view(manager, gameId, "p1")
    assertEquals(bobBefore.defenderDefenseless, true)
    assertEquals(bobBefore.legalActions, List("surrender"))

    val (surrenderStatus, surrenderJson) = post(
      manager,
      s"/api/games/$gameId/action",
      Json.obj("type" -> "declareSurrender".asJson, "playerId" -> "p1".asJson)
    )
    assertEquals(surrenderStatus, Status.Ok, surrenderJson.noSpaces)
    val finished = surrenderJson
      .as[PlayerGameView]
      .getOrElse(fail(s"invalid view body: ${surrenderJson.noSpaces}"))
    assertEquals(finished.boutPhase, BoutPhase.GameOver)
    assertEquals(finished.durak, Some("p1"))
    assertEquals(finished.winners, List("p2", "p0"))
    assertEquals(finished.legalActions, List.empty)

    // The last player out carries the DURAK label from every seat's view.
    assertEquals(view(manager, gameId, "p0").durak, Some("p1"))
    assertEquals(view(manager, gameId, "p2").durak, Some("p1"))
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
