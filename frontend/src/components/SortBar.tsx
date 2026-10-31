export type SortMode = 'suit' | 'pairs' | 'rank';

export interface SortBarProps {
  mode: SortMode;
  onModeChange: (mode: SortMode) => void;
}

const MODES: { mode: SortMode; label: string; title: string }[] = [
  { mode: 'suit', label: 'Suit', title: 'Group by suit, trump suit rightmost' },
  { mode: 'pairs', label: 'Pairs', title: 'Group matching ranks together' },
  { mode: 'rank', label: 'Rank', title: 'Ascending rank, trumps last' },
];

const isSortMode = (value: string): value is SortMode =>
  MODES.some((option) => option.mode === value);

/**
 * Compact hand-sorting dropdown, rendered in the controls column beside the
 * hand. The chosen mode never leaves the browser: it only reorders the viewer's
 * own cards.
 */
export function SortBar({ mode, onModeChange }: SortBarProps) {
  return (
    <label class="sort-bar" data-testid="sort-bar" title="Sort the cards in your hand">
      <span class="sort-label">Sort</span>
      <select
        class="sort-select"
        aria-label="Sort hand"
        value={mode}
        data-sort-mode={mode}
        onChange={(event) => {
          const next = (event.currentTarget as HTMLSelectElement).value;
          if (isSortMode(next)) onModeChange(next);
        }}
      >
        {MODES.map((option) => (
          <option key={option.mode} value={option.mode} title={option.title}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
