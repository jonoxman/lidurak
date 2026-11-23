package durak.session

import cats.effect.IO
import io.circe.Json
import org.http4s.*
import org.http4s.circe.CirceEntityDecoder.*
import org.http4s.circe.CirceEntityEncoder.*
import org.http4s.dsl.io.*

/**
 * The guest-session REST surface.
 *
 * These routes are self-contained (`SessionRoutes.routes(store)`), so the server
 * entry point can mount them without any other session plumbing.
 */
object SessionRoutes:

  /** The session endpoints, relative to the server root. */
  def routes(store: SessionStore[IO]): HttpRoutes[IO] = HttpRoutes.of[IO] {

    // Resolve the caller's guest, minting and cookie-ing one when necessary.
    case req @ GET -> Root / "api" / "session" =>
      SessionCookie.resolveOrCreate(req, store).flatMap { case (session, created) =>
        respond(
          session,
          created,
          Ok(SessionResponse(session.playerId, session.displayName))
        )
      }

    case req @ POST -> Root / "api" / "session" / "name" =>
      rename(store, req)
  }

  /** `POST /api/session/name` validates, persists and echoes the new name. */
  private def rename(store: SessionStore[IO], req: Request[IO]): IO[Response[IO]] =
    req.as[Json].attempt.flatMap {
      case Left(error) =>
        BadRequest(errorBody(s"Invalid JSON body: ${describe(error)}"))
      case Right(json) =>
        json.as[UpdateNameRequest] match
          case Left(error) =>
            BadRequest(errorBody(s"Invalid name request: ${describe(error)}"))
          case Right(request) =>
            SessionCookie.resolveOrCreate(req, store).flatMap { case (session, created) =>
              store.updateDisplayName(session.token, request.displayName).flatMap {
                case Left(error) =>
                  respond(session, created, BadRequest(errorBody(error)))
                case Right(updated) =>
                  respond(
                    session,
                    created,
                    Ok(SessionResponse(updated.playerId, updated.displayName))
                  )
              }
            }
    }

  /**
   * Attaches the `HttpOnly; SameSite=Strict` cookie whenever this response is the
   * one that minted the guest, so a renamed brand-new guest keeps its identity
   * even when the rename itself was rejected.
   */
  private def respond(
      session: GuestSession,
      created: Boolean,
      response: IO[Response[IO]]
  ): IO[Response[IO]] =
    if created then response.map(_.addCookie(SessionCookie.build(session.token)))
    else response

  private def errorBody(message: String): Json =
    Json.obj("error" -> Json.fromString(message))

  private def describe(error: Throwable): String =
    Option(error.getMessage).getOrElse(error.getClass.getSimpleName)
