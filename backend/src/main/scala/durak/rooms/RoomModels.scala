package durak.rooms

import cats.effect.Deferred
import cats.effect.std.Queue
import durak.engine.GameState
import durak.protocol.{
  LobbyRoomSummary,
  RoomConfigView,
  RoomSeatView,
  RoomStatus,
  WsServerMessage
}

/**
 * The authoritative settings of a shareable room.
 *
 * `playerCount` decides the deck (36 cards for 2–3 players, 52 for 4) and the
 * number of seats; `turnTimeoutSeconds` is the per-turn clock that the
 * [[RoomManager]] enforces. Both are validated before a room is ever created,
 * so no caller can put the room pool into a state the lobby cannot describe.
 */
final case class CreateRoomConfig(
    playerCount: Int,
    allowRedirect: Boolean = true,
    turnTimeoutSeconds: Int = 15,
    isPublic: Boolean = true,
    isQuickPair: Boolean = false
):

  /** The reason this configuration cannot back a room, if any. */
  def validationError: Option[String] =
    if !CreateRoomConfig.SupportedPlayerCounts.contains(playerCount) then
      Some(
        s"Unsupported player count: $playerCount (expected 2, 3, or 4)"
      )
    else if turnTimeoutSeconds < CreateRoomConfig.MinTurnTimeoutSeconds ||
      turnTimeoutSeconds > CreateRoomConfig.MaxTurnTimeoutSeconds
    then
      Some(
        s"Turn timeout must be between ${CreateRoomConfig.MinTurnTimeoutSeconds} " +
          s"and ${CreateRoomConfig.MaxTurnTimeoutSeconds} seconds"
      )
    else None

  /** `Right(this)` when the configuration is valid, otherwise the reason. */
  def validate: Either[String, CreateRoomConfig] =
    validationError.toLeft(this)

  /** The public projection every client is allowed to see. */
  def toView: RoomConfigView =
    RoomConfigView(
      playerCount = playerCount,
      allowRedirect = allowRedirect,
      turnTimeoutSeconds = turnTimeoutSeconds,
      isPublic = isPublic
    )

object CreateRoomConfig:

  /** Lowest seat count a Durak room supports. */
  val MinPlayerCount: Int = 2

  /** Highest seat count a Durak room supports. */
  val MaxPlayerCount: Int = 4

  /** Every seat count the engine and the 36/52-card decks support. */
  val SupportedPlayerCounts: Set[Int] = Set(2, 3, 4)

  /** Shortest accepted turn clock. */
  val MinTurnTimeoutSeconds: Int = 5

  /** Longest accepted turn clock. */
  val MaxTurnTimeoutSeconds: Int = 300

  /** Builds and validates a configuration in one step. */
  def valid(
      playerCount: Int,
      allowRedirect: Boolean = true,
      turnTimeoutSeconds: Int = 15,
      isPublic: Boolean = true,
      isQuickPair: Boolean = false
  ): Either[String, CreateRoomConfig] =
    CreateRoomConfig(
      playerCount = playerCount,
      allowRedirect = allowRedirect,
      turnTimeoutSeconds = turnTimeoutSeconds,
      isPublic = isPublic,
      isQuickPair = isQuickPair
    ).validate

/**
 * One seat of a room. An empty slot has no `playerId` and no `displayName`;
 * the seat index is always present so the table can place the seat even while
 * it waits for a player.
 */
final case class SeatSlot(
    seatIndex: Int,
    playerId: Option[String] = None,
    displayName: Option[String] = None
):

  /** True once a player has claimed this seat. */
  def isOccupied: Boolean = playerId.nonEmpty

/**
 * The authoritative state of one room, exactly as the server holds it.
 *
 * `gameState` stays `None` until every seat is filled; from then on it is the
 * single source of truth for the match. `turnDeadlineEpochMs` is the deadline
 * of the current turn, and is cleared once the match is over.
 */
final case class GameRoom(
    gameId: String,
    config: CreateRoomConfig,
    status: RoomStatus,
    seats: Vector[SeatSlot],
    gameState: Option[GameState],
    turnDeadlineEpochMs: Option[Long],
    createdAtEpochMs: Long,
    hostName: String
):

  /** How many seats are claimed right now. */
  def filledSeats: Int = seats.count(_.isOccupied)

  /** The seat index `playerId` occupies in this room, if any. */
  def seatIndexOf(playerId: String): Option[Int] =
    seats.find(seat => seat.playerId.contains(playerId)).map(_.seatIndex)

  /** The id of the player in `seatIdx`, if the seat is claimed. */
  def playerIdAt(seatIdx: Int): Option[String] =
    seats.lift(seatIdx).flatMap(_.playerId)

  /** The public projection of this room's settings. */
  def configView: RoomConfigView = config.toView

  /** The lobby projection of every seat, presence flags included by the view. */
  def seatViews: Vector[RoomSeatView] =
    seats.map(seat => RoomSeatView(seat.seatIndex, seat.playerId, seat.displayName))

  /** The summary broadcast to the open lobby pool. */
  def lobbySummary: LobbyRoomSummary =
    LobbyRoomSummary(
      gameId = gameId,
      hostName = hostName,
      playerCount = config.playerCount,
      filledSeats = filledSeats,
      allowRedirect = config.allowRedirect,
      turnTimeoutSeconds = config.turnTimeoutSeconds,
      createdAtEpochMs = createdAtEpochMs,
      isQuickPair = config.isQuickPair
    )

/**
 * One live WebSocket client of a room.
 *
 * Several clients may share a `playerId` (multiple tabs of the same player);
 * presence stays `isConnected = true` until the last of them disconnects. The
 * queue carries only already-projected [[WsServerMessage]] frames, so a hidden
 * hand has no way to travel through it.
 */
final case class ConnectedClient[F[_]](
    clientId: String,
    playerId: String,
    queue: Queue[F, WsServerMessage],
    stop: Deferred[F, Either[Throwable, Unit]]
)

/** A rejected game action, answered strictly to the client that sent it. */
final case class ActionRejected(code: String, message: String)

object ActionRejected:

  /** The sender is not seated in this room, or the match is not running. */
  val UnauthorizedCode: String = "UNAUTHORIZED"

  /** The engine refused the move; the game state was not mutated. */
  val IllegalMoveCode: String = "ILLEGAL_MOVE"

  /** The frame is not a game action at all. */
  val InvalidActionCode: String = "INVALID_ACTION"

  /** The room does not exist (or no longer exists). */
  val RoomNotFoundCode: String = "ROOM_NOT_FOUND"

  /** A move from an unseated spectator or a not-yet-started room. */
  def unauthorized(message: String): ActionRejected =
    ActionRejected(UnauthorizedCode, message)

  /** An engine-level rejection of a legal-shaped move. */
  def illegalMove(message: String): ActionRejected =
    ActionRejected(IllegalMoveCode, message)

/** The error raised by `RoomManager.subscribe` for an unknown room id. */
final class UnknownRoom(val gameId: String)
    extends IllegalArgumentException(s"Unknown room: $gameId")
