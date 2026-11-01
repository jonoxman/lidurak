import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameWebSocket } from '../api/websocket';
import type { PlayerGameView } from '../types';

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = MockWebSocket.OPEN;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
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

  emitRawMessage(data: string): void {
    this.onmessage?.({ data });
  }

  emitClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

const latest = (): MockWebSocket => MockWebSocket.instances[MockWebSocket.instances.length - 1];

const view: PlayerGameView = {
  myId: 'p0',
  myHand: [{ suit: 'spades', rank: 'six' }],
  opponents: [{ id: 'p1', name: 'Bob', cardCount: 3, hasPassed: false, finishRank: null }],
  tablePairs: [{ attack: { suit: 'spades', rank: 'six' }, defense: null }],
  talonCount: 20,
  bottomTrumpCard: null,
  trumpSuit: 'spades',
  attackerIdx: 0,
  defenderIdx: 1,
  boutPhase: 'defense',
  legalActions: ['cover'],
  finishOrder: [],
  isDraw: false,
  maxBoutAttacks: 6,
};

describe('GameWebSocket', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('connects to the game websocket URL for the viewer', () => {
    const socket = new GameWebSocket('game-1', 'p1', () => {});
    socket.connect();

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(latest().url).toMatch(/^ws:\/\/.+\/ws\/game\/game-1\/p1$/);
  });

  it('calls onStateUpdate when a valid view arrives', () => {
    const updates: PlayerGameView[] = [];
    const socket = new GameWebSocket('game-1', 'p0', (next) => updates.push(next));
    socket.connect();

    latest().emitMessage(view);

    expect(updates).toHaveLength(1);
    expect(updates[0].myId).toBe('p0');
    expect(updates[0].tablePairs).toHaveLength(1);
  });

  it('ignores malformed messages', () => {
    const updates: PlayerGameView[] = [];
    const socket = new GameWebSocket('game-1', 'p0', (next) => updates.push(next));
    socket.connect();

    latest().emitRawMessage('not json');
    latest().emitMessage({ myId: 'p0' });

    expect(updates).toHaveLength(0);
  });

  it('serializes actions as GameAction JSON', () => {
    const socket = new GameWebSocket('game-1', 'p0', () => {});
    socket.connect();

    socket.sendAction({ type: 'coverCard', playerId: 'p0', attackIndex: 0, defenseCard: view.myHand[0] });

    expect(latest().sent).toEqual([
      JSON.stringify({
        type: 'coverCard',
        playerId: 'p0',
        attackIndex: 0,
        defenseCard: { suit: 'spades', rank: 'six' },
      }),
    ]);
  });

  it('pings every 20 seconds while the socket is open', () => {
    const socket = new GameWebSocket('game-1', 'p0', () => {});
    socket.connect();
    const ws = latest();
    ws.emitOpen();

    vi.advanceTimersByTime(19_999);
    expect(ws.sent).toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(ws.sent).toEqual([JSON.stringify({ type: 'ping' })]);

    vi.advanceTimersByTime(20_000);
    expect(ws.sent).toHaveLength(2);

    socket.disconnect();
    vi.advanceTimersByTime(60_000);
    expect(ws.sent).toHaveLength(2);
  });

  it('stops the keepalive when the connection drops', () => {
    const socket = new GameWebSocket('game-1', 'p0', () => {});
    socket.connect();
    const ws = latest();
    ws.emitOpen();

    vi.advanceTimersByTime(20_000);
    expect(ws.sent).toHaveLength(1);

    ws.emitClose();
    vi.advanceTimersByTime(60_000);

    expect(ws.sent).toHaveLength(1);
  });

  it('ignores server control frames without emitting a state update', () => {
    const updates: PlayerGameView[] = [];
    const socket = new GameWebSocket('game-1', 'p0', (next) => updates.push(next));
    socket.connect();

    latest().emitMessage({ type: 'pong' });
    latest().emitMessage({ type: 'ping' });
    latest().emitRawMessage('');
    latest().emitMessage({});

    expect(updates).toHaveLength(0);
  });

  it('sends presence once connected and remembers it across reconnects', () => {
    const socket = new GameWebSocket('game-1', 'p0', () => {});
    socket.connect();
    const ws = latest();
    ws.readyState = MockWebSocket.CONNECTING;

    socket.sendPresence(false);
    expect(ws.sent).toHaveLength(0);

    ws.emitOpen();
    expect(ws.sent).toEqual([JSON.stringify({ type: 'presence', isPresent: false })]);

    socket.sendPresence(true);
    expect(ws.sent[1]).toBe(JSON.stringify({ type: 'presence', isPresent: true }));
  });

  it('does not send presence while the socket is closed', () => {
    const socket = new GameWebSocket('game-1', 'p0', () => {});
    socket.connect();
    const ws = latest();
    ws.readyState = MockWebSocket.CLOSED;

    socket.sendPresence(true);

    expect(ws.sent).toHaveLength(0);
  });

  it('does not send while the socket is closed', () => {
    const socket = new GameWebSocket('game-1', 'p0', () => {});
    socket.connect();
    latest().readyState = MockWebSocket.CLOSED;

    socket.sendAction({ type: 'passTurn', playerId: 'p0' });

    expect(latest().sent).toHaveLength(0);
  });

  it('reconnects after a dropped connection with exponential backoff', () => {
    const socket = new GameWebSocket('game-1', 'p0', () => {});
    socket.connect();

    latest().emitClose();
    expect(MockWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(latest().url).toContain('/ws/game/game-1/p0');
  });

  it('backs off 1s, 2s, then 4s and stops after three retries', () => {
    const socket = new GameWebSocket('game-1', 'p0', () => {});
    socket.connect();

    latest().emitClose();
    vi.advanceTimersByTime(999);
    expect(MockWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(2);

    latest().emitClose();
    vi.advanceTimersByTime(1999);
    expect(MockWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(3);

    latest().emitClose();
    vi.advanceTimersByTime(3999);
    expect(MockWebSocket.instances).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(4);

    latest().emitClose();
    vi.advanceTimersByTime(8000);
    // One initial connection plus at most three retries.
    expect(MockWebSocket.instances).toHaveLength(4);
  });

  it('reopens a closed socket when connect() is called again', () => {
    const socket = new GameWebSocket('game-1', 'p0', () => {});
    socket.connect();

    latest().readyState = MockWebSocket.CLOSED;
    socket.connect();

    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('resets the retry budget when connect() is called after giving up', () => {
    const socket = new GameWebSocket('game-1', 'p0', () => {});
    socket.connect();

    // Exhaust all three retries, then drop the last socket too.
    latest().emitClose();
    vi.advanceTimersByTime(1000);
    latest().emitClose();
    vi.advanceTimersByTime(2000);
    latest().emitClose();
    vi.advanceTimersByTime(4000);
    latest().emitClose();
    vi.advanceTimersByTime(10000);
    expect(MockWebSocket.instances).toHaveLength(4);

    socket.connect();
    expect(MockWebSocket.instances).toHaveLength(5);
  });

  it('ignores a stale socket closing after a manual reconnect', () => {
    const socket = new GameWebSocket('game-1', 'p0', () => {});
    socket.connect();

    const stale = latest();
    stale.readyState = MockWebSocket.CLOSED;
    socket.connect();
    expect(MockWebSocket.instances).toHaveLength(2);

    // The replaced socket reports its close late; it must not reconnect again.
    stale.emitClose();
    vi.advanceTimersByTime(30000);

    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('does not open a second socket while one is connecting', () => {
    const socket = new GameWebSocket('game-1', 'p0', () => {});
    socket.connect();

    latest().readyState = MockWebSocket.CONNECTING;
    socket.connect();

    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('encodes game and player ids in the socket URL', () => {
    new GameWebSocket('game/1', 'p#0', () => {}).connect();

    expect(latest().url).toContain('/ws/game/game%2F1/p%230');
  });

  it('does not reconnect after disconnect()', () => {
    const socket = new GameWebSocket('game-1', 'p0', () => {});
    socket.connect();
    socket.disconnect();

    vi.advanceTimersByTime(30000);

    expect(MockWebSocket.instances).toHaveLength(1);
  });
});
