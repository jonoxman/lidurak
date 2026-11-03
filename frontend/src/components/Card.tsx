import { useEffect, useState } from 'preact/hooks';
import {
  prefersDarkScheme,
  resolveTheme,
  useSettings,
  type ThemeMode,
} from '../state/settings';
import { CardBack } from './CardBack';

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
 * Corner index geometry inside the `70x100` viewBox. The top-left index sits in
 * a narrow band that ends at `y = 21` (rank) and `y = 34` (suit), which keeps the
 * two-digit `"10"` index clear of every pip row. The bottom-right index mirrors
 * it in the opposite corner. The renderer and the layout below both read these
 * constants, so the pip tables can never drift out of the reserved corners.
 */
export const CARD_INDEX = {
  topRank: { x: 5, y: 21, fontSize: 15 },
  topSuit: { x: 4, y: 34, fontSize: 10 },
  bottomRank: { x: 65, y: 95, fontSize: 15 },
  bottomSuit: { x: 65, y: 82, fontSize: 10 },
} as const;

/**
 * Pip glyph size. Small enough that a two-column layout plus the centre column
 * all fit between the corner indices, large enough to read on an 80px card.
 */
export const PIP_FONT_SIZE = 12;

/** Centrepiece of an ace, sized to stay clear of the corner indices. */
export const ACE_PIP = { x: 35, y: 58, fontSize: 40 } as const;

/** Golden corner badge on a trump card. */
export const TRUMP_BADGE = { cx: 61, cy: 10, r: 6 } as const;

/**
 * Standard pip arrangements inside the 70x100 viewBox: columns at `x = 22` and
 * `x = 48` (each pip glyph spans 11.4 units, so the columns and the `x = 35`
 * centre column never touch) with rows from `y = 33` to `y = 78`. The first row
 * starts below the corner index band, which is what keeps the wide `"10"` rank
 * text and the corner suit glyph free of pips.
 */
const PIP_LAYOUTS: Record<string, ReadonlyArray<{ x: number; y: number }>> = {
  two: [
    { x: 35, y: 40 },
    { x: 35, y: 71 },
  ],
  three: [
    { x: 35, y: 33 },
    { x: 35, y: 55 },
    { x: 35, y: 78 },
  ],
  four: [
    { x: 22, y: 33 },
    { x: 48, y: 33 },
    { x: 22, y: 78 },
    { x: 48, y: 78 },
  ],
  five: [
    { x: 22, y: 33 },
    { x: 48, y: 33 },
    { x: 22, y: 78 },
    { x: 48, y: 78 },
    { x: 35, y: 55 },
  ],
  six: [
    { x: 22, y: 33 },
    { x: 48, y: 33 },
    { x: 22, y: 55 },
    { x: 48, y: 55 },
    { x: 22, y: 78 },
    { x: 48, y: 78 },
  ],
  seven: [
    { x: 22, y: 33 },
    { x: 48, y: 33 },
    { x: 22, y: 55 },
    { x: 48, y: 55 },
    { x: 22, y: 78 },
    { x: 48, y: 78 },
    { x: 35, y: 55 },
  ],
  eight: [
    { x: 22, y: 33 },
    { x: 48, y: 33 },
    { x: 22, y: 55 },
    { x: 48, y: 55 },
    { x: 22, y: 78 },
    { x: 48, y: 78 },
    { x: 35, y: 40 },
    { x: 35, y: 71 },
  ],
  nine: [
    { x: 22, y: 33 },
    { x: 48, y: 33 },
    { x: 22, y: 48 },
    { x: 48, y: 48 },
    { x: 22, y: 63 },
    { x: 48, y: 63 },
    { x: 22, y: 78 },
    { x: 48, y: 78 },
    { x: 35, y: 55 },
  ],
  ten: [
    { x: 22, y: 33 },
    { x: 48, y: 33 },
    { x: 22, y: 48 },
    { x: 48, y: 48 },
    { x: 22, y: 63 },
    { x: 48, y: 63 },
    { x: 22, y: 78 },
    { x: 48, y: 78 },
    { x: 35, y: 40 },
    { x: 35, y: 71 },
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
      >
        {/* Card face: the surface the pips are drawn on. */}
        <rect
          x="1"
          y="1"
          width="68"
          height="98"
          rx="6"
          ry="6"
          fill={palette.face}
          stroke={palette.border}
          stroke-width={1.5}
        />

        {/* Top-left index, kept inside its own narrow corner band. */}
        <text
          data-index="top-rank"
          x={CARD_INDEX.topRank.x}
          y={CARD_INDEX.topRank.y}
          font-size={CARD_INDEX.topRank.fontSize}
          font-weight={700}
          fill={color}
        >
          {label}
        </text>
        <text
          data-index="top-suit"
          x={CARD_INDEX.topSuit.x}
          y={CARD_INDEX.topSuit.y}
          font-size={CARD_INDEX.topSuit.fontSize}
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
              data-pip="face"
              x="35"
              y="50"
              font-size={30}
              font-weight={700}
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
          data-index="bottom-rank"
          x={CARD_INDEX.bottomRank.x}
          y={CARD_INDEX.bottomRank.y}
          font-size={CARD_INDEX.bottomRank.fontSize}
          font-weight={700}
          text-anchor="end"
          fill={color}
        >
          {label}
        </text>
        <text
          data-index="bottom-suit"
          x={CARD_INDEX.bottomSuit.x}
          y={CARD_INDEX.bottomSuit.y}
          font-size={CARD_INDEX.bottomSuit.fontSize}
          text-anchor="end"
          fill={color}
        >
          {symbol}
        </text>
      </svg>
    </div>
  );
}
