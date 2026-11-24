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
  case QuickPairMatched(gameId: String, seatIndex: Int)
  case Pong
