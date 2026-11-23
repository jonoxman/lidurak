/**
 * T-90-feedback-20261122_171451-3: pure, framework-agnostic hand geometry for
 * the player's hand.
 *
 * Three independent concerns live here, and `GameTable.tsx` may consume any of
 * them:
 *
 * 1. [[computeHandLayout]] — the **Option B** box progression: cards always keep
 *    their full, constant footprint; a small hand (`2..6` cards) rests at a
 *    default overlap *slightly past* the minimum (`0.36`, so `64%` of every
 *    desktop card stays exposed — still well above the `36px` rank/suit strip)
 *    and is centred inside the six-card default box, which leaves explicit
 *    expansion margin for the hover parting animation. A larger hand first
 *    *expands* toward `maximalBoxWidth` at the minimum overlap, then
 *    *compresses* inside the box up to the maximal allowable overlap (the
 *    exposed strip is still wide enough for the full-size `"10"` rank and the
 *    enlarged suit pip), and finally super-compresses inside the same box for
 *    extreme hands (30-46+ cards). Cards are never scaled down and never
 *    overflow the box.
 * 2. [[computePartedCardLayout]] / [[computePartedCardPositions]] — the
 *    localized hover-parting solver: the hovered card never moves, only its
 *    local RIGHT neighbours may flare, every left neighbour and every distant
 *    card keeps an exact `0` delta, and the exported per-card `deltas` feed
 *    GPU-composited `translate3d(...)` transforms without a layout reflow.
 *    Single-sided parting is what makes the card under the pointer the only
 *    card that opens with the widest margin (T-90 Hover Parting ticket).
 *    [[computeRestingCardPositions]] / [[cardTranslate3d]] expose those same
 *    primitives so in-hand drag parting can reuse them verbatim.
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

/**
 * ITEM-6b: the resting overlap of a small hand (`2..6` cards).
 *
 * `0.36` leaves `64%` of each card exposed (`64px` on the canonical `100px`
 * desktop card, `30.72px` on the `48px` mobile card), comfortably above the
 * `36px` `"10"` rank/suit strip, while still overlapping slightly more than the
 * `0.20` minimum. The extra `16px` of resting overlap per adjacent card is the
 * expansion margin the hover-parting animation needs: without it small hands
 * sat at the minimum step (or fully spread) and had nowhere to part to.
 */
export const HAND_SMALL_HAND_OVERLAP_RATIO = 0.36;
/** Largest hand that uses the small-hand resting overlap (`2..6`). */
export const HAND_SMALL_HAND_MAX_CARDS = 6;
/**
 * ITEM-6b: symmetric breathing room around a small hand, as a share of the card
 * width (`0.32` -> `32px` desktop / `15.36px` mobile). It is capped by the
 * remaining space in the six-card default box, so a five- or six-card hand
 * still fills that box exactly. The runway gives even a two-card hand the
 * slack it needs to open a gap around *either* hovered card, while the hovered
 * card itself stays pinned.
 */
export const HAND_SMALL_HAND_PARTING_PAD_RATIO = 0.32;
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

/**
 * T-90-feedback-20261123_020207-2 ITEM-QA6: how many neighbours to the right of
 * the hovered card may move at all. Everything outside
 * `hoveredIndex + 1 .. hoveredIndex + 3` is pinned to its resting slot with an
 * exact `0` delta — including every card LEFT of the cursor — so a 30-card hand
 * keeps 26 cards perfectly still instead of spreading the whole row.
 */
export const HAND_HOVER_PARTING_RADIUS = 3;
/**
 * T-90-feedback-20261123_020207-2: sharp local decay inside that window. The
 * immediate neighbour takes the full opening, the second gap a fifth and the
 * third a twentieth, so the flare is concentrated around the cursor.
 */
const HAND_HOVER_PARTING_WEIGHTS = [1, 0.2, 0.05] as const;
/**
 * T-90-feedback-20261123_020207-2: how far past the minimum-overlap stride a
 * locally parted gap opens (`0.12` of a card). A hand already resting at the
 * minimum stride therefore still gets a visible `12px` local flare.
 */
const HAND_HOVER_SPREAD_MARGIN_RATIO = 0.12;
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
  /**
   * Width of the six-card default box at the ITEM-6b resting overlap
   * (`cardWidth + 5 * smallHandStep`). Small hands are centred inside it.
   */
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
 * - `2..6` cards rest at the ITEM-6b small-hand overlap
 *   (`step = max(cardWidth * 0.64, minVisibleStripPx)`, never wider than the
 *   minimum-overlap step), centred inside [[HandLayoutResult.defaultSixCardBoxWidth]]
 *   so both edges keep parting headroom;
 * - `7+` cards expand at the minimum overlap until they reach `maximalBoxWidth`,
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
  // ITEM-6b: small hands rest at a slightly larger overlap than the minimum so
  // the hover parting has room to expand into. The step never exceeds the
  // minimum-overlap step (so it is always *more* overlap than the floor) and
  // never drops below the exposed index strip.
  const smallHandStep = Math.min(
    minOverlapStep,
    Math.max(
      cardWidth * (1 - HAND_SMALL_HAND_OVERLAP_RATIO),
      Math.min(minVisibleStripPx, minOverlapStep),
    ),
  );
  const defaultSixCardBoxWidth =
    cardWidth + (HAND_SMALL_HAND_MAX_CARDS - 1) * smallHandStep;
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
  // ITEM-6b: left edge of the first card. Only small hands get a non-zero
  // inset (symmetric padding around the resting row).
  let startX = 0;
  if (cardCount === 1) {
    step = cardWidth;
    totalWidth = cardWidth;
  } else if (cardCount <= HAND_SMALL_HAND_MAX_CARDS) {
    const gaps = cardCount - 1;
    const widthAtSmallOverlap = cardWidth + gaps * smallHandStep;
    if (widthAtSmallOverlap <= maximalBoxWidth) {
      step = smallHandStep;
    } else {
      // A very narrow lane still never overflows: compress inside it, keeping
      // the cards distinct when the 4px floor fits.
      step = Math.max(0, (maximalBoxWidth - cardWidth) / gaps);
      if (
        step > 0 &&
        step < HAND_MIN_DISTINCT_CARD_STEP_PX &&
        cardWidth + gaps * HAND_MIN_DISTINCT_CARD_STEP_PX <= maximalBoxWidth
      ) {
        step = HAND_MIN_DISTINCT_CARD_STEP_PX;
      }
    }
    const rowExtent = cardWidth + gaps * step;
    const boxCap = Math.min(defaultSixCardBoxWidth, maximalBoxWidth);
    // Centre the row inside its default box, capped by the parting runway.
    startX = Math.min(
      cardWidth * HAND_SMALL_HAND_PARTING_PAD_RATIO,
      Math.max(0, (boxCap - rowExtent) / 2),
    );
    totalWidth = rowExtent + 2 * startX;
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
    const x = round2(startX + index * step);
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

/** One gap's weight inside the local parting window. */
function hoverPartingWeight(distance: number): number {
  const weight = HAND_HOVER_PARTING_WEIGHTS[distance - 1];
  return weight === undefined ? 0 : weight;
}

/**
 * T-90-feedback-20261123_020207-2: per-side fit scale for the local window.
 *
 * `span` is the fixed resting distance from the hovered card to the outermost
 * card the window is allowed to move. The handful of gaps inside that span share
 * it exactly, so those edge cards keep their resting `x` and every card outside
 * the window keeps an exact `0` delta. Only ever shrinks (the window never grows
 * past its own span) and stays positive.
 */
function localPartingFitScale(gaps: readonly number[], span: number): number {
  if (gaps.length === 0) return 1;
  const total = gaps.reduce((sum, gap) => sum + gap, 0);
  if (!(total > 0)) return 1;
  if (total <= span) return 1;
  if (!(span > 0)) return HOVER_PARTING_DEGENERATE_FIT;
  return span / total;
}

/** ITEM-6a: absolute parted positions plus their GPU-friendly displacement. */
export interface PartedCardLayout {
  /** Absolute left edge of every card in the parted row. */
  positions: readonly number[];
  /** `positions[i] - restingPositions[i]`, exact `0` for the hovered card. */
  deltas: readonly number[];
  /** Integer index under the pointer, or `null` when parting is inactive. */
  hoveredIndex: number | null;
  /** True when at least one card actually moves. */
  isParted: boolean;
  /** Largest `|delta|` in px (useful for allocating a transform layer). */
  maxAbsDelta: number;
}

/** A row of `count` zero deltas (the inactive parting state). */
function zeroDeltas(count: number): number[] {
  const deltas = new Array<number>(count);
  for (let index = 0; index < count; index += 1) deltas[index] = 0;
  return deltas;
}

/**
 * T-90-feedback-20261123_020207-2 ITEM-QA6: localized hover-parting
 * displacements, in px.
 *
 * `basePositions` are the resting left edges (from [[computeHandLayout]]).
 *
 * T-90 Hover Parting: the flare is one-sided. Cards stack left-to-right, so
 * card `i + 1` covers the right part of card `i`. Flaring both sides made
 * `x(hovered) - x(hovered - 1)` and `x(hovered + 1) - x(hovered)` equally
 * wide, and two cards looked equally selected. Now only the right side moves:
 *
 * - The hovered card is pinned (`deltas[hovered] === 0`) and every card to its
 *   LEFT keeps an exact `0` delta, so card `h - 1` stays at its resting
 *   overlap. Nothing behind the cursor competes for the reveal, so the
 *   hovered card's exposed margin `x(h + 1) - x(h)` is strictly the widest in
 *   the hand (lane-bounded only at the right end of the row).
 * - Only `hoveredIndex + 1 .. hoveredIndex + radius` may move, each rightward
 *   (`partDeltaX > 0`). Every card outside that window gets an exact `0`
 *   delta, so a 30-card hovered hand keeps 26 cards overlapping exactly as the
 *   hand size demands.
 * - Inside that window the resting span from the hovered card to the first
 *   untouched card (or to the lane edge at the end of the hand) is fixed, and
 *   the gaps inside it are re-weighted by [[hoverPartingWeight]]: full opening
 *   on the immediate neighbour, a fifth on the next, a twentieth on the third.
 *   The fit scale shrinks every gap in that window by the same factor when the
 *   span cannot hold the flare, which keeps the coordinates strictly ordered
 *   (`delta(j) - delta(j + 1)` never exceeds the resting step), keeps every
 *   card inside the hand lane, and pins every card beyond the window to its
 *   resting slot.
 * - The hovered card itself never moves and a single-card hand never parts.
 * - Hovering the rightmost card moves nothing at all: it already paints fully
 *   on top of the stack, and opening `h - 1` behind it would re-create the
 *   ambiguous two-card reveal.
 *
 * The returned array is the pure input for `translate3d` positioning: Wave 2
 * reuses it verbatim for in-hand drag parting, so both gestures share one
 * geometry.
 */
export function computeLocalizedPartingDeltas(
  basePositions: readonly number[],
  cardWidth: number,
  maximalBoxWidth: number,
  hoveredIndex: number | null,
  minVisibleStripPx: number = DEFAULT_MIN_VISIBLE_INDEX_STRIP_PX,
  radius: number = HAND_HOVER_PARTING_RADIUS,
): number[] {
  const count = basePositions.length;
  const deltas = zeroDeltas(count);
  // ITEM-6c: nothing to part with a single card (or none at all).
  if (count <= 1) return deltas;
  if (hoveredIndex === null || hoveredIndex === undefined) return deltas;
  if (!Number.isFinite(hoveredIndex)) return deltas;
  const hovered = Math.floor(hoveredIndex);
  if (hovered !== hoveredIndex || hovered < 0 || hovered >= count) return deltas;

  const width = Math.max(1, cardWidth);
  const boxWidth = Math.max(width, maximalBoxWidth);
  const strip = clamp(minVisibleStripPx, 0, width);
  // Local opening target: just past the minimum-overlap stride (so an already
  // expanded hand still flares) and never below the index strip.
  const spreadStep =
    Math.max(width * (1 - HAND_MIN_OVERLAP_RATIO), strip) +
    width * HAND_HOVER_SPREAD_MARGIN_RATIO;
  const reach = Math.max(
    0,
    Math.floor(finiteOr(radius, HAND_HOVER_PARTING_RADIUS)),
  );
  const pivot = basePositions[hovered];
  const rightBound = Math.max(pivot, boxWidth - width);

  // Single-card reveal: only the right side opens. A left neighbour at its
  // resting overlap keeps `x(h) - x(h - 1) === restingStep`, so the hovered
  // card's own gap is uniquely the widest in the hand.
  const available = count - 1 - hovered;
  const window = Math.min(reach, available);
  // Nothing to reveal when the pointer is on the rightmost (top) card.
  if (window <= 0) return deltas;
  // The first card OUTSIDE the local window is the wall every moved card has
  // to stay behind; it never gets a delta itself. When the window reaches the
  // end of the hand, the lane edge is the wall instead, so a hand hovered near
  // the right end can still use the parting runway around it.
  const wallIndex = hovered + window + 1;
  const hasWall = wallIndex < count;
  // The gaps that share the fixed span: the moved gaps plus, when a wall
  // exists, the gap that ends on it (weight `0`, so it keeps its resting share
  // and only scales with the rest).
  const gapCount = hasWall ? window + 1 : window;
  const gaps: number[] = [];
  for (let distance = 1; distance <= gapCount; distance += 1) {
    const left = hovered + distance - 1;
    const baseGap = Math.max(0, basePositions[left + 1] - basePositions[left]);
    const extra = Math.max(0, spreadStep - baseGap) * hoverPartingWeight(distance);
    gaps.push(baseGap + extra);
  }
  const span = hasWall
    ? Math.max(0, basePositions[wallIndex] - pivot)
    : Math.max(0, rightBound - pivot);
  const scale = localPartingFitScale(gaps, span);
  let offset = 0;
  for (let distance = 1; distance <= window; distance += 1) {
    offset += gaps[distance - 1] * scale;
    const index = hovered + distance;
    // Delta against the card's OWN resting slot — never against the pivot.
    deltas[index] = pivot + offset - basePositions[index];
  }

  // The hovered card is pinned and every card outside the window stays at 0.
  deltas[hovered] = 0;
  for (let index = 0; index < count; index += 1) {
    deltas[index] = round2(deltas[index]);
  }
  return deltas;
}

/**
 * ITEM-6a/6b/6c: localized hover-parting geometry for one hand row.
 *
 * - The hovered card never moves: `positions[hoveredIndex] === basePositions[hoveredIndex]`
 *   and `deltas[hoveredIndex] === 0`.
 * - Only the tight local window from [[computeLocalizedPartingDeltas]] moves;
 *   every distant card keeps its resting left edge (`deltas[i] === 0`), so the
 *   row stays strictly ordered and never leaves the maximal hand lane.
 * - Parting is disabled for `cardCount <= 1`, an empty hand, or an inactive /
 *   out-of-range hover: `positions` is the very same `basePositions` array and
 *   every delta is strictly `0`.
 *
 * The returned `deltas` are what the table animates with
 * `cardTranslate3d(deltaX, liftY)` — no layout reflow per frame.
 */
export function computePartedCardLayout(
  basePositions: readonly number[],
  cardWidth: number,
  maximalBoxWidth: number,
  hoveredIndex: number | null,
  minVisibleStripPx: number = DEFAULT_MIN_VISIBLE_INDEX_STRIP_PX,
): PartedCardLayout {
  const count = basePositions.length;
  const resting: PartedCardLayout = {
    positions: basePositions,
    deltas: zeroDeltas(count),
    hoveredIndex: null,
    isParted: false,
    maxAbsDelta: 0,
  };
  if (count <= 1) return resting;
  if (hoveredIndex === null || hoveredIndex === undefined) return resting;
  if (!Number.isFinite(hoveredIndex)) return resting;
  const hovered = Math.floor(hoveredIndex);
  if (hovered !== hoveredIndex || hovered < 0 || hovered >= count) return resting;

  const deltas = computeLocalizedPartingDeltas(
    basePositions,
    cardWidth,
    maximalBoxWidth,
    hovered,
    minVisibleStripPx,
  );

  let maxAbsDelta = 0;
  const positions = basePositions.map((x, index) => {
    const delta = index === hovered ? 0 : deltas[index];
    maxAbsDelta = Math.max(maxAbsDelta, Math.abs(delta));
    return round2(x + delta);
  });
  // The hovered card is pinned — never moves, not even by rounding.
  positions[hovered] = basePositions[hovered];

  return {
    positions,
    deltas,
    hoveredIndex: hovered,
    isParted: maxAbsDelta > 0,
    maxAbsDelta: round2(maxAbsDelta),
  };
}

/**
 * ITEM-6a: backward-compatible position-only view of
 * [[computePartedCardLayout]]. Returns the very same `basePositions` array when
 * parting is inactive.
 */
export function computePartedCardPositions(
  basePositions: readonly number[],
  cardWidth: number,
  maximalBoxWidth: number,
  hoveredIndex: number | null,
  minVisibleStripPx: number = DEFAULT_MIN_VISIBLE_INDEX_STRIP_PX,
): readonly number[] {
  return computePartedCardLayout(
    basePositions,
    cardWidth,
    maximalBoxWidth,
    hoveredIndex,
    minVisibleStripPx,
  ).positions;
}

/**
 * T-90-feedback-20261123_020207-2: pure resting-position helper. Returns the
 * exact left edges every hand transform is expressed from, so a caller (Wave 2's
 * in-hand drag parting, for example) can reuse the same primitives end to end.
 */
export function computeRestingCardPositions(
  options: HandLayoutOptions,
): readonly number[] {
  return computeHandLayout(options).cardPositions;
}

/**
 * T-90-feedback-20261123_020207-2: the single `translate3d` primitive every hand
 * card is positioned with — hover parting and drag parting alike. Compositor
 * only: no `left`, `top`, `margin-left` or width is ever animated.
 */
export function cardTranslate3d(x: number, y: number): string {
  return `translate3d(${round2(x)}px, ${round2(y)}px, 0)`;
}

/**
 * T-90-feedback-20261123_020207-4 ITEM-NEW2: how wide the in-hand drag
 * insertion slot opens, as a share of the card width. A full card fits into the
 * parted slot (`100px` on desktop, `48px` on mobile), so there is never any
 * doubt where the dragged card will land.
 */
export const DRAG_INSERT_GAP_RATIO = 1;
/**
 * ITEM-NEW2: how many neighbours on each side of the insertion slot may move.
 * Matches the hover-parting radius, so the drag parting is equally local: a
 * 30-card hand keeps every distant card exactly where it rests.
 */
export const HAND_DRAG_PARTING_RADIUS = 3;
/** Smallest gap the parted row may leave between two moved cards, in px. */
const DRAG_PARTING_MIN_GAP_PX = 1;

/** Geometry shared by both in-hand drag reorder helpers. */
export interface DragHandGeometryOptions {
  /** Total hand size, including the card being dragged. */
  cardCount: number;
  /** Live width of `[data-zone="player-hand"]`. */
  containerWidth: number;
  /** Index of the dragged card in the full (N-card) hand order. */
  dragSourceIndex: number;
  /** Canonical card width: `100` desktop, `48` mobile. */
  baseCardWidth?: number;
  /** Canonical card height: `140` desktop, `68` mobile. */
  baseCardHeight?: number;
  /** The widest box the remaining hand may occupy (the Option B maximal box). */
  maximalBoxWidth?: number;
  /** Exposed left strip used by the resting row (`CARD_INDEX_STRIP_WIDTH_PX`). */
  minVisibleStripPx?: number;
}

/** The resting row of the `N - 1` cards left once the dragged one is removed. */
export interface DragHandRow {
  cardCount: number;
  remainingCount: number;
  dragSourceIndex: number;
  cardWidth: number;
  /** Rightmost left edge the row may use (`maximalBoxWidth - cardWidth`). */
  maximalLeftEdge: number;
  restingPositions: readonly number[];
}

/**
 * ITEM-NEW2: the resting row with the dragged card's old spot collapsed.
 *
 * The `N - 1` remaining cards are laid out exactly as if the dragged card had
 * been removed from the hand, so its original slot closes and the rest of the
 * row keeps the natural overlap the hand size demands. Both the live insertion
 * resolver and the parting solver start from this row.
 */
function resolveDragHandRow(options: DragHandGeometryOptions): DragHandRow {
  const cardCount = Math.max(0, Math.floor(finiteOr(options.cardCount, 0)));
  const remainingCount = Math.max(0, cardCount - 1);
  const layout = computeHandLayout({
    cardCount: remainingCount,
    containerWidth: finiteOr(options.containerWidth, 0),
    baseCardWidth: options.baseCardWidth,
    baseCardHeight: options.baseCardHeight,
    maximalBoxWidth: options.maximalBoxWidth,
    minVisibleStripPx: options.minVisibleStripPx,
  });
  const cardWidth =
    layout.cardWidth > 0
      ? layout.cardWidth
      : Math.max(1, finiteOr(options.baseCardWidth, HAND_BASE_CARD_WIDTH));
  return {
    cardCount,
    remainingCount,
    dragSourceIndex: Math.max(
      0,
      Math.min(remainingCount, Math.floor(finiteOr(options.dragSourceIndex, 0))),
    ),
    cardWidth,
    maximalLeftEdge: Math.max(0, layout.maximalBoxWidth - cardWidth),
    restingPositions: layout.cardPositions,
  };
}

export interface DragInsertOptions extends DragHandGeometryOptions {
  /** Live pointer x in the hand lane's coordinate space (`clientX - laneLeft`). */
  pointerX: number;
  /** Extra px left/right of the lane that still count as inside the hand. */
  tolerancePx?: number;
}

/**
 * ITEM-NEW2: the insertion slot `0..remainingCount` the pointer is aiming at,
 * or `null` when the pointer is outside the hand lane.
 *
 * The slot is resolved from the RESTING row of the remaining cards, never from
 * the parted transforms: a left-to-right sweep is therefore strictly
 * non-decreasing (`0 -> 1 -> ... -> remainingCount`), so the slot animation can
 * never oscillate while the row moves under a stationary cursor. A pointer at
 * or left of the first remaining card's centre resolves to `0`, one past a
 * card's centre resolves to the slot after it, and one past the last card's
 * centre resolves to the rightmost slot.
 *
 * T-96: the boundary is STRICT. A small hand (`<= HAND_SMALL_HAND_MAX_CARDS`)
 * is re-centred by `startX` (0 -> 32px on desktop) as soon as it drops to
 * `N - 1` cards, so the remaining row's centres move left by that shift. An
 * inclusive `<=` therefore treated the exact midpoint between two ORIGINAL
 * slots as sitting on the re-centred next card's centre and jumped one slot
 * too far (`146 <= 146` -> `2` instead of `1`, `274 <= 274` -> `4` instead of
 * `3`). Comparing strictly keeps an exact midpoint on the lower slot, which is
 * the slot the pointer is aiming at, and still sweeps monotonically.
 */
export function resolveDragInsertIndex(options: DragInsertOptions): number | null {
  const row = resolveDragHandRow(options);
  // A one-card hand has no reorder slot, and an empty hand has no row at all.
  if (row.cardCount <= 1 || row.remainingCount === 0) return null;
  const pointerX = finiteOr(options.pointerX, 0);
  const tolerance = Math.max(0, finiteOr(options.tolerancePx, 0));
  if (pointerX < -tolerance) return null;
  // The lane, not the tight card row, is the drop surface: the empty runway
  // right of a small hand still targets the rightmost slot.
  if (pointerX > row.maximalLeftEdge + row.cardWidth + tolerance) return null;

  let insertIndex = 0;
  for (let index = 0; index < row.restingPositions.length; index += 1) {
    // T-96: strict — an exact midpoint between two cards belongs to the lower
    // slot, never to the card whose re-centred centre it happens to equal.
    if (row.restingPositions[index] + row.cardWidth / 2 < pointerX) {
      insertIndex = index + 1;
    }
  }
  return clamp(insertIndex, 0, row.remainingCount);
}

export interface DragPartingOptions extends DragHandGeometryOptions {
  /** Live insertion slot `0..remainingCount`, or `null` outside the hand. */
  dragInsertIndex: number | null;
}

export interface DragPartedLayout {
  /** Resting left edges of the `N - 1` remaining cards. */
  restingPositions: readonly number[];
  /** Parted left edges of the `N - 1` remaining cards. */
  positions: readonly number[];
  /** `positions[i] - restingPositions[i]`; exact `0` outside the local window. */
  deltas: readonly number[];
  /** Active insertion slot, or `null` when the row is closed. */
  insertIndex: number | null;
  /** Realised width of the insertion gap, in px (`0` when closed). */
  gapPx: number;
  isParted: boolean;
  remainingCount: number;
}

/**
 * ITEM-NEW2: pure drag-parting geometry for the remaining hand row.
 *
 * - The dragged card's old spot is excluded, so the `N - 1` cards rest in their
 *   natural overlapping arrangement (see [[resolveDragHandRow]]).
 * - At an active `dragInsertIndex` the row opens a gap of up to one full card
 *   width at exactly that slot. Only [[HAND_DRAG_PARTING_RADIUS]] neighbours on
 *   each side move; every distant card keeps an exact `0` delta, so a 30-card
 *   compressed hand stays anchored.
 * - Each side's opening is capped by the resting slack inside its local window,
 *   which keeps the row strictly ordered and every card inside the lane
 *   (`maximalBoxWidth - cardWidth`).
 * - `dragInsertIndex === null` returns the resting row unchanged (every delta
 *   `0`), which is what smoothly closes the gap when the pointer leaves the
 *   hand.
 */
export function computeDragPartedCardPositions(
  options: DragPartingOptions,
): DragPartedLayout {
  const row = resolveDragHandRow(options);
  const resting = row.restingPositions;
  const count = resting.length;
  const positions = resting.slice();
  const closed: DragPartedLayout = {
    restingPositions: resting,
    positions,
    deltas: zeroDeltas(count),
    insertIndex: null,
    gapPx: 0,
    isParted: false,
    remainingCount: row.remainingCount,
  };
  if (count === 0) return closed;
  const requested = options.dragInsertIndex;
  if (requested === null || requested === undefined) return closed;
  if (!Number.isFinite(requested)) return closed;
  const insertIndex = clamp(Math.floor(requested), 0, count);

  const cardWidth = row.cardWidth;
  // The inserted card needs a full card width, but a hand already resting at a
  // wider stride keeps its own (larger) gap rather than closing back up.
  const targetGap = cardWidth * DRAG_INSERT_GAP_RATIO;
  const laneRightEdge = row.maximalLeftEdge;
  const laneRight = laneRightEdge + cardWidth;
  const baseGap =
    insertIndex === 0
      ? Math.max(0, resting[0])
      : insertIndex === count
        ? Math.max(0, laneRightEdge - resting[count - 1])
        : Math.max(0, resting[insertIndex] - resting[insertIndex - 1]);
  const needed = Math.max(0, targetGap - baseGap);

  const leftWindow = Math.min(HAND_DRAG_PARTING_RADIUS, insertIndex);
  const rightWindow = Math.min(HAND_DRAG_PARTING_RADIUS, count - insertIndex);

  // How far each side may move before its outermost moved card would cross the
  // wall card (or the lane edge) and the row would lose its ordering.
  let maxLeftOpen = 0;
  if (leftWindow > 0) {
    let minGap = Number.POSITIVE_INFINITY;
    for (let index = insertIndex - leftWindow; index < insertIndex; index += 1) {
      const leftEdge = index - 1 >= 0 ? resting[index - 1] : 0;
      minGap = Math.min(minGap, resting[index] - leftEdge);
    }
    maxLeftOpen = leftWindow * Math.max(0, minGap - DRAG_PARTING_MIN_GAP_PX);
  }
  let maxRightOpen = 0;
  if (rightWindow > 0) {
    let minGap = Number.POSITIVE_INFINITY;
    for (let index = insertIndex; index < insertIndex + rightWindow; index += 1) {
      const rightEdge = index + 1 < count ? resting[index + 1] : laneRightEdge;
      minGap = Math.min(minGap, rightEdge - resting[index]);
    }
    maxRightOpen = rightWindow * Math.max(0, minGap - DRAG_PARTING_MIN_GAP_PX);
  }

  // Split the opening between both sides, spilling any shortfall onto the side
  // that still has room.
  let leftOpen = Math.min(needed / 2, maxLeftOpen);
  let rightOpen = Math.min(needed - leftOpen, maxRightOpen);
  const leftover = needed - leftOpen - rightOpen;
  if (leftover > 0) leftOpen += Math.min(leftover, maxLeftOpen - leftOpen);

  if (leftWindow > 0) {
    for (let distance = 1; distance <= leftWindow; distance += 1) {
      const index = insertIndex - distance;
      const share = (leftWindow - distance + 1) / leftWindow;
      positions[index] = resting[index] - leftOpen * share;
    }
  }
  if (rightWindow > 0) {
    for (let distance = 1; distance <= rightWindow; distance += 1) {
      const index = insertIndex + distance - 1;
      const share = (rightWindow - distance + 1) / rightWindow;
      positions[index] = resting[index] + rightOpen * share;
    }
  }

  const rounded = positions.map((position) => round2(position));
  const deltas = rounded.map((position, index) => round2(position - resting[index]));
  const realisedGap =
    insertIndex === 0
      ? Math.max(0, rounded[0])
      : insertIndex === count
        ? Math.max(0, laneRightEdge - rounded[count - 1])
        : Math.max(0, rounded[insertIndex] - rounded[insertIndex - 1]);

  return {
    restingPositions: resting,
    positions: rounded,
    deltas,
    insertIndex,
    gapPx: round2(Math.min(realisedGap, laneRight)),
    isParted: deltas.some((delta) => delta !== 0),
    remainingCount: row.remainingCount,
  };
}

/**
 * T-96: resolves the hand card under a live pointer from the RESTING row.
 *
 * Hit-testing the animated DOM (`closest('.hand-card-wrapper')`) is unstable
 * while hover-parting runs: transforming cards out from under the cursor
 * changes the very next hit test, so a neighboring card takes over, parts the
 * row back, and the highlight oscillates (the `7 reversals` seen at neighbor
 * index 16 on a 30-card compressed hand). This resolver ignores every animated
 * transform and maps the pointer's viewport x onto the resting slot that paints
 * on top at that x: in an overlapping row that is the right-most card whose
 * resting left edge the pointer has reached. A left-to-right sweep therefore
 * yields a strictly non-decreasing index.
 *
 * Returns `null` for a pointer left of the first card or past the last card's
 * right edge, so the caller can keep the previous hover while the cursor is in
 * the row's runway.
 */
export function resolveHoveredCardIndex(
  clientX: number,
  positions: readonly number[],
  cardWidth: number,
  boxLeft = 0,
): number | null {
  const count = positions.length;
  if (count === 0) return null;
  if (!Number.isFinite(clientX)) return null;
  const width = Math.max(1, finiteOr(cardWidth, HAND_BASE_CARD_WIDTH));
  const left = finiteOr(boxLeft, 0);
  const x = clientX - left;
  let found = -1;
  for (let index = 0; index < count; index += 1) {
    if (positions[index] <= x + EPS) found = index;
  }
  if (found < 0) return null;
  if (x > positions[found] + width + EPS) return null;
  return found;
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
