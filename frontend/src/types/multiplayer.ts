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
import {
  isCard,
  type Card,
  type PlayerGameView as M1PlayerGameView,
  type PublicPlayerSummary as M1OpponentSummary,
  type TablePair,
} from '../types';

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
  /** Backend player status (`active`, `out`, `durak`, …). */
  status: string;
  /** True for the seats the current bout is waiting on. */
  isTurn: boolean;
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
  /** Moves the viewer's own seat may make right now (empty for spectators). */
  legalActions: string[];
  /** Every winner, in finishing order. */
  winners: string[];
  /** Seat whose turn clock is running, if any. */
  turnPlayerId: string | null;
  /** Whole seconds left on the turn clock as projected by the server. */
  turnSecondsRemaining: number;
  /** The viewer is defending and holds no legal cover or redirect. */
  defenderDefenseless: boolean;
  /** Seats the room is currently waiting on. */
  promptedPlayerIds: string[];
  /** Most recent discard, revealed face-up in the deck box. */
  lastDiscardCards: Card[];
  /** Epoch-ms timestamps behind the split game/turn clocks. */
  gameStartedAtMs: number | null;
  gameEndedAtMs: number | null;
  /** Seats the current attacker may aim at (Chaos / opening target list). */
  eligibleTargetIds: string[];
  /** The seat a reflection would reach, so the arrow can point the right way. */
  redirectTargetId: string | null;
  /** Cards this seat may legally throw in (empty = cannot). */
  throwInCards: Card[];
  /** Remaining attacking cards this seat may add to the bout. */
  throwInCapacity: number;
  /** Backend-owned throw-in gate. */
  canThrowIn: boolean;
  /** The viewer's own pass flag. */
  myHasPassed: boolean;
  /** The viewer's own finishing rank (only once their hand is empty). */
  myFinishRank: number | null;
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

/**
 * Response of `POST /api/quick-pair` while the player waits in a queue bucket.
 *
 * No room exists yet: `queuedCount` of `requiredCount` players are waiting, so
 * the lobby must keep showing the searching state instead of navigating.
 */
export interface QuickPairSearching {
  status: 'searching';
  playerCount: number;
  turnTimeoutSeconds: number;
  allowRedirect: boolean;
  queuedCount: number;
  requiredCount: number;
}

/** Response of `POST /api/quick-pair` once the player owns a real seat. */
export interface QuickPairMatched {
  status: 'matched';
  gameId: string;
  seatIndex: number;
}

/** Wire answer of `POST /api/quick-pair` (and `GET /api/quick-pair/status`). */
export type QuickPairResponse = QuickPairSearching | QuickPairMatched;

/** Response of `POST /api/qa/presets/quick-pair-opponent`. */
export interface QuickPairOpponentPresetResponse {
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
  | { type: 'quickPairMatched'; gameId: string; seatIndex: number }
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
    status: typeof raw.status === 'string' ? raw.status : 'active',
    isTurn: booleanOr(raw.isTurn, false),
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
    // The backend emits `boutPhase`; the M2 alias `phase` stays accepted.
    phase: optionalString(raw.boutPhase) ?? optionalString(raw.phase),
    attackerIdx: optionalNumber(raw.attackerIdx),
    defenderIdx: optionalNumber(raw.defenderIdx),
    maxBoutAttacks: numberOr(raw.maxBoutAttacks, 0),
    finishOrder: arrayOf(raw.finishOrder, 'finishOrder').map((id) => String(id)),
    isDraw: booleanOr(raw.isDraw, false),
    // The backend emits `durak`; the M2 alias `durakId` stays accepted.
    durakId: optionalString(raw.durak) ?? optionalString(raw.durakId),
    // The backend emits `turnDeadlineMs`; the M2 alias stays accepted.
    turnDeadlineEpochMs:
      optionalNumber(raw.turnDeadlineMs) ?? optionalNumber(raw.turnDeadlineEpochMs),
    legalActions: arrayOf(raw.legalActions, 'legalActions').map((action) => String(action)),
    winners: arrayOf(raw.winners, 'winners').map((id) => String(id)),
    turnPlayerId: optionalString(raw.turnPlayerId),
    turnSecondsRemaining: numberOr(raw.turnSecondsRemaining, 0),
    defenderDefenseless: booleanOr(raw.defenderDefenseless, false),
    promptedPlayerIds: arrayOf(raw.promptedPlayerIds, 'promptedPlayerIds').map((id) =>
      String(id),
    ),
    lastDiscardCards: arrayOf(raw.lastDiscardCards, 'lastDiscardCards').map(parseCard),
    gameStartedAtMs: optionalNumber(raw.gameStartedAtMs),
    gameEndedAtMs: optionalNumber(raw.gameEndedAtMs),
    eligibleTargetIds: arrayOf(raw.eligibleTargetIds, 'eligibleTargetIds').map((id) =>
      String(id),
    ),
    redirectTargetId: optionalString(raw.redirectTargetId),
    throwInCards: arrayOf(raw.throwInCards, 'throwInCards').map(parseCard),
    throwInCapacity: numberOr(raw.throwInCapacity, 0),
    canThrowIn: booleanOr(raw.canThrowIn, false),
    myHasPassed: booleanOr(raw.myHasPassed, false),
    myFinishRank: optionalNumber(raw.myFinishRank),
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

/** Validates the discriminated `POST /api/quick-pair` answer. */
export function parseQuickPairResponse(value: unknown): QuickPairResponse {
  const raw = asObject(value, 'QuickPairResponse');
  const status = requireString(raw, 'status').trim().toLowerCase();
  switch (status) {
    case 'searching':
      return {
        status: 'searching',
        playerCount: numberOr(raw.playerCount, 2),
        turnTimeoutSeconds: numberOr(raw.turnTimeoutSeconds, 15),
        allowRedirect: booleanOr(raw.allowRedirect, true),
        queuedCount: numberOr(raw.queuedCount, 1),
        requiredCount: numberOr(raw.requiredCount, 2),
      };
    case 'matched':
      return {
        status: 'matched',
        gameId: requireString(raw, 'gameId'),
        seatIndex: numberOr(raw.seatIndex, 0),
      };
    default:
      return fail(`unknown quick-pair status: ${status}`);
  }
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
    case 'quickpairmatched':
      return {
        type: 'quickPairMatched',
        gameId: requireString(raw, 'gameId'),
        seatIndex: numberOr(raw.seatIndex, 0),
      };
    case 'pong':
      return { type: 'pong' };
    default:
      return fail(`unknown server message type: ${type}`);
  }
}

// --- M1 gameplay adapter ---------------------------------------------------

/** The seat id the M1 gameplay table uses for a 0-based seat index. */
export function m1SeatId(seatIndex: number): string {
  return `p${seatIndex}`;
}

/** The id a spectator's projection is viewed as (no hand, no legal moves). */
export const SPECTATOR_SEAT_ID = 'spectator';

/** 36-card for a two/three-player table, 52-card for four players. */
export function deckLabel(playerCount: number): string {
  return playerCount === 4 ? '52-card' : '36-card';
}

/** Human label of a live socket status. */
export function connectionLabel(status: SocketStatus): string {
  switch (status) {
    case 'connected':
      return 'Live';
    case 'reconnecting':
      return 'Reconnecting';
    case 'connecting':
      return 'Connecting';
    default:
      return 'Offline';
  }
}

/**
 * Maps a live multiplayer projection onto the Milestone 1 `PlayerGameView`
 * consumed by `GameTable`, `SortBar`, `ActionBar` and the clock panels.
 *
 * Seats are re-keyed from the opaque server player ids to the M1 `p<seat>`
 * convention (every list keeps fixed seat order), the viewer's own seat becomes
 * `myId` and every other seat becomes an opponent summary. A spectator
 * (`viewerSeat === null`) keeps an empty hand, no legal actions and every
 * player as a public opponent summary — no hidden card list is ever produced.
 */
export function toM1GameView(view: PlayerGameView): M1PlayerGameView {
  const seatIds = new Map<string, string>();
  view.players.forEach((player) => seatIds.set(player.id, m1SeatId(player.seatIndex)));
  const translate = (playerId: string | null | undefined): string | null =>
    playerId == null ? null : (seatIds.get(playerId) ?? playerId);
  const translateList = (ids: string[]): string[] =>
    ids.map((id) => translate(id)).filter((id): id is string => id != null);

  const orderedPlayers = [...view.players].sort((left, right) => left.seatIndex - right.seatIndex);
  const mine =
    view.viewerSeat == null
      ? null
      : (orderedPlayers.find((player) => player.seatIndex === view.viewerSeat) ?? null);
  const myId = mine != null ? m1SeatId(mine.seatIndex) : SPECTATOR_SEAT_ID;

  const opponents: M1OpponentSummary[] = orderedPlayers
    .filter((player) => mine == null || player.id !== mine.id)
    .map((player) => ({
      id: m1SeatId(player.seatIndex),
      name: player.name,
      cardCount: player.cardCount,
      hasPassed: player.hasPassed,
      finishRank: player.finishRank,
      isPresent: player.isConnected,
    }));

  return {
    myId,
    ...(mine != null && mine.name.length > 0 ? { myName: mine.name } : {}),
    myHand: view.hand,
    opponents,
    tablePairs: view.tablePairs.map((pair) => ({
      attack: pair.attack,
      defense: pair.defense ?? null,
    })),
    talonCount: view.talonCount,
    bottomTrumpCard: view.bottomTrumpCard,
    trumpSuit: view.trumpSuit ?? '',
    attackerIdx: view.attackerIdx ?? 0,
    defenderIdx: view.defenderIdx ?? 0,
    boutPhase:
      view.phase ?? (view.status === 'Finished' ? 'GameOver' : 'InitialAttack'),
    legalActions: [...view.legalActions],
    finishOrder: translateList(view.finishOrder),
    isDraw: view.isDraw,
    maxBoutAttacks: view.maxBoutAttacks,
    defenderDefenseless: view.defenderDefenseless,
    throwInCards: view.throwInCards,
    throwInCapacity: view.throwInCapacity,
    canThrowIn: view.canThrowIn,
    chaosMode: false,
    isBot: false,
    playerTypes: orderedPlayers.map(() => 'human'),
    allowRedirect: view.config.allowRedirect,
    eligibleTargetIds: translateList(view.eligibleTargetIds),
    redirectTargetId: translate(view.redirectTargetId),
    turnDeadlineMs: view.turnDeadlineEpochMs ?? 0,
    turnSecondsRemaining: view.turnSecondsRemaining,
    turnPlayerId: translate(view.turnPlayerId) ?? undefined,
    presentPlayers: orderedPlayers
      .filter((player) => player.isConnected)
      .map((player) => m1SeatId(player.seatIndex)),
    discardCount: view.discardCount,
    lastDiscardCards: view.lastDiscardCards,
    gameStartedAtMs: view.gameStartedAtMs,
    gameEndedAtMs: view.gameEndedAtMs,
    myHasPassed: view.myHasPassed,
    myFinishRank: view.myFinishRank,
    winners: translateList(view.winners),
    durak: translate(view.durakId),
    promptedPlayerIds: translateList(view.promptedPlayerIds),
    transparentMode: false,
    devMode: false,
  };
}
