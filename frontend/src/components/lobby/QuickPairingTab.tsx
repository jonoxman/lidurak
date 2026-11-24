import { useEffect, useRef, useState } from 'preact/hooks';
import {
  cancelQuickPair,
  connectLobbySocket,
  joinQuickPair,
  type LobbySocket,
} from '../../api/lobbyClient';
import type { PlayerCount, QuickPairRequest } from '../../types/multiplayer';

/** The six Lichess-style Quick Pairing presets, all with redirects enabled. */
export const QUICK_PAIR_PRESETS: ReadonlyArray<QuickPairRequest & { playerCount: PlayerCount }> = [
  { playerCount: 2, turnTimeoutSeconds: 15, allowRedirect: true },
  { playerCount: 2, turnTimeoutSeconds: 30, allowRedirect: true },
  { playerCount: 3, turnTimeoutSeconds: 15, allowRedirect: true },
  { playerCount: 3, turnTimeoutSeconds: 30, allowRedirect: true },
  { playerCount: 4, turnTimeoutSeconds: 15, allowRedirect: true },
  { playerCount: 4, turnTimeoutSeconds: 30, allowRedirect: true },
];

export interface QuickPairingTabProps {
  /** Opens `/g/:gameId` once the player has a seat. */
  onMatched: (gameId: string) => void;
}

const DECK_FOR_PLAYERS: Record<PlayerCount, string> = {
  2: '36-card',
  3: '36-card',
  4: '52-card',
};

/**
 * Quick Pairing: pick a table size and turn clock and wait in the server's
 * pairing queue.
 *
 * No room exists until `playerCount` players ask for the same preset, so the
 * tab stays on the lobby showing the searching state (with a Cancel action)
 * and only opens `/g/:gameId` when the server announces `matchFound` over
 * `/ws/lobby`. A queued player is never stuck without a way out.
 */
export function QuickPairingTab({ onMatched }: QuickPairingTabProps) {
  const [pending, setPending] = useState<QuickPairRequest | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Bumped by Cancel, so a late match response cannot navigate after cancel.
  const attempt = useRef(0);
  // True only once the server confirmed the player is in the queue.
  const queued = useRef(false);
  const socket = useRef<LobbySocket | null>(null);

  const closeSocket = () => {
    socket.current?.close();
    socket.current = null;
  };

  /** Returns the tab to idle without navigating. */
  const leaveQueue = () => {
    attempt.current += 1;
    queued.current = false;
    closeSocket();
    setPending(null);
    setWaiting(0);
  };

  const openMatchedGame = (gameId: string) => {
    leaveQueue();
    onMatched(gameId);
  };

  /**
   * Re-reads the queue once the socket is connected. It catches a match that
   * landed in the window between the POST and the socket subscription.
   */
  const recheck = async (preset: QuickPairRequest, current: number) => {
    try {
      const status = await joinQuickPair(preset);
      if (attempt.current !== current) return;
      if (status.status === 'matched' && status.gameId) openMatchedGame(status.gameId);
      else setWaiting(status.waiting);
    } catch {
      // Keep waiting: the socket may still deliver the match.
    }
  };

  const start = async (preset: QuickPairRequest) => {
    if (pending) return;
    const current = ++attempt.current;
    setPending(preset);
    setWaiting(0);
    setError(null);

    // Listen before queueing, so a match cannot be missed while the POST is in
    // flight.
    closeSocket();
    socket.current = connectLobbySocket({
      onMatchFound: (gameId) => {
        if (attempt.current === current) openMatchedGame(gameId);
      },
      onStatusChange: (status) => {
        if (status === 'connected' && queued.current && attempt.current === current) {
          void recheck(preset, current);
        }
      },
    });

    try {
      const reply = await joinQuickPair(preset);
      if (attempt.current !== current) return;
      if (reply.status === 'matched' && reply.gameId) {
        openMatchedGame(reply.gameId);
        return;
      }
      queued.current = true;
      setWaiting(reply.waiting);
    } catch (reason) {
      if (attempt.current !== current) return;
      leaveQueue();
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const cancel = () => {
    leaveQueue();
    void cancelQuickPair().catch(() => {
      // A cancel that fails only means the queue entry was already gone.
    });
  };

  // Leaving the tab or the lobby must not hold a queue slot for nobody.
  useEffect(
    () => () => {
      const wasWaiting = queued.current;
      attempt.current += 1;
      queued.current = false;
      closeSocket();
      if (wasWaiting) {
        void cancelQuickPair().catch(() => {
          // The queue entry is already gone.
        });
      }
    },
    [],
  );

  return (
    <section class="m2-panel quick-pair" aria-label="Quick Pairing">
      <h2 class="m2-panel-title">Quick Pairing</h2>
      <p class="m2-panel-hint">
        Redirects are on for every table. Pick a size and clock to be matched with
        players asking for the same preset.
      </p>

      {pending ? (
        <div class="quick-pair-searching" data-testid="quick-pair-searching" role="status">
          <span class="quick-pair-spinner" aria-hidden="true" />
          <span>
            Searching for a {pending.playerCount}P • {pending.turnTimeoutSeconds}s table…
          </span>
          {waiting > 0 ? (
            <span class="quick-pair-queue-count" data-testid="quick-pair-queue-count">
              {Math.min(waiting, pending.playerCount)} / {pending.playerCount} queued
            </span>
          ) : null}
          <button type="button" class="m2-button secondary" onClick={cancel}>
            Cancel
          </button>
        </div>
      ) : null}

      <div class="quick-pair-grid">
        {QUICK_PAIR_PRESETS.map((preset) => (
          <button
            key={`${preset.playerCount}-${preset.turnTimeoutSeconds}`}
            type="button"
            class="quick-pair-tile"
            data-testid={`quick-pair-${preset.playerCount}-${preset.turnTimeoutSeconds}`}
            disabled={pending !== null}
            onClick={() => void start(preset)}
          >
            <span class="quick-pair-tile-title">
              {preset.playerCount}P • {preset.turnTimeoutSeconds}s
            </span>
            <span class="quick-pair-tile-meta">
              {DECK_FOR_PLAYERS[preset.playerCount]} • Redirect ON
            </span>
          </button>
        ))}
      </div>

      {error ? (
        <p class="m2-status-text" role="status">
          {error}
        </p>
      ) : null}
    </section>
  );
}
