package durak.http

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import durak.lobby.QuickPairingService
import durak.protocol.WsServerMessage
import durak.rooms.RoomManager
import durak.session.{SessionCookie, SessionStore}
import io.circe.{Json, parser}
import io.circe.syntax.*
import org.http4s.*
import org.http4s.circe.CirceEntityDecoder.*
import org.http4s.circe.CirceEntityEncoder.*
import org.http4s.headers.`Content-Type`

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

  private def pair(
      h: Harness,
      token: String,
      body: Json
  ): (String, Int) =
    val response = send(h, Method.POST, "/api/quick-pair", Some(token), Some(body))
    assertEquals(response.status, Status.Ok, response.body.compile.toList.unsafeRunSync().toString)
    val json = bodyOf(response)
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

  test("quick pairing matches identical presets into one room and separates different ones") {
    val h = harness()
    val alice = h.store.createGuest().unsafeRunSync()
    val bob = h.store.createGuest().unsafeRunSync()
    val carol = h.store.createGuest().unsafeRunSync()
    val preset = Json.obj(
      "playerCount" -> 3.asJson,
      "turnTimeoutSeconds" -> 30.asJson,
      "allowRedirect" -> false.asJson
    )

    val (aliceRoom, aliceSeat) = pair(h, alice.token, preset)
    val (bobRoom, bobSeat) = pair(h, bob.token, preset)
    assertEquals(bobRoom, aliceRoom)
    assertEquals(aliceSeat, 0)
    assertEquals(bobSeat, 1)

    // Repeating the request returns the same room and seat, never a new room.
    assertEquals(pair(h, alice.token, preset), (aliceRoom, aliceSeat))

    // A different preset gets its own room.
    val (carolRoom, carolSeat) = pair(
      h,
      carol.token,
      Json.obj(
        "playerCount" -> 3.asJson,
        "turnTimeoutSeconds" -> 15.asJson,
        "allowRedirect" -> false.asJson
      )
    )
    assertNotEquals(carolRoom, aliceRoom)
    assertEquals(carolSeat, 0)

    // Both waiting rooms are live and joinable in the lobby.
    val lobby = bodyOf(send(h, Method.GET, "/api/lobby"))
    assert(lobby.noSpaces.contains(aliceRoom), lobby.noSpaces)
    assert(lobby.noSpaces.contains(carolRoom), lobby.noSpaces)
    assert(lobby.noSpaces.contains("\"isQuickPair\":true"), lobby.noSpaces)

    // Cancelling removes the player from their waiting room.
    assertEquals(send(h, Method.DELETE, "/api/quick-pair", Some(carol.token)).status, Status.NoContent)
    val afterCancel = bodyOf(send(h, Method.GET, "/api/lobby"))
    assert(!afterCancel.noSpaces.contains(carolRoom), afterCancel.noSpaces)
    assert(afterCancel.noSpaces.contains(aliceRoom), afterCancel.noSpaces)
  }

  test("a full quick-pair room starts and leaves the pool") {
    val h = harness()
    val alice = h.store.createGuest().unsafeRunSync()
    val bob = h.store.createGuest().unsafeRunSync()
    val preset = Json.obj("playerCount" -> 2.asJson, "turnTimeoutSeconds" -> 15.asJson)

    val (gameId, firstSeat) = pair(h, alice.token, preset)
    val (sameRoom, secondSeat) = pair(h, bob.token, preset)
    assertEquals(sameRoom, gameId)
    assertEquals(List(firstSeat, secondSeat), List(0, 1))

    assertEquals(bodyOf(send(h, Method.GET, "/api/lobby")).asArray.map(_.size), Some(0))
    assertEquals(
      send(h, Method.GET, s"/api/games/$gameId", Some(alice.token)).status,
      Status.Ok
    )

    // An invalid preset is refused without creating anything.
    val invalid = send(
      h,
      Method.POST,
      "/api/quick-pair",
      Some(alice.token),
      Some(Json.obj("playerCount" -> 5.asJson))
    )
    assertEquals(invalid.status, Status.BadRequest)
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
      .lobbyMessages(h.rooms)
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
