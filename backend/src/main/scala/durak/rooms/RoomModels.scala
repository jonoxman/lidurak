package durak.rooms

import cats.effect.Deferred
import cats.effect.std.Queue
import durak.engine.{GameConfig, GameState}
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
 * `playerCount` decides the number of seats and the default deck (36 cards for
 * 2–3 players, 52 for 4); `deckSize` may explicitly ask for the full 52-card
 * deck in a 2- or 3-player game, while a 4-player game always plays 52 and
 * rejects an explicit 36. `turnTimeoutSeconds` is the per-turn clock that the
 * [[RoomManager]] enforces. Everything is validated before a room is ever
 * created, so no caller can put the room pool into a state the lobby cannot
 * describe.
 */
final case class CreateRoomConfig(
    playerCount: Int,
    allowRedirect: Boolean = true,
    turnTimeoutSeconds: Int = 15,
    isPublic: Boolean = true,
    isQuickPair: Boolean = false,
    deckSize: Option[Int] = None
):

  /**
   * The deck this room is actually dealt from: 52 cards for four players,
   * otherwise the explicit setting or the 36-card default.
   */
  def effectiveDeckSize: Int =
    if playerCount == 4 then GameConfig.FullDeckSize
    else deckSize.getOrElse(GameConfig.ShortDeckSize)

  /** The reason this configuration cannot back a room, if any. */
  def validationError: Option[String] =
    if !CreateRoomConfig.SupportedPlayerCounts.contains(playerCount) then
      Some(
        s"Unsupported player count: $playerCount (expected 2, 3, or 4)"
      )
    else if deckSize.exists(size => !GameConfig.SupportedDeckSizes.contains(size)) then
      Some(
        s"Unsupported deck size: ${deckSize.getOrElse(0)} " +
          s"(expected ${GameConfig.ShortDeckSize} or ${GameConfig.FullDeckSize})"
      )
    else if playerCount == 4 && deckSize.contains(GameConfig.ShortDeckSize) then
      Some(
        s"A four-player game requires the ${GameConfig.FullDeckSize}-card deck"
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
      isPublic = isPublic,
      deckSize = effectiveDeckSize
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
      isQuickPair: Boolean = false,
      deckSize: Option[Int] = None
  ): Either[String, CreateRoomConfig] =
    CreateRoomConfig(
      playerCount = playerCount,
      allowRedirect = allowRedirect,
      turnTimeoutSeconds = turnTimeoutSeconds,
      isPublic = isPublic,
      isQuickPair = isQuickPair,
      deckSize = deckSize
    ).validate

/**
 * One seat of a room. An empty slot has no `playerId` and no `displayName`;
 * the seat index is always present so the table can place the seat even while
 * it waits for a player.
 *
 * `seatType` is who plays that seat (`"human"`, `"randomBot"` or
 * `"basicBot"`). A bot seat is occupied from the moment the room exists, so it
 * never waits for a human to join.
 */
final case class SeatSlot(
    seatIndex: Int,
    playerId: Option[String] = None,
    displayName: Option[String] = None,
    seatType: String = GameConfig.HumanSeat
):

  /** True once a player (human or bot) has claimed this seat. */
  def isOccupied: Boolean = playerId.nonEmpty

  /** True when a computer plays this seat. */
  def isBot: Boolean = GameConfig.isBotType(seatType)

  /** True when a human still has to join and claim this seat. */
  def isOpenHumanSeat: Boolean = !isOccupied && !isBot

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

  /**
   * How many seats the lobby should report as filled. Bot seats are always
   * ready, so this is the player count minus the human seats still waiting.
   */
  def filledSeats: Int = config.playerCount - openHumanSeats.size

  /** Seats a human still has to join; bot seats are never open. */
  def openHumanSeats: Vector[Int] =
    seats.collect { case seat if seat.isOpenHumanSeat => seat.seatIndex }

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
      isQuickPair = config.isQuickPair,
      deckSize = config.effectiveDeckSize
    )

/**
 * The outcome of creating a room: the room plus the creator's seat.
 *
 * `seatIndex` is `None` when the creator is not a player (a dev-mode all-bot
 * spectator room), which the REST API reports as `seatIndex: null` with
 * `role: "spectator"`.
 */
final case class RoomCreation(room: GameRoom, seatIndex: Option[Int]):

  /** `"player"` when the creator sits at a seat, `"spectator"` otherwise. */
  def role: String = if seatIndex.isDefined then RoomCreation.PlayerRole else RoomCreation.SpectatorRole

object RoomCreation:

  /** Role of a creator who occupies one of the seats. */
  val PlayerRole: String = "player"

  /** Role of a creator who only watches an all-bot match. */
  val SpectatorRole: String = "spectator"

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
