import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelQuickPair,
  connectLobbySocket,
  createActiveMatchPreset,
  createRoom,
  createSpectatorMatchPreset,
  fetchGameView,
  fetchLobbyRooms,
  joinQuickPair,
  joinRoom,
  launchQaSmallHandMatch,
  leaveRoom,
  seedLobbyPreset,
  triggerQaQuickPairOpponent,
} from './lobbyClient';
import { createGameSocket } from './gameSocket';
import {
  ensureGuestSession,
  getCachedGuestSession,
  getOrCreateSession,
  MultiplayerApiError,
  resetGuestSessionCache,
  updateGuestName,
} from './sessionClient';
import {
  deckLabel,
  parsePlayerGameView,
  toM1GameView,
  type LobbyRoomSummary,
} from '../types/multiplayer';

// --- REST fixtures ---------------------------------------------------------

const wireView = {
  gameId: 'game-1',
  // The backend's wire casing; the client normalizes it.
  status: 'inProgress',
  config: { playerCount: 2, allowRedirect: true, turnTimeoutSeconds: 15, isPublic: true },
  viewerId: 'p0',
  viewerSeat: 0,
  hand: [{ suit: 'spades', rank: 'six' }],
  players: [
    {
      id: 'p0',
      name: 'Alice',
      rating: null,
      cardCount: 1,
      isConnected: true,
      hasPassed: false,
      finishRank: null,
      seatIndex: 0,
    },
  ],
  seats: [{ seatIndex: 0, playerId: 'p0', displayName: 'Alice', isConnected: true }],
  tablePairs: [],
  talonCount: 20,
  bottomTrumpCard: null,
  trumpSuit: 'spades',
  discardCount: 0,
  phase: 'initialAttack',
  attackerIdx: 0,
  defenderIdx: 1,
  maxBoutAttacks: 6,
  finishOrder: [],
  isDraw: false,
  durakId: null,
  turnDeadlineEpochMs: null,
};

const room: LobbyRoomSummary = {
  gameId: 'room-1',
  hostName: 'Guest-ABCD',
  playerCount: 2,
  filledSeats: 1,
  allowRedirect: true,
  turnTimeoutSeconds: 15,
  createdAtEpochMs: 1,
  isQuickPair: false,
};

function jsonResponse(
  body: unknown,
  init: { status?: number; ok?: boolean } = {},
): Response {
  const status = init.status ?? 200;
  return {
    ok: init.ok ?? (status >= 200 && status < 300),
    status,
    json: async () => body,
  } as unknown as Response;
}

const createRoomRequest = {
  playerCount: 2 as const,
  allowRedirect: true,
  turnTimeoutSeconds: 15,
  isPublic: true,
};

const jsonInit = (mock: ReturnType<typeof vi.fn>, call = 0): RequestInit =>
  mock.mock.calls[call][1] as RequestInit;

describe('sessionClient', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    // The shared guest loader memoizes; every test starts from a clean cache.
    resetGuestSessionCache();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    resetGuestSessionCache();
    vi.unstubAllGlobals();
  });

  it('fetches the guest session with the HttpOnly cookie attached', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ playerId: 'guest-1', displayName: 'Guest-ABCD', isGuest: true }),
    );

    await expect(getOrCreateSession()).resolves.toEqual({
      playerId: 'guest-1',
      displayName: 'Guest-ABCD',
      isGuest: true,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/session',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    // A bodyless GET must not pretend to send JSON.
    expect(jsonInit(mockFetch).headers).toBeUndefined();
  });

  it('renames the guest with a credentialed POST', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ playerId: 'guest-1', displayName: 'Zoe', isGuest: true }),
    );

    await expect(updateGuestName('Zoe')).resolves.toEqual({
      playerId: 'guest-1',
      displayName: 'Zoe',
      isGuest: true,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/session/name',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ displayName: 'Zoe' }),
      }),
    );
    expect(jsonInit(mockFetch).headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('surfaces structured HTTP errors', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ error: 'Room not found', code: 'ROOM_NOT_FOUND' }, { status: 404 }),
    );

    await expect(fetchGameView('missing')).rejects.toMatchObject({
      name: 'MultiplayerApiError',
      status: 404,
      code: 'ROOM_NOT_FOUND',
      message: 'Room not found',
    });
    await expect(fetchGameView('missing')).rejects.toBeInstanceOf(MultiplayerApiError);
  });

  it('falls back to the HTTP status when the error body is unusable', async () => {
    mockFetch.mockResolvedValue(jsonResponse(null, { status: 500, ok: false }));

    await expect(getOrCreateSession()).rejects.toMatchObject({
      status: 500,
      message: 'Request failed (HTTP 500)',
    });
  });

  it('T-90-2 ITEM-3: deduplicates concurrent guest-session loads', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ playerId: 'guest-1', displayName: 'Guest-AB12', isGuest: true }),
    );

    const [first, second] = await Promise.all([
      ensureGuestSession(),
      ensureGuestSession(),
    ]);

    expect(first).toEqual(second);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(getCachedGuestSession()?.displayName).toBe('Guest-AB12');

    // Every later caller reuses the cached session — the header and the lobby
    // never mint competing sessions.
    await expect(ensureGuestSession()).resolves.toEqual(first);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('T-90-2 ITEM-3: degrades to null when fetch is unavailable', async () => {
    vi.stubGlobal('fetch', undefined);

    await expect(ensureGuestSession()).resolves.toBeNull();
    expect(getCachedGuestSession()).toBeNull();
  });
});

describe('lobbyClient REST', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    // The shared guest loader memoizes; every test starts from a clean cache.
    resetGuestSessionCache();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    resetGuestSessionCache();
    vi.unstubAllGlobals();
  });

  it('loads the open lobby rooms, keeping an optional deck size', async () => {
    mockFetch.mockResolvedValue(jsonResponse([{ ...room, deckSize: 52 }]));

    await expect(fetchLobbyRooms()).resolves.toEqual([{ ...room, deckSize: 52 }]);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/lobby',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('creates a room and forwards the configuration', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ gameId: 'g1', seatIndex: 0, inviteUrl: '/g/g1' }),
    );

    await expect(createRoom(createRoomRequest)).resolves.toEqual({
      gameId: 'g1',
      seatIndex: 0,
      inviteUrl: '/g/g1',
    });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/games',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify(createRoomRequest),
      }),
    );
  });

  it('T-90-2 ITEM-7b: forwards the dev all-bot room contract and a null seat', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ gameId: 'g2', seatIndex: null, inviteUrl: '/g/g2', role: 'spectator' }),
    );
    const allBot = {
      ...createRoomRequest,
      playerCount: 4 as const,
      deckSize: 52 as const,
      seatTypes: ['randomBot', 'randomBot', 'basicBot', 'randomBot'] as const,
      creatorSeatIndex: null,
      spectateAsCreator: true,
    };

    await expect(createRoom({ ...allBot, seatTypes: [...allBot.seatTypes] })).resolves.toEqual({
      gameId: 'g2',
      seatIndex: null,
      inviteUrl: '/g/g2',
      role: 'spectator',
    });

    const sent = JSON.parse(jsonInit(mockFetch).body as string);
    expect(sent).toMatchObject({
      playerCount: 4,
      deckSize: 52,
      seatTypes: ['randomBot', 'randomBot', 'basicBot', 'randomBot'],
      creatorSeatIndex: null,
      spectateAsCreator: true,
    });
  });

  it('fetches a strictly filtered game view', async () => {
    mockFetch.mockResolvedValue(jsonResponse(wireView));

    const view = await fetchGameView('game/1');

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/games/game%2F1',
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(view.status).toBe('InProgress');
    expect(view.hand).toEqual([{ suit: 'spades', rank: 'six' }]);
    expect(view.viewerSeat).toBe(0);
  });

  it('joins a room and parses its projected view', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ gameId: 'game-1', seatIndex: 1, view: wireView }),
    );

    const joined = await joinRoom('game-1');

    expect(joined.gameId).toBe('game-1');
    expect(joined.seatIndex).toBe(1);
    expect(joined.view.gameId).toBe('game-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/games/game-1/join',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('leaves a room with a bodyless POST that tolerates 204 No Content', async () => {
    const json = vi.fn();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 204,
      json,
    } as unknown as Response);

    await expect(leaveRoom('game-1')).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/games/game-1/leave',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
    expect(json).not.toHaveBeenCalled();
  });

  it('parses the deferred Quick Pairing searching answer without a room', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        status: 'searching',
        playerCount: 3,
        turnTimeoutSeconds: 30,
        allowRedirect: false,
        queuedCount: 1,
        requiredCount: 3,
      }),
    );

    await expect(
      joinQuickPair({ playerCount: 3, turnTimeoutSeconds: 30, allowRedirect: false }),
    ).resolves.toEqual({
      status: 'searching',
      playerCount: 3,
      turnTimeoutSeconds: 30,
      allowRedirect: false,
      queuedCount: 1,
      requiredCount: 3,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/quick-pair',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          playerCount: 3,
          turnTimeoutSeconds: 30,
          allowRedirect: false,
        }),
      }),
    );
  });

  it('parses the matched Quick Pairing answer and cancels the queue', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ status: 'matched', gameId: 'pair-1', seatIndex: 1 }),
    );

    await expect(joinQuickPair({ playerCount: 2 })).resolves.toEqual({
      status: 'matched',
      gameId: 'pair-1',
      seatIndex: 1,
    });
    // T-90-2 ITEM-7b: the request may pin the deck size and the bot kind.
    await joinQuickPair({ playerCount: 4, deckSize: 52, botOpponent: 'basicBot' });
    expect(
      JSON.parse(jsonInit(mockFetch, mockFetch.mock.calls.length - 1).body as string),
    ).toMatchObject({ playerCount: 4, deckSize: 52, botOpponent: 'basicBot' });

    mockFetch.mockResolvedValue({ ok: true, status: 204, json: async () => null });
    await expect(cancelQuickPair()).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenLastCalledWith(
      '/api/quick-pair',
      expect.objectContaining({ method: 'DELETE', credentials: 'include' }),
    );
  });

  it('rejects a quick-pair answer without a known status', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ status: 'paused', gameId: 'pair-1', seatIndex: 0 }),
    );

    await expect(joinQuickPair({ playerCount: 2 })).rejects.toThrow(
      /unknown quick-pair status/i,
    );
  });

  it('covers every QA preset endpoint', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ rooms: [room] }));
    await expect(seedLobbyPreset()).resolves.toEqual({ rooms: [room] });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/qa/presets/seed-lobby',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );

    mockFetch.mockResolvedValue(jsonResponse({ gameId: 'active-1', seatIndex: 0 }));
    await expect(createActiveMatchPreset(3)).resolves.toEqual({
      gameId: 'active-1',
      seatIndex: 0,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/qa/presets/active-match',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ playerCount: 3 }),
      }),
    );

    mockFetch.mockResolvedValue(jsonResponse({ gameId: 'spec-1' }));
    await expect(createSpectatorMatchPreset()).resolves.toEqual({ gameId: 'spec-1' });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/qa/presets/spectator-match',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );

    mockFetch.mockResolvedValue(
      jsonResponse({ status: 'matched', gameId: 'qa-pair-1', seatIndex: 0 }),
    );
    await expect(triggerQaQuickPairOpponent()).resolves.toEqual({
      gameId: 'qa-pair-1',
      seatIndex: 0,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/qa/presets/quick-pair-opponent',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );

    mockFetch.mockResolvedValue(jsonResponse({ gameId: 'small-1', seatIndex: 0, handSize: 4 }));
    await expect(launchQaSmallHandMatch()).resolves.toEqual({
      gameId: 'small-1',
      seatIndex: 0,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/qa/presets/active-match',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ playerCount: 2, handSize: 4 }),
      }),
    );
  });
});

// --- WebSocket fixtures ----------------------------------------------------

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = MockWebSocket.OPEN;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  emitOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  emitMessage(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  emitRaw(data: string): void {
    this.onmessage?.({ data });
  }

  emitClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

const latest = (): MockWebSocket => MockWebSocket.instances[MockWebSocket.instances.length - 1];
const host = () => window.location.host;

describe('connectLobbySocket', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('opens /ws/lobby and dispatches snapshots, updates and matches', () => {
    const snapshots: LobbyRoomSummary[][] = [];
    const updates: LobbyRoomSummary[][] = [];
    const matched: string[] = [];
    const quickPaired: { gameId: string; seatIndex: number }[] = [];
    const socket = connectLobbySocket({
      onSnapshot: (rooms) => snapshots.push(rooms),
      onUpdated: (rooms) => updates.push(rooms),
      onMatchFound: (gameId) => matched.push(gameId),
      onQuickPairMatched: (gameId, seatIndex) => quickPaired.push({ gameId, seatIndex }),
    });

    const ws = latest();
    expect(ws.url).toBe(`ws://${host()}/ws/lobby`);

    ws.emitOpen();
    expect(socket.status).toBe('connected');

    ws.emitMessage({ type: 'lobbySnapshot', rooms: [room] });
    ws.emitMessage({ type: 'lobbyUpdated', rooms: [] });
    ws.emitMessage({ type: 'matchFound', gameId: 'assigned-1' });
    ws.emitMessage({ type: 'quickPairMatched', gameId: 'qp-9', seatIndex: 1 });

    expect(snapshots).toEqual([[room]]);
    expect(updates).toEqual([[]]);
    expect(matched).toEqual(['assigned-1']);
    expect(quickPaired).toEqual([{ gameId: 'qp-9', seatIndex: 1 }]);

    socket.close();
  });

  it('ignores malformed and unrelated frames', () => {
    const snapshots: LobbyRoomSummary[][] = [];
    const socket = connectLobbySocket({ onSnapshot: (rooms) => snapshots.push(rooms) });
    const ws = latest();

    expect(() => {
      ws.emitRaw('{not json');
      ws.emitMessage({ type: 'unknown' });
      ws.emitMessage({ type: 'pong' });
      ws.emitMessage({ type: 'lobbySnapshot', rooms: 'nope' });
      ws.emitMessage({ type: 'quickPairMatched', seatIndex: 0 });
    }).not.toThrow();
    expect(snapshots).toEqual([]);

    socket.close();
  });

  it('reconnects with capped exponential backoff', () => {
    const socket = connectLobbySocket();
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(socket.status).toBe('connecting');

    latest().emitClose();
    expect(socket.status).toBe('reconnecting');
    vi.advanceTimersByTime(499);
    expect(MockWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(2);

    latest().emitClose();
    vi.advanceTimersByTime(999);
    expect(MockWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(3);

    latest().emitClose();
    vi.advanceTimersByTime(2000);
    expect(MockWebSocket.instances).toHaveLength(4);

    latest().emitClose();
    vi.advanceTimersByTime(4000);
    expect(MockWebSocket.instances).toHaveLength(5);

    // The delay is capped at 5s, not 8s.
    latest().emitClose();
    vi.advanceTimersByTime(4999);
    expect(MockWebSocket.instances).toHaveLength(5);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(6);

    socket.close();
  });

  it('resets the retry budget after a successful open', () => {
    const socket = connectLobbySocket();

    latest().emitClose();
    vi.advanceTimersByTime(500);
    latest().emitClose();
    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances).toHaveLength(3);

    // A working connection restarts the backoff at 500ms.
    latest().emitOpen();
    latest().emitClose();
    vi.advanceTimersByTime(500);
    expect(MockWebSocket.instances).toHaveLength(4);

    socket.close();
  });

  it('close() cancels the pending reconnect and reports disconnected', () => {
    const statuses: string[] = [];
    const socket = connectLobbySocket({ onStatusChange: (status) => statuses.push(status) });
    latest().emitOpen();
    latest().emitClose();

    socket.close();

    expect(socket.status).toBe('disconnected');
    expect(statuses).toContain('disconnected');
    vi.advanceTimersByTime(30_000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});

describe('createGameSocket', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('opens the encoded per-game socket URL', () => {
    const socket = createGameSocket('game/1', {});

    expect(latest().url).toBe(`ws://${host()}/ws/games/game%2F1`);
    expect(socket.status).toBe('connecting');

    socket.dispose();
  });

  it('parses projected views and action rejections', () => {
    const views: unknown[] = [];
    const rejections: { code: string; message: string }[] = [];
    const socket = createGameSocket('game-1', {
      onView: (view) => views.push(view),
      onActionRejected: (code, message) => rejections.push({ code, message }),
    });

    latest().emitOpen();
    latest().emitMessage({ type: 'gameViewUpdate', view: wireView });
    latest().emitMessage({
      type: 'actionRejected',
      code: 'ILLEGAL_MOVE',
      message: 'Cannot cover that card',
    });

    expect(views).toHaveLength(1);
    expect((views[0] as { status: string; hand: unknown[] }).status).toBe('InProgress');
    expect((views[0] as { hand: unknown[] }).hand).toEqual([{ suit: 'spades', rank: 'six' }]);
    expect(rejections).toEqual([
      { code: 'ILLEGAL_MOVE', message: 'Cannot cover that card' },
    ]);

    socket.dispose();
  });

  it('ignores malformed frames, pongs and lobby frames', () => {
    const views: unknown[] = [];
    const socket = createGameSocket('game-1', { onView: (view) => views.push(view) });

    expect(() => {
      latest().emitRaw('nope');
      latest().emitMessage({ type: 'pong' });
      latest().emitMessage({ type: 'lobbySnapshot', rooms: [] });
      latest().emitMessage({ type: 'gameViewUpdate', view: { gameId: 'x' } });
    }).not.toThrow();
    expect(views).toEqual([]);

    socket.dispose();
  });

  it('sends typed action frames only while open', () => {
    const socket = createGameSocket('game-1', {});
    const ws = latest();
    ws.emitOpen();

    socket.sendAction({ type: 'passTurn' });
    socket.sendAction({
      type: 'coverCard',
      attackIndex: 0,
      defenseCard: { suit: 'hearts', rank: 'ace' },
    });

    expect(ws.sent).toEqual([
      JSON.stringify({ type: 'passTurn' }),
      JSON.stringify({
        type: 'coverCard',
        attackIndex: 0,
        defenseCard: { suit: 'hearts', rank: 'ace' },
      }),
    ]);

    ws.readyState = MockWebSocket.CLOSED;
    socket.sendAction({ type: 'ping' });
    expect(ws.sent).toHaveLength(2);

    socket.dispose();
  });

  it('pings every 20s while connected and stops on dispose', () => {
    const socket = createGameSocket('game-1', {});
    latest().emitOpen();

    vi.advanceTimersByTime(19_999);
    expect(latest().sent).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(latest().sent).toEqual([JSON.stringify({ type: 'ping' })]);

    socket.dispose();
    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances[0].sent).toHaveLength(1);
  });

  it('reconnects after an unexpected close with capped backoff', () => {
    const socket = createGameSocket('game-1', {});

    latest().emitClose();
    expect(socket.status).toBe('reconnecting');
    vi.advanceTimersByTime(500);
    expect(MockWebSocket.instances).toHaveLength(2);
    latest().emitOpen();
    expect(socket.status).toBe('connected');

    latest().emitClose();
    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances).toHaveLength(3);

    socket.dispose();
  });

  it('dispose() closes cleanly and never reconnects or reports later', () => {
    const statuses: string[] = [];
    const socket = createGameSocket('game-1', {
      onStatusChange: (status) => statuses.push(status),
    });
    latest().emitOpen();

    socket.dispose();

    expect(socket.status).toBe('disconnected');
    expect(statuses[statuses.length - 1]).toBe('disconnected');
    vi.advanceTimersByTime(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('T-90: translates every M1 action into its protocol frame', () => {
    const socket = createGameSocket('game-1', {});
    const ws = latest();
    ws.emitOpen();

    const card = { suit: 'spades', rank: 'six' };
    const defenseCard = { suit: 'hearts', rank: 'ace' };

    socket.sendGameAction({ type: 'initialAttack', playerId: 'p0', cards: [card] });
    socket.sendGameAction({ type: 'coverCard', playerId: 'p0', attackIndex: 1, defenseCard });
    socket.sendGameAction({ type: 'redirectAttack', playerId: 'p0', cards: [card] });
    socket.sendGameAction({ type: 'throwInCards', playerId: 'p0', cards: [card] });
    socket.sendGameAction({ type: 'declareSurrender', playerId: 'p0' });
    socket.sendGameAction({ type: 'passTurn', playerId: 'p0' });

    expect(ws.sent).toEqual([
      JSON.stringify({ type: 'playAttack', cards: [card] }),
      JSON.stringify({ type: 'coverCard', attackIndex: 1, defenseCard }),
      JSON.stringify({ type: 'redirectAttack', cards: [card] }),
      JSON.stringify({ type: 'throwInCards', cards: [card] }),
      JSON.stringify({ type: 'declareSurrender' }),
      JSON.stringify({ type: 'passTurn' }),
    ]);

    // An action the protocol does not carry is dropped, never mislabelled.
    socket.sendGameAction({ type: 'unsupported', playerId: 'p0' });
    expect(ws.sent).toHaveLength(6);

    socket.dispose();
  });
});

describe('T-90 multiplayer view adapter', () => {
  const twoPlayerWire = {
    ...wireView,
    boutPhase: 'defense',
    turnDeadlineMs: 1234,
    durak: 'p1',
    legalActions: ['cover', 'surrender'],
    winners: ['p1'],
    finishOrder: ['p1', 'p0'],
    throwInCards: [{ suit: 'clubs', rank: 'seven' }],
    throwInCapacity: 2,
    canThrowIn: true,
    myFinishRank: 2,
    lastDiscardCards: [{ suit: 'hearts', rank: 'king' }],
    defenderDefenseless: true,
    eligibleTargetIds: ['p1'],
    redirectTargetId: 'p1',
    gameStartedAtMs: 1000,
    gameEndedAtMs: null,
    players: [
      {
        id: 'p0',
        name: 'Alice',
        rating: null,
        cardCount: 1,
        isConnected: true,
        hasPassed: false,
        finishRank: null,
        seatIndex: 0,
        status: 'active',
        isTurn: false,
      },
      {
        id: 'p1',
        name: 'Bob',
        rating: null,
        cardCount: 6,
        isConnected: true,
        hasPassed: false,
        finishRank: 1,
        seatIndex: 1,
        status: 'out',
        isTurn: false,
      },
    ],
  };

  it('parses the enriched Wave-1 projection', () => {
    const view = parsePlayerGameView(twoPlayerWire);

    expect(view.phase).toBe('defense');
    expect(view.turnDeadlineEpochMs).toBe(1234);
    expect(view.durakId).toBe('p1');
    expect(view.legalActions).toEqual(['cover', 'surrender']);
    expect(view.winners).toEqual(['p1']);
    expect(view.throwInCards).toHaveLength(1);
    expect(view.throwInCapacity).toBe(2);
    expect(view.canThrowIn).toBe(true);
    expect(view.myFinishRank).toBe(2);
    expect(view.lastDiscardCards).toHaveLength(1);
    expect(view.defenderDefenseless).toBe(true);
    expect(view.redirectTargetId).toBe('p1');
    expect(view.gameStartedAtMs).toBe(1000);
    expect(view.players[1].status).toBe('out');
  });

  it('T-96: keeps the room deck size and labels 2P/3P 52-card tables correctly', () => {
    const threePlayer52 = parsePlayerGameView({
      ...wireView,
      config: { ...wireView.config, playerCount: 3, deckSize: 52 },
    });
    expect(threePlayer52.config.deckSize).toBe(52);
    expect(deckLabel(threePlayer52.config.playerCount, threePlayer52.config.deckSize)).toBe(
      '52-card',
    );

    const twoPlayer36 = parsePlayerGameView({
      ...wireView,
      config: { ...wireView.config, playerCount: 2, deckSize: 36 },
    });
    expect(deckLabel(twoPlayer36.config.playerCount, twoPlayer36.config.deckSize)).toBe(
      '36-card',
    );

    // Older payloads omit the deck setting: the player count decides.
    const threePlayerDefault = parsePlayerGameView({
      ...wireView,
      config: { playerCount: 3 },
    });
    expect(threePlayerDefault.config.deckSize).toBe(36);

    const fourPlayerDefault = parsePlayerGameView({
      ...wireView,
      config: { playerCount: 4 },
    });
    expect(fourPlayerDefault.config.deckSize).toBe(52);
    expect(deckLabel(4)).toBe('52-card');
    expect(deckLabel(2, 52)).toBe('52-card');
  });

  it('re-keys seats to the M1 p<seat> ids and keeps opponent hands hidden', () => {
    const m1 = toM1GameView(parsePlayerGameView(twoPlayerWire));

    expect(m1.myId).toBe('p0');
    expect(m1.myName).toBe('Alice');
    expect(m1.myHand).toEqual([{ suit: 'spades', rank: 'six' }]);
    expect(m1.opponents).toEqual([
      {
        id: 'p1',
        name: 'Bob',
        cardCount: 6,
        hasPassed: false,
        finishRank: 1,
        isPresent: true,
      },
    ]);
    // Opponent summaries never carry a `cards` field.
    expect(m1.opponents[0]).not.toHaveProperty('cards');
    expect(m1.finishOrder).toEqual(['p1', 'p0']);
    expect(m1.winners).toEqual(['p1']);
    expect(m1.durak).toBe('p1');
    expect(m1.redirectTargetId).toBe('p1');
    expect(m1.eligibleTargetIds).toEqual(['p1']);
    expect(m1.turnDeadlineMs).toBe(1234);
    expect(m1.legalActions).toEqual(['cover', 'surrender']);
    expect(m1.presentPlayers).toEqual(['p0', 'p1']);
  });

  it('maps a spectator to the same table with an empty hand and no moves', () => {
    const spectator = parsePlayerGameView({
      ...twoPlayerWire,
      viewerSeat: null,
      hand: [],
      legalActions: [],
      throwInCards: [],
      eligibleTargetIds: [],
      redirectTargetId: null,
    });

    const m1 = toM1GameView(spectator);

    expect(m1.myId).toBe('spectator');
    expect(m1.myHand).toEqual([]);
    expect(m1.legalActions).toEqual([]);
    expect(m1.canThrowIn).toBe(true);
    expect(m1.opponents.map((opponent) => opponent.id)).toEqual(['p0', 'p1']);
    expect(m1.opponents.every((opponent) => !('cards' in opponent))).toBe(true);
  });
});
