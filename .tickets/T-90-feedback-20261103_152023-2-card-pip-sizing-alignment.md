<!-- WAVE:1 -->
# Ticket T-90-feedback-20261103_152023-2-card-pip-sizing-alignment: Increase Card Corner & Numbered Face Pip Sizes and Align Corner Pips Horizontally

## Summary
Lightly increase the size of the suit pips in the top-left and bottom-right corners of all cards so they are more distinguishable and horizontally aligned with the corner rank numbers/letters, and slightly increase the size of the suit pips on the faces of numbered cards (`2`–`10`) with a tighter layout so they never overlap the corner indices, the trump badge, or each other.

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-3a (Verbatim):** "It looks good. However, lightly increase the size of the pips in the corners of the cards so they are more distinguishable, and horizontally aligned with the numbers."
- [ ] **ITEM-3b (Verbatim):** "Also increase the size of the pips on the faces of the cards for numbered cards slightly - adjust their layout as needed to be a little tighter so they still don't overlap the rest of the symbols on the card."
- [ ] **End-to-End Frontend Wiring (`frontend/src/components/Card.tsx`):**
  - **Corner Suit Pips (`ITEM-3a`):**
    - In `frontend/src/components/Card.tsx`, locate the top-left and bottom-right corner rank `<text>` elements (`data-testid="card-rank-top"` and `data-testid="card-rank-bottom"`) and their corresponding corner suit pip `<text>` elements (`data-testid="card-suit-top"` / `data-testid="card-suit-bottom"` or the corner suit glyphs).
    - Lightly increase the corner suit pip font size (e.g., increasing from the current small size by ~1.5–2.5 viewBox units so the suit symbol is clearly distinguishable at standard table zoom).
    - Horizontally align both the corner rank number/letter and the corner suit pip in the top-left corner (and in the rotated bottom-right corner group) along the exact same horizontal center axis (same `x` coordinate with `textAnchor="middle"` on both the corner rank `<text>` and the corner suit `<text>`), so the suit pip sits directly centered beneath the rank number/letter (including single-character ranks `2`–`9`, `J`, `Q`, `K`, `A` and two-character `10`).
    - Adjust the vertical `y` position of the corner suit pip slightly if needed so there is clean vertical breathing room between the bottom of the corner rank text and the top of the larger corner suit pip.
  - **Numbered Card Face Pips (`ITEM-3b`):**
    - In `frontend/src/components/Card.tsx`, locate the face pip rendering and layout coordinates for all numbered cards (`2`, `3`, `4`, `5`, `6`, `7`, `8`, `9`, `10`).
    - Slightly increase the font size / scale of the face pips on numbered cards (`2`–`10`). Keep court card (`J`, `Q`, `K`) and Ace (`A`) center symbols untouched unless needed for constant definitions.
    - Tighten the horizontal column coordinates (`left`, `center`, `right` `x` positions) and/or vertical row bounds (`top` to `bottom` `y` positions) of the numbered-card face pips so that:
      1. The slightly larger numbered-card face pips do not overlap the top-left or bottom-right corner rank/suit indices (including the wider `10` rank and the newly enlarged corner suit pips).
      2. The slightly larger numbered-card face pips do not overlap the top-right golden trump badge (`cx = 61, cy = 10, r = 6`) when `isTrump` is true.
      3. Pips in multi-pip ranks (`6`, `7`, `8`, `9`, `10`) do not overlap or collide with adjacent pips horizontally or vertically.
- [ ] **15-Second QA Testability via Existing 1-Click Presets:**
  - Verify that opening `http://localhost:5173` and clicking `Surrender Half-Off`, `Defenseless Auto-Surrender`, or `4P Chaos Targets` in the `⚡ QA Scenarios` panel immediately displays numbered cards (`6`–`10`, and `2`–`5` in 4P), court cards (`J`, `Q`, `K`), and Aces (`A`) on the felt and in the active hand where the larger, horizontally aligned corner pips and tighter, slightly larger numbered-card face pips are immediately observable.
- [ ] **Automated Tests (`frontend/src/__tests__/Card.test.tsx`):**
  - Update and expand `frontend/src/__tests__/Card.test.tsx` to verify:
    1. Top-left and bottom-right corner suit pips share the exact same `x` coordinate and `text-anchor="middle"` horizontal alignment as the top-left and bottom-right corner rank `<text>` elements across all ranks (`2`–`10`, `J`, `Q`, `K`, `A`).
    2. The corner suit pip font size is larger than before and clearly distinguishable while remaining non-overlapping with the corner rank text.
    3. Numbered cards (`2`–`10`) render their face pips at the increased font size and within tightened column/row bounds that preserve non-overlap with the corner rank/suit indices, the trump badge, and neighboring face pips.
  - Run `cd frontend && npm test -- --run` and ensure all test suites pass.
