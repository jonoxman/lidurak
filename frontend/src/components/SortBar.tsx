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

/**
 * Client-side hand sorting switcher, rendered in the controls column beside the
 * hand. The chosen mode never leaves the browser: it only reorders the viewer's
 * own cards.
 */
export function SortBar({ mode, onModeChange }: SortBarProps) {
  return (
    <div class="sort-bar" role="group" aria-label="Sort hand" data-testid="sort-bar">
      {MODES.map((option) => {
        const active = option.mode === mode;
        return (
          <button
            key={option.mode}
            type="button"
            class={`sort-button${active ? ' active' : ''}`}
            aria-pressed={active}
            title={option.title}
            data-sort-mode={option.mode}
            onClick={() => onModeChange(option.mode)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
