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

class GameRoutesSuite extends munit.FunSuite:

  private def newManager: GameManager =
    GameManager
      .create(BotTiming(randomBotDelay = 5.millis, initialBotStartDelay = 5.millis))
      .unsafeRunSync()

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

  // --- Replay API ---

  test("GET /api/games/:gameId/replay returns every move with per-seat views") {
    val manager = newManager
    val gameId = createGame(manager, 2)

    val (_, startJson) = get(manager, s"/api/game/$gameId/view/p0")
    val start = startJson.as[PlayerGameView].getOrElse(fail("invalid start view"))
    val attackerId = s"p${start.attackerIdx}"
    val attackerJson =
      if attackerId == "p0" then startJson else get(manager, s"/api/game/$gameId/view/p1")._2
    val attackerView = attackerJson.as[PlayerGameView].getOrElse(fail("invalid attacker view"))
    val card = attackerView.myHand.head

    val (actionStatus, _) = post(
      manager,
      s"/api/game/$gameId/action",
      Json.obj(
        "type" -> "initialAttack".asJson,
        "playerId" -> attackerId.asJson,
        "cards" -> Json.arr(card.asJson)
      )
    )
    assertEquals(actionStatus, Status.Ok)

    val (status, json) = get(manager, s"/api/games/$gameId/replay")
    assertEquals(status, Status.Ok)
    val replay = json.as[SerializedGame].getOrElse(fail(s"invalid replay body: ${json.noSpaces}"))

    assertEquals(replay.gameId, gameId)
    assertEquals(replay.config.playerCount, 2)
    assertEquals(replay.initialState.players.map(_.hand.size), Vector(6, 6))
    assertEquals(replay.moves.size, 1)
    assertEquals(replay.moves.head.moveIndex, 1)
    assertEquals(replay.moves.head.playerId, attackerId)
    assertEquals(replay.moves.head.elapsedMs, 0L)
    assertEquals(replay.frames.map(_.moveIndex), Vector(0, 1))
    assertEquals(replay.frames.head.action, None)
    assertEquals(replay.frames.last.playerId, Some(attackerId))
    assertEquals(replay.frames.last.views.keySet, Set("p0", "p1"))
    assertEquals(GameReplay.verifyReplay(replay).map(_.size), Right(2))

    // The documented singular alias serves the same history.
    val (aliasStatus, aliasJson) = get(manager, s"/api/game/$gameId/replay")
    assertEquals(aliasStatus, Status.Ok)
    assertEquals(aliasJson.as[SerializedGame], Right(replay))
  }

  test("the replay endpoint returns 404 for an unknown game") {
    val (status, _) = get(newManager, "/api/games/missing/replay")
    assertEquals(status, Status.NotFound)
  }

  // --- Finished games & bare view URL (feedback items 9 / 12) ---

  test("a view request with no player falls back to p0") {
    val manager = newManager
    val gameId = createGame(manager, 2)

    val (missingStatus, missingJson) = get(manager, s"/api/games/$gameId/view")
    assertEquals(missingStatus, Status.Ok)
    assertEquals(missingJson.as[PlayerGameView].map(_.myId), Right("p0"))

    val (blankStatus, blankJson) = get(manager, s"/api/games/$gameId/view?player=")
    assertEquals(blankStatus, Status.Ok)
    assertEquals(blankJson.as[PlayerGameView].map(_.myId), Right("p0"))
  }

  test("a RandomBot vs RandomBot game finishes and serves its view and replay without error") {
    val manager = newManager
    val startedAt = System.currentTimeMillis()
    val (status, json) = post(
      manager,
      "/api/games",
      Json.obj(
        "playerCount" -> 2.asJson,
        "playerNames" -> List("Bot A", "Bot B").asJson,
        "playerTypes" -> List("randomBot", "randomBot").asJson
      )
    )
    assertEquals(status, Status.Ok)
    val gameId = json.hcursor
      .get[String]("gameId")
      .getOrElse(fail(s"missing gameId in ${json.noSpaces}"))
    val room = manager.getRoom(gameId).unsafeRunSync().getOrElse(fail(s"room $gameId is missing"))

    val deadline = System.currentTimeMillis() + 20_000L
    var state = room.stateRef.get.unsafeRunSync()
    while !state.isGameOver && System.currentTimeMillis() < deadline do
      IO.sleep(25.millis).unsafeRunSync()
      state = room.stateRef.get.unsafeRunSync()
    val elapsedMs = System.currentTimeMillis() - startedAt
    GameActor.stopClock(room).unsafeRunSync()

    assertEquals(
      state.boutPhase,
      BoutPhase.GameOver,
      s"the all-RandomBot game did not finish (${state.boutPhase})"
    )
    assert(elapsedMs < 5000L, s"an all-RandomBot game must finish in seconds, took ${elapsedMs}ms")

    // Every seat reads the finished table through both documented view URLs.
    room.playerIds.foreach { playerId =>
      val (queryStatus, queryJson) = get(manager, s"/api/games/$gameId/view?player=$playerId")
      assertEquals(queryStatus, Status.Ok)
      val queryView = queryJson
        .as[PlayerGameView]
        .getOrElse(fail(s"invalid view body for $playerId: ${queryJson.noSpaces}"))
      assertEquals(queryView.myId, playerId)
      assertEquals(queryView.boutPhase, BoutPhase.GameOver)
      assertEquals(queryView.legalActions, List.empty)
      assertEquals(queryView.promptedPlayerIds, Vector.empty)
      assertEquals(queryView.turnDeadlineMs, 0L)
      assert(queryView.gameEndedAtMs.isDefined, queryJson.noSpaces)

      val (pathStatus, pathJson) = get(manager, s"/api/game/$gameId/view/$playerId")
      assertEquals(pathStatus, Status.Ok)
      assertEquals(pathJson.as[PlayerGameView].map(_.boutPhase), Right(BoutPhase.GameOver))
    }

    // The bare game URL (no player) resolves too, defaulting to p0.
    val (defaultStatus, defaultJson) = get(manager, s"/api/games/$gameId/view")
    assertEquals(defaultStatus, Status.Ok)
    assertEquals(defaultJson.as[PlayerGameView].map(_.myId), Right("p0"))

    val (replayStatus, replayJson) = get(manager, s"/api/games/$gameId/replay")
    assertEquals(replayStatus, Status.Ok)
    val replay = replayJson
      .as[SerializedGame]
      .getOrElse(fail(s"invalid replay body: ${replayJson.noSpaces}"))
    assert(replay.frames.nonEmpty, "a finished game must serve its frames")
    assertEquals(replay.frames.last.state.boutPhase, BoutPhase.GameOver)
    assertEquals(replay.frames.last.views.keySet, room.playerIds.toSet)
    assertEquals(replay.frames.last.views("p0").boutPhase, BoutPhase.GameOver)
    assertEquals(replay.frames.last.views("p0").legalActions, List.empty)
    assert(replay.moves.nonEmpty, "a finished game must record its moves")
    assertEquals(replay.moves.last.stateAfter.boutPhase, BoutPhase.GameOver)

    val (aliasStatus, aliasJson) = get(manager, s"/api/game/$gameId/replay")
    assertEquals(aliasStatus, Status.Ok)
    assertEquals(aliasJson.as[SerializedGame].map(_.gameId), Right(gameId))
  }

  // --- Transparent Mode & Dev Mode (T-90 ITEM-10a / ITEM-14a) ---

  private def createWith(manager: GameManager, body: Json): String =
    val (status, json) = post(manager, "/api/games", body)
    assertEquals(status, Status.Ok, json.noSpaces)
    json.hcursor
      .get[String]("gameId")
      .getOrElse(fail(s"missing gameId in ${json.noSpaces}"))

  private def roomOf(manager: GameManager, gameId: String): GameState =
    manager.getRoom(gameId).unsafeRunSync().getOrElse(fail(s"room $gameId is missing"))
      .stateRef
      .get
      .unsafeRunSync()

  test("POST /api/games forwards transparentMode and reveals every opponent hand") {
    val manager = newManager
    val gameId = createWith(
      manager,
      Json.obj(
        "playerCount" -> 3.asJson,
        "playerNames" -> List("Alice", "Bob", "Carol").asJson,
        "transparentMode" -> true.asJson
      )
    )

    val (status, json) = get(manager, s"/api/games/$gameId/view?player=p0")
    assertEquals(status, Status.Ok)
    val view = json.as[PlayerGameView].getOrElse(fail(s"invalid view body: ${json.noSpaces}"))

    assertEquals(view.transparentMode, true)
    // Dev Mode defaults to on in production while we are testing.
    assertEquals(view.devMode, true)
    assertEquals(view.opponents.size, 2)
    view.opponents.foreach { opponent =>
      assertEquals(opponent.cards.size, opponent.cardCount)
      assert(opponent.cards.nonEmpty, s"no revealed hand for ${opponent.id}")
    }
    // Every hand is a distinct slice of the 36-card deck.
    val revealed = view.myHand ++ view.opponents.flatMap(_.cards)
    assertEquals(revealed.size, 18)
    assertEquals(revealed.distinct.size, 18)
  }

  test("an ordinary game keeps opponent hands hidden and Dev Mode on") {
    val manager = newManager
    val gameId = createGame(manager, 3)

    val (status, json) = get(manager, s"/api/games/$gameId/view?player=p0")
    assertEquals(status, Status.Ok)
    val view = json.as[PlayerGameView].getOrElse(fail(s"invalid view body: ${json.noSpaces}"))

    assertEquals(view.transparentMode, false)
    assertEquals(view.devMode, true)
    view.opponents.foreach(opponent => assertEquals(opponent.cards, Vector.empty[Card]))
    assert(!json.noSpaces.contains("\"cards\":[{"), s"a hidden hand leaked: ${json.noSpaces}")
  }

  test("a non-devMode game locks the POV to the first seat until Game Over") {
    val manager = newManager
    val gameId = createWith(
      manager,
      Json.obj(
        "playerCount" -> 3.asJson,
        "playerNames" -> List("Alice", "Bob", "Carol").asJson,
        "devMode" -> false.asJson
      )
    )
    assertEquals(roomOf(manager, gameId).config.devMode, false)

    // A requester that names another seat is rejected before anything is claimed.
    val (crossStatus, crossJson) = get(manager, s"/api/games/$gameId/view/p1?requester=p0")
    assertEquals(crossStatus, Status.Forbidden)
    assert(crossJson.hcursor.get[String]("error").exists(_.nonEmpty), crossJson.noSpaces)

    // The first human seat claims the room...
    val (ownStatus, ownJson) = get(manager, s"/api/games/$gameId/view/p0?requester=p0")
    assertEquals(ownStatus, Status.Ok)
    assertEquals(ownJson.as[PlayerGameView].map(_.myId), Right("p0"))

    // ...and every other seat is refused, with or without a matching requester,
    // so a client cannot switch POV by editing the DOM or calling the view URL.
    assertEquals(get(manager, s"/api/games/$gameId/view/p1")._1, Status.Forbidden)
    assertEquals(get(manager, s"/api/games/$gameId/view/p1?requester=p1")._1, Status.Forbidden)
    assertEquals(get(manager, s"/api/game/$gameId/view/p2")._1, Status.Forbidden)
    assertEquals(get(manager, s"/api/games/$gameId/view/p0")._1, Status.Ok)

    // Once the game is over, review mode may inspect any seat again.
    val room = manager.getRoom(gameId).unsafeRunSync().getOrElse(fail("room is missing"))
    val finished = room.stateRef.get.unsafeRunSync().copy(boutPhase = BoutPhase.GameOver)
    room.stateRef.set(finished).unsafeRunSync()
    assertEquals(get(manager, s"/api/games/$gameId/view/p2")._1, Status.Ok)
    assertEquals(get(manager, s"/api/games/$gameId/view/p2?requester=p0")._1, Status.Ok)
  }

  test("a devMode game keeps every seat open during live play") {
    val manager = newManager
    val gameId = createGame(manager, 3)

    assertEquals(get(manager, s"/api/games/$gameId/view/p1")._1, Status.Ok)
    assertEquals(get(manager, s"/api/games/$gameId/view/p2?requester=p0")._1, Status.Ok)
  }

  test("POST /api/games/:gameId/rematch preserves transparentMode and devMode") {
    val manager = newManager
    val gameId = createWith(
      manager,
      Json.obj(
        "playerCount" -> 2.asJson,
        "playerNames" -> List("Alice", "Bob").asJson,
        "transparentMode" -> true.asJson,
        "devMode" -> false.asJson,
        "allowRedirect" -> false.asJson
      )
    )

    val (status, json) = post(manager, s"/api/games/$gameId/rematch", Json.obj())
    assertEquals(status, Status.Ok, json.noSpaces)
    val nextId = json.hcursor
      .get[String]("gameId")
      .getOrElse(fail(s"missing rematch gameId in ${json.noSpaces}"))
    assertNotEquals(nextId, gameId)
    assertEquals(json.hcursor.get[Boolean]("transparentMode").toOption, Some(true))
    assertEquals(json.hcursor.get[Boolean]("devMode").toOption, Some(false))
    assertEquals(json.hcursor.get[Boolean]("allowRedirect").toOption, Some(false))
    assertEquals(
      json.hcursor.downField("players").as[List[Json]].map(_.size).toOption,
      Some(2)
    )

    val nextRoom = manager.getRoom(nextId).unsafeRunSync().getOrElse(fail(s"room $nextId is missing"))
    val nextState = nextRoom.stateRef.get.unsafeRunSync()
    assertEquals(nextState.config.transparentMode, true)
    assertEquals(nextState.config.devMode, false)
    assertEquals(nextState.config.allowRedirect, false)
    assertEquals(nextState.players.map(_.name), Vector("Alice", "Bob"))
    // A rematch re-deals rather than replaying the same cards.
    assertNotEquals(nextState.players.map(_.hand), roomOf(manager, gameId).players.map(_.hand))
  }
