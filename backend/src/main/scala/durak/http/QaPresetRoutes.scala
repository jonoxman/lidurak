package durak.http

import cats.effect.IO
import cats.syntax.all.*
import durak.protocol.*
import durak.protocol.ProtocolCodecs.given
import durak.rooms.{CreateRoomConfig, RoomManager}
import durak.session.{GuestSession, SessionCookie, SessionStore}
import io.circe.Json
import io.circe.syntax.*
import org.http4s.*
import org.http4s.circe.CirceEntityDecoder.*
import org.http4s.circe.CirceEntityEncoder.*
import org.http4s.dsl.io.*

/**
 * The 1-click QA Scenario Presets of the M2 lobby.
 *
 * Every preset creates a real room inside [[RoomManager]], so the reviewer
 * exercises the exact same authoritative pipeline — seat ownership, anti-cheat
 * projection, turn clocks and WebSocket broadcasts — as an organic match.
 */
object QaPresetRoutes:

  /** Default seat count of the active-match preset. */
  val DefaultPlayerCount: Int = 2

  def routes(
      sessions: SessionStore[IO],
      rooms: RoomManager[IO]
  ): HttpRoutes[IO] = HttpRoutes.of[IO] {

    // Three open public rooms, so `/ws/lobby` immediately has a live pool.
    case POST -> Root / "api" / "qa" / "presets" / "seed-lobby" =>
      val presets = Vector(
        qaHost(1, "QA Host 1") -> CreateRoomConfig(
          playerCount = 2,
          allowRedirect = true,
          turnTimeoutSeconds = 15,
          isPublic = true
        ),
        qaHost(2, "QA Host 2") -> CreateRoomConfig(
          playerCount = 3,
          allowRedirect = false,
          turnTimeoutSeconds = 30,
          isPublic = true
        ),
        qaHost(3, "QA Host 3") -> CreateRoomConfig(
          playerCount = 4,
          allowRedirect = true,
          turnTimeoutSeconds = 15,
          isPublic = true
        )
      )
      presets
        .traverse { case (host, config) => rooms.createRoom(host, config) }
        .flatMap { created =>
          val seededIds = created.collect { case Right((room, _)) => room.gameId }.toSet
          rooms.listOpenPublicRooms.flatMap { open =>
            Ok(Json.obj("rooms" -> open.filter(room => seededIds(room.gameId)).asJson))
          }
        }

    // The caller is seat 0 of a dealt match; synthetic opponents fill the rest.
    case req @ POST -> Root / "api" / "qa" / "presets" / "active-match" =>
      withGuest(req, sessions) { (session, _) =>
        requestedPlayerCount(req).flatMap { playerCount =>
          CreateRoomConfig(
            playerCount = playerCount,
            allowRedirect = true,
            turnTimeoutSeconds = 15,
            isPublic = false
          ).validate match
            case Left(error) => BadRequest(errorBody(error))
            case Right(config) =>
              val seats =
                Vector((session.playerId, session.displayName)) ++
                  (1 until playerCount).map { index =>
                    (s"qa-opp-$index", s"QA Opponent $index")
                  }
              rooms
                .createPresetRoom(config, seats, autoStartIfFull = true)
                .flatMap { room =>
                  Ok(
                    Json.obj(
                      "gameId" -> room.gameId.asJson,
                      "seatIndex" -> 0.asJson
                    )
                  )
                }
        }
      }

    // A full dealt match the caller only watches: `viewerSeat = null`, `hand = []`.
    case req @ POST -> Root / "api" / "qa" / "presets" / "spectator-match" =>
      withGuest(req, sessions) { (_, _) =>
        rooms
          .createPresetRoom(
            CreateRoomConfig(
              playerCount = 2,
              allowRedirect = true,
              turnTimeoutSeconds = 15,
              isPublic = false
            ),
            Vector(
              ("qa-spec-p1", "QA Spectator 1"),
              ("qa-spec-p2", "QA Spectator 2")
            ),
            autoStartIfFull = true
          )
          .flatMap(room => Ok(Json.obj("gameId" -> room.gameId.asJson)))
      }
  }

  /** The requested seat count, defaulting to 2 when the body omits it. */
  private def requestedPlayerCount(req: Request[IO]): IO[Int] =
    req.as[Json].attempt.map { parsed =>
      parsed.toOption
        .flatMap(_.hcursor.get[Int]("playerCount").toOption)
        .getOrElse(DefaultPlayerCount)
    }

  /** A synthetic lobby host the presets can create rooms for. */
  private def qaHost(index: Int, displayName: String): GuestSession =
    GuestSession(
      token = s"qa-token-host-$index",
      playerId = s"qa-host-$index",
      displayName = displayName,
      createdAtEpochMs = 0L,
      lastSeenAtEpochMs = 0L
    )

  /** Runs `handle` with the caller's guest, cookie-ing a newly minted one. */
  private def withGuest(
      req: Request[IO],
      sessions: SessionStore[IO]
  )(handle: (GuestSession, Boolean) => IO[Response[IO]]): IO[Response[IO]] =
    SessionCookie.resolveOrCreate(req, sessions).flatMap { case (session, created) =>
      handle(session, created).map { response =>
        if created then response.addCookie(SessionCookie.build(session.token))
        else response
      }
    }

  private def errorBody(message: String): Json =
    Json.obj("error" -> Json.fromString(message))
