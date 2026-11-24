import {
  parseWsServerMessage,
  toWsClientMessage,
  type PlayerGameView,
  type SocketStatus,
  type WsClientMessage,
} from '../types/multiplayer';
import type { GameAction } from '../types';

/** First retry delay; each further failure doubles it. */
const RECONNECT_BASE_DELAY_MS = 500;

/** Retry delay ceiling, so a long outage never waits longer than this. */
const RECONNECT_MAX_DELAY_MS = 5000;

/** Keeps the socket inside the server's idle timeout. */
const KEEPALIVE_INTERVAL_MS = 20_000;

export interface GameSocketHandlers {
  /** A fresh strictly-projected view for this viewer. */
  onView?: (view: PlayerGameView) => void;
  /** The server refused the last action (illegal move, not your turn, …). */
  onActionRejected?: (code: string, message: string) => void;
  onStatusChange?: (status: SocketStatus) => void;
  onError?: (event: unknown) => void;
}

export interface GameSocket {
  readonly status: SocketStatus;
  /** Sends one typed protocol frame when the socket is open. */
  sendAction(message: WsClientMessage): void;
  /** Closes the socket and cancels every pending reconnect timer. */
  dispose(): void;
}

/** Builds a `ws:`/`wss:` URL relative to the page host, so the Vite proxy works. */
function gameSocketUrl(gameId: string): string {
  const host = typeof location === 'undefined' ? 'localhost:8080' : location.host;
  const scheme =
    typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${host}/ws/games/${encodeURIComponent(gameId)}`;
}

class ReconnectingGameSocket implements GameSocket {
  status: SocketStatus = 'connecting';

  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private attempts = 0;
  private disposed = false;

  constructor(
    private readonly gameId: string,
    private readonly handlers: GameSocketHandlers,
  ) {
    this.open();
  }

  sendAction(message: WsClientMessage): void {
    const socket = this.socket;
    if (socket === null || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(message));
  }

  dispose(): void {
    this.disposed = true;
    this.clearReconnectTimer();
    this.stopKeepalive();

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
    if (this.disposed) return;

    const socket = new WebSocket(gameSocketUrl(this.gameId));
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.attempts = 0;
      this.setStatus('connected');
      this.startKeepalive();
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
      this.stopKeepalive();
      this.scheduleReconnect();
    };
  }

  private handleMessage(data: unknown): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(data));
    } catch {
      // A non-JSON frame must never crash the socket callbacks.
      return;
    }

    let message;
    try {
      message = parseWsServerMessage(parsed);
    } catch {
      return;
    }

    switch (message.type) {
      case 'gameViewUpdate':
        this.handlers.onView?.(message.view);
        break;
      case 'actionRejected':
        this.handlers.onActionRejected?.(message.code, message.message);
        break;
      default:
        // Lobby frames and pongs are not game state; ignore them here.
        break;
    }
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      this.sendAction({ type: 'ping' });
    }, KEEPALIVE_INTERVAL_MS);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer !== null) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;

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

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setStatus(status: SocketStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.handlers.onStatusChange?.(status);
  }
}

/**
 * Sends one Milestone 1 `GameAction` over the live room socket, translating it
 * into the multiplayer wire frame the server expects. Returns `false` for an
 * action the room protocol does not support.
 */
export function sendGameAction(socket: GameSocket, action: GameAction): boolean {
  const message = toWsClientMessage(action);
  if (message == null) return false;
  socket.sendAction(message);
  return true;
}

/**
 * Opens `/ws/games/:gameId` immediately and keeps it alive.
 *
 * Unexpected closes are retried with capped exponential backoff (`500ms` →
 * `5s`); a successful open resets the budget, and `dispose()` stops both the
 * socket and any pending reconnect.
 */
export function createGameSocket(
  gameId: string,
  handlers: GameSocketHandlers = {},
): GameSocket {
  return new ReconnectingGameSocket(gameId, handlers);
}
