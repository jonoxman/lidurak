package durak.lobby

import cats.effect.Async
import cats.effect.std.Semaphore
import cats.syntax.all.*
import durak.rooms.{CreateRoomConfig, GameRoom, RoomManager}
import durak.session.GuestSession
import io.circe.Decoder

/**
 * Body of `POST /api/quick-pair`.
 *
 * A player asking for Quick Pairing only ever states the match preset they
 * want; the server decides which open room they land in.
 */
final case class QuickPairRequest(
    playerCount: Int,
    turnTimeoutSeconds: Int = QuickPairRequest.DefaultTurnTimeoutSeconds,
    allowRedirect: Boolean = true
)

object QuickPairRequest:

  /** The same fifteen-second clock every new room starts with. */
  val DefaultTurnTimeoutSeconds: Int = 15

  /** Missing optional fields fall back to the standard room preset. */
  given Decoder[QuickPairRequest] = Decoder.instance { cursor =>
    for
      playerCount <- cursor.downField("playerCount").as[Int]
      turnTimeoutSeconds <- cursor
        .downField("turnTimeoutSeconds")
        .as[Option[Int]]
        .map(_.getOrElse(DefaultTurnTimeoutSeconds))
      allowRedirect <- cursor
        .downField("allowRedirect")
        .as[Option[Boolean]]
        .map(_.getOrElse(true))
    yield QuickPairRequest(playerCount, turnTimeoutSeconds, allowRedirect)
  }

/**
 * The Quick Pairing pool.
 *
 * Every pairing decision goes through one mutex, so two simultaneous requests
 * can never both decide that no room is waiting and both create one: the
 * second request sees the first player's room and joins it instead.
 *
 * The pool has no storage of its own. It reads the authoritative waiting
 * quick-pair rooms straight out of [[RoomManager]], which means a room that
 * leaves the lobby (because it fills up) disappears from the pool in the same
 * transition, with no bookkeeping to keep in sync.
 */
final class QuickPairingService[F[_]](
    roomManager: RoomManager[F],
    mutex: Semaphore[F]
)(using F: Async[F]):

  /**
   * Seats `session` in a waiting room whose preset matches `request`, or opens
   * a new public quick-pair room when nobody is waiting.
   *
   * A player who already occupies a waiting quick-pair room is handed that same
   * room and seat back instead of being paired into a second one, so a repeated
   * click is harmless.
   */
  def pair(
      session: GuestSession,
      request: QuickPairRequest
  ): F[Either[String, (String, Int)]] =
    configFor(request).validate match
      case Left(error)  => F.pure(Left(error))
      case Right(valid) => mutex.permit.use(_ => pairLocked(session, valid))

  /** Removes `session` from every waiting quick-pair room they occupy. */
  def cancel(session: GuestSession): F[Unit] =
    mutex.permit.use(_ =>
      waitingQuickPairRooms.flatMap(
        _.filter(_.seatIndexOf(session.playerId).isDefined)
          .traverse_(room => roomManager.leaveSeat(room.gameId, session.playerId).void)
      )
    )

  private def pairLocked(
      session: GuestSession,
      config: CreateRoomConfig
  ): F[Either[String, (String, Int)]] =
    waitingQuickPairRooms.flatMap { rooms =>
      rooms.find(_.seatIndexOf(session.playerId).isDefined) match
        case Some(mine) =>
          // Already waiting: re-attach through the same authoritative join path
          // and answer with the seat that player already holds.
          roomManager
            .joinSeat(mine.gameId, session)
            .map(_.map { case (_, seatIndex) => (mine.gameId, seatIndex) })
        case None =>
          val candidates =
            rooms.filter(matches(_, config)).sortBy(_.createdAtEpochMs)
          tryJoin(candidates, session).flatMap {
            case Some(joined) => F.pure(Right(joined))
            case None =>
              roomManager.createRoom(session, config).map {
                case Right((room, seatIndex)) => Right((room.gameId, seatIndex))
                case Left(error)              => Left(error)
              }
          }
    }

  /**
   * Joins the first candidate that still has an open seat. A room can fill up
   * between the snapshot and the join, so a rejection simply moves on to the
   * next one.
   */
  private def tryJoin(
      candidates: List[GameRoom],
      session: GuestSession
  ): F[Option[(String, Int)]] =
    candidates match
      case Nil => F.pure(None)
      case room :: rest =>
        roomManager.joinSeat(room.gameId, session).flatMap {
          case Right((_, seatIndex)) => F.pure(Some((room.gameId, seatIndex)))
          case Left(_)               => tryJoin(rest, session)
        }

  /** Every public quick-pair room that is still waiting for players. */
  private def waitingQuickPairRooms: F[List[GameRoom]] =
    roomManager.listOpenPublicRooms.flatMap { summaries =>
      summaries
        .filter(_.isQuickPair)
        .traverse(summary => roomManager.getRoom(summary.gameId))
        .map(_.flatten)
    }

  /** Two requests only share a room when all three preset fields agree. */
  private def matches(room: GameRoom, config: CreateRoomConfig): Boolean =
    room.config.playerCount == config.playerCount &&
      room.config.turnTimeoutSeconds == config.turnTimeoutSeconds &&
      room.config.allowRedirect == config.allowRedirect &&
      room.filledSeats < room.config.playerCount

  /** The public quick-pair room a new pairing request would create. */
  private def configFor(request: QuickPairRequest): CreateRoomConfig =
    CreateRoomConfig(
      playerCount = request.playerCount,
      allowRedirect = request.allowRedirect,
      turnTimeoutSeconds = request.turnTimeoutSeconds,
      isPublic = true,
      isQuickPair = true
    )

object QuickPairingService:

  /** Creates the single shared Quick Pairing pool of one room manager. */
  def create[F[_]: Async](roomManager: RoomManager[F]): F[QuickPairingService[F]] =
    Semaphore[F](1).map(mutex => new QuickPairingService[F](roomManager, mutex))
