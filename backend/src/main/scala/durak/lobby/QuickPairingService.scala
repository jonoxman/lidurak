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
 * want; the server decides when a full table of that preset exists.
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

/** One player held in the Quick Pairing queue, with the name to seat them. */
final case class QueuedPlayer(playerId: String, displayName: String)

/**
 * The preset a queue is keyed by.
 *
 * Two requests only share a queue when all three fields agree, exactly as two
 * quick-pair rooms only ever shared a preset before.
 */
final case class QuickPairPreset(
    playerCount: Int,
    turnTimeoutSeconds: Int,
    allowRedirect: Boolean
)

object QuickPairPreset:

  /** The queue key of a validated room configuration. */
  def from(config: CreateRoomConfig): QuickPairPreset =
    QuickPairPreset(
      playerCount = config.playerCount,
      turnTimeoutSeconds = config.turnTimeoutSeconds,
      allowRedirect = config.allowRedirect
    )

/** A Quick Pairing match that just formed, and the players it seats. */
final case class QuickPairMatch(gameId: String, playerIds: List[String])

/** The answer to one `POST /api/quick-pair`. */
enum QuickPairOutcome:

  /** A full table of queued players was just dealt; the caller has a seat. */
  case Matched(gameId: String, seatIndex: Int)

  /** The caller is queued and nothing has been created or seated yet. */
  case Searching(playerCount: Int, turnTimeoutSeconds: Int, playersWaiting: Int)

/**
 * The Quick Pairing queue.
 *
 * A request never seats anybody: it appends the player to the queue of their
 * preset. The queue is dealt as one full table the moment `playerCount`
 * players are waiting for the same preset, so no half-filled quick-pair room
 * is ever created in [[RoomManager]] or listed in the open Lobby Pool. A
 * queued player therefore stays on the lobby until a match really exists.
 *
 * Every pairing decision goes through one mutex, so two simultaneous requests
 * can never both decide they completed the same table.
 *
 * The queue itself is the only storage: a player is removed from it in the
 * same transition that deals their table, and [[cancel]] simply drops them.
 */
final class QuickPairingService[F[_]](
    roomManager: RoomManager[F],
    queues: Ref[F, Map[QuickPairPreset, Vector[QueuedPlayer]]],
    matches: Topic[F, QuickPairMatch],
    mutex: Semaphore[F]
)(using F: Async[F]):

  /**
   * Queues `session` for its preset and deals a table when that queue is full.
   *
   * A player who is already waiting keeps their place in line, so a repeated
   * click never creates a second entry (and never a second room).
   */
  def pair(
      session: GuestSession,
      request: QuickPairRequest
  ): F[Either[String, QuickPairOutcome]] =
    configFor(request).validate match
      case Left(error)  => F.pure(Left(error))
      case Right(valid) => mutex.permit.use(_ => pairLocked(session, valid))

  /** Removes `session` from every Quick Pairing queue it occupies. */
  def cancel(session: GuestSession): F[Unit] =
    mutex.permit.use(_ => dequeue(Vector(session.playerId)))

  /**
   * The tables `viewerId` was dealt into after being queued.
   *
   * `POST /api/quick-pair` answers the caller that completed a table, so every
   * other queued player needs this stream: it is merged into `/ws/lobby`,
   * which the lobby keeps open whether or not the player is on the Quick
   * Pairing tab.
   */
  def matchFound(viewerId: String): Stream[F, String] =
    matches
      .subscribe(QuickPairingService.MaxMatchSubscribers)
      .collect { case found if found.playerIds.contains(viewerId) => found.gameId }

  private def pairLocked(
      session: GuestSession,
      config: CreateRoomConfig
  ): F[Either[String, QuickPairOutcome]] =
    val preset = QuickPairPreset.from(config)
    val me = QueuedPlayer(session.playerId, session.displayName)
    for
      group <- queues.modify { all =>
        // A player is only ever queued once, and for one preset at a time.
        val otherQueues = all.view
          .mapValues(queue => queue.filterNot(_.playerId == me.playerId))
          .toMap
        all.getOrElse(preset, Vector.empty) match
          case mine if mine.exists(_.playerId == me.playerId) =>
            // Already waiting: keep their place in line.
            (otherQueues.updated(preset, mine), mine)
          case mine =>
            val appended = mine :+ me
            (otherQueues.updated(preset, appended), appended)
      }
      outcome <-
        if group.size < config.playerCount then
          F.pure(
            Right(
              QuickPairOutcome.Searching(
                playerCount = config.playerCount,
                turnTimeoutSeconds = config.turnTimeoutSeconds,
                playersWaiting = group.size
              )
            )
          )
        else deal(preset, group, session, config)
    yield outcome

  /**
   * Deals the queued table that now includes `caller`, seats everyone in queue
   * order and announces the new room.
   *
   * A deal that fails puts the players back in line instead of dropping them.
   */
  private def deal(
      preset: QuickPairPreset,
      group: Vector[QueuedPlayer],
      caller: GuestSession,
      config: CreateRoomConfig
  ): F[Either[String, QuickPairOutcome]] =
    val seatOrder =
      val others = group.filterNot(_.playerId == caller.playerId)
      val callers = group.filter(_.playerId == caller.playerId)
      (others.take(config.playerCount - callers.size) ++ callers)
        .take(config.playerCount)
    val playerIds = seatOrder.map(_.playerId)
    for
      _ <- dequeue(playerIds)
      outcome <- roomManager
        .createPresetRoom(
          config,
          seatOrder.map(player => (player.playerId, player.displayName)),
          autoStartIfFull = true
        )
        .attempt
        .flatMap {
          case Right(room) =>
            // Everyone who was queued learns about the table on `/ws/lobby`;
            // the caller also gets it in the response of their own request.
            matches
              .publish1(QuickPairMatch(room.gameId, playerIds.toList))
              .void
              .as(
                Right(
                  QuickPairOutcome.Matched(
                    gameId = room.gameId,
                    seatIndex = playerIds.indexOf(caller.playerId).max(0)
                  )
                )
              )
          case Left(error) =>
            requeue(preset, seatOrder) *> F.pure(Left(describe(error)))
        }
    yield outcome

  /** Drops `playerIds` from every queue, forgetting queues that went empty. */
  private def dequeue(playerIds: Vector[String]): F[Unit] =
    queues.update(all =>
      all.view
        .mapValues(queue =>
          queue.filterNot(player => playerIds.contains(player.playerId))
        )
        .filter { case (_, queue) => queue.nonEmpty }
        .toMap
    )

  /** Puts a failed deal's players back at the head of their queue. */
  private def requeue(
      preset: QuickPairPreset,
      players: Vector[QueuedPlayer]
  ): F[Unit] =
    queues.update(all =>
      all.updated(preset, players ++ all.getOrElse(preset, Vector.empty))
    )

  /** The public quick-pair configuration a request would be queued with. */
  private def configFor(request: QuickPairRequest): CreateRoomConfig =
    CreateRoomConfig(
      playerCount = request.playerCount,
      allowRedirect = request.allowRedirect,
      turnTimeoutSeconds = request.turnTimeoutSeconds,
      isPublic = true,
      isQuickPair = true
    )

  private def describe(error: Throwable): String =
    Option(error.getMessage).getOrElse(error.getClass.getSimpleName)

object QuickPairingService:

  /** How many lobby sockets may lag behind a `MatchFound` broadcast. */
  val MaxMatchSubscribers: Int = 64

  /** Creates the single shared Quick Pairing queue of one room manager. */
  def create[F[_]: Async](roomManager: RoomManager[F]): F[QuickPairingService[F]] =
    for
      mutex <- Semaphore[F](1)
      queues <- Ref.of[F, Map[QuickPairPreset, Vector[QueuedPlayer]]](Map.empty)
      matches <- Topic[F, QuickPairMatch]
    yield new QuickPairingService[F](roomManager, queues, matches, mutex)
