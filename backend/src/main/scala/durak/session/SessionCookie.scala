package durak.session

import cats.Monad
import cats.syntax.all.*
import org.http4s.{Request, ResponseCookie, SameSite}
import org.typelevel.ci.CIString

/**
 * The one place that knows how a guest credential travels: a
 * `lidurak_session` cookie that JavaScript cannot read, with a header fallback
 * for WebSocket and automated clients.
 */
object SessionCookie:

  /** Name of the cookie carrying the secret session token. */
  val CookieName: String = "lidurak_session"

  /** Header fallback for clients that cannot keep cookies (tests, bots). */
  val HeaderName: String = "X-Guest-Token"

  /** Guest sessions last 30 days, then a fresh guest is minted transparently. */
  val MaxAgeSeconds: Long = 30L * 24L * 3600L

  /**
   * The `Set-Cookie` value for a freshly minted guest session:
   * `HttpOnly`, `SameSite=Strict`, `Path=/`, 30-day `Max-Age`.
   *
   * `Secure` stays off because local development is served over plain HTTP; the
   * token is opaque and the cookie is not readable from JavaScript either way.
   */
  def build(token: String): ResponseCookie =
    ResponseCookie(
      name = CookieName,
      content = token,
      maxAge = Some(MaxAgeSeconds),
      path = Some("/"),
      sameSite = Some(SameSite.Strict),
      secure = false,
      httpOnly = true
    )

  /**
   * The guest token on `req`: the `lidurak_session` cookie first, then the
   * `X-Guest-Token` header. Blank values are ignored, so an empty cookie does
   * not shadow a valid header.
   */
  def extractToken[F[_]](req: Request[F]): Option[String] =
    def nonBlank(value: String): Option[String] =
      Option(value).map(_.trim).filter(_.nonEmpty)

    req.cookies
      .find(_.name == CookieName)
      .flatMap(cookie => nonBlank(cookie.content))
      .orElse(
        // `CIString` equality is case-insensitive, so `x-guest-token` works too.
        req.headers.headers
          .find(_.name == CIString(HeaderName))
          .flatMap(header => nonBlank(header.value))
      )

  /**
   * Resolves the caller's guest session, minting one when the request carries no
   * usable token. `wasNewlyCreated` tells the route to attach the `Set-Cookie`
   * header; a known token resolves to `false` and refreshes `lastSeenAt`.
   */
  def resolveOrCreate[F[_]: Monad](
      req: Request[F],
      store: SessionStore[F]
  ): F[(GuestSession, Boolean)] =
    extractToken(req) match
      case None =>
        store.createGuest().map(session => (session, true))
      case Some(token) =>
        store.touchAndFind(token).flatMap {
          case Some(session) => Monad[F].pure((session, false))
          case None =>
            // A stale or forged token is treated exactly like no token at all.
            store.createGuest().map(session => (session, true))
        }
