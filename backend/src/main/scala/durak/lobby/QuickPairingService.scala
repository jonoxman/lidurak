package durak.lobby

import cats.effect.Async
import cats.effect.std.Semaphore
import cats.syntax.all.*
import durak.protocol.LobbyRoomSummary
import durak.rooms.{CreateRoomConfig, RoomManager}
import durak.session.GuestSession

/**
 * One Quick Pairing request: the table the player wants to be matched into.
 *
 * `playerCount`, `turnTimeoutSeconds` and `allowRedirect` are the whole match
 * fingerprint — only players asking for the exact same three values are ever
 * paired into the same room.
 */
final case class QuickPairRequest(
    playerCount: Int,
    turnTimeoutSeconds: Int = 15,
    allowRedirect: Boolean = true
):

  /** The configuration a waiting Quick Pairing room is created with. */
  def toRoomConfig: CreateRoomConfig =
    CreateRoomConfig(
      playerCount = playerCount,
      allowRedirect = allowRedirect,
      turnTimeoutSeconds = turnTimeoutSeconds,
      isPublic = true,
      isQuickPair = true
    )

/**
 * The Quick Pairing pool.
 *
 * Pairing is serialised through a single [[Semaphore]], so two players asking
 * for the same preset at the same time can never both create a fresh room:
 * the first creates the room and the second is seated into it. A player who is
 * already waiting in a matching room is returned to that same room and seat
 * instead of being given a second one.
 */
final class QuickPairingService[F[_]](
    rooms: RoomManager[F],
    mutex: Semaphore[F]
)(using F: Async[F]):

  /**
   * Matches `session` into an open Quick Pairing room with the same preset, or
   * creates a new public waiting room and seats them in seat 0.
   *
   * Returns the room id and the seat the player now occupies, so the caller can
   * navigate straight to `/g/:gameId`.
   */
  def pair(
      session: GuestSession,
      request: QuickPairRequest
  ): F[Either[String, (String, Int)]] =
    request.toRoomConfig.validate match
      case Left(error) => F.pure(Left(error))
      case Right(config) =>
        mutex.permit.use { _ =>
          rooms.listOpenPublicRooms.flatMap { open =>
            val matching = open.filter(room => matches(room, config))
            existingRoom(matching, session).flatMap {
              case Some(assigned) => F.pure(Right(assigned))
              case None =>
                matching.find(room => room.filledSeats < room.playerCount) match
                  case Some(room) =>
                    rooms.joinSeat(room.gameId, session).flatMap {
                      case Right((_, seatIndex)) =>
                        F.pure(Right((room.gameId, seatIndex)))
                      // The room changed under us (started or vanished), so
                      // fall back to opening a fresh waiting room.
                      case Left(_) => createWaitingRoom(session, config)
                    }
                  case None => createWaitingRoom(session, config)
            }
          }
        }

  /**
   * Removes `session` from every waiting Quick Pairing room they occupy.
   *
   * A waiting room whose last player leaves is removed from the pool by
   * [[RoomManager.leaveSeat]], so a cancelled pairing never lingers in the
   * live lobby.
   */
  def cancel(session: GuestSession): F[Unit] =
    mutex.permit.use { _ =>
      rooms.listOpenPublicRooms.flatMap { open =>
        open.filter(_.isQuickPair).traverse_ { room =>
          rooms.getRoomView(room.gameId, session.playerId).flatMap { view =>
            view
              .filter(_.viewerSeat.isDefined)
              .traverse_(_ => rooms.leaveSeat(room.gameId, session.playerId).void)
          }
        }
      }
    }

  /** True when `room` was opened for exactly `config`'s match fingerprint. */
  private def matches(room: LobbyRoomSummary, config: CreateRoomConfig): Boolean =
    room.isQuickPair &&
      room.playerCount == config.playerCount &&
      room.turnTimeoutSeconds == config.turnTimeoutSeconds &&
      room.allowRedirect == config.allowRedirect

  /** The room `session` is already waiting in, if any of `candidates`. */
  private def existingRoom(
      candidates: List[LobbyRoomSummary],
      session: GuestSession
  ): F[Option[(String, Int)]] =
    candidates match
      case Nil => F.pure(None)
      case room :: rest =>
        rooms.getRoomView(room.gameId, session.playerId).flatMap { view =>
          view.flatMap(_.viewerSeat) match
            case Some(seatIndex) => F.pure(Some((room.gameId, seatIndex)))
            case None            => existingRoom(rest, session)
        }

  private def createWaitingRoom(
      session: GuestSession,
      config: CreateRoomConfig
  ): F[Either[String, (String, Int)]] =
    rooms
      .createRoom(session, config)
      .map(_.map { case (room, seatIndex) => (room.gameId, seatIndex) })

object QuickPairingService:

  /** Creates an empty Quick Pairing pool backed by `rooms`. */
  def create[F[_]: Async](rooms: RoomManager[F]): F[QuickPairingService[F]] =
    Semaphore[F](1).map(new QuickPairingService[F](rooms, _))
