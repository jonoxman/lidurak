package durak.lobby

import cats.effect.{Async, Ref, Resource}
import cats.effect.std.{Queue, Semaphore}
import cats.syntax.all.*
import durak.protocol.WsServerMessage
import durak.rooms.{CreateRoomConfig, RoomManager}
import durak.session.GuestSession
import fs2.Stream
import io.circe.Decoder

/**
 * Body of `POST /api/quick-pair`.
 *
 * A player asking for Quick Pairing only ever states the match preset they
 * want; the server decides which players they are matched with.
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

/** The three preset fields that make two queue entries compatible. */
private[lobby] final case class QuickPairBucket(
    playerCount: Int,
    turnTimeoutSeconds: Int,
    allowRedirect: Boolean
)

/** One player waiting in the Quick Pairing queue (never seated in a room yet). */
private[lobby] final case class QueuedPlayer(playerId: String, displayName: String)

/** The two outcomes of a `POST /api/quick-pair` request. */
enum QuickPairOutcome:
  /** The player is queued and must stay on the lobby until a match forms. */
  case Searching(playerCount: Int, turnTimeoutSeconds: Int, allowRedirect: Boolean)

  /** A full match was formed; the player now owns `seatIndex` of `gameId`. */
  case Matched(gameId: String, seatIndex: Int)

/**
 * The Quick Pairing queue.
 *
 * Players are matched **before** any room exists: a request only ever joins an
 * in-memory bucket keyed by its preset. The `playerCount`-th distinct player in
 * a bucket atomically drains the bucket and creates the already-dealt
 * [[durak.rooms.GameRoom]], so a quick-pairing player is never dropped into an
 * open `WaitingForPlayers` room (and never appears in the Lobby Pool) while
 * they are still searching.
 *
 * Every decision goes through one mutex, so two simultaneous joiners can never
 * both form a match, and a player is deduplicated across *all* buckets, which
 * makes it impossible to match against themselves.
 *
 * Each matched player also receives a targeted `quickPairMatched` frame over
 * `/ws/lobby`, so the players who were already waiting are pulled into the
 * table immediately without polling.
 */
final class QuickPairingService[F[_]](
    roomManager: RoomManager[F],
    mutex: Semaphore[F],
    buckets: Ref[F, Map[QuickPairBucket, Vector[QueuedPlayer]]],
    subscribers: Ref[F, Map[String, List[Queue[F, WsServerMessage]]]],
    pendingMatches: Ref[F, Map[String, (String, Int)]]
)(using F: Async[F]):

  /**
   * Queues `session` for the requested preset, forming a match when it is the
   * last missing player.
   *
   * A player who is already queued (in this bucket or another one) is moved to
   * this bucket's tail first, so repeated clicks are harmless and can never
   * pair a player with themselves.
   */
  def pair(
      session: GuestSession,
      request: QuickPairRequest
  ): F[Either[String, QuickPairOutcome]] =
    configFor(request).validate match
      case Left(error)  => F.pure(Left(error))
      case Right(valid) => mutex.permit.use(_ => pairLocked(session, valid))

  /** Removes `session` from every queue bucket, leaving no phantom entries. */
  def cancel(session: GuestSession): F[Unit] =
    mutex.permit.use(_ => removeFromBuckets(session.playerId))

  /**
   * The caller's current pairing state, for clients whose `/ws/lobby` socket
   * opened before their guest session existed (or while it is reconnecting).
   *
   * `None` means idle; a queued player reports `Searching`; a player who was
   * already matched reports the room they own. The pending match is cleared as
   * soon as that player re-queues or cancels.
   */
  def status(playerId: String): F[Option[QuickPairOutcome]] =
    mutex.permit.use(_ =>
      (pendingMatches.get, buckets.get).mapN { (pending, all) =>
        pending.get(playerId) match
          case Some((gameId, seatIndex)) =>
            Some(QuickPairOutcome.Matched(gameId, seatIndex))
          case None =>
            all.collectFirst {
              case (key, queued) if queued.exists(_.playerId == playerId) =>
                QuickPairOutcome.Searching(
                  key.playerCount,
                  key.turnTimeoutSeconds,
                  key.allowRedirect
                )
            }
      }
    )

  /** The `quickPairMatched` frames addressed to exactly one queued player. */
  def matchedEvents(playerId: String): Stream[F, WsServerMessage] =
    Stream
      .resource(
        Resource.make(
          Queue
            .unbounded[F, WsServerMessage]
            .flatTap(queue =>
              subscribers.update(current =>
                current.updated(playerId, queue :: current.getOrElse(playerId, Nil))
              )
            )
        )(queue =>
          subscribers.update(current =>
            current.get(playerId) match
              case None => current
              case Some(queues) =>
                val remaining = queues.filterNot(_ eq queue)
                if remaining.isEmpty then current - playerId
                else current.updated(playerId, remaining)
          )
        )
      )
      .flatMap(queue => Stream.fromQueueUnterminated(queue))

  private def pairLocked(
      session: GuestSession,
      config: CreateRoomConfig
  ): F[Either[String, QuickPairOutcome]] =
    val key = QuickPairBucket(
      playerCount = config.playerCount,
      turnTimeoutSeconds = config.turnTimeoutSeconds,
      allowRedirect = config.allowRedirect
    )
    val queued = QueuedPlayer(session.playerId, session.displayName)

    for
      _ <- removeFromBuckets(session.playerId)
      current <- buckets.get.map(_.getOrElse(key, Vector.empty))
      next = current :+ queued
      outcome <-
        if next.size < config.playerCount then
          buckets
            .update(_.updated(key, next))
            .as(
              QuickPairOutcome.Searching(
                playerCount = config.playerCount,
                turnTimeoutSeconds = config.turnTimeoutSeconds,
                allowRedirect = config.allowRedirect
              )
            )
        else
          val matched = next.take(config.playerCount)
          val leftover = next.drop(config.playerCount)
          for
            _ <- buckets.update { all =>
              if leftover.isEmpty then all - key else all.updated(key, leftover)
            }
            room <- roomManager.createPresetRoom(
              config,
              matched.map(player => player.playerId -> player.displayName),
              autoStartIfFull = true
            )
            _ <- recordMatches(room.gameId, matched)
            _ <- notifyMatched(room.gameId, matched)
          yield
            val seatIndex = matched.indexWhere(_.playerId == session.playerId)
            QuickPairOutcome.Matched(room.gameId, if seatIndex >= 0 then seatIndex else 0)
    yield Right(outcome)

  /**
   * Drops `playerId` from every bucket, discarding buckets that empty out, and
   * forgets any match it was already handed.
   */
  private def removeFromBuckets(playerId: String): F[Unit] =
    buckets.update { all =>
      all.flatMap { case (key, queued) =>
        val remaining = queued.filterNot(_.playerId == playerId)
        if remaining.isEmpty then None else Some(key -> remaining)
      }
    } *> pendingMatches.update(_ - playerId)

  /** Remembers the match each player was given, so a status check can recover it. */
  private def recordMatches(gameId: String, matched: Vector[QueuedPlayer]): F[Unit] =
    pendingMatches.update { current =>
      matched.zipWithIndex.foldLeft(current) { case (acc, (player, seatIndex)) =>
        acc.updated(player.playerId, (gameId, seatIndex))
      }
    }

  /** Tells every matched player the same room and their own seat in it. */
  private def notifyMatched(
      gameId: String,
      matched: Vector[QueuedPlayer]
  ): F[Unit] =
    matched.zipWithIndex.traverse_ { case (player, seatIndex) =>
      subscribers.get.flatMap { all =>
        all
          .getOrElse(player.playerId, Nil)
          .traverse_(_.offer(WsServerMessage.QuickPairMatched(gameId, seatIndex)))
      }
    }

  /** The public quick-pair room a full bucket creates. */
  private def configFor(request: QuickPairRequest): CreateRoomConfig =
    CreateRoomConfig(
      playerCount = request.playerCount,
      allowRedirect = request.allowRedirect,
      turnTimeoutSeconds = request.turnTimeoutSeconds,
      isPublic = true,
      isQuickPair = true
    )

object QuickPairingService:

  /** Creates the single shared Quick Pairing queue of one room manager. */
  def create[F[_]: Async](roomManager: RoomManager[F]): F[QuickPairingService[F]] =
    (
      Semaphore[F](1),
      Ref.of[F, Map[QuickPairBucket, Vector[QueuedPlayer]]](Map.empty),
      Ref.of[F, Map[String, List[Queue[F, WsServerMessage]]]](Map.empty),
      Ref.of[F, Map[String, (String, Int)]](Map.empty)
    ).mapN { (mutex, buckets, subscribers, pendingMatches) =>
      new QuickPairingService[F](roomManager, mutex, buckets, subscribers, pendingMatches)
    }
