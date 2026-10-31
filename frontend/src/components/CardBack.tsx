import { useSettings } from '../state/settings';

export type CardBackPattern =
  | 'classic-hatch'
  | 'royal-diamond'
  | 'celtic-weave'
  | 'hex-mesh'
  | 'chevron'
  | 'starburst';

/** Every selectable card back, in picker order. */
export const CARD_BACK_PATTERNS: readonly CardBackPattern[] = [
  'classic-hatch',
  'royal-diamond',
  'celtic-weave',
  'hex-mesh',
  'chevron',
  'starburst'];

export const DEFAULT_CARD_BACK_PATTERN: CardBackPattern = 'classic-hatch';

export interface CardBackProps {
  class?: string;
  /** Which SVG pattern fills the back; defaults to the classic cross-hatch. */
  pattern?: CardBackPattern;
}

const BACK_BASE = '#262421';
const BACK_INK = '#3a3733';

/** The pattern tile for one card back design (all share the 70x100 card tiles). */
function PatternTile({ pattern }: { pattern: CardBackPattern }) {
  const id = `card-back-${pattern}`;

  switch (pattern) {
    case 'royal-diamond':
      return (
        <pattern id={id} width="12" height="12" patternUnits="userSpaceOnUse">
          <rect width="12" height="12" fill={BACK_BASE} />
          <path
            d="M6 0 L12 6 L6 12 L0 6 Z"
            fill="none"
            stroke={BACK_INK}
            stroke-width={1.2}
          />
          <circle cx="6" cy="6" r="1" fill={BACK_INK} />
        </pattern>
      );

    case 'celtic-weave':
      return (
        <pattern id={id} width="14" height="14" patternUnits="userSpaceOnUse">
          <rect width="14" height="14" fill={BACK_BASE} />
          <path
            d="M0 7 A7 7 0 0 1 14 7 A7 7 0 0 1 0 7"
            fill="none"
            stroke={BACK_INK}
            stroke-width={1.8}
          />
          <path
            d="M7 0 A7 7 0 0 1 7 14 A7 7 0 0 1 7 0"
            fill="none"
            stroke={BACK_INK}
            stroke-width={1.8}
          />
          <circle cx="7" cy="7" r="1.6" fill={BACK_INK} />
        </pattern>
      );

    case 'hex-mesh':
      return (
        <pattern id={id} width="14" height="12" patternUnits="userSpaceOnUse">
          <rect width="14" height="12" fill={BACK_BASE} />
          <path
            d="M7 1 L12.2 4 L12.2 9 L7 12 L1.8 9 L1.8 4 Z"
            fill="none"
            stroke={BACK_INK}
            stroke-width={1.4}
          />
        </pattern>
      );

    case 'chevron':
      return (
        <pattern id={id} width="12" height="10" patternUnits="userSpaceOnUse">
          <rect width="12" height="10" fill={BACK_BASE} />
          <path d="M0 8 L6 3 L12 8" fill="none" stroke={BACK_INK} stroke-width={1.8} />
          <path d="M0 3 L6 -2 L12 3" fill="none" stroke={BACK_INK} stroke-width={1.2} />
        </pattern>
      );

    case 'starburst':
      return (
        <pattern id={id} width="16" height="16" patternUnits="userSpaceOnUse">
          <rect width="16" height="16" fill={BACK_BASE} />
          <g stroke={BACK_INK} stroke-width={1} stroke-linecap="round">
            <line x1="8" y1="8" x2="8" y2="0.5" />
            <line x1="8" y1="8" x2="8" y2="15.5" />
            <line x1="8" y1="8" x2="0.5" y2="8" />
            <line x1="8" y1="8" x2="15.5" y2="8" />
            <line x1="8" y1="8" x2="2.7" y2="2.7" />
            <line x1="8" y1="8" x2="13.3" y2="13.3" />
            <line x1="8" y1="8" x2="13.3" y2="2.7" />
            <line x1="8" y1="8" x2="2.7" y2="13.3" />
          </g>
          <path d="M8 5 L10 8 L8 11 L6 8 Z" fill={BACK_INK} />
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
          <rect width="8" height="8" fill={BACK_BASE} />
          <line x1="0" y1="0" x2="0" y2="8" stroke={BACK_INK} stroke-width={3} />
        </pattern>
      );
  }
}

/** The dark patterned back of a playing card, sized like a [[Card]]. */
export function CardBack({ class: className, pattern }: CardBackProps) {
  // Without an explicit pattern, follow the user's Card Back preference, so the
  // header setting reaches every face-down card in the app.
  const settings = useSettings();
  const activePattern = pattern ?? settings.cardBack;
  const id = `card-back-${activePattern}`;

  return (
    <svg
      class={`playing-card card-back${className ? ` ${className}` : ''}`}
      viewBox="0 0 70 100"
      role="img"
      aria-label="Card back"
      data-pattern={activePattern}
    >
      <defs>
        <PatternTile pattern={activePattern} />
      </defs>
      <rect
        x="1"
        y="1"
        width="68"
        height="98"
        rx="6"
        ry="6"
        fill={BACK_BASE}
        stroke={BACK_INK}
        stroke-width={2}
      />
      <rect
        data-pattern-fill={activePattern}
        x="6"
        y="6"
        width="58"
        height="88"
        rx="4"
        ry="4"
        fill={`url(#${id})`}
        stroke={BACK_INK}
        stroke-width={1}
      />
    </svg>
  );
}
