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
 * Standard pip arrangements inside the 70x100 viewBox: two columns near the
 * edges, a center column for odd and high counts. Corner indices are kept clear.
 */
const PIP_LAYOUTS: Record<string, ReadonlyArray<{ x: number; y: number }>> = {
  two: [
    { x: 35, y: 30 },
    { x: 35, y: 70 },
  ],
  three: [
    { x: 35, y: 26 },
    { x: 35, y: 50 },
    { x: 35, y: 74 },
  ],
  four: [
    { x: 23, y: 30 },
    { x: 47, y: 30 },
    { x: 23, y: 70 },
    { x: 47, y: 70 },
  ],
  five: [
    { x: 23, y: 30 },
    { x: 47, y: 30 },
    { x: 23, y: 70 },
    { x: 47, y: 70 },
    { x: 35, y: 50 },
  ],
  six: [
    { x: 23, y: 30 },
    { x: 47, y: 30 },
    { x: 23, y: 50 },
    { x: 47, y: 50 },
    { x: 23, y: 70 },
    { x: 47, y: 70 },
  ],
  seven: [
    { x: 23, y: 30 },
    { x: 47, y: 30 },
    { x: 23, y: 50 },
    { x: 47, y: 50 },
    { x: 23, y: 70 },
    { x: 47, y: 70 },
    { x: 35, y: 50 },
  ],
  eight: [
    { x: 23, y: 30 },
    { x: 47, y: 30 },
    { x: 23, y: 50 },
    { x: 47, y: 50 },
    { x: 23, y: 70 },
    { x: 47, y: 70 },
    { x: 35, y: 40 },
    { x: 35, y: 61 },
  ],
  nine: [
    { x: 23, y: 28 },
    { x: 47, y: 28 },
    { x: 23, y: 44 },
    { x: 47, y: 44 },
    { x: 23, y: 60 },
    { x: 47, y: 60 },
    { x: 23, y: 76 },
    { x: 47, y: 76 },
    { x: 35, y: 52 },
  ],
  ten: [
    { x: 23, y: 26 },
    { x: 47, y: 26 },
    { x: 23, y: 43 },
    { x: 47, y: 43 },
    { x: 23, y: 61 },
    { x: 47, y: 61 },
    { x: 23, y: 78 },
    { x: 47, y: 78 },
    { x: 35, y: 36 },
    { x: 35, y: 68 },
  ],
};

/** Decorative pips arranged around a face card's central letter. */
const FACE_DECORATIONS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 35, y: 30 },
  { x: 23, y: 56 },
  { x: 47, y: 56 },
  { x: 35, y: 84 },
];

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

/** An inline SVG playing card, roughly 80x114px and scalable via CSS. */
export function Card({
  suit,
  rank,
  faceUp = true,
  selected = false,
  trump = false,
  onClick,
  onDoubleClick,
  draggable = false,
  onDragStart,
  onDragEnd,
}: CardProps) {
  const classes = ['card-slot'];
  if (selected) classes.push('selected');
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
  const pipSize = pips && pips.length > 6 ? 15 : 17;

  return (
    <div
      class={classes.join(' ')}
      data-selected={selected ? 'true' : 'false'}
      data-trump={trump ? 'true' : 'false'}
      data-suit={suit.toLowerCase()}
      data-rank={rank.toLowerCase()}
      onClick={onClick}
      onDblClick={onDoubleClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <svg
        class="playing-card"
        viewBox="0 0 70 100"
        role="img"
        aria-label={`${rank} of ${suit}`}
      >
        <rect
          x="1"
          y="1"
          width="68"
          height="98"
          rx="6"
          ry="6"
          fill="#f5f1e6"
          stroke="#bababa"
          stroke-width={1.5}
        />

        {/* Top-left index */}
        <text x="6" y="20" font-size={15} font-weight={700} fill={color}>
          {label}
        </text>
        <text x="6" y="33" font-size={12} fill={color}>
          {symbol}
        </text>

        {/* Center face: repeating pips, one ornate ace pip, or a face letter. */}
        {pips ? (
          <g class="card-pips">
            {pips.map((pip, index) => (
              <text
                key={index}
                data-pip="rank"
                x={pip.x}
                y={pip.y}
                font-size={pipSize}
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
            data-pip="ace"
            x="35"
            y="66"
            font-size={46}
            text-anchor="middle"
            fill={color}
          >
            {symbol}
          </text>
        ) : null}

        {isFace ? (
          <g class="face-card">
            {FACE_DECORATIONS.map((pip) => (
              <text
                key={`${pip.x}-${pip.y}`}
                data-pip="decor"
                x={pip.x}
                y={pip.y}
                font-size={11}
                text-anchor="middle"
                fill={color}
              >
                {symbol}
              </text>
            ))}
            <text
              data-pip="face"
              x="35"
              y="64"
              font-size={30}
              font-weight={700}
              text-anchor="middle"
              fill={color}
            >
              {label}
            </text>
          </g>
        ) : null}

        {trump ? (
          <g class="trump-marker" data-testid="trump-marker">
            <circle cx="56" cy="15" r="9" fill="#d4af37" />
            <text
              x="56"
              y="15"
              font-size={11}
              text-anchor="middle"
              dominant-baseline="central"
              fill="#161512"
            >
              {symbol}
            </text>
          </g>
        ) : null}

        {/* Bottom-right index, rotated 180 degrees by the reading direction. */}
        <text x="64" y="94" font-size={15} font-weight={700} text-anchor="end" fill={color}>
          {label}
        </text>
        <text x="64" y="81" font-size={12} text-anchor="end" fill={color}>
          {symbol}
        </text>
      </svg>
    </div>
  );
}
