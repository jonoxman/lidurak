package durak.session

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import io.circe.Json
import io.circe.syntax.*
import org.http4s.*
import org.http4s.circe.CirceEntityDecoder.*
import org.http4s.circe.CirceEntityEncoder.*
import org.http4s.headers.`Content-Type`
import org.typelevel.ci.CIString

class SessionRoutesSpec extends munit.FunSuite:

  private val PlayerIdPattern = "^guest-[a-z0-9]{8}$".r
  private val GuestNamePattern = "^Guest-[A-Z0-9]{4}$".r

  private def newStore: SessionStore[IO] =
    SessionStore.inMemory[IO].unsafeRunSync()

  private def send(store: SessionStore[IO], request: Request[IO]): Response[IO] =
    SessionRoutes.routes(store).orNotFound.run(request).unsafeRunSync()

  private def request(
      method: Method,
      path: String,
      cookieToken: Option[String] = None,
      headerToken: Option[String] = None
  ): Request[IO] =
    val base = Request[IO](method, Uri.unsafeFromString(path))
    val withHeader = headerToken.fold(base) { token =>
      base.putHeaders(Header.Raw(CIString(SessionCookie.HeaderName), token))
    }
    cookieToken.fold(withHeader) { token =>
      withHeader.addCookie(RequestCookie(SessionCookie.CookieName, token))
    }

  private def get(
      store: SessionStore[IO],
      path: String,
      cookieToken: Option[String] = None,
      headerToken: Option[String] = None
  ): Response[IO] =
    send(store, request(Method.GET, path, cookieToken, headerToken))

  private def postName(
      store: SessionStore[IO],
      body: Json,
      cookieToken: Option[String] = None
  ): Response[IO] =
    send(
      store,
      request(Method.POST, "/api/session/name", cookieToken)
        .withEntity(body)
        .withContentType(`Content-Type`(MediaType.application.json))
    )

  private def bodyOf(response: Response[IO]): Json =
    response.as[Json].unsafeRunSync()

  private def field(json: Json, name: String): String =
    json.hcursor
      .get[String](name)
      .getOrElse(fail(s"missing $name in ${json.noSpaces}"))

  private def sessionCookie(response: Response[IO]): ResponseCookie =
    response.cookies
      .find(_.name == SessionCookie.CookieName)
      .getOrElse(fail(s"no ${SessionCookie.CookieName} cookie in ${response.headers}"))

  // --- GET /api/session ---

  test("GET /api/session mints a guest and returns only the public identity") {
    val store = newStore
    val response = get(store, "/api/session")

    assertEquals(response.status, Status.Ok)
    assertEquals(response.cookies.size, 1)

    val cookie = sessionCookie(response)
    assert(cookie.content.nonEmpty, "empty session cookie")
    assert(cookie.httpOnly, "cookie is not HttpOnly")
    assert(cookie.sameSite.contains(SameSite.Strict), "cookie is not SameSite=Strict")
    assertEquals(cookie.path, Some("/"))
    assertEquals(cookie.maxAge, Some(SessionCookie.MaxAgeSeconds))
    assertEquals(SessionCookie.MaxAgeSeconds, 30L * 24L * 3600L)
    val rendered = cookie.renderString
    assert(rendered.contains("HttpOnly"), rendered)
    assert(rendered.contains("SameSite=Strict"), rendered)
    assert(rendered.contains("Path=/"), rendered)

    val body = bodyOf(response)
    val playerId = field(body, "playerId")
    assert(PlayerIdPattern.matches(playerId), playerId)
    assert(GuestNamePattern.matches(field(body, "displayName")), body.noSpaces)
    assertEquals(body.hcursor.get[Boolean]("isGuest").toOption, Some(true))

    // The secret token never crosses the JSON boundary.
    assert(!body.noSpaces.contains(cookie.content), body.noSpaces)
    assert(!body.noSpaces.contains("\"token\""), body.noSpaces)
    assertEquals(store.findByToken(cookie.content).unsafeRunSync().map(_.playerId), Some(playerId))
  }

  test("a request carrying the cookie reuses the exact same playerId without a new cookie") {
    val store = newStore
    val minted = get(store, "/api/session")
    val token = sessionCookie(minted).content
    val playerId = field(bodyOf(minted), "playerId")

    val reused = get(store, "/api/session", cookieToken = Some(token))
    assertEquals(reused.status, Status.Ok)
    assertEquals(reused.cookies, Nil)
    val reusedBody = bodyOf(reused)
    assertEquals(field(reusedBody, "playerId"), playerId)
    assert(field(reusedBody, "displayName").nonEmpty)

    // Repeated requests stay on the same identity.
    val again = get(store, "/api/session", cookieToken = Some(token))
    assertEquals(field(bodyOf(again), "playerId"), playerId)
  }

  test("the X-Guest-Token header resolves the session when no cookie is sent") {
    val store = newStore
    val minted = get(store, "/api/session")
    val token = sessionCookie(minted).content
    val playerId = field(bodyOf(minted), "playerId")

    val reused = get(store, "/api/session", headerToken = Some(token))
    assertEquals(reused.status, Status.Ok)
    assertEquals(field(bodyOf(reused), "playerId"), playerId)
    assertEquals(reused.cookies, Nil)
  }

  test("the cookie takes precedence over the header token") {
    val store = newStore
    val cookieSession = get(store, "/api/session")
    val otherSession = get(store, "/api/session")
    val cookieToken = sessionCookie(cookieSession).content
    val otherToken = sessionCookie(otherSession).content
    val cookiePlayerId = field(bodyOf(cookieSession), "playerId")
    assertNotEquals(cookiePlayerId, field(bodyOf(otherSession), "playerId"))

    val resolved = get(
      store,
      "/api/session",
      cookieToken = Some(cookieToken),
      headerToken = Some(otherToken)
    )
    assertEquals(field(bodyOf(resolved), "playerId"), cookiePlayerId)
    assertEquals(resolved.cookies, Nil)
  }

  test("a stale or forged token mints a fresh guest and sets the cookie") {
    val store = newStore
    val response = get(store, "/api/session", cookieToken = Some("forged-token"))

    assertEquals(response.status, Status.Ok)
    val cookie = sessionCookie(response)
    assertNotEquals(cookie.content, "forged-token")
    val playerId = field(bodyOf(response), "playerId")
    assert(PlayerIdPattern.matches(playerId), playerId)
    assertEquals(store.findByToken(cookie.content).unsafeRunSync().map(_.playerId), Some(playerId))
  }

  // --- POST /api/session/name ---

  test("POST /api/session/name renames the guest and persists it") {
    val store = newStore
    val minted = get(store, "/api/session")
    val token = sessionCookie(minted).content
    val playerId = field(bodyOf(minted), "playerId")

    val response = postName(store, Json.obj("displayName" -> "  Alice  ".asJson), Some(token))

    assertEquals(response.status, Status.Ok)
    assertEquals(response.cookies, Nil)
    val body = bodyOf(response)
    assertEquals(field(body, "playerId"), playerId)
    assertEquals(field(body, "displayName"), "Alice")
    assertEquals(body.hcursor.get[Boolean]("isGuest").toOption, Some(true))
    assert(!body.noSpaces.contains(token), body.noSpaces)

    // The rename is visible on the next session read.
    val reread = get(store, "/api/session", cookieToken = Some(token))
    assertEquals(field(bodyOf(reread), "displayName"), "Alice")
    assertEquals(store.findByToken(token).unsafeRunSync().map(_.displayName), Some("Alice"))
  }

  test("POST /api/session/name rejects invalid names with 400 and keeps the old one") {
    val store = newStore
    val token = sessionCookie(get(store, "/api/session")).content
    val original = store.findByToken(token).unsafeRunSync().map(_.displayName)

    val invalidNames = List("", "   ", "A", "Abcdefghijklmnopqrstu", "Bad\u0000Name")

    invalidNames.foreach { candidate =>
      val response = postName(store, Json.obj("displayName" -> candidate.asJson), Some(token))
      assertEquals(response.status, Status.BadRequest, s"accepted ${candidate.take(25)}")
      val body = bodyOf(response)
      assert(
        body.hcursor.get[String]("error").exists(_.nonEmpty),
        s"no error message for ${candidate.take(25)}: ${body.noSpaces}"
      )
      assertEquals(store.findByToken(token).unsafeRunSync().map(_.displayName), original)
    }
  }

  test("POST /api/session/name without a session mints one and sets the cookie") {
    val store = newStore
    val response = postName(store, Json.obj("displayName" -> "Newcomer".asJson))

    assertEquals(response.status, Status.Ok)
    val cookie = sessionCookie(response)
    assert(cookie.httpOnly, "cookie is not HttpOnly")
    assert(cookie.sameSite.contains(SameSite.Strict), "cookie is not SameSite=Strict")
    assertEquals(cookie.path, Some("/"))

    val body = bodyOf(response)
    assertEquals(field(body, "displayName"), "Newcomer")
    assert(PlayerIdPattern.matches(field(body, "playerId")), body.noSpaces)
    assertEquals(
      store.findByToken(cookie.content).unsafeRunSync().map(_.displayName),
      Some("Newcomer")
    )
  }

  test("POST /api/session/name rejects a malformed body with 400") {
    val store = newStore

    val response = send(
      store,
      request(Method.POST, "/api/session/name")
        .withEntity(Json.obj("nickname" -> "Alice".asJson))
        .withContentType(`Content-Type`(MediaType.application.json))
    )

    assertEquals(response.status, Status.BadRequest)
    assert(bodyOf(response).hcursor.get[String]("error").exists(_.nonEmpty))
  }

  test("the session routes never expose the raw token in JSON") {
    val store = newStore
    val minted = get(store, "/api/session")
    val token = sessionCookie(minted).content

    val renameBody = bodyOf(postName(store, Json.obj("displayName" -> "Alice".asJson), Some(token)))
    val readBody = bodyOf(get(store, "/api/session", cookieToken = Some(token)))

    assert(!renameBody.noSpaces.contains(token), renameBody.noSpaces)
    assert(!readBody.noSpaces.contains(token), readBody.noSpaces)
    assertEquals(SessionCookie.CookieName, "lidurak_session")
    assertEquals(SessionCookie.HeaderName, "X-Guest-Token")
  }
