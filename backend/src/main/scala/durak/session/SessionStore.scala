package durak.session

import cats.effect.{Ref, Sync}
import cats.syntax.all.*

import java.security.SecureRandom
import java.util.Base64

/**
 * The session algebra.
 *
 * The in-memory implementation below is deliberately the only one for now: the
 * engine and routes depend on this trait, so the MongoDB-backed store of M4 can
 * replace it without touching any caller.
 */
trait SessionStore[F[_]]:

  /** Mints a brand-new guest session with a fresh 256-bit token. */
  def createGuest(displayName: Option[String] = None): F[GuestSession]

  /** The session behind `token`, if any. Does not advance `lastSeenAtEpochMs`. */
  def findByToken(token: String): F[Option[GuestSession]]

  /** The session behind `token`, advancing `lastSeenAtEpochMs` when found. */
  def touchAndFind(token: String): F[Option[GuestSession]]

  /**
   * Validates `newName`, stores it as the session's display name and advances
   * `lastSeenAtEpochMs`. An invalid name or an unknown token is a `Left(error)`.
   */
  def updateDisplayName(token: String, newName: String): F[Either[String, GuestSession]]

object SessionStore:

  /** The error a rename of an unknown token answers with. */
  def unknownSessionError(token: String): String =
    s"Unknown session: $token"

  /** A thread-safe in-memory store backed by a `Ref` of token -> session. */
  def inMemory[F[_]: Sync]: F[SessionStore[F]] =
    Ref.of[F, Map[String, GuestSession]](Map.empty).map(new InMemorySessionStore[F](_))

/**
 * The `Ref`-backed [[SessionStore]]. Every read-modify-write goes through
 * `Ref.modify`, so concurrent requests cannot lose a session or a rename.
 */
final class InMemorySessionStore[F[_]: Sync](
    sessions: Ref[F, Map[String, GuestSession]]
) extends SessionStore[F]:

  def createGuest(displayName: Option[String] = None): F[GuestSession] =
    for
      now <- SessionToken.nowMs[F]
      session = GuestSession(
        token = SessionToken.generateToken(),
        playerId = SessionToken.generatePlayerId(),
        displayName = displayName
          .flatMap(name => DisplayName.validate(name).toOption)
          .getOrElse(DisplayName.randomGuestName()),
        createdAtEpochMs = now,
        lastSeenAtEpochMs = now
      )
      _ <- sessions.update(_.updated(session.token, session))
    yield session

  def findByToken(token: String): F[Option[GuestSession]] =
    sessions.get.map(_.get(token))

  def touchAndFind(token: String): F[Option[GuestSession]] =
    for
      now <- SessionToken.nowMs[F]
      touched <- sessions.modify { current =>
        current.get(token) match
          case None => (current, None)
          case Some(session) =>
            val seen = session.copy(lastSeenAtEpochMs = now)
            (current.updated(token, seen), Some(seen))
      }
    yield touched

  def updateDisplayName(token: String, newName: String): F[Either[String, GuestSession]] =
    DisplayName.validate(newName) match
      case Left(error) => Sync[F].pure(Left(error))
      case Right(valid) =>
        for
          now <- SessionToken.nowMs[F]
          updated <- sessions.modify { current =>
            current.get(token) match
              case None => (current, Left(SessionStore.unknownSessionError(token)))
              case Some(session) =>
                val renamed =
                  session.copy(displayName = valid, lastSeenAtEpochMs = now)
                (current.updated(token, renamed), Right(renamed))
          }
        yield updated

/** Token, player-id and clock helpers shared by the store and its tests. */
object SessionToken:

  /** 32 random bytes = the 256 bits of entropy every session token carries. */
  val ByteLength: Int = 32

  /** Prefix of the public guest id, which is never the secret token. */
  val PlayerIdPrefix: String = "guest-"

  /** How many random characters follow [[PlayerIdPrefix]]. */
  val PlayerIdLength: Int = 8

  private val PlayerIdAlphabet: String =
    "abcdefghijklmnopqrstuvwxyz0123456789"

  private[session] val random: SecureRandom = new SecureRandom()

  /**
   * A fresh 256-bit token: 32 `SecureRandom` bytes, Base64URL-encoded without
   * padding, so it is safe in a cookie value and in a request header.
   */
  def generateToken(): String =
    val bytes = new Array[Byte](ByteLength)
    random.nextBytes(bytes)
    Base64.getUrlEncoder.withoutPadding().encodeToString(bytes)

  /** A public player id such as `guest-4f9c1ab2`, distinct from any token. */
  def generatePlayerId(): String =
    val suffix = (1 to PlayerIdLength)
      .map(_ => PlayerIdAlphabet(random.nextInt(PlayerIdAlphabet.length)))
      .mkString
    s"$PlayerIdPrefix$suffix"

  /** Wall-clock milliseconds, used for `createdAt` / `lastSeenAt`. */
  def nowMs[F[_]: Sync]: F[Long] =
    Sync[F].delay(System.currentTimeMillis())
