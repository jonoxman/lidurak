import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { getBrandLogoMosaicDataUri } from '../BrandLogo';
import type {
  PlayerCount,
  QuickPairRequest,
  QuickPairSearching,
} from '../../types/multiplayer';

/** The six Lichess-style Quick Pairing presets, all with redirects enabled. */
export const QUICK_PAIR_PRESETS: ReadonlyArray<
  QuickPairRequest & { playerCount: PlayerCount }
> = [
  { playerCount: 2, turnTimeoutSeconds: 15, allowRedirect: true },
  { playerCount: 2, turnTimeoutSeconds: 30, allowRedirect: true },
  { playerCount: 3, turnTimeoutSeconds: 15, allowRedirect: true },
  { playerCount: 3, turnTimeoutSeconds: 30, allowRedirect: true },
  { playerCount: 4, turnTimeoutSeconds: 15, allowRedirect: true },
  { playerCount: 4, turnTimeoutSeconds: 30, allowRedirect: true },
];

/** T-90-3 ITEM-6b: three additional tiles that deal the full 52-card deck. */
export const QUICK_PAIR_FULL_DECK_PRESETS: ReadonlyArray<
  QuickPairRequest & { playerCount: PlayerCount }
> = [
  { playerCount: 2, turnTimeoutSeconds: 15, allowRedirect: true, deckSize: 52 },
  { playerCount: 2, turnTimeoutSeconds: 30, allowRedirect: true, deckSize: 52 },
  { playerCount: 3, turnTimeoutSeconds: 30, allowRedirect: true, deckSize: 52 },
];

/** T-90-3 ITEM-7c: one-click matches whose empty seats are already bot seats. */
export const QUICK_PAIR_BOT_PRESETS: ReadonlyArray<QuickPairRequest> = [
  { playerCount: 2, turnTimeoutSeconds: 15, allowRedirect: true, botOpponent: 'randomBot' },
  { playerCount: 2, turnTimeoutSeconds: 30, allowRedirect: true, botOpponent: 'basicBot' },
  { playerCount: 4, turnTimeoutSeconds: 30, allowRedirect: true, botOpponent: 'basicBot' },
];

export type QuickPairTileKind = 'standard' | 'fullDeck' | 'bot';

/** One homepage tile: everything the button needs plus its queue request. */
export interface QuickPairTile {
  id: string;
  title: string;
  meta: string;
  kind: QuickPairTileKind;
  request: QuickPairRequest;
}

const DECK_FOR_PLAYERS: Record<PlayerCount, string> = {
  2: '36-card',
  3: '36-card',
  4: '52-card',
};

/** The homepage grid: 6 standard + 3 full-deck + 3 instant-bot tiles. */
export const QUICK_PAIR_TILES: ReadonlyArray<QuickPairTile> = [
  ...QUICK_PAIR_PRESETS.map((preset) => ({
    id: `quick-pair-${preset.playerCount}-${preset.turnTimeoutSeconds}`,
    title: `${preset.playerCount}P • ${preset.turnTimeoutSeconds}s`,
    meta: `${DECK_FOR_PLAYERS[preset.playerCount]} • Redirect ON`,
    kind: 'standard' as const,
    request: preset,
  })),
  ...QUICK_PAIR_FULL_DECK_PRESETS.map((preset) => ({
    id: `quick-pair-52-${preset.playerCount}-${preset.turnTimeoutSeconds}`,
    title: `${preset.playerCount}P • ${preset.turnTimeoutSeconds}s`,
    meta: '52 cards • Redirect ON',
    kind: 'fullDeck' as const,
    request: preset,
  })),
  {
    id: 'quick-pair-bot-2-random',
    title: '2P vs RandomBot',
    meta: 'Instant start • 15s • 36-card',
    kind: 'bot',
    request: QUICK_PAIR_BOT_PRESETS[0],
  },
  {
    id: 'quick-pair-bot-2-basic',
    title: '2P vs BasicBot',
    meta: 'Instant start • 30s • 36-card',
    kind: 'bot',
    request: QUICK_PAIR_BOT_PRESETS[1],
  },
  {
    id: 'quick-pair-bot-4-basic',
    title: '4P vs 3× BasicBot',
    meta: 'Instant start • 30s • 52-card',
    kind: 'bot',
    request: QUICK_PAIR_BOT_PRESETS[2],
  },
];

/** The 12 tiles form this grid; the mosaic slices are mapped over it. */
const MOSAIC_COLS = 3;
const MOSAIC_ROWS = 4;

/**
 * Pure-CSS fallback while the grid has not been measured yet (JSDOM, or the
 * first paint before the `ResizeObserver` callback): each tile paints its own
 * cell of a logo sized to cover the whole grid including its gaps.
 */
const FALLBACK_BACKGROUND_SIZE =
  'calc(var(--mosaic-cols) * 100% + (var(--mosaic-cols) - 1) * var(--quick-grid-gap)) ' +
  'calc(var(--mosaic-rows) * 100% + (var(--mosaic-rows) - 1) * var(--quick-grid-gap))';

type MosaicTheme = 'dark' | 'light';

interface GridMetrics {
  width: number;
  height: number;
  offsets: ReadonlyArray<{ left: number; top: number }>;
}

function documentTheme(): MosaicTheme {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

/**
 * Positions one tile's slice of the unified logo.
 *
 * When the grid has been measured the slice is exact pixels (so the logo lines
 * up perfectly across the CSS Grid gaps); before that, or without layout, the
 * percentage/calc fallback keeps the same mosaic geometry.
 */
function mosaicTileStyle(
  image: string,
  index: number,
  col: number,
  row: number,
  metrics: GridMetrics | null,
): JSX.CSSProperties {
  const style: JSX.CSSProperties = {
    backgroundImage: image,
    backgroundRepeat: 'no-repeat',
  };
  const offset = metrics?.offsets[index];

  if (metrics !== null && offset !== undefined && metrics.width > 0) {
    style.backgroundSize = `${metrics.width}px ${metrics.height}px`;
    style.backgroundPosition = `${-offset.left}px ${-offset.top}px`;
  } else {
    style.backgroundSize = FALLBACK_BACKGROUND_SIZE;
    style.backgroundPosition = `${(col / (MOSAIC_COLS - 1)) * 100}% ${
      (row / (MOSAIC_ROWS - 1)) * 100
    }%`;
  }
  return style;
}

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

/**
 * Quick Pairing: pick a table size and turn clock.
 *
 * The queue state lives in `LobbyPage` so the searching banner survives tab
 * switches and the live `/ws/lobby` match frame always lands on a mounted
 * screen. Queued players stay on the lobby with this status until the server
 * seats them or they cancel; a bot tile is answered `matched` at once.
 */
export function QuickPairingTab({
  searching,
  pending = false,
  error = null,
  onSearch,
  onCancel,
}: QuickPairingTabProps) {
  const [theme, setTheme] = useState<MosaicTheme>(documentTheme);
  const [metrics, setMetrics] = useState<GridMetrics | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  // ITEM-8b: follow the HeaderBar Theme menu, so the watermark re-tints live.
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
      return;
    }
    const root = document.documentElement;
    const observer = new MutationObserver(() => setTheme(documentTheme()));
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  // ITEM-8b: measure the grid and every tile so one logo is sliced across all
  // 12 tiles and stays invisible in the grid gaps. jsdom has no layout (and no
  // ResizeObserver), so the CSS fallback simply stays active there.
  useEffect(() => {
    const grid = gridRef.current;
    if (grid === null) return;

    const measure = () => {
      const gridRect = grid.getBoundingClientRect();
      if (gridRect.width <= 0 || gridRect.height <= 0) {
        setMetrics(null);
        return;
      }
      const tiles = Array.from(grid.querySelectorAll<HTMLElement>('.quick-pair-tile'));
      setMetrics({
        width: gridRect.width,
        height: gridRect.height,
        offsets: tiles.map((tile) => {
          const rect = tile.getBoundingClientRect();
          return { left: rect.left - gridRect.left, top: rect.top - gridRect.top };
        }),
      });
    };

    measure();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    Array.from(grid.children).forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, []);

  const mosaicImage = getBrandLogoMosaicDataUri(theme);

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

      <div
        class="quick-pair-grid"
        data-testid="quick-pair-grid"
        data-mosaic-theme={theme}
        ref={gridRef}
      >
        {QUICK_PAIR_TILES.map((tile, index) => {
          const col = index % MOSAIC_COLS;
          const row = Math.floor(index / MOSAIC_COLS);
          return (
            <button
              key={tile.id}
              type="button"
              class="quick-pair-tile"
              data-height="double"
              data-kind={tile.kind}
              data-mosaic-col={col}
              data-mosaic-row={row}
              data-testid={tile.id}
              style={mosaicTileStyle(mosaicImage, index, col, row, metrics)}
              disabled={pending}
              onClick={() => onSearch(tile.request)}
            >
              <span class="quick-pair-tile-title">{tile.title}</span>
              <span class="quick-pair-tile-meta">{tile.meta}</span>
            </button>
          );
        })}
      </div>

      {error ? (
        <p class="m2-status-text" role="status">
          {error}
        </p>
      ) : null}
    </section>
  );
}
