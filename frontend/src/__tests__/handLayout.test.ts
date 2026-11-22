import { describe, expect, it } from 'vitest';
import {
  BASELINE_LIFT_PX,
  DEFAULT_MIN_VISIBLE_INDEX_STRIP_PX,
  ELIGIBLE_LIFT_PX,
  FULL_SELECTED_LIFT_PX,
  HAND_BASE_CARD_HEIGHT,
  HAND_BASE_CARD_WIDTH,
  HAND_CONTOUR_CORNER_RADIUS,
  HAND_CONTOUR_PADDING,
  HAND_MIN_OVERLAP_RATIO,
  SELECTED_LIFT_PX,
  buildHandContourPath,
  computeHandLayout,
  computePartedCardPositions,
  getCardVerticalLiftPx,
  type CardRect,
  type HandLayoutResult,
} from '../utils/handLayout';

const EPS = 0.02;
const CARD_WIDTH = HAND_BASE_CARD_WIDTH; // 100
const CARD_HEIGHT = HAND_BASE_CARD_HEIGHT; // 140
const BOX = 632; // a 640px hand column minus the 4px contour padding each side
const STRIP = DEFAULT_MIN_VISIBLE_INDEX_STRIP_PX; // 36
const MIN_STEP = CARD_WIDTH * (1 - HAND_MIN_OVERLAP_RATIO); // 80
const DEFAULT_SIX_CARD_BOX = CARD_WIDTH + 5 * MIN_STEP; // 500
const MAX_ALLOWABLE_OVERLAP_RATIO = 1 - STRIP / CARD_WIDTH; // 0.64

/** End points (absolute M/L/A targets) of a path built by this module. */
function segments(pathD: string): Array<{ command: string; x: number; y: number }> {
  const tokens = pathD.match(/[MLAZ]|-?\d+(?:\.\d+)?/g) ?? [];
  const result: Array<{ command: string; x: number; y: number }> = [];
  let cursor = 0;
  while (cursor < tokens.length) {
    const command = tokens[cursor];
    cursor += 1;
    if (command === 'Z') {
      result.push({ command, x: Number.NaN, y: Number.NaN });
      continue;
    }
    const count = command === 'A' ? 7 : 2;
    const values = tokens.slice(cursor, cursor + count).map(Number);
    cursor += count;
    result.push({ command, x: values[count - 2], y: values[count - 1] });
  }
  return result;
}

const points = (pathD: string) => segments(pathD).filter((segment) => segment.command !== 'Z');

const layoutFor = (cardCount: number, containerWidth = 640, extra = {}) =>
  computeHandLayout({ cardCount, containerWidth, maximalBoxWidth: BOX, ...extra });

function expectOrderedPositions(positions: readonly number[], box = BOX) {
  for (let index = 1; index < positions.length; index += 1) {
    expect(positions[index]).toBeGreaterThan(positions[index - 1]);
  }
  expect(positions[0]).toBeGreaterThanOrEqual(-EPS);
  if (positions.length > 0) {
    expect(positions[positions.length - 1] + CARD_WIDTH).toBeLessThanOrEqual(box + EPS);
  }
}

describe('T-90-feedback-20261122_171451-3 ITEM-5a: constant full card size', () => {
  it('never shrinks the card footprint for 1 to 52 cards', () => {
    for (const cardCount of [1, 2, 6, 7, 14, 30, 46, 52]) {
      const layout = layoutFor(cardCount, 640, { maximalBoxWidth: BOX });
      expect(layout.cardWidth).toBe(CARD_WIDTH);
      expect(layout.cardHeight).toBe(CARD_HEIGHT);
      expect(layout.scale).toBe(1);
      for (const card of layout.cards) {
        expect(card.width).toBe(CARD_WIDTH);
        expect(card.height).toBe(CARD_HEIGHT);
      }
      // 14+ card hands are already clamped by the maximal box: no overflow.
      expect(layout.totalWidth).toBeLessThanOrEqual(BOX + EPS);
    }
  });

  it('keeps the full height and width on a narrow mobile column too', () => {
    const layout = computeHandLayout({
      cardCount: 46,
      containerWidth: 292,
      baseCardWidth: 48,
      baseCardHeight: 68,
      maximalBoxWidth: 292,
    });
    expect(layout.cardWidth).toBe(48);
    expect(layout.cardHeight).toBe(68);
    expect(layout.scale).toBe(1);
    expect(layout.totalWidth).toBeLessThanOrEqual(292 + EPS);
    expect(layout.isSuperCompressed).toBe(true);
  });

  it('returns an empty, zero-size row for an empty hand', () => {
    const layout = layoutFor(0);
    expect(layout.cards).toHaveLength(0);
    expect(layout.rows).toBe(0);
    expect(layout.totalWidth).toBe(0);
    expect(layout.stageWidth).toBe(0);
    expect(layout.cardPositions).toEqual([]);
  });
});

describe('T-90-feedback-20261122_171451-3 ITEM-5b: Option B box progression', () => {
  it('centres a single full-size card', () => {
    const layout = layoutFor(1);
    expect(layout.cards).toHaveLength(1);
    expect(layout.rows).toBe(1);
    expect(layout.step).toBeCloseTo(CARD_WIDTH, 5);
    expect(layout.cardStep).toBeCloseTo(CARD_WIDTH, 5);
    expect(layout.overlap).toBe(0);
    expect(layout.overlapRatio).toBe(0);
    expect(layout.totalWidth).toBe(CARD_WIDTH);
    expect(layout.cardPositions).toEqual([0]);
    expect(layout.offsetX).toBe((640 - CARD_WIDTH) / 2);
    expect(layout.isSuperCompressed).toBe(false);
  });

  it('fills exactly the default six-card box at the minimum overlap', () => {
    const layout = layoutFor(6);
    expect(layout.defaultSixCardBoxWidth).toBe(DEFAULT_SIX_CARD_BOX);
    expect(layout.totalWidth).toBe(DEFAULT_SIX_CARD_BOX);
    expect(layout.step).toBeCloseTo(MIN_STEP, 5);
    expect(layout.overlapRatio).toBeCloseTo(HAND_MIN_OVERLAP_RATIO, 5);
    expect(layout.cardPositions).toEqual([0, 80, 160, 240, 320, 400]);
    expect(layout.isSuperCompressed).toBe(false);
  });

  it('step 2: expands past the six-card box at the same stride before compressing', () => {
    const seven = layoutFor(7);
    expect(seven.totalWidth).toBeGreaterThan(seven.defaultSixCardBoxWidth);
    expect(seven.totalWidth).toBe(CARD_WIDTH + 6 * MIN_STEP); // 580
    expect(seven.step).toBeCloseTo(MIN_STEP, 5);
    expect(seven.isSuperCompressed).toBe(false);

    // Fourteen cards cannot reach 14 * 80 + 100 = 1140 in a 632px box, so the
    // hand is clamped there with the stride recomputed from the box.
    const fourteen = layoutFor(14);
    expect(fourteen.totalWidth).toBe(BOX);
    // Metadata is reported with the module's documented 2-decimal precision.
    expect(fourteen.step).toBeCloseTo((BOX - CARD_WIDTH) / 13, 1);
    expect(fourteen.step).toBeGreaterThan(STRIP);
    expect(fourteen.isSuperCompressed).toBe(false);
    // The stride still leaves the full `"10"` index strip uncovered.
    expect(fourteen.cardWidth - fourteen.cardWidth * fourteen.overlapRatio).toBeGreaterThanOrEqual(
      STRIP - EPS,
    );
    expect(fourteen.overlapRatio).toBeLessThanOrEqual(
      fourteen.maxAllowableOverlapRatio + EPS,
    );
    expectOrderedPositions(fourteen.cardPositions);
  });

  it('step 3: the strip stays visible right up to the maximal allowable overlap', () => {
    // 100 + 14 * 36 = 604 <= 632, so 15 cards still expose the full index strip.
    const fifteen = layoutFor(15);
    expect(fifteen.step).toBeCloseTo((BOX - CARD_WIDTH) / 14, 1);
    expect(fifteen.step).toBeGreaterThanOrEqual(STRIP - EPS);
    expect(fifteen.isSuperCompressed).toBe(false);
    expect(fifteen.maxAllowableOverlapRatio).toBeCloseTo(MAX_ALLOWABLE_OVERLAP_RATIO, 5);
    // The exposed strip of the maximal allowable overlap is exactly `36px`.
    expect(fifteen.cardWidth - fifteen.cardWidth * fifteen.maxAllowableOverlapRatio).toBeCloseTo(
      STRIP,
      5,
    );

    // 100 + 15 * 36 = 640 > 632: 16 cards are the first super-compressed hand.
    const sixteen = layoutFor(16);
    expect(sixteen.totalWidth).toBe(BOX);
    expect(sixteen.step).toBeCloseTo((BOX - CARD_WIDTH) / 15, 1);
    expect(sixteen.step).toBeLessThan(STRIP);
    expect(sixteen.isSuperCompressed).toBe(true);
    expect(sixteen.overlapRatio).toBeGreaterThan(sixteen.maxAllowableOverlapRatio);
    expectOrderedPositions(sixteen.cardPositions);
  });

  it('step 4: super-compresses 30/46/52 cards inside the box, never beyond it', () => {
    for (const cardCount of [30, 46, 52]) {
      const layout = layoutFor(cardCount, 640, { maximalBoxWidth: BOX });
      expect(layout.totalWidth).toBeCloseTo(BOX, 5);
      expect(layout.step).toBeCloseTo((BOX - CARD_WIDTH) / (cardCount - 1), 1);
      expect(layout.isSuperCompressed).toBe(true);
      expect(layout.step).toBeGreaterThan(0);
      expect(layout.cardWidth).toBe(CARD_WIDTH);
      expect(layout.cards[cardCount - 1].x + CARD_WIDTH).toBeLessThanOrEqual(BOX + EPS);
      expectOrderedPositions(layout.cardPositions);
    }
  });

  it('accepts an explicit maximal box wider than the measured column', () => {
    const layout = layoutFor(10, 2000, { maximalBoxWidth: 700 });
    expect(layout.maximalBoxWidth).toBe(700);
    expect(layout.totalWidth).toBeCloseTo(700, 5);
    expect(layout.step).toBeCloseTo((700 - CARD_WIDTH) / 9, 1);

    // Without the override the same hand expands at the minimum stride.
    const wide = computeHandLayout({ cardCount: 10, containerWidth: 2000 });
    expect(wide.step).toBeCloseTo(MIN_STEP, 5);
    expect(wide.totalWidth).toBe(CARD_WIDTH + 9 * MIN_STEP);
  });

  it('honours horizontal padding as the default maximal box', () => {
    const layout = layoutFor(20, 700, { horizontalPadding: 68 });
    expect(layout.availableWidth).toBeCloseTo(632, 5);
    expect(layout.maximalBoxWidth).toBeCloseTo(632, 5);
    expect(layout.totalWidth).toBeCloseTo(632, 5);
    expect(layout.offsetX).toBeCloseTo((700 - 632) / 2, 5);
  });

  it('derives the overlap ceiling from the configurable index strip', () => {
    const narrow = layoutFor(20, 640, { maximalBoxWidth: BOX, minVisibleStripPx: 20 });
    expect(narrow.maxAllowableOverlapRatio).toBeCloseTo(0.8, 5);
    expect(narrow.minVisibleStripPx).toBe(20);

    const none = layoutFor(20, 640, { minVisibleStripPx: 0 });
    expect(none.maxAllowableOverlapRatio).toBeCloseTo(0.85, 5);

    const huge = layoutFor(20, 640, { minVisibleStripPx: 250 });
    expect(huge.minVisibleStripPx).toBe(CARD_WIDTH);
    expect(huge.maxAllowableOverlapRatio).toBe(0);

    const loose = layoutFor(6, 640, { minOverlapRatio: 0.5 });
    expect(loose.minOverlapStep).toBe(50);
    expect(loose.defaultSixCardBoxWidth).toBe(350);
    expect(loose.totalWidth).toBe(350);
  });

  it('reports the two widths every caller needs', () => {
    const layout = layoutFor(14);
    expect(layout.defaultSixCardBoxWidth).toBe(DEFAULT_SIX_CARD_BOX);
    expect(layout.maximalBoxWidth).toBe(BOX);
    expect(layout.stageWidth).toBe(layout.totalWidth);
    expect(layout.stageHeight).toBe(layout.maxLift + CARD_HEIGHT);
    expect(layout.rows).toBe(1);
    expect(layout.rowCounts).toEqual([14]);
  });
});

describe('T-90-feedback-20261122_171451-3 ITEM-2c: visible "10" strip', () => {
  it('keeps at least the full index strip uncovered while the hand still fits', () => {
    for (const cardCount of [6, 7, 14, 15]) {
      const layout = layoutFor(cardCount);
      expect(layout.cardWidth - layout.cardWidth * layout.overlapRatio).toBeGreaterThanOrEqual(
        36 - EPS,
      );
      expect(layout.step).toBeGreaterThanOrEqual(STRIP - EPS);
      expect(layout.isSuperCompressed).toBe(false);
    }
  });

  it('uses exactly the default 36px strip constant', () => {
    const layout = layoutFor(14);
    expect(layout.minVisibleStripPx).toBe(36);
    expect(DEFAULT_MIN_VISIBLE_INDEX_STRIP_PX).toBe(36);
    expect(layout.maxAllowableOverlapRatio).toBeCloseTo(1 - 36 / CARD_WIDTH, 5);
  });
});

describe('T-90-feedback-20261122_171451-3 ITEM-6c: hover-parting guards', () => {
  it('returns the very same array for a one-card hand', () => {
    const base = [0];
    expect(computePartedCardPositions(base, CARD_WIDTH, BOX, 0)).toBe(base);
    expect(computePartedCardPositions([], CARD_WIDTH, BOX, 0)).toEqual([]);
  });

  it('returns the very same array when nothing is hovered', () => {
    const base = layoutFor(14).cardPositions;
    expect(computePartedCardPositions(base, CARD_WIDTH, BOX, null)).toBe(base);
    expect(computePartedCardPositions(base, CARD_WIDTH, BOX, -1)).toBe(base);
    expect(computePartedCardPositions(base, CARD_WIDTH, BOX, 14)).toBe(base);
    expect(computePartedCardPositions(base, CARD_WIDTH, BOX, 2.5)).toBe(base);
  });

  it('leaves a two-card hand unchanged (no room to part)', () => {
    const base = [0, MIN_STEP];
    const parted = computePartedCardPositions(base, CARD_WIDTH, BOX, 0);
    expect(Array.from(parted)).toEqual(base);
  });
});

describe('T-90-feedback-20261122_171451-3 ITEM-6a/6b: hover parting solver', () => {
  const base = layoutFor(14).cardPositions;
  const baseStep = base[1] - base[0];

  it('never moves the hovered card', () => {
    for (let hovered = 0; hovered < base.length; hovered += 1) {
      const parted = computePartedCardPositions(base, CARD_WIDTH, BOX, hovered);
      expect(parted[hovered]).toBe(base[hovered]);
    }
  });

  it('opens the neighbour gap and compresses the distant cards', () => {
    const hovered = 7;
    const parted = computePartedCardPositions(base, CARD_WIDTH, BOX, hovered);

    const nearLeftGap = parted[hovered] - parted[hovered - 1];
    const nearRightGap = parted[hovered + 1] - parted[hovered];
    const farLeftGap = parted[1] - parted[0];
    const farRightGap = parted[13] - parted[12];

    expect(nearLeftGap).toBeGreaterThan(baseStep);
    expect(nearRightGap).toBeGreaterThan(baseStep);
    expect(farLeftGap).toBeLessThan(nearLeftGap);
    expect(farRightGap).toBeLessThan(nearRightGap);
    // Far cards end up more tightly packed than at rest.
    expect(farLeftGap).toBeLessThan(baseStep);
    expect(farRightGap).toBeLessThan(baseStep);
  });

  it('keeps strict left-to-right order and stays inside the box', () => {
    for (let hovered = 0; hovered < base.length; hovered += 1) {
      const parted = computePartedCardPositions(base, CARD_WIDTH, BOX, hovered);
      expectOrderedPositions(parted);
    }
  });

  it('widenes the closest neighbour to a readable strip on a tight hand', () => {
    const tight = layoutFor(46).cardPositions;
    const parted = computePartedCardPositions(tight, CARD_WIDTH, BOX, 23);
    const nearGap = parted[24] - parted[23];
    expect(nearGap).toBeGreaterThan(tight[24] - tight[23]);
    expect(nearGap).toBeGreaterThan(STRIP);
    expectOrderedPositions(parted);
  });

  it('stays ordered and boxed for every hover on a 46-card hand', () => {
    const tight = layoutFor(46).cardPositions;
    for (let hovered = 0; hovered < tight.length; hovered += 1) {
      const parted = computePartedCardPositions(tight, CARD_WIDTH, BOX, hovered);
      expect(parted[hovered]).toBe(tight[hovered]);
      expectOrderedPositions(parted);
    }
  });

  it('moves smoothly when the hover slides one card over', () => {
    for (let hovered = 1; hovered < 13; hovered += 1) {
      const left = computePartedCardPositions(base, CARD_WIDTH, BOX, hovered);
      const right = computePartedCardPositions(base, CARD_WIDTH, BOX, hovered + 1);
      for (let index = 0; index < base.length; index += 1) {
        expect(Math.abs(right[index] - left[index])).toBeLessThan(CARD_WIDTH);
      }
    }
  });

  it('widens the spread target when a wider strip is requested', () => {
    const wide = computePartedCardPositions(base, CARD_WIDTH, BOX, 7, 90);
    const standard = computePartedCardPositions(base, CARD_WIDTH, BOX, 7, STRIP);
    const wideNearGap = wide[8] - wide[7];
    const standardNearGap = standard[8] - standard[7];
    // The spread target is `max(cardWidth * 0.8, strip)`.
    expect(wideNearGap).toBeGreaterThan(standardNearGap);
    expectOrderedPositions(wide);

    // Parting a hand that was laid out in a narrow box keeps it inside it.
    const narrowBase = layoutFor(14, 300, { maximalBoxWidth: 300 }).cardPositions;
    const narrow = computePartedCardPositions(narrowBase, CARD_WIDTH, 300, 7, STRIP);
    expect(narrow[7]).toBe(narrowBase[7]);
    expectOrderedPositions(narrow, 300);
  });
});

describe('T-90-feedback-20261122_171451-3 ITEM-8: two-tier lift', () => {
  it('exposes baseline, eligible and selected magnitudes', () => {
    expect(BASELINE_LIFT_PX).toBe(0);
    expect(FULL_SELECTED_LIFT_PX).toBe(18);
    expect(ELIGIBLE_LIFT_PX).toBe(FULL_SELECTED_LIFT_PX / 2);
    expect(SELECTED_LIFT_PX).toBe(FULL_SELECTED_LIFT_PX);
  });

  it('returns 0 / half / full from the helper', () => {
    expect(getCardVerticalLiftPx({})).toBe(0);
    expect(getCardVerticalLiftPx({ isEligible: false, isSelected: false })).toBe(0);
    expect(getCardVerticalLiftPx({ isEligible: true, isSelected: false })).toBe(9);
    expect(getCardVerticalLiftPx({ isEligible: false, isSelected: true })).toBe(18);
    expect(getCardVerticalLiftPx({ isEligible: true, isSelected: true })).toBe(18);
  });

  it('lays the three tiers out from one shared baseline', () => {
    const layout = layoutFor(4, 640, {
      liftedIndices: new Set([1]),
      selectedIndices: [2],
    });

    expect(layout.cards[0].lift).toBe(0);
    expect(layout.cards[0].liftLevel).toBe('none');
    expect(layout.cards[1].lift).toBe(ELIGIBLE_LIFT_PX);
    expect(layout.cards[1].liftLevel).toBe('playable');
    expect(layout.cards[2].lift).toBe(SELECTED_LIFT_PX);
    expect(layout.cards[2].liftLevel).toBe('selected');
    expect(layout.cards[3].lift).toBe(0);

    // `y` is measured from the reserved lift band, so the baseline is shared.
    expect(layout.maxLift).toBe(SELECTED_LIFT_PX);
    expect(layout.cards[0].y).toBe(SELECTED_LIFT_PX);
    expect(layout.cards[1].y).toBe(SELECTED_LIFT_PX - ELIGIBLE_LIFT_PX);
    expect(layout.cards[2].y).toBe(0);
    expect(layout.cards[3].y).toBe(SELECTED_LIFT_PX);
    expect(layout.stageHeight).toBe(SELECTED_LIFT_PX + CARD_HEIGHT);
  });

  it('accepts explicit tier magnitudes', () => {
    const layout = layoutFor(3, 640, {
      liftedIndices: [0],
      liftPx: 4,
      selectedIndices: [1],
      selectedLiftPx: 12,
    });
    expect(layout.cards[0].lift).toBe(4);
    expect(layout.cards[1].lift).toBe(12);
    expect(layout.cards[2].lift).toBe(0);
    expect(layout.maxLift).toBe(12);
    expect(layout.cards[0].y).toBe(8);
    expect(layout.cards[1].y).toBe(0);
  });
});

describe('T-90-feedback-20261122_171451-3 ITEM-8: tight contour across lifted tiers', () => {
  it('returns an empty path for an empty hand', () => {
    const contour = buildHandContourPath([]);
    expect(contour.pathD).toBe('');
    expect(contour.viewBox).toEqual({ width: 0, height: 0 });
    expect(contour.isNonRectangular).toBe(false);
  });

  it('wraps a single rect tightly, with padding and a clean viewBox', () => {
    const card: CardRect = { x: 10, y: 20, width: 100, height: 140 };
    const contour = buildHandContourPath([card], { padding: 6, cornerRadius: 0 });

    expect(contour.left).toBe(4);
    expect(contour.top).toBe(14);
    expect(contour.viewBox).toEqual({ width: 112, height: 152 });
    expect(contour.isNonRectangular).toBe(false);
    expect(contour.pathD.startsWith('M 0 0')).toBe(true);
    expect(contour.pathD.endsWith('Z')).toBe(true);
    expect(points(contour.pathD).map((point) => [point.x, point.y])).toEqual([
      [0, 0],
      [112, 0],
      [112, 152],
      [0, 152],
    ]);
  });

  it('wraps all three lift tiers from (x, liftPx) entries', () => {
    const contour = buildHandContourPath(
      [
        { x: 0, liftPx: BASELINE_LIFT_PX },
        { x: 60, liftPx: ELIGIBLE_LIFT_PX },
        { x: 120, liftPx: SELECTED_LIFT_PX },
      ],
      { padding: 0, cornerRadius: 0, cardWidth: CARD_WIDTH, cardHeight: CARD_HEIGHT },
    );

    // Baseline cards start at y = 0, so the selected card rises 18px above them.
    expect(contour.isNonRectangular).toBe(true);
    expect(contour.left).toBe(0);
    expect(contour.top).toBe(-SELECTED_LIFT_PX);
    expect(contour.width).toBe(220);
    expect(contour.height).toBe(SELECTED_LIFT_PX + CARD_HEIGHT);
    expect(contour.viewBox).toEqual({ width: 220, height: SELECTED_LIFT_PX + CARD_HEIGHT });

    const corners = points(contour.pathD);
    // Normalised to the viewBox: baseline top = 18, eligible top = 9, selected
    // top = 0, bottom = 158.
    expect(corners.some((point) => point.x === 60 && point.y === 18)).toBe(true);
    expect(corners.some((point) => point.x === 60 && point.y === 9)).toBe(true);
    expect(corners.some((point) => point.x === 120 && point.y === 9)).toBe(true);
    expect(corners.some((point) => point.x === 120 && point.y === 0)).toBe(true);
    expect(corners.some((point) => point.y === 158)).toBe(true);
    expect(contour.pathD).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('matches the rect form exactly', () => {
    const layout = layoutFor(14, 640, {
      liftedIndices: new Set([1, 5, 9]),
      selectedIndices: [3],
    });
    const fromRects = buildHandContourPath(layout.cards, {
      padding: HAND_CONTOUR_PADDING,
      cornerRadius: 0,
    });
    const fromLifts = buildHandContourPath(
      layout.cards.map((card) => ({ x: card.x, liftPx: card.lift })),
      { padding: HAND_CONTOUR_PADDING, cornerRadius: 0 },
    );
    expect(fromLifts.pathD).toBe(fromRects.pathD);
    expect(fromLifts.viewBox).toEqual(fromRects.viewBox);
  });

  it('wraps hover-parted positions with all three tiers', () => {
    const layout = layoutFor(14);
    const parted = computePartedCardPositions(layout.cardPositions, CARD_WIDTH, BOX, 7);
    const contour = buildHandContourPath(
      parted.map((x, index) => ({
        x,
        liftPx: getCardVerticalLiftPx({ isEligible: index % 3 === 0, isSelected: index === 7 }),
      })),
      { padding: HAND_CONTOUR_PADDING, cornerRadius: 6 },
    );

    expect(contour.isNonRectangular).toBe(true);
    expect(contour.pathD.startsWith('M ')).toBe(true);
    expect(contour.pathD.endsWith('Z')).toBe(true);
    expect(contour.pathD).not.toMatch(/NaN|Infinity|undefined/);
    expect(contour.width).toBeCloseTo(
      parted[parted.length - 1] + CARD_WIDTH + HAND_CONTOUR_PADDING * 2,
      5,
    );
    expect(contour.height).toBeCloseTo(
      SELECTED_LIFT_PX + CARD_HEIGHT + HAND_CONTOUR_PADDING * 2,
      5,
    );
    for (const point of points(contour.pathD)) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
      expect(point.x).toBeGreaterThanOrEqual(-EPS);
      expect(point.y).toBeGreaterThanOrEqual(-EPS);
      expect(point.x).toBeLessThanOrEqual(contour.viewBox.width + EPS);
      expect(point.y).toBeLessThanOrEqual(contour.viewBox.height + EPS);
    }
  });

  it('keeps a uniform hand rectangular', () => {
    const layout = layoutFor(5, 640, { liftedIndices: [0, 1, 2, 3, 4] });
    const contour = buildHandContourPath(layout.cards, { padding: 0, cornerRadius: 0 });
    expect(contour.isNonRectangular).toBe(false);
    expect(points(contour.pathD)).toHaveLength(4);
    expect(contour.viewBox.width).toBeCloseTo(
      layout.cardPositions[4] + layout.cardWidth,
      5,
    );
    expect(contour.viewBox.height).toBeCloseTo(layout.cardHeight, 5);
  });

  it('rounds corners with quarter arcs and never emits malformed data', () => {
    const patterns = [new Set<number>(), new Set([0]), new Set([2]), new Set([0, 2, 4])];
    for (const liftedIndices of patterns) {
      const layout = layoutFor(5, 640, { liftedIndices, selectedIndices: [3] });
      for (const cornerRadius of [0, 6, HAND_CONTOUR_CORNER_RADIUS]) {
        const contour = buildHandContourPath(layout.cards, { padding: 4, cornerRadius });
        expect(contour.pathD.startsWith('M ')).toBe(true);
        expect(contour.pathD.endsWith('Z')).toBe(true);
        expect(contour.pathD).not.toMatch(/NaN|Infinity|undefined/);
        expect(contour.viewBox.width).toBeGreaterThan(0);
        expect(contour.viewBox.height).toBeGreaterThan(0);
        expect(points(contour.pathD).length).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('reports every card rectangle inside the stage', () => {
    const layout = layoutFor(30, 640, { maximalBoxWidth: BOX, selectedIndices: [0, 10] });
    for (const card of layout.cards) {
      expect(card.x).toBeGreaterThanOrEqual(-EPS);
      expect(card.x + card.width).toBeLessThanOrEqual(layout.stageWidth + EPS);
      expect(card.y).toBeGreaterThanOrEqual(-EPS);
      expect(card.y + card.height).toBeLessThanOrEqual(layout.stageHeight + EPS);
    }
    const contour = buildHandContourPath(layout.cards);
    expect(contour.pathD).not.toMatch(/NaN|Infinity|undefined/);
    expect(contour.isNonRectangular).toBe(true);
  });
});
