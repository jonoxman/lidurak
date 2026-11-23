package durak.session

import io.circe.{Decoder, Encoder}
import io.circe.generic.semiauto.{deriveDecoder, deriveEncoder}

/**
 * One anonymous guest identity.
 *
 * `token` is the secret credential. It lives only in the `HttpOnly` cookie (or
 * the `X-Guest-Token` header of a non-browser client) and is never serialized
 * into a JSON response, which is why there is deliberately no `Encoder` for this
 * type. `playerId` is the public identity a table seat and the UI may refer to.
 */
final case class GuestSession(
    token: String,
    playerId: String,
    displayName: String,
    createdAtEpochMs: Long,
    lastSeenAtEpochMs: Long
)

/**
 * The public projection of a session: everything a browser needs to render the
 * player's identity, and nothing that would let it impersonate the session.
 */
final case class SessionResponse(
    playerId: String,
    displayName: String,
    isGuest: Boolean = true
)

object SessionResponse:
  given Encoder[SessionResponse] = deriveEncoder[SessionResponse]
  given Decoder[SessionResponse] = deriveDecoder[SessionResponse]

/** Body of `POST /api/session/name`. */
final case class UpdateNameRequest(displayName: String)

object UpdateNameRequest:
  given Decoder[UpdateNameRequest] = deriveDecoder[UpdateNameRequest]
  given Encoder[UpdateNameRequest] = deriveEncoder[UpdateNameRequest]

/** Display-name rules shared by the store and the REST routes. */
object DisplayName:

  /** Shortest accepted name, measured in characters after trimming. */
  val MinLength: Int = 2

  /** Longest accepted name, measured in characters after trimming. */
  val MaxLength: Int = 20

  private val GuestNameAlphabet: String =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

  /**
   * Trims `raw` and accepts it when it is 2..20 printable characters with no
   * control characters; otherwise returns the reason it was rejected.
   */
  def validate(raw: String): Either[String, String] =
    val trimmed = Option(raw).map(_.trim).getOrElse("")
    if trimmed.isEmpty then Left("Display name must not be blank")
    else if trimmed.exists(Character.isISOControl) then
      Left("Display name must not contain control characters")
    else
      val length = trimmed.codePointCount(0, trimmed.length)
      if length < MinLength || length > MaxLength then
        Left(s"Display name must be between $MinLength and $MaxLength characters")
      else Right(trimmed)

  /** A fresh default name such as `Guest-7Q2M`. */
  def randomGuestName(): String =
    val suffix = (1 to 4)
      .map(_ => GuestNameAlphabet(SessionToken.random.nextInt(GuestNameAlphabet.length)))
      .mkString
    s"Guest-$suffix"
