import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Card, isRedSuit, suitSymbol, type CardData } from './Card';
import { CardBack } from './CardBack';
import type { SortMode } from './SortBar';
import { TablePair } from './TablePair';
import { useSettings } from '../state/settings';
import { getTableFilterCss } from '../styles/tableTextures';
import { buildCoverCard, buildRedirectAttack, type GameAction } from '../types';
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
  trumpSuit: string;
  attackerId?: string;
  defenderId?: string;
  /** Chaos Mode: the attacker may target any active opponent. */
  chaosMode?: boolean;
  /** True while the viewer is the attacker who owes an attack or throw-in. */
  awaitingAttack?: boolean;
  /** True while the viewer is the defender facing uncovered attacks. */
  defending?: boolean;
  /** Backend bout phase; a surrendered bout slides toward the defender's seat. */
  boutPhase?: string;
  /** True while a redirect is legal for the viewer. */
  canRedirect?: boolean;
  /** True while the viewer may throw in a matching card. */
  canThrowIn?: boolean;
  /** Id of the player whose turn clock is running. */
  turnPlayerId?: string;
  /** Seconds left on the active turn clock (0..15). */
  turnSecondsRemaining?: number;
  /** Display order of the viewer's own hand; the dropdown lives in the sidebar. */
  sortMode?: SortMode;
  /**
   * Review mode: hides the command controls, drop outlines, drags, double-click
   * submission and turn glow, while hand sorting keeps working.
   */
  isReviewMode?: boolean;
  selectedKeys?: string[];
  /** Keys of hand cards that are legal to play right now; they lift off the hand. */
  playableKeys?: string[];
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
  dataTransfer: {
    getData(format: string): string;
    dropEffect?: string;
  } | null;
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

/** Every opponent box is exactly this size, so no seat looks bigger. */
export const SEAT_BOX = { width: 240, height: 140 } as const;

/** --- Hand overlap geometry --- */

/** Width of one hand card at desktop scale. */
export const HAND_CARD_WIDTH = 80;
/** Neighbouring hand cards never sit farther apart than this overlap. */
export const HAND_MIN_OVERLAP = 8;
/** Used until the hand has been measured (jsdom reports zero widths). */
export const HAND_FALLBACK_WIDTH = 720;
/** Width of one opponent card back inside a seat box. */
export const OPPONENT_CARD_WIDTH = 22;
/** Usable width of the fixed opponent card row. */
export const OPPONENT_CARDS_WIDTH = 208;
/** Opponent card backs always overlap at least this much. */
export const OPPONENT_MIN_OVERLAP = 4;

/** Left strip kept visible so the top-left rank/suit index stays readable. */
const readableEdge = (cardWidth: number): number =>
  Math.max(12, Math.round(cardWidth * 0.28));

export interface HandLayout {
  overlap: number;
  visibleCount: number;
  hiddenLeft: number;
  hiddenRight: number;
}

/**
 * Single-row hand layout. Cards start at an 8px overlap and tighten up to the
 * readable limit; beyond that the surplus cards are stacked at 100% overlap on
 * the ends, and `cursorFraction` (0 = left edge, 1 = right edge) slides them
 * between the two hidden stacks.
 */
export function handLayout(
  count: number,
  availableWidth: number,
  cursorFraction = 0.5,
  cardWidth = HAND_CARD_WIDTH,
): HandLayout {
  if (count <= 0) return { overlap: 0, visibleCount: 0, hiddenLeft: 0, hiddenRight: 0 };

  const maxOverlap = Math.max(HAND_MIN_OVERLAP, cardWidth - readableEdge(cardWidth));
  const step = cardWidth - maxOverlap;
  const capacity = Math.max(
    1,
    Math.floor(Math.max(0, availableWidth - cardWidth) / step) + 1,
  );

  if (count <= capacity) {
    const needed = count === 1 ? 0 : cardWidth - (availableWidth - cardWidth) / (count - 1);
    const overlap = Math.min(maxOverlap, Math.max(HAND_MIN_OVERLAP, needed));
    return { overlap, visibleCount: count, hiddenLeft: 0, hiddenRight: 0 };
  }

  const hidden = count - capacity;
  const fraction = Math.min(1, Math.max(0, cursorFraction));
  const hiddenLeft = Math.round(hidden * fraction);
  return {
    overlap: maxOverlap,
    visibleCount: capacity,
    hiddenLeft,
    hiddenRight: hidden - hiddenLeft,
  };
}

/** Left offset of every hand card inside the single row. */
export function handOffsets(
  layout: HandLayout,
  count: number,
  cardWidth = HAND_CARD_WIDTH,
): number[] {
  const step = cardWidth - layout.overlap;
  const lastVisible = Math.max(0, layout.visibleCount - 1);
  return Array.from({ length: count }, (_, index) => {
    const visibleIndex = index - layout.hiddenLeft;
    if (visibleIndex < 0) return 0;
    if (visibleIndex >= layout.visibleCount) return lastVisible * step;
    return visibleIndex * step;
  });
}

/** Negative left margin per card, so 100% overlap needs no positioning. */
export function handMargins(
  layout: HandLayout,
  count: number,
  cardWidth = HAND_CARD_WIDTH,
): number[] {
  const offsets = handOffsets(layout, count, cardWidth);
  return offsets.map((offset, index) =>
    index === 0 ? 0 : offset - offsets[index - 1] - cardWidth,
  );
}

/** Overlap for a fixed-width opponent card row; never reacts to the cursor. */
export function opponentOverlap(
  count: number,
  availableWidth = OPPONENT_CARDS_WIDTH,
  cardWidth = OPPONENT_CARD_WIDTH,
): number {
  if (count <= 1) return 0;
  const needed = cardWidth - (availableWidth - cardWidth) / (count - 1);
  const maxOverlap = Math.max(
    OPPONENT_MIN_OVERLAP,
    cardWidth - Math.max(6, Math.round(cardWidth * 0.28)),
  );
  return Math.min(maxOverlap, Math.max(OPPONENT_MIN_OVERLAP, needed));
}

/** Talon deck, revealed trump and TRUMP badge for the right sidebar. */
export interface TableDeckProps {
  talonCount: number;
  bottomTrumpCard?: CardData | null;
  trumpSuit: string;
  /** Cards already in the discard pile, shown as a face-down stack. */
  discardCount?: number;
  /** Most recent discard, revealed face-up on top of the pile. */
  lastDiscardCards?: CardData[];
}

export function TableDeck({
  talonCount,
  bottomTrumpCard,
  trumpSuit,
  discardCount = 0,
  lastDiscardCards = [],
}: TableDeckProps) {
  return (
    <div class="table-deck" data-zone="table-deck" aria-label="Talon">
      <h2 class="deck-title">Deck</h2>
      {/* The whole assembly is centred as one block, so the deck, the trump
          sticking out to its right and the badge underneath keep their
          relative positions. */}
      <div class="deck-assembly" data-testid="deck-assembly" data-align="center">
        <div class="talon-deck" data-testid="talon-deck" data-layout="horizontal-trump">
          <div class="talon-stack">
            <CardBack class="talon-back talon-back-second" />
            <CardBack class="talon-back" />
            <span
              class="talon-count deck-count-badge"
              data-testid="talon-count"
              data-position="top-left"
            >
              {talonCount}
            </span>
          </div>
          {talonCount > 0 && bottomTrumpCard ? (
            <div class="table-trump" aria-label="Bottom trump card">
              <div class="table-trump-card" data-rotated="true">
                <Card suit={bottomTrumpCard.suit} rank={bottomTrumpCard.rank} trump />
              </div>
            </div>
          ) : null}
        </div>
        <div
          class={`trump-badge ${isRedSuit(trumpSuit) ? 'red' : 'black'}`}
          data-testid="trump-indicator"
          data-suit={trumpSuit.toLowerCase()}
        >
          <span>Trump</span>
          <span class="trump-symbol">{suitSymbol(trumpSuit)}</span>
        </div>
      </div>

      {/* Req 7: the discard pile shares the DECK box. Every earlier discard is
          face-down; only the last finished bout is revealed on top. */}
      <div class="table-discard" data-testid="discard-pile" aria-label="Discard pile">
        <span class="discard-title">Discard</span>
        <div class="discard-stack">
          {discardCount > 0 ? (
            <div class="discard-face-down" data-testid="discard-face-down">
              <CardBack class="discard-back" />
              <span
                class="discard-count deck-count-badge"
                data-testid="discard-count"
                data-position="top-left"
              >
                {discardCount}
              </span>
            </div>
          ) : (
            <span class="discard-empty" data-testid="discard-empty">
              Empty
            </span>
          )}
          {lastDiscardCards.length > 0 ? (
            <div class="discard-last" data-testid="discard-last">
              {lastDiscardCards.map((card, index) => (
                <span key={`${card.suit}-${card.rank}-${index}`} class="discard-card">
                  <Card
                    suit={card.suit}
                    rank={card.rank}
                    trump={isTrumpCard(card, trumpSuit)}
                  />
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Small `00:XX` label used by the per-player clocks. */
export function formatSeatClock(seconds: number): string {
  const clamped = Math.max(0, Math.min(99, Math.round(seconds)));
  return `00:${String(clamped).padStart(2, '0')}`;
}

export const cardKey = (card: CardData): string =>
  `${card.suit.toLowerCase()}:${card.rank.toLowerCase()}`;

export interface RedirectOnlyContext {
  playerId: string;
  /** Redirecting is legal for this seat right now. */
  canRedirect: boolean;
  /** The card can legally cover at least one uncovered attack. */
  canCover: boolean;
  /** The card is a legal throw-in for this seat. */
  canThrowIn: boolean;
  isAttacker: boolean;
  isDefender: boolean;
  /** The card matches a rank on the table, the redirect precondition. */
  matchesTableRank: boolean;
}

/**
 * Resolves a double-clicked hand card whose only legal play is a redirect.
 * Returns `null` whenever any other move also applies, so an ambiguous card is
 * never guessed between covering and reflecting.
 */
export function redirectOnlyAction(
  card: CardData,
  context: RedirectOnlyContext,
): GameAction | null {
  const onlyRedirect =
    context.canRedirect &&
    context.isDefender &&
    !context.isAttacker &&
    !context.canCover &&
    !context.canThrowIn &&
    context.matchesTableRank;
  return onlyRedirect ? buildRedirectAttack(context.playerId, [card]) : null;
}

export interface DefenderDoubleClickContext {
  playerId: string;
  /** Indices of the uncovered attacks this card can legally cover. */
  coverableAttackIndices: number[];
  /** Covering is legal for this seat right now. */
  canCover: boolean;
  canRedirect: boolean;
  canThrowIn: boolean;
  /** The card matches a rank on the table, the redirect precondition. */
  matchesTableRank: boolean;
}

/**
 * Resolves a double-clicked defender card into exactly one action, or `null`
 * when the card is ambiguous. A card that could both cover and redirect (for
 * example a trump matching a non-trump attack's rank) has two legal plays, so
 * it is never guessed: the player drags it to the target or redirect outline.
 */
export function defenderDoubleClickAction(
  card: CardData,
  context: DefenderDoubleClickContext,
): GameAction | null {
  const coverTargets = context.canCover ? context.coverableAttackIndices : [];
  // Reflecting this card is possible in its own right, not merely because the
  // seat has a redirect available for some other card.
  const canRedirectCard = context.canRedirect && context.matchesTableRank;

  if (coverTargets.length === 1 && !canRedirectCard) {
    return buildCoverCard(context.playerId, coverTargets[0], card);
  }
  if (coverTargets.length > 0) return null;

  return redirectOnlyAction(card, {
    playerId: context.playerId,
    canRedirect: context.canRedirect,
    canCover: false,
    canThrowIn: context.canThrowIn,
    isAttacker: false,
    isDefender: true,
    matchesTableRank: context.matchesTableRank,
  });
}

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

/** True for the backend phases that follow a defender's surrender. */
export function isSurrenderedPhase(phase: string | undefined): boolean {
  if (!phase) return false;
  const token = phase.replace(/[^a-z]/gi, '').toLowerCase();
  return (
    token === 'surrendered' ||
    token === 'surrenderthrowin' ||
    token === 'phasesurrenderthrowin'
  );
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
  trumpSuit,
  attackerId,
  defenderId,
  chaosMode = false,
  awaitingAttack = false,
  defending = false,
  boutPhase,
  canRedirect = false,
  canThrowIn = false,
  turnPlayerId,
  turnSecondsRemaining = 15,
  sortMode = 'suit',
  isReviewMode = false,
  selectedKeys = [],
  playableKeys = [],
  onCardClick,
  onCardDoubleClick,
  onTableCardClick,
  onAttackDrop,
  onCoverDrop,
  onThrowInDrop,
  onRedirectDrop,
  children,
}: GameTableProps) {
  const [dragCard, setDragCard] = useState<CardData | null>(null);
  const [snapZone, setSnapZone] = useState<string | null>(null);
  const [handWidth, setHandWidth] = useState(0);
  const [cardWidth, setCardWidth] = useState(HAND_CARD_WIDTH);
  const [cursorFraction, setCursorFraction] = useState(0.5);
  const arenaRef = useRef<HTMLDivElement>(null);
  const handRef = useRef<HTMLDivElement>(null);
  const settings = useSettings();

  const hand = sortHand(myHand, sortMode, trumpSuit);
  const seats = assignSeats(opponents);

  // Measure the hand column so the overlap follows the real available space.
  useEffect(() => {
    const measure = () => {
      const node = handRef.current;
      if (!node) return;
      const available = node.parentElement?.clientWidth ?? node.clientWidth;
      setHandWidth(available);
      const card = node.querySelector('.card-slot') as HTMLElement | null;
      const measured = card?.offsetWidth ?? 0;
      if (measured > 0) setCardWidth(measured);
    };
    measure();
    if (typeof ResizeObserver !== 'undefined' && handRef.current?.parentElement) {
      const observer = new ResizeObserver(measure);
      observer.observe(handRef.current.parentElement);
      return () => observer.disconnect();
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    return undefined;
  }, []);

  const handLayoutState = handLayout(
    hand.length,
    handWidth > 0 ? handWidth : HAND_FALLBACK_WIDTH,
    cursorFraction,
    cardWidth,
  );
  const handMarginList = handMargins(handLayoutState, hand.length, cardWidth);
  const hiddenCards = handLayoutState.hiddenLeft + handLayoutState.hiddenRight;

  // Rhythm nudges go only to the client that has to act: uncovered attacks for
  // the defender, the whole hand for the attacker who owes a play. The pulse
  // sits on the cards container so the highlight hugs the cards tightly.
  const reviewMode = isReviewMode;
  const handClasses = ['player-hand'];
  const handCardClasses = ['hand-cards'];
  if (!reviewMode && awaitingAttack) {
    handClasses.push('turn-pulse');
    handCardClasses.push('attacker-turn');
  }
  if (!reviewMode && defending) handCardClasses.push('defender-turn');
  const activeSeconds = Math.max(0, Math.min(15, turnSecondsRemaining));
  const viewerOnClock = turnPlayerId === myId;

  // Target outlines appear before the first card of a bout: one in front of the
  // clockwise defender, or every legal opponent under Chaos Mode.
  const attackTargets =
    !reviewMode && awaitingAttack && tablePairs.length === 0
      ? chaosMode
        ? opponents.filter((opponent) => opponent.finishRank == null && opponent.cardCount > 0)
        : opponents.filter((opponent) => opponent.id === defenderId)
      : [];

  const boutAnchor: BoutAnchor =
    defenderId === myId
      ? 'bottom'
      : seats.find((seat) => seat.opponent.id === defenderId)?.position ?? 'top-center';

  // Item 11: once the defender surrenders, the cards in play slide toward the
  // surrendering player's box (their seat, or the viewer's own bottom edge).
  const surrendered = isSurrenderedPhase(boutPhase);
  const surrenderTarget: BoutAnchor = boutAnchor;

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

  // Review mode freezes the table: no drags, no drop surfaces, no submission.
  const draggable = !reviewMode && Boolean(onAttackDrop || onCoverDrop || onThrowInDrop || onRedirectDrop);
  const throwInEnabled = !reviewMode && canThrowIn;

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
    // Accept the drag across the whole arena. Without this the browser paints
    // its "no drop" cursor over the felt during the gesture.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
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
      class={`table-arena${dragCard ? ' dragging' : ''}`}
      data-zone="table-arena"
      data-my-id={myId}
      data-chaos={chaosMode ? 'true' : 'false'}
      data-review-mode={reviewMode ? 'true' : 'false'}
      data-dragging={dragCard ? 'true' : 'false'}
      data-texture={settings.tableTexture}
      style={{ '--table-filter': getTableFilterCss(settings.tableFilters) }}
      ref={arenaRef}
      onDragOver={draggable ? magnetize : undefined}
      onDragEnd={draggable ? clearSnap : undefined}
    >
      {seats.map(({ opponent, offset, position }) => {
        const classes = ['seat', `seat-${position}`];
        if (opponent.id === attackerId) classes.push('active-attacker');
        if (opponent.id === defenderId) classes.push('active-defender');
        if (opponent.finishRank != null) classes.push('finished');
        const onClock = turnPlayerId === opponent.id;
        return (
          <div
            key={opponent.id}
            class={classes.join(' ')}
            data-seat={position}
            data-offset={offset}
            data-testid="opponent"
            style={{
              '--seat-width': `${SEAT_BOX.width}px`,
              '--seat-height': `${SEAT_BOX.height}px`,
            }}
          >
            <span
              class={`seat-clock${onClock ? ' active' : ''}`}
              data-testid={`seat-clock-${opponent.id}`}
              data-active={onClock ? 'true' : 'false'}
            >
              {formatSeatClock(onClock ? activeSeconds : 15)}
            </span>
            <div class="seat-box">
              <div class="seat-head">
                <span class="opponent-avatar" aria-hidden="true">
                  {initials(opponent.name)}
                </span>
                <span class="opponent-name">{opponent.name}</span>
              </div>
              {/* The counter oval sits on the top-left corner of the hand and
                  the whole hand is centred inside the player box. */}
              <div class="opponent-hand">
                <span
                  class="opponent-card-count deck-count-badge"
                  data-testid={`opponent-card-count-${opponent.id}`}
                  data-position="top-left"
                >
                  {opponent.cardCount}
                </span>
                <div class="opponent-cards" aria-label={`${opponent.name}'s cards`}>
                  {Array.from({ length: opponent.cardCount }, (_, index) => (
                    <span
                      key={index}
                      class="opponent-card"
                      style={{
                        marginLeft:
                          index === 0 ? '0px' : `-${opponentOverlap(opponent.cardCount)}px`,
                      }}
                    >
                      <CardBack />
                    </span>
                  ))}
                </div>
              </div>
              {opponent.finishRank != null || opponent.hasPassed ? (
                <div class="seat-meta">
                  {opponent.finishRank != null ? (
                    <span class="opponent-rank">
                      {opponent.finishRank === 1 ? 'WINNER' : 'OUT'}
                    </span>
                  ) : null}
                  {opponent.hasPassed ? <span class="opponent-passed">Passed</span> : null}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}

      <section
        class={boutClasses.join(' ')}
        data-zone="bout"
        data-anchor={boutAnchor}
        aria-label="Battle"
        data-drop-zone={throwInEnabled ? 'throw-in' : undefined}
        onDragOver={throwInEnabled ? hoverZone('throw-in') : undefined}
        onDragLeave={throwInEnabled ? clearSnap : undefined}
        onDrop={
          throwInEnabled
            ? (event) => dropOn('throw-in', event, (card) => onThrowInDrop?.(card))
            : undefined
        }
      >
        {/* Item 7: the tinted play area keeps one fixed, table-relative size, so
            it never grows or shrinks with the number of cards in play. */}
        <div
          class="battlefield-tinted-box"
          data-testid="play-area-box"
          data-fixed-size="true"
          data-surrendered={surrendered ? 'true' : 'false'}
        >
          {/* Row 2 anchors the drop targets in front of each legal defender, so
              every seat box keeps identical dimensions. */}
          {attackTargets.map((target) => {
          const zone = `target:${target.id}`;
          const anchor =
            seats.find((seat) => seat.opponent.id === target.id)?.position ?? 'top-center';
          return (
            <div
              key={`target-${target.id}`}
              class={`target-outline bout-target${
                snapZone === zone ? ' snap-active' : ''
              }`}
              data-testid={`target-outline-${target.id}`}
              data-drop-zone={zone}
              data-anchor={anchor}
              aria-label={`Attack ${target.name}`}
              onDragOver={hoverZone(zone)}
              onDragLeave={clearSnap}
              onDrop={(event) =>
                dropOn(zone, event, (card) => onAttackDrop?.(card, target.id))
              }
            />
          );
        })}

        {/* Item 11: the pairs group carries the surrender state, so CSS can
            shift every card in play toward the surrendering player's box. */}
        <div
          class="table-pairs-group"
          data-testid="table-pairs-group"
          data-count={tablePairs.length}
          data-surrendered={surrendered ? 'true' : 'false'}
          data-surrender-target={surrendered ? surrenderTarget : undefined}
        >
          {tablePairs.map((pair, index) => {
            const zone = `cover:${index}`;
            const coverable = !reviewMode && !pair.defense && Boolean(onCoverDrop);
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
        </div>

          {!reviewMode && canRedirect && tablePairs.length > 0 ? (
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
        </div>
      </section>

      <section class={handClasses.join(' ')} data-zone="player-hand" aria-label="Your hand">
        <span
          class={`hand-clock${viewerOnClock ? ' active' : ''}`}
          data-testid="hand-clock"
          data-active={viewerOnClock ? 'true' : 'false'}
        >
          {formatSeatClock(viewerOnClock ? activeSeconds : 15)}
        </span>
        {/* Item 8: one highlight box wraps the whole card row, with symmetric
            padding so no lifted card can protrude out of it. */}
        <div
          class={handCardClasses.join(' ')}
          data-testid="hand-turn-highlight"
          data-active={!reviewMode && (awaitingAttack || defending) ? 'true' : 'false'}
          data-overlap={handLayoutState.overlap}
          data-hidden-left={handLayoutState.hiddenLeft}
          data-hidden-right={handLayoutState.hiddenRight}
          ref={handRef}
          onMouseMove={
            hiddenCards > 0
              ? (event) => {
                  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                  if (rect.width <= 0) return;
                  const fraction = (event.clientX - rect.left) / rect.width;
                  setCursorFraction(Math.min(1, Math.max(0, fraction)));
                }
              : undefined
          }
          onMouseLeave={hiddenCards > 0 ? () => setCursorFraction(0.5) : undefined}
        >
        {hand.map((card, index) => {
          const hidden =
            index < handLayoutState.hiddenLeft ||
            index >= handLayoutState.hiddenLeft + handLayoutState.visibleCount;
          return (
            <div
              key={`${cardKey(card)}-${index}`}
              class="hand-slot"
              data-hidden={hidden ? 'true' : 'false'}
              data-index={index}
              aria-hidden={hidden ? 'true' : undefined}
              style={{ marginLeft: `${handMarginList[index]}px` }}
            >
              <Card
                suit={card.suit}
                rank={card.rank}
                trump={isTrumpCard(card, trumpSuit)}
                selected={selectedKeys.includes(cardKey(card))}
                playable={playableKeys.includes(cardKey(card))}
                onClick={onCardClick ? () => onCardClick(card) : undefined}
                onDoubleClick={
                  !reviewMode && onCardDoubleClick
                    ? () => onCardDoubleClick(card)
                    : undefined
                }
                draggable={draggable}
                onDragStart={(event) => {
                  setDragCard(card);
                  if (event.dataTransfer) {
                    // A move drag keeps the pointer cursor instead of the copy arrow.
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', cardKey(card));
                  }
                }}
                onDragEnd={() => {
                  setDragCard(null);
                  setSnapZone(null);
                }}
              />
            </div>
          );
        })}
        </div>
      </section>

      {/* Row 3, column 3 holds only the contextual action buttons; the hand
          sorting dropdown lives in its own sidebar box under the deck. Review
          mode renders no gameplay command at all. */}
      {reviewMode ? null : (
        <div class="player-controls" data-zone="player-controls" aria-label="Actions">
          {children}
        </div>
      )}
    </div>
  );
}
