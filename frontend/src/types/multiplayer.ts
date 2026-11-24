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
  isInitialAttackPhase,
  normalizeToken,
  type Card,
  type GameAction,
  type PlayerGameView as M1PlayerGameView,
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
  // --- Wave-1 enrichment (all optional, so older servers still parse) -----
  /** The viewer's own legal engine actions (`attack`, `cover`, `pass`, …). */
  legalActions?: string[];
  /** Cards this seat may legally throw in right now. */
  throwInCards?: Card[];
  /** Remaining attacker slots this seat may fill in the current bout. */
  throwInCapacity?: number | null;
  /** Backend-owned throw-in gate for this seat. */
  canThrowIn?: boolean;
  /** Seconds left on the active turn clock (`0` when the clock is idle). */
  turnSecondsRemaining?: number;
  /** This seat already passed on the current bout. */
  myHasPassed?: boolean;
  /** This seat's finishing place (`1` = first out), once its hand is empty. */
  myFinishRank?: number | null;
  /** Every winner, in finishing order. */
  winners?: string[];
  /** The Durak (last place) named by the backend. */
  durak?: string | null;
  /** This seat's defender has no legal cover and no legal redirect. */
  defenderDefenseless?: boolean;
  /** Epoch-ms timestamps behind the M1 game clock. */
  gameStartedAtMs?: number | null;
  gameEndedAtMs?: number | null;
  /** Most recent finished bout, revealed face-up in the deck box. */
  lastDiscardCards?: Card[];
  /** Seats the current attacker may aim at during the opening attack. */
  eligibleTargetIds?: string[];
  /** The seat a reflection would reach. */
  redirectTargetId?: string | null;
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
    ...(Array.isArray(raw.legalActions)
      ? { legalActions: raw.legalActions.filter((entry): entry is string => typeof entry === 'string') }
      : {}),
    ...(Array.isArray(raw.throwInCards) ? { throwInCards: arrayOf(raw.throwInCards, 'throwInCards').map(parseCard) } : {}),
    ...(typeof raw.throwInCapacity === 'number' ? { throwInCapacity: raw.throwInCapacity } : {}),
    ...(typeof raw.canThrowIn === 'boolean' ? { canThrowIn: raw.canThrowIn } : {}),
    ...(typeof raw.turnSecondsRemaining === 'number'
      ? { turnSecondsRemaining: raw.turnSecondsRemaining }
      : {}),
    ...(typeof raw.myHasPassed === 'boolean' ? { myHasPassed: raw.myHasPassed } : {}),
    ...(typeof raw.myFinishRank === 'number' ? { myFinishRank: raw.myFinishRank } : {}),
    ...(Array.isArray(raw.winners)
      ? { winners: raw.winners.filter((entry): entry is string => typeof entry === 'string') }
      : {}),
    ...(typeof raw.durak === 'string' ? { durak: raw.durak } : {}),
    ...(typeof raw.defenderDefenseless === 'boolean'
      ? { defenderDefenseless: raw.defenderDefenseless }
      : {}),
    ...(typeof raw.gameStartedAtMs === 'number' ? { gameStartedAtMs: raw.gameStartedAtMs } : {}),
    ...(typeof raw.gameEndedAtMs === 'number' ? { gameEndedAtMs: raw.gameEndedAtMs } : {}),
    ...(Array.isArray(raw.lastDiscardCards)
      ? { lastDiscardCards: arrayOf(raw.lastDiscardCards, 'lastDiscardCards').map(parseCard) }
      : {}),
    ...(Array.isArray(raw.eligibleTargetIds)
      ? {
          eligibleTargetIds: raw.eligibleTargetIds.filter(
            (entry): entry is string => typeof entry === 'string',
          ),
        }
      : {}),
    ...(typeof raw.redirectTargetId === 'string'
      ? { redirectTargetId: raw.redirectTargetId }
      : {}),
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

// --- M1 adapter ------------------------------------------------------------

/** Stable M1 seat id (`p<seatIndex>`) of one multiplayer seat. */
export function multiplayerSeatId(seatIndex: number): string {
  return `p${seatIndex}`;
}

/**
 * The viewer's legal engine actions, derived from the projected phase and seats
 * when the server payload does not carry an `legalActions` list yet.
 *
 * Only the seat that may actually move receives actions, so a spectator
 * (`viewerSeat: null`) and a finished match always get an empty list.
 */
export function deriveLegalActions(view: PlayerGameView): string[] {
  if (view.status !== 'InProgress') return [];
  const seat = view.viewerSeat;
  if (seat == null) return [];
  const phase = normalizeToken(view.phase ?? '');
  if (phase.length === 0 || phase === 'gameover') return [];

  const actions: string[] = [];
  const isAttacker = view.attackerIdx === seat;
  const isDefender = view.defenderIdx === seat;
  const tableRanks = new Set<string>();
  view.tablePairs.forEach((pair) => {
    tableRanks.add(pair.attack.rank.toLowerCase());
    if (pair.defense) tableRanks.add(pair.defense.rank.toLowerCase());
  });
  const hasThrowInCard = view.hand.some((card) => tableRanks.has(card.rank.toLowerCase()));
  const hasRoom = view.tablePairs.length < view.maxBoutAttacks;
  const canThrowIn = hasThrowInCard && hasRoom;

  if (phase === 'initialattack') {
    if (isAttacker) actions.push('attack');
    return actions;
  }

  if (isDefender) {
    if (phase === 'defense') {
      actions.push('cover');
      if (view.config.allowRedirect) actions.push('redirect');
      actions.push('surrender');
    }
    return actions;
  }

  const covered =
    view.tablePairs.length > 0 && view.tablePairs.every((pair) => pair.defense != null);
  if (phase === 'surrenderthrowin') {
    if (canThrowIn) actions.push('throwIn');
    actions.push('pass');
  } else if (phase === 'defense' && covered) {
    if (canThrowIn) actions.push('throwIn');
    actions.push('pass');
  }
  return actions;
}

/** The seat whose turn clock is running, as an M1 `p<seat>` id. */
export function multiplayerTurnSeatId(view: PlayerGameView): string | undefined {
  const seat = isInitialAttackPhase(view.phase ?? '')
    ? view.attackerIdx
    : (view.defenderIdx ?? view.attackerIdx);
  return seat == null ? undefined : multiplayerSeatId(seat);
}

/**
 * Maps one multiplayer projection onto the Milestone 1 `PlayerGameView` that
 * `GameTable`, `ActionBar`, `SortBar` and `GamePage` consume.
 *
 * Every seat is rewritten to a stable `p<seatIndex>` id, so the M1 seat order,
 * attacker/defender lookups and hand highlighting keep working unchanged. A
 * spectator keeps a private `spectator` id, an empty hand and `isBot: true`, so
 * no hand card and no move control can ever be rendered for them.
 */
export function multiplayerViewToM1(view: PlayerGameView): M1PlayerGameView {
  const mySeat = view.viewerSeat;
  const spectator = mySeat == null;
  const viewerSummary = spectator
    ? null
    : (view.players.find((player) => player.seatIndex === mySeat) ?? null);

  const opponents = view.players
    .filter((player) => player.seatIndex !== mySeat)
    .sort((left, right) => left.seatIndex - right.seatIndex)
    .map((player) => ({
      id: multiplayerSeatId(player.seatIndex),
      name: player.name,
      cardCount: player.cardCount,
      hasPassed: player.hasPassed,
      finishRank: player.finishRank ?? null,
      isPresent: player.isConnected,
    }));

  const legalActions = Array.isArray(view.legalActions)
    ? view.legalActions
    : deriveLegalActions(view);

  const tableRanks = new Set<string>();
  view.tablePairs.forEach((pair) => {
    tableRanks.add(pair.attack.rank.toLowerCase());
    if (pair.defense) tableRanks.add(pair.defense.rank.toLowerCase());
  });
  const remaining = Math.max(0, view.maxBoutAttacks - view.tablePairs.length);
  const projectedThrowIn = Array.isArray(view.throwInCards)
    ? view.throwInCards
    : view.hand.filter((card) => tableRanks.has(card.rank.toLowerCase())).slice(0, remaining);
  const throwInCapacity = Math.max(
    0,
    Math.min(remaining, view.throwInCapacity ?? projectedThrowIn.length),
  );

  const seatIdOf = (playerId: string | null | undefined): string | null => {
    if (playerId == null) return null;
    const player = view.players.find((entry) => entry.id === playerId);
    return player ? multiplayerSeatId(player.seatIndex) : null;
  };

  const finishOrder = (view.finishOrder.length > 0
    ? view.finishOrder.map(seatIdOf).filter((id): id is string => id != null)
    : [...view.players]
        .filter((player) => player.finishRank != null)
        .sort((left, right) => (left.finishRank ?? 0) - (right.finishRank ?? 0))
        .map((player) => multiplayerSeatId(player.seatIndex)));

  const phase =
    view.phase ??
    (view.status === 'WaitingForPlayers'
      ? 'waitingForPlayers'
      : view.status === 'Finished'
        ? 'gameOver'
        : 'initialAttack');
  const turnSeconds =
    view.turnSecondsRemaining ??
    (view.status === 'Finished' ? 0 : view.config.turnTimeoutSeconds);

  return {
    myId: spectator ? 'spectator' : multiplayerSeatId(mySeat),
    myName: spectator ? 'Spectator' : (viewerSummary?.name ?? view.viewerId),
    myHand: spectator ? [] : view.hand,
    opponents,
    tablePairs: view.tablePairs,
    talonCount: view.talonCount,
    bottomTrumpCard: view.bottomTrumpCard,
    trumpSuit: view.trumpSuit ?? '',
    attackerIdx: view.attackerIdx ?? -1,
    defenderIdx: view.defenderIdx ?? -1,
    boutPhase: phase,
    legalActions: spectator ? [] : legalActions,
    finishOrder,
    isDraw: view.isDraw,
    maxBoutAttacks: view.maxBoutAttacks,
    defenderDefenseless: view.defenderDefenseless ?? false,
    throwInCards: projectedThrowIn,
    throwInCapacity,
    canThrowIn:
      view.canThrowIn ??
      (legalActions.includes('throwIn') && projectedThrowIn.length > 0 && throwInCapacity > 0),
    chaosMode: false,
    isBot: spectator,
    playerTypes: view.players.map(() => 'human'),
    allowRedirect: view.config.allowRedirect,
    eligibleTargetIds: view.eligibleTargetIds ?? [],
    redirectTargetId: view.redirectTargetId ?? null,
    turnDeadlineMs: view.turnDeadlineEpochMs ?? 0,
    turnSecondsRemaining: turnSeconds,
    turnPlayerId: multiplayerTurnSeatId(view),
    presentPlayers: view.players
      .filter((player) => player.isConnected)
      .map((player) => multiplayerSeatId(player.seatIndex)),
    discardCount: view.discardCount,
    lastDiscardCards: view.lastDiscardCards ?? [],
    gameStartedAtMs: view.gameStartedAtMs ?? null,
    gameEndedAtMs: view.gameEndedAtMs ?? null,
    myHasPassed: viewerSummary?.hasPassed ?? view.myHasPassed ?? false,
    myFinishRank: viewerSummary?.finishRank ?? view.myFinishRank ?? null,
    winners: finishOrder,
    durak: seatIdOf(view.durakId),
    promptedPlayerIds: [],
    transparentMode: false,
    devMode: false,
  };
}

/**
 * Maps one M1 `GameAction` onto the multiplayer WebSocket frame, so the M1
 * table's click/drag/double-click handlers drive the live room unchanged.
 * Returns `null` for an action the room protocol does not support.
 */
export function toWsClientMessage(action: GameAction): WsClientMessage | null {
  switch (action.type) {
    case 'initialAttack':
      return { type: 'playAttack', cards: (action.cards ?? []) as Card[] };
    case 'coverCard':
      return {
        type: 'coverCard',
        attackIndex: Number(action.attackIndex ?? 0),
        defenseCard: action.defenseCard as Card,
      };
    case 'redirectAttack':
      return { type: 'redirectAttack', cards: (action.cards ?? []) as Card[] };
    case 'throwInCards':
      return { type: 'throwInCards', cards: (action.cards ?? []) as Card[] };
    case 'declareSurrender':
      return { type: 'declareSurrender' };
    case 'passTurn':
      return { type: 'passTurn' };
    default:
      return null;
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
    case 'pong':
      return { type: 'pong' };
    default:
      return fail(`unknown server message type: ${type}`);
  }
}
