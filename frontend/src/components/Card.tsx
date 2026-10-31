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

export function isRedSuit(suit: string): boolean {
  const normalized = suit.toLowerCase();
  return normalized === 'hearts' || normalized === 'diamonds';
}

export function suitColor(suit: string): string {
  return isRedSuit(suit) ? '#c33' : '#bababa';
}

export function suitSymbol(suit: string): string {
  return SUIT_SYMBOLS[suit.toLowerCase()] ?? '?';
}

export function rankLabel(rank: string): string {
  return RANK_LABELS[rank.toLowerCase()] ?? rank;
}

/** An inline SVG playing card, roughly 70x100px and scalable via CSS. */
export function Card({
  suit,
  rank,
  faceUp = true,
  selected = false,
  trump = false,
  onClick,
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
      >
        <CardBack />
      </div>
    );
  }

  const color = suitColor(suit);
  const symbol = suitSymbol(suit);
  const label = rankLabel(rank);

  return (
    <div
      class={classes.join(' ')}
      data-selected={selected ? 'true' : 'false'}
      data-trump={trump ? 'true' : 'false'}
      data-suit={suit.toLowerCase()}
      data-rank={rank.toLowerCase()}
      onClick={onClick}
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
          strokeWidth={1.5}
        />
        <text x="6" y="20" fontSize={15} fontWeight={700} fill={color}>
          {label}
        </text>
        <text x="6" y="33" fontSize={12} fill={color}>
          {symbol}
        </text>
        <text x="35" y="62" fontSize={30} textAnchor="middle" fill={color}>
          {symbol}
        </text>
        {trump ? (
          <g class="trump-marker" data-testid="trump-marker">
            <circle cx="56" cy="15" r="9" fill="#d4af37" />
            <text x="56" y="19.5" fontSize={11} textAnchor="middle" fill="#161512">
              {symbol}
            </text>
          </g>
        ) : null}
        <text x="64" y="94" fontSize={15} fontWeight={700} textAnchor="end" fill={color}>
          {label}
        </text>
        <text x="64" y="81" fontSize={12} textAnchor="end" fill={color}>
          {symbol}
        </text>
      </svg>
    </div>
  );
}
