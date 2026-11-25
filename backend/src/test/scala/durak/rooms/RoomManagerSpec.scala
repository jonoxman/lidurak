package durak.rooms

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import durak.engine.{Card, GameAction, GameEngine, GameState, JsonCodecs}
import durak.engine.JsonCodecs.given
import durak.protocol.{PlayerGameView, ProtocolCodecs, RoomStatus, WsClientMessage, WsServerMessage}
import durak.protocol.ProtocolCodecs.given
import durak.session.GuestSession
import fs2.Stream
import io.circe.syntax.*

import scala.concurrent.duration.*

class RoomManagerSpec extends munit.FunSuite:

  // Turn clocks are driven explicitly through `enforceTurnTimeout`, so every
  // test stays deterministic instead of waiting on a wall-clock deadline.
  private def manager: RoomManager[IO] =
    RoomManager.create[IO](startTurnClocks = false).unsafeRunSync()

  private def session(playerId: String, displayName: String = ""): GuestSession =
    GuestSession(
      token = s"token-$playerId",
      playerId = playerId,
      displayName = if displayName.isEmpty then s"Player $playerId" else displayName,
      createdAtEpochMs = 0L,
      lastSeenAtEpochMs = 0L
    )

  private def twoPlayerConfig: CreateRoomConfig =
    CreateRoomConfig(playerCount = 2, turnTimeoutSeconds = 15, isPublic = true)

  private def created(
      rm: RoomManager[IO],
      host: GuestSession = session("host"),
      config: CreateRoomConfig = twoPlayerConfig
  ): GameRoom =
    rm.createRoom(host, config)
      .unsafeRunSync()
      .getOrElse(fail("room creation was rejected"))
      ._1

  private def startTwoPlayer(rm: RoomManager[IO]): GameRoom =
    val room = created(rm)
    rm.joinSeat(room.gameId, session("p1"))
      .unsafeRunSync()
      .getOrElse(fail("join was rejected"))
    rm.getRoom(room.gameId).unsafeRunSync().getOrElse(fail("room disappeared"))

  private def stateOf(rm: RoomManager[IO], gameId: String): GameState =
    rm.getRoom(gameId)
      .unsafeRunSync()
      .flatMap(_.gameState)
      .getOrElse(fail(s"room $gameId has no game state"))

  private def handOf(state: GameState, playerId: String): List[Card] =
    state.players
      .find(_.id == playerId)
      .map(_.hand.toList)
      .getOrElse(fail(s"$playerId is not in the game"))

  private def collect(
      connection: (Stream[IO, WsServerMessage], PlayerGameView),
      count: Int
  ): List[WsServerMessage] =
    connection._1
      .take(count.toLong)
      .compile
      .toList
      .timeout(5.seconds)
      .unsafeRunSync()

  private def viewFrame(frame: WsServerMessage): PlayerGameView = frame match
    case WsServerMessage.GameViewUpdate(view) => view
    case other                                => fail(s"expected a game view update, got $other")

  private def assertNoCardsLeaked(encoded: String, cards: Iterable[Card], clue: String): Unit =
    cards.foreach { card =>
      assert(
        !encoded.contains(card.asJson.noSpaces),
        s"$clue leaked hidden card $card: $encoded"
      )
    }

  // --- Room creation (REQ-06) ----------------------------------------------

  test("createRoom validates player count and turn timeout") {
    val rm = manager

    List(1, 5, 0, -1).foreach { count =>
      val result = rm.createRoom(session("host"), CreateRoomConfig(count)).unsafeRunSync()
      assert(result.isLeft, s"accepted unsupported player count $count")
    }
    List(4, 301, 0, -5).foreach { seconds =>
      val result =
        rm.createRoom(session("host"), CreateRoomConfig(2, turnTimeoutSeconds = seconds)).unsafeRunSync()
      assert(result.isLeft, s"accepted out-of-range turn timeout $seconds")
    }
    assert(CreateRoomConfig(2, turnTimeoutSeconds = 5).validate.isRight)
    assert(CreateRoomConfig(4, turnTimeoutSeconds = 300).validate.isRight)
    assertEquals(rm.listOpenPublicRooms.unsafeRunSync(), Nil)
  }

  test("createRoom mints a URL-safe id, seats the host in seat 0 and waits for players") {
    val rm = manager
    val (room, seatIndex) = rm
      .createRoom(session("host", "Hostess"), twoPlayerConfig)
      .unsafeRunSync()
      .getOrElse(fail("room creation was rejected"))

    assertEquals(seatIndex, 0)
    assertEquals(room.status, RoomStatus.WaitingForPlayers)
    assertEquals(room.gameId.length, RoomManager.GameIdLength)
    assert(room.gameId.matches("^[A-Za-z0-9]{8}$"), room.gameId)
    assertEquals(room.seats.size, 2)
    assertEquals(room.seats(0).playerId, Some("host"))
    assertEquals(room.seats(0).displayName, Some("Hostess"))
    assertEquals(room.seats(1).playerId, None)
    assertEquals(room.gameState, None)
    assertEquals(room.hostName, "Hostess")

    // The shareable id is unique across many rooms.
    val ids = (1 to 20).toList.map { idx =>
      created(rm, session(s"host-$idx"), CreateRoomConfig(3))
    }.map(_.gameId)
    assertEquals(ids.distinct.size, ids.size)
    assert(!ids.contains(room.gameId))
  }

  test("a private room never appears in the open lobby pool") {
    val rm = manager
    created(rm, session("host"), twoPlayerConfig.copy(isPublic = false))

    assertEquals(rm.listOpenPublicRooms.unsafeRunSync(), Nil)
  }

  // --- Join, auto-start & leaving (REQ-06) ---------------------------------

  test("joinSeat fills the next open seat idempotently and auto-starts a full room") {
    val rm = manager
    val room = created(rm, config = CreateRoomConfig(3))
    assertEquals(rm.listOpenPublicRooms.unsafeRunSync().map(_.gameId), List(room.gameId))

    val (waitingView, firstSeat) = rm
      .joinSeat(room.gameId, session("p1"))
      .unsafeRunSync()
      .getOrElse(fail("join was rejected"))
    assertEquals(firstSeat, 1)
    assertEquals(waitingView.status, RoomStatus.WaitingForPlayers)
    assertEquals(waitingView.hand, Nil)
    assertEquals(rm.getRoom(room.gameId).unsafeRunSync().map(_.status), Some(RoomStatus.WaitingForPlayers))

    // Rejoining the same player is idempotent and does not consume a new seat.
    val (rejoiningView, rejoinedSeat) = rm
      .joinSeat(room.gameId, session("p1"))
      .unsafeRunSync()
      .getOrElse(fail("idempotent join was rejected"))
    assertEquals(rejoinedSeat, 1)
    assertEquals(rejoiningView.viewerSeat, Some(1))

    // The last seat starts the match.
    val (startedView, lastSeat) = rm
      .joinSeat(room.gameId, session("p2"))
      .unsafeRunSync()
      .getOrElse(fail("final join was rejected"))
    assertEquals(lastSeat, 2)
    assertEquals(startedView.status, RoomStatus.InProgress)
    assertEquals(startedView.viewerSeat, Some(2))
    assert(startedView.hand.nonEmpty)
    assertEquals(startedView.hand.size, 6)

    val started = rm.getRoom(room.gameId).unsafeRunSync().getOrElse(fail("room disappeared"))
    assertEquals(started.status, RoomStatus.InProgress)
    assertEquals(started.seats.map(_.playerId), Vector(Some("host"), Some("p1"), Some("p2")))
    val state = started.gameState.getOrElse(fail("started room has no game state"))
    assertEquals(state.players.map(_.id), Vector("host", "p1", "p2"))
    assertEquals(state.players.map(_.hand.size), Vector(6, 6, 6))
    assertEquals(state.talon.size, 36 - 18)
    assert(started.turnDeadlineEpochMs.exists(_ > 0L), started.turnDeadlineEpochMs.toString)

    // A started room leaves the open lobby pool.
    assertEquals(rm.listOpenPublicRooms.unsafeRunSync(), Nil)

    // A fourth player cannot join a full, running room.
    assert(rm.joinSeat(room.gameId, session("late")).unsafeRunSync().isLeft)
  }

  test("a four player room deals from the 52-card deck") {
    val rm = manager
    val room = created(rm, config = CreateRoomConfig(4))
    List("p1", "p2", "p3").foreach { id =>
      assert(rm.joinSeat(room.gameId, session(id)).unsafeRunSync().isRight, id)
    }

    val state = stateOf(rm, room.gameId)
    assertEquals(state.players.map(_.hand.size), Vector(6, 6, 6, 6))
    assertEquals(state.talon.size, 52 - 24)
  }

  test("leaveSeat vacates a waiting seat, rejects started matches and deletes empty rooms") {
    val rm = manager

    // Waiting room: leaving frees the seat and keeps the room open.
    val waiting = created(rm, config = CreateRoomConfig(3))
    assertEquals(rm.joinSeat(waiting.gameId, session("p1")).unsafeRunSync().map(_._2), Right(1))
    assertEquals(rm.leaveSeat(waiting.gameId, "p1").unsafeRunSync(), Right(()))
    val afterLeave = rm.getRoom(waiting.gameId).unsafeRunSync().getOrElse(fail("room disappeared"))
    assertEquals(afterLeave.seats(1).playerId, None)
    assertEquals(afterLeave.seats(1).displayName, None)
    assertEquals(afterLeave.status, RoomStatus.WaitingForPlayers)

    // The host leaving the empty room removes it entirely.
    assertEquals(rm.leaveSeat(waiting.gameId, "host").unsafeRunSync(), Right(()))
    assertEquals(rm.getRoom(waiting.gameId).unsafeRunSync(), None)
    assertEquals(rm.getRoomView(waiting.gameId, "host").unsafeRunSync(), None)
    assertEquals(rm.listOpenPublicRooms.unsafeRunSync(), Nil)

    // A started match cannot be abandoned.
    val started = startTwoPlayer(rm)
    assert(rm.leaveSeat(started.gameId, "p1").unsafeRunSync().isLeft)
    assert(rm.leaveSeat(started.gameId, "host").unsafeRunSync().isLeft)
    assertEquals(
      rm.getRoom(started.gameId).unsafeRunSync().map(_.seats.map(_.playerId)),
      Some(Vector(Some("host"), Some("p1")))
    )
  }

  // --- Strict seat authorization (REQ-07) ---------------------------------

  test("handleAction rejects a spectator or an unstarted room without mutating state") {
    val rm = manager
    val waiting = created(rm, config = CreateRoomConfig(3))
    val stateBefore = rm.getRoom(waiting.gameId).unsafeRunSync().flatMap(_.gameState)
    assertEquals(stateBefore, None)

    val attack = WsClientMessage.PlayAttack(List(Card(durak.engine.Suit.Spades, durak.engine.Rank.Six)))
    val waitingRejection = rm.handleAction(waiting.gameId, "host", attack).unsafeRunSync()
    assert(waitingRejection.isLeft)
    assertEquals(waitingRejection.swap.toOption.map(_.code), Some(ActionRejected.UnauthorizedCode))
    assertEquals(rm.getRoom(waiting.gameId).unsafeRunSync().flatMap(_.gameState), None)

    val started = startTwoPlayer(rm)
    val state = stateOf(rm, started.gameId)
    val spectator = rm.handleAction(started.gameId, "nosy-spectator", attack).unsafeRunSync()
    assert(spectator.isLeft)
    assertEquals(spectator.swap.toOption.map(_.code), Some(ActionRejected.UnauthorizedCode))
    assertEquals(stateOf(rm, started.gameId), state)

    // A missing room is reported as such, never as an applied move.
    val missing = rm.handleAction("does-not-exist", "host", attack).unsafeRunSync()
    assertEquals(missing.swap.toOption.map(_.code), Some(ActionRejected.RoomNotFoundCode))
  }

  test("handleAction derives the acting seat from the sender and rejects spoofed seats") {
    val rm = manager
    val room = startTwoPlayer(rm)
    val state = stateOf(rm, room.gameId)
    val attackerId = state.players(state.attackerIdx).id
    val defenderId = state.players(state.defenderIdx).id
    val attackerCard = state.players(state.attackerIdx).hand.head
    val defenderCard = state.players(state.defenderIdx).hand.head

    // The defender cannot open the attack with the attacker's hand.
    val defenderAttacking =
      rm.handleAction(room.gameId, defenderId, WsClientMessage.PlayAttack(List(attackerCard)))
        .unsafeRunSync()
    assert(defenderAttacking.isLeft, "defender spoofed an initial attack")
    assertEquals(stateOf(rm, room.gameId), state)

    // The attacker cannot submit the defender's cover.
    val attackerCovering =
      rm.handleAction(room.gameId, attackerId, WsClientMessage.CoverCard(0, defenderCard))
        .unsafeRunSync()
    assert(attackerCovering.isLeft, "attacker spoofed a cover")
    assertEquals(stateOf(rm, room.gameId), state)

    // The defender passing out of turn is rejected too.
    val defenderPassing = rm.handleAction(room.gameId, defenderId, WsClientMessage.PassTurn)
      .unsafeRunSync()
    assert(defenderPassing.isLeft, "defender passed out of turn")
    assertEquals(stateOf(rm, room.gameId), state)

    // Ping is not a game action and never reaches the engine.
    val ping = rm.handleAction(room.gameId, attackerId, WsClientMessage.Ping).unsafeRunSync()
    assertEquals(ping.swap.toOption.map(_.code), Some(ActionRejected.InvalidActionCode))
    assertEquals(stateOf(rm, room.gameId), state)

    // The authentic attacker's own move is accepted.
    val legal = rm
      .handleAction(room.gameId, attackerId, WsClientMessage.PlayAttack(List(attackerCard)))
      .unsafeRunSync()
    assertEquals(legal, Right(()))
    assertNotEquals(stateOf(rm, room.gameId), state)
  }

  // --- Per-viewer broadcast (REQ-07) --------------------------------------

  test("a state change broadcasts an individually projected view to every client") {
    val rm = manager
    val room = startTwoPlayer(rm)
    val state = stateOf(rm, room.gameId)
    val attackerId = state.players(state.attackerIdx).id
    val attackerCard = state.players(state.attackerIdx).hand.head
    val hostHand = handOf(state, "host")
    val guestHand = handOf(state, "p1")

    val (hostConn, releaseHost) = rm.subscribe(room.gameId, "host").allocated.unsafeRunSync()
    val (guestConn, releaseGuest) = rm.subscribe(room.gameId, "p1").allocated.unsafeRunSync()
    val (spectatorConn, releaseSpectator) =
      rm.subscribe(room.gameId, "spectator").allocated.unsafeRunSync()

    // Presence is visible from the very first queued frames.
    assertEquals(hostConn._2.hand, hostHand)
    assertEquals(guestConn._2.hand, guestHand)
    assertEquals(spectatorConn._2.viewerSeat, None)
    assertEquals(spectatorConn._2.hand, Nil)

    assertEquals(
      rm.handleAction(room.gameId, attackerId, WsClientMessage.PlayAttack(List(attackerCard)))
        .unsafeRunSync(),
      Right(())
    )

    // host: initial + guest join + spectator join + move.
    // guest: initial + spectator join + move. spectator: initial + move.
    val hostFrames = collect(hostConn, 4).map(viewFrame)
    val guestFrames = collect(guestConn, 3).map(viewFrame)
    val spectatorFrames = collect(spectatorConn, 2).map(viewFrame)

    assert(hostFrames.forall(_.viewerId == "host"))
    assert(guestFrames.forall(_.viewerId == "p1"))
    assert(spectatorFrames.forall(_.viewerId == "spectator"))
    assert(spectatorFrames.forall(_.viewerSeat.isEmpty))
    assert(spectatorFrames.forall(_.hand.isEmpty))

    // The last frame of each client reflects the attack on the table.
    assert(hostFrames.last.tablePairs.nonEmpty)
    assert(guestFrames.last.tablePairs.nonEmpty)
    assert(spectatorFrames.last.tablePairs.nonEmpty)
    assertEquals(hostFrames.last.seats.map(_.isConnected), Vector(true, true))

    // Anti-cheat: host frames never carry the guest's private hand and vice versa.
    val postMoveState = stateOf(rm, room.gameId)
    val guestPrivate = handOf(postMoveState, "p1")
    val hostPrivate = handOf(postMoveState, "host")
    hostFrames.foreach { view =>
      assertNoCardsLeaked(
        (WsServerMessage.GameViewUpdate(view): WsServerMessage).asJson.noSpaces,
        guestPrivate,
        "host frame"
      )
    }
    guestFrames.foreach { view =>
      assertNoCardsLeaked(
        (WsServerMessage.GameViewUpdate(view): WsServerMessage).asJson.noSpaces,
        hostPrivate,
        "guest frame"
      )
    }
    spectatorFrames.foreach { view =>
      val encoded = (WsServerMessage.GameViewUpdate(view): WsServerMessage).asJson.noSpaces
      assertNoCardsLeaked(encoded, hostPrivate ++ guestPrivate, "spectator frame")
    }

    // The viewer's own hand is projected only into their own frames.
    val attackerFrames = if attackerId == "host" then hostFrames else guestFrames
    assert(attackerFrames.last.hand.size < attackerFrames.head.hand.size)

    releaseHost.unsafeRunSync()
    releaseGuest.unsafeRunSync()
    releaseSpectator.unsafeRunSync()
  }

  test("a spectator can subscribe to a waiting room and receives no seat or cards") {
    val rm = manager
    val room = created(rm)
    val (conn, release) = rm.subscribe(room.gameId, "watcher").allocated.unsafeRunSync()

    val view = conn._2
    assertEquals(view.status, RoomStatus.WaitingForPlayers)
    assertEquals(view.viewerSeat, None)
    assertEquals(view.hand, Nil)
    assertEquals(view.seats.size, 2)
    assertEquals(view.seats.head.playerId, Some("host"))

    // Joining a seat updates the spectator's projection too.
    assert(rm.joinSeat(room.gameId, session("p1")).unsafeRunSync().isRight)
    val frames = collect(conn, 2).map(viewFrame)
    assertEquals(frames.last.status, RoomStatus.InProgress)
    assertEquals(frames.last.viewerSeat, None)
    assertEquals(frames.last.hand, Nil)

    release.unsafeRunSync()
  }

  // --- Presence & reconnection (REQ-08) -----------------------------------

  test("subscribe marks players connected and disconnect broadcasts isConnected false") {
    val rm = manager
    val room = startTwoPlayer(rm)
    val guestHand = handOf(stateOf(rm, room.gameId), "p1")

    val (hostConn, releaseHost) = rm.subscribe(room.gameId, "host").allocated.unsafeRunSync()
    val (guestConn, releaseGuest) = rm.subscribe(room.gameId, "p1").allocated.unsafeRunSync()

    // host: initial, guest connected.
    val beforeDisconnect = collect(hostConn, 2).map(viewFrame)
    assertEquals(beforeDisconnect.last.players.find(_.id == "p1").map(_.isConnected), Some(true))
    assertEquals(beforeDisconnect.last.seats.find(_.seatIndex == 1).map(_.isConnected), Some(true))

    val guestFrames = collect(guestConn, 1).map(viewFrame)
    assertEquals(guestFrames.head.hand, guestHand)
    assertEquals(guestFrames.head.viewerSeat, Some(1))

    // Disconnecting flips presence for every remaining client. The queue is
    // consumed in order, so this collect reads exactly the release broadcast.
    releaseGuest.unsafeRunSync()
    val afterDisconnect = collect(hostConn, 1).map(viewFrame)
    assertEquals(afterDisconnect.last.players.find(_.id == "p1").map(_.isConnected), Some(false))
    assertEquals(afterDisconnect.last.seats.find(_.seatIndex == 1).map(_.isConnected), Some(false))

    // The room state survives the disconnect; the seat and hand are intact.
    val state = stateOf(rm, room.gameId)
    assertEquals(handOf(state, "p1"), guestHand)
    assertEquals(state.players.map(_.id), Vector("host", "p1"))
    assertEquals(rm.getRoom(room.gameId).unsafeRunSync().map(_.seats(1).playerId), Some(Some("p1")))

    // Reconnecting with the same player id re-attaches to the same seat and hand.
    val (reconnected, releaseReconnected) =
      rm.subscribe(room.gameId, "p1").allocated.unsafeRunSync()
    assertEquals(reconnected._2.viewerSeat, Some(1))
    assertEquals(reconnected._2.hand, guestHand)
    assertEquals(reconnected._2.players.find(_.id == "p1").map(_.isConnected), Some(true))

    val afterReconnect = collect(hostConn, 1).map(viewFrame)
    assertEquals(afterReconnect.last.players.find(_.id == "p1").map(_.isConnected), Some(true))

    releaseHost.unsafeRunSync()
    releaseReconnected.unsafeRunSync()
  }

  test("multiple tabs of one player keep presence true until the last socket closes") {
    val rm = manager
    val room = startTwoPlayer(rm)

    val (hostConn, releaseHost) = rm.subscribe(room.gameId, "host").allocated.unsafeRunSync()
    val (tabOne, releaseTabOne) = rm.subscribe(room.gameId, "p1").allocated.unsafeRunSync()
    val (tabTwo, releaseTabTwo) = rm.subscribe(room.gameId, "p1").allocated.unsafeRunSync()

    // Both tabs get their own socket and the same projected hand.
    assertEquals(tabOne._2.hand, tabTwo._2.hand)
    assertEquals(tabOne._2.viewerSeat, Some(1))

    // host: initial, tab one, tab two. Every frame reports the same player
    // as connected because at least one of their sockets is still open.
    val opening = collect(hostConn, 3).map(viewFrame)
    assertEquals(opening.last.players.find(_.id == "p1").map(_.isConnected), Some(true))

    releaseTabOne.unsafeRunSync()
    val stillConnected = collect(hostConn, 1).map(viewFrame)
    assertEquals(stillConnected.last.players.find(_.id == "p1").map(_.isConnected), Some(true))

    releaseTabTwo.unsafeRunSync()
    val disconnected = collect(hostConn, 1).map(viewFrame)
    assertEquals(disconnected.last.players.find(_.id == "p1").map(_.isConnected), Some(false))

    releaseHost.unsafeRunSync()
  }

  // --- Turn clock enforcement ---------------------------------------------

  test("enforceTurnTimeout plays for the player on the clock and refuses a live deadline") {
    val rm = manager
    val room = startTwoPlayer(rm)
    val before = stateOf(rm, room.gameId)
    val deadline = rm.getRoom(room.gameId).unsafeRunSync().flatMap(_.turnDeadlineEpochMs)
      .getOrElse(fail("a running match must have a turn deadline"))

    // Expiring the deadline plays one random legal move for the attacker.
    assertEquals(rm.enforceTurnTimeout(room.gameId, deadline).unsafeRunSync(), Right(true))
    val after = stateOf(rm, room.gameId)
    assertNotEquals(after, before)
    assertEquals(after.tablePairs.size, 1)

    // The fresh deadline has not passed, so a second check is a no-op.
    assertEquals(rm.enforceTurnTimeout(room.gameId, deadline).unsafeRunSync(), Right(false))
    assertEquals(stateOf(rm, room.gameId), after)

    // Unknown rooms report an error instead of silently succeeding.
    assert(rm.enforceTurnTimeout("missing-room", deadline).unsafeRunSync().isLeft)
  }

  // --- M1 projection wiring ------------------------------------------------

  test("starting a match stamps the game clock and the configured turn deadline") {
    val rm = manager
    val room = startTwoPlayer(rm)
    val gameRoom = rm.getRoom(room.gameId).unsafeRunSync().getOrElse(fail("room missing"))

    val startedAt = gameRoom.gameState.flatMap(_.gameStartedAtMs)
      .getOrElse(fail("a started match must stamp gameStartedAtMs"))
    assert(startedAt > 0L)
    assertEquals(gameRoom.gameState.flatMap(_.gameEndedAtMs), None)

    val deadline = gameRoom.turnDeadlineEpochMs
      .getOrElse(fail("a running match must have a turn deadline"))
    // The room uses its configured 15-second clock; allow one second of slack.
    assert(deadline >= startedAt + 14_000L, s"deadline $deadline vs start $startedAt")
    assert(deadline <= System.currentTimeMillis() + 15_000L, deadline.toString)

    val view = rm.getRoomView(room.gameId, "host").unsafeRunSync()
      .getOrElse(fail("view missing"))
    assertEquals(view.gameStartedAtMs, Some(startedAt))
    assertEquals(view.gameEndedAtMs, None)
    assertEquals(view.turnDeadlineMs, deadline)
    assert(view.turnSecondsRemaining > 0 && view.turnSecondsRemaining <= 15)
    assertEquals(view.boutPhase, Some("initialAttack"))
  }

  test("each viewer receives only their own legal actions and targeting metadata") {
    val rm = manager
    val room = startTwoPlayer(rm)
    val state = stateOf(rm, room.gameId)
    val attackerId = state.players(state.attackerIdx).id
    val defenderId = state.players(state.defenderIdx).id

    val attackerView = rm.getRoomView(room.gameId, attackerId).unsafeRunSync()
      .getOrElse(fail("attacker view missing"))
    assertEquals(attackerView.legalActions, List("attack"))
    assertEquals(attackerView.eligibleTargetIds, Vector(defenderId))
    assertEquals(attackerView.turnPlayerId, Some(attackerId))
    assertEquals(attackerView.promptedPlayerIds, Vector(attackerId))
    assert(attackerView.turnDeadlineMs > 0L)
    assert(attackerView.turnSecondsRemaining > 0)

    val defenderView = rm.getRoomView(room.gameId, defenderId).unsafeRunSync()
      .getOrElse(fail("defender view missing"))
    assertEquals(defenderView.legalActions, Nil)
    assertEquals(defenderView.throwInCards, Nil)
    assertEquals(defenderView.canThrowIn, false)

    val spectatorView = rm.getRoomView(room.gameId, "watcher").unsafeRunSync()
      .getOrElse(fail("spectator view missing"))
    assertEquals(spectatorView.viewerSeat, None)
    assertEquals(spectatorView.hand, Nil)
    assertEquals(spectatorView.legalActions, Nil)
    assertEquals(spectatorView.throwInCards, Nil)
    assertEquals(spectatorView.throwInCapacity, 0)
    assertEquals(spectatorView.canThrowIn, false)
    assertEquals(spectatorView.eligibleTargetIds, Vector.empty)
    assertEquals(spectatorView.redirectTargetId, None)
  }

  test("handleGameAction routes every M1 variant through the authenticated seat") {
    val rm = manager
    val room = startTwoPlayer(rm)
    val state = stateOf(rm, room.gameId)
    val attackerId = state.players(state.attackerIdx).id
    val defenderId = state.players(state.defenderIdx).id
    val attackerCard = handOf(state, attackerId).head
    val defenderCard = handOf(state, defenderId).head

    // An InitialAttack that names the standard clockwise defender is accepted.
    assertEquals(
      rm.handleGameAction(
        room.gameId,
        attackerId,
        GameAction.InitialAttack(attackerId, List(attackerCard), Some(defenderId))
      ).unsafeRunSync(),
      Right(())
    )
    val afterAttack = stateOf(rm, room.gameId)
    assertNotEquals(afterAttack, state)

    // A spoofed actor is rejected and never mutates the room.
    val spoofed = rm
      .handleGameAction(room.gameId, attackerId, GameAction.CoverCard(defenderId, 0, defenderCard))
      .unsafeRunSync()
    assertEquals(spoofed.swap.toOption.map(_.code), Some(ActionRejected.IllegalMoveCode))
    assertEquals(stateOf(rm, room.gameId), afterAttack)

    // Every compact WebSocket frame maps to a seat-bound engine action and is
    // evaluated by the engine instead of crashing the room.
    List(
      WsClientMessage.CoverCard(0, defenderCard),
      WsClientMessage.RedirectAttack(Nil),
      WsClientMessage.ThrowInCards(Nil),
      WsClientMessage.DeclareSurrender,
      WsClientMessage.PassTurn
    ).foreach { message =>
      val result = rm.handleAction(room.gameId, attackerId, message).unsafeRunSync()
      assert(result.isLeft, s"$message was accepted out of turn")
      assertEquals(
        result.swap.toOption.map(_.code),
        Some(ActionRejected.IllegalMoveCode),
        message.toString
      )
    }
    assertEquals(stateOf(rm, room.gameId), afterAttack)
  }

  test("a full match driven through RoomManager ends with frozen clocks and results") {
    val rm = manager
    val preset = rm
      .createPresetRoom(
        CreateRoomConfig(playerCount = 2, turnTimeoutSeconds = 15, isPublic = false),
        Vector("qa-1" -> "QA One", "qa-2" -> "QA Two"),
        autoStartIfFull = true,
        seed = Some(20260222L)
      )
      .unsafeRunSync()

    var state = stateOf(rm, preset.gameId)
    var steps = 0
    while !state.isGameOver && steps < 5000 do
      val actor = state.players
        .find(player =>
          state.promptedPlayerIds.contains(player.id) &&
            GameEngine.legalActions(state, player.id).nonEmpty
        )
        .getOrElse(fail(s"no seat can act at step $steps (${state.boutPhase})"))
      val action = GameEngine.legalActions(state, actor.id).head
      assertEquals(
        rm.handleGameAction(preset.gameId, actor.id, action).unsafeRunSync(),
        Right(()),
        s"step $steps: $action"
      )
      state = stateOf(rm, preset.gameId)
      steps += 1

    assert(state.isGameOver, s"match did not finish in $steps steps")

    val finished = rm.getRoom(preset.gameId).unsafeRunSync().getOrElse(fail("room missing"))
    assertEquals(finished.status, RoomStatus.Finished)
    assertEquals(finished.turnDeadlineEpochMs, None)
    assert(finished.gameState.flatMap(_.gameStartedAtMs).nonEmpty)
    val endedAt = finished.gameState.flatMap(_.gameEndedAtMs)
      .getOrElse(fail("a finished match must stamp gameEndedAtMs"))
    assert(endedAt > 0L)

    val view = rm.getRoomView(preset.gameId, "qa-1").unsafeRunSync()
      .getOrElse(fail("view missing"))
    assertEquals(view.status, RoomStatus.Finished)
    assertEquals(view.boutPhase, Some("gameOver"))
    assertEquals(view.turnDeadlineMs, 0L)
    assertEquals(view.turnSecondsRemaining, 0)
    assertEquals(view.promptedPlayerIds, Vector.empty)
    assertEquals(view.gameEndedAtMs, Some(endedAt))
    assert(view.finishOrder.nonEmpty)
    assert(view.winners.nonEmpty || view.isDraw)
    assert(view.durak.nonEmpty || view.isDraw)
  }

  // --- QA preset rooms ----------------------------------------------------

  test("createPresetRoom seats prefilled players through the same authoritative pipeline") {
    val rm = manager
    val preset = rm
      .createPresetRoom(
        CreateRoomConfig(playerCount = 2, turnTimeoutSeconds = 30),
        Vector("qa-1" -> "QA One", "qa-2" -> "QA Two"),
        autoStartIfFull = true,
        seed = Some(42L)
      )
      .unsafeRunSync()

    assertEquals(preset.status, RoomStatus.InProgress)
    assertEquals(preset.seats.map(_.playerId), Vector(Some("qa-1"), Some("qa-2")))
    assertEquals(preset.hostName, "QA One")
    val view = rm.getRoomView(preset.gameId, "qa-1").unsafeRunSync().getOrElse(fail("view missing"))
    assertEquals(view.viewerSeat, Some(0))
    assertEquals(view.config.turnTimeoutSeconds, 30)
    assert(view.hand.nonEmpty)
    assertEquals(rm.listOpenPublicRooms.unsafeRunSync(), Nil)

    // The same seed deals the same hands, so presets are reproducible.
    val replay = rm
      .createPresetRoom(
        CreateRoomConfig(playerCount = 2, turnTimeoutSeconds = 30),
        Vector("qa-1" -> "QA One", "qa-2" -> "QA Two"),
        autoStartIfFull = true,
        seed = Some(42L)
      )
      .unsafeRunSync()
    assertEquals(
      rm.getRoomView(replay.gameId, "qa-1").unsafeRunSync().map(_.hand),
      Some(view.hand)
    )

    // A partly seated preset stays in the open lobby until somebody joins.
    val waiting = rm
      .createPresetRoom(
        CreateRoomConfig(playerCount = 3),
        Vector("qa-a" -> "QA A"),
        autoStartIfFull = true,
        seed = Some(1L)
      )
      .unsafeRunSync()
    assertEquals(waiting.status, RoomStatus.WaitingForPlayers)
    assertEquals(rm.listOpenPublicRooms.unsafeRunSync().map(_.gameId), List(waiting.gameId))
    assertEquals(rm.joinSeat(waiting.gameId, session("real-p1")).unsafeRunSync().map(_._2), Right(1))
  }

  // --- Lobby updates -------------------------------------------------------

  test("lobbyUpdates publishes snapshots when public rooms open and leave the pool") {
    val rm = manager
    val updates = rm.lobbyUpdates.take(2).compile.toList.start.unsafeRunSync()
    // Give the stream a moment to subscribe before the first snapshot.
    IO.sleep(100.millis).unsafeRunSync()

    val (room, _) = rm.createRoom(session("host"), twoPlayerConfig).unsafeRunSync()
      .getOrElse(fail("room creation was rejected"))
    // Filling the last seat starts the match and removes it from the pool.
    assert(rm.joinSeat(room.gameId, session("p1")).unsafeRunSync().isRight)

    val snapshots = updates.joinWithNever.unsafeRunSync()
    assertEquals(snapshots.head.map(_.gameId), List(room.gameId))
    assertEquals(snapshots(1), Nil)
  }

  // --- Concurrency --------------------------------------------------------

  test("concurrent joins never claim the same seat twice") {
    val rm = manager
    val room = created(rm, config = CreateRoomConfig(4))

    val joiners = List("a", "b", "c", "d", "e", "f")
    val results = joiners
      .parTraverse(id => rm.joinSeat(room.gameId, session(id)))
      .unsafeRunSync()
    val seats = results.collect { case Right((_, seat)) => seat }

    // Seat 0 is already the host's, so exactly seats 1..3 remain to be won.
    assertEquals(seats.distinct.size, seats.size)
    assertEquals(seats.sorted, List(1, 2, 3))
    assertEquals(results.count(_.isLeft), joiners.size - 3)
    val state = stateOf(rm, room.gameId)
    assertEquals(state.players.map(_.hand.size), Vector(6, 6, 6, 6))
  }
