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

class GameRoutesSuite extends munit.FunSuite:

  private def newManager: GameManager = GameManager.create.unsafeRunSync()

  private def send(
      manager: GameManager,
      request: Request[IO]
  ): (Status, Json) =
    GameRoutes
      .restRoutes(manager)
      .orNotFound
      .run(request)
      .flatMap(response => response.as[Json].map(json => (response.status, json)))
      .unsafeRunSync()

  private def get(manager: GameManager, path: String): (Status, Json) =
    send(manager, Request[IO](Method.GET, Uri.unsafeFromString(path)))

  private def post(manager: GameManager, path: String, body: Json): (Status, Json) =
    send(
      manager,
      Request[IO](Method.POST, Uri.unsafeFromString(path))
        .withEntity(body)
        .withContentType(`Content-Type`(MediaType.application.json))
    )

  private def createGame(manager: GameManager, players: Int): String =
    val names = (1 to players).map(index => s"Player$index").toList
    val (status, json) = post(
      manager,
      "/api/game/create",
      Json.obj(
        "playerCount" -> players.asJson,
        "playerNames" -> names.asJson,
        "allowRedirect" -> true.asJson
      )
    )
    assertEquals(status, Status.Ok)
    json.hcursor
      .get[String]("gameId")
      .getOrElse(fail(s"missing gameId in ${json.noSpaces}"))

  test("POST /api/game/create returns a game id and the players") {
    val manager = newManager

    val (status, json) = post(
      manager,
      "/api/game/create",
      Json.obj(
        "playerCount" -> 2.asJson,
        "playerNames" -> List("Alice", "Bob").asJson,
        "allowRedirect" -> true.asJson
      )
    )

    assertEquals(status, Status.Ok)
    assert(json.hcursor.get[String]("gameId").exists(_.nonEmpty))
    assertEquals(json.hcursor.downField("players").as[List[Json]].map(_.size).toOption, Some(2))
  }

  test("GET view returns the PlayerGameView for the requested seat") {
    val manager = newManager
    val gameId = createGame(manager, 3)

    val (status, json) = get(manager, s"/api/game/$gameId/view/p1")

    assertEquals(status, Status.Ok)
    val view = json.as[PlayerGameView].getOrElse(fail(s"invalid view body: ${json.noSpaces}"))
    assertEquals(view.myId, "p1")
    assertEquals(view.myHand.size, 6)
    assertEquals(view.opponents.size, 2)
    assert(view.talonCount > 0)
    assert(!json.noSpaces.contains("\"talon\""), json.noSpaces)
  }

  test("POST action applies a legal move and returns the updated view") {
    val manager = newManager
    val gameId = createGame(manager, 2)

    val (_, startJson) = get(manager, s"/api/game/$gameId/view/p0")
    val start = startJson.as[PlayerGameView].getOrElse(fail("invalid start view"))
    val attackerId = s"p${start.attackerIdx}"
    val (_, attackerJson) =
      if attackerId == "p0" then (Status.Ok, startJson)
      else get(manager, s"/api/game/$gameId/view/p1")
    val attackerView =
      attackerJson.as[PlayerGameView].getOrElse(fail("invalid attacker view"))
    val card = attackerView.myHand.head

    val (status, json) = post(
      manager,
      s"/api/game/$gameId/action",
      Json.obj(
        "type" -> "initialAttack".asJson,
        "playerId" -> attackerId.asJson,
        "cards" -> Json.arr(card.asJson)
      )
    )

    assertEquals(status, Status.Ok)
    val view = json.as[PlayerGameView].getOrElse(fail(s"invalid action view: ${json.noSpaces}"))
    assertEquals(view.myId, attackerId)
    assertEquals(view.boutPhase, BoutPhase.Defense)
    assertEquals(view.tablePairs.map(_.attack), Vector(card))
  }

  test("POST action rejects an illegal move with 400 and an error message") {
    val manager = newManager
    val gameId = createGame(manager, 2)

    val (status, json) = post(
      manager,
      s"/api/game/$gameId/action",
      Json.obj("type" -> "passTurn".asJson, "playerId" -> "p0".asJson)
    )

    assertEquals(status, Status.BadRequest)
    assert(json.hcursor.get[String]("error").exists(_.nonEmpty), json.noSpaces)
  }

  test("POST action rejects an unknown action type with 400") {
    val manager = newManager
    val gameId = createGame(manager, 2)

    val (status, json) = post(
      manager,
      s"/api/game/$gameId/action",
      Json.obj("type" -> "teleport".asJson, "playerId" -> "p0".asJson)
    )

    assertEquals(status, Status.BadRequest)
    assert(json.hcursor.get[String]("error").exists(_.nonEmpty), json.noSpaces)
  }

  test("POST /api/game/create accepts chaos mode for three players") {
    val manager = newManager

    val (status, json) = post(
      manager,
      "/api/game/create",
      Json.obj(
        "playerCount" -> 3.asJson,
        "playerNames" -> List("Alice", "Bob", "Cara").asJson,
        "chaosMode" -> true.asJson
      )
    )

    assertEquals(status, Status.Ok)
    assert(json.hcursor.get[String]("gameId").exists(_.nonEmpty), json.noSpaces)
  }

  test("POST /api/game/create rejects chaos mode for two players") {
    val manager = newManager

    val (status, json) = post(
      manager,
      "/api/game/create",
      Json.obj(
        "playerCount" -> 2.asJson,
        "playerNames" -> List("Alice", "Bob").asJson,
        "chaosMode" -> true.asJson
      )
    )

    assertEquals(status, Status.BadRequest)
    assert(json.hcursor.get[String]("error").exists(_.nonEmpty), json.noSpaces)
  }

  test("chaos mode lets the opening attacker target a non-adjacent defender") {
    val manager = newManager
    val names = List("Alice", "Bob", "Cara")
    val (createStatus, created) = post(
      manager,
      "/api/game/create",
      Json.obj(
        "playerCount" -> 3.asJson,
        "playerNames" -> names.asJson,
        "chaosMode" -> true.asJson
      )
    )
    assertEquals(createStatus, Status.Ok)
    val gameId = created.hcursor
      .get[String]("gameId")
      .getOrElse(fail(s"missing gameId in ${created.noSpaces}"))

    val (_, viewJson) = get(manager, s"/api/game/$gameId/view/p0")
    val view = viewJson.as[PlayerGameView].getOrElse(fail("invalid view body"))
    val attackerIdx = view.attackerIdx
    val targetIdx = (attackerIdx + 2) % 3
    val (_, attackerJson) = get(manager, s"/api/game/$gameId/view/p${attackerIdx}")
    val attackerView = attackerJson.as[PlayerGameView].getOrElse(fail("invalid attacker view"))

    val (status, json) = post(
      manager,
      s"/api/game/$gameId/action",
      Json.obj(
        "type" -> "initialAttack".asJson,
        "playerId" -> s"p$attackerIdx".asJson,
        "cards" -> Json.arr(attackerView.myHand.head.asJson),
        "targetDefender" -> s"p$targetIdx".asJson
      )
    )

    assertEquals(status, Status.Ok)
    val after = json.as[PlayerGameView].getOrElse(fail(s"invalid action view: ${json.noSpaces}"))
    assertEquals(after.defenderIdx, targetIdx)
    assertEquals(after.boutPhase, BoutPhase.Defense)
  }

  test("the returned view carries the 15-second turn clock") {
    val manager = newManager
    val gameId = createGame(manager, 2)

    val (status, json) = get(manager, s"/api/game/$gameId/view/p0")

    assertEquals(status, Status.Ok)
    val view = json.as[PlayerGameView].getOrElse(fail("invalid view body"))
    assert(view.turnDeadlineMs > 0, view.turnDeadlineMs)
    assert(view.turnSecondsRemaining >= 0 && view.turnSecondsRemaining <= 15, view.turnSecondsRemaining)
  }

  test("POST /api/game/create rejects an unsupported player count with 400") {
    val manager = newManager

    val (status, json) = post(
      manager,
      "/api/game/create",
      Json.obj(
        "playerCount" -> 7.asJson,
        "playerNames" -> (1 to 7).map(index => s"P$index").toList.asJson
      )
    )

    assertEquals(status, Status.BadRequest)
    assert(json.hcursor.get[String]("error").exists(_.nonEmpty), json.noSpaces)
  }

  test("an unknown game id returns 404") {
    val manager = newManager

    val (viewStatus, _) = get(manager, "/api/game/missing/view/p0")
    val (actionStatus, _) = post(
      manager,
      "/api/game/missing/action",
      Json.obj("type" -> "passTurn".asJson, "playerId" -> "p0".asJson)
    )

    assertEquals(viewStatus, Status.NotFound)
    assertEquals(actionStatus, Status.NotFound)
  }

  test("an unknown player id returns 404") {
    val manager = newManager
    val gameId = createGame(manager, 2)

    val (status, _) = get(manager, s"/api/game/$gameId/view/ghost")

    assertEquals(status, Status.NotFound)
  }
