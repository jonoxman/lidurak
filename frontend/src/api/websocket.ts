import { parsePlayerGameView, type GameAction, type PlayerGameView } from '../types';

/** Keeps the connection busy well inside the server's 60-second idle timeout. */
const KEEPALIVE_INTERVAL_MS = 20_000;

/**
 * True for server control frames (`pong`, bare `ping`, or anything that is not
 * a game view projection), which must never reach the UI as state.
 */
function isControlFrame(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return true;
  const record = value as Record<string, unknown>;
  if (record.type === 'pong' || record.type === 'ping') return true;
  return !('myId' in record) || !('boutPhase' in record);
}

/**
 * Live connection to a game room. Incoming JSON is validated into a
 * `PlayerGameView` before it reaches the UI, and a dropped connection is
 * retried up to three times with exponential backoff.
 */
export class GameWebSocket {
  private socket: WebSocket | null = null;
  private retries = 0;
  private closedByUser = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private presence: boolean | null = null;
  private readonly maxRetries = 3;

  constructor(
    private readonly gameId: string,
    private readonly playerId: string,
    private readonly onStateUpdate: (view: PlayerGameView) => void,
  ) {}

  connect(): void {
    this.closedByUser = false;
    // An explicit connect starts a fresh backoff budget, so a caller can still
    // reconnect after auto-reconnect has exhausted its retries.
    this.retries = 0;
    if (this.reconnectTimer != null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    if (
      socket != null &&
      (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    this.socket = null;
    this.open();
  }

  sendAction(action: GameAction): void {
    if (this.isOpen()) {
      this.socket!.send(JSON.stringify(action));
    }
  }

  /**
   * Tells the server whether this seat's tab is focused/visible. The latest
   * value is remembered so a reconnect reports the right presence again.
   */
  sendPresence(isPresent: boolean): void {
    this.presence = isPresent;
    this.sendPresenceFrame();
  }

  isOpen(): boolean {
    return this.socket != null && this.socket.readyState === WebSocket.OPEN;
  }

  disconnect(): void {
    this.closedByUser = true;
    this.stopKeepalive();
    if (this.reconnectTimer != null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    if (socket != null) {
      socket.close();
    }
  }

  private open(): void {
    const host = typeof location === 'undefined' ? 'localhost:8080' : location.host;
    const scheme =
      typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss:' : 'ws:';
    const gameId = encodeURIComponent(this.gameId);
    const playerId = encodeURIComponent(this.playerId);
    const socket = new WebSocket(`${scheme}//${host}/ws/game/${gameId}/${playerId}`);
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.startKeepalive();
      // Report the presence state set before the socket finished connecting.
      this.sendPresenceFrame();
    };

    socket.onmessage = (event: MessageEvent) => {
      try {
        const parsed: unknown = JSON.parse(String(event.data));
        if (isControlFrame(parsed)) return;
        const view = parsePlayerGameView(parsed);
        // A working connection resets the backoff budget.
        this.retries = 0;
        this.onStateUpdate(view);
      } catch {
        // Ignore frames that are not valid game views.
      }
    };

    socket.onclose = () => {
      // Ignore closes from sockets that a newer connect()/disconnect() replaced,
      // otherwise the stale socket schedules a duplicate reconnect.
      if (this.socket !== socket) return;
      this.socket = null;
      this.stopKeepalive();
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      // The browser closes the socket after an error; `onclose` handles retries.
    };
  }

  private sendPresenceFrame(): void {
    if (this.presence === null || !this.isOpen()) return;
    this.socket!.send(JSON.stringify({ type: 'presence', isPresent: this.presence }));
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      if (this.isOpen()) this.socket!.send(JSON.stringify({ type: 'ping' }));
    }, KEEPALIVE_INTERVAL_MS);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer != null) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.closedByUser || this.retries >= this.maxRetries) return;
    const delay = 1000 * 2 ** this.retries;
    this.retries += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closedByUser) this.open();
    }, delay);
  }
}
