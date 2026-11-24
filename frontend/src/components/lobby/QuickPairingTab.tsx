import { useEffect, useRef, useState } from 'preact/hooks';
import { cancelQuickPair, joinQuickPair } from '../../api/lobbyClient';
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
 * Quick Pairing: pick a table size and turn clock, and the server queues the
 * player until a full table of the same preset is searching.
 *
 * A queued player stays right here: the searching indicator (with Cancel)
 * remains visible until either the request itself answers `matched` or a
 * `quickPairMatched` frame arrives over `/ws/lobby` and the lobby navigates.
 */
export function QuickPairingTab({ onMatched }: QuickPairingTabProps) {
  const [pending, setPending] = useState<QuickPairRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by Cancel, so a late match response cannot navigate after cancel.
  const attempt = useRef(0);

  const start = async (preset: QuickPairRequest) => {
    if (pending) return;
    const current = ++attempt.current;
    setPending(preset);
    setError(null);
    try {
      const result = await joinQuickPair(preset);
      if (attempt.current !== current) return;
      if (result.status === 'matched') {
        setPending(null);
        onMatched(result.gameId);
      }
      // `searching`: stay on the lobby with the indicator until a match arrives.
    } catch (reason) {
      if (attempt.current === current) {
        setError(reason instanceof Error ? reason.message : String(reason));
        setPending(null);
      }
    }
  };

  const cancel = async () => {
    // Invalidate the in-flight request before telling the server to drop it.
    attempt.current += 1;
    setPending(null);
    try {
      await cancelQuickPair();
    } catch {
      // A cancel that fails only means the room was already gone.
    }
  };

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
          <button type="button" class="m2-button secondary" onClick={() => void cancel()}>
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
