import { useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Card, isRedSuit, suitSymbol, type CardData } from './Card';
import { CardBack } from './CardBack';
import { SortBar, type SortMode } from './SortBar';
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

/** Where the active bout is anchored: a seat, or the viewer's own edge. */
export type BoutAnchor = SeatPosition | 'bottom';

export type RedirectDirection = SeatPosition | 'bottom' | 'shuffle';

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
  /** Chaos Mode: the attacker may target any active opponent. */
  chaosMode?: boolean;
  /** True while the viewer is the attacker who owes an attack or throw-in. */
  awaitingAttack?: boolean;
  /** True while the viewer is the defender facing uncovered attacks. */
  defending?: boolean;
  /** True while a redirect is legal for the viewer. */
  canRedirect?: boolean;
  /** True while the viewer may throw in a matching card. */
  canThrowIn?: boolean;
  selectedKeys?: string[];
  onCardClick?: (card: CardData) => void;
  onCardDoubleClick?: (card: CardData) => void;
  onTableCardClick?: (attackIndex: number) => void;
  /** A hand card was dropped on a legal attack target. */
  onAttackDrop?: (card: CardData, targetDefender?: string) => void;
  /** A hand card was dropped on an uncovered attack. */
  onCoverDrop?: (card: CardData, attackIndex: number) => void;
  /** A hand card was dropped on the throw-in slot. */
  onThrowInDrop?: (card: CardData) => void;
  /** A hand card was dropped on the reflection outline. */
  onRedirectDrop?: (card: CardData) => void;
  children?: ComponentChildren;
}

/** Minimal structural view of a drag event so handlers stay testable. */
interface DragLike {
  preventDefault(): void;
  stopPropagation(): void;
  dataTransfer: { getData(format: string): string } | null;
  clientX: number;
  clientY: number;
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

/** Snap radius for magnetic drag-and-drop. */
export const SNAP_DISTANCE_PX = 48;

export const cardKey = (card: CardData): string =>
  `${card.suit.toLowerCase()}:${card.rank.toLowerCase()}`;

const suitIndex = (suit: string): number => SUIT_ORDER[suit.toLowerCase()] ?? 9;

const rankValue = (rank: string): number => RANK_ORDER[rank.toLowerCase()] ?? 0;

const isTrumpCard = (card: CardData, trumpSuit: string): boolean =>
  trumpSuit.length > 0 && card.suit.toLowerCase() === trumpSuit.toLowerCase();

/**
 * Reorders the viewer's hand for display only.
 * - `suit`: grouped by suit, ascending rank inside each suit, trump suit last.
 * - `pairs`: pure ascending rank, so equal ranks (pairs) sit together.
 * - `rank`: ascending rank with every trump card ranked above every non-trump.
 */
export function sortHand(
  hand: CardData[],
  mode: SortMode = 'suit',
  trumpSuit = '',
): CardData[] {
  const cards = [...hand];
  const byRank = (left: CardData, right: CardData): number =>
    rankValue(left.rank) - rankValue(right.rank) || suitIndex(left.suit) - suitIndex(right.suit);

  switch (mode) {
    case 'pairs':
      return cards.sort(byRank);
    case 'rank':
      return cards.sort((left, right) => {
        const trumpDiff =
          (isTrumpCard(left, trumpSuit) ? 1 : 0) - (isTrumpCard(right, trumpSuit) ? 1 : 0);
        return trumpDiff !== 0 ? trumpDiff : byRank(left, right);
      });
    case 'suit':
    default:
      return cards.sort((left, right) => {
        const trumpDiff =
          (isTrumpCard(left, trumpSuit) ? 1 : 0) - (isTrumpCard(right, trumpSuit) ? 1 : 0);
        if (trumpDiff !== 0) return trumpDiff;
        return suitIndex(left.suit) - suitIndex(right.suit) || byRank(left, right);
      });
  }
}

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

/** Card-shaped reflection icon: arrows toward the receiving seat, or a shuffle. */
function RedirectIcon({
  chaosMode,
  direction,
}: {
  chaosMode: boolean;
  direction: RedirectDirection;
}) {
  if (chaosMode) {
    return (
      <svg
        class="redirect-arrows"
        data-icon="shuffle"
        viewBox="0 0 72 104"
        role="img"
        aria-label="Random redirect"
      >
        <path
          d="M18 38 L54 50 M54 50 L41 49 M54 50 L45 41"
          fill="none"
          stroke="#d9a326"
          stroke-width="4"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          d="M18 50 L54 38 M54 38 L41 39 M54 38 L45 47"
          fill="none"
          stroke="#d9a326"
          stroke-width="4"
          stroke-linecap="round"
          stroke-linejoin="round"
          opacity="0.6"
        />
      </svg>
    );
  }

  const rotation =
    direction === 'top-left'
      ? -35
      : direction === 'top-right'
        ? 35
        : direction === 'bottom'
          ? 180
          : 0;

  return (
    <svg
      class="redirect-arrows"
      data-icon="arrow"
      viewBox="0 0 72 104"
      role="img"
      aria-label="Redirect to the next player"
    >
      <g transform={`rotate(${rotation} 36 46)`}>
        <path d="M36 16 L47 32 L41 32 L41 58 L31 58 L31 32 L25 32 Z" fill="#d9a326" />
        <path
          d="M20 68 L52 68"
          fill="none"
          stroke="#d9a326"
          stroke-width="3"
          stroke-linecap="round"
          opacity="0.8"
        />
        <path
          d="M20 76 L52 76"
          fill="none"
          stroke="#d9a326"
          stroke-width="3"
          stroke-linecap="round"
          opacity="0.45"
        />
      </g>
    </svg>
  );
}

/**
 * The felt arena as a 3x3 CSS Grid: opponents across the top row, the active
 * bout in the middle row anchored to the defender, and the talon deck, the
 * viewer's hand, and the contextual controls in the bottom row.
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
  chaosMode = false,
  awaitingAttack = false,
  defending = false,
  canRedirect = false,
  canThrowIn = false,
  selectedKeys = [],
  onCardClick,
  onCardDoubleClick,
  onTableCardClick,
  onAttackDrop,
  onCoverDrop,
  onThrowInDrop,
  onRedirectDrop,
  children,
}: GameTableProps) {
  const [sortMode, setSortMode] = useState<SortMode>('suit');
  const [dragCard, setDragCard] = useState<CardData | null>(null);
  const [snapZone, setSnapZone] = useState<string | null>(null);
  const arenaRef = useRef<HTMLDivElement>(null);

  const hand = sortHand(myHand, sortMode, trumpSuit);
  const seats = assignSeats(opponents);

  // Rhythm nudges go only to the client that has to act: uncovered attacks for
  // the defender, the whole hand for the attacker who owes a play.
  const handClasses = ['player-hand'];
  if (awaitingAttack) handClasses.push('turn-pulse');

  // Target outlines appear before the first card of a bout: one in front of the
  // clockwise defender, or every legal opponent under Chaos Mode.
  const attackTargets =
    awaitingAttack && tablePairs.length === 0
      ? chaosMode
        ? opponents.filter((opponent) => opponent.finishRank == null && opponent.cardCount > 0)
        : opponents.filter((opponent) => opponent.id === defenderId)
      : [];

  const boutAnchor: BoutAnchor =
    defenderId === myId
      ? 'bottom'
      : seats.find((seat) => seat.opponent.id === defenderId)?.position ?? 'top-center';

  const activeSeats = seats.filter((seat) => seat.opponent.finishRank == null);
  const redirectDirection: RedirectDirection = chaosMode
    ? 'shuffle'
    : defenderId === myId
      ? (activeSeats[0]?.position ?? 'top-center')
      : (() => {
          const defenderSeatIdx = activeSeats.findIndex(
            (seat) => seat.opponent.id === defenderId,
          );
          const next =
            defenderSeatIdx >= 0
              ? activeSeats[(defenderSeatIdx + 1) % activeSeats.length]
              : activeSeats[0];
          return next?.position ?? 'top-center';
        })();

  const draggable = Boolean(onAttackDrop || onCoverDrop || onThrowInDrop || onRedirectDrop);

  const readDraggedCard = (event: DragLike): CardData | null => {
    if (dragCard) return dragCard;
    const transfer =
      event.dataTransfer && typeof event.dataTransfer.getData === 'function'
        ? event.dataTransfer.getData('text/plain')
        : '';
    const [suit, rank] = transfer.split(':');
    return (
      myHand.find(
        (card) =>
          card.suit.toLowerCase() === suit && card.rank.toLowerCase() === rank,
      ) ?? null
    );
  };

  const clearSnap = () => setSnapZone(null);

  const hoverZone = (zone: string) => (event: DragLike) => {
    event.preventDefault();
    event.stopPropagation();
    setSnapZone(zone);
  };

  const dropOn = (zone: string, event: DragLike, handler: (card: CardData) => void) => {
    event.preventDefault();
    event.stopPropagation();
    const card = readDraggedCard(event);
    setDragCard(null);
    setSnapZone(null);
    if (!card) {
      console.warn(`Ignored drop on ${zone}: no card was dragged`);
      return;
    }
    handler(card);
  };

  /** Magnetic snap: highlight the nearest drop zone within 48px of the pointer. */
  const magnetize = (event: DragLike) => {
    const arena = arenaRef.current;
    if (!arena || typeof arena.querySelectorAll !== 'function') return;
    const zones = Array.from(arena.querySelectorAll('[data-drop-zone]')) as HTMLElement[];
    let nearest: string | null = null;
    let nearestDistance = SNAP_DISTANCE_PX;
    for (const zone of zones) {
      const rect = zone.getBoundingClientRect ? zone.getBoundingClientRect() : null;
      if (!rect || (rect.width === 0 && rect.height === 0)) continue;
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= nearestDistance) {
        nearest = zone.getAttribute('data-drop-zone');
        nearestDistance = distance;
      }
    }
    if (nearest) setSnapZone(nearest);
  };

  const boutClasses = ['bout-area'];

  return (
    <div
      class="table-arena"
      data-zone="table-arena"
      data-my-id={myId}
      data-chaos={chaosMode ? 'true' : 'false'}
      ref={arenaRef}
      onDragOver={draggable ? magnetize : undefined}
      onDragEnd={draggable ? clearSnap : undefined}
    >
      {seats.map(({ opponent, offset, position }) => {
        const classes = ['seat', `seat-${position}`];
        if (opponent.id === attackerId) classes.push('active-attacker');
        if (opponent.id === defenderId) classes.push('active-defender');
        if (opponent.finishRank != null) classes.push('finished');
        const isTarget = attackTargets.some((target) => target.id === opponent.id);
        const zone = `target:${opponent.id}`;
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
            {isTarget ? (
              <div
                class={`target-outline${snapZone === zone ? ' snap-active' : ''}`}
                data-testid={`target-outline-${opponent.id}`}
                data-drop-zone={zone}
                aria-label={`Attack ${opponent.name}`}
                onDragOver={hoverZone(zone)}
                onDragLeave={clearSnap}
                onDrop={(event) =>
                  dropOn(zone, event, (card) => onAttackDrop?.(card, opponent.id))
                }
              />
            ) : null}
          </div>
        );
      })}

      <section
        class={boutClasses.join(' ')}
        data-zone="bout"
        data-anchor={boutAnchor}
        aria-label="Battle"
        data-drop-zone={canThrowIn ? 'throw-in' : undefined}
        onDragOver={canThrowIn ? hoverZone('throw-in') : undefined}
        onDragLeave={canThrowIn ? clearSnap : undefined}
        onDrop={
          canThrowIn
            ? (event) => dropOn('throw-in', event, (card) => onThrowInDrop?.(card))
            : undefined
        }
      >
        {tablePairs.map((pair, index) => {
          const zone = `cover:${index}`;
          const coverable = !pair.defense && Boolean(onCoverDrop);
          return (
            <TablePair
              key={index}
              attack={pair.attack}
              defense={pair.defense}
              trumpSuit={trumpSuit}
              pulse={defending && !pair.defense}
              snap={snapZone === zone}
              dropZone={coverable ? zone : undefined}
              onAttackClick={
                onTableCardClick && !pair.defense ? () => onTableCardClick(index) : undefined
              }
              onDragOverCard={coverable ? hoverZone(zone) : undefined}
              onDragLeaveCard={coverable ? clearSnap : undefined}
              onDropCard={
                coverable
                  ? (event) => dropOn(zone, event, (card) => onCoverDrop?.(card, index))
                  : undefined
              }
            />
          );
        })}

        {canRedirect && tablePairs.length > 0 ? (
          <div
            class={`redirect-outline${snapZone === 'redirect' ? ' snap-active' : ''}`}
            data-testid="redirect-outline"
            data-drop-zone="redirect"
            data-direction={redirectDirection}
            aria-label="Reflect the attack"
            onDragOver={hoverZone('redirect')}
            onDragLeave={clearSnap}
            onDrop={(event) =>
              dropOn('redirect', event, (card) => onRedirectDrop?.(card))
            }
          >
            <RedirectIcon chaosMode={chaosMode} direction={redirectDirection} />
          </div>
        ) : null}
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
                <Card suit={bottomTrumpCard.suit} rank={bottomTrumpCard.rank} trump />
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

      <section class={handClasses.join(' ')} data-zone="player-hand" aria-label="Your hand">
        {hand.map((card, index) => (
          <Card
            key={`${cardKey(card)}-${index}`}
            suit={card.suit}
            rank={card.rank}
            trump={isTrumpCard(card, trumpSuit)}
            selected={selectedKeys.includes(cardKey(card))}
            onClick={onCardClick ? () => onCardClick(card) : undefined}
            onDoubleClick={onCardDoubleClick ? () => onCardDoubleClick(card) : undefined}
            draggable={draggable}
            onDragStart={(event) => {
              setDragCard(card);
              event.dataTransfer?.setData('text/plain', cardKey(card));
            }}
            onDragEnd={() => {
              setDragCard(null);
              setSnapZone(null);
            }}
          />
        ))}
      </section>

      <div class="player-controls" data-zone="player-controls" aria-label="Actions">
        <SortBar mode={sortMode} onModeChange={setSortMode} />
        {children}
      </div>
    </div>
  );
}
