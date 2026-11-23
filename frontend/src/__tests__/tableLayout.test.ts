import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { render } from '@testing-library/preact';
import {
  BOUT_DEFENSE_OVERHANG_RATIO,
  DEFAULT_GROUP_GAP_PX,
  DEFAULT_MOBILE_GROUP_GAP_PX,
  DEFAULT_MOBILE_UNCOVERED_GAP_PX,
  DEFAULT_UNCOVERED_GAP_PX,
  MIN_GROUP_GAP_PX,
  MIN_MOBILE_GROUP_GAP_PX,
  MIN_UNCOVERED_GAP_PX,
  MIN_MOBILE_UNCOVERED_GAP_PX,
  TABLE_CARD_HEIGHT,
  TABLE_CARD_WIDTH,
  TABLE_INDEX_STRIP_WIDTH_PX,
  TABLE_MOBILE_CARD_HEIGHT,
  TABLE_MOBILE_CARD_WIDTH,
  computeCoveredPairGeometry,
  computeTableBoutLayout,
  coveredStackWidth,
  partitionTablePairs,
  resolveCoveredPairsEdge,
  type BoutDefenderSeat,
} from '../utils/tableLayout';
import { TablePair } from '../components/TablePair';

const EPS = 0.05;
const CARD = TABLE_CARD_WIDTH; // 100
const OVERHANG = Math.round(CARD * BOUT_DEFENSE_OVERHANG_RATIO); // 36
const STRIP = TABLE_INDEX_STRIP_WIDTH_PX; // 36
const PAIR_WIDTH = CARD + OVERHANG; // 136
const PAIR_STEP = OVERHANG + STRIP; // 72

const desktop = (overrides: Partial<Parameters<typeof computeTableBoutLayout>[0]> = {}) =>
  computeTableBoutLayout({
    availableWidth: 800,
    cardWidth: CARD,
    defenderSeat: 'bottom',
    ...overrides,
  });

describe('T-90-feedback-20261122_193457-3 ITEM-1b: covered-pair edge resolution', () => {
  it('pins top-left, top-center and bottom to the left and top-right to the right', () => {
    expect(resolveCoveredPairsEdge('top-left')).toBe('left');
    expect(resolveCoveredPairsEdge('top-center')).toBe('left');
    expect(resolveCoveredPairsEdge('bottom')).toBe('left');
    expect(resolveCoveredPairsEdge('top-right')).toBe('right');
  });

  it('exposes the resolved edge on the computed layout for every seat', () => {
    const expected: Record<BoutDefenderSeat, 'left' | 'right'> = {
      'top-left': 'left',
      'top-center': 'left',
      bottom: 'left',
      'top-right': 'right',
    };
    for (const [seat, edge] of Object.entries(expected) as Array<
      [BoutDefenderSeat, 'left' | 'right']
    >) {
      expect(desktop({ defenderSeat: seat, coveredCount: 2 }).coveredEdge, seat).toBe(edge);
    }
  });
});

describe('T-90-feedback-20261122_193457-3 ITEM-1b: partitionTablePairs', () => {
  const card = (rank: string) => ({ suit: 'spades', rank });
  const pairs = [
    { attack: card('six'), defense: null },
    { attack: card('seven'), defense: card('eight') },
    { attack: card('nine'), defense: undefined },
    { attack: card('ten'), defense: card('jack') },
  ];

  it('moves covered pairs immediately and keeps the uncovered pair order', () => {
    const { covered, uncovered } = partitionTablePairs(pairs);
    expect(covered.map((entry) => entry.pairIndex)).toEqual([1, 3]);
    expect(uncovered.map((entry) => entry.pairIndex)).toEqual([0, 2]);
    expect(covered.map((entry) => entry.pair.attack.rank)).toEqual(['seven', 'ten']);
    expect(uncovered.map((entry) => entry.pair.attack.rank)).toEqual(['six', 'nine']);
  });

  it('preserves the original attackIndex on every entry', () => {
    const { covered, uncovered } = partitionTablePairs(pairs);
    for (const entry of [...covered, ...uncovered]) {
      expect(entry.attackIndex).toBe(entry.pairIndex);
      // The entry still points at the very same pair object.
      expect(pairs[entry.pairIndex]).toBe(entry.pair);
    }
    // A drop / CoverCard built from a covered entry submits the backend index.
    expect(covered[0].attackIndex).toBe(1);
    expect(covered[1].attackIndex).toBe(3);
  });

  it('never waits for overflow: a single covered pair is extracted at once', () => {
    const { covered, uncovered } = partitionTablePairs([
      { attack: card('six'), defense: card('seven') },
    ]);
    expect(covered).toHaveLength(1);
    expect(uncovered).toHaveLength(0);
  });
});

describe('T-90-feedback-20261122_193457-3 ITEM-1c: maximal covered-pair overlap', () => {
  it('uses the 36px overlap and 72px step on desktop', () => {
    const geometry = computeCoveredPairGeometry(CARD);
    expect(geometry.defenseOverhang).toBe(OVERHANG);
    expect(geometry.indexStripWidth).toBe(STRIP);
    expect(geometry.coveredPairWidth).toBe(PAIR_WIDTH);
    expect(geometry.coveredPairStep).toBe(PAIR_STEP);
    expect(geometry.coveredPairMarginPx).toBe(PAIR_STEP - PAIR_WIDTH);
    expect(geometry.coveredPairMarginPx).toBe(-64);
  });

  it('scales the geometry proportionally on the 48px mobile card', () => {
    const geometry = computeCoveredPairGeometry(TABLE_MOBILE_CARD_WIDTH);
    const mobileOverhang = Math.round(TABLE_MOBILE_CARD_WIDTH * BOUT_DEFENSE_OVERHANG_RATIO);
    const mobileStrip = Math.round(
      (TABLE_INDEX_STRIP_WIDTH_PX * TABLE_MOBILE_CARD_WIDTH) / TABLE_CARD_WIDTH,
    );
    expect(geometry.defenseOverhang).toBe(mobileOverhang);
    expect(geometry.indexStripWidth).toBe(mobileStrip);
    expect(geometry.coveredPairWidth).toBe(TABLE_MOBILE_CARD_WIDTH + mobileOverhang);
    expect(geometry.coveredPairStep).toBe(mobileOverhang + mobileStrip);
  });

  it('keeps both index strips fully visible for every stacked pair', () => {
    // For pair `i`, pair `i + 1` must start no earlier than 36px after the
    // attack card and 36px after the defence card — so both rank/suit strips
    // (the full `"10"` included) stay uncovered.
    for (let index = 0; index < 6; index += 1) {
      const attackStart = index * PAIR_STEP;
      const defenseStart = attackStart + OVERHANG;
      const nextStart = (index + 1) * PAIR_STEP;
      const attackVisible = Math.min(defenseStart, nextStart) - attackStart;
      const defenseVisible = nextStart - defenseStart;
      expect(attackVisible, `pair ${index} attack strip`).toBeGreaterThanOrEqual(STRIP);
      expect(defenseVisible, `pair ${index} defence strip`).toBeGreaterThanOrEqual(STRIP);
      expect(defenseStart - attackStart).toBe(OVERHANG);
    }
    const geometry = computeCoveredPairGeometry(CARD);
    expect(coveredStackWidth(0, geometry)).toBe(0);
    expect(coveredStackWidth(1, geometry)).toBe(PAIR_WIDTH);
    expect(coveredStackWidth(2, geometry)).toBe(PAIR_WIDTH + PAIR_STEP);
    expect(coveredStackWidth(6, geometry)).toBe(PAIR_WIDTH + 5 * PAIR_STEP);
    expect(coveredStackWidth(6)).toBe(496);
  });
});

describe('T-90-feedback-20261122_193457-3 ITEM-1d: default gaps', () => {
  it('keeps small positive gaps when there is plenty of space (desktop)', () => {
    const layout = desktop({ coveredCount: 1, uncoveredCount: 2, availableWidth: 800 });
    expect(layout.coveredPairStep).toBe(PAIR_STEP);
    expect(layout.coveredPairMarginPx).toBe(-64);
    expect(layout.groupGapPx).toBe(DEFAULT_GROUP_GAP_PX);
    expect(layout.uncoveredStep).toBe(CARD + DEFAULT_UNCOVERED_GAP_PX);
    expect(layout.uncoveredMarginPx).toBe(DEFAULT_UNCOVERED_GAP_PX);
    expect(layout.singleRowGuaranteed).toBe(true);
    expect(layout.isCompressed).toBe(false);
    expect(layout.totalWidth).toBe(PAIR_WIDTH + DEFAULT_GROUP_GAP_PX + CARD + 112);
  });

  it('uses the tighter mobile default gaps', () => {
    const layout = computeTableBoutLayout({
      availableWidth: 320,
      cardWidth: TABLE_MOBILE_CARD_WIDTH,
      coveredCount: 1,
      uncoveredCount: 2,
      defenderSeat: 'bottom',
    });
    expect(layout.cardHeight).toBe(TABLE_MOBILE_CARD_HEIGHT);
    expect(layout.groupGapPx).toBe(DEFAULT_MOBILE_GROUP_GAP_PX);
    expect(layout.uncoveredMarginPx).toBe(DEFAULT_MOBILE_UNCOVERED_GAP_PX);
    expect(layout.totalWidth).toBeLessThanOrEqual(320 + EPS);
  });

  it('reports the requested floor constants', () => {
    expect([
      MIN_GROUP_GAP_PX,
      MIN_MOBILE_GROUP_GAP_PX,
      MIN_UNCOVERED_GAP_PX,
      MIN_MOBILE_UNCOVERED_GAP_PX,
    ]).toEqual([4, 0, 4, 0]);
    expect(TABLE_CARD_HEIGHT).toBe(140);
  });
});

describe('T-90-feedback-20261122_193457-3 ITEM-1a: single-row guarantee', () => {
  it('keeps 1..6 uncovered cards on one row on desktop', () => {
    for (let count = 1; count <= 6; count += 1) {
      const layout = desktop({ coveredCount: 0, uncoveredCount: count, availableWidth: 420 });
      expect(layout.singleRowGuaranteed, `count ${count}`).toBe(true);
      expect(layout.totalWidth, `count ${count}`).toBeLessThanOrEqual(420 + EPS);
      if (count > 1) {
        // Every card keeps the full 36px index strip readable.
        expect(layout.uncoveredStep, `count ${count}`).toBeGreaterThanOrEqual(STRIP);
        // Four or fewer cards still fit with a (possibly reduced) positive gap;
        // five and six must overlap slightly to stay on one row.
        if (count >= 5) {
          expect(layout.uncoveredMarginPx, `count ${count}`).toBeLessThan(0);
        } else {
          expect(layout.uncoveredMarginPx, `count ${count}`).toBeGreaterThanOrEqual(
            MIN_UNCOVERED_GAP_PX,
          );
        }
      }
    }
  });

  it('keeps 1..6 cards plus covered pairs on one row on desktop', () => {
    for (let count = 1; count <= 6; count += 1) {
      const layout = desktop({
        coveredCount: count,
        uncoveredCount: count,
        availableWidth: 420,
      });
      expect(layout.singleRowGuaranteed, `count ${count}`).toBe(true);
      expect(layout.totalWidth, `count ${count}`).toBeLessThanOrEqual(420 + EPS);
    }
  });

  it('keeps 1..6 cards plus covered pairs on one row on mobile', () => {
    for (let count = 1; count <= 6; count += 1) {
      const layout = computeTableBoutLayout({
        availableWidth: 292,
        cardWidth: TABLE_MOBILE_CARD_WIDTH,
        coveredCount: count,
        uncoveredCount: count,
        defenderSeat: 'bottom',
      });
      expect(layout.singleRowGuaranteed, `count ${count}`).toBe(true);
      expect(layout.totalWidth, `count ${count}`).toBeLessThanOrEqual(292 + EPS);
    }
  });

  it('shrinks the gaps smoothly before allowing overlap', () => {
    // 2 covered + 2 uncovered at 420px: default row is 436px, the min-gap row
    // is 416px, so both gaps shrink and no card overlaps yet.
    const layout = desktop({ coveredCount: 2, uncoveredCount: 2, availableWidth: 420 });
    expect(layout.coveredPairStep).toBe(PAIR_STEP);
    expect(layout.groupGapPx).toBeLessThan(DEFAULT_GROUP_GAP_PX);
    expect(layout.groupGapPx).toBeGreaterThanOrEqual(MIN_GROUP_GAP_PX);
    expect(layout.uncoveredMarginPx).toBeGreaterThanOrEqual(MIN_UNCOVERED_GAP_PX);
    expect(layout.totalWidth).toBeLessThanOrEqual(420 + EPS);
    expect(layout.isCompressed).toBe(true);
  });

  it('allows slight overlap among uncovered cards, clamped at the index strip', () => {
    // 3 covered + 2 uncovered at 420px: the min-gap row is 488px, so the two
    // uncovered cards overlap down to the 36px readable strip and the row fits.
    const layout = desktop({ coveredCount: 3, uncoveredCount: 2, availableWidth: 420 });
    expect(layout.coveredPairStep).toBe(PAIR_STEP);
    expect(layout.groupGapPx).toBe(MIN_GROUP_GAP_PX);
    expect(layout.uncoveredStep).toBe(STRIP);
    expect(layout.uncoveredMarginPx).toBe(STRIP - CARD);
    expect(layout.totalWidth).toBeLessThanOrEqual(420 + EPS);
    expect(layout.singleRowGuaranteed).toBe(true);
  });

  it('compresses further only when the narrow width forces it', () => {
    const layout = desktop({ coveredCount: 3, uncoveredCount: 3, availableWidth: 300 });
    expect(layout.singleRowGuaranteed).toBe(true);
    expect(layout.totalWidth).toBeLessThanOrEqual(300 + EPS);
    expect(layout.isCompressed).toBe(true);
  });

  it('counts extra target / redirect outline slots in the single row', () => {
    const withoutOutlines = desktop({ coveredCount: 1, uncoveredCount: 2, availableWidth: 800 });
    const withOutlines = desktop({
      coveredCount: 1,
      uncoveredCount: 2,
      extraSlotCount: 2,
      availableWidth: 800,
    });
    expect(withOutlines.uncoveredRowWidth).toBeGreaterThan(withoutOutlines.uncoveredRowWidth);
    expect(withOutlines.uncoveredStep).toBe(withoutOutlines.uncoveredStep);
    expect(withOutlines.singleRowGuaranteed).toBe(true);
  });

  it('handles an empty bout deterministically', () => {
    const layout = desktop({ coveredCount: 0, uncoveredCount: 0, availableWidth: 800 });
    expect(layout.coveredStackWidth).toBe(0);
    expect(layout.uncoveredRowWidth).toBe(0);
    expect(layout.totalWidth).toBe(0);
    expect(layout.uncoveredMarginPx).toBe(0);
    expect(layout.singleRowGuaranteed).toBe(true);
  });
});

describe('T-90-feedback-20261122_193457-3 TablePair presentation props', () => {
  it('marks a covered pair with its edge and collapsed presentation', () => {
    const { container } = render(
      h(TablePair, {
        attack: { suit: 'hearts', rank: 'ten' },
        defense: { suit: 'spades', rank: 'ace' },
        coveredEdge: 'left',
        isCollapsedCovered: true,
        marginLeft: '-64px',
      }),
    );
    const pair = container.querySelector('.table-pair') as HTMLElement;
    expect(pair.getAttribute('data-covered')).toBe('true');
    expect(pair.getAttribute('data-covered-edge')).toBe('left');
    expect(pair.getAttribute('data-collapsed-covered')).toBe('true');
    expect(pair.classList.contains('table-pair-covered-collapsed')).toBe(true);
    expect(pair.style.marginLeft).toBe('-64px');
  });

  it('keeps an uncovered pair interactive-neutral and still exposes the edge', () => {
    const { container } = render(
      h(TablePair, {
        attack: { suit: 'hearts', rank: 'ten' },
        coveredEdge: 'right',
        dropZone: 'cover:2',
      }),
    );
    const pair = container.querySelector('.table-pair') as HTMLElement;
    expect(pair.getAttribute('data-covered')).toBe('false');
    expect(pair.getAttribute('data-covered-edge')).toBe('right');
    expect(pair.getAttribute('data-collapsed-covered')).toBe('false');
    expect(pair.classList.contains('table-pair-covered-collapsed')).toBe(false);
    expect(
      container.querySelector('.table-pair-attack')!.getAttribute('data-drop-zone'),
    ).toBe('cover:2');
  });

  it('merges the optional style prop last without losing the pair tokens', () => {
    const { container } = render(
      h(TablePair, {
        attack: { suit: 'clubs', rank: 'six' },
        defense: { suit: 'diamonds', rank: 'seven' },
        style: { marginLeft: '-31px', zIndex: 2 },
      }),
    );
    const pair = container.querySelector('.table-pair') as HTMLElement;
    expect(pair.style.marginLeft).toBe('-31px');
    expect(pair.style.getPropertyValue('--pair-card-w')).toBe('var(--card-w, 100px)');
    expect(pair.style.getPropertyValue('--pair-card-h')).toBe('var(--card-h, 140px)');
  });

  it('stays backward-compatible without the new props', () => {
    const { container } = render(
      h(TablePair, { attack: { suit: 'clubs', rank: 'six' }, defense: null }),
    );
    const pair = container.querySelector('.table-pair') as HTMLElement;
    expect(pair.getAttribute('data-covered')).toBe('false');
    expect(pair.getAttribute('data-covered-edge')).toBeNull();
    expect(pair.getAttribute('data-card-width')).toBe('100');
    expect(pair.getAttribute('data-card-height')).toBe('140');
  });
});
