import {
  getStoredSortMode,
  isSortMode,
  persistSortMode,
  type SortMode,
} from '../state/settings';

/**
 * T-90-2 ITEM-5 / ITEM-6b: the hand-sorting schema lives in `settings.ts` so the
 * table and the persisted `UserSettings` agree on one union. Re-exported here
 * for the components that already import `SortMode` from this module.
 */
export type { SortMode };

export interface SortBarProps {
  /** Controlled mode; falls back to the stored preference (Rank) when omitted. */
  mode?: SortMode;
  onModeChange: (mode: SortMode) => void;
}

export interface SortModeOption {
  mode: SortMode;
  label: string;
  title: string;
  testId: string;
}

/** The four `HAND SORTING` options, in render order. */
export const SORT_MODE_OPTIONS: readonly SortModeOption[] = [
  {
    mode: 'suit',
    label: 'Suit',
    title: 'Group by suit, trump suit rightmost',
    testId: 'sort-suit',
  },
  {
    mode: 'pairs',
    label: 'Pairs',
    title: 'Group matching ranks together',
    testId: 'sort-pairs',
  },
  {
    mode: 'rank',
    label: 'Rank',
    title: 'Ascending rank, trumps last',
    testId: 'sort-rank',
  },
  {
    mode: 'custom',
    label: 'Custom',
    title: 'Keep your own arrangement for this game (not saved between games)',
    testId: 'sort-custom',
  },
];

/**
 * Hand-sorting bar with all four schemas. The chosen mode never leaves the
 * browser: it only reorders the viewer's own cards. `custom` applies to the
 * current game only — `persistSortMode` deliberately ignores it, so the next
 * game opens on the user's real preference (Rank for a new user).
 */
export function SortBar({ mode = getStoredSortMode(), onModeChange }: SortBarProps) {
  const choose = (next: SortMode): void => {
    if (!isSortMode(next)) return;
    persistSortMode(next);
    onModeChange(next);
  };

  return (
    <div class="sort-bar" data-testid="sort-bar" title="Sort the cards in your hand">
      <span class="sort-label">HAND SORTING</span>
      <div class="sort-buttons" role="group" aria-label="Hand sorting">
        {SORT_MODE_OPTIONS.map((option) => {
          const active = option.mode === mode;
          return (
            <button
              type="button"
              key={option.mode}
              class={`sort-btn appearance-choice${active ? ' active' : ''}`}
              data-testid={option.testId}
              data-sort-option={option.mode}
              aria-pressed={active}
              title={option.title}
              onClick={() => choose(option.mode)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {/* The compact selector is the accessible fallback for the bar and the
          single machine-readable `data-sort-mode` hook. It is painted out of
          the layout (zero-sized, transparent) so the four buttons above are the
          visible control, and it lists the three real sort orders — `custom` is
          a hand arrangement, not an ordering, so it only exists as a button. */}
      <select
        class="sort-select sort-btn active"
        aria-label="Sort hand"
        tabIndex={-1}
        style={{ width: 0, height: 0, opacity: 0, padding: 0, margin: 0, border: 0 }}
        value={mode}
        data-sort-mode={mode}
        onChange={(event) => {
          const next = (event.currentTarget as HTMLSelectElement).value;
          if (isSortMode(next)) choose(next);
        }}
      >
        {SORT_MODE_OPTIONS.filter((option) => option.mode !== 'custom').map((option) => (
          <option key={option.mode} value={option.mode} title={option.title}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
