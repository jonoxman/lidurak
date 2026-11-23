package durak.http

import cats.effect.IO
import cats.syntax.all.*
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
 * The one-click QA scenario presets of the lobby and multiplayer round.
 *
 * Every preset builds a real room in the same [[RoomManager]] an organic game
 * uses, so the anti-cheat projection, the turn clocks and the lobby broadcasts
 * behave exactly as they do for real players. Nothing here fabricates a
 * `PlayerGameView`: the reviewer's browser reads the same `/api/games/:id` and
 * `/ws/games/:id` it always reads.
 */
object QaPresetRoutes:

  /** Seed of every preset deal, so a preset always shows the same hands. */
  val PresetSeed: Long = 20261123L

  /** Player count an `active-match` preset uses when the body omits one. */
  val DefaultPlayerCount: Int = 2

  /** Synthetic hosts of the three seeded lobby rooms. */
  val SeedLobbyHosts: Vector[(String, String)] = Vector(
    "qa-host-1" -> "QA Host 1",
    "qa-host-2" -> "QA Host 2",
    "qa-host-3" -> "QA Host 3"
  )

  /**
   * The three seeded rooms, in order: `2P • 15s Redirect ON`,
   * `3P • 30s Redirect OFF` and `4P • 15s Redirect ON`.
   */
  val SeedLobbyConfigs: Vector[CreateRoomConfig] = Vector(
    CreateRoomConfig(
      playerCount = 2,
      allowRedirect = true,
      turnTimeoutSeconds = 15,
      isPublic = true
    ),
    CreateRoomConfig(
      playerCount = 3,
      allowRedirect = false,
      turnTimeoutSeconds = 30,
      isPublic = true
    ),
    CreateRoomConfig(
      playerCount = 4,
      allowRedirect = true,
      turnTimeoutSeconds = 15,
      isPublic = true
    )
  )

  /** Prefix of the synthetic opponents a preset seats around the caller. */
  val SyntheticOpponentPrefix: String = "qa-opp-"

  /** The two synthetic players of the spectator preset. */
  val SpectatorSeats: Vector[(String, String)] = Vector(
    "qa-spec-p1" -> "QA Spectator One",
    "qa-spec-p2" -> "QA Spectator Two"
  )

  /** The preset endpoints, relative to the server root. */
  def routes(
      store: SessionStore[IO],
      roomManager: RoomManager[IO]
  ): HttpRoutes[IO] = HttpRoutes.of[IO] {

    // Three real open rooms, so `/ws/lobby` immediately pushes joinable tables.
    case POST -> Root / "api" / "qa" / "presets" / "seed-lobby" =>
      seedLobby(roomManager)

    case req @ POST -> Root / "api" / "qa" / "presets" / "active-match" =>
      activeMatch(store, roomManager, req)

    case req @ POST -> Root / "api" / "qa" / "presets" / "spectator-match" =>
      spectatorMatch(store, roomManager, req)
  }

  private def seedLobby(roomManager: RoomManager[IO]): IO[Response[IO]] =
    SeedLobbyHosts
      .zip(SeedLobbyConfigs)
      .traverse { case ((playerId, displayName), config) =>
        roomManager.createRoom(syntheticSession(playerId, displayName), config)
      }
      .flatMap { results =>
        val rooms = results.collect { case Right((room, _)) => room.lobbySummary }
        Ok(Json.obj("rooms" -> rooms.asJson))
      }

  /**
   * Seats the caller in seat 0 of a fully dealt private match and fills the
   * other seats with synthetic opponents, so opening `/g/:gameId` lands in an
   * active game with a real hand immediately.
   */
  private def activeMatch(
      store: SessionStore[IO],
      roomManager: RoomManager[IO],
      req: Request[IO]
  ): IO[Response[IO]] =
    playerCountOf(req).flatMap {
      case Left(error) => BadRequest(errorJson(error))
      case Right(playerCount) =>
        withSession(req, store) { (session, _) =>
          val opponents = (1 until playerCount).toVector.map { idx =>
            s"$SyntheticOpponentPrefix$idx" -> s"QA Opponent $idx"
          }
          roomManager
            .createPresetRoom(
              CreateRoomConfig(
                playerCount = playerCount,
                allowRedirect = true,
                turnTimeoutSeconds = 15,
                isPublic = false
              ),
              (session.playerId -> session.displayName) +: opponents,
              autoStartIfFull = true,
              seed = Some(PresetSeed)
            )
            .flatMap(room =>
              Ok(
                Json.obj(
                  "gameId" -> room.gameId.asJson,
                  "seatIndex" -> 0.asJson
                )
              )
            )
        }
    }

  /**
   * Deals a full two-player match whose seats are both synthetic, so the caller
   * is never a player: opening the room demonstrates read-only Spectator mode
   * (`viewerSeat: null`, `hand: []`).
   */
  private def spectatorMatch(
      store: SessionStore[IO],
      roomManager: RoomManager[IO],
      req: Request[IO]
  ): IO[Response[IO]] =
    withSession(req, store) { (_, _) =>
      roomManager
        .createPresetRoom(
          CreateRoomConfig(
            playerCount = SpectatorSeats.size,
            allowRedirect = true,
            turnTimeoutSeconds = 15,
            isPublic = false
          ),
          SpectatorSeats,
          autoStartIfFull = true,
          seed = Some(PresetSeed)
        )
        .flatMap(room => Ok(Json.obj("gameId" -> room.gameId.asJson)))
    }

  /** `{ "playerCount": 2..4 }`, defaulting to two for an empty body. */
  private def playerCountOf(req: Request[IO]): IO[Either[String, Int]] =
    req.as[Json].attempt.map {
      case Left(_) => Right(DefaultPlayerCount)
      case Right(json) =>
        json.hcursor.downField("playerCount").as[Int].toOption match
          case None => Right(DefaultPlayerCount)
          case Some(count)
              if CreateRoomConfig.SupportedPlayerCounts.contains(count) =>
            Right(count)
          case Some(count) =>
            Left(
              s"Unsupported player count: $count (expected 2, 3, or 4)"
            )
    }

  /** A host that exists only for a preset room; it never holds a real token. */
  private def syntheticSession(
      playerId: String,
      displayName: String
  ): GuestSession =
    GuestSession(
      token = s"qa-session-$playerId",
      playerId = playerId,
      displayName = displayName,
      createdAtEpochMs = 0L,
      lastSeenAtEpochMs = 0L
    )

  private def withSession(
      req: Request[IO],
      store: SessionStore[IO]
  )(respond: (GuestSession, Boolean) => IO[Response[IO]]): IO[Response[IO]] =
    SessionCookie.resolveOrCreate(req, store).flatMap { case (session, created) =>
      respond(session, created).map { response =>
        if created then response.addCookie(SessionCookie.build(session.token))
        else response
      }
    }

  private def errorJson(message: String): Json =
    Json.obj("error" -> Json.fromString(message))
