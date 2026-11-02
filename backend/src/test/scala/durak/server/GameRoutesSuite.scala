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
    json.hcursor.get[String]("gameId") match
      case Right(gameId) =>
        assert(gameId.matches("^[A-Za-z0-9]{8}$"), s"invalid game id: $gameId")
        gameId
      case Left(error) => fail(s"missing gameId in ${json.noSpaces}: $error")

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
    val gameId = json.hcursor
      .get[String]("gameId")
      .getOrElse(fail(s"missing gameId in ${json.noSpaces}"))
    assert(gameId.matches("^[A-Za-z0-9]{8}$"), s"invalid game id: $gameId")
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
    assert(view.turnDeadlineMs > 0L, s"missing turn clock: ${json.noSpaces}")
    assert(view.turnSecondsRemaining > 0, s"missing clock seconds: ${json.noSpaces}")
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

  // --- Readiness, player types & presence ---

  test("GET /api/health reports the server as ready") {
    val (status, json) = get(newManager, "/api/health")

    assertEquals(status, Status.Ok)
    assertEquals(json.hcursor.get[String]("status").toOption, Some("ok"))
  }

  test("POST /api/games creates a game and seats a RandomBot from playerTypes") {
    val manager = newManager

    val (status, json) = post(
      manager,
      "/api/games",
      Json.obj(
        "playerCount" -> 2.asJson,
        "playerNames" -> List("Bot", "Alice").asJson,
        "playerTypes" -> List("randomBot", "human").asJson
      )
    )

    assertEquals(status, Status.Ok)
    val gameId = json.hcursor
      .get[String]("gameId")
      .getOrElse(fail(s"missing gameId in ${json.noSpaces}"))
    assertEquals(
      json.hcursor.downField("playerTypes").as[List[String]].toOption,
      Some(List("randomBot", "human"))
    )

    val (viewStatus, viewJson) = get(manager, s"/api/games/$gameId/view?player=p1")
    assertEquals(viewStatus, Status.Ok)
    val view = viewJson.as[PlayerGameView].getOrElse(fail(s"invalid view body: ${viewJson.noSpaces}"))
    // A bot seat is always present, so the human sees it as connected.
    assert(view.presentPlayers.contains("p0"), view.presentPlayers.toString)
    assert(view.opponents.exists(seat => seat.id == "p0" && seat.isPresent), view.opponents.toString)
  }

  test("POST /api/games seats a BasicBot from playerTypes and preserves it") {
    val manager = newManager

    val (status, json) = post(
      manager,
      "/api/games",
      Json.obj(
        "playerCount" -> 2.asJson,
        "playerNames" -> List("Basic", "Alice").asJson,
        "playerTypes" -> List("basicBot", "human").asJson
      )
    )

    assertEquals(status, Status.Ok)
    val gameId = json.hcursor
      .get[String]("gameId")
      .getOrElse(fail(s"missing gameId in ${json.noSpaces}"))
    assertEquals(
      json.hcursor.downField("playerTypes").as[List[String]].toOption,
      Some(List("basicBot", "human"))
    )

    val (viewStatus, viewJson) = get(manager, s"/api/games/$gameId/view?player=p1")
    assertEquals(viewStatus, Status.Ok)
    val view = viewJson.as[PlayerGameView].getOrElse(fail(s"invalid view body: ${viewJson.noSpaces}"))
    // A bot seat is always present, so the human sees it as connected.
    assert(view.presentPlayers.contains("p0"), view.presentPlayers.toString)
  }

  test("POST /api/games/:gameId/presence toggles presence for every viewer") {
    val manager = newManager
    val gameId = createGame(manager, 2)

    val (status, json) = post(
      manager,
      s"/api/games/$gameId/presence",
      Json.obj("playerId" -> "p1".asJson, "isPresent" -> true.asJson)
    )
    assertEquals(status, Status.Ok)
    val joined = json.as[PlayerGameView].getOrElse(fail(s"invalid presence view: ${json.noSpaces}"))
    assert(joined.presentPlayers.contains("p1"), joined.presentPlayers.toString)

    val (_, otherJson) = get(manager, s"/api/game/$gameId/view/p0")
    val otherView = otherJson.as[PlayerGameView].getOrElse(fail("invalid view body"))
    assert(
      otherView.opponents.exists(seat => seat.id == "p1" && seat.isPresent),
      otherView.opponents.toString
    )

    val (leftStatus, leftJson) = post(
      manager,
      s"/api/games/$gameId/presence",
      Json.obj("playerId" -> "p1".asJson, "isPresent" -> false.asJson)
    )
    assertEquals(leftStatus, Status.Ok)
    val left = leftJson.as[PlayerGameView].getOrElse(fail("invalid presence view"))
    assert(!left.presentPlayers.contains("p1"), left.presentPlayers.toString)
  }

  test("presence for an unknown player or game returns 404") {
    val manager = newManager
    val gameId = createGame(manager, 2)

    val (unknownPlayer, _) = post(
      manager,
      s"/api/games/$gameId/presence",
      Json.obj("playerId" -> "ghost".asJson, "isPresent" -> true.asJson)
    )
    val (unknownGame, _) = post(
      manager,
      "/api/games/missing/presence",
      Json.obj("playerId" -> "p0".asJson, "isPresent" -> true.asJson)
    )

    assertEquals(unknownPlayer, Status.NotFound)
    assertEquals(unknownGame, Status.NotFound)
  }
