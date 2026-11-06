import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Card, isRedSuit, suitSymbol, type CardData } from './Card';
import { CardBack } from './CardBack';
import type { SortMode } from './SortBar';
import { TablePair } from './TablePair';
import { useSettings } from '../state/settings';
import { getTableFilterCss } from '../styles/tableTextures';
import {
  buildCoverCard,
  buildInitialAttack,
  buildRedirectAttack,
  type GameAction,
} from '../types';
import '../styles/table.css';

export interface OpponentSummary {
  id: string;
  name: string;
  cardCount: number;
  hasPassed: boolean;
  finishRank?: number | null;
  /** T-90-4 ITEM-10b: revealed hand, only sent by Transparent Mode / review. */
  cards?: CardData[];
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
  /**
   * Server-projected seats the attacker may aim at right now. Takes precedence
   * over the local Chaos/defender fallback when it is non-empty.
   */
  eligibleTargetIds?: string[];
  /** The seat a reflection would reach, so the arrow points at that player. */
  redirectTargetId?: string | null;
  /** The viewed seat is computer-controlled: the table accepts no move input. */
  isBot?: boolean;
  /** Alias of `isBot` for callers that name the seat instead of the view. */
  isBotSeat?: boolean;
  /** True while the viewer is the attacker who owes an attack or throw-in. */
  awaitingAttack?: boolean;
  /** True while the viewer is the defender facing uncovered attacks. */
  defending?: boolean;
  /**
   * T-90 ITEM-PREV-4a/4b: the uncovered attack prompt may be shown. GamePage
   * passes the authoritative decision (defender POV, `Defense` phase, not
   * surrendered, not review mode); when omitted the table derives it from its
   * own props so it can never prompt the wrong seat.
   */
  highlightUncovered?: boolean;
  /**
   * T-90-2 ITEM-PREV-4: the viewed seat is the defender of a bout they already
   * surrendered (or the phase is a surrender throw-in), so no hand glow may
   * prompt them for a move they no longer have.
   */
  isSurrenderingDefender?: boolean;
  /**
   * T-90-2 ITEM-PREV-4: the user already pressed `Surrender` (or the 3-second
   * client countdown pressed it for them) but the new projection has not landed
   * yet. The red defender glow drops immediately while the command is in flight.
   */
  surrenderTriggered?: boolean;
  /**
   * T-90-2 ITEM-PREV-4: the viewed seat is the defender and holds no legal cover
   * or redirect. This is only informational (`data-defenseless`): the decision to
   * surrender has not been made yet, so the red hand glow still shows while the
   * `3 → 2 → 1` countdown runs.
   */
  defenderDefenseless?: boolean;
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
  /** ITEM-10b: draw every opponent hand as a low-detail rank/suit mini-card. */
  transparentMode?: boolean;
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
  /** ITEM-6a/6b: a hand card was dragged to a new position inside the hand. */
  onReorderHand?: (cards: CardData[]) => void;
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
  currentTarget?: EventTarget | null;
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

/** Snap radius for magnetic drag-and-drop. */
export const SNAP_DISTANCE_PX = 48;

/** Every opponent box is exactly this size, so no seat looks bigger. */
export const SEAT_BOX = { width: 240, height: 140 } as const;

/** --- Hand overlap geometry --- */

/** ITEM-13: the single card size shared by the hand, the play area and the outlines. */
export const CARD_WIDTH = 100;
export const CARD_HEIGHT = 140;
/** ITEM-13: width of one hand card at desktop scale (+25% from 80). */
export const HAND_CARD_WIDTH = CARD_WIDTH;
/** ITEM-13: height of one hand card at desktop scale (+25% from 114). */
export const HAND_CARD_HEIGHT = CARD_HEIGHT;
/**
 * T-90-feedback-20261105_221105-2 ITEM-4: neighbouring hand cards overlap by
 * at least 20% of their width (`20px` of the 100px card), so the row parts
 * visibly while the left rank/suit index of every card stays readable.
 */
export const HAND_MIN_OVERLAP_RATIO = 0.2;
/**
 * T-90-feedback-20261105_221105-2 ITEM-4: at most 80% of each card is covered
 * (`80px` of the 100px card), which always leaves a `20px` visible left strip
 * carrying the top-left rank symbol and suit pip.
 */
export const HAND_MAX_OVERLAP_RATIO = 0.8;
export const HAND_MIN_OVERLAP = Math.round(HAND_CARD_WIDTH * HAND_MIN_OVERLAP_RATIO);
export const HAND_MAX_OVERLAP = Math.round(HAND_CARD_WIDTH * HAND_MAX_OVERLAP_RATIO);
/**
 * Full-deck pickup safeguard (25-52 cards): the stride may compress to this
 * `15px` strip before the whole `.hand-cards` row is scaled to fit instead.
 */
export const HAND_MIN_VISIBLE_LEFT = 15;
/** Used until the hand has been measured (jsdom reports zero widths). */
export const HAND_FALLBACK_WIDTH = 720;
/** T-90-feedback-2 ITEM-2: `.hand-cards` now wraps the exact card footprint. */
export const HAND_BOX_PADDING = 0;
/** T-90-feedback-2 ITEM-2: how far a playable / selected card rises. */
export const HAND_RAISED_OFFSET = -14;
/** T-90-feedback-2 ITEM-2: tight padding between the cards and the contour. */
export const HAND_CONTOUR_PADDING = 4;
/** Width of one talon deck card; the discard pile reuses the exact same size. */
export const DECK_CARD_WIDTH = 80;
/** Height of one talon deck card; the discard pile reuses the exact same size. */
export const DECK_CARD_HEIGHT = 114;
/** Inner width of the sidebar DECK box, used until the pile has been measured. */
export const DISCARD_FALLBACK_WIDTH = 236;
/**
 * ITEM-PREV-7b: the face-up discard row may cover the face-down stack, but the
 * stack always keeps this much of its left edge (the peek strip) visible.
 */
export const MIN_VISIBLE_STRIP_PX = 22;
/** Spec alias: the visible left strip of an overlapped card in any row. */
export const MIN_VISIBLE_CARD_LEFT_PX = MIN_VISIBLE_STRIP_PX;

/** Size of one card in play; mirrors `--bout-card-width/height` in table.css. */
export const BOUT_CARD_WIDTH = CARD_WIDTH;
export const BOUT_CARD_HEIGHT = CARD_HEIGHT;
/**
 * ITEM-NEW-2b: however many cards are in play, the left strip of every card —
 * where the rank and suit index are drawn — stays visible.
 */
export const BOUT_MIN_VISIBLE_LEFT = 22;
/** Comfortable gap between two cards in play while they still fit. */
export const BOUT_MIN_GAP = 4;
/** The defence card overhangs its attack card by this fraction of a card. */
export const BOUT_DEFENSE_OVERHANG_RATIO = 0.25;
/** Used until the defender's play area has been measured (jsdom reports zero). */
export const BOUT_FALLBACK_WIDTH = 420;

export interface BoutRowLayout {
  /** Distance between the left edges of two neighbouring cards in play. */
  step: number;
  /** Positive when the cards overlap; `0` or negative when they are spaced. */
  overlap: number;
}

/**
 * ITEM-NEW-2a/2b single-row play-area geometry. Cards sit a small gap apart
 * while the whole bout fits in the defender's area, then tighten into a
 * negative `margin-left` overlap as pairs are added. The step never drops below
 * [[BOUT_MIN_VISIBLE_LEFT]], so the left rank/suit strip of every card stays
 * readable even with six pairs plus the reflection outline on the table.
 */
export function boutLayout(
  slotCount: number,
  availableWidth = BOUT_FALLBACK_WIDTH,
  cardWidth = BOUT_CARD_WIDTH,
): BoutRowLayout {
  if (slotCount <= 1) return { step: 0, overlap: 0 };
  const overhang = Math.round(cardWidth * BOUT_DEFENSE_OVERHANG_RATIO);
  const comfortable = cardWidth + overhang + BOUT_MIN_GAP;
  const needed = (availableWidth - cardWidth) / (slotCount - 1);
  const step = Math.min(comfortable, Math.max(BOUT_MIN_VISIBLE_LEFT, needed));
  return { step, overlap: cardWidth - step };
}
/** Width of one opponent card back inside a seat box. */
export const OPPONENT_CARD_WIDTH = 22;
/** Usable width of the fixed opponent card row. */
export const OPPONENT_CARDS_WIDTH = 208;
/** Opponent card backs always overlap at least this much. */
export const OPPONENT_MIN_OVERLAP = 4;
/** ITEM-10b: size of the low-detail rank/suit card shown in Transparent Mode. */
export const LOW_DETAIL_CARD_WIDTH = 26;
export const LOW_DETAIL_CARD_HEIGHT = 36;

const RANK_SYMBOLS: Record<string, string> = {
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

/** `2`..`10`, `J`, `Q`, `K`, `A` for the low-detail opponent cards. */
export const lowDetailRank = (rank: string): string =>
  RANK_SYMBOLS[rank.toLowerCase()] ?? rank.toUpperCase();

export interface HandLayout {
  /** Pixels of each card covered by its right-hand neighbour. */
  overlap: number;
  /** `overlap / cardWidth`; 20-80% for a normal hand, more only on a full deck. */
  overlapRatio: number;
  /** Distance between the left edges of two neighbouring cards. */
  stride: number;
  /** Width of the whole row: `cardWidth + (count - 1) * stride`. */
  totalWidth: number;
  /** Fit multiplier applied when even the 15px strip cannot fit. */
  scale: number;
  visibleCount: number;
  hiddenLeft: number;
  hiddenRight: number;
}

const EMPTY_HAND_LAYOUT: HandLayout = {
  overlap: 0,
  overlapRatio: 0,
  stride: 0,
  totalWidth: 0,
  scale: 1,
  visibleCount: 0,
  hiddenLeft: 0,
  hiddenRight: 0,
};

/**
 * T-90-feedback-20261105_221105-2 ITEM-4 single-row hand geometry.
 *
 * For `N >= 2` cards of width `W` in `availableWidth`:
 * - the stride (left-edge distance) is clamped to `[0.20W, 0.80W]`, so the
 *   overlap ratio `(W - stride) / W` always stays within `[20%, 80%]`;
 * - when even the minimum `0.20W` stride cannot fit a picked-up full deck
 *   (25-52 cards), the stride may compress to the `15px` readable left strip;
 * - if the row still cannot fit, `scale` shrinks the whole hand so
 *   `totalWidth * scale` never exceeds `availableWidth` and never runs under
 *   the sidebar or the Surrender / Pass buttons.
 *
 * Every card stays visible: the old "hidden surplus stack" is gone.
 */
export function handLayout(
  count: number,
  availableWidth: number,
  _cursorFraction = 0.5,
  cardWidth = HAND_CARD_WIDTH,
): HandLayout {
  const width = Math.max(1, cardWidth);
  if (count <= 0) return { ...EMPTY_HAND_LAYOUT };
  if (count === 1) {
    return {
      overlap: 0,
      overlapRatio: 0,
      stride: width,
      totalWidth: width,
      scale: 1,
      visibleCount: 1,
      hiddenLeft: 0,
      hiddenRight: 0,
    };
  }

  const available = Math.max(0, availableWidth);
  const minStride = width * HAND_MIN_OVERLAP_RATIO;
  const maxStride = width * HAND_MAX_OVERLAP_RATIO;
  const idealStride = available > 0 ? (available - width) / (count - 1) : minStride;
  let stride = Math.min(maxStride, Math.max(minStride, idealStride));

  // Full-deck pickup safeguard: a 20% overlap can still overflow the column.
  if (width + (count - 1) * minStride > available) {
    stride = Math.max(HAND_MIN_VISIBLE_LEFT, (available - width) / (count - 1));
  }

  const totalWidth = width + (count - 1) * stride;
  const scale = available > 0 && totalWidth > available ? available / totalWidth : 1;
  const overlap = width - stride;

  return {
    overlap,
    overlapRatio: overlap / width,
    stride,
    totalWidth,
    scale,
    visibleCount: count,
    hiddenLeft: 0,
    hiddenRight: 0,
  };
}

/** Left offset of every hand card inside the single row. */
export function handOffsets(
  layout: HandLayout,
  count: number,
  cardWidth = HAND_CARD_WIDTH,
): number[] {
  const stride = layout.stride > 0 ? layout.stride : cardWidth - layout.overlap;
  // The discard pile still stacks its surplus cards on the row's ends.
  if (layout.hiddenLeft > 0 || layout.hiddenRight > 0) {
    const lastVisible = Math.max(0, layout.visibleCount - 1);
    return Array.from({ length: count }, (_, index) => {
      const visibleIndex = index - layout.hiddenLeft;
      if (visibleIndex < 0) return 0;
      if (visibleIndex >= layout.visibleCount) return lastVisible * stride;
      return visibleIndex * stride;
    });
  }
  return Array.from({ length: count }, (_, index) => index * stride);
}

/** Negative left margin per card, so the overlap needs no positioning. */
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

/**
 * Rendered width of a single overlap row: from the first card's left edge to the
 * last card's right edge. Exported so the discard pile can prove that its row
 * never exceeds the pile box's available inner width.
 */
export function rowWidth(layout: HandLayout, cardWidth = HAND_CARD_WIDTH): number {
  if (layout.visibleCount <= 0) return 0;
  if (layout.totalWidth > 0) return layout.totalWidth;
  const stride = cardWidth - layout.overlap;
  return (layout.visibleCount - 1) * stride + cardWidth;
}

/** Narrowest left strip a clipped discard row keeps visible. */
const readableEdge = (cardWidth: number): number =>
  Math.max(12, Math.round(cardWidth * 0.28));

/**
 * The discard pile keeps its own clipped single-row geometry: unlike the
 * player's hand (T-90-feedback-2 ITEM-4), a discarded bout may be dozens of
 * cards long, so the surplus becomes an end stack the cursor slides between
 * instead of pushing the row outside the sidebar.
 */
export function discardLayout(
  count: number,
  availableWidth: number,
  cursorFraction = 0.5,
  cardWidth = DECK_CARD_WIDTH,
): HandLayout {
  if (count <= 0) return { ...EMPTY_HAND_LAYOUT };

  const maxOverlap = Math.max(HAND_MIN_OVERLAP, cardWidth - readableEdge(cardWidth));
  const step = cardWidth - maxOverlap;
  const capacity = Math.max(
    1,
    Math.floor(Math.max(0, availableWidth - cardWidth) / step) + 1,
  );

  let overlap: number;
  let visibleCount: number;
  let hiddenLeft = 0;
  let hiddenRight = 0;
  if (count <= capacity) {
    const needed = count === 1 ? 0 : cardWidth - (availableWidth - cardWidth) / (count - 1);
    overlap = Math.min(maxOverlap, Math.max(HAND_MIN_OVERLAP, needed));
    visibleCount = count;
  } else {
    const hidden = count - capacity;
    const fraction = Math.min(1, Math.max(0, cursorFraction));
    overlap = maxOverlap;
    visibleCount = capacity;
    hiddenLeft = Math.round(hidden * fraction);
    hiddenRight = hidden - hiddenLeft;
  }

  const stride = cardWidth - overlap;
  return {
    overlap,
    overlapRatio: overlap / cardWidth,
    stride,
    totalWidth: (visibleCount - 1) * stride + cardWidth,
    scale: 1,
    visibleCount,
    hiddenLeft,
    hiddenRight,
  };
}

/** One card's rectangle inside `.hand-cards`, in row coordinates. */
export interface HandCardPosition {
  x: number;
  y: number;
}

/** Tight contour around the whole hand, ready to anchor an SVG overlay. */
export interface HandContour {
  d: string;
  left: number;
  top: number;
  width: number;
  height: number;
  nonRectangular: boolean;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * T-90-feedback-20261105_221105-2 ITEM-2: the tight union outline of every card
 * rectangle (`[x, x + W] x [y, y + H]`, plus a 4px pad).
 *
 * The upper envelope is traced left-to-right and the lower envelope
 * right-to-left across every x breakpoint, so a hand whose playable / selected
 * cards are raised produces a non-rectangular staircase: it steps up tightly
 * over a raised card and down again over its unraised neighbour.
 */
export function computeHandContour(
  cards: HandCardPosition[],
  cardWidth = HAND_CARD_WIDTH,
  cardHeight = HAND_CARD_HEIGHT,
  pad = HAND_CONTOUR_PADDING,
): HandContour {
  if (cards.length === 0) {
    return { d: '', left: 0, top: 0, width: 0, height: 0, nonRectangular: false };
  }

  const rects = cards.map((card) => ({
    left: card.x - pad,
    right: card.x + cardWidth + pad,
    top: card.y - pad,
    bottom: card.y + cardHeight + pad,
  }));
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  const xs = Array.from(new Set(rects.flatMap((rect) => [rect.left, rect.right]))).sort(
    (a, b) => a - b,
  );

  // One envelope value per x interval; `xs` holds the shared breakpoints.
  const tops: number[] = [];
  const bottoms: number[] = [];
  for (let index = 0; index < xs.length - 1; index += 1) {
    const start = xs[index];
    const end = xs[index + 1];
    const middle = (start + end) / 2;
    const covering = rects.filter((rect) => rect.left <= middle && rect.right >= middle);
    tops.push(Math.min(...covering.map((rect) => rect.top)));
    bottoms.push(Math.max(...covering.map((rect) => rect.bottom)));
  }

  const x = (value: number): number => round2(value - left);
  const y = (value: number): number => round2(value - top);
  const last = xs.length - 1;
  const parts: string[] = [`M ${x(xs[0])} ${y(tops[0])}`];

  // Upper envelope, left to right.
  for (let index = 1; index < last; index += 1) {
    parts.push(`H ${x(xs[index])}`);
    if (tops[index] !== tops[index - 1]) parts.push(`V ${y(tops[index])}`);
  }
  parts.push(`H ${x(xs[last])}`);
  // Right edge, then the lower envelope right-to-left.
  parts.push(`V ${y(bottoms[bottoms.length - 1])}`);
  for (let index = bottoms.length - 1; index >= 0; index -= 1) {
    parts.push(`H ${x(xs[index])}`);
    if (index > 0 && bottoms[index - 1] !== bottoms[index]) {
      parts.push(`V ${y(bottoms[index - 1])}`);
    }
  }
  parts.push('Z');

  const nonRectangular = new Set(cards.map((card) => card.y)).size > 1;
  return {
    d: parts.join(' '),
    left,
    top,
    width: right - left,
    height: bottom - top,
    nonRectangular,
  };
}

/** The `d` attribute of [[computeHandContour]], for tests and callers. */
export function handContourPath(
  cards: HandCardPosition[],
  cardWidth = HAND_CARD_WIDTH,
  cardHeight = HAND_CARD_HEIGHT,
  pad = HAND_CONTOUR_PADDING,
): string {
  return computeHandContour(cards, cardWidth, cardHeight, pad).d;
}

/** ITEM-13: documented alias of [[handLayout]] used by the hand geometry spec. */
export const computeHandLayout = handLayout;
/** ITEM-13: documented alias of [[boutLayout]] used by the play-area spec. */
export const computeBoutLayout = boutLayout;

/** Overlap for a fixed-width opponent card row; never reacts to the cursor. */
export function opponentOverlap(
  count: number,
  availableWidth = OPPONENT_CARDS_WIDTH,
  cardWidth = OPPONENT_CARD_WIDTH,
): number {
  if (count <= 1) return 0;
  const needed = cardWidth - (availableWidth - cardWidth) / (count - 1);
  // ITEM-13c: adjacent opponent mini-cards never sit flush or apart — they
  // always overlap by at least 10% of their own width (`>= 10px` on a 100px
  // card, `>= 4px` on the 22/26px opponent boxes), then tighten further as the
  // hand grows so the whole row stays centred inside the seat box.
  const minOverlap = Math.max(OPPONENT_MIN_OVERLAP, Math.round(cardWidth * 0.1));
  const maxOverlap = Math.max(
    minOverlap,
    cardWidth - Math.max(6, Math.round(cardWidth * 0.28)),
  );
  return Math.min(maxOverlap, Math.max(minOverlap, needed));
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
  const discardRef = useRef<HTMLDivElement>(null);
  const deckRef = useRef<HTMLDivElement>(null);
  const [discardWidth, setDiscardWidth] = useState(0);
  const [deckCardWidth, setDeckCardWidth] = useState(DECK_CARD_WIDTH);
  const [discardCursor, setDiscardCursor] = useState(0.5);

  // Item 7b/7c: the pile follows the hand's single-row geometry, measured on
  // the pile box itself, and reuses the talon deck's real card width.
  useEffect(() => {
    const measure = () => {
      const box = discardRef.current;
      if (box && box.clientWidth > 0) setDiscardWidth(box.clientWidth);
      const deckCard = deckRef.current?.querySelector('.talon-back') as HTMLElement | null;
      const measured = deckCard?.offsetWidth ?? 0;
      if (measured > 0) setDeckCardWidth(measured);
    };
    measure();
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      if (discardRef.current) observer.observe(discardRef.current);
      if (deckRef.current) observer.observe(deckRef.current);
    }
    if (typeof window !== 'undefined') window.addEventListener('resize', measure);
    return () => {
      if (observer) observer.disconnect();
      if (typeof window !== 'undefined') window.removeEventListener('resize', measure);
    };
  }, []);

  // Item 7a: no discard counter any more. Item PB-7: the pile splits into a
  // single stationary face-down stack (every earlier bout) and the responsive
  // face-up row (the last finished bout), so the overlap geometry only ever
  // applies to the visible cards.
  const faceDownCount = Math.max(0, discardCount - lastDiscardCards.length);
  const discardAvailable = Math.max(
    deckCardWidth,
    discardWidth > 0 ? discardWidth : DISCARD_FALLBACK_WIDTH,
  );
  // ITEM-PREV-7b: the revealed face-up row overlaps the stationary face-down
  // stack by the maximum allowed margin — the leftmost revealed card is pulled
  // left by `cardWidth - MIN_VISIBLE_STRIP_PX`, which leaves exactly the peek
  // strip of the face-down stack visible on the left.
  const overlapsFaceDown = faceDownCount > 0 && lastDiscardCards.length > 0;
  const faceDownOverlap = overlapsFaceDown
    ? Math.max(0, deckCardWidth - MIN_VISIBLE_STRIP_PX)
    : 0;
  // ITEM-PREV-7a: the revealed cards spread over the pile width that remains
  // right of the peek strip, so a larger pile gives them more room.
  const visibleAvailable = Math.max(
    deckCardWidth,
    overlapsFaceDown ? discardAvailable - MIN_VISIBLE_STRIP_PX : discardAvailable,
  );
  const visibleLayout = discardLayout(
    lastDiscardCards.length,
    visibleAvailable,
    discardCursor,
    deckCardWidth,
  );
  const visibleMargins = handMargins(visibleLayout, lastDiscardCards.length, deckCardWidth);
  const discardHidden = visibleLayout.hiddenLeft + visibleLayout.hiddenRight;
  // ITEM-PREV-7c: only a row that does not fit even at maximum overlap becomes
  // cursor-slidable; otherwise the mouse animation never runs.
  const discardInteractive = discardHidden > 0;
  const hasDiscard = faceDownCount + lastDiscardCards.length > 0;

  return (
    <div class="table-deck" data-zone="table-deck" aria-label="Talon">
      <h2 class="deck-title">Deck</h2>
      {/* The whole assembly is centred as one block, so the deck, the trump
          sticking out to its right and the badge underneath keep their
          relative positions. */}
      <div class="deck-assembly" data-testid="deck-assembly" data-align="center">
        <div
          class="talon-deck"
          data-testid="talon-deck"
          data-layout="horizontal-trump"
          ref={deckRef}
        >
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
                {/* The bottom trump keeps the sidebar deck's compact footprint. */}
                <Card
                  suit={bottomTrumpCard.suit}
                  rank={bottomTrumpCard.rank}
                  trump
                  width={deckCardWidth}
                  height={Math.round((deckCardWidth * DECK_CARD_HEIGHT) / DECK_CARD_WIDTH)}
                />
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

      {/* Req 7: the discard pile shares the DECK box. There is no counter any
          more: every discarded card is drawn in one overlapping row, earlier
          bouts face-down and the last finished bout face-up. */}
      <div
        class="table-discard"
        data-testid="discard-pile"
        aria-label="Discard pile"
        ref={discardRef}
      >
        <span class="discard-title">Discard</span>
        {hasDiscard ? (
          <div
            class="discard-stack"
            data-testid="discard-stack"
            data-facedown-count={faceDownCount}
            data-card-width={deckCardWidth}
            data-available-width={discardAvailable}
          >
            {/* ITEM-PB-7: every earlier discard is one stationary stack with
                100% overlap. It takes no pointer events and follows no cursor,
                so hovering it never lifts or slides anything. */}
            {faceDownCount > 0 ? (
              <div
                class="discard-facedown-stack"
                data-testid="discard-facedown-stack"
                data-count={faceDownCount}
                aria-hidden="true"
              >
                {Array.from({ length: faceDownCount }, (_, index) => (
                  <span
                    key={`discard-back-${index}`}
                    class="discard-slot discard-facedown-card"
                    data-face="down"
                    data-index={index}
                  >
                    <CardBack class="discard-back" />
                  </span>
                ))}
              </div>
            ) : null}
            {/* ITEM-PB-7: only the visible face-up cards use the hand's
                single-row overlap, measured against the remaining width. */}
            {lastDiscardCards.length > 0 ? (
              <div
                class="discard-visible-row"
                data-testid="discard-visible-row"
                data-overlap={visibleLayout.overlap}
                data-hidden-left={visibleLayout.hiddenLeft}
                data-hidden-right={visibleLayout.hiddenRight}
                data-cursor-fraction={discardCursor}
                data-card-width={deckCardWidth}
                data-available-width={visibleAvailable}
                data-overlaps-facedown={overlapsFaceDown ? 'true' : 'false'}
                data-facedown-overlap-px={faceDownOverlap}
                data-interactive-overflow={discardInteractive ? 'true' : 'false'}
                style={{
                  marginLeft: faceDownOverlap > 0 ? `-${faceDownOverlap}px` : undefined,
                }}
                onMouseMove={
                  discardInteractive
                    ? (event) => {
                        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                        if (rect.width <= 0) return;
                        const fraction = (event.clientX - rect.left) / rect.width;
                        setDiscardCursor(Math.min(1, Math.max(0, fraction)));
                      }
                    : undefined
                }
                onMouseLeave={discardInteractive ? () => setDiscardCursor(0.5) : undefined}
              >
                {lastDiscardCards.map((card, index) => {
                  const hidden =
                    index < visibleLayout.hiddenLeft ||
                    index >= visibleLayout.hiddenLeft + visibleLayout.visibleCount;
                  return (
                    <span
                      key={`discard-${index}-${card.suit}-${card.rank}`}
                      class="discard-slot"
                      data-face="up"
                      data-hidden={hidden ? 'true' : 'false'}
                      data-index={index}
                      style={{ marginLeft: `${visibleMargins[index]}px` }}
                    >
                      <Card
                        suit={card.suit}
                        rank={card.rank}
                        trump={isTrumpCard(card, trumpSuit)}
                      />
                    </span>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : (
          <span class="discard-empty" data-testid="discard-empty">
            Empty
          </span>
        )}
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
  mode: SortMode = 'rank',
  trumpSuit = '',
): CardData[] {
  const cards = [...hand];
  const byRank = (left: CardData, right: CardData): number =>
    rankValue(left.rank) - rankValue(right.rank) || suitIndex(left.suit) - suitIndex(right.suit);

  switch (mode) {
    case 'custom':
      // ITEM-6b: the player's own arrangement, applied before the table renders.
      return cards;
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

/** Numeric seat of a `p<index>` id, or `null` for an unrecognised id. */
export function seatIndexOf(playerId: string): number | null {
  const match = /^p(\d+)$/.exec(playerId);
  return match ? Number(match[1]) : null;
}

/** A seat reduced to what the reflection target needs to know. */
export interface SeatedPlayer {
  id: string;
  cardCount: number;
  finished?: boolean;
}

/**
 * The next seat clockwise (`p0 -> p1 -> ... -> p0`) after `afterId` that still
 * holds cards. The reflection arrow must point at the player who will actually
 * receive the attack, not at the seat that just played it — in a 3-player game
 * Bob defending Alice's attack reflects onto Carol, never back onto Alice.
 */
export function nextPlayerWithCards(
  afterId: string,
  players: SeatedPlayer[],
): string | null {
  const seatNumber = (id: string): number => seatIndexOf(id) ?? Number.MAX_SAFE_INTEGER;
  const ordered = [...players].sort((left, right) => seatNumber(left.id) - seatNumber(right.id));
  const start = ordered.findIndex((player) => player.id === afterId);
  const isReceiver = (player: SeatedPlayer): boolean =>
    player.id !== afterId && !player.finished && player.cardCount > 0;

  if (start < 0) return ordered.find(isReceiver)?.id ?? null;
  for (let step = 1; step <= ordered.length; step += 1) {
    const candidate = ordered[(start + step) % ordered.length];
    if (isReceiver(candidate)) return candidate.id;
  }
  return null;
}

export interface AttackTargetContext {
  myId: string;
  opponents: OpponentSummary[];
  defenderId?: string;
  chaosMode?: boolean;
  /** Server-projected legal targets; takes precedence when non-empty. */
  eligibleTargetIds?: string[];
}

/** Every seat the viewer may aim an opening attack at, in opponent order. */
export function attackTargetIds(context: AttackTargetContext): string[] {
  const {
    myId,
    opponents,
    defenderId,
    chaosMode = false,
    eligibleTargetIds = [],
  } = context;
  if (eligibleTargetIds.length > 0) {
    return opponents
      .filter((opponent) => opponent.id !== myId && eligibleTargetIds.includes(opponent.id))
      .map((opponent) => opponent.id);
  }
  if (chaosMode) {
    return opponents
      .filter((opponent) => opponent.finishRank == null && opponent.cardCount > 0)
      .map((opponent) => opponent.id);
  }
  return defenderId
    ? opponents.filter((opponent) => opponent.id === defenderId).map((opponent) => opponent.id)
    : [];
}

/**
 * Resolves a double-clicked hand card during the opening attack. Only a single
 * eligible target is unambiguous; with several Chaos targets the player drags
 * the card onto the desired player's outline instead of guessing.
 */
export function initialAttackDoubleClickAction(
  card: CardData,
  playerId: string,
  eligibleTargetIds: string[],
): GameAction | null {
  if (eligibleTargetIds.length !== 1) return null;
  return buildInitialAttack(playerId, [card], eligibleTargetIds[0]);
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

/**
 * ITEM-ADD-1a: canonical seat order `p0, p1, ..., p(N-1)` for the whole match,
 * the viewer included. Seats are ordered by their numeric id; an id that does
 * not look like `p<index>` keeps its arrival order after the numbered seats.
 */
export function canonicalSeatOrder(
  opponents: OpponentSummary[],
  myId = 'p0',
): string[] {
  const seatNumber = (id: string): number => seatIndexOf(id) ?? Number.MAX_SAFE_INTEGER;
  return [myId, ...opponents.map((opponent) => opponent.id)]
    .map((id, index) => ({ id, index, seat: seatNumber(id) }))
    .sort((left, right) => left.seat - right.seat || left.index - right.index)
    .map((entry) => entry.id);
}

/**
 * ITEM-ADD-1b: assigns every opponent the felt seat that is the same number of
 * clockwise steps away from the active user, whatever the seat numbering is, so
 * rotating the point of view rotates the whole opponent row consistently.
 */
export function assignSeats(
  opponents: OpponentSummary[],
  myId = 'p0',
): SeatAssignment[] {
  const playerCount = opponents.length + 1;
  const order = canonicalSeatOrder(opponents, myId);
  const myIndex = Math.max(0, order.indexOf(myId));
  return opponents.map((opponent, index) => {
    const opponentIndex = order.indexOf(opponent.id);
    const clockwise =
      opponentIndex < 0
        ? index + 1
        : (opponentIndex - myIndex + playerCount) % playerCount || playerCount;
    return {
      opponent,
      offset: clockwise,
      position: seatForOffset(clockwise, playerCount),
    };
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
  // ITEM-NEW-1a: the SVG plate inside the reflection outline follows the same
  // roundness slider as the CSS border around it, so the two can never disagree.
  const settings = useSettings();
  const plateRadius = Math.max(
    0,
    Math.min(34, Math.round(settings.roundness * (70 / HAND_CARD_WIDTH))),
  );
  const plate = (
    <rect
      class="redirect-plate"
      data-radius={plateRadius}
      x="1"
      y="1"
      width="70"
      height="102"
      rx={plateRadius}
      ry={plateRadius}
      fill="rgba(168, 85, 247, 0.06)"
    />
  );

  if (chaosMode) {
    return (
      <svg
        class="redirect-arrows"
        data-icon="shuffle"
        viewBox="0 0 72 104"
        role="img"
        aria-label="Random redirect"
      >
        {plate}
        <path
          d="M18 38 L54 50 M54 50 L41 49 M54 50 L45 41"
          fill="none"
          stroke="var(--redirect-accent, #a855f7)"
          stroke-width="4"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          d="M18 50 L54 38 M54 38 L41 39 M54 38 L45 47"
          fill="none"
          stroke="var(--redirect-accent, #a855f7)"
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
      {plate}
      <g transform={`rotate(${rotation} 36 46)`}>
        <path
          d="M36 16 L47 32 L41 32 L41 58 L31 58 L31 32 L25 32 Z"
          fill="var(--redirect-accent, #a855f7)"
        />
        <path
          d="M20 68 L52 68"
          fill="none"
          stroke="var(--redirect-accent, #a855f7)"
          stroke-width="3"
          stroke-linecap="round"
          opacity="0.8"
        />
        <path
          d="M20 76 L52 76"
          fill="none"
          stroke="var(--redirect-accent, #a855f7)"
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
  eligibleTargetIds = [],
  redirectTargetId = null,
  isBot = false,
  isBotSeat = false,
  awaitingAttack = false,
  defending = false,
  highlightUncovered,
  isSurrenderingDefender = false,
  surrenderTriggered = false,
  defenderDefenseless = false,
  boutPhase,
  canRedirect = false,
  canThrowIn = false,
  turnPlayerId,
  turnSecondsRemaining = 15,
  sortMode = 'rank',
  transparentMode = false,
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
  onReorderHand,
  children,
}: GameTableProps) {
  // ITEM-6a/7: one drag state feeds both the HTML5 reorder/play drops and the
  // pointer/mouse path, so the cursor and the parting animation are identical.
  const [dragCard, setDragCard] = useState<CardData | null>(null);
  const dragState = dragCard;
  const [snapZone, setSnapZone] = useState<string | null>(null);
  // ITEM-6a: insertion slot the dragged hand card would land in, or null when
  // the pointer is not over the hand row.
  const [reorderIndex, setReorderIndex] = useState<number | null>(null);
  const reorderIndexRef = useRef<number | null>(null);
  reorderIndexRef.current = reorderIndex;
  // A press only becomes a pointer drag after 4px of movement, so a plain click
  // and a double-click still play/select the card normally.
  const pointerDragRef = useRef<{
    card: CardData;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const [handWidth, setHandWidth] = useState(0);
  const [cardWidth, setCardWidth] = useState(HAND_CARD_WIDTH);
  const [cardHeight, setCardHeight] = useState(HAND_CARD_HEIGHT);
  // T-90-feedback-2 ITEM-3: the dragged card's pointer offset. It is applied as
  // a `translate3d` on the card's own wrapper, which stays fully visible.
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [boutWidth, setBoutWidth] = useState(0);
  const [boutCardWidth, setBoutCardWidth] = useState(BOUT_CARD_WIDTH);
  const arenaRef = useRef<HTMLDivElement>(null);
  const handRef = useRef<HTMLDivElement>(null);
  const handZoneRef = useRef<HTMLElement>(null);
  const battlefieldRef = useRef<HTMLDivElement>(null);
  const settings = useSettings();

  const hand = sortHand(myHand, sortMode, trumpSuit);
  // ITEM-ADD-1: seats are resolved from the viewer's own canonical index, so
  // the opponent row stays realistic from any player's point of view.
  const seats = assignSeats(opponents, myId);
  // ITEM-ADD-9: a bot seat accepts no user input at all, exactly like review
  // mode. `legalActions` is already empty for a bot on the server; this also
  // locks the local drag/double-click/drop surfaces.
  const isBotView = Boolean(isBot || isBotSeat);

  // Item 3a: measure the OUTER `[data-zone="player-hand"]` wrapper, never the
  // highlight box itself (it is sized by the very cards it wraps). The box pads
  // the row symmetrically, so the row may use the wrapper width minus padding.
  useEffect(() => {
    const measure = () => {
      const node = handRef.current;
      if (!node) return;
      const zone = handZoneRef.current ?? node.parentElement;
      const available = zone?.clientWidth ?? node.clientWidth;
      setHandWidth(available > 0 ? Math.max(0, available - HAND_BOX_PADDING * 2) : available);
      const card = node.querySelector('.card-slot') as HTMLElement | null;
      const measured = card?.offsetWidth ?? 0;
      if (measured > 0) setCardWidth(measured);
      const measuredHeight = card?.offsetHeight ?? 0;
      if (measuredHeight > 0) setCardHeight(measuredHeight);
    };
    measure();
    const zone = handZoneRef.current ?? handRef.current?.parentElement ?? null;
    if (typeof ResizeObserver !== 'undefined' && zone) {
      const observer = new ResizeObserver(measure);
      observer.observe(zone);
      return () => observer.disconnect();
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    return undefined;
  }, []);

  // ITEM-NEW-2a: measure the defender-anchored play area (inside its padding)
  // and the real card size in play, so the single row tightens on narrow tables.
  useEffect(() => {
    const measure = () => {
      const box = battlefieldRef.current;
      if (!box) return;
      const styles =
        typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
          ? window.getComputedStyle(box)
          : null;
      const padding = styles
        ? (parseFloat(styles.paddingLeft || '0') || 0) +
          (parseFloat(styles.paddingRight || '0') || 0)
        : 0;
      if (box.clientWidth > 0) setBoutWidth(Math.max(0, box.clientWidth - padding));
      const card = box.querySelector('.table-pair .card-slot') as HTMLElement | null;
      const measured = card?.offsetWidth ?? 0;
      if (measured > 0) setBoutCardWidth(measured);
    };
    measure();
    if (typeof ResizeObserver !== 'undefined' && battlefieldRef.current) {
      const observer = new ResizeObserver(measure);
      observer.observe(battlefieldRef.current);
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
    0.5,
    cardWidth,
  );
  const handMarginList = handMargins(handLayoutState, hand.length, cardWidth);

  // T-90-2 ITEM-6a: while a card is dragged out of the hand, the remaining
  // N - 1 cards compact into the sequence without it, so the original slot
  // closes exactly as if the card had been removed. The insertion gap is then
  // opened by the `data-part-direction` transforms on top of this live row.
  const draggedCardIndex =
    dragCard !== null
      ? hand.findIndex((candidate) => cardKey(candidate) === cardKey(dragCard))
      : -1;
  const gapClosed = draggedCardIndex >= 0;
  const compactHandLayoutState = gapClosed
    ? handLayout(
        Math.max(0, hand.length - 1),
        handWidth > 0 ? handWidth : HAND_FALLBACK_WIDTH,
        0.5,
        cardWidth,
      )
    : handLayoutState;
  const compactHandMargins = handMargins(
    compactHandLayoutState,
    Math.max(0, hand.length - 1),
    cardWidth,
  );
  const activeHandLayoutState = gapClosed ? compactHandLayoutState : handLayoutState;
  const handSlotMargin = (index: number): string => {
    if (!gapClosed) return `${handMarginList[index]}px`;
    if (index === draggedCardIndex) return '0px';
    const compactIndex = index > draggedCardIndex ? index - 1 : index;
    return `${compactIndex === 0 ? 0 : compactHandMargins[compactIndex]}px`;
  };

  // Rhythm nudges go only to the client that has to act: uncovered attacks for
  // the defender, the whole hand for the attacker who owes a play. The pulse
  // sits on the cards container so the highlight hugs the cards tightly.
  const reviewMode = isReviewMode || isBotView;
  // ITEM-PB-3: when every card in hand is legal, the outline travels with the
  // lifted cards instead of staying at the baseline. `data-all-legal` carries
  // the state so the stylesheet can translate the whole box.
  const activePlayableKeys = reviewMode ? [] : playableKeys;
  const allCardsLegal =
    !reviewMode &&
    hand.length > 0 &&
    hand.every((card) => activePlayableKeys.includes(cardKey(card)));
  // T-90-feedback-2 ITEM-2/ITEM-4: the exact footprint of every card in the
  // hand. `x` follows the overlapped stride, `y` drops to `-14px` for a card
  // that is raised because it is playable or selected. The SVG contour below is
  // built from these rectangles, so it always wraps the real cards tightly and
  // distorts non-rectangularly when only some of them are raised.
  const handCardPositions: HandCardPosition[] = hand.map((card, index) => {
    const key = cardKey(card);
    const raised =
      !reviewMode && (activePlayableKeys.includes(key) || selectedKeys.includes(key));
    return {
      x: index * activeHandLayoutState.stride,
      y: raised ? HAND_RAISED_OFFSET : 0,
    };
  });
  const handContour = computeHandContour(handCardPositions, cardWidth, cardHeight);
  const totalHandWidth = activeHandLayoutState.totalWidth;
  const handFitScale = activeHandLayoutState.scale;
  const handRenderedWidth = Math.max(0, Math.round(totalHandWidth * handFitScale));
  // T-90 ITEM-PREV-4a/4b: the highlight data attributes are mirrored onto the
  // outer `[data-zone="player-hand"]` wrapper for testability only. Every
  // visual glow rule is scoped to `.hand-cards`, and the wrapper is pinned to
  // border/outline/box-shadow/background/animation `none` in both themes, so
  // exactly one tight outline is ever drawn around the rendered cards.
  // `player-hand-zone` is the documented alias of the outer column: the
  // stylesheet's neutral reset names both, so neither can ever paint a second
  // (vertically wider) outline around the hand.
  const handClasses = ['player-hand', 'player-hand-zone'];
  const handCardClasses = ['hand-cards'];
  // Item 3b: the glow belongs to every player who can act — the opening
  // attacker AND any player holding a legal throw-in after the first card of
  // the bout has been played. It is never suppressed because cards are already
  // on the table or because some of them are covered.
  //
  // T-90-2 ITEM-PREV-4: the defender's hand keeps its red glow for the whole
  // `Defense` phase while uncovered attacks remain — including a defenceless
  // defender whose only legal action is `surrender` during the `3 → 2 → 1`
  // countdown, because the decision to surrender has not been executed yet.
  // The glow drops the instant `Surrender` is pressed (or presses itself) and
  // stays off for the surrendered hand while the bout moves into
  // `SurrenderThrowIn`.
  const surrenderingHand =
    isSurrenderingDefender ||
    surrenderTriggered ||
    (defending && isSurrenderedPhase(boutPhase));
  // T-90 ITEM-PREV-4a/4b: an uncovered card is only prompted to the bout's own
  // defender, only during `Defense`, only before the surrender decision, and
  // never in review/bot mode. `GamePage` passes the authoritative flag; the
  // derived fallback keeps standalone `GameTable` renders correct.
  const defensePhase =
    (boutPhase ?? '').replace(/[^a-z]/gi, '').toLowerCase() === 'defense';
  const uncoveredHighlightDerived =
    !reviewMode &&
    !surrenderingHand &&
    defending &&
    defenderId != null &&
    defenderId === myId &&
    defensePhase &&
    tablePairs.some((pair) => !pair.defense);
  const uncoveredHighlight =
    !reviewMode && (highlightUncovered ?? uncoveredHighlightDerived);
  const defenderTurn =
    !reviewMode &&
    !surrenderingHand &&
    defending &&
    !awaitingAttack &&
    tablePairs.some((pair) => !pair.defense);
  const throwInTurn = !reviewMode && canThrowIn;
  const handGlow =
    !reviewMode && !surrenderingHand && (awaitingAttack || canThrowIn || defenderTurn);
  // `defender` draws the crimson red glow, distinct from the amber attacker and
  // throw-in glows; `none` after the surrender decision is made.
  const handHighlightVariant: 'none' | 'defender' | 'attacker' | 'throw-in' = !handGlow
    ? 'none'
    : defenderTurn
      ? 'defender'
      : awaitingAttack
        ? 'attacker'
        : 'throw-in';
  if (handGlow && defenderTurn) {
    handClasses.push('turn-pulse', 'defender-turn');
    handCardClasses.push('defender-turn');
  }
  if (handGlow && awaitingAttack) {
    handClasses.push('turn-pulse');
    handCardClasses.push('attacker-turn');
  }
  if (handGlow && throwInTurn && !awaitingAttack) {
    handClasses.push('turn-pulse');
    handCardClasses.push('throw-in-turn');
  }
  const handTurnAction = reviewMode
    ? 'none'
    : awaitingAttack
      ? 'attack'
      : defending
        ? 'defend'
        : throwInTurn
          ? 'throw-in'
          : 'none';
  const activeSeconds = Math.max(0, Math.min(15, turnSecondsRemaining));
  const viewerOnClock = turnPlayerId === myId;

  // Target outlines appear before the first card of a bout: one in front of the
  // clockwise defender, or every legal opponent under Chaos Mode. The server's
  // `eligibleTargetIds` wins when it is present, so the outlines always match
  // the seats the engine would actually accept.
  const targetIds = attackTargetIds({
    myId,
    opponents,
    defenderId,
    chaosMode,
    eligibleTargetIds,
  });
  const attackTargets =
    !reviewMode && awaitingAttack && tablePairs.length === 0
      ? targetIds
          .map((id) => opponents.find((opponent) => opponent.id === id))
          .filter((opponent): opponent is OpponentSummary => opponent !== undefined)
      : [];

  const boutAnchor: BoutAnchor =
    defenderId === myId
      ? 'bottom'
      : seats.find((seat) => seat.opponent.id === defenderId)?.position ?? 'top-center';

  // Item 11: once the defender surrenders, the cards in play slide toward the
  // surrendering player's box (their seat, or the viewer's own bottom edge).
  const surrendered = isSurrenderedPhase(boutPhase);
  const surrenderTarget: BoutAnchor = boutAnchor;

  // ITEM-ADD-1: the reflection lands on the next seat clockwise after the
  // defender in absolute seat order (`p0 -> p1 -> p2 -> p0`), which is looked up
  // in THIS viewer's seat mapping. With Alice (p0) attacking Bob (p1), Bob sees
  // Alice top-left and Carol (p2) top-right, so the arrow points top-right.
  const seatedPlayers: SeatedPlayer[] = [
    { id: myId, cardCount: myHand.length },
    ...opponents.map((opponent) => ({
      id: opponent.id,
      cardCount: opponent.cardCount,
      finished: opponent.finishRank != null,
    })),
  ];
  const redirectTargetPlayerId =
    redirectTargetId ?? (defenderId ? nextPlayerWithCards(defenderId, seatedPlayers) : null);
  const seatPositionOf = (playerId: string | null | undefined): BoutAnchor | null => {
    if (playerId == null) return null;
    if (playerId === myId) return 'bottom';
    return seats.find((seat) => seat.opponent.id === playerId)?.position ?? null;
  };
  const redirectSeat = seatPositionOf(redirectTargetPlayerId);
  // In Chaos mode the receiving seat is picked deterministically server-side;
  // without that hint the outline keeps its shuffle icon instead of inventing a
  // direction. With a hint (or in a standard game) the arrow points at the
  // player who actually receives the attack.
  const redirectHasSeat = redirectSeat != null && (!chaosMode || Boolean(redirectTargetId));
  const redirectDirection: RedirectDirection = redirectHasSeat
    ? (redirectSeat as BoutAnchor)
    : chaosMode
      ? 'shuffle'
      : 'top-center';

  // Review mode freezes the table: no drags, no drop surfaces, no submission.
  // ITEM-6a: a hand card stays draggable even when it is not playable, because
  // a drag may either play the card or only reorganise the hand.
  const draggable =
    !reviewMode &&
    Boolean(onAttackDrop || onCoverDrop || onThrowInDrop || onRedirectDrop || onReorderHand);
  const throwInEnabled = !reviewMode && canThrowIn;

  // ITEM-7: the whole page keeps the link pointer finger for the entire drag,
  // including outside the arena where the browser would paint its own cursor.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const root = document.documentElement;
    const body = document.body;
    const setDragging = (active: boolean) => {
      if (active) {
        root.dataset.dragging = 'true';
        body.dataset.dragging = 'true';
      } else {
        delete root.dataset.dragging;
        delete body.dataset.dragging;
      }
    };
    setDragging(Boolean(dragCard));
    // ITEM-7: every way a gesture can end — pointer release, a cancelled touch
    // drag, a native dragend or the window losing focus — clears the page-wide
    // pointer state so the arrow cursor can come back.
    const clear = () => setDragging(false);
    document.addEventListener('pointerup', clear);
    document.addEventListener('pointercancel', clear);
    document.addEventListener('mouseup', clear);
    document.addEventListener('dragend', clear);
    if (typeof window !== 'undefined') window.addEventListener('blur', clear);
    return () => {
      setDragging(false);
      document.removeEventListener('pointerup', clear);
      document.removeEventListener('pointercancel', clear);
      document.removeEventListener('mouseup', clear);
      document.removeEventListener('dragend', clear);
      if (typeof window !== 'undefined') window.removeEventListener('blur', clear);
    };
  }, [dragCard]);

  /** ITEM-6a: insertion index `0..hand.length - 1` from the pointer's clientX. */
  const reorderIndexFromClientX = (clientX: number, element: HTMLElement): number => {
    const rect =
      typeof element.getBoundingClientRect === 'function'
        ? element.getBoundingClientRect()
        : null;
    const width = rect?.width ?? 0;
    if (width <= 0) return 0;
    const left = rect?.left ?? 0;
    const fraction = Math.min(1, Math.max(0, (clientX - left) / width));
    return Math.max(
      0,
      Math.min(Math.max(0, hand.length - 1), Math.round(fraction * hand.length)),
    );
  };

  /**
   * ITEM-7/8: hand cards are dragged with pointer events (never a native HTML5
   * drag, which is what repaints the arrow / "no drop" cursor), so the play
   * drop is resolved from the `[data-drop-zone]` surface under the pointer.
   * Unknown or illegal zones do nothing, which returns the card to the hand.
   */
  const resolvePointerDrop = (
    card: CardData,
    clientX: number,
    clientY: number,
  ): boolean => {
    if (typeof document.elementFromPoint !== 'function') return false;
    const hit = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const zoneNode = hit?.closest?.('[data-drop-zone]') as HTMLElement | null;
    const zone = zoneNode?.getAttribute('data-drop-zone') ?? '';
    if (!zone) return false;
    if (zone.startsWith('target:') && onAttackDrop) {
      onAttackDrop(card, zone.slice('target:'.length));
      return true;
    }
    if (zone.startsWith('cover:') && onCoverDrop) {
      onCoverDrop(card, Number(zone.slice('cover:'.length)));
      return true;
    }
    if (zone === 'throw-in' && onThrowInDrop) {
      onThrowInDrop(card);
      return true;
    }
    if (zone === 'redirect' && onRedirectDrop) {
      onRedirectDrop(card);
      return true;
    }
    return false;
  };

  // ITEM-6a/7: pointer/mouse dragging works for ANY hand card, even when it is
  // not the viewer's turn and no table drop is legal. This path guarantees the
  // live parting animation and the drop-to-reorder gesture with a plain mouse
  // press + move.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const move = (event: MouseEvent) => {
      const pointer = pointerDragRef.current;
      if (!pointer) return;
      if (!pointer.active) {
        if (
          Math.abs(event.clientX - pointer.startX) < 4 &&
          Math.abs(event.clientY - pointer.startY) < 4
        ) {
          return;
        }
        pointer.active = true;
        setDragCard(pointer.card);
        setDragOffset({ x: 0, y: 0 });
      }
      // T-90-feedback-2 ITEM-3: the dragged card follows the pointer at its full
      // 100x140 size, so it is never invisible during the gesture.
      setDragOffset({
        x: event.clientX - pointer.startX,
        y: event.clientY - pointer.startY,
      });
      event.preventDefault();
      const box = handRef.current;
      if (!box) return;
      const rect = box.getBoundingClientRect();
      const nearHand =
        event.clientX >= rect.left - 40 &&
        event.clientX <= rect.right + 40 &&
        event.clientY >= rect.top - 40 &&
        event.clientY <= rect.bottom + 60;
      setReorderIndex(nearHand ? reorderIndexFromClientX(event.clientX, box) : null);
    };
    const up = (event: MouseEvent) => {
      const pointer = pointerDragRef.current;
      pointerDragRef.current = null;
      if (!pointer?.active) return;
      const targetIndex = reorderIndexRef.current;
      if (targetIndex !== null) {
        if (onReorderHand) {
          const from = hand.findIndex(
            (candidate) => cardKey(candidate) === cardKey(pointer.card),
          );
          if (from >= 0) {
            const next = hand.filter((_, position) => position !== from);
            const insertAt = Math.max(0, Math.min(next.length, targetIndex));
            next.splice(insertAt, 0, pointer.card);
            onReorderHand(next);
          }
        }
      } else {
        // ITEM-7/8: released outside the hand, so play the card on whichever
        // drop surface (attack target, cover slot, throw-in, redirect) is under
        // the pointer. Dropping it anywhere else just returns it to the hand.
        resolvePointerDrop(pointer.card, event.clientX, event.clientY);
      }
      // Stop the click that follows a completed drag from selecting the card.
      suppressClickRef.current = true;
      setDragCard(null);
      setDragOffset({ x: 0, y: 0 });
      setSnapZone(null);
      setReorderIndex(null);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    return () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
  }, [hand, onReorderHand]);

  const hoverHandZone = (event: DragLike) => {
    if (!onReorderHand || !dragCard) return;
    event.preventDefault();
    setSnapZone(null);
    // The hit box is always the card row, even when the event fires on the
    // outer hand zone; lifted/oversized areas still map to the same slots.
    const element =
      handRef.current ?? (event.currentTarget as unknown as HTMLElement | null);
    if (!element) return;
    setReorderIndex(reorderIndexFromClientX(event.clientX, element));
  };

  // `dragleave` bubbles from the cards/SVG children; ignore moves that stay
  // inside the row so the insertion slot does not flicker mid-drag.
  const leaveHand = (event: DragEvent) => {
    const current = event.currentTarget as Node | null;
    const related = event.relatedTarget as Node | null;
    if (current && related && current.contains(related)) return;
    setReorderIndex(null);
  };

  const dropOnHand = (event: DragLike) => {
    if (!onReorderHand) return;
    event.preventDefault();
    event.stopPropagation();
    const card = readDraggedCard(event);
    const element =
      handRef.current ?? (event.currentTarget as unknown as HTMLElement | null);
    const targetIndex =
      reorderIndex ?? (element ? reorderIndexFromClientX(event.clientX, element) : 0);
    setDragCard(null);
    setDragOffset({ x: 0, y: 0 });
    setSnapZone(null);
    setReorderIndex(null);
    if (!card) return;
    const from = hand.findIndex((candidate) => cardKey(candidate) === cardKey(card));
    if (from < 0) return;
    const next = hand.filter((_, position) => position !== from);
    // `targetIndex` is the card's final position (`0..hand.length - 1`), so it
    // already accounts for the removed source card.
    const insertAt = Math.max(0, Math.min(next.length, targetIndex));
    next.splice(insertAt, 0, card);
    onReorderHand(next);
  };

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

  // ITEM-NEW-2b: the reflection outline occupies one card slot in the same row,
  // and every slot after the first is pulled left by the shared step: a small
  // gap while the bout fits, then an overlap that never covers the left
  // rank/suit strip of the previous card, so the cards never wrap.
  const redirectSlot = !reviewMode && canRedirect && tablePairs.length > 0 ? 1 : 0;
  // ITEM-8: the throw-in outline takes the next slot right after the cards in
  // play, so the single compact row still never wraps with six pairs + both
  // outlines.
  // T-90-2 ITEM-8: an ongoing attack ALWAYS shows the next-card throw-in slot,
  // even when nobody holds a legal throw-in card (or the viewer is the
  // defender / a spectator). The drop itself is still validated on play.
  const gameOverPhase =
    (boutPhase ?? '').replace(/[^a-z]/gi, '').toLowerCase() === 'gameover';
  const throwInSlot =
    !reviewMode && !gameOverPhase && tablePairs.length > 0 && tablePairs.length < 6
      ? 1
      : 0;
  const boutGeometry = boutLayout(
    tablePairs.length + throwInSlot + redirectSlot,
    boutWidth > 0 ? boutWidth : BOUT_FALLBACK_WIDTH,
    boutCardWidth,
  );
  const boutSlotMargin = (index: number): string | undefined =>
    index === 0 ? undefined : `${boutGeometry.step - boutCardWidth}px`;

  // T-90 (surrender throw-in outline): the outline never rides the half-off
  // `translateY(calc(±50% ± 12px))` transform of the taken cards. During a
  // normal bout it stays inline to the right of the played cards; while a bout
  // is surrendered it is rendered OUTSIDE `.table-pairs-group` — below the
  // taken cards for a top-row opponent and above them for the viewer's own
  // bottom edge — so its whole 100x140 box stays on the felt.
  const throwInOutlinePosition: 'inline' | 'above' | 'below' = !surrendered
    ? 'inline'
    : surrenderTarget === 'bottom'
      ? 'above'
      : 'below';
  // Detaching the outline from the pair row is what keeps it fully on the table.
  const throwInDetached = surrendered;
  const throwInOutline = (
    <div
      class={`target-outline throw-in-outline${
        snapZone === 'throw-in' ? ' snap-active' : ''
      }`}
      data-testid="throw-in-outline"
      data-drop-zone="throw-in"
      data-throw-in-enabled={canThrowIn ? 'true' : 'false'}
      data-surrender-outline-position={throwInOutlinePosition}
      data-on-table="true"
      data-card-width={CARD_WIDTH}
      data-card-height={CARD_HEIGHT}
      aria-label="Throw in another card"
      onDragOver={hoverZone('throw-in')}
      onDragLeave={clearSnap}
      onDrop={(event) => dropOn('throw-in', event, (card) => onThrowInDrop?.(card))}
    >
      <svg class="throw-in-icon" viewBox="0 0 40 40" aria-hidden="true">
        <path d="M20 8 L20 32 M8 20 L32 20" />
      </svg>
    </div>
  );

  // Starts the pointer fallback for any card, at any time; review/bot seats and
  // non-primary buttons are ignored so they keep their read-only behaviour.
  const beginPointerDrag = (card: CardData) => (event: MouseEvent) => {
    if (reviewMode || event.button !== 0) return;
    pointerDragRef.current = {
      card,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
  };

  const boutClasses = ['bout-area'];

  return (
    <div
      class={`table-arena${dragState ? ' dragging' : ''}`}
      data-zone="table-arena"
      data-my-id={myId}
      data-chaos={chaosMode ? 'true' : 'false'}
      data-review-mode={isReviewMode ? 'true' : 'false'}
      data-bot-locked={isBotView ? 'true' : 'false'}
      data-dragging={dragState ? 'true' : 'false'}
      data-aura-contained="true"
      data-texture={settings.tableTexture}
      style={{ '--table-filter': getTableFilterCss(settings.tableFilters) }}
      ref={arenaRef}
      onDragOver={draggable ? magnetize : undefined}
      onDragEnd={draggable ? clearSnap : undefined}
    >
      {seats.map(({ opponent, offset, position }) => {
        const classes = ['seat', 'opponent-seat', `seat-${position}`];
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
            data-role={
              opponent.id === attackerId
                ? 'attacker'
                : opponent.id === defenderId
                  ? 'defender'
                  : 'none'
            }
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
                <div
                  class="opponent-cards"
                  aria-label={`${opponent.name}'s cards`}
                  data-card-width={
                    opponent.cards && opponent.cards.length > 0
                      ? LOW_DETAIL_CARD_WIDTH
                      : OPPONENT_CARD_WIDTH
                  }
                  data-min-overlap-ratio="0.10"
                  data-overlap={opponentOverlap(
                    opponent.cards && opponent.cards.length > 0
                      ? opponent.cards.length
                      : opponent.cardCount,
                    OPPONENT_CARDS_WIDTH,
                    opponent.cards && opponent.cards.length > 0
                      ? LOW_DETAIL_CARD_WIDTH
                      : OPPONENT_CARD_WIDTH,
                  )}
                >
                  {opponent.cards && opponent.cards.length > 0
                    ? opponent.cards.map((card, index) => (
                        <span
                          key={`${card.suit}-${card.rank}-${index}`}
                          class={`opponent-low-detail-card${
                            isTrumpCard(card, trumpSuit) ? ' trump-card low-detail-trump' : ''
                          }`}
                          data-testid="opponent-low-detail-card"
                          data-suit={card.suit.toLowerCase()}
                          data-rank={card.rank.toLowerCase()}
                          data-trump={
                            isTrumpCard(card, trumpSuit) ? 'true' : 'false'
                          }
                          style={{
                            marginLeft:
                              index === 0
                                ? '0px'
                                : `-${opponentOverlap(
                                    opponent.cards?.length ?? 0,
                                    OPPONENT_CARDS_WIDTH,
                                    LOW_DETAIL_CARD_WIDTH,
                                  )}px`,
                          }}
                        >
                          <span class="low-detail-index">
                            <span class="low-detail-rank" data-testid="low-detail-rank">
                              {lowDetailRank(card.rank)}
                            </span>
                            <span
                              class={`low-detail-suit${isRedSuit(card.suit) ? ' red' : ' black'}`}
                              data-testid="low-detail-suit"
                            >
                              {suitSymbol(card.suit)}
                            </span>
                          </span>
                        </span>
                      ))
                    : Array.from({ length: opponent.cardCount }, (_, index) => (
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
      >
        {/* Item 7: the tinted play area keeps one fixed, table-relative size, so
            it never grows or shrinks with the number of cards in play. */}
        <div
          class="battlefield-tinted-box"
          data-testid="play-area-box"
          data-fixed-size="true"
          data-surrendered={surrendered ? 'true' : 'false'}
          ref={battlefieldRef}
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
              data-anchor-seat={anchor}
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
          data-anchor-seat={boutAnchor}
          data-single-row="true"
          data-min-visible-left={BOUT_MIN_VISIBLE_LEFT}
          data-step={boutGeometry.step}
          data-overlap={boutGeometry.overlap}
          data-surrendered={surrendered ? 'true' : 'false'}
          data-surrender-target={surrendered ? surrenderTarget : undefined}
        >
          {tablePairs.map((pair, index) => {
            const zone = `cover:${index}`;
            const coverable = !reviewMode && !pair.defense && Boolean(onCoverDrop);
            return (
              <TablePair
                key={`${pair.attack.suit.toLowerCase()}:${pair.attack.rank.toLowerCase()}`}
                attack={pair.attack}
                defense={pair.defense}
                trumpSuit={trumpSuit}
                marginLeft={boutSlotMargin(index)}
                cardWidth={CARD_WIDTH}
                cardHeight={CARD_HEIGHT}
                highlightUncovered={uncoveredHighlight && !pair.defense}
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

          {/* ITEM-8: the dedicated throw-in slot sits immediately right of the
              cards in play. It is the ONLY throw-in drop zone, so a card
              dropped elsewhere on the felt is not played. Its wrapper carries
              the row spacing, so the outline itself stays exactly 100x140. */}
          {throwInSlot > 0 && !throwInDetached ? (
            <div
              class="throw-in-slot"
              data-testid="throw-in-slot"
              data-surrender-outline-position="inline"
              data-on-table="true"
              style={{ marginLeft: boutSlotMargin(tablePairs.length) }}
            >
              {throwInOutline}
            </div>
          ) : null}

          {/* Item 8: the dashed reflection outline is a sibling of the attack
              cards in the same single row, so its top, centre and bottom edges
              always line up with every card in play at any table width. */}
          {!reviewMode && canRedirect && tablePairs.length > 0 ? (
            <div
              class={`redirect-outline${snapZone === 'redirect' ? ' snap-active' : ''}`}
              data-testid="redirect-outline"
              style={{ marginLeft: boutSlotMargin(tablePairs.length + throwInSlot) }}
              data-drop-zone="redirect"
              data-card-width={CARD_WIDTH}
              data-card-height={CARD_HEIGHT}
              data-direction={redirectDirection}
              data-target-seat={redirectDirection}
              data-target-player={
                redirectHasSeat ? (redirectTargetPlayerId ?? undefined) : undefined
              }
              data-align="card"
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

        {/* T-90 ITEM-1a/1b: under a surrender the throw-in outline is a direct
            child of the tinted box — below a top-row opponent's taken cards and
            above the viewer's own taken cards — never inside the half-off
            `.table-pairs-group` transform, so its border box stays fully on the
            table at any viewport size. */}
        {throwInSlot > 0 && throwInDetached ? (
          <div
            class="surrender-throw-in-anchor"
            data-testid="surrender-throw-in-anchor"
            data-placement={throwInOutlinePosition}
            data-surrender-seat={surrenderTarget}
            data-on-table="true"
          >
            {throwInOutline}
          </div>
        ) : null}
        </div>
      </section>

      <section
        class={handClasses.join(' ')}
        data-zone="player-hand"
        aria-label="Your hand"
        data-turn-action={handTurnAction}
        data-highlighted={handGlow ? 'true' : 'false'}
        data-highlight-variant={handHighlightVariant}
        data-highlight-role={handHighlightVariant}
        data-surrendering={surrenderingHand ? 'true' : 'false'}
        data-defenseless={defenderDefenseless ? 'true' : 'false'}
        ref={handZoneRef}
        onDragOver={draggable && onReorderHand ? hoverHandZone : undefined}
        onDrop={draggable && onReorderHand ? dropOnHand : undefined}
      >
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
          data-active={handGlow ? 'true' : 'false'}
          data-highlighted={handGlow ? 'true' : 'false'}
          data-highlight-variant={handHighlightVariant}
          data-highlight-role={handHighlightVariant}
          data-surrendering={surrenderingHand ? 'true' : 'false'}
          data-defenseless={defenderDefenseless ? 'true' : 'false'}
          data-turn-action={handTurnAction}
          data-all-legal={allCardsLegal ? 'true' : 'false'}
          // T-90-2 ITEM-6a: the dragged card's slot collapses and the rest of
          // the hand closes over it before the insertion gap parts again.
          data-gap-closed={gapClosed ? 'true' : 'false'}
          data-dragged-index={gapClosed ? draggedCardIndex : undefined}
          // ITEM-6a: `none` once the dragged card leaves the hand, so every
          // remaining card sits closed with no insertion gap on the felt.
          data-part-direction={
            dragCard !== null && reorderIndex === null ? 'none' : undefined
          }
          data-min-overlap-ratio={String(HAND_MIN_OVERLAP_RATIO)}
          data-max-overlap-ratio={String(HAND_MAX_OVERLAP_RATIO)}
          data-min-overlap={HAND_MIN_OVERLAP}
          data-max-overlap={HAND_MAX_OVERLAP}
          data-overlap={activeHandLayoutState.overlap}
          data-overlap-px={activeHandLayoutState.overlap}
          data-overlap-ratio={activeHandLayoutState.overlapRatio}
          data-stride-px={activeHandLayoutState.stride}
          data-hand-width={handRenderedWidth}
          data-fit-scale={handFitScale}
          data-hidden-left={handLayoutState.hiddenLeft}
          data-hidden-right={handLayoutState.hiddenRight}
          data-reorder-target-index={reorderIndex === null ? undefined : reorderIndex}
          // T-90-feedback-2 ITEM-2: `.hand-cards` is exactly the overlapped card
          // footprint; the contour SVG is anchored to this box.
          style={{
            width: `${handRenderedWidth}px`,
            height: `${Math.round(cardHeight)}px`,
            transform: handFitScale < 1 ? `scale(${handFitScale})` : undefined,
          }}
          ref={handRef}
          onDragOver={draggable && onReorderHand ? hoverHandZone : undefined}
          onDrop={draggable && onReorderHand ? dropOnHand : undefined}
          onDragLeave={draggable && onReorderHand ? leaveHand : undefined}
        >
        {/* T-90-feedback-2 ITEM-2: the tight, non-rectangular highlight contour.
            It is an SVG overlay anchored to `.hand-cards`, so it wraps the real
            card rectangles (including raised playable / selected cards) instead
            of drawing a loose rectangle around the hand column. */}
        <svg
          class="hand-highlight-contour"
          data-testid="hand-highlight-contour"
          data-non-rectangular={handContour.nonRectangular ? 'true' : 'false'}
          data-contour-width={Math.round(totalHandWidth)}
          width={handContour.width}
          height={handContour.height}
          viewBox={`0 0 ${handContour.width} ${handContour.height}`}
          style={{
            left: `${handContour.left}px`,
            top: `${handContour.top}px`,
            width: `${handContour.width}px`,
            height: `${handContour.height}px`,
          }}
          aria-hidden="true"
        >
          <path
            class="hand-highlight-path"
            data-testid="hand-highlight-path"
            d={handContour.d}
            stroke-linejoin="round"
            stroke-linecap="round"
          />
        </svg>
        {hand.map((card, index) => {
          const hidden =
            index < handLayoutState.hiddenLeft ||
            index >= handLayoutState.hiddenLeft + handLayoutState.visibleCount;
          const draggedIndex = dragCard
            ? hand.findIndex((candidate) => cardKey(candidate) === cardKey(dragCard))
            : -1;
          // ITEM-6a: compare every other card's index among the remaining
          // cards with the insertion slot — cards left of it shift left,
          // cards at or right of it shift right, even for a no-op slot.
          const effectiveIndex =
            draggedIndex >= 0 && index > draggedIndex ? index - 1 : index;
          const partDirection =
            dragCard === null || index === draggedIndex
              ? undefined
              : reorderIndex === null
                ? 'none'
                : effectiveIndex < reorderIndex
                  ? 'left'
                  : 'right';
          return (
            <div
              key={`${cardKey(card)}-${index}`}
              class="hand-slot hand-card-wrapper"
              data-hidden={hidden ? 'true' : 'false'}
              data-index={index}
              data-card-x={Math.round(handCardPositions[index].x)}
              data-card-y={handCardPositions[index].y}
              data-part-direction={partDirection}
              data-collapsed={index === draggedCardIndex ? 'true' : 'false'}
              // T-90-feedback-2 ITEM-3: the dragged wrapper keeps `data-dragging`
              // and a live `translate3d`; it is never hidden or clipped.
              data-dragging={index === draggedCardIndex ? 'true' : 'false'}
              data-draggable={draggable ? 'true' : 'false'}
              // ITEM-7: the wrapper never starts a native HTML5 drag, so the
              // browser can never swap the pointer finger for its arrow.
              draggable={false}
              aria-hidden={hidden ? 'true' : undefined}
              style={
                index === draggedCardIndex
                  ? {
                      marginLeft: handSlotMargin(index),
                      transform: `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0)`,
                      zIndex: 1000,
                      transition: 'none',
                    }
                  : { marginLeft: handSlotMargin(index) }
              }
              onMouseDown={beginPointerDrag(card)}
              onDragStart={(event) => event.preventDefault()}
              onClickCapture={(event) => {
                if (!suppressClickRef.current) return;
                suppressClickRef.current = false;
                event.stopPropagation();
                event.preventDefault();
              }}
            >
              <Card
                suit={card.suit}
                rank={card.rank}
                trump={isTrumpCard(card, trumpSuit)}
                selected={selectedKeys.includes(cardKey(card))}
                playable={activePlayableKeys.includes(cardKey(card))}
                onClick={onCardClick ? () => onCardClick(card) : undefined}
                onDoubleClick={
                  !reviewMode && onCardDoubleClick
                    ? () => {
                        // ITEM-CHAOS-1: several legal targets make a double-click
                        // ambiguous, so the player drags onto the wanted outline.
                        if (
                          awaitingAttack &&
                          tablePairs.length === 0 &&
                          targetIds.length > 1
                        ) {
                          return;
                        }
                        onCardDoubleClick(card);
                      }
                    : undefined
                }
                draggable={false}
                onDragStart={(event) => {
                  // ITEM-7: block the native drag image and its cursor swap; the
                  // pointer gesture drives the drag, and this keeps the
                  // programmatic drop path working for tests and automation.
                  event.preventDefault();
                  pointerDragRef.current = null;
                  setDragCard(card);
                  setDragOffset({ x: 0, y: 0 });
                  if (event.dataTransfer) {
                    // A move drag keeps the pointer cursor instead of the copy arrow.
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', cardKey(card));
                  }
                }}
                onDragEnd={() => {
                  setDragCard(null);
                  setDragOffset({ x: 0, y: 0 });
                  setSnapZone(null);
                  setReorderIndex(null);
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
