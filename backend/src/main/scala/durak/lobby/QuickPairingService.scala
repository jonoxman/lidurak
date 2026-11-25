package durak.lobby

import cats.effect.{Async, Ref}
import cats.effect.std.Semaphore
import cats.syntax.all.*
import durak.engine.GameConfig
import durak.protocol.QuickPairResponse
import durak.rooms.{CreateRoomConfig, RoomManager}
import durak.session.GuestSession
import fs2.Stream
import fs2.concurrent.Topic
import io.circe.Decoder

import java.util.UUID

/**
 * Body of `POST /api/quick-pair`.
 *
 * A player asking for Quick Pairing only ever states the match preset they
 * want; the server decides which queued players they get matched with.
 *
 * `deckSize` asks for the 52-card deck in a 2- or 3-player match (four players
 * always play 52). `botOpponent` (`"randomBot"` or `"basicBot"`) starts a match
 * against bots immediately instead of queueing for human players.
 */
final case class QuickPairRequest(
    playerCount: Int,
    turnTimeoutSeconds: Int = QuickPairRequest.DefaultTurnTimeoutSeconds,
    allowRedirect: Boolean = true,
    deckSize: Option[Int] = None,
    botOpponent: Option[String] = None
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
      deckSize <- cursor.downField("deckSize").as[Option[Int]]
      botOpponent <- cursor
        .downField("botOpponent")
        .as[Option[String]]
        .map(_.map(_.trim).filter(_.nonEmpty))
    yield QuickPairRequest(
      playerCount,
      turnTimeoutSeconds,
      allowRedirect,
      deckSize,
      botOpponent
    )
  }

/**
 * The identity of one matching bucket: two players only share a bucket when
 * every preset field, the deck size included, agrees. A `2P 15s 36-card` seeker
 * can therefore never be paired into a `2P 15s 52-card` table.
 */
final case class QuickPairBucketKey(
    playerCount: Int,
    turnTimeoutSeconds: Int,
    allowRedirect: Boolean,
    deckSize: Int = GameConfig.ShortDeckSize
)

object QuickPairBucketKey:

  /** The preset the QA quick-pair-opponent trigger falls back to. */
  val Default: QuickPairBucketKey = QuickPairBucketKey(2, 15, true)

/** One player waiting in a bucket, with the identity a seat needs. */
final case class QueuedPlayer(playerId: String, displayName: String)

/** Where a queued player stands inside their bucket right now. */
final case class QuickPairWaiting(
    key: QuickPairBucketKey,
    queuedCount: Int,
    requiredCount: Int
)

/** One per-player match notification pushed down `/ws/lobby`. */
final case class QuickPairMatch(playerId: String, gameId: String, seatIndex: Int)

/** The answer to one `POST /api/quick-pair`. */
enum QuickPairResult:
  case Searching(waiting: QuickPairWaiting)
  case Matched(gameId: String, seatIndex: Int)

  /** The wire shape of this result. */
  def toResponse: QuickPairResponse = this match
    case Searching(waiting) =>
      QuickPairResponse.Searching(
        playerCount = waiting.key.playerCount,
        turnTimeoutSeconds = waiting.key.turnTimeoutSeconds,
        allowRedirect = waiting.key.allowRedirect,
        queuedCount = waiting.queuedCount,
        requiredCount = waiting.requiredCount
      )
    case Matched(gameId, seatIndex) =>
      QuickPairResponse.Matched(gameId, seatIndex)

/**
 * The Quick Pairing queue.
 *
 * Queued players are deliberately *not* in any room: a bucket only holds
 * guest identities until `playerCount` distinct players ask for the same
 * preset. The last player to join the bucket atomically drains it, creates a
 * private room that starts immediately, seats everyone in queue order and
 * publishes one match notification per player, so every waiting client learns
 * about the match over its own `/ws/lobby` socket.
 *
 * A player can only sit in one bucket at a time; asking again moves their
 * entry instead of duplicating it.
 */
final class QuickPairingService[F[_]](
    roomManager: RoomManager[F],
    pool: Ref[F, QuickPairingService.PoolState],
    matchTopic: Topic[F, QuickPairMatch],
    mutex: Semaphore[F]
)(using F: Async[F]):

  /**
   * Queues `session` for `request`.
   *
   * Returns [[QuickPairResult.Searching]] (with no room and no seat) while the
   * bucket is still waiting, and [[QuickPairResult.Matched]] for the player who
   * completes the bucket. Completing players are seated in arrival order, so
   * the bucket's first player always holds seat 0.
   */
  def enqueue(
      session: GuestSession,
      request: QuickPairRequest
  ): F[Either[String, QuickPairResult]] =
    keyFor(request) match
      case Left(error) => F.pure(Left(error))
      case Right((key, botType)) =>
        configFor(key).validate match
          case Left(error) => F.pure(Left(error))
          case Right(valid) =>
            mutex.permit.use(_ =>
              botType match
                // Bots are instantly available, so a bot request never queues.
                case Some(bot) => startBotMatch(session, key, bot)
                case None      => enqueueLocked(session, valid, key)
            )

  /** Removes `playerId` from whatever bucket they are in, if any. */
  def cancel(playerId: String): F[Unit] =
    mutex.permit.use(_ => pool.update(_.remove(playerId)).void)

  /** The bucket `playerId` is queued in right now, or `None`. */
  def statusFor(playerId: String): F[Option[QuickPairWaiting]] =
    pool.get.map(
      _.bucketFor(playerId).map { case (key, bucket) =>
        QuickPairWaiting(key, bucket.size, key.playerCount)
      }
    )

  /** Every match notification, for the lobby sockets to filter per viewer. */
  def matchNotifications: Stream[F, QuickPairMatch] =
    matchTopic.subscribe(QuickPairingService.MaxMatchSubscribers)

  /**
   * QA hook: fills the caller's active bucket with synthetic opponents so a
   * reviewer watching the persistent Searching state gets a real match in one
   * click. When the caller is not queued, they are queued into `defaultKey`
   * first, so this always produces a match for the caller.
   */
  def matchWithSyntheticOpponents(
      session: GuestSession,
      defaultKey: QuickPairBucketKey = QuickPairBucketKey.Default
  ): F[Either[String, (String, Int)]] =
    mutex.permit.use(_ =>
      pool.get.flatMap { current =>
        val key = current.bucketsByPlayer.getOrElse(session.playerId, defaultKey)
        val existing =
          current.buckets.getOrElse(key, Vector.empty).filterNot(_.playerId == session.playerId)
        val withCaller = existing :+ QueuedPlayer(session.playerId, session.displayName)
        val missing = Math.max(0, key.playerCount - withCaller.size)
        if missing <= 0 then
          F.pure(Left("This quick-pair bucket is already full"))
        else
          val opponents = Vector.tabulate(missing) { idx =>
            QueuedPlayer(
              playerId = s"qa-qp-opp-${UUID.randomUUID().toString.take(8)}",
              displayName = s"QA Quick Pair Opponent ${idx + 1}"
            )
          }
          startMatch(key, withCaller ++ opponents).flatMap { room =>
            val notifications = (withCaller ++ opponents).zipWithIndex.map {
              case (player, seatIndex) => QuickPairMatch(player.playerId, room.gameId, seatIndex)
            }
            pool.update(_.removeAll(notifications.map(_.playerId))) *>
              notifications.traverse_(event => matchTopic.publish1(event).void) *>
              F.pure(Right((room.gameId, withCaller.size - 1)))
          }
      }
    )

  // --- Internals -----------------------------------------------------------

  private def enqueueLocked(
      session: GuestSession,
      config: CreateRoomConfig,
      key: QuickPairBucketKey
  ): F[Either[String, QuickPairResult]] =
    pool
      .modify { current =>
        val cleaned = current.remove(session.playerId)
        (cleaned, cleaned)
      }
      .flatMap { current =>
        val bucket = current.buckets.getOrElse(key, Vector.empty)
        if bucket.size >= config.playerCount - 1 then
          val players = bucket :+ QueuedPlayer(session.playerId, session.displayName)
          startMatch(key, players).flatMap { room =>
            val notifications = players.zipWithIndex.map { case (player, seatIndex) =>
              QuickPairMatch(player.playerId, room.gameId, seatIndex)
            }
            pool.update(_.removeAll(players.map(_.playerId))) *>
              notifications.traverse_(event => matchTopic.publish1(event).void) *>
              F.pure(Right(QuickPairResult.Matched(room.gameId, notifications.last.seatIndex)))
          }
        else
          pool.update(
            _.enqueue(QueuedPlayer(session.playerId, session.displayName), key)
          ) *>
            F.pure(
              Right(
                QuickPairResult.Searching(
                  QuickPairWaiting(key, bucket.size + 1, config.playerCount)
                )
              )
            )
      }

  /**
   * Creates the match for a completed bucket through the same authoritative
   * room pipeline as any other room: the room is private, already fully
   * seated, and starts in `InProgress` in the same transition, so no client
   * can ever observe it waiting for players.
   */
  private def startMatch(
      key: QuickPairBucketKey,
      players: Vector[QueuedPlayer]
  ): F[durak.rooms.GameRoom] =
    roomManager.createPresetRoom(
      configFor(key),
      players.map(player => player.playerId -> player.displayName),
      autoStartIfFull = true
    )

  /** The private quick-pair room a full bucket is seated in. */
  private def configFor(key: QuickPairBucketKey): CreateRoomConfig =
    CreateRoomConfig(
      playerCount = key.playerCount,
      allowRedirect = key.allowRedirect,
      turnTimeoutSeconds = key.turnTimeoutSeconds,
      isPublic = false,
      isQuickPair = true,
      deckSize = Some(key.deckSize)
    )

  /**
   * Resolves the bucket a request belongs to, plus the bot to play against.
   *
   * The bucket key includes the effective deck size, so a `2P 15s 36-card`
   * seeker can never be matched with a `2P 15s 52-card` one. An unsupported
   * deck size, a four-player 36-card request, or an unknown bot name is
   * rejected here, before any queue or room is touched.
   */
  private def keyFor(
      request: QuickPairRequest
  ): Either[String, (QuickPairBucketKey, Option[String])] =
    val deckError: Option[String] =
      if request.deckSize.exists(size => !GameConfig.SupportedDeckSizes.contains(size)) then
        Some(
          s"Unsupported deck size: ${request.deckSize.getOrElse(0)} " +
            s"(expected ${GameConfig.ShortDeckSize} or ${GameConfig.FullDeckSize})"
        )
      else if request.playerCount == 4 && request.deckSize.contains(GameConfig.ShortDeckSize) then
        Some(s"A four-player game requires the ${GameConfig.FullDeckSize}-card deck")
      else None

    val bot: Either[String, Option[String]] = request.botOpponent match
      case None => Right(None)
      case Some(raw) =>
        GameConfig.parseSeatType(raw) match
          case Some(seatType) if GameConfig.isBotType(seatType) => Right(Some(seatType))
          case _ =>
            Left(s"Unsupported bot opponent: $raw (expected randomBot or basicBot)")

    for
      _ <- deckError.toLeft(())
      botType <- bot
    yield
      val deckSize =
        if request.playerCount == 4 then GameConfig.FullDeckSize
        else request.deckSize.getOrElse(GameConfig.ShortDeckSize)
      val key = QuickPairBucketKey(
        playerCount = request.playerCount,
        turnTimeoutSeconds = request.turnTimeoutSeconds,
        allowRedirect = request.allowRedirect,
        deckSize = deckSize
      )
      (key, botType)

  /**
   * Starts a match against bots in one step: the caller takes seat 0 and every
   * other seat is the requested bot. Nothing is ever enqueued, so bots can never
   * be matched into a normal human quick-pair bucket (or vice versa).
   */
  private def startBotMatch(
      session: GuestSession,
      key: QuickPairBucketKey,
      botType: String
  ): F[Either[String, QuickPairResult]] =
    val opponents = (1 until key.playerCount).toVector.map { seatIdx =>
      QueuedPlayer(
        playerId = s"bot-qp-${UUID.randomUUID().toString.take(8)}",
        displayName = botDisplayName(botType, seatIdx, key.playerCount)
      )
    }
    val seats = QueuedPlayer(session.playerId, session.displayName) +: opponents
    val seatTypes = GameConfig.HumanSeat +: Vector.fill(opponents.size)(botType)

    // A previous human wait entry must not survive into the bot match.
    pool.update(_.remove(session.playerId)) *>
      roomManager
        .createPresetRoom(
          configFor(key),
          seats.map(player => player.playerId -> player.displayName),
          autoStartIfFull = true,
          seatTypes = seatTypes
        )
        .map(room => Right(QuickPairResult.Matched(room.gameId, 0)))

  /** `"RandomBot"` / `"BasicBot"`, numbered when several share a table. */
  private def botDisplayName(botType: String, seatIdx: Int, playerCount: Int): String =
    val label = if botType == GameConfig.BasicBotSeat then "BasicBot" else "RandomBot"
    if playerCount <= 2 then label else s"$label $seatIdx"

object QuickPairingService:

  /** How far a lobby socket may lag behind the match stream. */
  private val MaxMatchSubscribers: Int = 64

  /** The waiting buckets plus the one-bucket-per-player index. */
  private[lobby] final case class PoolState(
      buckets: Map[QuickPairBucketKey, Vector[QueuedPlayer]] = Map.empty,
      bucketsByPlayer: Map[String, QuickPairBucketKey] = Map.empty
  ):

    /** The bucket this player is queued in, with its queued players. */
    def bucketFor(playerId: String): Option[(QuickPairBucketKey, Vector[QueuedPlayer])] =
      bucketsByPlayer
        .get(playerId)
        .flatMap(key => buckets.get(key).map(bucket => (key, bucket)))

    /** Removes one player, deleting a bucket that becomes empty. */
    def remove(playerId: String): PoolState =
      bucketsByPlayer.get(playerId) match
        case None => this
        case Some(key) =>
          val remaining =
            buckets.getOrElse(key, Vector.empty).filterNot(_.playerId == playerId)
          val withoutPlayer = copy(bucketsByPlayer = bucketsByPlayer - playerId)
          if remaining.isEmpty then withoutPlayer.copy(buckets = buckets - key)
          else withoutPlayer.copy(buckets = buckets.updated(key, remaining))

    /** Removes every player, e.g. the whole bucket a match just drained. */
    def removeAll(playerIds: Iterable[String]): PoolState =
      playerIds.foldLeft(this)((current, playerId) => current.remove(playerId))

    /** Adds a player to `key`, moving them out of any other bucket first. */
    def enqueue(player: QueuedPlayer, key: QuickPairBucketKey): PoolState =
      val cleaned = remove(player.playerId)
      cleaned.copy(
        buckets = cleaned.buckets.updated(
          key,
          cleaned.buckets.getOrElse(key, Vector.empty) :+ player
        ),
        bucketsByPlayer = cleaned.bucketsByPlayer.updated(player.playerId, key)
      )

  /** Creates the single shared Quick Pairing queue of one room manager. */
  def create[F[_]: Async](roomManager: RoomManager[F]): F[QuickPairingService[F]] =
    for
      pool <- Ref.of[F, PoolState](PoolState())
      matches <- Topic[F, QuickPairMatch]
      mutex <- Semaphore[F](1)
    yield new QuickPairingService[F](roomManager, pool, matches, mutex)
