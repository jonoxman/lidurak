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
  /**
   * The queue this client is currently in. It lives on `LobbyPage` so the
   * banner survives the tab switch and the `quickPairMatched` push on
   * `/ws/lobby` can clear it from outside this component.
   */
  searching: QuickPairSearching | null;
  /** Queues the player; a different tile simply replaces the queue entry. */
  onSearch: (preset: QuickPairRequest) => void;
  /** Leaves the queue and keeps the player on the lobby. */
  onCancel: () => void;
  /** Last queue error, if the server refused the request. */
  error?: string | null;
}

const DECK_FOR_PLAYERS: Record<PlayerCount, string> = {
  2: '36-card',
  3: '36-card',
  4: '52-card',
};

/**
 * Quick Pairing: pick a table size and turn clock and the server puts the
 * player in a session-scoped queue.
 *
 * A queued player is explicitly not in a room yet, so this tab never navigates
 * on its own: it keeps the searching banner (spinner, live queue count and a
 * Cancel button) visible until `LobbyPage` receives the match.
 */
export function QuickPairingTab({
  searching,
  onSearch,
  onCancel,
  error = null,
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
            class={`quick-pair-tile${
              searching !== null &&
              searching.playerCount === preset.playerCount &&
              searching.turnTimeoutSeconds === preset.turnTimeoutSeconds
                ? ' searching'
                : ''
            }`}
            data-testid={`quick-pair-${preset.playerCount}-${preset.turnTimeoutSeconds}`}
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
