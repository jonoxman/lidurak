package durak.lobby

import cats.effect.{Async, Ref}
import cats.effect.std.Semaphore
import cats.syntax.all.*
import durak.rooms.{CreateRoomConfig, RoomManager}
import durak.session.GuestSession
import fs2.Stream
import fs2.concurrent.Topic
import io.circe.Decoder

/**
 * Body of `POST /api/quick-pair`.
 *
 * A player asking for Quick Pairing only ever states the match preset they
 * want; the server decides which table they land in.
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

/** How one Quick Pairing request ended. */
enum QuickPairOutcome:

  /** The player is waiting for more opponents asking for the same preset. */
  case Queued(waiting: Int, required: Int)

  /** The preset filled up; every matched player is seated in `gameId`. */
  case Matched(gameId: String, seatIndex: Int)

/** One `MatchFound` announcement for the lobby socket of `playerId`. */
final case class QuickPairMatch(playerId: String, gameId: String)

/** The preset three queued players must share before anyone is seated. */
private final case class QuickPairPreset(
    playerCount: Int,
    turnTimeoutSeconds: Int,
    allowRedirect: Boolean
)

private object QuickPairPreset:

  /** Two requests only share a queue when all three preset fields agree. */
  def of(config: CreateRoomConfig): QuickPairPreset =
    QuickPairPreset(
      config.playerCount,
      config.turnTimeoutSeconds,
      config.allowRedirect
    )

/** One player waiting for the rest of their preset. */
private final case class QueuedPlayer(
    session: GuestSession,
    enqueuedAtEpochMs: Long
)

/** A player who was already seated, so a repeated request is idempotent. */
private final case class MatchedSeat(
    gameId: String,
    seatIndex: Int,
    matchedAtEpochMs: Long
)

/**
 * The whole pairing state: one queue per preset plus the recent matches.
 *
 * Queued players own no room, so cancelling, disconnecting or waiting simply
 * drops the entry and never leaves an empty room behind.
 */
private final case class QuickPairQueue(
    waiting: Map[QuickPairPreset, Vector[QueuedPlayer]],
    matched: Map[String, MatchedSeat]
)

/**
 * The Quick Pairing queue.
 *
 * A request never opens a room on its own: the caller waits in the preset's
 * queue until `playerCount` players ask for that same preset, and only then is
 * one [[durak.rooms.GameRoom]] created with every matched player already
 * seated (which starts the match in the same transition). Each matched player
 * is told the game id over their own `/ws/lobby` socket, so the browser can
 * stay on the lobby showing the searching state until a real table exists.
 *
 * Every queue decision goes through one mutex, so two simultaneous requests can
 * never both think the queue is full and create two rooms.
 */
final class QuickPairingService[F[_]](
    roomManager: RoomManager[F],
    mutex: Semaphore[F],
    queue: Ref[F, QuickPairQueue],
    matchTopic: Topic[F, QuickPairMatch]
)(using F: Async[F]):

  import QuickPairingService.*

  /**
   * Enqueues `session` for `request`'s preset.
   *
   * The request is answered with [[QuickPairOutcome.Queued]] while the queue is
   * still short, and with [[QuickPairOutcome.Matched]] on the request that
   * fills it. Repeating the request re-attaches the player to the same queue
   * slot (or the same match), so an impatient double click is harmless.
   */
  def pair(
      session: GuestSession,
      request: QuickPairRequest
  ): F[Either[String, QuickPairOutcome]] =
    configFor(request).validate match
      case Left(error)  => F.pure(Left(error))
      case Right(valid) => mutex.permit.use(_ => pairLocked(session, valid))

  /**
   * Removes `session` from every pairing queue.
   *
   * Cancelling only ever drops a queue entry: a player who was already matched
   * keeps their seat in the created room.
   */
  def cancel(session: GuestSession): F[Unit] =
    mutex.permit.use(_ => dequeue(session.playerId))

  /**
   * Drops a queued player whose lobby socket went away, so a closed tab can
   * never hold a slot another player needs. The browser re-enqueues on
   * reconnect, which is why this is safe to run on every socket teardown.
   */
  def disconnect(playerId: String): F[Unit] =
    mutex.permit.use(_ => dequeue(playerId))

  /** The `MatchFound` game ids published for one viewer's lobby socket. */
  def matches(viewerId: String): Stream[F, String] =
    matchTopic
      .subscribe(MaxMatchSubscribers)
      .collect { case QuickPairMatch(playerId, gameId) if playerId == viewerId =>
        gameId
      }

  private def pairLocked(
      session: GuestSession,
      config: CreateRoomConfig
  ): F[Either[String, QuickPairOutcome]] =
    nowMs.flatMap { now =>
      queue.get.flatMap { current =>
        val state = prune(current, now)
        state.matched.get(session.playerId) match
          case Some(hit) =>
            // Already matched (a repeated request, or a socket that connected
            // late): answer with the seat the player already holds.
            queue.set(state) *>
              F.pure(Right(QuickPairOutcome.Matched(hit.gameId, hit.seatIndex)))
          case None =>
            val preset = QuickPairPreset.of(config)
            val waiting = withoutPlayer(state.waiting, session.playerId)
            val group =
              waiting.getOrElse(preset, Vector.empty) :+ QueuedPlayer(session, now)

            if group.size < config.playerCount then
              queue.set(state.copy(waiting = waiting.updated(preset, group))) *>
                F.pure(Right(QuickPairOutcome.Queued(group.size, config.playerCount)))
            else
              val matched = group.take(config.playerCount)
              val leftover = group.drop(config.playerCount)
              val remaining =
                if leftover.isEmpty then waiting.removed(preset)
                else waiting.updated(preset, leftover)

              roomManager
                .createPresetRoom(
                  config = config,
                  prefilledSeats = matched.map(player =>
                    (player.session.playerId, player.session.displayName)
                  ),
                  autoStartIfFull = true
                )
                .flatMap { room =>
                  val seats = matched.zipWithIndex.map { case (player, index) =>
                    player.session.playerId -> MatchedSeat(room.gameId, index, now)
                  }
                  val next = QuickPairQueue(remaining, state.matched ++ seats)
                  queue.set(next) *>
                    matched.traverse_(player =>
                      matchTopic
                        .publish1(QuickPairMatch(player.session.playerId, room.gameId))
                        .void
                    ) *>
                    // The caller was appended last, so it holds the last seat.
                    F.pure(Right(QuickPairOutcome.Matched(room.gameId, seats.size - 1)))
                }
      }
    }

  /** Drops `playerId` from every preset queue. */
  private def dequeue(playerId: String): F[Unit] =
    queue.update(current =>
      current.copy(waiting = withoutPlayer(current.waiting, playerId))
    )

  /** The queue map without `playerId`, and without emptied presets. */
  private def withoutPlayer(
      waiting: Map[QuickPairPreset, Vector[QueuedPlayer]],
      playerId: String
  ): Map[QuickPairPreset, Vector[QueuedPlayer]] =
    waiting.view
      .mapValues(_.filterNot(_.session.playerId == playerId))
      .filter(_._2.nonEmpty)
      .toMap

  /** Forgets matches old enough that no browser can still be re-checking one. */
  private def prune(state: QuickPairQueue, now: Long): QuickPairQueue =
    state.copy(matched =
      state.matched.filter { case (_, seat) =>
        now - seat.matchedAtEpochMs <= MatchedRetentionMs
      }
    )

  private def nowMs: F[Long] = F.delay(System.currentTimeMillis())

  /** The public quick-pair room configuration this request asks for. */
  private def configFor(request: QuickPairRequest): CreateRoomConfig =
    CreateRoomConfig(
      playerCount = request.playerCount,
      allowRedirect = request.allowRedirect,
      turnTimeoutSeconds = request.turnTimeoutSeconds,
      isPublic = true,
      isQuickPair = true
    )

object QuickPairingService:

  /** How long a matched player keeps answering with their seat id. */
  val MatchedRetentionMs: Long = 10L * 60L * 1000L

  /** How many lobby sockets may listen for match announcements at once. */
  private val MaxMatchSubscribers: Int = 64

  /** Creates the single shared pairing queue of one room manager. */
  def create[F[_]: Async](roomManager: RoomManager[F]): F[QuickPairingService[F]] =
    for
      mutex <- Semaphore[F](1)
      queue <- Ref.of[F, QuickPairQueue](QuickPairQueue(Map.empty, Map.empty))
      topic <- Topic[F, QuickPairMatch]
    yield new QuickPairingService[F](roomManager, mutex, queue, topic)
