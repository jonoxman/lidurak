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

/**
 * T-90-feedback-20261105_221105-2 ITEM-1b: the standard playing-card footprint.
 * Every card on the table and in hand matches the throw-in / redirect / target
 * outlines at `100px × 140px`; CSS scales the same box to `48px × 68px` below
 * the `900px` mobile breakpoint.
 */
export const CARD_DEFAULT_WIDTH = 100;
export const CARD_DEFAULT_HEIGHT = 140;
/** T-90: the `@media (max-width: 899px)` card size from `table.css`. */
export const CARD_MOBILE_BREAKPOINT_PX = 899;
export const CARD_MOBILE_WIDTH = 48;
export const CARD_MOBILE_HEIGHT = 68;

export interface CardProps {
  suit: string;
  rank: string;
  faceUp?: boolean;
  selected?: boolean;
  /**
   * T-90-feedback-20261105_221105-2 ITEM-1b: explicit footprint in px. Hand,
   * play-area and deck callers pass the measured responsive size (100 × 140
   * desktop, 48 × 68 below 900px); compact callers (the sidebar bottom-trump)
   * pass their own smaller box. When omitted, the card still sets an inline
   * `100 × 140` footprint through `--card-width` / `--card-height`, so the
   * mobile breakpoint can override the default without losing the inline box.
   */
  width?: number;
  height?: number;
  /** True when this card can legally be played right now; lifts it off the hand. */
  playable?: boolean;
  /** Applies the gilded gold trump border (no corner badge, no glow). */
  trump?: boolean;
  /**
   * T-90-feedback-20261105_221105-3 ITEM-5: the native mouse event is forwarded
   * so callers can ignore the second click of a double-click (`event.detail >= 2`).
   */
  onClick?: (event: MouseEvent) => void;
  onDoubleClick?: (event: MouseEvent) => void;
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
 * Corner index geometry inside the `70x100` viewBox (T-90 ITEM-3a, reworked by
 * T-90-feedback-2 ITEM-4).
 *
 * The rank number/letter and its suit pip share **one horizontal centre axis**
 * at `x = 7.5` in the top-left corner, mirrored at `70 - 7.5 = 62.5` in the
 * bottom-right corner, and both are drawn with `text-anchor="middle"`. That
 * places the whole corner index inside `x ∈ [2.5, 12.5]` (≈`3.5px`–`18px` at
 * 100px card width), so an 80% overlap — which leaves the leftmost 20px of
 * every card uncovered — can never hide a card's rank or suit.
 *
 * The two-character `"10"` is drawn at `twoDigitFontSize = 9` so its ink stays
 * inside that same strip; `2`–`9`, `J`, `Q`, `K`, `A` keep the larger `15`.
 * The 12pt suit pip fits naturally (`≈2.7`–`12.3`), the rank band still ends at
 * `y = 21`, and the face grid starts at the leftmost pip column `x = 22.5`.
 */
export const CARD_INDEX = {
  topRank: { x: 7.5, y: 21, fontSize: 15, twoDigitFontSize: 9 },
  topSuit: { x: 7.5, y: 34, fontSize: 12 },
  // T-90-2 ITEM-11: the bottom-right corner is the exact 180° rotation of the
  // top-left one around the `(35, 50)` card centre, so the upside-down rank
  // sits nearest the corner (`70 - 7.5`, `100 - 21`) and the upside-down suit
  // directly above it (`70 - 7.5`, `100 - 34`).
  bottomRank: { x: 62.5, y: 79, fontSize: 15, twoDigitFontSize: 9 },
  bottomSuit: { x: 62.5, y: 66, fontSize: 12 },
} as const;

/**
 * Pip glyph size (T-90 ITEM-3b): raised from `12` to `13` so the numbered-card
 * face pips read a little larger, while the tightened columns and rows below
 * keep every one of them clear of the corner indices, the trump badge and each
 * other.
 */
export const PIP_FONT_SIZE = 13;

/**
 * Horizontal centre lines of the numbered-card pip grid (T-90-1 ITEM-3a).
 *
 * The grid is strictly centred on the `70x100` card canvas: `left = 22.5`,
 * `center = 35` (the exact horizontal centre axis) and `right = 47.5`, so
 * `left + right = 70` and the left and right margins are identical (`22.5` from
 * either edge). The spacing `12.5` still clears a full 13-unit suit glyph
 * (whose ink is about `10.4` units wide), and the right column ends at `47.5`,
 * clear of the card frame.
 */
export const PIP_COLUMNS = { left: 22.5, center: 35, right: 47.5 } as const;

/**
 * Vertical centre lines of the numbered-card pip grid (T-90-1 ITEM-3a): the
 * outer rows sit at `y = 32` and `y = 68` (`top + bottom = 100`, so the top and
 * bottom margins are both `32`), the centre row lands on the exact vertical
 * centre axis `y = 50`, and the inner rows mirror it at `50 - 6 = 44` and
 * `50 + 6 = 56`. The 12-unit row pitch keeps every 13-unit glyph disjoint, the
 * first row clears the corner rank band above `y = 21`, and the last row clears
 * the bottom-right corner index that starts at `y = 82`.
 */
export const PIP_ROWS = {
  top: 32,
  upperMid: 44,
  middle: 50,
  lowerMid: 56,
  bottom: 68,
} as const;

/**
 * The rectangle every numbered-card face pip is laid out inside. It is centred
 * on the card: `minX + maxX = 70` and `minY + maxY = 100`, so the left/right and
 * top/bottom margins are equal on both sides. The geometry tests assert every
 * pip centre sits on (or within) these bounds, and that the bounds stay tighter
 * than the previous `y = 33`–`78` grid even though the glyphs are larger.
 */
export const PIP_LAYOUT_BOUNDS = {
  minX: PIP_COLUMNS.left,
  maxX: PIP_COLUMNS.right,
  minY: PIP_ROWS.top,
  maxY: PIP_ROWS.bottom,
} as const;

/**
 * Centrepiece of an ace (T-90-1 ITEM-3b): pinned to the exact card centre
 * `(35, 50)` with `text-anchor="middle"` and `dominant-baseline="central"`, so
 * its horizontal margins (`35` left / `35` right) and vertical margins (`50`
 * top / `50` bottom) are equal on both sides. The 40-unit glyph keeps its carve
 * out of the 12pt corner suit indices on every side.
 */
export const ACE_PIP = { x: 35, y: 50, fontSize: 40 } as const;

/**
 * Standard pip arrangements inside the 70x100 viewBox (T-90-1 ITEM-3a): the
 * centred columns from `PIP_COLUMNS` (`22.5` / `35` / `47.5`) and the centred
 * rows from `PIP_ROWS` (`32` / `44` / `50` / `56` / `68`). Every glyph is 13pt
 * (about `10.4` units of ink wide and `10.1` tall), so adjacent columns and rows
 * stay strictly disjoint: the side columns span `17.3`–`27.7` and `42.3`–`52.7`
 * while the centre column spans `29.8`–`40.2`, and the 12-unit row pitch leaves
 * roughly two units between glyphs. The first row clears the corner rank band,
 * the last row clears the bottom-right corner index, and the outer rows/columns
 * mirror across `(35, 50)`, so every rank's pip bounding box has equal margins.
 */
const { left: LEFT, center: CENTER, right: RIGHT } = PIP_COLUMNS;
const { top: TOP, upperMid: UPPER, middle: MIDDLE, lowerMid: LOWER, bottom: BOTTOM } = PIP_ROWS;

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
    { x: CENTER, y: UPPER },
  ],
  eight: [
    { x: LEFT, y: TOP },
    { x: RIGHT, y: TOP },
    { x: LEFT, y: MIDDLE },
    { x: RIGHT, y: MIDDLE },
    { x: LEFT, y: BOTTOM },
    { x: RIGHT, y: BOTTOM },
    { x: CENTER, y: UPPER },
    { x: CENTER, y: LOWER },
  ],
  nine: [
    { x: LEFT, y: TOP },
    { x: RIGHT, y: TOP },
    { x: LEFT, y: UPPER },
    { x: RIGHT, y: UPPER },
    { x: LEFT, y: LOWER },
    { x: RIGHT, y: LOWER },
    { x: LEFT, y: BOTTOM },
    { x: RIGHT, y: BOTTOM },
    { x: CENTER, y: MIDDLE },
  ],
  ten: [
    { x: LEFT, y: TOP },
    { x: RIGHT, y: TOP },
    { x: LEFT, y: UPPER },
    { x: RIGHT, y: UPPER },
    { x: LEFT, y: LOWER },
    { x: RIGHT, y: LOWER },
    { x: LEFT, y: BOTTOM },
    { x: RIGHT, y: BOTTOM },
    { x: CENTER, y: UPPER },
    { x: CENTER, y: LOWER },
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
  width,
  height,
  onClick,
  onDoubleClick,
  draggable = false,
  onDragStart,
  onDragEnd,
}: CardProps) {
  // T-90-feedback-2 ITEM-1b (review round 2): every card carries its footprint
  // inline, as the ticket requires. Explicit props win (the hand / play area
  // pass the measured responsive size, compact callers their own box); when no
  // size is passed the inline default is expressed through custom properties so
  // the `900px` breakpoint can still deliver 48x68 instead of being overridden.
  // T-90: default footprint is the shared `--card-w` / `--card-h` token.
  const viewportWidth = typeof window === 'undefined' ? 0 : window.innerWidth;
  const mobileViewport = viewportWidth > 0 && viewportWidth <= CARD_MOBILE_BREAKPOINT_PX;
  const resolvedWidth =
    width ?? (mobileViewport ? CARD_MOBILE_WIDTH : CARD_DEFAULT_WIDTH);
  const resolvedHeight =
    height ?? (mobileViewport ? CARD_MOBILE_HEIGHT : CARD_DEFAULT_HEIGHT);
  const widthCss = width == null ? `var(--card-w, ${CARD_DEFAULT_WIDTH}px)` : `${width}px`;
  const heightCss = height == null ? `var(--card-h, ${CARD_DEFAULT_HEIGHT}px)` : `${height}px`;
  const cardStyle = {
    borderRadius: CARD_BORDER_RADIUS,
    width: widthCss,
    height: heightCss,
    minWidth: widthCss,
    minHeight: heightCss,
    flex: `0 0 ${widthCss}`,
  };
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
        data-card-width={resolvedWidth}
        data-card-height={resolvedHeight}
        style={cardStyle}
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
      data-trump-glow="false"
      data-card-width={resolvedWidth}
      data-card-height={resolvedHeight}
      style={cardStyle}
      onClick={onClick}
      onDblClick={onDoubleClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <svg
        class={trump ? 'playing-card card-face trump-card' : 'playing-card card-face'}
        viewBox="0 0 70 100"
        draggable={false}
        // T-90 ITEM-7: no native drag may start on the SVG artwork, so the
        // pointer finger set by the hand wrapper is never replaced by the
        // browser's drag / "no drop" cursor.
        onDragStart={(event: DragEvent) => event.preventDefault()}
        role="img"
        aria-label={`${rank} of ${suit}`}
        data-card-theme={theme}
        data-card-face={palette.face}
        data-roundness={roundness}
        data-trump-glow="false"
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
          data-inverted="false"
          x={CARD_INDEX.topRank.x}
          y={CARD_INDEX.topRank.y}
          font-size={
            label.length > 1
              ? CARD_INDEX.topRank.twoDigitFontSize
              : CARD_INDEX.topRank.fontSize
          }
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
          data-inverted="false"
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
            dominant-baseline="central"
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

        {/* T-90-2 ITEM-11: the bottom-right corner is inverted — the rank and
            suit are rotated 180° around their own anchors, exactly mirroring
            the upright top-left corner. */}
        <text
          class="card-rank-index"
          data-index="bottom-rank"
          data-testid="card-rank-bottom"
          data-font-style="sans-serif"
          data-inverted="true"
          x={CARD_INDEX.bottomRank.x}
          y={CARD_INDEX.bottomRank.y}
          font-size={
            label.length > 1
              ? CARD_INDEX.bottomRank.twoDigitFontSize
              : CARD_INDEX.bottomRank.fontSize
          }
          font-family={CARD_CORNER_FONT_FAMILY}
          font-weight="700"
          text-anchor="middle"
          transform={`rotate(180 ${CARD_INDEX.bottomRank.x} ${CARD_INDEX.bottomRank.y})`}
          fill={color}
        >
          {label}
        </text>
        <text
          class="card-suit-index"
          data-index="bottom-suit"
          data-testid="card-suit-bottom"
          data-inverted="true"
          x={CARD_INDEX.bottomSuit.x}
          y={CARD_INDEX.bottomSuit.y}
          font-size={CARD_INDEX.bottomSuit.fontSize}
          text-anchor="middle"
          transform={`rotate(180 ${CARD_INDEX.bottomSuit.x} ${CARD_INDEX.bottomSuit.y})`}
          fill={color}
        >
          {symbol}
        </text>
      </svg>
    </div>
  );
}
