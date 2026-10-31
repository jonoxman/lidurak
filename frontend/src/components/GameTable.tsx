import type { ComponentChildren } from 'preact';
import { Card, isRedSuit, suitSymbol, type CardData } from './Card';
import { CardBack } from './CardBack';
import { TablePair } from './TablePair';
import '../styles/table.css';

export interface OpponentSummary {
  id: string;
  name: string;
  cardCount: number;
  hasPassed: boolean;
  finishRank?: number | null;
}

export interface TablePairData {
  attack: CardData;
  defense?: CardData | null;
}

export type SeatPosition = 'top-left' | 'top-center' | 'top-right';

export interface SeatAssignment {
  opponent: OpponentSummary;
  /** Clockwise distance from the viewer, `1` being the next player. */
  offset: number;
  position: SeatPosition;
}

export interface GameTableProps {
  myId: string;
  myHand: CardData[];
  opponents: OpponentSummary[];
  tablePairs: TablePairData[];
  talonCount: number;
  bottomTrumpCard?: CardData | null;
  trumpSuit: string;
  attackerId?: string;
  defenderId?: string;
  selectedKeys?: string[];
  onCardClick?: (card: CardData) => void;
  onTableCardClick?: (attackIndex: number) => void;
  children?: ComponentChildren;
}

const SUIT_ORDER: Record<string, number> = {
  spades: 0,
  hearts: 1,
  diamonds: 2,
  clubs: 3,
};

const RANK_ORDER: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  jack: 11,
  queen: 12,
  king: 13,
  ace: 14,
};

/** The viewer always occupies relative seat 0; opponents follow clockwise. */
const VIEWER_SEAT = 0;

export const cardKey = (card: CardData): string =>
  `${card.suit.toLowerCase()}:${card.rank.toLowerCase()}`;

const sortHand = (hand: CardData[]): CardData[] =>
  [...hand].sort((left, right) => {
    const suitDiff =
      (SUIT_ORDER[left.suit.toLowerCase()] ?? 9) -
      (SUIT_ORDER[right.suit.toLowerCase()] ?? 9);
    if (suitDiff !== 0) return suitDiff;
    return (
      (RANK_ORDER[left.rank.toLowerCase()] ?? 0) -
      (RANK_ORDER[right.rank.toLowerCase()] ?? 0)
    );
  });

/**
 * Relative clockwise distance from `viewerIndex` to `seatIndex`:
 * `(seatIndex - viewerIndex + N) % N`.
 */
export function clockwiseOffset(
  seatIndex: number,
  viewerIndex: number,
  playerCount: number,
): number {
  if (playerCount <= 1) return 0;
  return (((seatIndex - viewerIndex) % playerCount) + playerCount) % playerCount;
}

/**
 * Maps a clockwise offset onto the single opponent row of the felt:
 * 2 players put the sole opponent top-center, 3 players split them
 * top-left/top-right, and 4 players fill the row left to right.
 */
export function seatForOffset(offset: number, playerCount: number): SeatPosition {
  if (playerCount <= 2) return 'top-center';
  if (playerCount === 3) return offset === 1 ? 'top-left' : 'top-right';
  const seats: SeatPosition[] = ['top-left', 'top-center', 'top-right'];
  return seats[offset - 1] ?? 'top-right';
}

/** Assigns every opponent a deterministic seat relative to the viewer. */
export function assignSeats(opponents: OpponentSummary[]): SeatAssignment[] {
  const playerCount = opponents.length + 1;
  return opponents.map((opponent, index) => {
    const offset = clockwiseOffset(index + 1, VIEWER_SEAT, playerCount);
    return { opponent, offset, position: seatForOffset(offset, playerCount) };
  });
}

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');

/**
 * The felt arena as a 3x3 CSS Grid: opponents across the top row, the active
 * bout in the middle row, and the talon deck, the viewer's hand, and the
 * contextual controls in the bottom row.
 */
export function GameTable({
  myId,
  myHand,
  opponents,
  tablePairs,
  talonCount,
  bottomTrumpCard,
  trumpSuit,
  attackerId,
  defenderId,
  selectedKeys = [],
  onCardClick,
  onTableCardClick,
  children,
}: GameTableProps) {
  const hand = sortHand(myHand);
  const seats = assignSeats(opponents);

  return (
    <div class="table-arena" data-zone="table-arena" data-my-id={myId}>
      {seats.map(({ opponent, offset, position }) => {
        const classes = ['seat', `seat-${position}`];
        if (opponent.id === attackerId) classes.push('active-attacker');
        if (opponent.id === defenderId) classes.push('active-defender');
        return (
          <div
            key={opponent.id}
            class={classes.join(' ')}
            data-seat={position}
            data-offset={offset}
            data-testid="opponent"
          >
            <div class="seat-head">
              <span class="opponent-avatar" aria-hidden="true">
                {initials(opponent.name)}
              </span>
              <span class="opponent-name">{opponent.name}</span>
            </div>
            <div class="opponent-cards" aria-label={`${opponent.name}'s cards`}>
              {Array.from({ length: opponent.cardCount }, (_, index) => (
                <CardBack key={index} />
              ))}
            </div>
            <div class="seat-meta">
              <span class="opponent-count">{opponent.cardCount} cards</span>
              {opponent.finishRank != null ? (
                <span class="opponent-rank">
                  {opponent.finishRank === 1 ? 'WINNER' : 'OUT'}
                </span>
              ) : null}
              {opponent.hasPassed ? <span class="opponent-passed">Passed</span> : null}
            </div>
          </div>
        );
      })}

      <section class="bout-area" aria-label="Battle">
        {tablePairs.map((pair, index) => (
          <TablePair
            key={index}
            attack={pair.attack}
            defense={pair.defense}
            onAttackClick={
              onTableCardClick && !pair.defense ? () => onTableCardClick(index) : undefined
            }
          />
        ))}
      </section>

      <aside class="table-deck" data-zone="table-deck" aria-label="Talon">
        <div class="deck-stack">
          <div class="talon-stack">
            <CardBack class="talon-back talon-back-second" />
            <CardBack class="talon-back" />
            <span class="talon-count" data-testid="talon-count">
              {talonCount}
            </span>
          </div>
          {talonCount > 0 && bottomTrumpCard ? (
            <div class="bottom-trump" aria-label="Bottom trump card">
              <div class="bottom-trump-card">
                <Card suit={bottomTrumpCard.suit} rank={bottomTrumpCard.rank} />
              </div>
            </div>
          ) : null}
        </div>
        <div
          class={`trump-badge ${isRedSuit(trumpSuit) ? 'red' : 'black'}`}
          data-suit={trumpSuit.toLowerCase()}
        >
          <span>Trump</span>
          <span class="trump-symbol">{suitSymbol(trumpSuit)}</span>
        </div>
      </aside>

      <section class="player-hand" data-zone="player-hand" aria-label="Your hand">
        {hand.map((card, index) => (
          <Card
            key={`${cardKey(card)}-${index}`}
            suit={card.suit}
            rank={card.rank}
            selected={selectedKeys.includes(cardKey(card))}
            onClick={onCardClick ? () => onCardClick(card) : undefined}
          />
        ))}
      </section>

      <div class="player-controls" data-zone="player-controls" aria-label="Actions">
        {children}
      </div>
    </div>
  );
}
