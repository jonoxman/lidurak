package durak.http

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import com.comcast.ip4s.*
import durak.lobby.QuickPairingService
import durak.rooms.RoomManager
import durak.session.{GuestSession, SessionCookie, SessionStore}
import io.circe.{Json, parser}
import io.circe.syntax.*
import org.http4s.*
import org.http4s.circe.CirceEntityDecoder.*
import org.http4s.circe.CirceEntityEncoder.*
import org.http4s.ember.server.EmberServerBuilder
import org.http4s.server.websocket.WebSocketBuilder2
import org.typelevel.ci.CIString

import java.net.URI
import java.net.http.{HttpClient, WebSocket}
import java.util.concurrent.{CompletableFuture, CompletionStage, LinkedBlockingQueue, TimeUnit}
import scala.concurrent.duration.*

/**
 * End-to-end coverage of the M2 multiplayer surface.
 *
 * REST endpoints are exercised through the real `HttpRoutes` (cookies, JSON
 * bodies and statuses included). The two WebSocket endpoints run against a real
 * Ember server on an ephemeral port and a JDK WebSocket client, so presence,
 * per-viewer projection and frame handling are tested over an actual socket.
 */
class MultiplayerRoutesSpec extends munit.FunSuite:

  private final case class Fixture(
      sessions: SessionStore[IO],
      rooms: RoomManager[IO],
      quickPair: QuickPairingService[IO],
      routes: HttpRoutes[IO]
  ):
    def guest(name: String): GuestSession =
      sessions.createGuest(Some(name)).unsafeRunSync()

    def send(request: Request[IO]): Response[IO] =
      routes.orNotFound.run(request).unsafeRunSync()

    def bodyOf(response: Response[IO]): Json =
      response.as[Json].unsafeRunSync()

  /** A fresh, clock-free room pool so no turn-timeout auto-move interferes. */
  private def newFixture(): Fixture =
    val sessions = SessionStore.inMemory[IO].unsafeRunSync()
    val rooms = RoomManager.create[IO](startTurnClocks = false).unsafeRunSync()
    val quickPair = QuickPairingService.create[IO](rooms).unsafeRunSync()
    val routes =
      QaPresetRoutes.routes(sessions, rooms) <+>
        MultiplayerRoutes.restRoutes(sessions, rooms, quickPair)
    Fixture(sessions, rooms, quickPair, routes)

  private def request(
      method: Method,
      path: String,
      token: Option[String] = None,
      body: Option[Json] = None
  ): Request[IO] =
    val base = Request[IO](method, Uri.unsafeFromString(path))
    val authed = token.fold(base) { value =>
      base.putHeaders(Header.Raw(CIString(SessionCookie.HeaderName), value))
    }
    body.fold(authed)(json => authed.withEntity(json))

  private def createRoomBody(
      playerCount: Int = 2,
      allowRedirect: Boolean = true,
      turnTimeoutSeconds: Int = 15,
      isPublic: Boolean = true
  ): Json =
    Json.obj(
      "playerCount" -> playerCount.asJson,
      "allowRedirect" -> allowRedirect.asJson,
      "turnTimeoutSeconds" -> turnTimeoutSeconds.asJson,
      "isPublic" -> isPublic.asJson
    )

  private def field(json: Json, name: String): Json =
    json.hcursor.downField(name).focus.getOrElse(
      fail(s"missing $name in ${json.noSpaces}")
    )

  private def stringField(json: Json, name: String): String =
    json.hcursor.get[String](name).getOrElse(fail(s"missing $name in ${json.noSpaces}"))

  private def createRoom(fx: Fixture, host: GuestSession, playerCount: Int = 2): String =
    val response = fx.send(
      request(Method.POST, "/api/games", Some(host.token), Some(createRoomBody(playerCount)))
    )
    assertEquals(response.status, Status.Created)
    stringField(fx.bodyOf(response), "gameId")

  private def joinGame(fx: Fixture, gameId: String, guest: GuestSession): Response[IO] =
    fx.send(request(Method.POST, s"/api/games/$gameId/join", Some(guest.token)))

  private def startMatch(fx: Fixture, playerCount: Int = 2): (GuestSession, List[GuestSession], String) =
    val host = fx.guest("Host")
    val others = (1 until playerCount).toList.map(index => fx.guest(s"Seat $index"))
    val gameId = createRoom(fx, host, playerCount)
    others.foreach { guest =>
      assertEquals(joinGame(fx, gameId, guest).status, Status.Ok)
    }
    (host, others, gameId)

  // --- REST: rooms, lobby and projection ----------------------------------

  test("POST /api/games mints a guest cookie, seats the host and lists the room") {
    val fx = newFixture()
    val response = fx.send(
      request(Method.POST, "/api/games", body = Some(createRoomBody()))
    )

    assertEquals(response.status, Status.Created)
    val cookie = response.cookies
      .find(_.name == SessionCookie.CookieName)
      .getOrElse(fail(s"no session cookie in ${response.headers}"))
    assert(cookie.httpOnly, "cookie is not HttpOnly")
    assert(cookie.sameSite.contains(SameSite.Strict), "cookie is not SameSite=Strict")

    val body = fx.bodyOf(response)
    val gameId = stringField(body, "gameId")
    assertEquals(gameId.length, 8)
    assertEquals(body.hcursor.get[Int]("seatIndex").toOption, Some(0))
    assertEquals(stringField(body, "inviteUrl"), s"/g/$gameId")

    val lobby = fx.bodyOf(fx.send(request(Method.GET, "/api/lobby")))
    val rooms = lobby.asArray.getOrElse(fail("lobby is not an array"))
    assertEquals(rooms.size, 1)
    val summary = rooms.head
    assertEquals(stringField(summary, "gameId"), gameId)
    assertEquals(summary.hcursor.get[Int]("filledSeats").toOption, Some(1))
    assertEquals(summary.hcursor.get[Int]("playerCount").toOption, Some(2))
    assertEquals(summary.hcursor.get[Boolean]("isQuickPair").toOption, Some(false))
  }

  test("POST /api/games rejects an invalid player count with 400") {
    val fx = newFixture()
    val host = fx.guest("Host")

    val response = fx.send(
      request(Method.POST, "/api/games", Some(host.token), Some(createRoomBody(5)))
    )

    assertEquals(response.status, Status.BadRequest)
    assert(fx.bodyOf(response).hcursor.get[String]("error").exists(_.nonEmpty))
  }

  test("GET /api/games/:gameId returns only the caller's filtered view") {
    val fx = newFixture()
    val host = fx.guest("Host")
    val gameId = createRoom(fx, host)

    val response = fx.send(request(Method.GET, s"/api/games/$gameId", Some(host.token)))

    assertEquals(response.status, Status.Ok)
    val view = fx.bodyOf(response)
    assertEquals(stringField(view, "gameId"), gameId)
    assertEquals(stringField(view, "status"), "waitingForPlayers")
    assertEquals(view.hcursor.get[Int]("viewerSeat").toOption, Some(0))
    assertEquals(view.hcursor.get[List[Json]]("hand").map(_.size).toOption, Some(0))
    // No raw GameState fields may ever reach the wire.
    assert(view.hcursor.downField("gameState").focus.isEmpty, view.noSpaces)
    assert(view.hcursor.downField("talon").focus.isEmpty, view.noSpaces)
    assert(view.hcursor.downField("discardPile").focus.isEmpty, view.noSpaces)
  }

  test("GET /api/games/:gameId answers 404 for an unknown room") {
    val fx = newFixture()
    val host = fx.guest("Host")

    val response = fx.send(request(Method.GET, "/api/games/nope1234", Some(host.token)))
    assertEquals(response.status, Status.NotFound)
  }

  test("joining the last seat auto-starts the match and never leaks the other hand") {
    val fx = newFixture()
    val host = fx.guest("Host")
    val rival = fx.guest("Rival")
    val gameId = createRoom(fx, host)

    val joined = joinGame(fx, gameId, rival)
    assertEquals(joined.status, Status.Ok)
    val joinedBody = fx.bodyOf(joined)
    assertEquals(joinedBody.hcursor.get[Int]("seatIndex").toOption, Some(1))
    val rivalView = field(joinedBody, "view")
    assertEquals(stringField(rivalView, "status"), "inProgress")
    assertEquals(rivalView.hcursor.get[Int]("viewerSeat").toOption, Some(1))
    val rivalHand = rivalView.hcursor.get[List[Json]]("hand").getOrElse(Nil)
    assertEquals(rivalHand.size, 6)

    val hostView = fx.bodyOf(fx.send(request(Method.GET, s"/api/games/$gameId", Some(host.token))))
    val hostHand = hostView.hcursor.get[List[Json]]("hand").getOrElse(Nil)
    assertEquals(hostHand.size, 6)
    hostHand.foreach { card =>
      assert(!rivalHand.contains(card), s"rival received host card $card")
    }

    // The started room left the open lobby pool.
    val lobby = fx.bodyOf(fx.send(request(Method.GET, "/api/lobby")))
    assertEquals(lobby.asArray.map(_.size), Some(0))

    // A third player can no longer take a seat.
    val third = fx.guest("Third")
    assertEquals(joinGame(fx, gameId, third).status, Status.Conflict)
  }

  test("POST join answers 404 for a missing room and 409 once started") {
    val fx = newFixture()
    assertEquals(
      joinGame(fx, "missing1", fx.guest("Late")).status,
      Status.NotFound
    )

    val (host, _, gameId) = startMatch(fx)
    val joinedAgain = fx.send(
      request(Method.POST, s"/api/games/$gameId/join", Some(host.token))
    )
    // The seated host re-attaches idempotently, even mid-match.
    assertEquals(joinedAgain.status, Status.Ok)
    assertEquals(
      fx.bodyOf(joinedAgain).hcursor.get[Int]("seatIndex").toOption,
      Some(0)
    )
  }

  test("POST leave frees a waiting seat, removes the room, and rejects a started match") {
    val fx = newFixture()
    val host = fx.guest("Host")
    val gameId = createRoom(fx, host)

    val left = fx.send(request(Method.POST, s"/api/games/$gameId/leave", Some(host.token)))
    assertEquals(left.status, Status.NoContent)
    assertEquals(
      fx.bodyOf(fx.send(request(Method.GET, "/api/lobby"))).asArray.map(_.size),
      Some(0)
    )

    val (startedHost, _, startedGameId) = startMatch(fx)
    val rejected = fx.send(
      request(Method.POST, s"/api/games/$startedGameId/leave", Some(startedHost.token))
    )
    assertEquals(rejected.status, Status.Conflict)
    assertEquals(
      fx.send(request(Method.POST, "/api/games/nope1234/leave", Some(startedHost.token))).status,
      Status.NotFound
    )
  }

  test("GET /api/lobby only lists open public rooms") {
    val fx = newFixture()
    val host = fx.guest("Host")
    val privateResponse = fx.send(
      request(
        Method.POST,
        "/api/games",
        Some(host.token),
        Some(createRoomBody(isPublic = false))
      )
    )
    assertEquals(privateResponse.status, Status.Created)
    assertEquals(
      fx.bodyOf(fx.send(request(Method.GET, "/api/lobby"))).asArray.map(_.size),
      Some(0)
    )

    val publicGameId = createRoom(fx, fx.guest("Public Host"))
    val lobby = fx.bodyOf(fx.send(request(Method.GET, "/api/lobby")))
    assertEquals(lobby.asArray.map(_.map(stringField(_, "gameId")).toList), Some(List(publicGameId)))
  }

  // --- Quick pairing -------------------------------------------------------

  test("quick pairing matches identical presets into one room and honours seating") {
    val fx = newFixture()
    val alice = fx.guest("Alice")
    val bob = fx.guest("Bob")

    val first = fx.send(
      request(Method.POST, "/api/quick-pair", Some(alice.token), Some(Json.obj("playerCount" -> 2.asJson)))
    )
    assertEquals(first.status, Status.Ok)
    val firstBody = fx.bodyOf(first)
    val gameId = stringField(firstBody, "gameId")
    assertEquals(firstBody.hcursor.get[Int]("seatIndex").toOption, Some(0))

    val second = fx.send(
      request(Method.POST, "/api/quick-pair", Some(bob.token), Some(Json.obj("playerCount" -> 2.asJson)))
    )
    val secondBody = fx.bodyOf(second)
    assertEquals(stringField(secondBody, "gameId"), gameId)
    assertEquals(secondBody.hcursor.get[Int]("seatIndex").toOption, Some(1))

    // The paired room started and left the pool.
    assertEquals(
      fx.bodyOf(fx.send(request(Method.GET, "/api/lobby"))).asArray.map(_.size),
      Some(0)
    )
  }

  test("quick pairing keeps different presets in different rooms and is idempotent while waiting") {
    val fx = newFixture()
    val carol = fx.guest("Carol")
    val dave = fx.guest("Dave")

    val twoPlayer = fx.bodyOf(
      fx.send(
        request(Method.POST, "/api/quick-pair", Some(carol.token), Some(Json.obj("playerCount" -> 2.asJson)))
      )
    )
    val fourPlayer = fx.bodyOf(
      fx.send(
        request(Method.POST, "/api/quick-pair", Some(dave.token), Some(Json.obj("playerCount" -> 4.asJson)))
      )
    )
    assertNotEquals(stringField(twoPlayer, "gameId"), stringField(fourPlayer, "gameId"))

    // Asking again while still waiting returns the same room and seat.
    val again = fx.bodyOf(
      fx.send(
        request(Method.POST, "/api/quick-pair", Some(carol.token), Some(Json.obj("playerCount" -> 2.asJson)))
      )
    )
    assertEquals(stringField(again, "gameId"), stringField(twoPlayer, "gameId"))
    assertEquals(again.hcursor.get[Int]("seatIndex").toOption, Some(0))
  }

  test("DELETE /api/quick-pair cancels the waiting pairing and empties its room") {
    val fx = newFixture()
    val erin = fx.guest("Erin")

    val paired = fx.bodyOf(
      fx.send(
        request(Method.POST, "/api/quick-pair", Some(erin.token), Some(Json.obj("playerCount" -> 3.asJson)))
      )
    )
    val gameId = stringField(paired, "gameId")
    assertEquals(fx.bodyOf(fx.send(request(Method.GET, "/api/lobby"))).asArray.map(_.size), Some(1))

    val cancelled = fx.send(request(Method.DELETE, "/api/quick-pair", Some(erin.token)))
    assertEquals(cancelled.status, Status.NoContent)
    val lobby = fx.bodyOf(fx.send(request(Method.GET, "/api/lobby")))
    assert(!lobby.noSpaces.contains(gameId), lobby.noSpaces)
    assertEquals(lobby.asArray.map(_.size), Some(0))
  }

  // --- QA scenario presets -------------------------------------------------

  test("seed-lobby creates the three open preset rooms with their advertised rules") {
    val fx = newFixture()

    val response = fx.send(request(Method.POST, "/api/qa/presets/seed-lobby"))
    assertEquals(response.status, Status.Ok)
    val seeded = field(fx.bodyOf(response), "rooms").asArray.getOrElse(fail("no rooms array"))
    assertEquals(seeded.size, 3)

    val fingerprints = seeded.map { room =>
      (
        room.hcursor.get[Int]("playerCount").toOption,
        room.hcursor.get[Int]("turnTimeoutSeconds").toOption,
        room.hcursor.get[Boolean]("allowRedirect").toOption,
        room.hcursor.get[Int]("filledSeats").toOption
      )
    }.toSet
    assertEquals(
      fingerprints,
      Set(
        (Some(2), Some(15), Some(true), Some(1)),
        (Some(3), Some(30), Some(false), Some(1)),
        (Some(4), Some(15), Some(true), Some(1))
      )
    )
    seeded.foreach { room =>
      assert(stringField(room, "hostName").startsWith("QA Host"), room.noSpaces)
    }

    // The seeded rooms are visible to the live lobby REST hydration too.
    val lobby = fx.bodyOf(fx.send(request(Method.GET, "/api/lobby")))
    assertEquals(lobby.asArray.map(_.size), Some(3))
  }

  test("active-match seats the caller in a running match with synthetic opponents") {
    val fx = newFixture()
    val caller = fx.guest("Caller")

    val response = fx.send(
      request(
        Method.POST,
        "/api/qa/presets/active-match",
        Some(caller.token),
        Some(Json.obj("playerCount" -> 3.asJson))
      )
    )
    assertEquals(response.status, Status.Ok)
    val body = fx.bodyOf(response)
    val gameId = stringField(body, "gameId")
    assertEquals(body.hcursor.get[Int]("seatIndex").toOption, Some(0))

    val view = fx.bodyOf(fx.send(request(Method.GET, s"/api/games/$gameId", Some(caller.token))))
    assertEquals(stringField(view, "status"), "inProgress")
    assertEquals(view.hcursor.get[Int]("viewerSeat").toOption, Some(0))
    assertEquals(view.hcursor.get[List[Json]]("hand").map(_.size).toOption, Some(6))
    assertEquals(
      view.hcursor.downField("config").downField("playerCount").as[Int].toOption,
      Some(3)
    )
    val players = view.hcursor.get[List[Json]]("players").getOrElse(Nil)
    assertEquals(players.size, 3)
    assert(players.exists(p => stringField(p, "id") == caller.playerId), view.noSpaces)
    assert(players.exists(p => stringField(p, "id").startsWith("qa-opp-")), view.noSpaces)
  }

  test("spectator-match gives the caller an empty hand and no seat") {
    val fx = newFixture()
    val caller = fx.guest("Watcher")

    val response = fx.send(
      request(Method.POST, "/api/qa/presets/spectator-match", Some(caller.token))
    )
    assertEquals(response.status, Status.Ok)
    val gameId = stringField(fx.bodyOf(response), "gameId")

    val view = fx.bodyOf(fx.send(request(Method.GET, s"/api/games/$gameId", Some(caller.token))))
    assertEquals(stringField(view, "status"), "inProgress")
    assert(view.hcursor.get[Int]("viewerSeat").toOption.isEmpty, view.noSpaces)
    assertEquals(view.hcursor.get[List[Json]]("hand").map(_.size).toOption, Some(0))
    val players = view.hcursor.get[List[Json]]("players").getOrElse(Nil)
    assertEquals(players.map(stringField(_, "id")).toSet, Set("qa-spec-p1", "qa-spec-p2"))
    val seatIds = view.hcursor
      .get[List[Json]]("seats")
      .getOrElse(Nil)
      .flatMap(_.hcursor.get[String]("playerId").toOption)
    assertEquals(seatIds.toSet, Set("qa-spec-p1", "qa-spec-p2"))
    assert(!seatIds.contains(caller.playerId), "spectator leaked into the seats")
  }

  test("a fresh QA active-match caller receives the minted session cookie") {
    val fx = newFixture()

    val response = fx.send(
      request(Method.POST, "/api/qa/presets/active-match", body = Some(Json.obj("playerCount" -> 2.asJson)))
    )
    assertEquals(response.status, Status.Ok)
    val cookie = response.cookies.find(_.name == SessionCookie.CookieName)
    assert(cookie.exists(_.httpOnly), "no HttpOnly guest cookie on the preset response")
  }

  // --- WebSockets (real Ember server) -------------------------------------

  /** A JDK WebSocket listener that queues every complete text frame. */
  private final class TextFrames extends WebSocket.Listener:
    private val queue = new LinkedBlockingQueue[String]()
    private val buffer = new StringBuilder()

    override def onOpen(webSocket: WebSocket): Unit = webSocket.request(1)

    override def onText(
        webSocket: WebSocket,
        data: CharSequence,
        last: Boolean
    ): CompletionStage[_] =
      buffer.append(data)
      if last then
        queue.put(buffer.toString)
        buffer.setLength(0)
      webSocket.request(1)
      CompletableFuture.completedFuture[Void](null)

    /** The next frame matching `predicate`, or a test failure on timeout. */
    def await(predicate: Json => Boolean, timeout: FiniteDuration = 10.seconds): Json =
      val deadline = System.nanoTime() + timeout.toNanos
      var found: Option[Json] = None
      while found.isEmpty && System.nanoTime() < deadline do
        val raw = queue.poll(
          (deadline - System.nanoTime()).max(0L),
          TimeUnit.NANOSECONDS
        )
        if raw != null then
          found = parser.parse(raw).toOption.filter(predicate)
      found.getOrElse(
        throw new AssertionError("timed out waiting for a matching WebSocket frame")
      )

    def awaitType(messageType: String, timeout: FiniteDuration = 10.seconds): Json =
      await(
        json => json.hcursor.get[String]("type").toOption.contains(messageType),
        timeout
      )

  private val httpClient = HttpClient.newHttpClient()

  private def connect(port: Int, path: String, listener: TextFrames): WebSocket =
    httpClient
      .newWebSocketBuilder()
      .buildAsync(URI.create(s"ws://127.0.0.1:$port$path"), listener)
      .get(10, TimeUnit.SECONDS)

  /** Runs `body` against a live server whose routes share `fx`'s services. */
  private def withServer(fx: Fixture)(body: (Fixture, Int) => Unit): Unit =
    EmberServerBuilder
      .default[IO]
      .withHost(host"127.0.0.1")
      .withPort(port"0")
      .withHttpWebSocketApp { webSockets =>
        given WebSocketBuilder2[IO] = webSockets
        MultiplayerRoutes
          .routes(fx.sessions, fx.rooms, fx.quickPair)
          .orNotFound
      }
      .build
      .use(server => IO.blocking(body(fx, server.address.getPort)))
      .unsafeRunSync()

  test("/ws/lobby sends a snapshot then live updates when a public room is created") {
    val fx = newFixture()
    withServer(fx) { (services, port) =>
      val listener = new TextFrames
      val socket = connect(port, "/ws/lobby", listener)
      try
        val snapshot = listener.awaitType("lobbySnapshot")
        assertEquals(
          snapshot.hcursor.get[List[Json]]("rooms").toOption.map(_.size),
          Some(0)
        )

        val host = services.guest("Lobby Host")
        val gameId = createRoom(services, host)

        val updated = listener.await { json =>
          json.hcursor.get[String]("type").toOption.contains("lobbyUpdated") &&
          json.hcursor
            .get[List[Json]]("rooms")
            .toOption
            .exists(_.exists(room => stringField(room, "gameId") == gameId))
        }
        assertEquals(updated.hcursor.get[String]("type").toOption, Some("lobbyUpdated"))
      finally socket.abort()
    }
  }

  test("/ws/games/:gameId streams the viewer's view, pongs and rejects bad frames") {
    val fx = newFixture()
    val host = fx.guest("Socket Host")
    val rival = fx.guest("Socket Rival")
    val gameId = createRoom(fx, host)
    assertEquals(joinGame(fx, gameId, rival).status, Status.Ok)

    withServer(fx) { (_, port) =>
      val listener = new TextFrames
      val socket = connect(
        port,
        s"/ws/games/$gameId?token=${host.token}",
        listener
      )
      try
        val initial = listener.awaitType("gameViewUpdate")
        val view = field(initial, "view")
        assertEquals(view.hcursor.get[Int]("viewerSeat").toOption, Some(0))
        assertEquals(view.hcursor.get[List[Json]]("hand").map(_.size).toOption, Some(6))
        assertEquals(
          view.hcursor.get[String]("viewerId").toOption,
          Some(host.playerId)
        )

        socket.sendText("""{"type":"ping"}""", true).get(5, TimeUnit.SECONDS)
        listener.awaitType("pong")

        socket.sendText("this is not json", true).get(5, TimeUnit.SECONDS)
        val malformed = listener.awaitType("actionRejected")
        assertEquals(
          malformed.hcursor.get[String]("code").toOption,
          Some(MultiplayerRoutes.InvalidPayloadCode)
        )

        // The rival is not on the clock, so an action from that seat is refused
        // and never mutates the match.
        socket.sendText("""{"type":"passTurn"}""", true).get(5, TimeUnit.SECONDS)
        val rejected = listener.awaitType("actionRejected")
        assert(
          Set("ILLEGAL_MOVE", "UNAUTHORIZED").contains(
            rejected.hcursor.get[String]("code").toOption.getOrElse("")
          ),
          rejected.noSpaces
        )
      finally socket.abort()
    }
  }

  test("/ws/games/:gameId flips isConnected on connect and abrupt disconnect") {
    val fx = newFixture()
    val host = fx.guest("Present Host")
    val rival = fx.guest("Present Rival")
    val gameId = createRoom(fx, host)
    assertEquals(joinGame(fx, gameId, rival).status, Status.Ok)

    withServer(fx) { (_, port) =>
      val hostFrames = new TextFrames
      val rivalFrames = new TextFrames
      val hostSocket = connect(port, s"/ws/games/$gameId?token=${host.token}", hostFrames)
      try
        hostFrames.awaitType("gameViewUpdate")
        val rivalSocket = connect(
          port,
          s"/ws/games/$gameId?token=${rival.token}",
          rivalFrames
        )
        try
          rivalFrames.awaitType("gameViewUpdate")

          def seatConnected(json: Json, playerId: String): Option[Boolean] =
            for
              view <- json.hcursor.downField("view").focus
              seats <- view.hcursor.get[List[Json]]("seats").toOption
              seat <- seats.find(s => s.hcursor.get[String]("playerId").toOption.contains(playerId))
              connected <- seat.hcursor.get[Boolean]("isConnected").toOption
            yield connected

          // The rival's connect reaches the host as a presence update.
          hostFrames.await(json => seatConnected(json, rival.playerId).contains(true))

          rivalSocket.abort()

          // The abrupt disconnect reaches the host as isConnected = false.
          hostFrames.await(json => seatConnected(json, rival.playerId).contains(false))
        finally rivalSocket.abort()
      finally hostSocket.abort()
    }
  }
