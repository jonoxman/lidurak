<!-- WAVE:1 -->
# Ticket: Pure Hand Overlap Layout & Tight Non-Rectangular Hand Contour Geometry Engine

## Context & Goal
Create a standalone, thoroughly tested TypeScript geometry module (`handContour.ts`) that computes:
1. Active player hand card coordinates honoring the **20% minimum to 80% maximum width overlap** constraint, preserving **left-side rank and suit visibility** on every card, and guaranteeing **zero horizontal overflow or UI overlap even when holding every card in the deck (up to 36–52 cards)**; and
2. A **tight, non-rectangular SVG contour path** wrapping the exact union silhouette of all placed card rectangles — dynamically distorting/stepping upward whenever individual cards are lifted because they are playable or selected.

This module is pure TypeScript with zero coupling to `GameTable.tsx` so Wave 2 can wire it cleanly into the live hand and card renderer.

## Target Files
- `frontend/src/utils/handContour.ts` (new file)
- `frontend/src/__tests__/handContour.test.ts` (new file)

## Implementation Details
1. **Responsive Hand Card Placement (`computeResponsiveHandLayout` in `handContour.ts`):**
   - Inputs:
     - `cardCount: number`
     - `cardWidth: number` (e.g., `100` desktop, `48` mobile — matching the larger outline size)
     - `cardHeight: number` (e.g., `140` desktop, `68` mobile)
     - `containerWidth: number` (available inner width of `[data-zone="player-hand"]`)
     - `containerHeight?: number` (optional max height guard)
     - `minOverlapRatio?: number` (default `0.20`, i.e., 20% minimum overlap -> max step `0.80 * cardWidth`)
     - `maxOverlapRatio?: number` (default `0.80`, i.e., 80% maximum overlap -> min step `0.20 * cardWidth`)
     - `minVisibleStripPx?: number` (e.g., `Math.max(18, Math.round(cardWidth * 0.20))` on desktop / `Math.round(cardWidth * 0.22)` on mobile so the left-side rank symbol and suit pip are ALWAYS visible on every card)
     - `liftedIndices?: ReadonlySet<number>` or `liftOffsets?: readonly number[]` (per-card upward lift in px, e.g., `16px` for playable/selected cards, `0px` otherwise)
   - Algorithm:
     - Effective `minStep = Math.max(cardWidth * (1 - maxOverlapRatio), minVisibleStripPx)` (approx `20%` of card width, keeping left-side rank+suit clearly visible).
     - Effective `maxStep = Math.max(minStep, cardWidth * (1 - minOverlapRatio))` (approx `80%` of card width -> at least `20%` overlap between adjacent cards when `cardCount >= 2`).
     - Compute maximum cards per row that fit inside `containerWidth` at `minStep`:
       `maxPerRow = Math.max(1, Math.floor((containerWidth - cardWidth) / minStep) + 1)`.
     - If `cardCount <= maxPerRow`: single row (`rows = 1`). Compute exact horizontal `step`:
       - If `cardCount <= 1`: `step = 0`.
       - Else: ideal fit step `fitStep = (containerWidth - cardWidth) / (cardCount - 1)`, clamped to `[minStep, maxStep]`.
     - If `cardCount > maxPerRow` (e.g. player picked up 25–36 or 52 cards, or narrow container):
       - Split cleanly across `rowCount = Math.ceil(cardCount / maxPerRow)` balanced rows (`perRow = Math.ceil(cardCount / rowCount)`).
       - For each row, compute its horizontal `step` clamped to `[minStep, maxStep]` so every card in the row satisfies the 20%–80% overlap constraint and stays strictly within `containerWidth`!
       - Stack rows cleanly with a compact vertical row offset (`rowOffsetY`, e.g., `Math.round(cardHeight * 0.34)` to `0.42`, clamped so upper-row rank+suit corners remain visible and total height stays tidy inside the hand zone).
     - Center each row horizontally within the layout box (`offsetX = Math.max(0, (layoutWidth - rowWidth) / 2)`).
     - Apply each card's upward lift offset (`y = baseY - liftPx`, shifting the entire layout down by `maxLift` so all coordinates are non-negative inside the hand coordinate space!).
     - Return `{ cards: CardPlacement[], totalWidth: number, totalHeight: number, rowCount: number, overlapRatio: number, stepX: number }` where every `CardPlacement` includes `{ index, x, y, width, height, row, col, zIndex, liftPx }`.
2. **Tight Non-Rectangular Contour Generator (`computeTightHandContourPath` in `handContour.ts`):**
   - Inputs:
     - `rects: readonly { x: number; y: number; width: number; height: number }[]` (the exact live placed card rects, **including upward lifts of playable/selected cards**)
     - `padding?: number` (tight uniform outward expansion, e.g., `6px`)
     - `cornerRadius?: number` (subtle rounded corners, e.g., `12px`, clamped per segment length so corners never invert)
   - Algorithm (exact orthogonal union boundary of axis-aligned rectangles — deterministic, O(N log N) or coordinate-compression grid boundary trace):
     - Expand each card rect by `padding` on all 4 sides (`[x - pad, x + w + pad] × [y - pad, y + h + pad]`).
     - Compute the exact outer orthogonal boundary loop(s) of the **union** of those expanded rectangles using X/Y coordinate compression + occupied cell grid edge tracing:
       - Collect all unique sorted X edges and Y edges.
       - Mark each grid cell `(ix, iy)` occupied if covered by any expanded rect.
       - Extract all directed boundary edges where an occupied cell borders an empty cell (clockwise winding), trace connected boundary loops, merge collinear consecutive segments so every corner is a true vertex.
       - Convert the vertex loop(s) into a crisp SVG path string `d` with smooth quadratic/arc corners (`Q`) of radius `Math.min(cornerRadius, prevSegLen / 2, nextSegLen / 2)`.
   - Properties guaranteed by construction:
     - **Never rectangular when cards are lifted!** If cards 2 and 4 are shifted upward by `18px`, the top contour tightly steps upward around card 2, drops back down over card 3, and steps upward again around card 4!
     - **Works seamlessly for 1 card, 6 cards, 30 cards, or multi-row 52-card hands!**
     - **Pixel-exact alignment:** Because both cards and the SVG contour share the exact same `(x, y)` coordinate system produced by `computeResponsiveHandLayout`, misalignment is mathematically impossible.
3. **Unit Tests (`frontend/src/__tests__/handContour.test.ts`):**
   - Test `computeResponsiveHandLayout` for 1, 2, 6, 12, 24, 30, 36, and 52 cards across desktop (`640px`, `800px`) and mobile (`320px`) widths:
     - Assert horizontal overlap between adjacent cards in every row is within `[0.20, 0.80]` (within floating tolerance / `minVisibleStripPx`).
     - Assert `card.x >= 0` and `card.x + card.width <= containerWidth` for EVERY card (zero overflow even at 36 and 52 cards!).
     - Assert exposed left strip (`nextCard.x - prevCard.x >= minVisibleStripPx`) on every overlapped card.
   - Test `computeTightHandContourPath`:
     - Assert non-empty valid SVG path for 1+ cards and empty string for 0 cards.
     - Assert when middle card(s) are lifted upward (`liftPx = 18`), the contour path has > 4 vertices (proving it is genuinely non-rectangular and distorts tightly around lifted cards rather than drawing a flat bounding box!).
     - Assert the contour's minY matches `liftedCard.y - padding` above lifted cards AND drops down to `unLiftedCard.y - padding` above non-lifted cards!
   - Run `npm test -- --run` and confirm 100% pass.

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-NEW1 (Geometry Engine):** "The active player's hand highlight box doesn't match with or align to the player's actual card positions at all. Adjust the implementation, ignoring all past specs for this component, to make sure that the highlight box responsively wraps tightly around the hand at all times. This means that if certain cards are shifted upwards to be playable, the highlight box should distort accordingly to keep wrapped tightly around the hand as a whole ("box" is no longer the right word - the outline does not need to maintain a rectangular shape)." -> `computeTightHandContourPath` generates an exact non-rectangular union-silhouette SVG path directly from live card rectangles including upward lift offsets.
- [ ] **ITEM-NEW3 (Layout Engine):** "Arrange the cards in the active user's hand subject to the following constraints: all cards should overlap by 20% of their width at minimum and by 80% of their width at maximum. (These percentages are approximate - adjust them as needed to make sure that the left-side rank symbol and suit is always visible on every card, and so that even if a player picks up every card into their hand, the hand won't look wrong graphically (i.e. go off screen or overlap UI elements)). Keep in mine New Item #1 when implementing this, and vice versa." -> `computeResponsiveHandLayout` enforces ~20%–80% overlap, guarantees visible left-side rank/suit strip, wraps cleanly into contained rows for huge hands (30–52 cards) with zero overflow, and feeds exact rects directly into `computeTightHandContourPath`.
- [ ] **Tests:** `handContour.test.ts` thoroughly validates all edge cases and `npm test -- --run` passes cleanly.

