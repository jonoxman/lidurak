package durak.lobby

import cats.effect.{Async, Ref, Resource}
import cats.effect.std.{Queue, Semaphore}
import cats.syntax.all.*
import durak.rooms.{CreateRoomConfig, RoomManager}
import durak.session.GuestSession
import fs2.Stream
import io.circe.Decoder

/**
 * Body of `POST /api/quick-pair`.
 *
 * A player asking for Quick Pairing only ever states the match preset they
 * want; the server decides when enough players have asked for the same preset
 * and only then deals a table.
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
 * The identity of one matchmaking bucket: players only ever match with players
 * who asked for exactly the same preset.
 */
final case class QuickPairBucket(
    playerCount: Int,
    turnTimeoutSeconds: Int,
    allowRedirect: Boolean
):

  /** The private room this bucket deals when it fills up. */
  def config: CreateRoomConfig =
    CreateRoomConfig(
      playerCount = playerCount,
      allowRedirect = allowRedirect,
      turnTimeoutSeconds = turnTimeoutSeconds,
      isPublic = false,
      isQuickPair = true
    )

  /** `Right(this)` when the preset is supported by the room engine. */
  def validate: Either[String, QuickPairBucket] =
    config.validate.map(_ => this)

/** One waiting player, in arrival order inside their bucket. */
final case class QueuedPlayer(
    playerId: String,
    displayName: String,
    queuedAtEpochMs: Long
)

/** The answer to a `POST /api/quick-pair`: waiting, or actually seated. */
enum QuickPairOutcome:
  case Queued(bucket: QuickPairBucket, queuedCount: Int)
  case Matched(gameId: String, seatIndex: Int)

/** A private match-found notification for one matched player. */
final case class QuickPairMatch(gameId: String, seatIndex: Int)

/**
 * The Quick Pairing matchmaking queue.
 *
 * Players are held in an in-memory queue keyed by their full preset
 * [[QuickPairBucket]]. No room exists and nobody is seated while a bucket holds
 * fewer than `playerCount` distinct players, so a lone player stays on the
 * lobby screen instead of being dumped into an empty `WaitingForPlayers` room.
 *
 * One mutex serialises every queue decision, so two simultaneous requests
 * cannot both believe they are the `playerCount`-th player and deal two tables:
 * the second one sees the first one's entry and either waits or completes the
 * match. When the last seat fills, the whole bucket is dequeued at once and the
 * private room is dealt through [[RoomManager]] with every matched player
 * seated in arrival order.
 *
 * Matched players are notified through [[listen]] rather than by polling, which
 * is what lets `/ws/lobby` push `quickPairMatched` to exactly the players in
 * that one match.
 */
final class QuickPairingService[F[_]](
    roomManager: RoomManager[F],
    queues: Ref[F, Map[QuickPairBucket, Vector[QueuedPlayer]]],
    listeners: Ref[F, Map[String, Queue[F, QuickPairMatch]]],
    mutex: Semaphore[F]
)(using F: Async[F]):

  /**
   * Enqueues `session` for `request` and deals a match when the bucket fills.
   *
   * Re-submitting moves the player cleanly to the requested bucket (they are
   * removed from every other bucket first), so a repeated click can never
   * duplicate an entry or leave a ghost behind.
   */
  def pair(
      session: GuestSession,
      request: QuickPairRequest
  ): F[Either[String, QuickPairOutcome]] =
    QuickPairBucket(
      playerCount = request.playerCount,
      turnTimeoutSeconds = request.turnTimeoutSeconds,
      allowRedirect = request.allowRedirect
    ).validate match
      case Left(error)  => F.pure(Left(error))
      case Right(bucket) => mutex.permit.use(_ => pairLocked(session, bucket))

  /** Removes `session` from every quick-pair bucket. */
  def cancel(session: GuestSession): F[Unit] =
    withdraw(session.playerId)

  /**
   * Removes one player from every bucket.
   *
   * Called when the player cancels, disconnects their lobby socket or joins /
   * creates another room directly, so a stale entry can never be pulled into a
   * ghost match later.
   */
  def withdraw(playerId: String): F[Unit] =
    mutex.permit.use(_ =>
      queues.update { current =>
        current.flatMap { case (bucket, waiting) =>
          val kept = waiting.filterNot(_.playerId == playerId)
          if kept.isEmpty then None else Some(bucket -> kept)
        }
      }
    )

  /**
   * Streams this player's private match notifications for as long as the
   * returned resource is open (`/ws/lobby` holds it for the socket lifetime).
   */
  def listen(playerId: String): Resource[F, Stream[F, QuickPairMatch]] =
    Resource
      .make(
        Queue.unbounded[F, QuickPairMatch].flatMap { queue =>
          listeners.update(_.updated(playerId, queue)).as(queue)
        }
      ) { queue =>
        listeners.update { current =>
          if current.get(playerId).contains(queue) then current - playerId else current
        }
      }
      .map(queue => Stream.fromQueueUnterminated(queue))

  private def pairLocked(
      session: GuestSession,
      bucket: QuickPairBucket
  ): F[Either[String, QuickPairOutcome]] =
    F.delay(System.currentTimeMillis()).flatMap { now =>
      val entry = QueuedPlayer(session.playerId, session.displayName, now)
      queues
        .modify { current =>
          val cleared = current.flatMap { case (key, waiting) =>
            val kept = waiting.filterNot(_.playerId == session.playerId)
            if kept.isEmpty then None else Some(key -> kept)
          }
          val waiting = cleared.getOrElse(bucket, Vector.empty) :+ entry
          if waiting.size >= bucket.playerCount then
            val (matched, rest) = waiting.splitAt(bucket.playerCount)
            val next =
              if rest.isEmpty then cleared - bucket
              else cleared.updated(bucket, rest)
            (next, Left(matched.toList))
          else
            (cleared.updated(bucket, waiting), Right(waiting.size))
        }
        .flatMap {
          case Right(queuedCount) =>
            F.pure(Right(QuickPairOutcome.Queued(bucket, queuedCount)))
          case Left(matched) =>
            startMatch(bucket, matched, session.playerId)
        }
    }

  /** Deals the private room and answers/notifies every matched player. */
  private def startMatch(
      bucket: QuickPairBucket,
      matched: List[QueuedPlayer],
      requesterId: String
  ): F[Either[String, QuickPairOutcome]] =
    val seats = matched.map(player => (player.playerId, player.displayName)).toVector
    roomManager
      .createPresetRoom(bucket.config, seats, autoStartIfFull = true)
      .attempt
      .flatMap {
        case Right(room) =>
          matched.zipWithIndex
            .traverse_ { case (player, seatIndex) =>
              notify(player.playerId, QuickPairMatch(room.gameId, seatIndex))
            }
            .as(
              Right(
                QuickPairOutcome.Matched(
                  room.gameId,
                  matched.indexWhere(_.playerId == requesterId).max(0)
                )
              )
            )
        case Left(error) =>
          F.pure(Left(Option(error.getMessage).getOrElse(error.getClass.getSimpleName)))
      }

  /** Delivers a match to the player's live lobby socket, when one is open. */
  private def notify(playerId: String, matchFound: QuickPairMatch): F[Unit] =
    listeners.get.flatMap(_.get(playerId).traverse_(_.offer(matchFound)).void)

object QuickPairingService:

  /** Creates the single shared Quick Pairing queue of one room manager. */
  def create[F[_]: Async](roomManager: RoomManager[F]): F[QuickPairingService[F]] =
    for
      queues <- Ref.of[F, Map[QuickPairBucket, Vector[QueuedPlayer]]](Map.empty)
      listeners <- Ref.of[F, Map[String, Queue[F, QuickPairMatch]]](Map.empty)
      mutex <- Semaphore[F](1)
    yield new QuickPairingService[F](roomManager, queues, listeners, mutex)
