import type {
  PlayerCount,
  QuickPairRequest,
  QuickPairSearching,
} from '../../types/multiplayer';

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
  /** The queue bucket the player is waiting in, or null when not queued. */
  searching: QuickPairSearching | null;
  /** A `/api/quick-pair` request is still in flight. */
  pending?: boolean;
  error?: string | null;
  /** Joins (or switches to) a queue bucket. */
  onSearch: (preset: QuickPairRequest) => void;
  /** Leaves the queue and clears the searching state. */
  onCancel: () => void;
}

const DECK_FOR_PLAYERS: Record<PlayerCount, string> = {
  2: '36-card',
  3: '36-card',
  4: '52-card',
};

/**
 * Quick Pairing: pick a table size and turn clock.
 *
 * The queue state lives in `LobbyPage` so the searching banner survives tab
 * switches and the live `/ws/lobby` match frame always lands on a mounted
 * screen. Queued players stay on the lobby with this status until the server
 * seats them or they cancel.
 */
export function QuickPairingTab({
  searching,
  pending = false,
  error = null,
  onSearch,
  onCancel,
}: QuickPairingTabProps) {
  return (
    <section class="m2-panel quick-pair" aria-label="Quick Pairing">
      <h2 class="m2-panel-title">Quick Pairing</h2>
      <p class="m2-panel-hint">
        Redirects are on for every table. Pick a size and clock to be matched with
        players asking for the same preset.
      </p>

      {searching ? (
        <div class="quick-pair-searching" data-testid="quick-pair-searching" role="status">
          <span class="quick-pair-spinner" aria-hidden="true" />
          <span>
            Searching for a {searching.playerCount}P • {searching.turnTimeoutSeconds}s table… (
            {searching.queuedCount}/{searching.requiredCount})
          </span>
          <button type="button" class="m2-button secondary" onClick={onCancel}>
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
            data-height="double"
            data-testid={`quick-pair-${preset.playerCount}-${preset.turnTimeoutSeconds}`}
            disabled={pending}
            onClick={() => onSearch(preset)}
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
