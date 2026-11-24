/**
 * Wire contracts for the Milestone M2 multiplayer protocol.
 *
 * These types mirror `durak.protocol` on the Scala backend one-for-one: the
 * REST clients and the lobby/game WebSocket clients are the only code that
 * touches raw JSON, and every payload is parsed into these shapes first.
 *
 * The card and table-pair types are the existing frontend ones (`suit`/`rank`
 * travel as lowercase strings, see `durak.engine.JsonCodecs`).
 */
import { isCard, type Card, type TablePair } from '../types';

export type { Card, TablePair };

/** Suit wire names: `clubs`, `diamonds`, `hearts`, `spades`. */
export type Suit = string;

/** Player counts the server accepts. */
export type PlayerCount = 2 | 3 | 4;

/** Room lifecycle, in the casing the frontend uses. */
export type RoomStatus = 'WaitingForPlayers' | 'InProgress' | 'Finished';

/** Connection state of a reconnecting WebSocket client. */
export type SocketStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

/** The anonymous or registered player behind the session cookie. */
export interface GuestSession {
  playerId: string;
  displayName: string;
  isGuest: boolean;
}

/** Public match settings every viewer may read. */
export interface RoomConfigView {
  playerCount: PlayerCount;
  allowRedirect: boolean;
  turnTimeoutSeconds: number;
  isPublic: boolean;
}

/**
 * A player reduced to public information only. There is deliberately no card
 * list: opponent hands never leave the server.
 */
export interface PublicPlayerSummary {
  id: string;
  name: string;
  rating: number | null;
  cardCount: number;
  isConnected: boolean;
  hasPassed: boolean;
  finishRank: number | null;
  seatIndex: number;
}

/** One seat of a room, occupied or not. */
export interface RoomSeatView {
  seatIndex: number;
  playerId: string | null;
  displayName: string | null;
  isConnected: boolean;
}

/**
 * Strictly filtered projection of one room for one viewer (`PlayerGameView`
 * in `durak.protocol`). `hand` is the viewer's own cards only, and empty for
 * spectators. The talon is only ever a count plus the visible bottom trump.
 */
export interface PlayerGameView {
  gameId: string;
  status: RoomStatus;
  config: RoomConfigView;
  viewerId: string;
  viewerSeat: number | null;
  hand: Card[];
  players: PublicPlayerSummary[];
  seats: RoomSeatView[];
  tablePairs: TablePair[];
  talonCount: number;
  bottomTrumpCard: Card | null;
  trumpSuit: Suit | null;
  discardCount: number;
  phase: string | null;
  attackerIdx: number | null;
  defenderIdx: number | null;
  maxBoutAttacks: number;
  finishOrder: string[];
  isDraw: boolean;
  durakId: string | null;
  turnDeadlineEpochMs: number | null;
  /**
   * T-95-audit-gap: the viewer-safe M1 table fields. Every one of them is
   * either public or the viewer's own projection (`legalActions`,
   * `throwInCards`); no opponent or undealt talon card ever travels here.
   */
  myName?: string;
  myHasPassed?: boolean;
  myFinishRank?: number | null;
  winners?: string[];
  legalActions?: string[];
  throwInCards?: Card[];
  throwInCapacity?: number;
  canThrowIn?: boolean;
  defenderDefenseless?: boolean;
  promptedPlayerIds?: string[];
  eligibleTargetIds?: string[];
  redirectTargetId?: string | null;
  turnPlayerId?: string | null;
  turnSecondsRemaining?: number;
  lastDiscardCards?: Card[];
  gameStartedAtMs?: number | null;
  gameEndedAtMs?: number | null;
}

/** One open public room in the lobby pool. */
export interface LobbyRoomSummary {
  gameId: string;
  hostName: string;
  playerCount: number;
  filledSeats: number;
  allowRedirect: boolean;
  turnTimeoutSeconds: number;
  createdAtEpochMs: number;
  isQuickPair: boolean;
}

/** Body of `POST /api/games`. */
export interface CreateRoomRequest {
  playerCount: PlayerCount;
  allowRedirect: boolean;
  turnTimeoutSeconds: number;
  isPublic: boolean;
}

/** Response of `POST /api/games`. */
export interface CreateRoomResponse {
  gameId: string;
  seatIndex: number;
  inviteUrl: string;
}

/** Response of `POST /api/games/:gameId/join`. */
export interface JoinRoomResponse {
  gameId: string;
  seatIndex: number;
  view: PlayerGameView;
}

/** Body of `POST /api/quick-pair`. */
export interface QuickPairRequest {
  playerCount: PlayerCount;
  turnTimeoutSeconds?: number;
  allowRedirect?: boolean;
}

/** Response of `POST /api/quick-pair`. */
export interface QuickPairResponse {
  gameId: string;
  seatIndex: number;
}

/** Response of `POST /api/qa/presets/seed-lobby`. */
export interface SeedLobbyPresetResponse {
  rooms: LobbyRoomSummary[];
}

/** Response of `POST /api/qa/presets/active-match`. */
export interface ActiveMatchPresetResponse {
  gameId: string;
  seatIndex: number;
}

/** Response of `POST /api/qa/presets/spectator-match`. */
export interface SpectatorMatchPresetResponse {
  gameId: string;
}

/** Frames a client may send to `/ws/games/:gameId`. */
export type WsClientMessage =
  | { type: 'playAttack'; cards: Card[] }
  | { type: 'coverCard'; attackIndex: number; defenseCard: Card }
  | { type: 'redirectAttack'; cards: Card[] }
  | { type: 'throwInCards'; cards: Card[] }
  | { type: 'declareSurrender' }
  | { type: 'passTurn' }
  | { type: 'ping' };

/** Frames the server may send to a lobby or game socket. */
export type WsServerMessage =
  | { type: 'gameViewUpdate'; view: PlayerGameView }
  | { type: 'actionRejected'; code: string; message: string }
  | { type: 'lobbySnapshot'; rooms: LobbyRoomSummary[] }
  | { type: 'lobbyUpdated'; rooms: LobbyRoomSummary[] }
  | { type: 'matchFound'; gameId: string }
  | { type: 'pong' };

// --- Parsing helpers -------------------------------------------------------

function fail(message: string): never {
  throw new Error(`Invalid multiplayer payload: ${message}`);
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') fail(`${key} must be a string`);
  return value;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function arrayOf(value: unknown, key: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(`${key} must be an array`);
  return value;
}

function parseCard(value: unknown): Card {
  if (!isCard(value)) fail('expected a card with a string suit and rank');
  return { suit: value.suit, rank: value.rank };
}

function parseNullableCard(value: unknown): Card | null {
  return value === undefined || value === null ? null : parseCard(value);
}

function parseTablePair(value: unknown): TablePair {
  const raw = asObject(value, 'TablePair');
  return {
    attack: parseCard(raw.attack),
    defense: parseNullableCard(raw.defense),
  };
}

/** Accepts both the wire casing (`inProgress`) and the frontend casing. */
export function roomStatusFromWire(value: unknown): RoomStatus | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case 'waitingforplayers':
      return 'WaitingForPlayers';
    case 'inprogress':
      return 'InProgress';
    case 'finished':
      return 'Finished';
    default:
      return null;
  }
}

/** Validates and normalizes the room settings of a view. */
export function parseRoomConfigView(value: unknown): RoomConfigView {
  if (value === undefined || value === null) {
    return { playerCount: 2, allowRedirect: true, turnTimeoutSeconds: 15, isPublic: true };
  }
  const raw = asObject(value, 'RoomConfigView');
  const playerCount = raw.playerCount;
  if (playerCount !== 2 && playerCount !== 3 && playerCount !== 4) {
    fail('config.playerCount must be 2, 3 or 4');
  }
  return {
    playerCount,
    allowRedirect: booleanOr(raw.allowRedirect, true),
    turnTimeoutSeconds: numberOr(raw.turnTimeoutSeconds, 15),
    isPublic: booleanOr(raw.isPublic, true),
  };
}

/** Validates a public opponent summary (never contains a hand). */
export function parsePublicPlayerSummary(value: unknown): PublicPlayerSummary {
  const raw = asObject(value, 'PublicPlayerSummary');
  return {
    id: requireString(raw, 'id'),
    name: requireString(raw, 'name'),
    rating: optionalNumber(raw.rating),
    cardCount: numberOr(raw.cardCount, 0),
    isConnected: booleanOr(raw.isConnected, false),
    hasPassed: booleanOr(raw.hasPassed, false),
    finishRank: optionalNumber(raw.finishRank),
    seatIndex: numberOr(raw.seatIndex, 0),
  };
}

/** Validates one room seat. */
export function parseRoomSeatView(value: unknown): RoomSeatView {
  const raw = asObject(value, 'RoomSeatView');
  return {
    seatIndex: numberOr(raw.seatIndex, 0),
    playerId: optionalString(raw.playerId),
    displayName: optionalString(raw.displayName),
    isConnected: booleanOr(raw.isConnected, false),
  };
}

/**
 * Validates an incoming `PlayerGameView` projection.
 *
 * Only public/own-player data is read: `hand` comes from the viewer's own
 * payload and there is no key that could carry an opponent's cards.
 */
export function parsePlayerGameView(value: unknown): PlayerGameView {
  const raw = asObject(value, 'PlayerGameView');
  const status = roomStatusFromWire(raw.status);
  if (status === null) fail('status must be a room status');

  return {
    gameId: requireString(raw, 'gameId'),
    status,
    config: parseRoomConfigView(raw.config),
    viewerId: requireString(raw, 'viewerId'),
    viewerSeat: optionalNumber(raw.viewerSeat),
    hand: arrayOf(raw.hand, 'hand').map(parseCard),
    players: arrayOf(raw.players, 'players').map(parsePublicPlayerSummary),
    seats: arrayOf(raw.seats, 'seats').map(parseRoomSeatView),
    tablePairs: arrayOf(raw.tablePairs, 'tablePairs').map(parseTablePair),
    talonCount: numberOr(raw.talonCount, 0),
    bottomTrumpCard: parseNullableCard(raw.bottomTrumpCard),
    trumpSuit: optionalString(raw.trumpSuit),
    discardCount: numberOr(raw.discardCount, 0),
    phase: optionalString(raw.phase),
    attackerIdx: optionalNumber(raw.attackerIdx),
    defenderIdx: optionalNumber(raw.defenderIdx),
    maxBoutAttacks: numberOr(raw.maxBoutAttacks, 0),
    finishOrder: arrayOf(raw.finishOrder, 'finishOrder').map((id) => String(id)),
    isDraw: booleanOr(raw.isDraw, false),
    durakId: optionalString(raw.durakId),
    turnDeadlineEpochMs: optionalNumber(raw.turnDeadlineEpochMs),
    myName: optionalString(raw.myName) ?? undefined,
    myHasPassed: booleanOr(raw.myHasPassed, false),
    myFinishRank: optionalNumber(raw.myFinishRank),
    winners: arrayOf(raw.winners, 'winners').map((id) => String(id)),
    legalActions: arrayOf(raw.legalActions, 'legalActions').map((action) => String(action)),
    throwInCards: arrayOf(raw.throwInCards, 'throwInCards').map(parseCard),
    throwInCapacity: numberOr(raw.throwInCapacity, 0),
    canThrowIn: booleanOr(raw.canThrowIn, false),
    defenderDefenseless: booleanOr(raw.defenderDefenseless, false),
    promptedPlayerIds: arrayOf(raw.promptedPlayerIds, 'promptedPlayerIds').map((id) =>
      String(id),
    ),
    eligibleTargetIds: arrayOf(raw.eligibleTargetIds, 'eligibleTargetIds').map((id) =>
      String(id),
    ),
    redirectTargetId: optionalString(raw.redirectTargetId),
    turnPlayerId: optionalString(raw.turnPlayerId),
    turnSecondsRemaining: numberOr(raw.turnSecondsRemaining, 0),
    lastDiscardCards: arrayOf(raw.lastDiscardCards, 'lastDiscardCards').map(parseCard),
    gameStartedAtMs: optionalNumber(raw.gameStartedAtMs),
    gameEndedAtMs: optionalNumber(raw.gameEndedAtMs),
  };
}

/** Validates one open lobby room. */
export function parseLobbyRoomSummary(value: unknown): LobbyRoomSummary {
  const raw = asObject(value, 'LobbyRoomSummary');
  return {
    gameId: requireString(raw, 'gameId'),
    hostName: typeof raw.hostName === 'string' ? raw.hostName : '',
    playerCount: numberOr(raw.playerCount, 2),
    filledSeats: numberOr(raw.filledSeats, 0),
    allowRedirect: booleanOr(raw.allowRedirect, true),
    turnTimeoutSeconds: numberOr(raw.turnTimeoutSeconds, 15),
    createdAtEpochMs: numberOr(raw.createdAtEpochMs, 0),
    isQuickPair: booleanOr(raw.isQuickPair, false),
  };
}

/** Parses a JSON array of lobby rooms. */
export function parseLobbyRoomList(value: unknown): LobbyRoomSummary[] {
  return arrayOf(value, 'rooms').map(parseLobbyRoomSummary);
}

/** Parses and discriminates one server WebSocket frame. */
export function parseWsServerMessage(value: unknown): WsServerMessage {
  const raw = asObject(value, 'WsServerMessage');
  const type = requireString(raw, 'type').trim().toLowerCase();
  switch (type) {
    case 'gameviewupdate':
      return { type: 'gameViewUpdate', view: parsePlayerGameView(raw.view) };
    case 'actionrejected':
      return {
        type: 'actionRejected',
        code: requireString(raw, 'code'),
        message: requireString(raw, 'message'),
      };
    case 'lobbysnapshot':
      return { type: 'lobbySnapshot', rooms: parseLobbyRoomList(raw.rooms) };
    case 'lobbyupdated':
      return { type: 'lobbyUpdated', rooms: parseLobbyRoomList(raw.rooms) };
    case 'matchfound':
      return { type: 'matchFound', gameId: requireString(raw, 'gameId') };
    case 'pong':
      return { type: 'pong' };
    default:
      return fail(`unknown server message type: ${type}`);
  }
}
