/**
 * T-90-feedback-20261122_011021-2 ITEM-3 & ITEM-5: pure, framework-agnostic
 * hand geometry for the player's hand.
 *
 * Two independent concerns live here, and Wave 2's `GameTable.tsx` consumes
 * both:
 *
 * 1. [[computeHandLayout]] — where each card goes. Cards overlap by 20%-80% of
 *    their width (so the left rank/suit corner of every card stays uncovered),
 *    the row is centred, and an extreme hand (24-52 cards) wraps into at most
 *    two tightly overlapping rows — scaling down only if two rows still cannot
 *    fit. `stageWidth` never exceeds the measured available width.
 * 2. [[buildHandContourPath]] — the tight, non-rectangular SVG outline that
 *    hugs every laid-out card. Raised (playable/selected) cards make the top
 *    and bottom edges step around their exact silhouettes.
 *
 * No DOM access, no React/Preact imports: a single `containerWidth` number in,
 * deterministic numbers and one SVG `d` string out.
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
/** Largest share of a card's width covered by its left-hand neighbour. */
export const HAND_MAX_OVERLAP_RATIO = 0.8;
/** Canonical desktop card footprint. */
export const HAND_BASE_CARD_WIDTH = 100;
export const HAND_BASE_CARD_HEIGHT = 140;
/** Vertical upward shift of a playable / selected card. */
export const HAND_LIFT_PX = 18;
/** A full-deck hand never wraps into more than two rows. */
export const HAND_MAX_ROWS = 2;
/** Vertical gap between two wrapped rows. */
export const HAND_ROW_GAP = 12;
/** Space between the cards and the highlight contour. */
export const HAND_CONTOUR_PADDING = 6;
/** Corner radius of the highlight contour. */
export const HAND_CONTOUR_CORNER_RADIUS = 12;

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

export interface HandLayoutOptions {
  /** Number of cards in the hand. */
  cardCount: number;
  /** Live width of `[data-zone="player-hand"]`, ideally from a ResizeObserver. */
  containerWidth: number;
  /** Canonical card width: `100` desktop, `48` mobile. */
  baseCardWidth?: number;
  /** Canonical card height: `140` desktop, `68` mobile. */
  baseCardHeight?: number;
  /** Cards shifted upward because they can be played right now. */
  liftedIndices?: ReadonlySet<number> | readonly number[];
  /** Upward shift for playable cards. */
  liftPx?: number;
  /** Cards shifted upward because they are selected for a multi-card action. */
  selectedIndices?: ReadonlySet<number> | readonly number[];
  /** Upward shift for selected cards (defaults to `liftPx`). */
  selectedLiftPx?: number;
  /** Total horizontal inset the stage must respect, in px. */
  horizontalPadding?: number;
  /** Lower bound of the overlap range (default `0.2`). */
  minOverlapRatio?: number;
  /** Upper bound of the overlap range (default `0.8`). */
  maxOverlapRatio?: number;
  /** Rows an extreme hand may wrap into (default `2`). */
  maxRows?: number;
  /** Gap between wrapped rows (default `12`). */
  rowGap?: number;
}

/** Which reason (if any) shifted a card upward. */
export type HandLiftLevel = 'none' | 'playable' | 'selected';

export interface HandCardLayout extends CardRect {
  /** Position in the original hand. */
  index: number;
  /** Wrapped row this card belongs to (`0` is the top row). */
  row: number;
  /** Exact upward shift applied to this card, in px. */
  lift: number;
  liftLevel: HandLiftLevel;
}

export interface HandLayoutResult {
  cards: HandCardLayout[];
  /** Number of rows the hand wrapped into (0 for an empty hand). */
  rows: number;
  /** Cards per row, top row first. */
  rowCounts: number[];
  /** Stride (left-edge distance) of every row, in px. */
  rowSteps: number[];
  /** Width of every row, in px. */
  rowWidths: number[];
  /** Card footprint actually used (scaled down only for extreme hands). */
  cardWidth: number;
  cardHeight: number;
  /** Stride and overlap of the first row (the single-row hand case). */
  step: number;
  overlap: number;
  overlapRatio: number;
  /** Vertical stride between rows (`cardHeight + rowGap`). */
  rowHeight: number;
  /** Box the cards occupy; `stageWidth <= availableWidth` always holds. */
  stageWidth: number;
  stageHeight: number;
  /** `containerWidth` minus the reserved horizontal padding, floored at one card. */
  availableWidth: number;
  /** Left inset that centres the stage inside `containerWidth`. */
  offsetX: number;
  /** Height reserved above the baseline for raised cards. */
  maxLift: number;
  /** Layout scale applied to the canonical card footprint (1 = none). */
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
  overlap: 0,
  overlapRatio: 0,
  rowHeight: 0,
  stageWidth: 0,
  stageHeight: 0,
  availableWidth: 0,
  offsetX: 0,
  maxLift: 0,
  scale: 1,
};

/**
 * Lays a hand out inside `containerWidth`.
 *
 * Guarantees, for any count in `0..52` and any reasonable width:
 * - every consecutive pair of cards in a row overlaps by 20%-80% of the card
 *   width, so at least the left 20% (rank + suit) of every card is visible;
 * - `stageWidth <= availableWidth <= containerWidth` (when the container is at
 *   least one card wide);
 * - no card has a negative coordinate, and every card stays inside
 *   `stageWidth x stageHeight`;
 * - a hand that cannot fit one row wraps into two rows, and only then scales
 *   the card footprint down.
 */
export function computeHandLayout(options: HandLayoutOptions): HandLayoutResult {
  const baseCardWidth = Math.max(
    1,
    finiteOr(options.baseCardWidth, HAND_BASE_CARD_WIDTH),
  );
  const baseCardHeight = Math.max(
    1,
    finiteOr(options.baseCardHeight, HAND_BASE_CARD_HEIGHT),
  );
  const cardCount = Math.max(0, Math.floor(finiteOr(options.cardCount, 0)));
  const containerWidth = Math.max(0, finiteOr(options.containerWidth, 0));
  const horizontalPadding = Math.max(0, finiteOr(options.horizontalPadding, 0));
  const availableWidth = Math.max(containerWidth - horizontalPadding, baseCardWidth);
  const liftPx = Math.max(0, finiteOr(options.liftPx, HAND_LIFT_PX));
  const selectedLiftPx = Math.max(0, finiteOr(options.selectedLiftPx, liftPx));
  const maxLift = Math.max(liftPx, selectedLiftPx);
  const maxRows = Math.max(1, Math.floor(finiteOr(options.maxRows, HAND_MAX_ROWS)));
  const rowGap = Math.max(0, finiteOr(options.rowGap, HAND_ROW_GAP));
  const minOverlapRatio = clamp(
    finiteOr(options.minOverlapRatio, HAND_MIN_OVERLAP_RATIO),
    0,
    0.95,
  );
  const maxOverlapRatio = clamp(
    finiteOr(options.maxOverlapRatio, HAND_MAX_OVERLAP_RATIO),
    minOverlapRatio,
    0.98,
  );
  // A stride of `cardWidth * (1 - maxOverlapRatio)` is the tightest row (80%
  // covered); `cardWidth * (1 - minOverlapRatio)` is the loosest (20% covered).
  const tightStepRatio = 1 - maxOverlapRatio;
  const looseStepRatio = 1 - minOverlapRatio;
  const lifted = toIndexSet(options.liftedIndices);
  const selected = toIndexSet(options.selectedIndices);

  if (cardCount === 0) {
    return {
      ...EMPTY_LAYOUT,
      cardWidth: round2(baseCardWidth),
      cardHeight: round2(baseCardHeight),
      availableWidth: round2(availableWidth),
      maxLift: round2(maxLift),
    };
  }

  // --- Rows: a full-deck hand wraps instead of running off the column. -------
  let rows = 1;
  if (cardCount >= 2) {
    const tightStep = baseCardWidth * tightStepRatio;
    const capacity = 1 + Math.max(0, Math.floor((availableWidth - baseCardWidth) / tightStep));
    if (cardCount > capacity) {
      rows = Math.min(maxRows, Math.max(2, Math.ceil(cardCount / Math.max(1, capacity))));
    }
  }

  const rowCounts: number[] = [];
  const perRow = Math.ceil(cardCount / rows);
  for (let row = 0; row < rows; row += 1) {
    rowCounts.push(Math.min(perRow, cardCount - row * perRow));
  }
  const widestRow = Math.max(...rowCounts);

  // --- Card footprint: scale down only when two tight rows still overflow. ---
  let cardWidth = baseCardWidth;
  let cardHeight = baseCardHeight;
  let scale = 1;
  const widestRowAtMaxOverlap = baseCardWidth + (widestRow - 1) * baseCardWidth * tightStepRatio;
  if (widestRowAtMaxOverlap > availableWidth + EPS) {
    scale = availableWidth / widestRowAtMaxOverlap;
    cardWidth = baseCardWidth * scale;
    cardHeight = baseCardHeight * scale;
  }
  const minStep = cardWidth * tightStepRatio;
  const maxStep = cardWidth * looseStepRatio;

  const rowSteps = rowCounts.map((count) => {
    if (count <= 1) return cardWidth;
    const idealStep = (availableWidth - cardWidth) / (count - 1);
    const step = clamp(idealStep, minStep, maxStep);
    // Never let a row overflow, even after the loose-step clamp.
    return Math.min(step, (availableWidth - cardWidth) / (count - 1));
  });
  const rowWidths = rowCounts.map((count, row) => cardWidth + (count - 1) * rowSteps[row]);
  const stageWidth = Math.min(availableWidth, Math.max(...rowWidths));
  const rowHeight = cardHeight + rowGap;
  const stageHeight = maxLift + rows * cardHeight + (rows - 1) * rowGap;

  const cards: HandCardLayout[] = [];
  let index = 0;
  for (let row = 0; row < rows; row += 1) {
    const count = rowCounts[row];
    const rowOffset = (stageWidth - rowWidths[row]) / 2;
    for (let column = 0; column < count; column += 1) {
      const isSelected = selected.has(index);
      const isPlayable = lifted.has(index);
      const lift = Math.max(isSelected ? selectedLiftPx : 0, isPlayable ? liftPx : 0);
      const liftLevel: HandLiftLevel = isSelected ? 'selected' : isPlayable ? 'playable' : 'none';
      cards.push({
        index,
        row,
        x: round2(rowOffset + column * rowSteps[row]),
        y: round2(maxLift + row * rowHeight - lift),
        width: round2(cardWidth),
        height: round2(cardHeight),
        lift: round2(lift),
        liftLevel,
      });
      index += 1;
    }
  }

  const step = rowSteps[0];
  const overlap = cardWidth - step;

  return {
    cards,
    rows,
    rowCounts,
    rowSteps: rowSteps.map(round2),
    rowWidths: rowWidths.map(round2),
    cardWidth: round2(cardWidth),
    cardHeight: round2(cardHeight),
    step: round2(step),
    overlap: round2(overlap),
    overlapRatio: cardWidth > 0 ? round2(overlap / cardWidth) : 0,
    rowHeight: round2(rowHeight),
    stageWidth: round2(stageWidth),
    stageHeight: round2(stageHeight),
    availableWidth: round2(availableWidth),
    offsetX: round2(Math.max(0, (containerWidth - stageWidth) / 2)),
    maxLift: round2(maxLift),
    scale: round2(scale),
  };
}

export interface HandContourOptions {
  /** Space the contour keeps around the cards (default `6`). */
  padding?: number;
  /** Outer / inner corner radius (default `12`). */
  cornerRadius?: number;
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
 * Builds the tight highlight contour around a laid-out hand.
 *
 * Each card is padded, then the outer union boundary is traced: the top edge
 * follows the lowest top over every x interval and the bottom edge the highest
 * bottom, so a raised (playable / selected) card produces an immediate vertical
 * step up at its left edge and back down at its right edge — the outline
 * distorts non-rectangularly around the hand instead of being a box.
 *
 * Returns the `d` string plus the exact viewBox it is drawn in, and
 * `isNonRectangular` (true as soon as two cards differ vertically) so callers
 * can expose `data-contour-shape="stepped" | "uniform"`.
 */
export function buildHandContourPath(
  rects: readonly CardRect[],
  options: HandContourOptions = {},
): HandContourPath {
  const padding = Math.max(0, finiteOr(options.padding, HAND_CONTOUR_PADDING));
  const cornerRadius = Math.max(
    0,
    finiteOr(options.cornerRadius, HAND_CONTOUR_CORNER_RADIUS),
  );
  const usable = rects.filter(
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
