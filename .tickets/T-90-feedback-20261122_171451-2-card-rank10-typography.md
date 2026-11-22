<!-- WAVE:1 -->
# Ticket: Consistent '10' Rank Font Size & Enlarged Card Side Suit Indicator

## Context & Objective
Fix card face typography and corner/side index styling so that `'10'` cards have the exact same rank font size as all other numbered and face cards (`6`–`9`, `J`, `Q`, `K`, `A`), and enlarge the side/corner suit indicator so it makes full use of the wider horizontal index column needed for the full-size `'10'` rank (Items #2a & #2b).

## Target Files (Card Component & Card Typography ONLY — Do Not Touch `handLayout.ts`, `GameTable.tsx`, `GamePage.tsx`, `LobbyPage.tsx`, `ActionBar.tsx`, `README.md`, or `ARCHITECTURE.md`)
- `frontend/src/components/Card.tsx`
- Card face CSS rules (in `frontend/src/app.css` or `frontend/src/styles/table.css` — inspect which file owns `.playing-card` / `.card-rank` / `.card-suit` rules and modify ONLY the card-face rank/suit/corner-index styling rules; do NOT modify hand layout, grid zones, timer, or action button styles).
- `frontend/src/__tests__/Card.test.tsx`

## Implementation Requirements
1. **Consistent `'10'` Rank Font Size (Item #2a):**
   - Remove any special-case smaller `font-size`, `transform: scaleX(...)`, `letter-spacing` squishing, or condensed font override that made `'10'` render smaller than single-character ranks (`6`, `7`, `8`, `9`, `J`, `Q`, `K`, `A`).
   - Ensure the computed `font-size` of the rank label on a `10` card is strictly identical to the `font-size` on `6`, `7`, `8`, `9`, `J`, `Q`, `K`, and `A` cards.
   - Ensure the two digits of `'10'` never wrap onto two lines (`white-space: nowrap`) and never clip or collide with the card border or center pip.
2. **Enlarged Side/Corner Suit Indicator (Item #2b):**
   - Widen the top-left (and mirrored bottom-right, if present) corner/side index column cleanly to comfortably fit the full-size `'10'` rank without overflow.
   - Increase the size of the suit indicator (`♠`, `♥`, `♦`, `♣` glyph/SVG) in the card corner/side index column so it fills and makes full visual use of the widened `'10'` index column width (centered cleanly beneath the rank in the side index strip).
3. **Shared Index-Strip Geometry Contract (for Wave 1 Ticket 3 & Wave 2 Ticket 5):**
   - Export a named constant from `Card.tsx` (e.g., `CARD_INDEX_STRIP_WIDTH_PX`, set to the exact pixel width from the card's left edge that completely clears left padding + full-size `'10'` rank + enlarged suit indicator + right breathing gutter, e.g., `34`–`38px` matching your actual CSS box geometry) and mirror it via a CSS custom property (e.g., `--card-index-strip-width`) so `handLayout.ts` and `GameTable.tsx` stay in exact sync.
   - Preserve all existing card dimensions (matching the throw-in and redirect outline dimensions from the previous round — do NOT shrink cards!).

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-2a:** The `'10'` rank number on cards uses the exact same font size as all other numbered and face cards (no smaller font-size class/style for `'10'`, no text wrapping or clipping).
- [ ] **ITEM-2b:** The suit indicator on the sides/corners of cards is enlarged to make full use of the increased index column width required by the full-size `'10'` rank, remaining crisp and balanced on both `'10'` and single-character ranks.
- [ ] Export `CARD_INDEX_STRIP_WIDTH_PX` (and matching CSS variable) from `Card.tsx` reflecting the exact unoccluded left-edge width required for full `'10'` rank + enlarged suit visibility.
- [ ] Card outer dimensions remain unchanged (matching the throw-in and redirect outlines).
- [ ] Add/update unit tests in `frontend/src/__tests__/Card.test.tsx` verifying `'10'` renders with identical rank styling/font-size class to `'9'`/`'A'`, enlarged suit indicator styling, and `CARD_INDEX_STRIP_WIDTH_PX` export.
- [ ] Run `cd frontend && npm test -- --run` and verify all tests pass.
- [ ] Do NOT edit `handLayout.ts`, `GameTable.tsx`, `GamePage.tsx`, `LobbyPage.tsx`, `ActionBar.tsx`, `README.md`, or `ARCHITECTURE.md`.
