package durak.protocol

import durak.engine.Card

/**
 * Public summary of one open lobby room.
 *
 * Deliberately contains no game state: it is safe to broadcast to every lobby
 * subscriber.
 */
final case class LobbyRoomSummary(
    gameId: String,
    hostName: String,
    playerCount: Int,
    filledSeats: Int,
    allowRedirect: Boolean,
    turnTimeoutSeconds: Int,
    createdAtEpochMs: Long,
    isQuickPair: Boolean
)

/** Every frame a client may send over `/ws/games/:gameId` (or `/ws/lobby`). */
enum WsClientMessage:
  case PlayAttack(cards: List[Card])
  case CoverCard(attackIndex: Int, defenseCard: Card)
  case RedirectAttack(cards: List[Card])
  case ThrowInCards(cards: List[Card])
  case DeclareSurrender
  case PassTurn
  case Ping

/**
 * Every frame the server may send to a client.
 *
 * The ADT intentionally has no `GameState` case: the only game payload is an
 * already-projected [[PlayerGameView]].
 */
enum WsServerMessage:
  case GameViewUpdate(view: PlayerGameView)
  case ActionRejected(code: String, message: String)
  case LobbySnapshot(rooms: List[LobbyRoomSummary])
  case LobbyUpdated(rooms: List[LobbyRoomSummary])
  case MatchFound(gameId: String)
  // The deferred quick-pair queue matched this very viewer with a real room.
  // It is delivered only to the matched player's own `/ws/lobby` socket.
  case QuickPairMatched(gameId: String, seatIndex: Int)
  case Pong

/**
 * The wire answer of `POST /api/quick-pair` (and `GET /api/quick-pair/status`).
 *
 * Both cases carry an explicit `status`, so a client parses one uniform shape
 * whether the player is still waiting in the queue or has just been seated.
 */
enum QuickPairResponse:
  case Searching(
      playerCount: Int,
      turnTimeoutSeconds: Int,
      allowRedirect: Boolean,
      queuedCount: Int,
      requiredCount: Int
  )
  case Matched(gameId: String, seatIndex: Int)
