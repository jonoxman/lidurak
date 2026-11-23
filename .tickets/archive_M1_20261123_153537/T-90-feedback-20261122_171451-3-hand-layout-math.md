<!-- WAVE:1 -->
# Ticket: Hand Layout Engine — Option B Box Progression, Hover-Parting Solver, Two-Tier Lift & Contour Math

## Context & Objective
Implement the pure, deterministic layout math in `frontend/src/utils/handLayout.ts` for:
- Updated maximal allowable overlap preserving full `'10'` rank & enlarged suit visibility (Item #2c),
- Constant full-size card dimensions with **Option B** hand-box & overlap rules (Items #5a & #5b),
- Smooth hover-parting x-position solver with stationary hovered card and 1-card guard (Items #6a, #6b, #6c),
- Two-tier vertical elevation (half-raised eligible cards vs full-raised selected cards) and tight non-rectangular contour geometry (Item #8).

## Target Files (Pure Layout Module ONLY — Do Not Touch Any `.tsx` or `.css` Files, `README.md`, or `ARCHITECTURE.md`)
- `frontend/src/utils/handLayout.ts`
- `frontend/src/__tests__/handLayout.test.ts`

## Implementation Requirements
1. **Constant Full Card Size & Updated Max Allowable Overlap (Items #2c & #5a):**
   - Never scale down or shrink card `width` or `height` for large hands. Card dimensions passed into / returned by `handLayout.ts` MUST stay at constant full card size for 1 to 52 cards.
   - Update the default minimum exposed left strip width (`DEFAULT_MIN_VISIBLE_INDEX_STRIP_PX`, e.g., `36` px, also accept an explicit `minVisibleStripPx` parameter so `GameTable.tsx` can pass `CARD_INDEX_STRIP_WIDTH_PX` from `Card.tsx`) so that:
     - `minStepAllowable = minVisibleStripPx` (the step between adjacent card left edges that guarantees the full-size `'10'` rank and enlarged side suit indicator are 100% visible).
     - `maxAllowableOverlapRatio = Math.max(0, Math.min(0.85, 1 - minVisibleStripPx / cardWidth))`.
2. **Option B Hand Box & Overlap Progression (Item #5b — Mandatory Human Override):**
   Given `cardCount`, `cardWidth`, `minOverlapRatio` (the existing default minimum overlap, e.g., `0.20`), `minVisibleStripPx`, and `maximalBoxWidth` (almost the full play-area width minus small horizontal margins on both sides):
   - **Default 6-card box width:** `defaultSixCardBoxWidth = cardWidth + 5 * cardWidth * (1 - minOverlapRatio)`.
   - **Step 1 (1–6 cards):** Cards use `minOverlapRatio` (step = `cardWidth * (1 - minOverlapRatio)`). Total hand width is `<= defaultSixCardBoxWidth`, centered within the hand container.
   - **Step 2 (Option B — Expand toward maximal box first):** As `cardCount` grows beyond 6, keep `step = cardWidth * (1 - minOverlapRatio)` so the hand expands smoothly beyond `defaultSixCardBoxWidth` up toward `maximalBoxWidth`.
   - **Step 3 (Compress inside maximal box up to maximal allowable overlap):** Once `cardWidth + (cardCount - 1) * minOverlapStep > maximalBoxWidth`, clamp total hand width to `maximalBoxWidth` and compute `step = (maximalBoxWidth - cardWidth) / (cardCount - 1)`. While `step >= minVisibleStripPx`, overlap increases smoothly up to `maxAllowableOverlapRatio` with full `'10'` rank + enlarged suit still visible.
   - **Step 4 (Super-overlap beyond maximal allowable overlap):** Once even `maxAllowableOverlapRatio` would exceed `maximalBoxWidth` (i.e., `cardWidth + (cardCount - 1) * minVisibleStripPx > maximalBoxWidth`), continue clamping total hand width to `maximalBoxWidth` with `step = (maximalBoxWidth - cardWidth) / (cardCount - 1)` (allowing `step < minVisibleStripPx`, floored at a tiny positive minimum like `4px` only for extreme edge cases so cards remain distinct and ordered). Cards NEVER shrink and NEVER overflow `maximalBoxWidth`.
   - Expose clear metadata in the returned layout object (`totalWidth`, `cardStep`, `overlapRatio`, `isSuperCompressed`, `cardPositions: number[]`, `defaultSixCardBoxWidth`, `maximalBoxWidth`).
3. **Smooth Hover-Parting Solver (Items #6a, #6b, #6c):**
   Provide a pure function (e.g., `computePartedCardPositions(basePositions, cardWidth, maximalBoxWidth, hoveredIndex, minVisibleStripPx)`) with these invariants:
   - **1-card / no-hover guard (Item #6c):** If `basePositions.length <= 1` or `hoveredIndex === null` or out of bounds, return `basePositions` unchanged (exact identity, zero delta).
   - **Stationary hovered card (Item #6b):** `result[hoveredIndex] === basePositions[hoveredIndex]` ALWAYS (within floating-point zero `0`). The hovered card MUST NEVER move!
   - **Local parting & distant compression (Item #6a):**
     - Partition cards strictly to the left (`0 .. hoveredIndex - 1`) and strictly to the right (`hoveredIndex + 1 .. n - 1`).
     - Near `hoveredIndex`, increase spacing between adjacent cards (reducing overlap so the hovered card's neighbor(s) and nearby cards expose more of their rank/suit/face — e.g., targeting at least `minVisibleStripPx` or wider up to `cardWidth * (1 - minOverlapRatio)` immediately adjacent to `hoveredIndex`, decaying smoothly with distance `d = |i - hoveredIndex|`).
     - Keep all left cards within `[leftBound, basePositions[hoveredIndex]]` and all right cards within `[basePositions[hoveredIndex], rightBound]` (where `[leftBound, rightBound]` fits cleanly inside `maximalBoxWidth`, e.g., `[0, maximalBoxWidth - cardWidth]` or centered hand bounds expanded up to `maximalBoxWidth`), compressing cards farther from `hoveredIndex` smoothly so cards remain strictly monotonically ordered (`result[i] < result[i + 1]`) and never overflow the maximal box!
     - Ensure smooth, continuous behavior as `hoveredIndex` moves from `i` to `i + 1` (no wild jumps).
4. **Two-Tier Vertical Lift & Tight Contour Geometry (Item #8):**
   - Define/update vertical lift tiers (preserving the existing full raise magnitude `FULL_SELECTED_LIFT_PX` as the selected tier):
     - `BASELINE_LIFT_PX = 0` (ineligible & unselected)
     - `ELIGIBLE_LIFT_PX = FULL_SELECTED_LIFT_PX / 2` (eligible playable card, unselected — raised halfway to the current level)
     - `SELECTED_LIFT_PX = FULL_SELECTED_LIFT_PX` (selected card — raised fully to the current level)
   - Provide helper `getCardVerticalLiftPx({ isEligible, isSelected })`: returns `SELECTED_LIFT_PX` if `isSelected`, else `ELIGIBLE_LIFT_PX` if `isEligible`, else `0`.
   - Update any existing tight non-rectangular hand contour/outline path generator in `handLayout.ts` so it accepts per-card `(x, liftPx)` coordinates (supporting all 3 lift tiers AND hover-parted `x` positions) and outputs a tight polygonal/SVG path hugging the actual top/bottom/left/right silhouette of all cards.

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-2c:** Maximal allowable overlap in `handLayout.ts` guarantees an exposed left strip wide enough to show the full-size `'10'` rank and enlarged suit indicator without clipping.
- [ ] **ITEM-5a:** Card dimensions are NEVER reduced for large hands (1–52 cards keep identical constant full card width and height).
- [ ] **ITEM-5b (Option B Override):** Implement the exact Option B progression: default 6-card box -> expand toward `maximalBoxWidth` as count > 6 -> compress inside `maximalBoxWidth` up to maximal allowable overlap -> compress beyond maximal allowable overlap inside `maximalBoxWidth` for very large hands (e.g., 30–46 cards), never overflowing `maximalBoxWidth`.
- [ ] **ITEM-6a:** Hover-parting solver reduces overlap for cards close to `hoveredIndex` and increases overlap for cards farther from `hoveredIndex` smoothly while preserving strict left-to-right ordering and staying within `maximalBoxWidth`.
- [ ] **ITEM-6b:** `parted[hoveredIndex] === base[hoveredIndex]` for every valid `hoveredIndex` (hovered card never shifts position).
- [ ] **ITEM-6c:** When `cardCount <= 1`, hover-parting returns unchanged positions (no parting animation).
- [ ] **ITEM-8:** Two-tier vertical lift helper returns `0` for baseline, `FULL_LIFT / 2` for eligible-only cards, and `FULL_LIFT` for selected cards; tight contour path generator accurately wraps all 3 tiers and parted x-positions.
- [ ] Add thorough unit tests in `frontend/src/__tests__/handLayout.test.ts` covering 1, 6, 14, 30, and 46 cards, Option B box thresholds, `'10'` visible-strip guarantee, hover-parting invariants (stationary hovered card, neighbor separation, outer compression, 1-card no-op, monotonic order, box clamping), and two-tier lift + contour coordinates.
- [ ] Run `cd frontend && npm test -- --run` and verify all tests pass.
- [ ] Do NOT edit `.tsx`, `.css`, `backend/`, `README.md`, or `ARCHITECTURE.md`.
