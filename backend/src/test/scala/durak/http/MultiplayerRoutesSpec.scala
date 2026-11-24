package durak.http

import cats.effect.{Fiber, IO}
import cats.effect.std.Queue
import cats.effect.syntax.all.*
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import durak.engine.JsonCodecs.given
import durak.lobby.QuickPairingService
import durak.protocol.{PlayerGameView, WsServerMessage}
import durak.rooms.RoomManager
import durak.server.{GameManager, GameRoutes}
import durak.session.{SessionCookie, SessionRoutes, SessionStore}
import fs2.Stream
import io.circe.{Json, parser}
import io.circe.syntax.*
import org.http4s.*
import org.http4s.circe.CirceEntityDecoder.*
import org.http4s.circe.CirceEntityEncoder.*
import org.http4s.headers.`Content-Type`
import org.http4s.server.websocket.WebSocketBuilder2
import org.http4s.websocket.WebSocketFrame

import scala.concurrent.duration.*

class MultiplayerRoutesSpec extends munit.FunSuite:

  private final case class Harness(
      store: SessionStore[IO],
      rooms: RoomManager[IO],
      quickPairing: QuickPairingService[IO],
      routes: HttpRoutes[IO]
  )

  /** Turn clocks are driven explicitly, so every test stays deterministic. */
  private def harness(): Harness =
    val store = SessionStore.inMemory[IO].unsafeRunSync()
    val rooms = RoomManager.create[IO](startTurnClocks = false).unsafeRunSync()
    val quickPairing = QuickPairingService.create[IO](rooms).unsafeRunSync()
    Harness(
      store,
      rooms,
      quickPairing,
      MultiplayerRoutes.restRoutes(store, rooms, quickPairing) <+>
        QaPresetRoutes.routes(store, rooms)
    )

  private def request(
      method: Method,
      path: String,
      token: Option[String] = None,
      body: Option[Json] = None
  ): Request[IO] =
    val base = Request[IO](method, Uri.unsafeFromString(path))
    val withBody = body.fold(base) { json =>
      base
        .withEntity(json)
        .withContentType(`Content-Type`(MediaType.application.json))
    }
    token.fold(withBody)(value => withBody.addCookie(RequestCookie(SessionCookie.CookieName, value)))

  private def send(
      h: Harness,
      method: Method,
      path: String,
      token: Option[String] = None,
      body: Option[Json] = None
  ): Response[IO] =
    h.routes
      .orNotFound(request(method, path, token, body))
      .unsafeRunSync()

  private def bodyOf(response: Response[IO]): Json =
    response.as[Json].unsafeRunSync()

  private def cookieOf(response: Response[IO]): String =
    response.cookies
      .find(_.name == SessionCookie.CookieName)
      .map(_.content)
      .getOrElse(fail(s"no ${SessionCookie.CookieName} cookie in ${response.headers}"))

  private def stringField(json: Json, name: String): String =
    json.hcursor
      .get[String](name)
      .getOrElse(fail(s"missing $name in ${json.noSpaces}"))

  private def intField(json: Json, name: String): Int =
    json.hcursor
      .get[Int](name)
      .getOrElse(fail(s"missing $name in ${json.noSpaces}"))

  private def createRoom(
      h: Harness,
      playerCount: Int,
      token: Option[String] = None
  ): (String, String) =
    val response = send(
      h,
      Method.POST,
      "/api/games",
      token,
      Some(Json.obj("playerCount" -> playerCount.asJson))
    )
    assertEquals(response.status, Status.Created)
    val body = bodyOf(response)
    (stringField(body, "gameId"), token.getOrElse(cookieOf(response)))

  private def pairResponse(h: Harness, token: String, body: Json): Json =
    val response = send(h, Method.POST, "/api/quick-pair", Some(token), Some(body))
    assertEquals(response.status, Status.Ok, response.body.compile.toList.unsafeRunSync().toString)
    bodyOf(response)

  /** Asserts the caller is only queued: no room exists for them yet. */
  private def searching(h: Harness, token: String, body: Json): Json =
    val json = pairResponse(h, token, body)
    assertEquals(stringField(json, "status"), "searching", json.noSpaces)
    assert(
      json.hcursor.get[String]("gameId").isLeft,
      s"a searching answer must not carry a gameId: ${json.noSpaces}"
    )
    json

  private def pair(h: Harness, token: String, body: Json): (String, Int) =
    val json = pairResponse(h, token, body)
    assertEquals(stringField(json, "status"), "matched", json.noSpaces)
    (stringField(json, "gameId"), intField(json, "seatIndex"))

  // --- Room REST surface (REQ-11) ------------------------------------------

  test("POST /api/games mints a guest cookie and answers with a shareable room") {
    val h = harness()
    val response = send(
      h,
      Method.POST,
      "/api/games",
      body = Some(
        Json.obj(
          "playerCount" -> 3.asJson,
          "allowRedirect" -> false.asJson,
          "turnTimeoutSeconds" -> 30.asJson,
          "isPublic" -> true.asJson
        )
      )
    )

    assertEquals(response.status, Status.Created)
    val cookie = response.cookies.find(_.name == SessionCookie.CookieName).getOrElse(
      fail(s"no session cookie in ${response.headers}")
    )
    assert(cookie.httpOnly, "cookie is not HttpOnly")
    assert(cookie.sameSite.contains(SameSite.Strict), "cookie is not SameSite=Strict")
    assertEquals(cookie.path, Some("/"))

    val body = bodyOf(response)
    val gameId = stringField(body, "gameId")
    assertEquals(gameId.length, RoomManager.GameIdLength)
    assertEquals(intField(body, "seatIndex"), 0)
    assertEquals(stringField(body, "inviteUrl"), s"/g/$gameId")

    // The room is in the open lobby pool with exactly the requested settings.
    val lobby = send(h, Method.GET, "/api/lobby")
    assertEquals(lobby.status, Status.Ok)
    val rooms = bodyOf(lobby)
    assert(rooms.isArray, rooms.noSpaces)
    val summary = rooms.asArray.getOrElse(fail("lobby was not an array")).head
    assertEquals(stringField(summary, "gameId"), gameId)
    assertEquals(intField(summary, "playerCount"), 3)
    assertEquals(intField(summary, "turnTimeoutSeconds"), 30)
    assertEquals(summary.hcursor.get[Boolean]("allowRedirect").toOption, Some(false))

    // No raw game state ever reaches the lobby payload.
    assert(!rooms.noSpaces.contains("\"talon\""), rooms.noSpaces)
    assert(!rooms.noSpaces.contains("\"players\""), rooms.noSpaces)
  }

  test("POST /api/games rejects a malformed or unsupported request") {
    val h = harness()

    assertEquals(send(h, Method.POST, "/api/games").status, Status.BadRequest)
    assertEquals(
      send(h, Method.POST, "/api/games", body = Some(Json.obj("playerCount" -> 5.asJson))).status,
      Status.BadRequest
    )
    assertEquals(
      send(h, Method.POST, "/api/games", body = Some(Json.obj("playerName" -> "Alice".asJson))).status,
      Status.BadRequest
    )
    assertEquals(send(h, Method.GET, "/api/lobby").status, Status.Ok)
    assertEquals(bodyOf(send(h, Method.GET, "/api/lobby")).asArray.map(_.size), Some(0))
  }

  test("GET /api/games/:gameId projects only the caller's view and 404s an unknown room") {
    val h = harness()
    val (gameId, token) = createRoom(h, playerCount = 3)
    val playerId = h.store.findByToken(token).unsafeRunSync().map(_.playerId).getOrElse(fail("no session"))

    val response = send(h, Method.GET, s"/api/games/$gameId", Some(token))
    assertEquals(response.status, Status.Ok)
    val view = bodyOf(response)
    assertEquals(stringField(view, "gameId"), gameId)
    assertEquals(stringField(view, "viewerId"), playerId)
    assertEquals(intField(view, "viewerSeat"), 0)
    assertEquals(view.hcursor.downField("hand").as[List[Json]].toOption, Some(Nil))
    assertEquals(stringField(view, "status"), "waitingForPlayers")

    assertEquals(send(h, Method.GET, "/api/games/doesNotEx", Some(token)).status, Status.NotFound)
  }

  test("join seats the next player, starts a full room and rejects a late join") {
    val h = harness()
    val (gameId, hostToken) = createRoom(h, playerCount = 3)
    val guest = h.store.createGuest().unsafeRunSync()
    val third = h.store.createGuest().unsafeRunSync()

    val firstJoin = send(h, Method.POST, s"/api/games/$gameId/join", Some(guest.token))
    assertEquals(firstJoin.status, Status.Ok)
    val firstBody = bodyOf(firstJoin)
    assertEquals(intField(firstBody, "seatIndex"), 1)
    assertEquals(firstBody.hcursor.downField("view").get[Int]("viewerSeat").toOption, Some(1))
    assertEquals(firstBody.hcursor.downField("view").get[String]("status").toOption, Some("waitingForPlayers"))

    // Rejoining with the same guest is idempotent.
    assertEquals(send(h, Method.POST, s"/api/games/$gameId/join", Some(guest.token)).status, Status.Ok)

    val lastJoin = send(h, Method.POST, s"/api/games/$gameId/join", Some(third.token))
    assertEquals(lastJoin.status, Status.Ok)
    val startedView = bodyOf(lastJoin).hcursor.downField("view")
    assertEquals(startedView.get[String]("status").toOption, Some("inProgress"))
    assert(startedView.downField("hand").as[List[Json]].toOption.exists(_.nonEmpty))

    // A fourth player is refused, as is a room that does not exist.
    val fourth = h.store.createGuest().unsafeRunSync()
    assertEquals(send(h, Method.POST, s"/api/games/$gameId/join", Some(fourth.token)).status, Status.Conflict)
    assertEquals(send(h, Method.POST, "/api/games/doesNotEx/join", Some(fourth.token)).status, Status.NotFound)

    // A fresh guest is cookie'd on the join that minted it.
    val anonymousJoin = send(
      h,
      Method.POST,
      s"/api/games/${createRoom(h, 4)._1}/join"
    )
    assertEquals(anonymousJoin.status, Status.Ok)
    assert(anonymousJoin.cookies.exists(_.name == SessionCookie.CookieName))

    // The started match left the open pool; the host token still reads it.
    val lobby = bodyOf(send(h, Method.GET, "/api/lobby"))
    assert(!lobby.noSpaces.contains(gameId), lobby.noSpaces)
    assertEquals(send(h, Method.GET, s"/api/games/$gameId", Some(hostToken)).status, Status.Ok)
  }

  test("leave frees a waiting seat, deletes an empty room and refuses a started match") {
    val h = harness()
    val (waitingId, hostToken) = createRoom(h, playerCount = 3)
    val guest = h.store.createGuest().unsafeRunSync()
    assertEquals(send(h, Method.POST, s"/api/games/$waitingId/join", Some(guest.token)).status, Status.Ok)

    assertEquals(send(h, Method.POST, s"/api/games/$waitingId/leave", Some(guest.token)).status, Status.NoContent)
    val afterLeave = bodyOf(send(h, Method.GET, s"/api/games/$waitingId", Some(hostToken)))
    assertEquals(afterLeave.hcursor.downField("seats").as[List[Json]].toOption.map(_.size), Some(3))

    // The host leaving the now half-empty room keeps it open; leaving again as a
    // non-member is a conflict, and an unknown room is a 404.
    assertEquals(send(h, Method.POST, s"/api/games/$waitingId/leave", Some(guest.token)).status, Status.Conflict)
    assertEquals(send(h, Method.POST, "/api/games/doesNotEx/leave", Some(hostToken)).status, Status.NotFound)
    assertEquals(send(h, Method.POST, s"/api/games/$waitingId/leave", Some(hostToken)).status, Status.NoContent)
    assertEquals(send(h, Method.GET, s"/api/games/$waitingId", Some(hostToken)).status, Status.NotFound)

    // A started match cannot be abandoned.
    val (startedId, startedHost) = createRoom(h, playerCount = 2)
    val opponent = h.store.createGuest().unsafeRunSync()
    assertEquals(send(h, Method.POST, s"/api/games/$startedId/join", Some(opponent.token)).status, Status.Ok)
    assertEquals(
      send(h, Method.POST, s"/api/games/$startedId/leave", Some(startedHost)).status,
      Status.Conflict
    )
  }

  // --- Quick pairing (REQ-11) ---------------------------------------------

  test("a single queued player creates no room and stays out of the Lobby Pool") {
    val h = harness()
    val alice = h.store.createGuest().unsafeRunSync()
    val preset = Json.obj(
      "playerCount" -> 2.asJson,
      "turnTimeoutSeconds" -> 15.asJson,
      "allowRedirect" -> true.asJson
    )

    val json = searching(h, alice.token, preset)
    assertEquals(intField(json, "playerCount"), 2)
    assertEquals(intField(json, "turnTimeoutSeconds"), 15)
    assertEquals(json.hcursor.get[Boolean]("allowRedirect").toOption, Some(true))

    // Queue-first: no WaitingForPlayers room was ever created for the queued
    // player, so the public pool stays empty.
    val lobby = bodyOf(send(h, Method.GET, "/api/lobby"))
    assertEquals(lobby.asArray.map(_.size), Some(0), lobby.noSpaces)
    assertEquals(h.rooms.listOpenPublicRooms.unsafeRunSync(), Nil)
  }

  test("the last distinct player forms one dealt room and notifies the waiting player") {
    val h = harness()
    val alice = h.store.createGuest().unsafeRunSync()
    val bob = h.store.createGuest().unsafeRunSync()
    val preset = Json.obj("playerCount" -> 2.asJson, "turnTimeoutSeconds" -> 15.asJson)

    // Alice subscribes to her own `/ws/lobby` frames before she starts
    // searching, exactly as a browser does: the snapshot and the live pool
    // stream run forever, so the targeted match frame must run concurrently.
    val aliceFrames = MultiplayerRoutes
      .lobbyMessages(h.rooms, h.quickPairing, Some(alice.playerId))
      .collect { case matched: WsServerMessage.QuickPairMatched => matched }
      .take(1)
      .compile
      .toList
      .timeout(5.seconds)
      .start
      .unsafeRunSync()
    IO.sleep(50.millis).unsafeRunSync()

    searching(h, alice.token, preset)
    assertEquals(h.rooms.listOpenPublicRooms.unsafeRunSync(), Nil)

    val (gameId, bobSeat) = pair(h, bob.token, preset)
    assertEquals(bobSeat, 1)

    // Exactly one room exists, it is already in progress, and both players are
    // seated in queue order.
    val room = h.rooms.getRoom(gameId).unsafeRunSync().getOrElse(fail("no matched room"))
    assertEquals(room.status, durak.protocol.RoomStatus.InProgress)
    assert(room.gameState.nonEmpty, "a matched room must be dealt immediately")
    assertEquals(
      room.seats.flatMap(_.playerId),
      Vector(alice.playerId, bob.playerId)
    )
    assertEquals(bodyOf(send(h, Method.GET, "/api/lobby")).asArray.map(_.size), Some(0))

    // Alice, who was only waiting, is told about the same room and her seat.
    assertEquals(
      aliceFrames.joinWithNever.unsafeRunSync(),
      List(WsServerMessage.QuickPairMatched(gameId, 0))
    )
  }

  test("GET /api/quick-pair reports idle, searching and matched for the caller") {
    val h = harness()
    val alice = h.store.createGuest().unsafeRunSync()
    val bob = h.store.createGuest().unsafeRunSync()
    val preset = Json.obj("playerCount" -> 2.asJson, "turnTimeoutSeconds" -> 15.asJson)

    def statusOf(token: String): Json =
      val response = send(h, Method.GET, "/api/quick-pair", Some(token))
      assertEquals(response.status, Status.Ok)
      bodyOf(response)

    assertEquals(stringField(statusOf(alice.token), "status"), "idle")

    searching(h, alice.token, preset)
    val queued = statusOf(alice.token)
    assertEquals(stringField(queued, "status"), "searching")
    assertEquals(intField(queued, "playerCount"), 2)
    assertEquals(intField(queued, "turnTimeoutSeconds"), 15)

    val (gameId, _) = pair(h, bob.token, preset)
    // The waiting player's fallback status check recovers the same match.
    val aliceStatus = statusOf(alice.token)
    assertEquals(stringField(aliceStatus, "status"), "matched")
    assertEquals(stringField(aliceStatus, "gameId"), gameId)
    assertEquals(intField(aliceStatus, "seatIndex"), 0)
    assertEquals(intField(statusOf(bob.token), "seatIndex"), 1)

    // Cancelling clears the pending match again.
    assertEquals(send(h, Method.DELETE, "/api/quick-pair", Some(alice.token)).status, Status.NoContent)
    assertEquals(stringField(statusOf(alice.token), "status"), "idle")
  }

  test("3P and 4P presets wait for exactly three and four distinct players") {
    val h = harness()
    val threePlayers = List.fill(3)(h.store.createGuest().unsafeRunSync())
    val threePreset = Json.obj("playerCount" -> 3.asJson, "turnTimeoutSeconds" -> 15.asJson)

    searching(h, threePlayers(0).token, threePreset)
    searching(h, threePlayers(1).token, threePreset)
    assertEquals(h.rooms.listOpenPublicRooms.unsafeRunSync(), Nil)

    val (threeRoom, thirdSeat) = pair(h, threePlayers(2).token, threePreset)
    assertEquals(thirdSeat, 2)
    assertEquals(
      h.rooms.getRoom(threeRoom).unsafeRunSync().map(_.seats.flatMap(_.playerId)),
      Some(threePlayers.map(_.playerId).toVector)
    )

    val fourPlayers = List.fill(4)(h.store.createGuest().unsafeRunSync())
    val fourPreset = Json.obj("playerCount" -> 4.asJson, "turnTimeoutSeconds" -> 15.asJson)

    fourPlayers.take(3).foreach(player => searching(h, player.token, fourPreset))
    assertEquals(h.rooms.listOpenPublicRooms.unsafeRunSync(), Nil)

    val (fourRoom, fourthSeat) = pair(h, fourPlayers(3).token, fourPreset)
    assertEquals(fourthSeat, 3)
    assertEquals(
      h.rooms.getRoom(fourRoom).unsafeRunSync().map(_.seats.flatMap(_.playerId)),
      Some(fourPlayers.map(_.playerId).toVector)
    )
  }

  test("cancelling removes a queued player so the next joiner does not match with them") {
    val h = harness()
    val alice = h.store.createGuest().unsafeRunSync()
    val bob = h.store.createGuest().unsafeRunSync()
    val carol = h.store.createGuest().unsafeRunSync()
    val preset = Json.obj("playerCount" -> 2.asJson, "turnTimeoutSeconds" -> 15.asJson)

    searching(h, alice.token, preset)
    assertEquals(send(h, Method.DELETE, "/api/quick-pair", Some(alice.token)).status, Status.NoContent)

    // Bob is now first in line: alone he keeps searching instead of matching
    // with the player who cancelled.
    searching(h, bob.token, preset)
    val (gameId, carolSeat) = pair(h, carol.token, preset)
    assertEquals(carolSeat, 1)
    assertEquals(
      h.rooms.getRoom(gameId).unsafeRunSync().map(_.seats.flatMap(_.playerId)),
      Some(Vector(bob.playerId, carol.playerId))
    )
    assert(
      !h.rooms.getRoom(gameId).unsafeRunSync().exists(_.seatIndexOf(alice.playerId).isDefined)
    )
  }

  test("a player submitting twice is never matched with themselves") {
    val h = harness()
    val alice = h.store.createGuest().unsafeRunSync()
    val bob = h.store.createGuest().unsafeRunSync()
    val preset = Json.obj("playerCount" -> 2.asJson, "turnTimeoutSeconds" -> 15.asJson)

    searching(h, alice.token, preset)
    // The repeat request replaces her queue entry instead of filling the table.
    searching(h, alice.token, preset)
    assertEquals(h.rooms.listOpenPublicRooms.unsafeRunSync(), Nil)

    val (gameId, bobSeat) = pair(h, bob.token, preset)
    assertEquals(bobSeat, 1)
    val room = h.rooms.getRoom(gameId).unsafeRunSync().getOrElse(fail("no matched room"))
    assertEquals(room.seats.flatMap(_.playerId), Vector(alice.playerId, bob.playerId))
    assertEquals(room.seats.flatMap(_.playerId).distinct.size, 2)
  }

  test("quick pairing rejects an invalid preset without creating anything") {
    val h = harness()
    val alice = h.store.createGuest().unsafeRunSync()

    val invalid = send(
      h,
      Method.POST,
      "/api/quick-pair",
      Some(alice.token),
      Some(Json.obj("playerCount" -> 5.asJson))
    )
    assertEquals(invalid.status, Status.BadRequest)
    assertEquals(h.rooms.listOpenPublicRooms.unsafeRunSync(), Nil)
  }

  // --- QA scenario presets ------------------------------------------------

  test("seed-lobby creates the three documented open rooms") {
    val h = harness()

    val response = send(h, Method.POST, "/api/qa/presets/seed-lobby")
    assertEquals(response.status, Status.Ok)
    val rooms = bodyOf(response)
      .hcursor
      .downField("rooms")
      .as[List[Json]]
      .getOrElse(fail("missing rooms"))
    assertEquals(rooms.size, 3)
    assertEquals(
      rooms.map(room =>
        (
          room.hcursor.get[Int]("playerCount").toOption,
          room.hcursor.get[Int]("turnTimeoutSeconds").toOption,
          room.hcursor.get[Boolean]("allowRedirect").toOption
        )
      ),
      List(
        (Some(2), Some(15), Some(true)),
        (Some(3), Some(30), Some(false)),
        (Some(4), Some(15), Some(true))
      )
    )
    assert(rooms.forall(_.hcursor.get[String]("hostName").exists(_.startsWith("QA"))))

    // The preset rooms are real, joinable lobby rooms.
    val lobby = bodyOf(send(h, Method.GET, "/api/lobby"))
    val gameIds = lobby.asArray.getOrElse(fail("lobby was not an array"))
    assertEquals(gameIds.size, 3)
  }

  test("/ws/lobby frames start with a snapshot and then stream live updates") {
    val h = harness()
    val frames = MultiplayerRoutes
      .lobbyMessages(h.rooms, h.quickPairing, None)
      .take(4)
      .compile
      .toList
      .start
      .unsafeRunSync()
    IO.sleep(100.millis).unsafeRunSync()

    assertEquals(send(h, Method.POST, "/api/qa/presets/seed-lobby").status, Status.Ok)
    val messages = frames.joinWithNever.unsafeRunSync()

    messages.head match
      case WsServerMessage.LobbySnapshot(rooms) => assertEquals(rooms, Nil)
      case other                                => fail(s"expected a lobby snapshot, got $other")

    messages.last match
      case WsServerMessage.LobbyUpdated(rooms) =>
        assertEquals(rooms.size, 3)
        assert(rooms.forall(_.playerCount >= 2))
      case other => fail(s"expected a lobby update, got $other")
  }

  test("active-match seats the caller in seat 0 of a dealt game") {
    val h = harness()
    val response = send(
      h,
      Method.POST,
      "/api/qa/presets/active-match",
      body = Some(Json.obj("playerCount" -> 3.asJson))
    )
    assertEquals(response.status, Status.Ok)
    val cookie = cookieOf(response)
    val prepared = bodyOf(response)
    val gameId = stringField(prepared, "gameId")
    assertEquals(intField(prepared, "seatIndex"), 0)

    val view = bodyOf(send(h, Method.GET, s"/api/games/$gameId", Some(cookie)))
    assertEquals(stringField(view, "status"), "inProgress")
    assertEquals(intField(view, "viewerSeat"), 0)
    assert(view.hcursor.downField("hand").as[List[Json]].toOption.exists(_.nonEmpty))

    val playerIds = view.hcursor
      .downField("seats")
      .as[List[Json]]
      .getOrElse(fail("missing seats"))
      .flatMap(_.hcursor.get[String]("playerId").toOption)
    assertEquals(playerIds.size, 3)
    assert(playerIds.exists(_.startsWith(QaPresetRoutes.SyntheticOpponentPrefix)), playerIds.toString)

    // Private: a QA match never clutters the open lobby pool.
    assertEquals(bodyOf(send(h, Method.GET, "/api/lobby")).asArray.map(_.size), Some(0))
  }

  test("spectator-match is a full match the caller only watches") {
    val h = harness()
    val response = send(h, Method.POST, "/api/qa/presets/spectator-match")
    assertEquals(response.status, Status.Ok)
    val cookie = cookieOf(response)
    val gameId = stringField(bodyOf(response), "gameId")

    val view = bodyOf(send(h, Method.GET, s"/api/games/$gameId", Some(cookie)))
    assertEquals(stringField(view, "status"), "inProgress")
    assertEquals(view.hcursor.downField("viewerSeat").focus, Some(Json.Null))
    assertEquals(view.hcursor.downField("hand").as[List[Json]].toOption, Some(Nil))

    val playerIds = view.hcursor
      .downField("seats")
      .as[List[Json]]
      .getOrElse(fail("missing seats"))
      .flatMap(_.hcursor.get[String]("playerId").toOption)
    assertEquals(playerIds, QaPresetRoutes.SpectatorSeats.map(_._1).toList)

    // The caller's own session is not one of the seats.
    val caller = h.store.findByToken(cookie).unsafeRunSync().map(_.playerId)
    assert(caller.exists(id => !playerIds.contains(id)), caller.toString)
  }

  test("the preset body defaults to a two-player active match and rejects unknown seat counts") {
    val h = harness()

    val defaulted = send(h, Method.POST, "/api/qa/presets/active-match")
    assertEquals(defaulted.status, Status.Ok)
    val gameId = stringField(bodyOf(defaulted), "gameId")
    val view = bodyOf(send(h, Method.GET, s"/api/games/$gameId", Some(cookieOf(defaulted))))
    assertEquals(view.hcursor.downField("seats").as[List[Json]].toOption.map(_.size), Some(2))

    val rejected = send(
      h,
      Method.POST,
      "/api/qa/presets/active-match",
      body = Some(parser.parse("""{"playerCount":7}""").getOrElse(fail("bad fixture")))
    )
    assertEquals(rejected.status, Status.BadRequest)
  }

  // --- Game WebSocket ------------------------------------------------------

  private final case class LiveSocket(
      socket: MultiplayerRoutes.GameSocket,
      inbound: Queue[IO, WebSocketFrame],
      initial: PlayerGameView,
      inboundFiber: Fiber[IO, Throwable, Unit],
      release: IO[Unit]
  ):
    def sendFrame(text: String): Unit =
      inbound.offer(WebSocketFrame.Text(text)).unsafeRunSync()

    def close(): Unit =
      inboundFiber.cancel.unsafeRunSync()
      release.unsafeRunSync()

  /** Opens the exact socket the route opens and consumes its first frame. */
  private def openSocket(h: Harness, gameId: String, viewerId: String): LiveSocket =
    val (socket, release) =
      MultiplayerRoutes.gameSocket(h.rooms, gameId, viewerId).allocated.unsafeRunSync()
    val initial = socket.messages.take(1).compile.toList.timeout(5.seconds).unsafeRunSync().head
    val inbound = Queue.unbounded[IO, WebSocketFrame].unsafeRunSync()
    val fiber =
      socket.handle(Stream.fromQueueUnterminated(inbound)).compile.drain.start.unsafeRunSync()
    LiveSocket(socket, inbound, viewOf(initial), fiber, release)

  private def nextMessages(
      socket: MultiplayerRoutes.GameSocket,
      count: Int = 1
  ): List[WsServerMessage] =
    socket.messages.take(count.toLong).compile.toList.timeout(5.seconds).unsafeRunSync()

  private def viewOf(message: WsServerMessage): PlayerGameView = message match
    case WsServerMessage.GameViewUpdate(view) => view
    case other                               => fail(s"expected a game view update, got $other")

  private def startedRoom(h: Harness): (String, String, String) =
    val (gameId, hostToken) = createRoom(h, playerCount = 2)
    val opponent = h.store.createGuest().unsafeRunSync()
    assertEquals(send(h, Method.POST, s"/api/games/$gameId/join", Some(opponent.token)).status, Status.Ok)
    val hostId = h.store
      .findByToken(hostToken)
      .unsafeRunSync()
      .map(_.playerId)
      .getOrElse(fail("host session disappeared"))
    (gameId, hostToken, hostId)

  test("the game socket projects the seat immediately and flips presence on close") {
    val h = harness()
    val (gameId, _, hostId) = startedRoom(h)

    val live = openSocket(h, gameId, hostId)
    assertEquals(live.initial.viewerId, hostId)
    assertEquals(live.initial.viewerSeat, Some(0))
    assert(live.initial.hand.nonEmpty, "a seated viewer must receive their own hand")
    assertEquals(live.initial.seats.find(_.seatIndex == 0).map(_.isConnected), Some(true))

    // Peers are told when this socket goes away, without any close handshake.
    live.close()
    val afterClose = h.rooms
      .getRoomView(gameId, hostId)
      .unsafeRunSync()
      .getOrElse(fail("room disappeared"))
    assertEquals(afterClose.seats.find(_.seatIndex == 0).map(_.isConnected), Some(false))
    assertEquals(afterClose.hand, live.initial.hand)
  }

  test("the game socket answers Ping and rejects malformed payloads without dying") {
    val h = harness()
    val (gameId, _, hostId) = startedRoom(h)
    val live = openSocket(h, gameId, hostId)

    live.sendFrame("""{"type":"ping"}""")
    assertEquals(nextMessages(live.socket).head, WsServerMessage.Pong)

    // Malformed JSON is answered with INVALID_PAYLOAD, not a dead stream.
    live.sendFrame("this is not json")
    val malformed = nextMessages(live.socket).head match
      case WsServerMessage.ActionRejected(code, message) => (code, message)
      case other                                        => fail(s"expected a rejection, got $other")
    assertEquals(malformed._1, MultiplayerRoutes.InvalidPayloadCode)
    assert(malformed._2.nonEmpty)

    // The socket still works after the rejection.
    live.sendFrame("""{"type":"ping"}""")
    assertEquals(nextMessages(live.socket).head, WsServerMessage.Pong)

    // A well-formed frame of an unknown type is rejected the same way.
    live.sendFrame("""{"type":"teleport"}""")
    nextMessages(live.socket).head match
      case WsServerMessage.ActionRejected(code, _) =>
        assertEquals(code, MultiplayerRoutes.InvalidPayloadCode)
      case other => fail(s"expected a rejection, got $other")

    live.close()
  }

  test("the game socket rejects a spectator's action and leaves the game untouched") {
    val h = harness()
    val (gameId, _, _) = startedRoom(h)
    val before = h.rooms.getRoom(gameId).unsafeRunSync().flatMap(_.gameState)

    val live = openSocket(h, gameId, "nosy-spectator")
    assertEquals(live.initial.viewerSeat, None)
    assertEquals(live.initial.hand, Nil)
    assertEquals(live.initial.seats.size, 2)

    live.sendFrame("""{"type":"passTurn"}""")
    nextMessages(live.socket).head match
      case WsServerMessage.ActionRejected(code, message) =>
        assertEquals(code, "UNAUTHORIZED")
        assert(message.nonEmpty)
      case other => fail(s"expected an unauthorized rejection, got $other")

    assertEquals(h.rooms.getRoom(gameId).unsafeRunSync().flatMap(_.gameState), before)
    live.close()
  }

  test("a seated player's action is applied and broadcast to every socket") {
    val h = harness()
    val (gameId, _, hostId) = startedRoom(h)
    val state = h.rooms
      .getRoom(gameId)
      .unsafeRunSync()
      .flatMap(_.gameState)
      .getOrElse(fail("started room has no game state"))
    val attackerId = state.players(state.attackerIdx).id
    val attackerCard = state.players(state.attackerIdx).hand.head
    // Open the spectator first, so the only frame it receives before the move
    // is the attacker's own presence broadcast.
    val spectator = openSocket(h, gameId, "watcher")
    val attacker = openSocket(h, gameId, attackerId)

    attacker.sendFrame(
      s"""{"type":"playAttack","cards":[${attackerCard.asJson.noSpaces}]}"""
    )

    val attackerFrame = viewOf(nextMessages(attacker.socket).head)
    assert(attackerFrame.tablePairs.nonEmpty, "the attacker's own frame shows the attack")
    val spectatorFrame = viewOf(nextMessages(spectator.socket, 2).last)
    assert(spectatorFrame.tablePairs.nonEmpty, "the spectator's frame follows the same table")
    assertEquals(spectatorFrame.viewerSeat, None)
    assertEquals(spectatorFrame.hand, Nil)

    attacker.close()
    spectator.close()
  }

  // --- Server wiring -------------------------------------------------------

  test("Main.httpApp mounts the M1 and M2 routers side by side") {
    val h = harness()
    val manager = GameManager.create.unsafeRunSync()
    val wsBuilder = WebSocketBuilder2[IO].unsafeRunSync()
    val app = durak.Main.httpApp(
      local = GameRoutes.restRoutes(manager),
      multiplayer = MultiplayerRoutes.routes(h.store, h.rooms, h.quickPairing)(using wsBuilder),
      sessions = SessionRoutes.routes(h.store),
      presets = QaPresetRoutes.routes(h.store, h.rooms)
    )

    def sendApp(
        method: Method,
        path: String,
        token: Option[String] = None,
        body: Option[Json] = None
    ): Response[IO] =
      app.orNotFound(request(method, path, token, body)).unsafeRunSync()

    // M2: the lobby mints the guest cookie on the first visit.
    val lobby = sendApp(Method.GET, "/api/lobby")
    assertEquals(lobby.status, Status.Ok)
    assert(lobby.cookies.exists(_.name == SessionCookie.CookieName), "lobby did not set a cookie")

    // M2: room creation, projection, joining and leaving are reachable.
    val created = sendApp(Method.POST, "/api/games", body = Some(Json.obj("playerCount" -> 3.asJson)))
    assertEquals(created.status, Status.Created)
    val cookie = cookieOf(created)
    val gameId = stringField(bodyOf(created), "gameId")
    assertEquals(sendApp(Method.GET, s"/api/games/$gameId", Some(cookie)).status, Status.Ok)

    val joiner = h.store.createGuest().unsafeRunSync()
    assertEquals(sendApp(Method.POST, s"/api/games/$gameId/join", Some(joiner.token)).status, Status.Ok)
    assertEquals(sendApp(Method.POST, s"/api/games/$gameId/leave", Some(joiner.token)).status, Status.NoContent)

    // M2: quick pairing, its cancellation and the QA presets.
    assertEquals(
      sendApp(
        Method.POST,
        "/api/quick-pair",
        Some(cookie),
        Some(Json.obj("playerCount" -> 3.asJson))
      ).status,
      Status.Ok
    )
    assertEquals(sendApp(Method.DELETE, "/api/quick-pair", Some(cookie)).status, Status.NoContent)
    assertEquals(sendApp(Method.POST, "/api/qa/presets/seed-lobby").status, Status.Ok)

    // M1: the legacy local/bot creation still lands on the GameRoutes router.
    val legacy = sendApp(
      Method.POST,
      "/api/games",
      body = Some(
        Json.obj(
          "playerCount" -> 2.asJson,
          "playerNames" -> List("Alice", "Bob").asJson
        )
      )
    )
    assertEquals(legacy.status, Status.Ok)
    val legacyBody = bodyOf(legacy)
    assert(legacyBody.hcursor.downField("players").focus.isDefined, legacyBody.noSpaces)
    assert(legacyBody.noSpaces.contains("\"playerTypes\""), legacyBody.noSpaces)
    val legacyId = stringField(legacyBody, "gameId")

    // M1: its own view route and the M1 session routes are still mounted.
    assertEquals(sendApp(Method.GET, s"/api/games/$legacyId/view?player=p0").status, Status.Ok)
    assertEquals(sendApp(Method.GET, "/api/session").status, Status.Ok)

    // Both WebSocket routes are mounted: the standalone builder answers a
    // non-upgrade GET with its 501 default, which only a matched WS route can
    // produce, and an unknown game socket is a clean 404.
    assertEquals(sendApp(Method.GET, "/ws/lobby").status, Status.NotImplemented)
    assertEquals(sendApp(Method.GET, "/ws/games/doesNotEx").status, Status.NotFound)
  }
