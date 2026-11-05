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
 * T-90-2 ITEM-5: the `HAND SORTING` control is a native `<select>` dropdown
 * again (not a row of buttons), with all four schemas — `Suit`, `Pairs`, `Rank`
 * and the hand-arrangement-only `Custom` — listed in that order. `Rank` stays
 * the default for a new user (`DEFAULT_SORT_MODE`), and the dropdown value
 * follows `mode`, so dragging a card into a new position flips the visible
 * selection to `Custom` without any extra wiring.
 *
 * The chosen mode never leaves the browser: it only reorders the viewer's own
 * cards. `custom` applies to the current game only — `persistSortMode`
 * deliberately ignores it, so the next game opens on the user's real preference
 * (Rank for a new user).
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
      <select
        class="sort-select"
        data-testid="sort-select"
        aria-label="Sort hand"
        data-sort-mode={mode}
        value={mode}
        onChange={(event) => choose(event.currentTarget.value as SortMode)}
      >
        {SORT_MODE_OPTIONS.map((option) => (
          <option
            key={option.mode}
            value={option.mode}
            data-testid={option.testId}
            title={option.title}
          >
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
