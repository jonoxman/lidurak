import {
  parseLobbyRoomList,
  parsePlayerGameView,
  parseQuickPairResponse,
  parseWsServerMessage,
  type GameRole,
  type ActiveMatchPresetResponse,
  type CreateRoomRequest,
  type CreateRoomResponse,
  type JoinRoomResponse,
  type LobbyRoomSummary,
  type PlayerCount,
  type PlayerGameView,
  type QuickPairOpponentPresetResponse,
  type QuickPairRequest,
  type QuickPairResponse,
  type SeedLobbyPresetResponse,
  type SpectatorMatchPresetResponse,
  type SocketStatus,
} from '../types/multiplayer';
import { apiRequest } from './sessionClient';

const RECONNECT_BASE_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 5000;

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Invalid ${label}: expected a JSON object`);
  }
  return value as Record<string, unknown>;
}

function readGameId(value: unknown, label: string): string {
  const raw = asObject(value, label);
  if (typeof raw.gameId !== 'string' || raw.gameId.length === 0) {
    throw new Error(`Invalid ${label}: gameId must be a string`);
  }
  return raw.gameId;
}

function readSeatOrNull(value: unknown): number | null {
  const raw = asObject(value, 'response');
  return typeof raw.seatIndex === 'number' && Number.isFinite(raw.seatIndex)
    ? raw.seatIndex
    : null;
}

function readSeat(value: unknown): number {
  return readSeatOrNull(value) ?? 0;
}

/** T-90-2 ITEM-7b: the server-reported creator role, when present. */
function readRole(value: unknown): GameRole | undefined {
  const raw = asObject(value, 'CreateRoomResponse').role;
  return raw === 'player' || raw === 'spectator' ? raw : undefined;
}

/** Open public rooms in the Lobby Pool. */
export async function fetchLobbyRooms(): Promise<LobbyRoomSummary[]> {
  return parseLobbyRoomList(await apiRequest('/api/lobby'));
}

/**
 * Creates a shareable room. The caller owns a seat unless the request asks to
 * spectate (`creatorSeatIndex: null` / `spectateAsCreator: true`), in which
 * case the server answers `seatIndex: null` and `role: 'spectator'`.
 */
export async function createRoom(req: CreateRoomRequest): Promise<CreateRoomResponse> {
  const body = await apiRequest('/api/games', { method: 'POST', body: req });
  const raw = asObject(body, 'CreateRoomResponse');
  const gameId = readGameId(body, 'CreateRoomResponse');
  const role = readRole(body);
  return {
    gameId,
    seatIndex: readSeatOrNull(body),
    inviteUrl: typeof raw.inviteUrl === 'string' ? (raw.inviteUrl as string) : `/g/${gameId}`,
    ...(role ? { role } : {}),
  };
}

/** Fetches the caller's strictly filtered projection of one room. */
export async function fetchGameView(gameId: string): Promise<PlayerGameView> {
  const body = await apiRequest(`/api/games/${encodeURIComponent(gameId)}`);
  return parsePlayerGameView(body);
}

/** Takes an open seat in a waiting room. */
export async function joinRoom(gameId: string): Promise<JoinRoomResponse> {
  const body = await apiRequest(`/api/games/${encodeURIComponent(gameId)}/join`, {
    method: 'POST',
  });
  const raw = asObject(body, 'JoinRoomResponse');
  return {
    gameId: readGameId(body, 'JoinRoomResponse'),
    seatIndex: readSeat(body),
    view: parsePlayerGameView(raw.view),
  };
}

/** Leaves a waiting room (rejected once the match has started). */
export async function leaveRoom(gameId: string): Promise<void> {
  await apiRequest(`/api/games/${encodeURIComponent(gameId)}/leave`, { method: 'POST' });
}

/**
 * Joins the Quick Pairing queue. The server answers either `searching` (no room
 * exists yet, keep the searching status) or `matched` (the player owns a seat).
 */
export async function joinQuickPair(req: QuickPairRequest): Promise<QuickPairResponse> {
  const body = await apiRequest('/api/quick-pair', { method: 'POST', body: req });
  return parseQuickPairResponse(body);
}

/** Leaves the Quick Pairing pool. */
export async function cancelQuickPair(): Promise<void> {
  await apiRequest('/api/quick-pair', { method: 'DELETE' });
}

// --- QA scenario presets ---------------------------------------------------

/** Creates three live open rooms so the Lobby Pool can be reviewed in 1 click. */
export async function seedLobbyPreset(): Promise<SeedLobbyPresetResponse> {
  const body = await apiRequest('/api/qa/presets/seed-lobby', { method: 'POST' });
  const rooms = Array.isArray(body)
    ? parseLobbyRoomList(body)
    : parseLobbyRoomList(asObject(body, 'SeedLobbyPresetResponse').rooms);
  return { rooms };
}

/** Starts an active match with the caller in seat 0 and bots in the rest. */
export async function createActiveMatchPreset(
  playerCount: PlayerCount = 2,
): Promise<ActiveMatchPresetResponse> {
  const body = await apiRequest('/api/qa/presets/active-match', {
    method: 'POST',
    body: { playerCount },
  });
  return { gameId: readGameId(body, 'ActiveMatchPresetResponse'), seatIndex: readSeat(body) };
}

/**
 * Fills the caller's own quick-pair bucket with synthetic opponents, then lets
 * the real per-player `quickPairMatched` frame navigate the reviewer.
 */
export async function triggerQaQuickPairOpponent(): Promise<QuickPairOpponentPresetResponse> {
  const body = await apiRequest('/api/qa/presets/quick-pair-opponent', { method: 'POST' });
  return {
    gameId: readGameId(body, 'QuickPairOpponentPresetResponse'),
    seatIndex: readSeat(body),
  };
}

/**
 * Starts a real 2P active match dealt with four-card hands, so the constant
 * width small-hand hover animation can be checked in one click.
 */
export async function launchQaSmallHandMatch(): Promise<ActiveMatchPresetResponse> {
  const body = await apiRequest('/api/qa/presets/active-match', {
    method: 'POST',
    body: { playerCount: 2, handSize: 4 },
  });
  return { gameId: readGameId(body, 'ActiveMatchPresetResponse'), seatIndex: readSeat(body) };
}

/** Starts a full match the caller only watches (`viewerSeat: null`, `hand: []`). */
export async function createSpectatorMatchPreset(): Promise<SpectatorMatchPresetResponse> {
  const body = await apiRequest('/api/qa/presets/spectator-match', { method: 'POST' });
  return { gameId: readGameId(body, 'SpectatorMatchPresetResponse') };
}

// --- Live lobby WebSocket --------------------------------------------------

export interface LobbySocketHandlers {
  /** The initial set of open rooms. */
  onSnapshot?: (rooms: LobbyRoomSummary[]) => void;
  /** Every subsequent lobby change. */
  onUpdated?: (rooms: LobbyRoomSummary[]) => void;
  /** Quick Pairing assigned this player to a room (legacy frame). */
  onMatchFound?: (gameId: string) => void;
  /** The deferred quick-pair queue seated this player (`quickPairMatched`). */
  onQuickPairMatched?: (gameId: string, seatIndex: number) => void;
  onActionRejected?: (code: string, message: string) => void;
  onStatusChange?: (status: SocketStatus) => void;
  onError?: (event: unknown) => void;
}

export interface LobbySocket {
  readonly status: SocketStatus;
  /** Closes the socket and cancels every pending reconnect timer. */
  close(): void;
}

/** Builds a `ws:`/`wss:` URL relative to the page host, so the Vite proxy works. */
function lobbySocketUrl(): string {
  const host = typeof location === 'undefined' ? 'localhost:8080' : location.host;
  const scheme =
    typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${host}/ws/lobby`;
}

class ReconnectingLobbySocket implements LobbySocket {
  status: SocketStatus = 'connecting';

  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private closed = false;

  constructor(private readonly handlers: LobbySocketHandlers) {
    this.open();
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const socket = this.socket;
    this.socket = null;
    if (socket !== null) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
    }
    this.setStatus('disconnected');
  }

  private open(): void {
    if (this.closed) return;

    const socket = new WebSocket(lobbySocketUrl());
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.attempts = 0;
      this.setStatus('connected');
    };

    socket.onmessage = (event: MessageEvent) => {
      if (this.socket !== socket) return;
      this.handleMessage(event.data);
    };

    socket.onerror = (event: Event) => {
      if (this.socket !== socket) return;
      this.handlers.onError?.(event);
    };

    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.scheduleReconnect();
    };
  }

  private handleMessage(data: unknown): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(data));
    } catch {
      return;
    }

    let message;
    try {
      message = parseWsServerMessage(parsed);
    } catch {
      return;
    }

    switch (message.type) {
      case 'lobbySnapshot':
        this.handlers.onSnapshot?.(message.rooms);
        break;
      case 'lobbyUpdated':
        this.handlers.onUpdated?.(message.rooms);
        break;
      case 'matchFound':
        this.handlers.onMatchFound?.(message.gameId);
        break;
      case 'quickPairMatched':
        this.handlers.onQuickPairMatched?.(message.gameId, message.seatIndex);
        break;
      case 'actionRejected':
        this.handlers.onActionRejected?.(message.code, message.message);
        break;
      default:
        // Game views and pongs are not lobby state; ignore them here.
        break;
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) return;

    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** this.attempts,
      RECONNECT_MAX_DELAY_MS,
    );
    this.attempts += 1;
    this.setStatus('reconnecting');

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private setStatus(status: SocketStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.handlers.onStatusChange?.(status);
  }
}

/**
 * Subscribes to `/ws/lobby`. The server pushes a `LobbySnapshot` first and
 * `LobbyUpdated` frames afterwards; a dropped connection is retried with capped
 * exponential backoff (`500ms` → `5s`), and `close()` tears everything down.
 */
export function connectLobbySocket(handlers: LobbySocketHandlers = {}): LobbySocket {
  return new ReconnectingLobbySocket(handlers);
}
