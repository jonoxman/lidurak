import { useEffect, useState } from 'preact/hooks';
import {
  prefersDarkScheme,
  resolveTheme,
  useSettings,
  type ThemeMode,
} from '../state/settings';

export type CardBackPattern =
  | 'classic-hatch'
  | 'royal-diamond'
  | 'celtic-weave'
  | 'hex-mesh'
  | 'chevron'
  | 'starburst'
  | 'classic-crimson'
  | 'royal-sapphire'
  | 'emerald-gold'
  | 'sunset-prism'
  | 'amethyst-nebula'
  | 'cyber-neon'
  | 'coral-wave';

/** The original monochrome patterns, in picker order. */
export const CARD_BACK_PATTERNS: readonly CardBackPattern[] = [
  'classic-hatch',
  'royal-diamond',
  'celtic-weave',
  'hex-mesh',
  'chevron',
  'starburst'];

/** Vibrant multi-colour backs, in picker order. */
export const COLORFUL_CARD_BACK_PATTERNS: readonly CardBackPattern[] = [
  'classic-crimson',
  'royal-sapphire',
  'emerald-gold',
  'sunset-prism',
  'amethyst-nebula',
  'cyber-neon',
  'coral-wave'];

/** Every selectable card back: the monochrome set, then the colourful set. */
export const ALL_CARD_BACK_PATTERNS: readonly CardBackPattern[] = [
  ...CARD_BACK_PATTERNS,
  ...COLORFUL_CARD_BACK_PATTERNS,
];

/** Human-readable name shown in the Card Back submenu. */
export const CARD_BACK_LABELS: Record<CardBackPattern, string> = {
  'classic-hatch': 'Classic Hatch',
  'royal-diamond': 'Royal Diamond',
  'celtic-weave': 'Celtic Weave',
  'hex-mesh': 'Hex Mesh',
  chevron: 'Chevron',
  starburst: 'Starburst',
  'classic-crimson': 'Classic Crimson',
  'royal-sapphire': 'Royal Sapphire',
  'emerald-gold': 'Emerald Gold',
  'sunset-prism': 'Sunset Prism',
  'amethyst-nebula': 'Amethyst Nebula',
  'cyber-neon': 'Cyber Neon',
  'coral-wave': 'Coral Wave',
};

export const DEFAULT_CARD_BACK_PATTERN: CardBackPattern = 'classic-hatch';

/** SVG card frame corner radius (viewBox units) at the default roundness of 8. */
export const SVG_CARD_CORNER_RADIUS = 6;

/**
 * ITEM-NEW-1b: maps the global Roundness setting (`0`–`16px`) onto the card
 * SVG's `70x100` viewBox, yielding `0` at `0px`, `6` at the default `8px` and
 * `12` at `16px`, so moving the Theme menu slider reshapes every card.
 */
export function svgCornerRadius(roundness: number): number {
  return Math.round((roundness / 8) * SVG_CARD_CORNER_RADIUS * 10) / 10;
}

export interface CardBackProps {
  class?: string;
  /** Which design fills the back; defaults to the user's saved preference. */
  pattern?: CardBackPattern;
}

/** Active theme a monochrome card back paints itself for. */
export type CardBackTheme = 'light' | 'dark';

/** Colours used by the six monochrome card backs. */
export interface CardBackPalette {
  /** Outer frame fill. */
  frame: string;
  /** Outer frame border. */
  frameStroke: string;
  /** Pattern tile background. */
  base: string;
  /** Inner face border. */
  border: string;
  /** Primary pattern strokes and fills. */
  ink: string;
  /** Secondary pattern strokes and fills. */
  inkSoft: string;
}

/**
 * T-90-2 ITEM-17: the dark-theme frame stroke is a bright silver-slate instead
 * of the old near-black `#3a3733`, so overlapping face-down cards in an
 * opponent's hand, the talon deck and the face-down discard stack have crisp,
 * clearly visible outlines on the dark shell. The interior motif stays as it
 * was, so the back still reads as a back.
 */
export const DARK_CARD_BACK_PALETTE: CardBackPalette = {
  frame: '#262421',
  frameStroke: '#94a3b8',
  base: '#262421',
  border: '#3a3733',
  ink: '#3a3733',
  inkSoft: '#3a3733',
};

/** Bright outer-frame stroke for the vibrant gradient backs in Dark mode. */
export const DARK_CARD_BACK_OUTLINE = '#cbd5e1';

/** Crisp slate-on-ivory look so the monochrome backs read on a light theme. */
export const LIGHT_CARD_BACK_PALETTE: CardBackPalette = {
  frame: '#f1f5f9',
  frameStroke: '#64748b',
  base: '#e2e8f0',
  border: '#94a3b8',
  ink: '#334155',
  inkSoft: '#475569',
};

export function cardBackPalette(theme: CardBackTheme): CardBackPalette {
  return theme === 'light' ? LIGHT_CARD_BACK_PALETTE : DARK_CARD_BACK_PALETTE;
}

/**
 * Resolves which palette a monochrome back should use. An explicit
 * `light`/`dark` choice wins; `device` follows the theme already applied to
 * `<html>` and falls back to `prefers-color-scheme`.
 */
export function resolveCardBackTheme(
  theme: ThemeMode,
  prefersDark = prefersDarkScheme(),
  root?: HTMLElement | null,
): CardBackTheme {
  if (theme === 'light' || theme === 'dark') return theme;
  const target = root ?? (typeof document === 'undefined' ? null : document.documentElement);
  const applied = target?.getAttribute?.('data-theme');
  if (applied === 'light' || applied === 'dark') return applied;
  return resolveTheme(theme, prefersDark);
}

/** Re-renders when "Device theme" follows a change in the OS colour scheme. */
function useCardBackTheme(theme: ThemeMode): CardBackTheme {
  const [, bump] = useState(0);

  useEffect(() => {
    if (theme !== 'device') return undefined;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => bump((tick) => tick + 1);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, [theme]);

  return resolveCardBackTheme(theme);
}

type ColorfulMotif = 'stripes' | 'diamonds' | 'rings' | 'rays' | 'sparkle' | 'grid' | 'waves';

interface ColorfulDesign {
  /** Outer frame colour. */
  frame: string;
  /** Three gradient stops for the inner face. */
  stops: readonly [string, string, string];
  /** Border, motif and hover-able accent colour. */
  accent: string;
  motif: ColorfulMotif;
}

const COLORFUL_DESIGNS: Partial<Record<CardBackPattern, ColorfulDesign>> = {
  'classic-crimson': {
    frame: '#2a0b12',
    stops: ['#7a1026', '#c2213f', '#f0684b'],
    accent: '#ffd9a0',
    motif: 'stripes',
  },
  'royal-sapphire': {
    frame: '#0b1430',
    stops: ['#123a8c', '#2a6fd6', '#67c8ff'],
    accent: '#d8ecff',
    motif: 'diamonds',
  },
  'emerald-gold': {
    frame: '#07251b',
    stops: ['#0b5a3a', '#1f9e63', '#8fe07a'],
    accent: '#ffd24a',
    motif: 'rings',
  },
  'sunset-prism': {
    frame: '#2b1030',
    stops: ['#ff6f61', '#ff9a3c', '#ffd166'],
    accent: '#ffe9b0',
    motif: 'rays',
  },
  'amethyst-nebula': {
    frame: '#180a2e',
    stops: ['#4b1d8c', '#8a4de0', '#e879f9'],
    accent: '#f5d0ff',
    motif: 'sparkle',
  },
  'cyber-neon': {
    frame: '#05080f',
    stops: ['#0b1b2b', '#00d9c0', '#ff00a8'],
    accent: '#39ff14',
    motif: 'grid',
  },
  'coral-wave': {
    frame: '#2b1116',
    stops: ['#ff5f6d', '#ff8ba7', '#7dd3fc'],
    accent: '#ffe6ea',
    motif: 'waves',
  },
};

const MOTIF_INK = 'rgba(255, 255, 255, 0.34)';

/** The motif tile laid over a colourful gradient face. */
function MotifTile({ id, motif }: { id: string; motif: ColorfulMotif }) {
  const tile = { id, width: 16, height: 16, patternUnits: 'userSpaceOnUse' } as const;

  switch (motif) {
    case 'diamonds':
      return (
        <pattern {...tile}>
          <path d="M8 1.5 L14.5 8 L8 14.5 L1.5 8 Z" fill="none" stroke={MOTIF_INK} stroke-width="1.1" />
        </pattern>
      );

    case 'rings':
      return (
        <pattern {...tile}>
          <circle cx="8" cy="8" r="6.5" fill="none" stroke={MOTIF_INK} stroke-width="1.1" />
          <circle cx="8" cy="8" r="3" fill="none" stroke={MOTIF_INK} stroke-width="1" />
        </pattern>
      );

    case 'rays':
      return (
        <pattern {...tile}>
          <g stroke={MOTIF_INK} stroke-width="1.2" stroke-linecap="round">
            <line x1="8" y1="8" x2="8" y2="0" />
            <line x1="8" y1="8" x2="16" y2="8" />
            <line x1="8" y1="8" x2="8" y2="16" />
            <line x1="8" y1="8" x2="0" y2="8" />
          </g>
        </pattern>
      );

    case 'sparkle':
      return (
        <pattern {...tile}>
          <circle cx="4" cy="4" r="1.1" fill="rgba(255, 255, 255, 0.55)" />
          <circle cx="12" cy="11" r="0.9" fill="rgba(255, 255, 255, 0.42)" />
          <path d="M11 3.5 L12 5.5 L14 6.5 L12 7.5 L11 9.5 L10 7.5 L8 6.5 L10 5.5 Z" fill={MOTIF_INK} />
        </pattern>
      );

    case 'grid':
      return (
        <pattern {...tile}>
          <path d="M0 0 H16 V16 H0 Z" fill="none" stroke={MOTIF_INK} stroke-width="1" />
          <path d="M8 0 V16 M0 8 H16" stroke={MOTIF_INK} stroke-width="0.6" />
        </pattern>
      );

    case 'waves':
      return (
        <pattern {...tile}>
          <path
            d="M0 5 Q4 1 8 5 T16 5 M0 12 Q4 8 8 12 T16 12"
            fill="none"
            stroke={MOTIF_INK}
            stroke-width="1.3"
            stroke-linecap="round"
          />
        </pattern>
      );

    case 'stripes':
    default:
      return (
        <pattern {...tile} patternTransform="rotate(35)">
          <line x1="0" y1="0" x2="0" y2="16" stroke={MOTIF_INK} stroke-width="3" />
        </pattern>
      );
  }
}

/** The pattern tile for one monochrome card back design. */
function PatternTile({
  pattern,
  palette,
}: {
  pattern: CardBackPattern;
  palette: CardBackPalette;
}) {
  const id = `card-back-${pattern}`;
  const base = palette.base;
  const ink = palette.ink;
  const inkSoft = palette.inkSoft;

  switch (pattern) {
    case 'royal-diamond':
      return (
        <pattern id={id} width="12" height="12" patternUnits="userSpaceOnUse">
          <rect width="12" height="12" fill={base} />
          <path
            d="M6 0 L12 6 L6 12 L0 6 Z"
            fill="none"
            stroke={ink}
            stroke-width={1.2}
          />
          <circle cx="6" cy="6" r="1" fill={inkSoft} />
        </pattern>
      );

    case 'celtic-weave':
      return (
        <pattern id={id} width="14" height="14" patternUnits="userSpaceOnUse">
          <rect width="14" height="14" fill={base} />
          <path
            d="M0 7 A7 7 0 0 1 14 7 A7 7 0 0 1 0 7"
            fill="none"
            stroke={ink}
            stroke-width={1.8}
          />
          <path
            d="M7 0 A7 7 0 0 1 7 14 A7 7 0 0 1 7 0"
            fill="none"
            stroke={inkSoft}
            stroke-width={1.8}
          />
          <circle cx="7" cy="7" r="1.6" fill={inkSoft} />
        </pattern>
      );

    case 'hex-mesh':
      return (
        <pattern id={id} width="14" height="12" patternUnits="userSpaceOnUse">
          <rect width="14" height="12" fill={base} />
          <path
            d="M7 1 L12.2 4 L12.2 9 L7 12 L1.8 9 L1.8 4 Z"
            fill="none"
            stroke={ink}
            stroke-width={1.4}
          />
        </pattern>
      );

    case 'chevron':
      return (
        <pattern id={id} width="12" height="10" patternUnits="userSpaceOnUse">
          <rect width="12" height="10" fill={base} />
          <path d="M0 8 L6 3 L12 8" fill="none" stroke={ink} stroke-width={1.8} />
          <path d="M0 3 L6 -2 L12 3" fill="none" stroke={inkSoft} stroke-width={1.2} />
        </pattern>
      );

    case 'starburst':
      return (
        <pattern id={id} width="16" height="16" patternUnits="userSpaceOnUse">
          <rect width="16" height="16" fill={base} />
          <g stroke={ink} stroke-width={1} stroke-linecap="round">
            <line x1="8" y1="8" x2="8" y2="0.5" />
            <line x1="8" y1="8" x2="8" y2="15.5" />
            <line x1="8" y1="8" x2="0.5" y2="8" />
            <line x1="8" y1="8" x2="15.5" y2="8" />
            <line x1="8" y1="8" x2="2.7" y2="2.7" />
            <line x1="8" y1="8" x2="13.3" y2="13.3" />
            <line x1="8" y1="8" x2="13.3" y2="2.7" />
            <line x1="8" y1="8" x2="2.7" y2="13.3" />
          </g>
          <path d="M8 5 L10 8 L8 11 L6 8 Z" fill={inkSoft} />
        </pattern>
      );

    case 'classic-hatch':
    default:
      return (
        <pattern
          id={id}
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="8" height="8" fill={base} />
          <line x1="0" y1="0" x2="0" y2="8" stroke={ink} stroke-width="3" />
        </pattern>
      );
  }
}

/** The back of a playing card, sized like a [[Card]]. */
export function CardBack({ class: className, pattern }: CardBackProps) {
  // Without an explicit pattern, follow the user's Card Back preference, so the
  // header setting reaches every face-down card in the app.
  const settings = useSettings();
  const activePattern = pattern ?? settings.cardBack;
  // Both the outer frame and the inner decorative border follow the slider.
  const svgCorner = svgCornerRadius(settings.roundness);
  const innerCorner = Math.max(0, svgCorner - 1.5);
  const roundness = String(settings.roundness);
  const id = `card-back-${activePattern}`;
  const gradientId = `${id}-gradient`;
  const design = COLORFUL_DESIGNS[activePattern];
  // Colorful backs keep their palette in every theme; only the monochrome set
  // adapts, so it stays readable on the light theme.
  const theme = useCardBackTheme(settings.theme);
  const palette = cardBackPalette(theme);
  const frame = design ? design.frame : palette.frame;
  // T-90-2 ITEM-17: in Dark mode every back — monochrome and gradient alike —
  // paints its outer frame with a bright silver-slate stroke. Light mode keeps
  // the existing crisp design accent / slate palette.
  const ink = design
    ? theme === 'dark'
      ? DARK_CARD_BACK_OUTLINE
      : design.accent
    : palette.frameStroke;

  return (
    <svg
      class={`playing-card card-back playing-card-back${className ? ` ${className}` : ''}`}
      viewBox="0 0 70 100"
      role="img"
      aria-label="Card back"
      data-pattern={activePattern}
      data-colorful={design ? 'true' : 'false'}
      data-card-back-theme={design ? undefined : theme}
      data-card-back-outline={theme === 'dark' ? 'bright' : 'crisp'}
      data-roundness={roundness}
      style={{ borderRadius: 'var(--app-roundness, 8px)' }}
    >
      <defs>
        {design ? (
          <>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0.65" y2="1">
              <stop offset="0%" stop-color={design.stops[0]} />
              <stop offset="55%" stop-color={design.stops[1]} />
              <stop offset="100%" stop-color={design.stops[2]} />
            </linearGradient>
            <MotifTile id={id} motif={design.motif} />
          </>
        ) : (
          <PatternTile pattern={activePattern} palette={palette} />
        )}
      </defs>
      <rect
        x="1"
        y="1"
        width="68"
        height="98"
        rx={svgCorner}
        ry={svgCorner}
        fill={frame}
        stroke={ink}
        stroke-width={2}
      />
      <rect
        data-pattern-fill={activePattern}
        x="6"
        y="6"
        width="58"
        height="88"
        rx={innerCorner}
        ry={innerCorner}
        fill={design ? `url(#${gradientId})` : `url(#${id})`}
        stroke={design ? design.accent : palette.border}
        stroke-width={1}
      />
      {design ? (
        <rect
          data-pattern-motif={activePattern}
          x="6"
          y="6"
          width="58"
          height="88"
          rx={innerCorner}
          ry={innerCorner}
          fill={`url(#${id})`}
          opacity="0.6"
        />
      ) : null}
    </svg>
  );
}
