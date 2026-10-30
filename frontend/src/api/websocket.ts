import { parsePlayerGameView, type GameAction, type PlayerGameView } from '../types';

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

  isOpen(): boolean {
    return this.socket != null && this.socket.readyState === WebSocket.OPEN;
  }

  disconnect(): void {
    this.closedByUser = true;
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

    socket.onmessage = (event: MessageEvent) => {
      try {
        const view = parsePlayerGameView(JSON.parse(String(event.data)));
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
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      // The browser closes the socket after an error; `onclose` handles retries.
    };
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
