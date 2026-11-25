package durak.lobby

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import durak.protocol.RoomStatus
import durak.rooms.RoomManager
import durak.session.GuestSession

import scala.concurrent.duration.*

/**
 * The deferred-room quick-pair queue: queued players are never in a room until
 * their exact bucket is full, at which point one started room appears and every
 * queued player is notified.
 */
class QuickPairingServiceSpec extends munit.FunSuite:

  private final case class Harness(
      rooms: RoomManager[IO],
      service: QuickPairingService[IO]
  )

  /** Turn clocks are driven explicitly, so no test waits on a real clock. */
  private def harness(): Harness =
    val rooms = RoomManager.create[IO](startTurnClocks = false).unsafeRunSync()
    val service = QuickPairingService.create[IO](rooms).unsafeRunSync()
    Harness(rooms, service)

  /** The same queue, but with the bot driver on for instant bot matches. */
  private def botHarness(delay: FiniteDuration = 20.millis): Harness =
    val rooms = RoomManager
      .create[IO](startTurnClocks = false, botMoveDelay = delay)
      .unsafeRunSync()
    val service = QuickPairingService.create[IO](rooms).unsafeRunSync()
    Harness(rooms, service)

  private def session(playerId: String, displayName: String = ""): GuestSession =
    GuestSession(
      token = s"token-$playerId",
      playerId = playerId,
      displayName = if displayName.isEmpty then s"Player $playerId" else displayName,
      createdAtEpochMs = 0L,
      lastSeenAtEpochMs = 0L
    )

  private def request(
      playerCount: Int = 2,
      turnTimeoutSeconds: Int = 15,
      allowRedirect: Boolean = true
  ): QuickPairRequest =
    QuickPairRequest(playerCount, turnTimeoutSeconds, allowRedirect)

  private def enqueue(
      service: QuickPairingService[IO],
      player: GuestSession,
      preset: QuickPairRequest
  ): QuickPairResult =
    service
      .enqueue(player, preset)
      .unsafeRunSync()
      .getOrElse(fail(s"${player.playerId} was rejected: $preset"))

  private def searching(result: QuickPairResult, clue: String): QuickPairWaiting =
    result match
      case QuickPairResult.Searching(waiting) => waiting
      case other                              => fail(s"$clue: expected Searching, got $other")

  private def matched(result: QuickPairResult, clue: String): (String, Int) =
    result match
      case QuickPairResult.Matched(gameId, seatIndex) => (gameId, seatIndex)
      case other                                      => fail(s"$clue: expected Matched, got $other")

  // --- Deferred room creation ---------------------------------------------

  test("the first player in a 2P, 3P or 4P bucket only searches and creates no room") {
    val h = harness()

    Vector(request(2), request(3), request(4)).zipWithIndex.foreach {
      case (preset, idx) =>
        val waiting = searching(enqueue(h.service, session(s"p$idx"), preset), s"p$idx")
        assertEquals(waiting.key.playerCount, preset.playerCount)
        assertEquals(waiting.queuedCount, 1)
        assertEquals(waiting.requiredCount, preset.playerCount)
    }

    // Nothing was created, seated or published while everyone is queued.
    assertEquals(h.rooms.roomCount.unsafeRunSync(), 0)
    assertEquals(h.rooms.listOpenPublicRooms.unsafeRunSync(), Nil)

    // Every player observes their own bucket, and re-enqueueing deduplicates.
    assertEquals(
      h.service.statusFor("p0").unsafeRunSync().map(_.key.playerCount),
      Some(2)
    )
    val again = searching(enqueue(h.service, session("p0"), request(2)), "p0 again")
    assertEquals(again.queuedCount, 1)
    assertEquals(h.rooms.roomCount.unsafeRunSync(), 0)
  }

  test("cancelling removes the player cleanly, creates no room and is idempotent") {
    val h = harness()
    assertEquals(searching(enqueue(h.service, session("p0"), request(3)), "p0").queuedCount, 1)

    h.service.cancel("p0").unsafeRunSync()
    assertEquals(h.service.statusFor("p0").unsafeRunSync(), None)
    assertEquals(h.rooms.roomCount.unsafeRunSync(), 0)

    // Cancelling somebody who is not queued changes nothing.
    h.service.cancel("nobody").unsafeRunSync()
    assertEquals(h.rooms.roomCount.unsafeRunSync(), 0)
  }

  test("re-enqueueing moves a player out of their old bucket instead of duplicating them") {
    val h = harness()
    searching(enqueue(h.service, session("p0"), request(2)), "p0 2P")
    searching(enqueue(h.service, session("p0"), request(3)), "p0 3P")

    assertEquals(
      h.service.statusFor("p0").unsafeRunSync().map(_.key.playerCount),
      Some(3)
    )

    // A different player in the old 2P bucket must not be paired with a ghost.
    val waiting = searching(enqueue(h.service, session("p1"), request(2)), "p1 2P")
    assertEquals(waiting.queuedCount, 1)
    assertEquals(h.rooms.roomCount.unsafeRunSync(), 0)
  }

  // --- Match transition ----------------------------------------------------

  test("the final player creates one InProgress room and notifies every queued player") {
    val h = harness()
    val notifications =
      h.service.matchNotifications.take(3).compile.toList.start.unsafeRunSync()
    // Let the topic subscription attach before the bucket is completed.
    IO.sleep(100.millis).unsafeRunSync()

    val alice = session("alice", "Alice")
    val bob = session("bob", "Bob")
    val carol = session("carol", "Carol")

    assertEquals(searching(enqueue(h.service, alice, request(3)), "alice").queuedCount, 1)
    assertEquals(searching(enqueue(h.service, bob, request(3)), "bob").queuedCount, 2)
    assertEquals(h.rooms.roomCount.unsafeRunSync(), 0)

    val (gameId, carolSeat) = matched(enqueue(h.service, carol, request(3)), "carol")
    assertEquals(carolSeat, 2)

    // Exactly one room exists, already started with all three players seated.
    assertEquals(h.rooms.roomCount.unsafeRunSync(), 1)
    val room = h.rooms.getRoom(gameId).unsafeRunSync().getOrElse(fail("no room was created"))
    assertEquals(room.status, RoomStatus.InProgress)
    assertEquals(room.filledSeats, 3)
    assertEquals(room.seats.map(_.playerId), Vector(Some("alice"), Some("bob"), Some("carol")))
    assert(room.gameState.nonEmpty, "the matched room was not dealt")
    assertEquals(room.gameState.map(_.players.map(_.hand.size)), Some(Vector(6, 6, 6)))

    // Nobody remains queued once the bucket has been drained.
    List("alice", "bob", "carol").foreach { playerId =>
      assertEquals(h.service.statusFor(playerId).unsafeRunSync(), None, playerId)
    }

    // One notification per player, in seat order, all for the same room.
    val events = notifications.joinWithNever.unsafeRunSync()
    assertEquals(
      events.map(event => (event.playerId, event.seatIndex)),
      List(("alice", 0), ("bob", 1), ("carol", 2))
    )
    assert(events.forall(_.gameId == gameId), events.toString)

    // Cancelling after the match must not disturb the running room.
    h.service.cancel("alice").unsafeRunSync()
    assertEquals(
      h.rooms.getRoom(gameId).unsafeRunSync().map(_.filledSeats),
      Some(3)
    )
  }

  test("distinct buckets never cross-match") {
    val h = harness()

    searching(enqueue(h.service, session("alice"), request(3, 30, allowRedirect = false)), "alice")
    searching(enqueue(h.service, session("bob"), request(3, 30, allowRedirect = true)), "bob")
    searching(enqueue(h.service, session("carol"), request(3, 15, allowRedirect = false)), "carol")
    searching(enqueue(h.service, session("dave"), request(2, 30, allowRedirect = false)), "dave")
    assertEquals(h.rooms.roomCount.unsafeRunSync(), 0)

    // A third player with a *different* preset joins another bucket only.
    val evePreset = request(3, 30, allowRedirect = false)
    assertEquals(searching(enqueue(h.service, session("eve"), evePreset), "eve").queuedCount, 2)
    assertEquals(h.rooms.roomCount.unsafeRunSync(), 0)

    // The bucket's third player completes exactly that bucket.
    val (gameId, frankSeat) = matched(enqueue(h.service, session("frank"), evePreset), "frank")
    assertEquals(frankSeat, 2)
    assertEquals(h.rooms.roomCount.unsafeRunSync(), 1)
    assertEquals(
      h.rooms.getRoom(gameId).unsafeRunSync().map(_.seats.map(_.playerId)),
      Some(Vector(Some("alice"), Some("eve"), Some("frank")))
    )

    // Everybody in the other buckets is still waiting, untouched.
    List("bob" -> 3, "carol" -> 3, "dave" -> 2).foreach { case (playerId, playerCount) =>
      assertEquals(
        h.service.statusFor(playerId).unsafeRunSync().map(_.requiredCount),
        Some(playerCount),
        playerId
      )
    }
  }

  // --- QA hook -------------------------------------------------------------

  test("synthetic opponents fill the caller's bucket and return their seat") {
    val h = harness()
    assertEquals(
      searching(enqueue(h.service, session("alice"), request(3)), "alice").queuedCount,
      1
    )

    val (gameId, seatIndex) = h.service
      .matchWithSyntheticOpponents(session("alice"))
      .unsafeRunSync()
      .getOrElse(fail("the synthetic match was rejected"))
    assertEquals(seatIndex, 0)

    val room = h.rooms.getRoom(gameId).unsafeRunSync().getOrElse(fail("no room was created"))
    assertEquals(room.status, RoomStatus.InProgress)
    assertEquals(room.config.playerCount, 3)
    assertEquals(room.seats.head.playerId, Some("alice"))
    assert(
      room.seats.tail.forall(_.playerId.exists(_.startsWith("qa-qp-opp-"))),
      room.seats.toString
    )
    assertEquals(h.service.statusFor("alice").unsafeRunSync(), None)
  }

  // --- Deck size buckets (ITEM-6a) -----------------------------------------

  test("36-card and 52-card seekers in the same preset never cross-match") {
    val h = harness()
    val shortDeck = request(2, 15, true).copy(deckSize = Some(36))
    val fullDeck = request(2, 15, true).copy(deckSize = Some(52))

    assertEquals(searching(enqueue(h.service, session("short-a"), shortDeck), "short-a").queuedCount, 1)
    assertEquals(searching(enqueue(h.service, session("full-a"), fullDeck), "full-a").queuedCount, 1)
    assertEquals(h.rooms.roomCount.unsafeRunSync(), 0)

    // Only the other 52-card seeker completes that bucket and gets the deck.
    val (gameId, seat) = matched(enqueue(h.service, session("full-b"), fullDeck), "full-b")
    assertEquals(seat, 1)
    val room = h.rooms.getRoom(gameId).unsafeRunSync().getOrElse(fail("no room was created"))
    assertEquals(room.config.effectiveDeckSize, 52)
    assertEquals(room.config.deckSize, Some(52))
    assertEquals(room.gameState.map(_.talon.size), Some(40))

    // The 36-card seeker is untouched and still waiting.
    assertEquals(
      h.service.statusFor("short-a").unsafeRunSync().map(_.key.deckSize),
      Some(36)
    )

    // A 52-card 3P bucket is separate from the 36-card one too.
    assertEquals(
      searching(enqueue(h.service, session("three-full"), request(3, 30).copy(deckSize = Some(52))), "three-full").queuedCount,
      1
    )
    assertEquals(
      searching(enqueue(h.service, session("three-short"), request(3, 30)), "three-short").queuedCount,
      1
    )
    assertEquals(h.rooms.roomCount.unsafeRunSync(), 1)
  }

  test("a four-player bucket always records the 52-card deck") {
    val h = harness()
    val waiting = searching(enqueue(h.service, session("alice"), request(4)), "alice")
    assertEquals(waiting.key.deckSize, 52)
  }

  // --- Instant bot quick pairing (ITEM-7a) ---------------------------------

  test("a bot opponent starts a match immediately and never joins the human queue") {
    val h = botHarness(delay = 10.seconds)
    val result = h.service
      .enqueue(session("solo", "Solo"), request(2, 30).copy(botOpponent = Some("basicBot")))
      .unsafeRunSync()
      .getOrElse(fail("the bot match was rejected"))
    val (gameId, seat) = matched(result, "solo")
    assertEquals(seat, 0)

    val room = h.rooms.getRoom(gameId).unsafeRunSync().getOrElse(fail("no room was created"))
    assertEquals(room.status, RoomStatus.InProgress)
    assertEquals(room.config.playerCount, 2)
    assertEquals(room.config.turnTimeoutSeconds, 30)
    assertEquals(room.config.effectiveDeckSize, 36)
    assertEquals(room.seats.head.playerId, Some("solo"))
    assertEquals(room.seats(1).displayName, Some("BasicBot"))
    assertEquals(room.seats.head.seatType, "human")
    assertEquals(room.seats(1).seatType, "basicBot")
    assertEquals(room.gameState.map(_.config.seatType(1)), Some("basicBot"))
    assertEquals(room.gameState.map(_.players.map(_.hand.size)), Some(Vector(6, 6)))

    // Nothing was queued and nothing was published to the open pool.
    assertEquals(h.service.statusFor("solo").unsafeRunSync(), None)
    assertEquals(h.rooms.listOpenPublicRooms.unsafeRunSync(), Nil)

    // A human seeker still waits alone: bots are never queue members.
    assertEquals(searching(enqueue(h.service, session("human"), request(2)), "human").queuedCount, 1)
    assertEquals(h.rooms.roomCount.unsafeRunSync(), 1)
  }

  test("a four-player bot match seats three distinct bots") {
    val h = botHarness(delay = 10.seconds)
    val (gameId, seat) = matched(
      h.service
        .enqueue(session("solo"), request(4).copy(botOpponent = Some("randomBot")))
        .unsafeRunSync()
        .getOrElse(fail("the bot match was rejected")),
      "solo"
    )
    assertEquals(seat, 0)

    val room = h.rooms.getRoom(gameId).unsafeRunSync().getOrElse(fail("no room was created"))
    assertEquals(room.config.playerCount, 4)
    assertEquals(room.config.effectiveDeckSize, 52)
    assertEquals(room.seats.map(_.seatType), Vector("human", "randomBot", "randomBot", "randomBot"))
    assertEquals(
      room.seats.map(_.displayName),
      Vector(Some("Player solo"), Some("RandomBot 1"), Some("RandomBot 2"), Some("RandomBot 3"))
    )
    assertEquals(room.seats.map(_.playerId).distinct.size, 4)
    assertEquals(room.gameState.map(_.talon.size), Some(52 - 24))
  }

  test("a bot opponent can be requested with the 52-card deck") {
    val h = botHarness(delay = 10.seconds)
    val (gameId, _) = matched(
      h.service
        .enqueue(session("solo"), request(2).copy(deckSize = Some(52), botOpponent = Some("randomBot")))
        .unsafeRunSync()
        .getOrElse(fail("the bot match was rejected")),
      "solo"
    )
    val room = h.rooms.getRoom(gameId).unsafeRunSync().getOrElse(fail("no room was created"))
    assertEquals(room.config.effectiveDeckSize, 52)
    assertEquals(room.gameState.map(_.talon.size), Some(40))
    assertEquals(room.gameState.map(_.config.seatType(1)), Some("randomBot"))
  }

  test("invalid deck sizes and bot opponents are rejected without creating anything") {
    val h = harness()

    val badDeck = h.service
      .enqueue(session("a"), request(2).copy(deckSize = Some(40)))
      .unsafeRunSync()
    assert(badDeck.isLeft, "a 40-card deck was accepted")
    assertEquals(
      h.service.enqueue(session("b"), request(4).copy(deckSize = Some(36))).unsafeRunSync().isLeft,
      true,
      "a four-player 36-card request was accepted"
    )
    val badBot = h.service
      .enqueue(session("c"), request(2).copy(botOpponent = Some("grandmasterBot")))
      .unsafeRunSync()
    assert(badBot.isLeft, "an unknown bot opponent was accepted")

    // None of the rejects left a queue entry or a room behind.
    List("a", "b", "c").foreach { playerId =>
      assertEquals(h.service.statusFor(playerId).unsafeRunSync(), None, playerId)
    }
    assertEquals(h.rooms.roomCount.unsafeRunSync(), 0)
  }

  test("a caller already queued in a normal bucket is moved into the bot match") {
    val h = botHarness(delay = 10.seconds)
    assertEquals(searching(enqueue(h.service, session("alice"), request(3)), "alice").queuedCount, 1)

    val (gameId, seat) = matched(
      h.service
        .enqueue(session("alice"), request(2).copy(botOpponent = Some("basicBot")))
        .unsafeRunSync()
        .getOrElse(fail("the bot match was rejected")),
      "alice"
    )
    assertEquals(seat, 0)
    assertEquals(h.service.statusFor("alice").unsafeRunSync(), None)
    assertEquals(h.rooms.getRoom(gameId).unsafeRunSync().map(_.status), Some(RoomStatus.InProgress))
  }

  // --- QA hook with a non-default bucket -----------------------------------

  test("synthetic opponents fill a waiting 52-card bucket in place") {
    val h = harness()
    assertEquals(
      searching(enqueue(h.service, session("alice"), request(2).copy(deckSize = Some(52))), "alice").key.deckSize,
      52
    )

    val (gameId, seat) = h.service
      .matchWithSyntheticOpponents(session("alice"))
      .unsafeRunSync()
      .getOrElse(fail("the synthetic match was rejected"))
    assertEquals(seat, 0)

    val room = h.rooms.getRoom(gameId).unsafeRunSync().getOrElse(fail("no room was created"))
    assertEquals(room.status, RoomStatus.InProgress)
    assertEquals(room.config.playerCount, 2)
    assertEquals(room.config.effectiveDeckSize, 52)
    assertEquals(room.gameState.map(_.talon.size), Some(40))
    assertEquals(h.service.statusFor("alice").unsafeRunSync(), None)
  }

  test("the QA fallback bucket honours an explicit 52-card deck") {
    val h = harness()
    val (gameId, seat) = h.service
      .matchWithSyntheticOpponents(
        session("alice"),
        QuickPairBucketKey.Default.copy(deckSize = 52)
      )
      .unsafeRunSync()
      .getOrElse(fail("the synthetic match was rejected"))
    assertEquals(seat, 0)
    val room = h.rooms.getRoom(gameId).unsafeRunSync().getOrElse(fail("no room was created"))
    assertEquals(room.config.playerCount, 2)
    assertEquals(room.config.effectiveDeckSize, 52)
  }
