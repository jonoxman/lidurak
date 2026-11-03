import { useEffect, useState } from 'preact/hooks';
import {
  prefersDarkScheme,
  resolveTheme,
  useSettings,
  type ThemeMode,
} from '../state/settings';
import { CardBack, svgCornerRadius } from './CardBack';

export interface CardData {
  suit: string;
  rank: string;
}

export interface CardProps {
  suit: string;
  rank: string;
  faceUp?: boolean;
  selected?: boolean;
  /** True when this card can legally be played right now; lifts it off the hand. */
  playable?: boolean;
  /** Draws the golden trump glow and corner badge. */
  trump?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  draggable?: boolean;
  onDragStart?: (event: DragEvent) => void;
  onDragEnd?: () => void;
}

const SUIT_SYMBOLS: Record<string, string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
};

const RANK_LABELS: Record<string, string> = {
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  jack: 'J',
  queen: 'Q',
  king: 'K',
  ace: 'A',
};

/** Cards whose centerpiece is a letter rather than repeating pips. */
const FACE_RANKS = new Set(['jack', 'queen', 'king']);

/**
 * T-90 ITEM-3b: classic, ornate serif kept ONLY for the large centre court
 * letters (`J`, `Q`, `K`) on the face of the cards. The stack degrades through
 * the serif faces that ship with Windows, macOS and Linux before falling back
 * to the generic serif family.
 */
export const CARD_SERIF_FONT_FAMILY =
  "'Cinzel', 'Playfair Display', Georgia, 'Times New Roman', 'Palatino Linotype', 'Book Antiqua', serif";

/**
 * T-90 ITEM-3a: clean sans-serif for the small rank numbers and letters in the
 * top-left / bottom-right corners of every card, matching the app shell.
 */
export const CARD_CORNER_FONT_FAMILY =
  "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

/** The inline card wrappers follow the global Roundness setting. */
export const CARD_BORDER_RADIUS = 'var(--app-roundness, 8px)';

/**
 * Corner index geometry inside the `70x100` viewBox (T-90 ITEM-3a).
 *
 * The rank number/letter and its suit pip now share **one horizontal centre
 * axis** (`x = 11.5` in the top-left corner, mirrored at `70 - 11.5 = 58.5` in
 * the bottom-right corner) and both are drawn with `text-anchor="middle"`, so
 * the suit sits exactly centred beneath the rank on every rank — including the
 * two-character `"10"` and the single-character `2`–`9`, `J`, `Q`, `K`, `A`.
 *
 * The corner suit pip grew from `10` to `12` viewBox units (clearly readable at
 * standard table zoom) and keeps `y = 34` (top) / `y = 82` (bottom), so the rank
 * band still ends at `y = 21` and the pip rows below start at `y = 34`. The pip
 * columns (`PIP_COLUMNS`) start far enough to the right of that `x = 11.5` axis
 * that the wider two-digit `"10"` and the enlarged suit glyph never touch a pip.
 */
export const CARD_INDEX = {
  topRank: { x: 11.5, y: 21, fontSize: 15 },
  topSuit: { x: 11.5, y: 34, fontSize: 12 },
  bottomRank: { x: 58.5, y: 96, fontSize: 15 },
  bottomSuit: { x: 58.5, y: 82, fontSize: 12 },
} as const;

/**
 * Pip glyph size (T-90 ITEM-3b): raised from `12` to `13` so the numbered-card
 * face pips read a little larger, while the tightened columns and rows below
 * keep every one of them clear of the corner indices, the trump badge and each
 * other.
 */
export const PIP_FONT_SIZE = 13;

/**
 * Horizontal centre lines of the numbered-card pip grid. The columns sit
 * slightly inward of the old `22`/`35`/`48` grid — `23.5`, `36`, `48.5` — so the
 * larger 13pt glyphs still fit between the corner index band on the left and the
 * trump badge on the right without touching each other.
 */
export const PIP_COLUMNS = { left: 23.5, center: 36, right: 48.5 } as const;

/**
 * Vertical centre lines of the numbered-card pip grid: rows from `y = 34` (just
 * below the corner rank band and level with the corner suit glyph) down to
 * `y = 70`, which clears the bottom-right corner index that starts at `y = 82`.
 */
export const PIP_ROWS = { top: 34, middle: 52, bottom: 70 } as const;

/**
 * The rectangle every numbered-card face pip is laid out inside. The ticket's
 * geometry tests assert each pip centre sits on (or within) these bounds, and
 * that the bounds stay tighter than the previous `y = 33`–`78` grid even though
 * the glyphs are now larger.
 */
export const PIP_LAYOUT_BOUNDS = {
  minX: PIP_COLUMNS.left,
  maxX: PIP_COLUMNS.right,
  minY: PIP_ROWS.top,
  maxY: PIP_ROWS.bottom,
} as const;

/**
 * Centrepiece of an ace. Nudged two units right of the exact card centre so the
 * 40pt ornate pip clears the enlarged 12pt corner suit glyph in the top-left
 * corner.
 */
export const ACE_PIP = { x: 37, y: 58, fontSize: 40 } as const;

/** Golden corner badge on a trump card. */
export const TRUMP_BADGE = { cx: 61, cy: 10, r: 6 } as const;

/**
 * Standard pip arrangements inside the 70x100 viewBox (T-90 ITEM-3b): the three
 * columns from `PIP_COLUMNS` (`23.5` / `36` / `48.5`) and rows from `y = 34` to
 * `y = 70`. Every glyph is 13pt (12.35 units wide, 11.05 tall), so adjacent
 * columns and rows stay strictly disjoint: the side columns span
 * `17.325`–`29.675` and `42.325`–`54.675` while the centre column spans
 * `29.825`–`42.175`, and the rows are 12 units apart — more than one glyph
 * height. The first row starts below the corner rank band, and the last row
 * ends above the bottom-right corner index, so the enlarged `"10"` rank text
 * and the enlarged corner suit glyph are never touched.
 */
const { left: LEFT, center: CENTER, right: RIGHT } = PIP_COLUMNS;
const { top: TOP, middle: MIDDLE, bottom: BOTTOM } = PIP_ROWS;

const PIP_LAYOUTS: Record<string, ReadonlyArray<{ x: number; y: number }>> = {
  two: [
    { x: CENTER, y: TOP },
    { x: CENTER, y: BOTTOM },
  ],
  three: [
    { x: CENTER, y: TOP },
    { x: CENTER, y: MIDDLE },
    { x: CENTER, y: BOTTOM },
  ],
  four: [
    { x: LEFT, y: TOP },
    { x: RIGHT, y: TOP },
    { x: LEFT, y: BOTTOM },
    { x: RIGHT, y: BOTTOM },
  ],
  five: [
    { x: LEFT, y: TOP },
    { x: RIGHT, y: TOP },
    { x: LEFT, y: BOTTOM },
    { x: RIGHT, y: BOTTOM },
    { x: CENTER, y: MIDDLE },
  ],
  six: [
    { x: LEFT, y: TOP },
    { x: RIGHT, y: TOP },
    { x: LEFT, y: MIDDLE },
    { x: RIGHT, y: MIDDLE },
    { x: LEFT, y: BOTTOM },
    { x: RIGHT, y: BOTTOM },
  ],
  seven: [
    { x: LEFT, y: TOP },
    { x: RIGHT, y: TOP },
    { x: LEFT, y: MIDDLE },
    { x: RIGHT, y: MIDDLE },
    { x: LEFT, y: BOTTOM },
    { x: RIGHT, y: BOTTOM },
    { x: CENTER, y: 43 },
  ],
  eight: [
    { x: LEFT, y: TOP },
    { x: RIGHT, y: TOP },
    { x: LEFT, y: MIDDLE },
    { x: RIGHT, y: MIDDLE },
    { x: LEFT, y: BOTTOM },
    { x: RIGHT, y: BOTTOM },
    { x: CENTER, y: 40 },
    { x: CENTER, y: 64 },
  ],
  nine: [
    { x: LEFT, y: TOP },
    { x: RIGHT, y: TOP },
    { x: LEFT, y: 46 },
    { x: RIGHT, y: 46 },
    { x: LEFT, y: 58 },
    { x: RIGHT, y: 58 },
    { x: LEFT, y: BOTTOM },
    { x: RIGHT, y: BOTTOM },
    { x: CENTER, y: MIDDLE },
  ],
  ten: [
    { x: LEFT, y: TOP },
    { x: RIGHT, y: TOP },
    { x: LEFT, y: 46 },
    { x: RIGHT, y: 46 },
    { x: LEFT, y: 58 },
    { x: RIGHT, y: 58 },
    { x: LEFT, y: BOTTOM },
    { x: RIGHT, y: BOTTOM },
    { x: CENTER, y: 40 },
    { x: CENTER, y: 64 },
  ],
};

/** Corner of the central letter a face pip sits on. */
export type FaceCorner = 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left';

/** Pips sit at the ends of the face letter (`J`, `Q`, `K`) around `(35, 50)`. */
const FACE_PIPS: Record<string, ReadonlyArray<{ x: number; y: number; corner: FaceCorner }>> = {
  jack: [
    { x: 24, y: 33, corner: 'top-left' },
    { x: 46, y: 33, corner: 'top-right' },
    { x: 24, y: 67, corner: 'bottom-left' },
  ],
  queen: [{ x: 46, y: 67, corner: 'bottom-right' }],
  king: [
    { x: 24, y: 33, corner: 'top-left' },
    { x: 46, y: 33, corner: 'top-right' },
    { x: 24, y: 67, corner: 'bottom-left' },
    { x: 46, y: 67, corner: 'bottom-right' },
  ],
};

/**
 * Rotation that points a pip's distinguishing half away from the letter: the
 * top half of a heart/club, or the bottom half of a spade/diamond, faces out.
 * Angles are clockwise degrees from upright, pivoting around the pip itself.
 */
const FACE_PIP_ANGLES: Record<'upper' | 'lower', Record<FaceCorner, number>> = {
  upper: { 'top-left': -45, 'top-right': 45, 'bottom-right': 135, 'bottom-left': -135 },
  lower: { 'top-left': 135, 'top-right': -135, 'bottom-right': -45, 'bottom-left': 45 },
};

/** Decorative pips for a face rank, or `null` for every other rank. */
export function facePips(
  rank: string,
): ReadonlyArray<{ x: number; y: number; corner: FaceCorner }> | null {
  return FACE_PIPS[rank.toLowerCase()] ?? null;
}

/** Outward rotation, in degrees, for one face pip of a given suit. */
export function facePipAngle(suit: string, corner: FaceCorner): number {
  const normalized = suit.toLowerCase();
  const facing = normalized === 'hearts' || normalized === 'clubs' ? 'upper' : 'lower';
  return FACE_PIP_ANGLES[facing][corner];
}

export function isRedSuit(suit: string): boolean {
  const normalized = suit.toLowerCase();
  return normalized === 'hearts' || normalized === 'diamonds';
}

/** Rich red for hearts/diamonds, deep near-black for spades/clubs. */
export function suitColor(suit: string): string {
  return isRedSuit(suit) ? '#c33' : '#111111';
}

export function suitSymbol(suit: string): string {
  return SUIT_SYMBOLS[suit.toLowerCase()] ?? '?';
}

export function rankLabel(rank: string): string {
  return RANK_LABELS[rank.toLowerCase()] ?? rank;
}

/** Pip coordinates for a number card (2-10), or `null` for aces/face cards. */
export function pipLayout(rank: string): ReadonlyArray<{ x: number; y: number }> | null {
  return PIP_LAYOUTS[rank.toLowerCase()] ?? null;
}

/** Theme the card front paints itself for. */
export type CardFrontTheme = 'light' | 'dark';

/** Colours of the card face where the pips are drawn. */
export interface CardFrontPalette {
  /** Face fill: white in the light theme, neutral grey in the dark theme. */
  face: string;
  /** Face outline. */
  border: string;
}

/** White card front for the light theme, so the black/red pips stay crisp. */
export const LIGHT_CARD_FRONT_PALETTE: CardFrontPalette = {
  face: '#ffffff',
  border: '#bababa',
};

/**
 * Neutral light-mid grey for the dark theme: the card still reads as a card
 * against the `#161512` shell, and both the near-black spade/club ink and the
 * red heart/diamond ink keep their contrast.
 */
export const DARK_CARD_FRONT_PALETTE: CardFrontPalette = {
  face: '#cbd5e1',
  border: '#94a3b8',
};

export function cardFrontPalette(theme: CardFrontTheme): CardFrontPalette {
  return theme === 'light' ? LIGHT_CARD_FRONT_PALETTE : DARK_CARD_FRONT_PALETTE;
}

/**
 * Resolves which card front a card paints. An explicit `light`/`dark` wins;
 * `device` follows the theme already applied to `<html>` (written by
 * `settings.ts`) and falls back to `prefers-color-scheme`, matching
 * `CardBack.tsx` and `tableTextures.ts`.
 */
export function resolveCardFrontTheme(
  theme: ThemeMode,
  prefersDark = prefersDarkScheme(),
  root?: HTMLElement | null,
): CardFrontTheme {
  if (theme === 'light' || theme === 'dark') return theme;
  const target = root ?? (typeof document === 'undefined' ? null : document.documentElement);
  const applied = target?.getAttribute?.('data-theme');
  if (applied === 'light' || applied === 'dark') return applied;
  return resolveTheme(theme, prefersDark);
}

/** Re-renders when "Device theme" follows a change in the OS colour scheme. */
function useCardFrontTheme(theme: ThemeMode): CardFrontTheme {
  const [, bump] = useState(0);

  useEffect(() => {
    if (theme !== 'device') return undefined;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => bump((tick) => tick + 1);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, [theme]);

  return resolveCardFrontTheme(theme);
}

/** An inline SVG playing card, roughly 80x114px and scalable via CSS. */
export function Card({
  suit,
  rank,
  faceUp = true,
  selected = false,
  playable = false,
  trump = false,
  onClick,
  onDoubleClick,
  draggable = false,
  onDragStart,
  onDragEnd,
}: CardProps) {
  // The face where the pips are drawn is theme-dependent: white on the light
  // theme, grey on the dark theme.
  const settings = useSettings();
  const theme = useCardFrontTheme(settings.theme);
  const palette = cardFrontPalette(theme);
  // ITEM-NEW-1b: the Roundness slider drives both the SVG frame corners and
  // the HTML wrapper, so every face-up card reshapes with the theme menu.
  const svgCorner = svgCornerRadius(settings.roundness);
  const roundness = String(settings.roundness);

  const classes = ['card-slot'];
  if (selected) classes.push('selected');
  if (playable) classes.push('legal-playable');
  if (trump) classes.push('trump');
  if (onClick) classes.push('clickable');

  if (!faceUp) {
    return (
      <div
        class={classes.join(' ')}
        data-selected={selected ? 'true' : 'false'}
        data-roundness={roundness}
        style={{ borderRadius: CARD_BORDER_RADIUS }}
        onClick={onClick}
        onDblClick={onDoubleClick}
      >
        <CardBack />
      </div>
    );
  }

  const color = suitColor(suit);
  const symbol = suitSymbol(suit);
  const label = rankLabel(rank);
  const normalizedRank = rank.toLowerCase();
  const pips = pipLayout(normalizedRank);
  const isAce = normalizedRank === 'ace';
  const isFace = FACE_RANKS.has(normalizedRank);
  const decorations = facePips(normalizedRank);

  return (
    <div
      class={classes.join(' ')}
      data-selected={selected ? 'true' : 'false'}
      data-playable={playable ? 'true' : 'false'}
      data-trump={trump ? 'true' : 'false'}
      data-suit={suit.toLowerCase()}
      data-rank={rank.toLowerCase()}
      data-card-theme={theme}
      data-roundness={roundness}
      style={{ borderRadius: CARD_BORDER_RADIUS }}
      onClick={onClick}
      onDblClick={onDoubleClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <svg
        class="playing-card card-face"
        viewBox="0 0 70 100"
        role="img"
        aria-label={`${rank} of ${suit}`}
        data-card-theme={theme}
        data-card-face={palette.face}
        data-roundness={roundness}
        style={{ borderRadius: CARD_BORDER_RADIUS }}
      >
        {/* Card face: the surface the pips are drawn on. */}
        <rect
          x="1"
          y="1"
          width="68"
          height="98"
          rx={svgCorner}
          ry={svgCorner}
          fill={palette.face}
          stroke={palette.border}
          stroke-width={1.5}
        />

        {/* Top-left index, kept inside its own narrow corner band. */}
        <text
          class="card-rank-index"
          data-index="top-rank"
          data-testid="card-rank-top"
          data-font-style="sans-serif"
          x={CARD_INDEX.topRank.x}
          y={CARD_INDEX.topRank.y}
          font-size={CARD_INDEX.topRank.fontSize}
          font-family={CARD_CORNER_FONT_FAMILY}
          font-weight="700"
          text-anchor="middle"
          fill={color}
        >
          {label}
        </text>
        {/* T-90 ITEM-3a: the corner suit shares the rank's `x` and horizontal
            centre axis, so it sits exactly centred beneath the rank text. */}
        <text
          class="card-suit-index"
          data-index="top-suit"
          data-testid="card-suit-top"
          x={CARD_INDEX.topSuit.x}
          y={CARD_INDEX.topSuit.y}
          font-size={CARD_INDEX.topSuit.fontSize}
          text-anchor="middle"
          fill={color}
        >
          {symbol}
        </text>

        {/* Center face: repeating pips, one ornate ace pip, or a face letter. */}
        {pips ? (
          <g class="card-pips">
            {pips.map((pip, index) => (
              <text
                key={index}
                class="card-pip"
                data-pip="rank"
                x={pip.x}
                y={pip.y}
                font-size={PIP_FONT_SIZE}
                text-anchor="middle"
                fill={color}
              >
                {symbol}
              </text>
            ))}
          </g>
        ) : null}

        {isAce ? (
          <text
            class="card-pip ace-pip"
            data-pip="ace"
            x={ACE_PIP.x}
            y={ACE_PIP.y}
            font-size={ACE_PIP.fontSize}
            text-anchor="middle"
            fill={color}
          >
            {symbol}
          </text>
        ) : null}

        {isFace ? (
          <g class="face-card">
            {(decorations ?? []).map((pip) => {
              const angle = facePipAngle(suit, pip.corner);
              return (
                <text
                  key={pip.corner}
                  class="card-pip face-pip"
                  data-pip="decor"
                  data-corner={pip.corner}
                  data-rotation={angle}
                  x={pip.x}
                  y={pip.y}
                  font-size={11}
                  text-anchor="middle"
                  dominant-baseline="central"
                  transform={`rotate(${angle} ${pip.x} ${pip.y})`}
                  fill={color}
                >
                  {symbol}
                </text>
              );
            })}
            <text
              class="card-face-letter"
              data-pip="face"
              data-testid="card-face-letter"
              data-font-style="serif"
              x="35"
              y="50"
              font-size={30}
              font-family={CARD_SERIF_FONT_FAMILY}
              font-weight="700"
              text-anchor="middle"
              dominant-baseline="central"
              fill={color}
            >
              {label}
            </text>
          </g>
        ) : null}

        {trump ? (
          <g class="trump-marker" data-testid="trump-marker">
            {/* A compact 12-14px badge tucked into the top-right corner, clear
                of the corner index and every center pip. */}
            <circle cx={TRUMP_BADGE.cx} cy={TRUMP_BADGE.cy} r={TRUMP_BADGE.r} fill="#d4af37" />
            <text
              x={TRUMP_BADGE.cx}
              y={TRUMP_BADGE.cy}
              font-size={8}
              text-anchor="middle"
              dominant-baseline="central"
              fill="#161512"
            >
              {symbol}
            </text>
          </g>
        ) : null}

        {/* Bottom-right index, rotated 180 degrees by the reading direction. */}
        <text
          class="card-rank-index"
          data-index="bottom-rank"
          data-testid="card-rank-bottom"
          data-font-style="sans-serif"
          x={CARD_INDEX.bottomRank.x}
          y={CARD_INDEX.bottomRank.y}
          font-size={CARD_INDEX.bottomRank.fontSize}
          font-family={CARD_CORNER_FONT_FAMILY}
          font-weight="700"
          text-anchor="middle"
          fill={color}
        >
          {label}
        </text>
        <text
          class="card-suit-index"
          data-index="bottom-suit"
          data-testid="card-suit-bottom"
          x={CARD_INDEX.bottomSuit.x}
          y={CARD_INDEX.bottomSuit.y}
          font-size={CARD_INDEX.bottomSuit.fontSize}
          text-anchor="middle"
          fill={color}
        >
          {symbol}
        </text>
      </svg>
    </div>
  );
}
