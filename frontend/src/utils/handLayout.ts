/**
 * T-90-feedback-20261122_171451-3: pure, framework-agnostic hand geometry for
 * the player's hand.
 *
 * Three independent concerns live here, and `GameTable.tsx` may consume any of
 * them:
 *
 * 1. [[computeHandLayout]] — the **Option B** box progression: cards always keep
 *    their full, constant footprint; a hand of up to six cards sits at the
 *    minimum overlap (`0.20`), a larger hand first *expands* toward
 *    `maximalBoxWidth` at that same overlap, then *compresses* inside the box
 *    up to the maximal allowable overlap (the exposed strip is still wide enough
 *    for the full-size `"10"` rank and the enlarged suit pip), and finally
 *    super-compresses inside the same box for extreme hands (30-46+ cards).
 *    Cards are never scaled down and never overflow the box.
 * 2. [[computePartedCardPositions]] — the smooth hover-parting solver: the
 *    hovered card never moves, its close neighbours expose more of their
 *    faces, distant cards compress, and the whole row stays ordered inside the
 *    maximal box.
 * 3. [[buildHandContourPath]] — the tight, non-rectangular SVG outline that hugs
 *    every laid-out card, including the two raised tiers and hover-parted `x`
 *    positions.
 *
 * No DOM access, no React/Preact imports: plain numbers in, deterministic
 * numbers and one SVG `d` string out.
 */

/** One playing card's rectangle, in the hand stage's coordinate space. */
export interface CardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Smallest share of a card's width covered by its left-hand neighbour. */
export const HAND_MIN_OVERLAP_RATIO = 0.2;
/**
 * Legacy upper bound of the overlap band (`80%`), retained for callers that
 * still clamp a row themselves. The hand module now derives its own ceiling
 * from the exposed index strip: see [[DEFAULT_MIN_VISIBLE_INDEX_STRIP_PX]].
 */
export const HAND_MAX_OVERLAP_RATIO = 0.8;
/** Canonical desktop card footprint. */
export const HAND_BASE_CARD_WIDTH = 100;
export const HAND_BASE_CARD_HEIGHT = 140;

/**
 * T-90-feedback-20261122_171451-3 ITEM-2c: the exposed left strip that keeps
 * the rank *and* the enlarged suit indicator fully visible.
 *
 * `"10"` is drawn at the same `15` rank size as every other rank, so its two
 * digits (≈`26.6px` of ink on the canonical `100px` card) plus the `3px` left
 * padding and a small right gutter need the `36px` strip that `Card.tsx`
 * mirrors as `CARD_INDEX_STRIP_WIDTH_PX`. Callers such as `GameTable.tsx`
 * pass that exact value through `minVisibleStripPx`.
 */
export const DEFAULT_MIN_VISIBLE_INDEX_STRIP_PX = 36;
/** Narrowest stride cards may fall back to when even the strip cannot fit. */
export const HAND_MIN_DISTINCT_CARD_STEP_PX = 4;

/**
 * T-90-feedback-20261122_171451-3 ITEM-8: vertical elevation tiers.
 *
 * A selected card is raised fully (`FULL_SELECTED_LIFT_PX`, the magnitude the
 * table has always used); an eligible-but-unselected card is raised halfway,
 * so the two tiers are always visually distinct.
 */
export const FULL_SELECTED_LIFT_PX = 18;
export const BASELINE_LIFT_PX = 0;
export const ELIGIBLE_LIFT_PX = FULL_SELECTED_LIFT_PX / 2;
export const SELECTED_LIFT_PX = FULL_SELECTED_LIFT_PX;
/** Legacy alias of the full raise magnitude. */
export const HAND_LIFT_PX = FULL_SELECTED_LIFT_PX;

/** A full-deck hand never wraps into more than two rows (legacy export). */
export const HAND_MAX_ROWS = 2;
/** Vertical gap between two wrapped rows (legacy export). */
export const HAND_ROW_GAP = 12;
/** Space between the cards and the highlight contour. */
export const HAND_CONTOUR_PADDING = 6;
/** Corner radius of the highlight contour. */
export const HAND_CONTOUR_CORNER_RADIUS = 12;

/** How quickly the hover-parting extra spacing decays with distance. */
const HOVER_PARTING_DECAY = 0.55;
/** Distance factor used when a side has no room at all (degenerate input). */
const HOVER_PARTING_DEGENERATE_FIT = 1e-3;

const EPS = 1e-9;
const EMPTY_INDEX_SET: ReadonlySet<number> = new Set<number>();

const finiteOr = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** A `ReadonlySet<number>` or a plain index array, normalised to a set. */
function toIndexSet(value: ReadonlySet<number> | readonly number[] | undefined): ReadonlySet<number> {
  if (!value) return EMPTY_INDEX_SET;
  if (typeof (value as ReadonlySet<number>).has === 'function') {
    return value as ReadonlySet<number>;
  }
  return new Set(value as readonly number[]);
}

/** Which tier shifted a card upward. */
export type HandLiftLevel = 'none' | 'playable' | 'selected';

export interface CardLiftFlags {
  /** The card can legally be played right now (half raise). */
  isEligible?: boolean;
  /** The card is selected for a multi-card action (full raise). */
  isSelected?: boolean;
}

/**
 * ITEM-8: exact vertical elevation for one card — `0` at rest, half the full
 * raise for an eligible card, the full raise for a selected one. A selected card
 * always wins over eligibility (selection implies eligibility).
 */
export function getCardVerticalLiftPx({
  isEligible = false,
  isSelected = false,
}: CardLiftFlags = {}): number {
  if (isSelected) return SELECTED_LIFT_PX;
  if (isEligible) return ELIGIBLE_LIFT_PX;
  return BASELINE_LIFT_PX;
}

export interface HandLayoutOptions {
  /** Number of cards in the hand. */
  cardCount: number;
  /** Live width of `[data-zone="player-hand"]`, ideally from a ResizeObserver. */
  containerWidth: number;
  /** Canonical card width: `100` desktop, `48` mobile. Never shrunk. */
  baseCardWidth?: number;
  /** Canonical card height: `140` desktop, `68` mobile. Never shrunk. */
  baseCardHeight?: number;
  /** Cards raised halfway because they can be played right now. */
  liftedIndices?: ReadonlySet<number> | readonly number[];
  /** Half-raise applied to eligible cards (default `ELIGIBLE_LIFT_PX`). */
  liftPx?: number;
  /** Cards raised fully because they are selected for a multi-card action. */
  selectedIndices?: ReadonlySet<number> | readonly number[];
  /** Full raise applied to selected cards (default `SELECTED_LIFT_PX`). */
  selectedLiftPx?: number;
  /** Total horizontal inset the stage must respect, in px. */
  horizontalPadding?: number;
  /** Share of a card its neighbour may cover while the hand still fits (default `0.2`). */
  minOverlapRatio?: number;
  /**
   * Exposed left strip, in px, that keeps the full-size `"10"` rank and enlarged
   * suit indicator visible (default [[DEFAULT_MIN_VISIBLE_INDEX_STRIP_PX]]).
   * `GameTable.tsx` passes `CARD_INDEX_STRIP_WIDTH_PX` from `Card.tsx`.
   */
  minVisibleStripPx?: number;
  /**
   * The widest box the hand may ever occupy: the full play area minus small
   * horizontal margins. Defaults to `containerWidth - horizontalPadding`.
   */
  maximalBoxWidth?: number;
  /** Legacy: rows an extreme hand may wrap into. The hand is now single-row. */
  maxRows?: number;
  /** Legacy: gap between wrapped rows. */
  rowGap?: number;
  /** Legacy upper bound of the overlap band (unused by Option B). */
  maxOverlapRatio?: number;
}

export interface HandCardLayout extends CardRect {
  /** Position in the original hand. */
  index: number;
  /** Wrapped row this card belongs to; `0` is the single row. */
  row: number;
  /** Exact upward shift applied to this card, in px. */
  lift: number;
  liftLevel: HandLiftLevel;
}

export interface HandLayoutResult {
  cards: HandCardLayout[];
  /** Number of rows the hand occupies (`0` for an empty hand, else `1`). */
  rows: number;
  /** Cards per row, top row first. */
  rowCounts: number[];
  /** Stride (left-edge distance) of every row, in px. */
  rowSteps: number[];
  /** Width of every row, in px. */
  rowWidths: number[];
  /** Constant full card footprint — identical for 1 to 52 cards. */
  cardWidth: number;
  cardHeight: number;
  /** Stride between adjacent card left edges (alias of [[cardStep]]). */
  step: number;
  /** Stride between adjacent card left edges. */
  cardStep: number;
  /** Pixels of each card covered by its right-hand neighbour. */
  overlap: number;
  /** `overlap / cardWidth`. */
  overlapRatio: number;
  /** Left edge of every card inside the hand box, in hand order. */
  cardPositions: number[];
  /** Width of the whole hand: the last card's right edge. */
  totalWidth: number;
  /** Width of a six-card hand at [[HAND_MIN_OVERLAP_RATIO]]. */
  defaultSixCardBoxWidth: number;
  /** Widest box the hand may occupy (never exceeded). */
  maximalBoxWidth: number;
  /** Exposed strip used to derive the maximal allowable overlap. */
  minVisibleStripPx: number;
  /** Stride at the minimum overlap: `cardWidth * (1 - minOverlapRatio)`. */
  minOverlapStep: number;
  /** `min(0.85, 1 - minVisibleStripPx / cardWidth)`. */
  maxAllowableOverlapRatio: number;
  /** True once the hand can no longer keep the index strip fully exposed. */
  isSuperCompressed: boolean;
  /** Vertical stride of a row (`cardHeight`; no wrapping). */
  rowHeight: number;
  /** Box the cards occupy; `stageWidth === totalWidth`. */
  stageWidth: number;
  stageHeight: number;
  /** `containerWidth` minus the reserved horizontal padding, floored at one card. */
  availableWidth: number;
  /** Left inset that centres the stage inside `containerWidth`. */
  offsetX: number;
  /** Height reserved above the baseline for raised cards. */
  maxLift: number;
  /** Layout scale applied to the canonical card footprint (always `1`). */
  scale: number;
}

const EMPTY_LAYOUT: HandLayoutResult = {
  cards: [],
  rows: 0,
  rowCounts: [],
  rowSteps: [],
  rowWidths: [],
  cardWidth: 0,
  cardHeight: 0,
  step: 0,
  cardStep: 0,
  overlap: 0,
  overlapRatio: 0,
  cardPositions: [],
  totalWidth: 0,
  defaultSixCardBoxWidth: 0,
  maximalBoxWidth: 0,
  minVisibleStripPx: 0,
  minOverlapStep: 0,
  maxAllowableOverlapRatio: 0,
  isSuperCompressed: false,
  rowHeight: 0,
  stageWidth: 0,
  stageHeight: 0,
  availableWidth: 0,
  offsetX: 0,
  maxLift: 0,
  scale: 1,
};

/**
 * ITEM-5a/5b: lays a hand out inside `maximalBoxWidth` with the Option B
 * progression.
 *
 * Guarantees, for any count in `0..52` and any reasonable width:
 * - `cardWidth` / `cardHeight` are the constant full card size — never scaled;
 * - `1..6` cards use the minimum overlap (`step = cardWidth * (1 - minOverlapRatio)`)
 *   and stay inside [[HandLayoutResult.defaultSixCardBoxWidth]];
 * - `7+` cards expand at that same overlap until they reach `maximalBoxWidth`,
 *   then compress inside it (`step = (box - cardWidth) / (count - 1)`) while the
 *   step stays at or above `minVisibleStripPx`, and only afterwards
 *   super-compress (`isSuperCompressed`) inside the same box;
 * - `totalWidth <= maximalBoxWidth` and `stageWidth === totalWidth` always hold,
 *   and every card left edge is non-negative and strictly increasing.
 */
export function computeHandLayout(options: HandLayoutOptions): HandLayoutResult {
  const cardWidth = Math.max(1, finiteOr(options.baseCardWidth, HAND_BASE_CARD_WIDTH));
  const cardHeight = Math.max(1, finiteOr(options.baseCardHeight, HAND_BASE_CARD_HEIGHT));
  const cardCount = Math.max(0, Math.floor(finiteOr(options.cardCount, 0)));
  const containerWidth = Math.max(0, finiteOr(options.containerWidth, 0));
  const horizontalPadding = Math.max(0, finiteOr(options.horizontalPadding, 0));
  const availableWidth = Math.max(containerWidth - horizontalPadding, cardWidth);
  const minOverlapRatio = clamp(finiteOr(options.minOverlapRatio, HAND_MIN_OVERLAP_RATIO), 0, 0.95);
  const minVisibleStripPx = clamp(
    finiteOr(options.minVisibleStripPx, DEFAULT_MIN_VISIBLE_INDEX_STRIP_PX),
    0,
    cardWidth,
  );
  const maximalBoxWidth = Math.max(
    cardWidth,
    finiteOr(options.maximalBoxWidth, availableWidth),
  );
  // ITEM-2c: the step at the smallest allowed overlap, and the overlap ceiling
  // that still leaves the `"10"`-wide index strip fully uncovered.
  const minOverlapStep = cardWidth * (1 - minOverlapRatio);
  const defaultSixCardBoxWidth = cardWidth + 5 * minOverlapStep;
  const maxAllowableOverlapRatio = Math.max(
    0,
    Math.min(0.85, 1 - minVisibleStripPx / cardWidth),
  );

  const liftPx = Math.max(0, finiteOr(options.liftPx, ELIGIBLE_LIFT_PX));
  const selectedLiftPx = Math.max(0, finiteOr(options.selectedLiftPx, SELECTED_LIFT_PX));
  const lifted = toIndexSet(options.liftedIndices);
  const selected = toIndexSet(options.selectedIndices);

  if (cardCount === 0) {
    return {
      ...EMPTY_LAYOUT,
      cardWidth: round2(cardWidth),
      cardHeight: round2(cardHeight),
      minOverlapStep: round2(minOverlapStep),
      defaultSixCardBoxWidth: round2(defaultSixCardBoxWidth),
      maximalBoxWidth: round2(maximalBoxWidth),
      minVisibleStripPx: round2(minVisibleStripPx),
      maxAllowableOverlapRatio: round2(maxAllowableOverlapRatio),
      availableWidth: round2(availableWidth),
    };
  }

  // --- Option B progression -------------------------------------------------
  let step: number;
  let totalWidth: number;
  if (cardCount === 1) {
    step = cardWidth;
    totalWidth = cardWidth;
  } else {
    const gaps = cardCount - 1;
    const widthAtMinOverlap = cardWidth + gaps * minOverlapStep;
    if (widthAtMinOverlap <= maximalBoxWidth) {
      // Steps 1 & 2: six cards and beyond keep the minimum-overlap stride; the
      // hand expands smoothly past the default six-card box up to the max box.
      step = minOverlapStep;
      totalWidth = widthAtMinOverlap;
    } else {
      // Steps 3 & 4: clamp the whole hand to the maximal box. While the stride
      // stays at or above the index strip this is the maximal allowable
      // overlap; below it the same clamp keeps compressing inside the box.
      totalWidth = maximalBoxWidth;
      step = (maximalBoxWidth - cardWidth) / gaps;
      // Cards stay distinct and ordered; the 4px floor is only honoured when it
      // still fits inside the box (it always does for realistic hands).
      if (
        step > 0 &&
        step < HAND_MIN_DISTINCT_CARD_STEP_PX &&
        cardWidth + gaps * HAND_MIN_DISTINCT_CARD_STEP_PX <= maximalBoxWidth
      ) {
        step = HAND_MIN_DISTINCT_CARD_STEP_PX;
        totalWidth = cardWidth + gaps * step;
      }
      step = Math.max(0, step);
    }
  }

  const isSuperCompressed =
    cardCount > 1 && cardWidth + (cardCount - 1) * minVisibleStripPx > maximalBoxWidth + EPS;

  const cardPositions: number[] = [];
  const cards: HandCardLayout[] = [];
  const lifts: number[] = [];
  let maxLift = 0;
  for (let index = 0; index < cardCount; index += 1) {
    const isSelected = selected.has(index);
    const isEligible = lifted.has(index);
    // ITEM-8: two tiers — selected cards rise fully, eligible-only cards half.
    const appliedLift = isSelected ? selectedLiftPx : isEligible ? liftPx : BASELINE_LIFT_PX;
    lifts.push(appliedLift);
    maxLift = Math.max(maxLift, appliedLift);
    const x = round2(index * step);
    cardPositions.push(x);
    cards.push({
      index,
      row: 0,
      x,
      y: 0,
      width: round2(cardWidth),
      height: round2(cardHeight),
      lift: round2(appliedLift),
      liftLevel: isSelected ? 'selected' : isEligible ? 'playable' : 'none',
    });
  }

  // `y` is relative to the reserved lift band; fill it now that `maxLift` is
  // known, so every card sits on the same baseline.
  for (let index = 0; index < cards.length; index += 1) {
    cards[index].y = round2(maxLift - lifts[index]);
  }

  const overlap = cardWidth - step;

  return {
    cards,
    rows: 1,
    rowCounts: [cardCount],
    rowSteps: [round2(step)],
    rowWidths: [round2(totalWidth)],
    cardWidth: round2(cardWidth),
    cardHeight: round2(cardHeight),
    step: round2(step),
    cardStep: round2(step),
    overlap: round2(overlap),
    overlapRatio: cardWidth > 0 ? round2(overlap / cardWidth) : 0,
    cardPositions,
    totalWidth: round2(totalWidth),
    defaultSixCardBoxWidth: round2(defaultSixCardBoxWidth),
    maximalBoxWidth: round2(maximalBoxWidth),
    minVisibleStripPx: round2(minVisibleStripPx),
    minOverlapStep: round2(minOverlapStep),
    maxAllowableOverlapRatio: round2(maxAllowableOverlapRatio),
    isSuperCompressed,
    rowHeight: round2(cardHeight),
    stageWidth: round2(totalWidth),
    stageHeight: round2(maxLift + cardHeight),
    availableWidth: round2(availableWidth),
    offsetX: round2(Math.max(0, (containerWidth - totalWidth) / 2)),
    maxLift: round2(maxLift),
    scale: 1,
  };
}

/**
 * Share of the desired gaps that fits into `span`. Only ever shrinks (the row
 * never grows past its own spread targets), and stays positive.
 */
function gapFitScale(gaps: readonly number[], span: number): number {
  if (gaps.length === 0) return 1;
  const total = gaps.reduce((sum, gap) => sum + gap, 0);
  if (!(total > 0)) return 1;
  if (total <= span) return 1;
  if (!(span > 0)) return HOVER_PARTING_DEGENERATE_FIT;
  return span / total;
}

/**
 * ITEM-6a/6b/6c: smooth hover-parting positions for one hand row.
 *
 * - `basePositions` are the resting left edges (from [[computeHandLayout]]).
 * - The hovered card never moves: `result[hoveredIndex] === basePositions[hoveredIndex]`.
 * - Gaps next to the hovered card open up to the widest comfortable stride
 *   (`max(cardWidth * 0.8, minVisibleStripPx)`), decaying geometrically with
 *   distance; gaps far from it fall back to the resting stride and compress
 *   further when the widened run no longer fits.
 * - Left cards stay in `[0, hoveredX]`, right cards in
 *   `[hoveredX, maximalBoxWidth - cardWidth]`, so the parted row is strictly
 *   left-to-right ordered and never overflows the hand box.
 * - A one-card hand, a missing/out-of-range hover, or an empty hand returns
 *   `basePositions` untouched (the very same array — zero delta).
 */
export function computePartedCardPositions(
  basePositions: readonly number[],
  cardWidth: number,
  maximalBoxWidth: number,
  hoveredIndex: number | null,
  minVisibleStripPx: number = DEFAULT_MIN_VISIBLE_INDEX_STRIP_PX,
): readonly number[] {
  const count = basePositions.length;
  // ITEM-6c: nothing to part with a single card (or none at all).
  if (count <= 1) return basePositions;
  if (hoveredIndex === null || hoveredIndex === undefined) return basePositions;
  if (!Number.isFinite(hoveredIndex)) return basePositions;
  const hovered = Math.floor(hoveredIndex);
  if (hovered !== hoveredIndex || hovered < 0 || hovered >= count) return basePositions;

  const width = Math.max(1, cardWidth);
  const boxWidth = Math.max(width, maximalBoxWidth);
  const strip = clamp(minVisibleStripPx, 0, width);
  // The widest comfortable stride still keeps the card's left index visible.
  const spreadStep = Math.max(width * (1 - HAND_MIN_OVERLAP_RATIO), strip);
  const pivot = basePositions[hovered];
  const leftBound = 0;
  const rightBound = boxWidth - width;

  const desiredGap = (distance: number, baseGap: number): number => {
    const extra = Math.max(0, spreadStep - baseGap);
    return baseGap + extra * Math.pow(HOVER_PARTING_DECAY, Math.max(0, distance - 1));
  };

  const leftGaps: number[] = [];
  for (let distance = 1; distance <= hovered; distance += 1) {
    const left = hovered - distance;
    const baseGap = Math.max(0, basePositions[left + 1] - basePositions[left]);
    leftGaps.push(desiredGap(distance, baseGap));
  }
  const rightGaps: number[] = [];
  for (let distance = 1; distance <= count - 1 - hovered; distance += 1) {
    const left = hovered + distance - 1;
    const baseGap = Math.max(0, basePositions[left + 1] - basePositions[left]);
    rightGaps.push(desiredGap(distance, baseGap));
  }

  const leftScale = gapFitScale(leftGaps, Math.max(0, pivot - leftBound));
  const rightScale = gapFitScale(rightGaps, Math.max(0, rightBound - pivot));

  const result = basePositions.slice() as number[];

  let offset = 0;
  for (let distance = 1; distance <= hovered; distance += 1) {
    offset += leftGaps[distance - 1] * leftScale;
    // Never leave the box on the left; convex gaps keep the order intact.
    result[hovered - distance] = Math.max(leftBound, pivot - offset);
  }

  offset = 0;
  for (let distance = 1; distance <= count - 1 - hovered; distance += 1) {
    offset += rightGaps[distance - 1] * rightScale;
    const x = pivot + offset;
    result[hovered + distance] = rightBound >= pivot ? Math.min(rightBound, x) : x;
  }

  // ITEM-6b: the hovered card is pinned — never moves, not even by rounding.
  result[hovered] = pivot;
  return result;
}

export interface HandContourOptions {
  /** Space the contour keeps around the cards (default `6`). */
  padding?: number;
  /** Outer / inner corner radius (default `12`). */
  cornerRadius?: number;
  /** Card width for `{ x, liftPx }` entries (default `100`). */
  cardWidth?: number;
  /** Card height for `{ x, liftPx }` entries (default `140`). */
  cardHeight?: number;
  /** Top `y` of a resting card, the lift baseline for `{ x, liftPx }` (default `0`). */
  baselineY?: number;
}

export interface HandContourPath {
  /** Valid SVG `<path d="...">` string in the returned viewBox's space. */
  pathD: string;
  viewBox: { width: number; height: number };
  /** True when the cards' vertical lifts / heights differ (stepped outline). */
  isNonRectangular: boolean;
  /** Union bounds in the input coordinate space, padding included. */
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * ITEM-8: a card expressed as its left edge plus its vertical lift, so the
 * contour can wrap all three lift tiers and hover-parted `x` positions without
 * the caller rebuilding rectangles by hand.
 */
export interface HandCardLiftOutline {
  /** Left edge of the card in the hand stage's coordinate space. */
  x: number;
  /** Upward shift from the baseline (`0` resting, `9` eligible, `18` selected). */
  liftPx: number;
}

export type HandOutlineCard = CardRect | HandCardLiftOutline;

/** True for the `{ x, liftPx }` contour entry form. */
function isLiftOutline(card: HandOutlineCard): card is HandCardLiftOutline {
  return typeof (card as HandCardLiftOutline).liftPx === 'number';
}

interface Point {
  x: number;
  y: number;
}

/** Compact, deterministic number formatting for SVG path data. */
function fmt(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (!Number.isFinite(rounded)) return '0';
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

/**
 * Rounded orthogonal path through a closed polygon. Every corner is trimmed by
 * `cornerRadius` along both adjacent edges and joined with a quarter arc whose
 * sweep follows the turn direction, so convex outer corners and concave inner
 * corners of a stepped silhouette both stay clean. The trim is clamped to half
 * of each adjacent edge, so short skyline steps never self-intersect.
 */
function polygonPath(points: readonly Point[], cornerRadius: number): string {
  if (points.length === 0) return '';
  if (points.length < 3 || cornerRadius <= 0) {
    const [first, ...rest] = points;
    return [
      `M ${fmt(first.x)} ${fmt(first.y)}`,
      ...rest.map((point) => `L ${fmt(point.x)} ${fmt(point.y)}`),
      'Z',
    ].join(' ');
  }

  const count = points.length;
  const entries: Point[] = [];
  const exits: Point[] = [];
  const radii: number[] = [];
  const sweeps: number[] = [];

  for (let index = 0; index < count; index += 1) {
    const prev = points[(index - 1 + count) % count];
    const current = points[index];
    const next = points[(index + 1) % count];
    const inX = current.x - prev.x;
    const inY = current.y - prev.y;
    const outX = next.x - current.x;
    const outY = next.y - current.y;
    const inLength = Math.hypot(inX, inY);
    const outLength = Math.hypot(outX, outY);
    const cross = inX * outY - inY * outX;

    if (inLength < 1e-6 || outLength < 1e-6 || Math.abs(cross) < 1e-6) {
      entries.push({ x: current.x, y: current.y });
      exits.push({ x: current.x, y: current.y });
      radii.push(0);
      sweeps.push(1);
      continue;
    }

    const radius = Math.min(cornerRadius, inLength / 2, outLength / 2);
    entries.push({
      x: current.x - (inX / inLength) * radius,
      y: current.y - (inY / inLength) * radius,
    });
    exits.push({
      x: current.x + (outX / outLength) * radius,
      y: current.y + (outY / outLength) * radius,
    });
    radii.push(radius);
    // Screen coordinates: a positive cross product turns clockwise, which is a
    // positive-angle (sweep = 1) arc; a negative cross is the concave mirror.
    sweeps.push(cross > 0 ? 1 : 0);
  }

  const commands: string[] = [`M ${fmt(exits[0].x)} ${fmt(exits[0].y)}`];
  for (let index = 1; index <= count; index += 1) {
    const vertex = index % count;
    commands.push(`L ${fmt(entries[vertex].x)} ${fmt(entries[vertex].y)}`);
    if (radii[vertex] > 0) {
      commands.push(
        `A ${fmt(radii[vertex])} ${fmt(radii[vertex])} 0 0 ${sweeps[vertex]} ` +
          `${fmt(exits[vertex].x)} ${fmt(exits[vertex].y)}`,
      );
    }
  }
  commands.push('Z');
  return commands.join(' ');
}

/**
 * ITEM-8: builds the tight highlight contour around a laid-out hand.
 *
 * Entries are either full [[CardRect]]s or the lighter `{ x, liftPx }` form,
 * resolved against `cardWidth` / `cardHeight` / `baselineY`. Each card is
 * padded, then the outer union boundary is traced: the top edge follows the
 * lowest top over every x interval and the bottom edge the highest bottom, so a
 * raised card (half-raised eligible or fully raised selected) produces an
 * immediate vertical step at its left edge and back down at its right edge —
 * the outline distorts non-rectangularly around the hand instead of being a
 * box, and it wraps hover-parted x positions just as tightly.
 *
 * Returns the `d` string plus the exact viewBox it is drawn in, and
 * `isNonRectangular` (true as soon as two cards differ vertically) so callers
 * can expose `data-contour-shape="stepped" | "uniform"`.
 */
export function buildHandContourPath(
  rects: readonly HandOutlineCard[],
  options: HandContourOptions = {},
): HandContourPath {
  const padding = Math.max(0, finiteOr(options.padding, HAND_CONTOUR_PADDING));
  const cornerRadius = Math.max(0, finiteOr(options.cornerRadius, HAND_CONTOUR_CORNER_RADIUS));
  const liftCardWidth = Math.max(1, finiteOr(options.cardWidth, HAND_BASE_CARD_WIDTH));
  const liftCardHeight = Math.max(1, finiteOr(options.cardHeight, HAND_BASE_CARD_HEIGHT));
  const baselineY = finiteOr(options.baselineY, 0);

  const usable = rects
    .map<CardRect>((card) =>
      isLiftOutline(card)
        ? {
            x: card.x,
            y: baselineY - card.liftPx,
            width: liftCardWidth,
            height: liftCardHeight,
          }
        : card,
    )
    .filter(
      (rect) =>
        Number.isFinite(rect.x) &&
        Number.isFinite(rect.y) &&
        Number.isFinite(rect.width) &&
        Number.isFinite(rect.height) &&
        rect.width > 0 &&
        rect.height > 0,
    );

  if (usable.length === 0) {
    return {
      pathD: '',
      viewBox: { width: 0, height: 0 },
      isNonRectangular: false,
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    };
  }

  const boxes = usable.map((rect) => ({
    left: rect.x - padding,
    right: rect.x + rect.width + padding,
    top: rect.y - padding,
    bottom: rect.y + rect.height + padding,
  }));

  const left = Math.min(...boxes.map((box) => box.left));
  const right = Math.max(...boxes.map((box) => box.right));
  const top = Math.min(...boxes.map((box) => box.top));
  const bottom = Math.max(...boxes.map((box) => box.bottom));

  const tops = new Set(usable.map((rect) => round2(rect.y)));
  const bottoms = new Set(usable.map((rect) => round2(rect.y + rect.height)));
  const isNonRectangular = tops.size > 1 || bottoms.size > 1;

  const xs = Array.from(new Set(boxes.flatMap((box) => [box.left, box.right]))).sort(
    (a, b) => a - b,
  );

  // One envelope value per x interval; the midpoint decides which cards cover it.
  const bandTops: number[] = [];
  const bandBottoms: number[] = [];
  for (let index = 0; index < xs.length - 1; index += 1) {
    const start = xs[index];
    const end = xs[index + 1];
    if (end - start < EPS) continue;
    const middle = (start + end) / 2;
    const covering = boxes.filter((box) => box.left <= middle && box.right >= middle);
    if (covering.length === 0) {
      // Disjoint cards cannot describe one hand: fall back to the bounding box.
      bandTops.length = 0;
      bandBottoms.length = 0;
      break;
    }
    bandTops.push(Math.min(...covering.map((box) => box.top)));
    bandBottoms.push(Math.max(...covering.map((box) => box.bottom)));
  }

  let points: Point[];
  if (bandTops.length === 0) {
    points = [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    ];
  } else {
    const bands = bandTops.length;
    points = [{ x: xs[0], y: bandTops[0] }];
    // Upper envelope, left to right: a vertical step wherever the skyline moves.
    for (let index = 1; index < bands; index += 1) {
      if (bandTops[index] !== bandTops[index - 1]) {
        points.push({ x: xs[index], y: bandTops[index - 1] });
        points.push({ x: xs[index], y: bandTops[index] });
      }
    }
    points.push({ x: xs[bands], y: bandTops[bands - 1] });
    points.push({ x: xs[bands], y: bandBottoms[bands - 1] });
    // Lower envelope, right to left: the same, mirrored beneath the hand.
    for (let index = bands - 2; index >= 0; index -= 1) {
      if (bandBottoms[index] !== bandBottoms[index + 1]) {
        points.push({ x: xs[index + 1], y: bandBottoms[index + 1] });
        points.push({ x: xs[index + 1], y: bandBottoms[index] });
      }
    }
    points.push({ x: xs[0], y: bandBottoms[0] });
  }

  // Drop duplicate / closing points, then express everything from the bounding
  // box's top-left so the viewBox starts at (0, 0).
  const local: Point[] = [];
  for (const point of points) {
    const x = point.x - left;
    const y = point.y - top;
    const previous = local[local.length - 1];
    if (previous && Math.abs(previous.x - x) < EPS && Math.abs(previous.y - y) < EPS) {
      continue;
    }
    local.push({ x, y });
  }
  if (local.length > 1) {
    const first = local[0];
    const last = local[local.length - 1];
    if (Math.abs(first.x - last.x) < EPS && Math.abs(first.y - last.y) < EPS) {
      local.pop();
    }
  }

  return {
    pathD: polygonPath(local, cornerRadius),
    viewBox: { width: round2(right - left), height: round2(bottom - top) },
    isNonRectangular,
    left: round2(left),
    top: round2(top),
    width: round2(right - left),
    height: round2(bottom - top),
  };
}
