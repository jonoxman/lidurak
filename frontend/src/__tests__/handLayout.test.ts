import { describe, expect, it } from 'vitest';
import {
  HAND_BASE_CARD_HEIGHT,
  HAND_BASE_CARD_WIDTH,
  HAND_CONTOUR_CORNER_RADIUS,
  HAND_CONTOUR_PADDING,
  buildHandContourPath,
  computeHandLayout,
  type CardRect,
  type HandLayoutResult,
} from '../utils/handLayout';

const EPS = 0.02;

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

const points = (pathD: string) =>
  segments(pathD).filter((segment) => segment.command !== 'Z');

/** Cards grouped per wrapped row, in left-to-right order. */
function rowsOf(layout: HandLayoutResult): HandLayoutResult['cards'][] {
  const rows: HandLayoutResult['cards'][] = [];
  for (const card of layout.cards) {
    (rows[card.row] ??= []).push(card);
  }
  return rows;
}

function expectInsideStage(layout: HandLayoutResult) {
  expect(layout.stageWidth).toBeLessThanOrEqual(layout.availableWidth + EPS);
  for (const card of layout.cards) {
    expect(Number.isFinite(card.x)).toBe(true);
    expect(Number.isFinite(card.y)).toBe(true);
    expect(card.x).toBeGreaterThanOrEqual(-EPS);
    expect(card.y).toBeGreaterThanOrEqual(-EPS);
    expect(card.x + card.width).toBeLessThanOrEqual(layout.stageWidth + EPS);
    expect(card.y + card.height).toBeLessThanOrEqual(layout.stageHeight + EPS);
  }
}

describe('T-90-feedback-20261122_011021-2 ITEM-5: 20%-80% hand overlap layout', () => {
  it('centres a single card with no overlap', () => {
    const layout = computeHandLayout({ cardCount: 1, containerWidth: 640 });

    expect(layout.cards).toHaveLength(1);
    expect(layout.rows).toBe(1);
    expect(layout.overlap).toBe(0);
    expect(layout.overlapRatio).toBe(0);
    expect(layout.step).toBe(HAND_BASE_CARD_WIDTH);
    expect(layout.stageWidth).toBe(HAND_BASE_CARD_WIDTH);
    expect(layout.stageHeight).toBe(18 + HAND_BASE_CARD_HEIGHT); // reserved lift
    expect(layout.offsetX).toBe((640 - HAND_BASE_CARD_WIDTH) / 2);
    expectInsideStage(layout);
  });

  it('returns an empty layout for an empty hand', () => {
    const layout = computeHandLayout({ cardCount: 0, containerWidth: 640 });
    expect(layout.cards).toHaveLength(0);
    expect(layout.rows).toBe(0);
    expect(layout.stageWidth).toBe(0);
    expect(layout.stageHeight).toBe(0);
  });

  it('clamps the stride so cards overlap by 20% at minimum', () => {
    // A very wide column lets the stride reach its 80%-of-width ceiling, i.e.
    // the loosest allowed 20% overlap.
    const layout = computeHandLayout({ cardCount: 4, containerWidth: 2000 });
    expect(layout.step).toBeCloseTo(HAND_BASE_CARD_WIDTH * 0.8, 5);
    expect(layout.overlapRatio).toBeCloseTo(0.2, 5);
    expect(layout.stageWidth).toBeCloseTo(100 + 3 * 80, 5);
    expectInsideStage(layout);
  });

  it('clamps the stride so cards overlap by 80% at maximum', () => {
    const layout = computeHandLayout({ cardCount: 24, containerWidth: 320 });

    // Two rows of twelve at the tightest readable stride: 80% covered, and the
    // left 20% (rank + suit) of every card stays uncovered.
    expect(layout.rows).toBe(2);
    expect(layout.rowCounts).toEqual([12, 12]);
    expect(layout.overlapRatio).toBeCloseTo(0.8, 5);
    expect(layout.step).toBeCloseTo(HAND_BASE_CARD_WIDTH * 0.2, 5);
    expect(layout.stageWidth).toBeCloseTo(320, 5);
    expectInsideStage(layout);

    for (const row of rowsOf(layout)) {
      for (let index = 1; index < row.length; index += 1) {
        const stride = row[index].x - row[index - 1].x;
        expect(stride).toBeGreaterThanOrEqual(layout.cardWidth * 0.2 - EPS);
        expect(stride).toBeLessThanOrEqual(layout.cardWidth * 0.8 + EPS);
      }
    }
  });

  it('keeps every consecutive pair covered between 20% and 80%, always', () => {
    for (const [baseCardWidth, baseCardHeight] of [
      [HAND_BASE_CARD_WIDTH, HAND_BASE_CARD_HEIGHT],
      [48, 68],
    ]) {
      for (const containerWidth of [180, 240, 300, 420, 640, 900, 1280]) {
        for (const cardCount of [1, 2, 3, 5, 8, 12, 18, 24, 30, 36, 44, 52]) {
          const layout = computeHandLayout({
            cardCount,
            containerWidth,
            baseCardWidth,
            baseCardHeight,
            liftPx: 18,
          });
          expectInsideStage(layout);
          expect(layout.rows).toBeLessThanOrEqual(2);
          for (const row of rowsOf(layout)) {
            for (let index = 1; index < row.length; index += 1) {
              const stride = row[index].x - row[index - 1].x;
              expect(stride).toBeGreaterThanOrEqual(layout.cardWidth * 0.2 - EPS);
              expect(stride).toBeLessThanOrEqual(layout.cardWidth * 0.8 + EPS);
            }
          }
          for (const card of layout.cards) {
            expect(Number.isFinite(card.width)).toBe(true);
            expect(card.width).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('wraps a picked-up full deck into two rows instead of running off-screen', () => {
    const desktop = computeHandLayout({ cardCount: 52, containerWidth: 640 });
    expect(desktop.rows).toBe(2);
    expect(desktop.stageWidth).toBeLessThanOrEqual(640 + EPS);
    expect(desktop.scale).toBe(1); // two rows already fit at 100px cards
    expectInsideStage(desktop);

    // A narrow phone column cannot hold 36 desktop cards even in two rows, so
    // the cards scale down while keeping the 20% visible left strip.
    const narrow = computeHandLayout({ cardCount: 36, containerWidth: 300 });
    expect(narrow.rows).toBe(2);
    expect(narrow.scale).toBeLessThan(1);
    expect(narrow.cardWidth).toBeLessThan(HAND_BASE_CARD_WIDTH);
    expect(narrow.cardWidth / narrow.cardHeight).toBeCloseTo(
      HAND_BASE_CARD_WIDTH / HAND_BASE_CARD_HEIGHT,
      3,
    );
    expect(narrow.step).toBeGreaterThanOrEqual(narrow.cardWidth * 0.2 - EPS);
    expectInsideStage(narrow);

    // Mobile cards (48x68) never overflow a 300px column either.
    const mobile = computeHandLayout({
      cardCount: 52,
      containerWidth: 300,
      baseCardWidth: 48,
      baseCardHeight: 68,
    });
    expect(mobile.rows).toBe(2);
    expect(mobile.stageWidth).toBeLessThanOrEqual(300 + EPS);
    expectInsideStage(mobile);
  });

  it('lifts playable and selected cards independently of the baseline', () => {
    const layout = computeHandLayout({
      cardCount: 4,
      containerWidth: 640,
      liftedIndices: new Set([1]),
      liftPx: 18,
      selectedIndices: [2],
      selectedLiftPx: 26,
    });

    expect(layout.maxLift).toBe(26);
    expect(layout.cards[0].y).toBe(26);
    expect(layout.cards[1].y).toBe(26 - 18);
    expect(layout.cards[1].liftLevel).toBe('playable');
    expect(layout.cards[1].lift).toBe(18);
    expect(layout.cards[2].y).toBe(0);
    expect(layout.cards[2].liftLevel).toBe('selected');
    expect(layout.cards[2].lift).toBe(26);
    expect(layout.cards[3].liftLevel).toBe('none');
    expect(layout.stageHeight).toBe(26 + HAND_BASE_CARD_HEIGHT);
    expectInsideStage(layout);
  });

  it('honours a horizontal inset and never reports a stage wider than it', () => {
    const layout = computeHandLayout({
      cardCount: 10,
      containerWidth: 400,
      horizontalPadding: 40,
    });
    expect(layout.availableWidth).toBe(360);
    expect(layout.stageWidth).toBeLessThanOrEqual(360 + EPS);
  });

  it('reports the stride and overlap of the single-row case', () => {
    const layout = computeHandLayout({ cardCount: 5, containerWidth: 500 });
    expect(layout.cardWidth - layout.step).toBeCloseTo(layout.overlap, 5);
    expect(layout.overlap / layout.cardWidth).toBeCloseTo(layout.overlapRatio, 5);
  });
});

describe('T-90-feedback-20261122_011021-2 ITEM-3: tight non-rectangular hand contour', () => {
  it('returns an empty path for an empty hand', () => {
    const contour = buildHandContourPath([]);
    expect(contour.pathD).toBe('');
    expect(contour.viewBox).toEqual({ width: 0, height: 0 });
    expect(contour.isNonRectangular).toBe(false);
  });

  it('wraps a single card tightly, with padding and a clean viewBox', () => {
    const card: CardRect = { x: 10, y: 20, width: 100, height: 140 };
    const contour = buildHandContourPath([card], { padding: 6, cornerRadius: 0 });

    expect(contour.left).toBe(4);
    expect(contour.top).toBe(14);
    expect(contour.viewBox).toEqual({ width: 112, height: 152 });
    expect(contour.isNonRectangular).toBe(false);
    expect(contour.pathD.startsWith('M 0 0')).toBe(true);
    expect(contour.pathD.endsWith('Z')).toBe(true);
    const corners = points(contour.pathD);
    expect(corners).toHaveLength(4);
    expect(corners.map((point) => [point.x, point.y])).toEqual([
      [0, 0],
      [112, 0],
      [112, 152],
      [0, 152],
    ]);
  });

  it('keeps a uniform hand rectangular: one union rectangle', () => {
    const layout = computeHandLayout({ cardCount: 3, containerWidth: 640 });
    const contour = buildHandContourPath(layout.cards, { padding: 0, cornerRadius: 0 });

    expect(contour.isNonRectangular).toBe(false);
    // Only the four outer corners survive the union.
    expect(points(contour.pathD)).toHaveLength(4);
    expect(contour.viewBox.width).toBeCloseTo(
      layout.cards[2].x + layout.cardWidth,
      5,
    );
    expect(contour.viewBox.height).toBeCloseTo(layout.cardHeight, 5);
  });

  it('steps up over a raised card and back down after it', () => {
    const rects: CardRect[] = [
      { x: 0, y: 18, width: 100, height: 140 },
      { x: 60, y: 0, width: 100, height: 140 },
      { x: 120, y: 18, width: 100, height: 140 },
    ];
    const contour = buildHandContourPath(rects, { padding: 0, cornerRadius: 0 });

    expect(contour.isNonRectangular).toBe(true);
    // The union starts at y = 0 (the raised card) and ends at y = 158.
    expect(contour.viewBox).toEqual({ width: 220, height: 158 });

    const corners = points(contour.pathD);
    // Up at the raised card's left edge (x = 60), down at its right edge (160).
    expect(corners.some((p) => p.x === 60 && p.y === 0)).toBe(true);
    expect(corners.some((p) => p.x === 60 && p.y === 18)).toBe(true);
    expect(corners.some((p) => p.x === 160 && p.y === 0)).toBe(true);
    expect(corners.some((p) => p.x === 160 && p.y === 18)).toBe(true);

    // The bottom edge tracks each card: it stays on the baseline (158) wherever
    // an unlifted card is the lowest one, and steps up to the raised card's own
    // bottom (140) only over the gap between its neighbours.
    const bottomPoints = corners.filter((p) => p.y > 100);
    expect(new Set(bottomPoints.map((p) => p.y))).toEqual(new Set([140, 158]));
    expect(bottomPoints.filter((p) => p.x <= 60).every((p) => p.y === 158)).toBe(true);
    expect(bottomPoints.some((p) => p.x === 100 && p.y === 140)).toBe(true);
    expect(bottomPoints.some((p) => p.x === 120 && p.y === 158)).toBe(true);
  });

  it('traces a non-rectangular bottom when raised cards clear the baseline', () => {
    const rects: CardRect[] = [
      { x: 0, y: 0, width: 100, height: 140 },
      { x: 60, y: 0, width: 100, height: 140 },
      { x: 120, y: 18, width: 100, height: 100 },
    ];
    const contour = buildHandContourPath(rects, { padding: 0, cornerRadius: 0 });
    expect(contour.isNonRectangular).toBe(true);
    const bottomYs = new Set(points(contour.pathD).filter((p) => p.y > 100).map((p) => p.y));
    expect(bottomYs).toEqual(new Set([140, 118]));
  });

  it('treats a contiguous raised run as one step', () => {
    const rects: CardRect[] = [
      { x: 0, y: 0, width: 100, height: 140 },
      { x: 60, y: 0, width: 100, height: 140 },
      { x: 120, y: 18, width: 100, height: 140 },
    ];
    const contour = buildHandContourPath(rects, { padding: 0, cornerRadius: 0 });
    const raised = points(contour.pathD).filter((p) => p.y === 0);
    // Two contiguous raised cards form one flat top from x = 0 to x = 160, so
    // there is exactly one step down, at the end of the run.
    expect(raised.map((p) => p.x)).toEqual([0, 160]);
    expect(contour.isNonRectangular).toBe(true);
  });

  it('reports a uniform contour when every card is raised', () => {
    const layout = computeHandLayout({
      cardCount: 5,
      containerWidth: 640,
      liftedIndices: new Set([0, 1, 2, 3, 4]),
    });
    const contour = buildHandContourPath(layout.cards, { padding: 0, cornerRadius: 0 });
    expect(contour.isNonRectangular).toBe(false);
    expect(points(contour.pathD)).toHaveLength(4);
  });

  it('rounds the outer and inner corners with quarter arcs, clamping short steps', () => {
    const layout = computeHandLayout({
      cardCount: 5,
      containerWidth: 640,
      liftedIndices: new Set([1, 3]),
    });
    const contour = buildHandContourPath(layout.cards);
    // Default padding/radius are the ticket's values.
    expect(contour.viewBox.width).toBeCloseTo(
      layout.stageWidth + HAND_CONTOUR_PADDING * 2,
      5,
    );
    expect(contour.pathD).toContain(' A ');
    const arcs = Array.from(
      contour.pathD.matchAll(/A ([\d.]+) ([\d.]+) 0 0 [01] [-\d.]+ [-\d.]+/g),
    );
    expect(arcs.length).toBeGreaterThan(0);
    for (const arc of arcs) {
      expect(Number(arc[1])).toBeLessThanOrEqual(HAND_CONTOUR_CORNER_RADIUS + EPS);
      expect(Number(arc[1])).toBe(Number(arc[2]));
    }

    // Short skyline steps clamp the radius instead of self-intersecting.
    const tiny = buildHandContourPath(
      [
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 5, y: -4, width: 10, height: 10 },
      ],
      { padding: 0, cornerRadius: 12 },
    );
    for (const arc of Array.from(
      tiny.pathD.matchAll(/A ([\d.]+) ([\d.]+) 0 0 [01] [-\d.]+ [-\d.]+/g),
    )) {
      expect(Number(arc[1])).toBeLessThanOrEqual(5 + EPS);
    }
  });

  it('wraps a two-row 52-card hand without NaN or out-of-box points', () => {
    const layout = computeHandLayout({ cardCount: 52, containerWidth: 300 });
    expect(layout.rows).toBe(2);
    const contour = buildHandContourPath(layout.cards, {
      padding: HAND_CONTOUR_PADDING,
      cornerRadius: 8,
    });

    expect(contour.isNonRectangular).toBe(true);
    expect(Number.isFinite(contour.viewBox.width)).toBe(true);
    expect(Number.isFinite(contour.viewBox.height)).toBe(true);
    for (const point of points(contour.pathD)) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
      expect(point.x).toBeGreaterThanOrEqual(-EPS);
      expect(point.y).toBeGreaterThanOrEqual(-EPS);
      expect(point.x).toBeLessThanOrEqual(contour.viewBox.width + EPS);
      expect(point.y).toBeLessThanOrEqual(contour.viewBox.height + EPS);
    }
    // The contour hugs both rows of cards. It does not include the empty lift
    // band reserved above the top row, so it spans stageHeight minus that band.
    expect(contour.viewBox.height).toBeCloseTo(
      layout.stageHeight - layout.maxLift + HAND_CONTOUR_PADDING * 2,
      5,
    );
  });

  it('never emits malformed path data for any lift pattern', () => {
    const patterns = [
      new Set<number>(),
      new Set([0]),
      new Set([2]),
      new Set([0, 2, 4]),
      new Set([1, 2, 3]),
      new Set([0, 1, 2, 3, 4]),
    ];
    for (const liftedIndices of patterns) {
      for (const containerWidth of [220, 320, 640]) {
        const layout = computeHandLayout({
          cardCount: 5,
          containerWidth,
          liftedIndices,
        });
        for (const cornerRadius of [0, 6, 12]) {
          const contour = buildHandContourPath(layout.cards, {
            padding: 4,
            cornerRadius,
          });
          expect(contour.pathD.startsWith('M ')).toBe(true);
          expect(contour.pathD.endsWith('Z')).toBe(true);
          expect(contour.pathD).not.toMatch(/NaN|Infinity|undefined/);
          expect(contour.viewBox.width).toBeGreaterThan(0);
          expect(contour.viewBox.height).toBeGreaterThan(0);
          expect(points(contour.pathD).length).toBeGreaterThanOrEqual(4);
        }
      }
    }
  });
});
