package durak.session

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*

import java.util.Base64
import scala.concurrent.duration.*

class SessionStoreSpec extends munit.FunSuite:

  private def newStore: SessionStore[IO] =
    SessionStore.inMemory[IO].unsafeRunSync()

  private val PlayerIdPattern = "^guest-[a-z0-9]{8}$".r
  private val GuestNamePattern = "^Guest-[A-Z0-9]{4}$".r

  test("createGuest mints a 256-bit Base64URL token and a distinct public player id") {
    val store = newStore
    val session = store.createGuest().unsafeRunSync()

    // 32 random bytes, Base64URL-encoded without padding.
    val decoded = Base64.getUrlDecoder.decode(session.token)
    assertEquals(decoded.length, SessionToken.ByteLength)
    assertEquals(decoded.length * 8, 256)
    assertEquals(session.token.length, 43)
    assert(
      session.token.matches("^[A-Za-z0-9_-]+$"),
      s"token is not cookie/header safe: ${session.token}"
    )
    assertEquals(
      Base64.getUrlEncoder.withoutPadding().encodeToString(decoded),
      session.token
    )

    // The public id is a separate identifier, never the secret token.
    assertNotEquals(session.playerId, session.token)
    assert(PlayerIdPattern.matches(session.playerId), session.playerId)
    assert(!session.token.startsWith("guest-"), session.token)
  }

  test("tokens and player ids are unique across many guest sessions") {
    val store = newStore
    val sessions = (1 to 200).toList.traverse(_ => store.createGuest()).unsafeRunSync()

    val tokens = sessions.map(_.token)
    assertEquals(tokens.distinct.size, sessions.size)
    val playerIds = sessions.map(_.playerId)
    assertEquals(playerIds.distinct.size, sessions.size)
  }

  test("a new guest receives a generated Guest-XXXX display name") {
    val store = newStore
    val session = store.createGuest().unsafeRunSync()

    assert(GuestNamePattern.matches(session.displayName), session.displayName)
    assertEquals(session.createdAtEpochMs, session.lastSeenAtEpochMs)
    assert(session.createdAtEpochMs > 0L)
  }

  test("createGuest keeps a valid provided name and falls back for an invalid one") {
    val store = newStore
    val named = store.createGuest(Some("  Alice  ")).unsafeRunSync()
    assertEquals(named.displayName, "Alice")

    val blank = store.createGuest(Some("   ")).unsafeRunSync()
    assert(GuestNamePattern.matches(blank.displayName), blank.displayName)

    val tooShort = store.createGuest(Some("A")).unsafeRunSync()
    assert(GuestNamePattern.matches(tooShort.displayName), tooShort.displayName)

    val control = store.createGuest(Some("Bo\u0000b")).unsafeRunSync()
    assert(GuestNamePattern.matches(control.displayName), control.displayName)
  }

  test("findByToken returns only the matching session") {
    val store = newStore
    val alice = store.createGuest(Some("Alice")).unsafeRunSync()
    val bob = store.createGuest(Some("Bob")).unsafeRunSync()

    assertEquals(store.findByToken(alice.token).unsafeRunSync(), Some(alice))
    assertEquals(store.findByToken(bob.token).unsafeRunSync(), Some(bob))
    assertEquals(store.findByToken("not-a-real-token").unsafeRunSync(), None)
  }

  test("touchAndFind keeps the session and advances lastSeenAtEpochMs") {
    val store = newStore
    val session = store.createGuest().unsafeRunSync()

    val touched = (IO.sleep(10.millis) *> store.touchAndFind(session.token)).unsafeRunSync()

    assertEquals(touched.map(_.playerId), Some(session.playerId))
    assertEquals(touched.map(_.displayName), Some(session.displayName))
    assertEquals(touched.map(_.createdAtEpochMs), Some(session.createdAtEpochMs))
    assert(
      touched.exists(_.lastSeenAtEpochMs > session.lastSeenAtEpochMs),
      s"lastSeen did not advance: ${touched.map(_.lastSeenAtEpochMs)}"
    )
    assertEquals(store.findByToken(session.token).unsafeRunSync(), touched)
  }

  test("touchAndFind returns None for an unknown token") {
    val store = newStore
    assertEquals(store.touchAndFind("missing").unsafeRunSync(), None)
  }

  test("updateDisplayName trims, persists and advances lastSeenAtEpochMs") {
    val store = newStore
    val session = store.createGuest(Some("Guest A")).unsafeRunSync()

    val renamed = (IO.sleep(10.millis) *> store.updateDisplayName(session.token, "  New Name  "))
      .unsafeRunSync()

    val updated = renamed.getOrElse(fail(s"rename was rejected: $renamed"))
    assertEquals(updated.displayName, "New Name")
    assertEquals(updated.playerId, session.playerId)
    assertEquals(updated.token, session.token)
    assert(updated.lastSeenAtEpochMs > session.lastSeenAtEpochMs)
    assertEquals(store.findByToken(session.token).unsafeRunSync(), Some(updated))
  }

  test("updateDisplayName accepts the 2 and 20 character boundaries") {
    val store = newStore
    val session = store.createGuest().unsafeRunSync()

    assertEquals(
      store.updateDisplayName(session.token, "Al").unsafeRunSync().map(_.displayName),
      Right("Al")
    )
    val twenty = "Abcdefghijklmnopqrst"
    assertEquals(twenty.length, 20)
    assertEquals(
      store.updateDisplayName(session.token, twenty).unsafeRunSync().map(_.displayName),
      Right(twenty)
    )
  }

  test("updateDisplayName rejects blank, too short, too long and control-character names") {
    val store = newStore
    val session = store.createGuest(Some("Alice")).unsafeRunSync()

    val invalid = List(
      "",
      "   ",
      "A",
      "  A  ",
      "Abcdefghijklmnopqrstu%", // 21 characters
      "Bad\u0000Name",
      "Bad\nName"
    )

    invalid.foreach { candidate =>
      val result = store.updateDisplayName(session.token, candidate).unsafeRunSync()
      assert(result.isLeft, s"accepted invalid name ${candidate.replace("\u0000", "\\0")}")
      assert(result.swap.exists(_.nonEmpty), s"empty error for $candidate")
    }

    // Every rejection left the stored session untouched.
    assertEquals(store.findByToken(session.token).unsafeRunSync().map(_.displayName), Some("Alice"))
  }

  test("updateDisplayName rejects an unknown token even with a valid name") {
    val store = newStore
    val result = store.updateDisplayName("missing", "Alice").unsafeRunSync()

    assert(result.isLeft)
    assertEquals(result, Left(SessionStore.unknownSessionError("missing")))
  }

  test("two guest sessions stay independent") {
    val store = newStore
    val alice = store.createGuest(Some("Alice")).unsafeRunSync()
    val bob = store.createGuest(Some("Bob")).unsafeRunSync()

    assertEquals(
      store.updateDisplayName(alice.token, "Alicia").unsafeRunSync().map(_.displayName),
      Right("Alicia")
    )
    assertEquals(store.findByToken(alice.token).unsafeRunSync().map(_.displayName), Some("Alicia"))
    assertEquals(store.findByToken(bob.token).unsafeRunSync().map(_.displayName), Some("Bob"))
  }

  test("DisplayName.validate trims and counts characters") {
    assertEquals(DisplayName.validate("  Bob  "), Right("Bob"))
    assertEquals(DisplayName.validate("A").isLeft, true)
    assertEquals(DisplayName.validate("").isLeft, true)
    assertEquals(DisplayName.validate("   ").isLeft, true)
    assertEquals(DisplayName.validate("Bo\u0007b").isLeft, true)
    assertEquals(DisplayName.validate("B" * 21).isLeft, true)
  }
