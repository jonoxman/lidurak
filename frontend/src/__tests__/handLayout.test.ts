import { describe, expect, it } from 'vitest';
import {
  BASELINE_LIFT_PX,
  DEFAULT_MIN_VISIBLE_INDEX_STRIP_PX,
  DRAG_INSERT_GAP_RATIO,
  HAND_DRAG_PARTING_RADIUS,
  ELIGIBLE_LIFT_PX,
  FULL_SELECTED_LIFT_PX,
  HAND_BASE_CARD_HEIGHT,
  HAND_BASE_CARD_WIDTH,
  HAND_CONTOUR_CORNER_RADIUS,
  HAND_CONTOUR_PADDING,
  handContourCornerRadius,
  HAND_HOVER_PARTING_RADIUS,
  HAND_MIN_OVERLAP_RATIO,
  HAND_SMALL_HAND_MAX_CARDS,
  HAND_SMALL_HAND_OVERLAP_RATIO,
  HAND_SMALL_HAND_PARTING_PAD_RATIO,
  SELECTED_LIFT_PX,
  buildHandContourPath,
  cardTranslate3d,
  computeDragPartedCardPositions,
  computeHandLayout,
  computeLocalizedPartingDeltas,
  computePartedCardLayout,
  computePartedCardPositions,
  computeRestingCardPositions,
  getCardVerticalLiftPx,
  resolveDragInsertIndex,
  resolveHoveredCardIndex,
  type CardRect,
  type HandLayoutResult,
} from '../utils/handLayout';

const EPS = 0.02;
const CARD_WIDTH = HAND_BASE_CARD_WIDTH; // 100
const CARD_HEIGHT = HAND_BASE_CARD_HEIGHT; // 140
const BOX = 632; // a 640px hand column minus the 4px contour padding each side
const STRIP = DEFAULT_MIN_VISIBLE_INDEX_STRIP_PX; // 36
const MIN_STEP = CARD_WIDTH * (1 - HAND_MIN_OVERLAP_RATIO); // 80
// ITEM-6b: small hands rest slightly past the minimum overlap.
const SMALL_STEP = CARD_WIDTH * (1 - HAND_SMALL_HAND_OVERLAP_RATIO); // 64
const SMALL_PAD = CARD_WIDTH * HAND_SMALL_HAND_PARTING_PAD_RATIO; // 32
const DEFAULT_SIX_CARD_BOX = CARD_WIDTH + 5 * SMALL_STEP; // 420
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

  it('fills exactly the default six-card box at the small-hand overlap', () => {
    const layout = layoutFor(6);
    expect(layout.defaultSixCardBoxWidth).toBe(DEFAULT_SIX_CARD_BOX);
    expect(layout.totalWidth).toBe(DEFAULT_SIX_CARD_BOX);
    expect(layout.step).toBeCloseTo(SMALL_STEP, 5);
    expect(layout.overlapRatio).toBeCloseTo(HAND_SMALL_HAND_OVERLAP_RATIO, 5);
    expect(layout.cardPositions).toEqual([0, 64, 128, 192, 256, 320]);
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

/**
 * T-96: the hovered card is resolved from the resting row, so the parting
 * transform can never feed back into the hit test and oscillate.
 */
describe('T-96: resting-geometry hover lookup', () => {
  it('maps a left-to-right sweep across the 30-card compressed hand to a monotonic index', () => {
    const layout = layoutFor(30);
    const positions = layout.cardPositions;
    expect(layout.totalWidth).toBeCloseTo(BOX, 5);

    let previous = -1;
    let reversals = 0;
    const seen = new Set<number>();
    for (let x = 0; x <= BOX + CARD_WIDTH; x += 1) {
      const index = resolveHoveredCardIndex(x, positions, CARD_WIDTH, 0);
      if (index === null) continue;
      if (index < previous) reversals += 1;
      expect(index).toBeGreaterThanOrEqual(previous);
      previous = index;
      seen.add(index);
    }

    // Every card is reachable and the sweep never jumps backwards (the visual
    // QA failure was 7 reversals around neighbor index 16).
    expect(reversals).toBe(0);
    expect(seen.size).toBe(30);
  });

  it('picks the top-most overlapping card and honours the hand box offset', () => {
    const positions = layoutFor(14).cardPositions;
    const boxLeft = 240;
    const index = 7;
    const x = boxLeft + positions[index] + 1;
    expect(resolveHoveredCardIndex(x, positions, CARD_WIDTH, boxLeft)).toBe(index);
    // The next card's resting left edge wins immediately, with no dead zone.
    expect(
      resolveHoveredCardIndex(
        boxLeft + positions[index + 1],
        positions,
        CARD_WIDTH,
        boxLeft,
      ),
    ).toBe(index + 1);
  });

  it('returns null outside the resting row instead of inventing a card', () => {
    const positions = layoutFor(6).cardPositions;
    expect(resolveHoveredCardIndex(-1, positions, CARD_WIDTH, 0)).toBeNull();
    expect(resolveHoveredCardIndex(positions[0] - 1, positions, CARD_WIDTH, 0)).toBeNull();
    const pastLast =
      positions[positions.length - 1] + CARD_WIDTH + 1;
    expect(resolveHoveredCardIndex(pastLast, positions, CARD_WIDTH, 0)).toBeNull();
    expect(resolveHoveredCardIndex(Number.NaN, positions, CARD_WIDTH, 0)).toBeNull();
    expect(resolveHoveredCardIndex(0, [], CARD_WIDTH, 0)).toBeNull();
  });
});

/**
 * T-96: hover hit-testing runs against the LIVE parted row, so the strip the
 * player sees under the pointer is the card that opens — with no oscillation on
 * repeated moves.
 */
describe('T-96: live rendered-row hover lookup', () => {
  const BOX_652 = 652;
  const base = computeHandLayout({
    cardCount: 30,
    containerWidth: BOX_652,
    maximalBoxWidth: BOX_652,
  }).cardPositions;
  const parted = (hovered: number) =>
    computePartedCardLayout(base, CARD_WIDTH, BOX_652, hovered).positions;

  it('resolves the exposed strip of the pushed card 16 to card 16, not 17', () => {
    const after15 = parted(15);
    // The regression: card 16 is pushed right past card 17's RESTING slot.
    expect(after15[16]).toBeGreaterThan(base[17]);
    const pointer = after15[16] + 5;
    expect(resolveHoveredCardIndex(pointer, after15, CARD_WIDTH, 0)).toBe(16);
    // The resting lookup this replaced mis-attributed that point to card 17.
    expect(resolveHoveredCardIndex(pointer, base, CARD_WIDTH, 0)).toBe(17);
  });

  it('keeps card 17 selected in the middle of its widened strip without oscillation', () => {
    const after16 = parted(16);
    // Enter card 17 through its live left edge while 16 is hovered...
    expect(resolveHoveredCardIndex(after16[17] + 1, after16, CARD_WIDTH, 0)).toBe(17);

    // ...then its own widened strip is centred past card 18's resting slot.
    const after17 = parted(17);
    const widenedStrip = after17[18] - after17[17];
    const middle = after17[17] + widenedStrip / 2;
    expect(middle).toBeGreaterThan(base[18]);
    expect(resolveHoveredCardIndex(middle, after17, CARD_WIDTH, 0)).toBe(17);
    // The old resting lookup sent the very same point to card 18.
    expect(resolveHoveredCardIndex(middle, base, CARD_WIDTH, 0)).toBe(18);

    // Repeats at the same and neighbouring coordinates never oscillate.
    for (const x of [middle - 0.5, middle, middle + 0.5]) {
      expect(resolveHoveredCardIndex(x, after17, CARD_WIDTH, 0)).toBe(17);
    }
  });

  it('selects the same card before and after each hover transition', () => {
    for (let hovered = 10; hovered <= 20; hovered += 1) {
      const previous = parted(hovered - 1);
      const current = parted(hovered);
      // The point that revealed card `hovered` in the previous layout is still
      // inside that card's pinned strip once the card itself is hovered, so the
      // row cannot flip back and forth at a stationary cursor.
      const entry = previous[hovered] + 1;
      expect(resolveHoveredCardIndex(entry, previous, CARD_WIDTH, 0)).toBe(hovered);
      expect(resolveHoveredCardIndex(entry, current, CARD_WIDTH, 0)).toBe(hovered);
    }
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

  it('parts a two-card hand only to the right of the hovered card', () => {
    const base = layoutFor(2).cardPositions;
    const restingStep = base[1] - base[0];
    const parted = computePartedCardPositions(base, CARD_WIDTH, BOX, 0);
    expect(parted[0]).toBe(base[0]);
    expect(parted[1] - parted[0]).toBeGreaterThan(restingStep);

    // The rightmost card already paints fully on top: nothing may open behind
    // it, or the card beneath would compete for the widest reveal.
    const top = computePartedCardLayout(base, CARD_WIDTH, BOX, 1);
    expect(top.deltas).toEqual([0, 0]);
    expect(top.isParted).toBe(false);
  });
});

describe('T-90-feedback-20261122_193457-2 ITEM-6b: small-hand resting overlap', () => {
  it('rests 2..6 cards slightly past the minimum overlap with the strip visible', () => {
    expect(HAND_SMALL_HAND_MAX_CARDS).toBe(6);
    expect(HAND_SMALL_HAND_OVERLAP_RATIO).toBeGreaterThan(HAND_MIN_OVERLAP_RATIO);
    expect(SMALL_STEP).toBeGreaterThanOrEqual(STRIP);
    expect(SMALL_STEP).toBeLessThan(MIN_STEP);

    for (const cardCount of [2, 3, 4, 5, 6]) {
      const layout = layoutFor(cardCount);
      expect(layout.step).toBeCloseTo(SMALL_STEP, 5);
      expect(layout.cardStep).toBeCloseTo(SMALL_STEP, 5);
      expect(layout.overlap).toBeCloseTo(CARD_WIDTH - SMALL_STEP, 5);
      expect(layout.overlapRatio).toBeCloseTo(HAND_SMALL_HAND_OVERLAP_RATIO, 5);
      // The full-size `"10"` rank and enlarged suit stay uncovered.
      expect(CARD_WIDTH - layout.overlap).toBeGreaterThanOrEqual(STRIP - EPS);
      expect(layout.defaultSixCardBoxWidth).toBeCloseTo(DEFAULT_SIX_CARD_BOX, 5);
      expect(layout.totalWidth).toBeLessThanOrEqual(DEFAULT_SIX_CARD_BOX + EPS);
      for (let index = 1; index < cardCount; index += 1) {
        expect(layout.cardPositions[index] - layout.cardPositions[index - 1]).toBeCloseTo(
          SMALL_STEP,
          5,
        );
      }
      // Centred in the default box, leaving expansion runway on both edges.
      const rowExtent = CARD_WIDTH + (cardCount - 1) * SMALL_STEP;
      expect(layout.cardPositions[0]).toBeCloseTo(
        (layout.totalWidth - rowExtent) / 2,
        5,
      );
    }
  });

  it('centres smaller hands in the default box with the documented runway', () => {
    for (const cardCount of [2, 3, 4, 5]) {
      const layout = layoutFor(cardCount);
      expect(layout.cardPositions[0]).toBeCloseTo(SMALL_PAD, 5);
      expect(layout.totalWidth - (layout.cardPositions[cardCount - 1] + CARD_WIDTH)).toBeCloseTo(
        SMALL_PAD,
        5,
      );
    }
    // Six cards fill the box exactly, so no inset is needed.
    const six = layoutFor(6);
    expect(six.cardPositions[0]).toBe(0);
    expect(six.totalWidth).toBeCloseTo(DEFAULT_SIX_CARD_BOX, 5);
  });

  it('keeps medium and large hands unchanged by the small-hand rule', () => {
    const fourteen = layoutFor(14);
    expect(fourteen.step).toBeCloseTo((BOX - CARD_WIDTH) / 13, 1);
    expect(fourteen.step).toBeGreaterThanOrEqual(STRIP - EPS);
    expect(fourteen.cardPositions[0]).toBe(0);

    const thirty = layoutFor(30);
    expect(thirty.totalWidth).toBeCloseTo(BOX, 5);
    expect(thirty.step).toBeLessThan(STRIP - EPS);
    expect(thirty.cardPositions[0]).toBe(0);
    expect(thirty.isSuperCompressed).toBe(true);
  });

  it('scales the small-hand resting step proportionally on mobile', () => {
    const strip = (STRIP * 48) / 100;
    const layout = computeHandLayout({
      cardCount: 6,
      containerWidth: 292,
      baseCardWidth: 48,
      baseCardHeight: 68,
      minVisibleStripPx: strip,
      maximalBoxWidth: 292,
    });
    expect(layout.cardWidth).toBe(48);
    expect(layout.step).toBeCloseTo(48 * (1 - HAND_SMALL_HAND_OVERLAP_RATIO), 5);
    expect(48 - layout.overlap).toBeGreaterThanOrEqual(strip - EPS);
    expect(layout.totalWidth).toBeLessThanOrEqual(292 + EPS);
  });

  it('compresses a small hand inside a lane narrower than its default box', () => {
    const narrow = layoutFor(6, 300, { maximalBoxWidth: 300 });
    expect(narrow.step).toBeCloseTo((300 - CARD_WIDTH) / 5, 5);
    expect(narrow.step).toBeGreaterThanOrEqual(STRIP - EPS);
    expect(narrow.totalWidth).toBeLessThanOrEqual(300 + EPS);
    expect(
      narrow.cards[narrow.cards.length - 1].x + CARD_WIDTH,
    ).toBeLessThanOrEqual(300 + EPS);
  });
});

describe('T-90-feedback-20261122_193457-2 ITEM-6a/6b: parting math for every hand size', () => {
  it('returns all-zero deltas for a 1-card hand and inactive hovers', () => {
    for (const cardCount of [1, 2, 6, 14, 30]) {
      const base = layoutFor(cardCount).cardPositions;
      for (const hovered of [null, -1, cardCount, 2.5] as const) {
        const layout = computePartedCardLayout(base, CARD_WIDTH, BOX, hovered);
        expect(layout.positions).toBe(base);
        expect(Array.from(layout.deltas)).toEqual(new Array(base.length).fill(0));
        expect(layout.isParted).toBe(false);
        expect(layout.maxAbsDelta).toBe(0);
      }
    }
  });

  it('keeps the hovered card strictly stationary for n = 1, 2, 3, 7, 14, 30', () => {
    for (const cardCount of [1, 2, 3, 7, 14, 30]) {
      const base = layoutFor(cardCount).cardPositions;
      if (cardCount === 1) {
        // ITEM-6a 1-card guard: a lone card can never part.
        const single = computePartedCardLayout(base, CARD_WIDTH, BOX, 0);
        expect(single.hoveredIndex).toBeNull();
        expect(single.positions).toBe(base);
        expect(single.deltas).toEqual([0]);
        expect(single.isParted).toBe(false);
        continue;
      }
      const indices = new Set([0, Math.floor((cardCount - 1) / 2), cardCount - 1]);
      for (const hovered of indices) {
        const layout = computePartedCardLayout(base, CARD_WIDTH, BOX, hovered);
        expect(layout.hoveredIndex).toBe(hovered);
        expect(layout.positions[hovered]).toBe(base[hovered]);
        expect(layout.deltas[hovered]).toBe(0);
        for (let index = 0; index < base.length; index += 1) {
          expect(layout.deltas[index]).toBeCloseTo(
            layout.positions[index] - base[index],
            2,
          );
        }
        expectOrderedPositions(layout.positions);
      }
    }
  });

  it('parts every hover left of the rightmost card in a 2..6-card hand', () => {
    for (const cardCount of [2, 3, 4, 5, 6]) {
      const base = layoutFor(cardCount).cardPositions;
      const restingStep = base[1] - base[0];
      for (let hovered = 0; hovered < cardCount; hovered += 1) {
        const layout = computePartedCardLayout(base, CARD_WIDTH, BOX, hovered);
        expect(layout.positions[hovered]).toBe(base[hovered]);
        if (hovered < cardCount - 1) {
          const rightGap = layout.positions[hovered + 1] - layout.positions[hovered];
          expect(rightGap, `${cardCount}-card hover ${hovered}`).toBeGreaterThan(
            restingStep,
          );
        } else {
          // Rightmost hover: already fully uncovered, so nothing moves.
          expect(layout.deltas.every((delta) => delta === 0)).toBe(true);
        }
        // The left neighbour never opens a competing margin.
        if (hovered > 0) {
          expect(layout.deltas[hovered - 1]).toBe(0);
          expect(layout.positions[hovered] - layout.positions[hovered - 1]).toBeCloseTo(
            restingStep,
            2,
          );
        }
        expectOrderedPositions(layout.positions);
      }
    }
  });

  it('reveals the widest margin only beside the hovered card on a 30-card hand', () => {
    const base = layoutFor(30).cardPositions;
    const restingStep = base[1] - base[0];
    for (const hovered of [0, 15]) {
      const parted = computePartedCardPositions(base, CARD_WIDTH, BOX, hovered);
      const rightGap = parted[hovered + 1] - parted[hovered];
      expect(rightGap).toBeGreaterThan(restingStep);
      // The compressed hand still opens the full index strip in front of it.
      expect(rightGap).toBeGreaterThanOrEqual(STRIP - EPS);
      if (hovered > 0) {
        expect(parted[hovered] - parted[hovered - 1]).toBeCloseTo(restingStep, 2);
      }
      expectOrderedPositions(parted);
    }
    // Near the right end the lane runway bounds the reveal, but it still beats
    // (and is never matched by) the resting margin on the left.
    const nearEnd = computePartedCardLayout(base, CARD_WIDTH, BOX, 28);
    expect(nearEnd.positions[29] - nearEnd.positions[28]).toBeGreaterThan(restingStep);
    expect(nearEnd.deltas[27]).toBe(0);
    expectOrderedPositions(nearEnd.positions);
    // The rightmost card moves nothing at all.
    const rightmost = computePartedCardLayout(base, CARD_WIDTH, BOX, 29);
    expect(rightmost.deltas.every((delta) => delta === 0)).toBe(true);
    expect(rightmost.isParted).toBe(false);
  });

  it('keeps GPU deltas consistent and bounded on 14 and 30-card hands', () => {
    for (const cardCount of [14, 30]) {
      const base = layoutFor(cardCount).cardPositions;
      for (let hovered = 0; hovered < cardCount; hovered += 2) {
        const layout = computePartedCardLayout(base, CARD_WIDTH, BOX, hovered);
        // A hover with a full local right window always parts; the last few
        // hovers are bounded by the lane edge (and the rightmost one cannot
        // move at all, which is exactly the single-card reveal rule).
        if (hovered + HAND_HOVER_PARTING_RADIUS <= cardCount - 2) {
          expect(layout.isParted).toBe(true);
          expect(layout.maxAbsDelta).toBeGreaterThan(0);
        }
        for (let index = 0; index < cardCount; index += 1) {
          expect(layout.positions[index]).toBeGreaterThanOrEqual(-EPS);
          expect(layout.positions[index] + CARD_WIDTH).toBeLessThanOrEqual(BOX + EPS);
          expect(Math.abs(layout.deltas[index])).toBeLessThanOrEqual(CARD_WIDTH);
        }
      }
    }
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

  it('opens only the right neighbour gap and leaves every other card at rest', () => {
    const hovered = 7;
    const parted = computePartedCardPositions(base, CARD_WIDTH, BOX, hovered);
    const layout = computePartedCardLayout(base, CARD_WIDTH, BOX, hovered);

    const nearLeftGap = parted[hovered] - parted[hovered - 1];
    const nearRightGap = parted[hovered + 1] - parted[hovered];

    // T-90 Hover Parting: only the right side opens, so the card under the
    // cursor is the single card with the widest exposed margin.
    expect(nearLeftGap).toBeCloseTo(baseStep, 2);
    expect(layout.deltas[hovered - 1]).toBe(0);
    expect(nearRightGap).toBeGreaterThan(baseStep);
    // T-90-feedback-20261123_020207-2 ITEM-QA6: the row no longer re-spreads —
    // only the tight window around the cursor moves.
    for (let index = 0; index < base.length; index += 1) {
      if (Math.abs(index - hovered) <= HAND_HOVER_PARTING_RADIUS) continue;
      expect(layout.deltas[index], `card ${index}`).toBe(0);
      expect(parted[index]).toBe(base[index]);
    }
    expect(parted[1] - parted[0]).toBeCloseTo(baseStep, 2);
    expect(parted[13] - parted[12]).toBeCloseTo(baseStep, 2);
  });

  it('keeps strict left-to-right order and stays inside the box', () => {
    for (let hovered = 0; hovered < base.length; hovered += 1) {
      const parted = computePartedCardPositions(base, CARD_WIDTH, BOX, hovered);
      expectOrderedPositions(parted);
    }
  });

  it('widenes the closest neighbour substantially on a tight hand', () => {
    const tight = layoutFor(46).cardPositions;
    const restingGap = tight[24] - tight[23];
    const parted = computePartedCardPositions(tight, CARD_WIDTH, BOX, 23);
    const nearGap = parted[24] - parted[23];
    expect(nearGap).toBeGreaterThan(restingGap);
    // Only 4 base gaps of a 46-card hand fit the local window, so the flare is
    // bounded by that span instead of re-spreading the whole row.
    expect(nearGap).toBeGreaterThan(restingGap * 2);
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

describe('T-90-feedback-20261123_020207-2 ITEM-QA6: strictly localized parting', () => {
  it('never moves a card outside the tight local window on a 30-card hand', () => {
    const base = layoutFor(30).cardPositions;
    expect(HAND_HOVER_PARTING_RADIUS).toBe(3);

    for (const hovered of [0, 1, 5, 15, 24, 29]) {
      const layout = computePartedCardLayout(base, CARD_WIDTH, BOX, hovered);
      expect(layout.deltas[hovered]).toBe(0);
      expect(layout.positions[hovered]).toBe(base[hovered]);
      for (let index = 0; index < base.length; index += 1) {
        if (Math.abs(index - hovered) <= HAND_HOVER_PARTING_RADIUS) continue;
        expect(layout.deltas[index], `card ${index} hover ${hovered}`).toBe(0);
        expect(layout.positions[index], `card ${index} hover ${hovered}`).toBe(
          base[index],
        );
      }
      // Every card with local room on the right side parts rightward; the
      // left neighbour and every distant card stay exactly at rest. (At index
      // 0/1/28/29 one side has no lane runway left, so only the side with room
      // can flare; at 29 nothing moves at all.)
      const parted = [hovered + 1]
        .filter((neighbour) => neighbour <= base.length - 2)
        .map((neighbour) => layout.deltas[neighbour]);
      if (parted.length > 0) {
        expect(Math.max(...parted)).toBeGreaterThan(0);
      }
      if (hovered > 1 && hovered < base.length - 2) {
        expect(layout.deltas[hovered - 1]).toBe(0);
        expect(layout.deltas[hovered + 1]).toBeGreaterThan(0);
      }
      expectOrderedPositions(layout.positions);
    }
  });

  it('leaves indices 0..10 and 20..29 untouched while hovering index 15', () => {
    const base = layoutFor(30).cardPositions;
    const layout = computePartedCardLayout(base, CARD_WIDTH, BOX, 15);

    for (let index = 0; index <= 10; index += 1) {
      expect(layout.deltas[index], `card ${index}`).toBe(0);
    }
    for (let index = 20; index < 30; index += 1) {
      expect(layout.deltas[index], `card ${index}`).toBe(0);
    }
    // The hovered card's own right strip opens despite the 30-card squeeze
    // while its left neighbour keeps the resting overlap.
    expect(layout.positions[16] - layout.positions[15]).toBeGreaterThanOrEqual(STRIP - EPS);
    expect(layout.positions[15] - layout.positions[14]).toBeCloseTo(
      base[15] - base[14],
      2,
    );
    expect(layout.deltas[14]).toBe(0);
    expectOrderedPositions(layout.positions);
  });

  it('locally parts a 6-card hand and never shifts a 1-card hand', () => {
    const six = layoutFor(6).cardPositions;
    const restingStep = six[1] - six[0];

    for (const hovered of [0, 2, 4]) {
      const layout = computePartedCardLayout(six, CARD_WIDTH, BOX, hovered);
      expect(layout.isParted).toBe(true);
      expect(layout.positions[hovered]).toBe(six[hovered]);
      // Only the right neighbour parts; the left one keeps its resting overlap.
      expect(layout.deltas[hovered + 1]).toBeGreaterThan(0);
      const gap = layout.positions[hovered + 1] - layout.positions[hovered];
      expect(gap).toBeGreaterThan(restingStep);
      if (hovered > 0) {
        expect(layout.deltas[hovered - 1]).toBe(0);
        expect(layout.positions[hovered] - layout.positions[hovered - 1]).toBeCloseTo(
          restingStep,
          2,
        );
      }
      expectOrderedPositions(layout.positions);
    }

    // The rightmost card is already fully uncovered: hovering it moves nothing.
    const last = computePartedCardLayout(six, CARD_WIDTH, BOX, 5);
    expect(last.deltas.every((delta) => delta === 0)).toBe(true);
    expect(last.isParted).toBe(false);

    const one = layoutFor(1).cardPositions;
    const single = computePartedCardLayout(one, CARD_WIDTH, BOX, 0);
    expect(single.deltas).toEqual([0]);
    expect(single.maxAbsDelta).toBe(0);
    expect(single.isParted).toBe(false);
    expect(single.positions[0]).toBe(one[0]);
    expect(computePartedCardPositions(one, CARD_WIDTH, BOX, 0)).toBe(one);
  });

  it('exposes the shared resting + translate3d primitives for Wave 2 drag parting', () => {
    const resting = computeRestingCardPositions({
      cardCount: 30,
      containerWidth: 640,
      maximalBoxWidth: BOX,
    });
    expect(resting).toEqual(layoutFor(30).cardPositions);

    const deltas = computeLocalizedPartingDeltas(resting, CARD_WIDTH, BOX, 15);
    expect(deltas[15]).toBe(0);
    expect(deltas[0]).toBe(0);
    expect(deltas[29]).toBe(0);

    expect(cardTranslate3d(12.345, -9)).toBe('translate3d(12.35px, -9px, 0)');
    expect(cardTranslate3d(0, 0)).toBe('translate3d(0px, 0px, 0)');
  });
});

describe('T-90 Hover Parting: unambiguous single-card reveal', () => {
  /** `x(j + 1) - x(j)`: the margin card `j` leaves uncovered. */
  const exposedMargin = (positions: readonly number[], index: number): number =>
    positions[index + 1] - positions[index];

  it('opens exactly the hovered card with the widest margin on a 30-card hand', () => {
    const base = layoutFor(30).cardPositions;
    for (let hovered = 0; hovered < base.length; hovered += 1) {
      const layout = computePartedCardLayout(base, CARD_WIDTH, BOX, hovered);
      // A wall card exists only when the local right window does not run off
      // the end of the hand; the last few hovers are lane-bounded.
      const hasWall = hovered + HAND_HOVER_PARTING_RADIUS <= base.length - 2;
      expect(layout.deltas[hovered], `hovered ${hovered}`).toBe(0);
      // Nothing to the left of the cursor ever moves.
      for (let index = 0; index <= hovered; index += 1) {
        expect(layout.deltas[index], `left card ${index} hover ${hovered}`).toBe(0);
        expect(layout.positions[index]).toBe(base[index]);
      }
      // Only the local right neighbourhood moves, and always rightward.
      for (let index = hovered + 1; index < base.length; index += 1) {
        if (index <= hovered + HAND_HOVER_PARTING_RADIUS) {
          if (hasWall) {
            expect(layout.deltas[index], `right card ${index} hover ${hovered}`).toBeGreaterThan(0);
          } else {
            expect(layout.deltas[index]).toBeGreaterThanOrEqual(0);
          }
        } else {
          expect(layout.deltas[index], `distant card ${index} hover ${hovered}`).toBe(0);
          expect(layout.positions[index]).toBe(base[index]);
        }
      }
      // No inversion and never out of the lane.
      expectOrderedPositions(layout.positions);

      if (!hasWall) {
        // Near the right end the lane runway bounds the reveal; the rightmost
        // card (already fully uncovered) moves nothing at all.
        if (hovered === base.length - 1) expect(layout.isParted).toBe(false);
        continue;
      }
      const ownMargin = exposedMargin(layout.positions, hovered);
      for (let index = 0; index < base.length - 1; index += 1) {
        if (index === hovered) continue;
        expect(ownMargin, `margin ${hovered} vs ${index} (hover ${hovered})`).toBeGreaterThan(
          exposedMargin(layout.positions, index),
        );
      }
    }
  });

  it('keeps the single-card reveal rule for every hand size and every hover', () => {
    for (const cardCount of [2, 3, 6, 7, 14, 30, 46, 52]) {
      for (const containerWidth of [640, 375]) {
        const base = layoutFor(cardCount, containerWidth).cardPositions;
        const box = layoutFor(cardCount, containerWidth).maximalBoxWidth;
        for (let hovered = 0; hovered < cardCount; hovered += 1) {
          const layout = computePartedCardLayout(base, CARD_WIDTH, box, hovered);
          const hasWall = hovered + HAND_HOVER_PARTING_RADIUS <= cardCount - 2;
          expect(layout.deltas[hovered]).toBe(0);
          for (let index = 0; index <= hovered; index += 1) {
            expect(layout.deltas[index], `n=${cardCount} w=${containerWidth} h=${hovered}`).toBe(0);
          }
          for (let index = 0; index < cardCount; index += 1) {
            if (index > hovered && index <= hovered + HAND_HOVER_PARTING_RADIUS) {
              expect(layout.deltas[index]).toBeGreaterThanOrEqual(0);
            } else if (index > hovered) {
              expect(layout.deltas[index]).toBe(0);
            }
          }
          for (let index = 1; index < cardCount; index += 1) {
            expect(layout.positions[index]).toBeGreaterThan(layout.positions[index - 1]);
          }
          if (!hasWall) continue;
          const ownMargin = exposedMargin(layout.positions, hovered);
          for (let index = 0; index < cardCount - 1; index += 1) {
            if (index === hovered) continue;
            expect(
              ownMargin,
              `n=${cardCount} w=${containerWidth} hover ${hovered} vs ${index}`,
            ).toBeGreaterThan(exposedMargin(layout.positions, index));
          }
        }
      }
    }
  });

  it('leaves a 1-card hand and an inactive hover completely stationary', () => {
    const one = layoutFor(1).cardPositions;
    expect(computePartedCardPositions(one, CARD_WIDTH, BOX, 0)).toBe(one);
    const thirty = layoutFor(30).cardPositions;
    expect(computePartedCardPositions(thirty, CARD_WIDTH, BOX, null)).toBe(thirty);
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

describe('T-90-feedback-20261123_130625-2 ITEM-2: Roundness-bound contour radius', () => {
  it('maps 0 to a sharp contour and the default/max settings to 12/24px', () => {
    expect(handContourCornerRadius(0)).toBe(0);
    expect(handContourCornerRadius(8)).toBe(HAND_CONTOUR_CORNER_RADIUS);
    expect(handContourCornerRadius(16)).toBe(24);
    expect(handContourCornerRadius(Number.NaN)).toBe(HAND_CONTOUR_CORNER_RADIUS);
  });

  it('traces the requested radius into the path arcs', () => {
    const card: CardRect = { x: 0, y: 0, width: CARD_WIDTH, height: CARD_HEIGHT };
    const sharp = buildHandContourPath([card], { cornerRadius: handContourCornerRadius(0) });
    expect(sharp.pathD).not.toMatch(/A [\d.]/);
    const rounded = buildHandContourPath([card], {
      cornerRadius: handContourCornerRadius(16),
    });
    expect(rounded.pathD).toMatch(/A 24 24 /);
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
    // The contour hugs the cards, so it ignores the small-hand runway and
    // spans from the first card's left edge to the last card's right edge.
    expect(contour.viewBox.width).toBeCloseTo(
      layout.cardPositions[4] + layout.cardWidth - layout.cardPositions[0],
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

describe('T-90-feedback-20261123_020207-4 ITEM-NEW2: in-hand drag reorder parting', () => {
  const dragRow = (cardCount: number, dragInsertIndex: number | null) =>
    computeDragPartedCardPositions({
      cardCount,
      containerWidth: 640,
      dragSourceIndex: 0,
      dragInsertIndex,
      maximalBoxWidth: BOX,
    });

  const gapAt = (positions: readonly number[], insert: number): number =>
    insert === 0
      ? positions[0]
      : insert === positions.length
        ? BOX - CARD_WIDTH - positions[positions.length - 1]
        : positions[insert] - positions[insert - 1];

  it('opens an unmistakable full-card gap at the left edge, the middle and the right edge', () => {
    const remainingCount = 8; // a 9-card hand
    for (const insert of [0, 3, remainingCount]) {
      const layout = dragRow(remainingCount + 1, insert);
      expect(layout.positions).toHaveLength(remainingCount);
      expect(layout.deltas.some((delta) => delta !== 0)).toBe(true);
      // A whole card fits into the parted slot (a hand already resting at a
      // wider stride keeps its own, larger gap).
      expect(layout.gapPx).toBeGreaterThanOrEqual(CARD_WIDTH - EPS);
      expect(gapAt(layout.positions, insert)).toBeGreaterThanOrEqual(CARD_WIDTH - EPS);
      // Strictly ordered and always inside the maximal hand lane.
      expectOrderedPositions(layout.positions);
    }
  });

  it('keeps every distant card of a 30-card hand exactly anchored', () => {
    const layout = dragRow(30, 15);
    expect(layout.positions).toHaveLength(29);
    expect(layout.gapPx).toBeGreaterThanOrEqual(CARD_WIDTH - EPS);
    expectOrderedPositions(layout.positions);

    const moved = layout.deltas
      .map((delta, index) => (delta !== 0 ? index : -1))
      .filter((index) => index >= 0);
    expect(moved.length).toBeGreaterThan(0);
    // Only the local window either side of the insertion slot moves at all.
    for (const index of moved) {
      expect(Math.abs(index - 15)).toBeLessThanOrEqual(HAND_DRAG_PARTING_RADIUS);
    }
    for (const index of [0, 3, 10, 20, 25, 28]) {
      expect(layout.deltas[index]).toBe(0);
      expect(layout.positions[index]).toBe(layout.restingPositions[index]);
    }
  });

  it('resolves a monotonic insertion slot from the pointer and closes outside the lane', () => {
    const options = {
      cardCount: 6,
      containerWidth: 640,
      dragSourceIndex: 2,
      maximalBoxWidth: BOX,
    };
    expect(resolveDragInsertIndex({ ...options, pointerX: 0 })).toBe(0);
    expect(resolveDragInsertIndex({ ...options, pointerX: 100 })).toBe(1);
    expect(resolveDragInsertIndex({ ...options, pointerX: 250 })).toBe(3);
    expect(
      resolveDragInsertIndex({ ...options, pointerX: 10_000, tolerancePx: 40 }),
    ).toBeNull();
    expect(
      resolveDragInsertIndex({ ...options, pointerX: -200, tolerancePx: 20 }),
    ).toBeNull();
    // The empty runway right of the row still targets the rightmost slot.
    expect(
      resolveDragInsertIndex({ ...options, pointerX: BOX - CARD_WIDTH / 2 }),
    ).toBe(options.cardCount - 1);

    let previous = -1;
    for (let pointerX = 0; pointerX <= BOX; pointerX += 5) {
      const index = resolveDragInsertIndex({ ...options, pointerX });
      expect(index).not.toBeNull();
      expect(index as number).toBeGreaterThanOrEqual(previous);
      previous = index as number;
    }
    // A one-card hand has no reorder slot at all.
    expect(
      resolveDragInsertIndex({ ...options, cardCount: 1, pointerX: 100 }),
    ).toBeNull();
  });

  it('T-96: resolves small-hand midpoints to the lower slot and parts there', () => {
    const options = {
      cardCount: 6,
      containerWidth: 640,
      dragSourceIndex: 0,
      maximalBoxWidth: BOX,
    };
    // Removing the dragged card drops the hand to five cards, which the
    // small-hand runway re-centres by 32px: [0, 64, ...] -> [32, 96, ...].
    expect(dragRow(6, null).restingPositions).toEqual([32, 96, 160, 224, 288]);

    // `146` is the midpoint between the ORIGINAL card 1 (centre 114) and card 2
    // (centre 178) — and exactly the re-centred 10♣ centre. `274` is the same
    // for cards 3 (242) and 4 (306). Both must resolve to the LOWER slot.
    expect(resolveDragInsertIndex({ ...options, pointerX: 146 })).toBe(1);
    expect(resolveDragInsertIndex({ ...options, pointerX: 274 })).toBe(3);
    // Past those centres the slot advances by exactly one (no jump of two).
    expect(resolveDragInsertIndex({ ...options, pointerX: 146.01 })).toBe(2);
    expect(resolveDragInsertIndex({ ...options, pointerX: 274.01 })).toBe(4);

    // The parted row opens a whole-card gap at the resolved slot, ordered and
    // inside the lane, so the dragged card lands without overlapping a card.
    const parted = computeDragPartedCardPositions({ ...options, dragInsertIndex: 1 });
    expect(parted.insertIndex).toBe(1);
    expect(parted.gapPx).toBeGreaterThanOrEqual(CARD_WIDTH - EPS);
    expect(gapAt(parted.positions, 1)).toBeGreaterThanOrEqual(CARD_WIDTH - EPS);
    expectOrderedPositions(parted.positions);
  });

  it('closes the gap when no slot is active and never breaks tiny hands', () => {
    const closed = dragRow(6, null);
    expect(closed.deltas.every((delta) => delta === 0)).toBe(true);
    expect(closed.positions).toEqual(closed.restingPositions);
    expect(closed.isParted).toBe(false);
    expect(closed.insertIndex).toBeNull();

    const two = dragRow(2, 0);
    expect(two.positions).toHaveLength(1);
    expect(two.gapPx).toBeGreaterThanOrEqual(CARD_WIDTH - EPS);

    const one = dragRow(1, 0);
    expect(one.positions).toHaveLength(0);
    expect(one.insertIndex).toBeNull();
  });

  it('documents the full-card target and the local parting window', () => {
    expect(DRAG_INSERT_GAP_RATIO).toBe(1);
    expect(HAND_DRAG_PARTING_RADIUS).toBe(3);
  });
});
