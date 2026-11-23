/**
 * T-90-feedback-20261122_193457-3 ITEM-1: pure, framework-agnostic geometry for
 * the cards in play on the felt table.
 *
 * Two independent concerns live here:
 *
 * 1. [[resolveCoveredPairsEdge]] + [[partitionTablePairs]] — covered pairs
 *    (`defense != null`) are always extracted immediately from
 *    `view.tablePairs` and pinned to the vertical edge nearest the defender.
 *    Every partitioned entry keeps its **original** `pairIndex` /
 *    `attackIndex` so a `CoverCard(playerId, attackIndex, card)` action or a
 *    drop target can never submit a stale backend index.
 * 2. [[computeTableBoutLayout]] — the single-row layout for the covered stack
 *    plus the still-active uncovered cards (and their target / redirect
 *    outlines). Gaps shrink first and only then do the uncovered cards overlap,
 *    so every card ALWAYS stays on one horizontal row.
 *
 * No DOM access and no React/Preact imports: plain numbers in, deterministic
 * numbers out. `GameTable.tsx` / `table.css` (Wave 2) consume the result.
 */

import { DEFAULT_MIN_VISIBLE_INDEX_STRIP_PX } from './handLayout';

/** The seat that defends the active bout (the viewer's own edge is `bottom`). */
export type BoutDefenderSeat = 'top-left' | 'top-center' | 'top-right' | 'bottom';

/** The vertical felt edge the covered stack is pinned to. */
export type CoveredPairsEdge = 'left' | 'right';

/** Canonical desktop card footprint (`100x140`). */
export const TABLE_CARD_WIDTH = 100;
export const TABLE_CARD_HEIGHT = 140;
/** Canonical mobile card footprint (`48x68`, below the 900px breakpoint). */
export const TABLE_MOBILE_CARD_WIDTH = 48;
export const TABLE_MOBILE_CARD_HEIGHT = 68;

/**
 * T-96 / ITEM-3: the covering card hangs this fraction of a card width past the
 * attack card, so the attack card's rank+suit index strip stays exposed. It is
 * the shared `36%` index strip (`36px` on the `100px` desktop card) and is kept
 * at `0.36` for every caller.
 */
export const BOUT_DEFENSE_OVERHANG_RATIO = 0.36;
/**
 * Exposed left strip that keeps the full rank (`"10"` included) and the suit
 * indicator readable. Mirrors `CARD_INDEX_STRIP_WIDTH_PX` / the hand module.
 */
export const TABLE_INDEX_STRIP_WIDTH_PX = DEFAULT_MIN_VISIBLE_INDEX_STRIP_PX;

/** Default breathing room between the covered stack and the uncovered row. */
export const DEFAULT_GROUP_GAP_PX = 16;
export const DEFAULT_MOBILE_GROUP_GAP_PX = 8;
/** Default breathing room between two uncovered active cards. */
export const DEFAULT_UNCOVERED_GAP_PX = 12;
export const DEFAULT_MOBILE_UNCOVERED_GAP_PX = 6;
/** The gaps shrink toward these floors before any card may overlap. */
export const MIN_GROUP_GAP_PX = 4;
export const MIN_MOBILE_GROUP_GAP_PX = 0;
export const MIN_UNCOVERED_GAP_PX = 4;
export const MIN_MOBILE_UNCOVERED_GAP_PX = 0;

const EPS = 1e-9;

const finiteOr = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** True for the `48px`-class mobile card, used to pick the tighter gap pair. */
const isMobileCardWidth = (cardWidth: number): boolean => cardWidth < TABLE_CARD_WIDTH;

/**
 * ITEM-1b: the human-decided edge mapping.
 *
 * `top-left`, `top-center` and the viewer's own `bottom` edge all pin the
 * covered stack to the **left**; only `top-right` pins it to the **right**.
 * Anything unexpected falls back to `left`, the documented default.
 */
export function resolveCoveredPairsEdge(defenderSeat: BoutDefenderSeat): CoveredPairsEdge {
  return defenderSeat === 'top-right' ? 'right' : 'left';
}

/** One table pair, tagged with the index it originally had in `view.tablePairs`. */
export interface PartitionedTablePair<TPair> {
  /** The untouched pair object. */
  pair: TPair;
  /** Index in `view.tablePairs` — the identity of this pair. */
  pairIndex: number;
  /** Backend `attackIndex` for `CoverCard(playerId, attackIndex, card)`. */
  attackIndex: number;
}

export interface TablePairPartition<TPair> {
  /** Covered pairs, in their original order, pinned to the edge stack. */
  covered: PartitionedTablePair<TPair>[];
  /** As-yet uncovered active pairs, in their original order, for the row. */
  uncovered: PartitionedTablePair<TPair>[];
}

/**
 * ITEM-1b: partition `view.tablePairs` into the edge-pinned covered stack and
 * the uncovered active row.
 *
 * A covered pair (`defense != null`) leaves the interactive row **immediately**
 * and never waits for overflow. The original array order is preserved inside
 * each group, and `pairIndex` / `attackIndex` always point at the backend index
 * so drop targets and `CoverCard` actions stay exact.
 */
export function partitionTablePairs<TPair extends { defense?: unknown }>(
  tablePairs: readonly TPair[],
): TablePairPartition<TPair> {
  const covered: PartitionedTablePair<TPair>[] = [];
  const uncovered: PartitionedTablePair<TPair>[] = [];
  for (let pairIndex = 0; pairIndex < tablePairs.length; pairIndex += 1) {
    const pair = tablePairs[pairIndex];
    const entry: PartitionedTablePair<TPair> = { pair, pairIndex, attackIndex: pairIndex };
    if (pair.defense !== null && pair.defense !== undefined) {
      covered.push(entry);
    } else {
      uncovered.push(entry);
    }
  }
  return { covered, uncovered };
}

/** Exact covered-pair footprint, overlap and negative margin, in px. */
export interface CoveredPairGeometry {
  cardWidth: number;
  /** The defence card's horizontal overhang past the attack card. */
  defenseOverhang: number;
  /** Exposed left rank/suit strip of every card. */
  indexStripWidth: number;
  /** Total visual width of one covered pair (`cardWidth + defenseOverhang`). */
  coveredPairWidth: number;
  /** Maximal-overlap left-edge distance between two covered pairs. */
  coveredPairStep: number;
  /** Negative `margin-left` applied to every covered pair after the first. */
  coveredPairMarginPx: number;
}

/**
 * ITEM-3: maximal visible-index overlap geometry for one covered pair.
 *
 * A pair is the attack card plus its defence card shifted right by
 * `defenseOverhang` (`Math.round(cardWidth * 0.36)`), so consecutive pairs may
 * step by `defenseOverhang + indexStripWidth` (`72px` desktop):
 *
 * - attack card `i` exposes its left strip `[0, 36]`;
 * - defence card `i` exposes `[36, 72]` (its own identical index strip);
 * - pair `i + 1` starts cleanly at `72`.
 *
 * Every card's full rank (`"10"` included) and suit therefore stays uncovered.
 */
export function computeCoveredPairGeometry(
  cardWidth: number = TABLE_CARD_WIDTH,
  defenseOverhang?: number,
  indexStripWidth?: number,
): CoveredPairGeometry {
  const width = Math.max(1, finiteOr(cardWidth, TABLE_CARD_WIDTH));
  const overhang = clamp(
    finiteOr(defenseOverhang, Math.round(width * BOUT_DEFENSE_OVERHANG_RATIO)),
    0,
    width,
  );
  const strip = clamp(
    finiteOr(
      indexStripWidth,
      Math.round((TABLE_INDEX_STRIP_WIDTH_PX * width) / TABLE_CARD_WIDTH),
    ),
    0,
    width,
  );
  const coveredPairWidth = width + overhang;
  const coveredPairStep = overhang + strip;
  return {
    cardWidth: round2(width),
    defenseOverhang: round2(overhang),
    indexStripWidth: round2(strip),
    coveredPairWidth: round2(coveredPairWidth),
    coveredPairStep: round2(coveredPairStep),
    coveredPairMarginPx: round2(coveredPairStep - coveredPairWidth),
  };
}

/**
 * ITEM-3: total width of `k` maximally overlapped covered pairs:
 * `k === 0 ? 0 : coveredPairWidth + (k - 1) * coveredPairStep`.
 */
export function coveredStackWidth(
  coveredCount: number,
  geometry: CoveredPairGeometry = computeCoveredPairGeometry(),
): number {
  const count = Math.max(0, Math.floor(finiteOr(coveredCount, 0)));
  if (count === 0) return 0;
  return round2(geometry.coveredPairWidth + (count - 1) * geometry.coveredPairStep);
}

export interface TableBoutLayoutOptions {
  /** Covered pairs already pinned to the edge stack. */
  coveredCount?: number;
  /** Uncovered active cards still in the interactive row. */
  uncoveredCount?: number;
  /** Extra card-sized slots sharing the row (target / redirect outlines). */
  extraSlotCount?: number;
  /** Inner width of the bout row in `[data-zone="table-arena"]`. */
  availableWidth: number;
  /** `100` desktop / `48` mobile. */
  cardWidth?: number;
  /** `140` desktop / `68` mobile. */
  cardHeight?: number;
  /** Exposed rank/suit strip (defaults to the proportional `36px` strip). */
  indexStripWidth?: number;
  /** Defence overhang (defaults to `round(cardWidth * 0.36)`). */
  defenseOverhang?: number;
  /** Seat that defended the bout; resolves the pinned edge. */
  defenderSeat?: BoutDefenderSeat;
  /** Desired covered-stack-to-row gap (default `16px` / `8px`). */
  groupGap?: number;
  /** Desired uncovered-card gap (default `12px` / `6px`). */
  uncoveredGap?: number;
  /** Gap floor before overlap is allowed (default `4px` / `0px`). */
  minGap?: number;
}

export interface TableBoutLayoutResult {
  /** `'left'` for top-left / top-center / bottom, `'right'` for top-right. */
  coveredEdge: CoveredPairsEdge;
  coveredPairWidth: number;
  coveredPairStep: number;
  /** Negative overlap margin between consecutive covered pairs. */
  coveredPairMarginPx: number;
  /** Gap between the covered stack and the uncovered active row. */
  groupGapPx: number;
  /** Left-edge distance between adjacent uncovered cards. */
  uncoveredStep: number;
  /** Positive gap (`step - cardWidth`), or negative slight overlap, uncovered. */
  uncoveredMarginPx: number;
  /** True when the whole bout fits in one row (`totalWidth <= availableWidth`). */
  singleRowGuaranteed: boolean;
  /** Width of the covered stack alone (`0` when nothing is covered). */
  coveredStackWidth: number;
  /** Width of the uncovered active row alone (`0` when there are no slots). */
  uncoveredRowWidth: number;
  /** Total row width the layout occupies. */
  totalWidth: number;
  /** Effective width the layout was solved against. */
  availableWidth: number;
  cardWidth: number;
  cardHeight: number;
  indexStripWidth: number;
  defenseOverhang: number;
  /** True once gaps shrank below their defaults or cards overlap. */
  isCompressed: boolean;
}

/**
 * ITEM-1a/1d: single-row layout for the covered stack plus the uncovered active
 * cards and their extra outline slots.
 *
 * The solver proceeds in the documented order:
 *
 * 1. **Default** — covered stack at its maximal-overlap step, a small
 *    `groupGap` before the uncovered row, and a small `uncoveredGap` between
 *    active cards.
 * 2. **Tight** — both gaps shrink *smoothly and proportionally* toward
 *    `minGap`, so the row fits without wrapping.
 * 3. **Forced** — the uncovered cards may overlap; their step is kept at or
 *    above the exposed index strip whenever that physically fits, and only
 *    compressed further when the viewport makes it impossible. If the covered
 *    stack itself no longer fits, its step is compressed too (covered geometry
 *    is never allowed to break the single row).
 *
 * `totalWidth <= availableWidth` therefore holds for every layout whose row can
 * physically be narrower than the viewport; `singleRowGuaranteed` reports it.
 */
export function computeTableBoutLayout(
  options: TableBoutLayoutOptions,
): TableBoutLayoutResult {
  const geometry = computeCoveredPairGeometry(
    options.cardWidth,
    options.defenseOverhang,
    options.indexStripWidth,
  );
  const cardW = geometry.cardWidth;
  const mobile = isMobileCardWidth(cardW);
  const cardHeight = Math.max(
    1,
    finiteOr(options.cardHeight, mobile ? TABLE_MOBILE_CARD_HEIGHT : TABLE_CARD_HEIGHT),
  );

  const coveredCount = Math.max(0, Math.floor(finiteOr(options.coveredCount, 0)));
  const uncoveredCount = Math.max(0, Math.floor(finiteOr(options.uncoveredCount, 0)));
  const extraSlotCount = Math.max(0, Math.floor(finiteOr(options.extraSlotCount, 0)));
  const slots = uncoveredCount + extraSlotCount;
  const available = Math.max(0, finiteOr(options.availableWidth, 0));

  const defaultGroupGap = Math.max(
    MIN_MOBILE_GROUP_GAP_PX,
    finiteOr(options.groupGap, mobile ? DEFAULT_MOBILE_GROUP_GAP_PX : DEFAULT_GROUP_GAP_PX),
  );
  const defaultUncoveredGap = Math.max(
    MIN_MOBILE_UNCOVERED_GAP_PX,
    finiteOr(options.uncoveredGap, mobile ? DEFAULT_MOBILE_UNCOVERED_GAP_PX : DEFAULT_UNCOVERED_GAP_PX),
  );
  const minGap = clamp(
    finiteOr(options.minGap, mobile ? MIN_MOBILE_GROUP_GAP_PX : MIN_GROUP_GAP_PX),
    0,
    Math.min(defaultGroupGap, defaultUncoveredGap),
  );

  const separatorCount = coveredCount > 0 && slots > 0 ? 1 : 0;

  const coveredWidthAt = (step: number): number =>
    coveredCount === 0
      ? 0
      : geometry.coveredPairWidth + (coveredCount - 1) * Math.max(0, step);
  const uncoveredWidthAt = (gap: number): number =>
    slots === 0 ? 0 : cardW + (slots - 1) * (cardW + gap);
  const totalWidthAt = (groupGap: number, uncoveredGap: number, step: number): number =>
    coveredWidthAt(step) +
    separatorCount * Math.max(0, groupGap) +
    uncoveredWidthAt(uncoveredGap);

  let groupGap = Math.max(minGap, defaultGroupGap);
  let uncoveredGap = Math.max(minGap, defaultUncoveredGap);
  let coveredStep = geometry.coveredPairStep;

  if (totalWidthAt(groupGap, uncoveredGap, coveredStep) > available + EPS) {
    const totalAtMinGaps = totalWidthAt(minGap, minGap, coveredStep);
    if (totalAtMinGaps <= available + EPS) {
      // Step 2: shrink both gaps smoothly toward their floor.
      const defaultTotal = totalWidthAt(groupGap, uncoveredGap, coveredStep);
      const span = defaultTotal - totalAtMinGaps;
      const progress = span > EPS ? clamp((defaultTotal - available) / span, 0, 1) : 1;
      groupGap = defaultGroupGap - (defaultGroupGap - minGap) * progress;
      uncoveredGap = defaultUncoveredGap - (defaultUncoveredGap - minGap) * progress;
    } else {
      // Step 3: no gap-only solution — allow the uncovered cards to overlap.
      groupGap = minGap;
      if (slots >= 2) {
        const availableForRow =
          available - coveredWidthAt(coveredStep) - separatorCount * groupGap;
        const neededStep = (availableForRow - cardW) / (slots - 1);
        // Keep the exposed index strip whenever it fits; below that the width
        // is physically forced, so compress only as far as necessary (never
        // past a single shared left edge).
        const step = clamp(neededStep, 0, cardW + minGap);
        uncoveredGap = step - cardW;
      } else {
        uncoveredGap = 0;
      }

      // The covered stack itself may still be too wide on an extreme viewport:
      // compress its step (below the maximal-overlap ideal) until it fits.
      if (totalWidthAt(groupGap, uncoveredGap, coveredStep) > available + EPS) {
        const availableForCovered =
          available - separatorCount * groupGap - uncoveredWidthAt(uncoveredGap);
        if (coveredCount > 1) {
          const neededCoveredStep =
            (availableForCovered - geometry.coveredPairWidth) / (coveredCount - 1);
          coveredStep = clamp(neededCoveredStep, 0, geometry.coveredPairStep);
        }
      }

      // Last resort: drop the separator gap entirely, so the single row still
      // wins over a purely cosmetic gap on a genuinely tiny lane.
      if (totalWidthAt(groupGap, uncoveredGap, coveredStep) > available + EPS) {
        groupGap = 0;
      }
    }
  }

  const uncoveredStep = slots === 0 ? 0 : cardW + (slots > 1 ? uncoveredGap : 0);
  const rawTotal = totalWidthAt(groupGap, uncoveredGap, coveredStep);
  const singleRowGuaranteed = rawTotal <= available + EPS;

  const isCompressed =
    coveredStep < geometry.coveredPairStep - EPS ||
    groupGap < Math.max(minGap, defaultGroupGap) - EPS ||
    uncoveredGap < Math.max(minGap, defaultUncoveredGap) - EPS;

  return {
    coveredEdge: resolveCoveredPairsEdge(options.defenderSeat ?? 'bottom'),
    coveredPairWidth: geometry.coveredPairWidth,
    coveredPairStep: round2(coveredStep),
    coveredPairMarginPx: round2(coveredStep - geometry.coveredPairWidth),
    groupGapPx: round2(groupGap),
    uncoveredStep: round2(uncoveredStep),
    uncoveredMarginPx: slots > 1 ? round2(uncoveredStep - cardW) : 0,
    singleRowGuaranteed,
    coveredStackWidth: round2(coveredWidthAt(coveredStep)),
    uncoveredRowWidth: round2(uncoveredWidthAt(uncoveredGap)),
    totalWidth: round2(rawTotal),
    availableWidth: round2(available),
    cardWidth: cardW,
    cardHeight: round2(cardHeight),
    indexStripWidth: geometry.indexStripWidth,
    defenseOverhang: geometry.defenseOverhang,
    isCompressed,
  };
}
