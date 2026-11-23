<!-- WAVE:2 -->
# Ticket: Wire Option B Large-Hand Layout, Smooth Hover-Parting, Two-Tier Card Raise & Drag Offset Bug Fix

## Context & Objective
Wire Wave 1's card typography (`CARD_INDEX_STRIP_WIDTH_PX`) and hand layout math (`handLayout.ts`) end-to-end into `GameTable.tsx` and `table.css` to deliver:
- Updated maximal allowable overlap ensuring full `'10'` rank & enlarged suit visibility (Item #2c),
- Zero horizontal offset when clicking and dragging any card regardless of its index in the hand (Item #3),
- Constant full card size and Option B default-6-card-box -> maximal-box -> super-overlap layout (Items #5a & #5b),
- Smooth hover-parting animation with stationary hovered card and 1-card suppression (Items #6a, #6b, #6c),
- Two-tier vertical raise (eligible = half height, selected = full height) with tight non-rectangular hand contour wrapping all tiers (Item #8).

## Target Files (Do Not Touch `GamePage.tsx`, `LobbyPage.tsx`, `ActionBar.tsx`, `actionIcons.css`, `backend/`, `README.md`, or `ARCHITECTURE.md`)
- `frontend/src/components/GameTable.tsx`
- `frontend/src/styles/table.css`
- `frontend/src/__tests__/handPresentation.test.tsx`
- `frontend/src/__tests__/GameTable.test.tsx`

## Implementation Requirements
1. **Option B Large-Hand Layout & Constant Full Card Size (Items #2c, #5a, #5b):**
   - Measure the available play-area maximal box width (almost the full width of `[data-zone="table-arena"]` with small horizontal margins on both sides, via `ResizeObserver` / layout ref with sensible SSR/JSDOM fallback).
   - Never shrink hand card `width` or `height` (remove any CSS scale/width reduction for large hands).
   - Pass `CARD_INDEX_STRIP_WIDTH_PX` (from `Card.tsx`) as `minVisibleStripPx` into `handLayout.ts` so maximal allowable overlap always keeps the full-size `'10'` rank and enlarged suit indicator visible (Item #2c).
   - Also audit any other overlapping card renders in `GameTable.tsx` (such as opponent revealed hands in transparent mode) to respect the updated `'10'` rank visibility overlap limit where applicable.
   - Position hand cards using the exact `cardPositions` computed by `handLayout.ts` (Option B: 1–6 cards at minimum overlap inside the 6-card default box -> expand smoothly toward the maximal box as hand grows > 6 -> compress up to maximal allowable overlap inside the maximal box -> compress beyond maximal allowable overlap inside the maximal box for huge hands like 30–46 cards).
   - Ensure the hand lane spans cleanly across the play-area width without CSS Grid clipping or overflowing `[data-zone="table-arena"]` (respecting `AGENTS.md` CSS Grid/Flexbox rules — no `position: fixed` or freeform absolute placement of structural zones; cards within the hand track are positioned relative to the hand track itself).
2. **Smooth Hover-Parting Animation (Items #6a, #6b, #6c):**
   - Track `hoveredCardIndex: number | null` on `[data-zone="player-hand"]` via pointer events (`onPointerEnter` / `onPointerMove` / `onPointerLeave`), clearing hover cleanly on pointer leave AND freezing/clearing parting while a drag is active so dragging is unaffected.
   - When `myHand.length <= 1`, NEVER enable or animate hover-parting (Item #6c).
   - When `myHand.length > 1` and `hoveredCardIndex !== null`, pass `hoveredCardIndex` to `computePartedCardPositions(...)` from `handLayout.ts`:
     - The hovered card's horizontal position MUST NOT move (`deltaX === 0`, Item #6b).
     - Adjacent/nearby cards smoothly part outward (reduced overlap) while distant cards smoothly compress (increased overlap) within the maximal box (Item #6a).
   - Apply a smooth, GPU-friendly CSS transition on card horizontal/vertical transform (e.g., `transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1)`) when NOT actively dragging, so parting feels fluid and aesthetically clean. Disable transform transition on the actively dragged card so pointer tracking has zero lag.
   - Keep the tight non-rectangular hand highlight contour synchronized with the cards' rendered positions (including hover-parted positions and two-tier raises).
3. **Two-Tier Vertical Raise (Item #8):**
   - Replace the uniform vertical shift with `getCardVerticalLiftPx({ isEligible, isSelected })` from `handLayout.ts`:
     - Non-eligible & unselected card: `0px` vertical raise.
     - Eligible (playable) card, not selected: raised halfway to the current full raise level (`ELIGIBLE_LIFT_PX = FULL_SELECTED_LIFT_PX / 2`).
     - Selected card: raised fully to the current full raise level (`SELECTED_LIFT_PX = FULL_SELECTED_LIFT_PX`).
   - Ensure both `data-eligible` / `data-selected` attributes (or equivalent testable attributes/styles) and actual rendered vertical `transform: translateY(...)` reflect the two distinct tiers, and the tight non-rectangular hand contour hugs baseline, half-raised, and full-raised cards accurately.
4. **Fix Drag Horizontal Offset Bug (Item #3):**
   - Diagnose and eliminate the root cause of the horizontal offset that grows larger for cards farther to the right in the hand (common causes: double-applying card index x-offset + negative margin/layout offset, computing drag `left` relative to an offset container while adding `clientX`, subtracting `containerRect.left` instead of `cardRect.left`, or failing to capture the exact pointer grab offset `grabOffsetX = event.clientX - cardRect.left`, `grabOffsetY = event.clientY - cardRect.top` at `pointerdown`).
   - Implement exact 1:1 pointer tracking:
     - On `pointerdown`, capture the dragged card's live `cardRect = cardEl.getBoundingClientRect()` and pointer offset `(grabOffsetX = e.clientX - cardRect.left, grabOffsetY = e.clientY - cardRect.top)` (or exact pointer delta `(dx = e.clientX - startX, dy = e.clientY - startY)` applied cleanly on top of the card's fixed start position without any compounding index/layout offset).
     - On every `pointermove`, position the visible dragged card at exact viewport coordinates `(e.clientX - grabOffsetX, e.clientY - grabOffsetY)` (or exact `(startLeft + dx, startTop + dy)`), completely independent of the card's index in the hand, overlap step, scroll position, or hover-parting state!
     - Keep the dragged card 100% visible throughout the entire drag lifecycle (preserving previous round's visibility guarantee — never invisible while dragging!).
     - Ensure dragging leftmost, middle, and rightmost cards in 1-card, 6-card, 14-card, and 30-card hands produces `0px` horizontal drift between grab point and rendered card position.

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-2c:** Hand cards (and other overlapping card stacks) use the updated maximal allowable overlap (`CARD_INDEX_STRIP_WIDTH_PX`) so the full `'10'` rank and enlarged side suit indicator are completely visible whenever the hand is within maximal allowable overlap.
- [ ] **ITEM-3:** Clicking and dragging ANY card (leftmost, middle, rightmost, in 6-card, 14-card, or 30-card hands) tracks the mouse 1:1 with zero horizontal offset/drift throughout the drag lifecycle while remaining fully visible.
- [ ] **ITEM-5a:** Hand cards never decrease in size even in 14-card or 30-card hands.
- [ ] **ITEM-5b (Option B Override):** Hand layout in `GameTable.tsx` implements Option B: 1–6 cards stay within the default 6-card box at minimum overlap; >6 cards expand first toward the maximal box (almost full play-area width with small side margins); at the maximal box, overlap compresses up to maximal allowable overlap and then beyond maximal allowable overlap so full-size cards always fit without overflowing.
- [ ] **ITEM-6a:** Mousing over a multi-card hand plays a smooth CSS-animated parting effect reducing overlap near the hovered card and increasing overlap farther away.
- [ ] **ITEM-6b:** The card actually being moused over does NOT move horizontally or vertically due to the parting animation.
- [ ] **ITEM-6c:** When there is only 1 card in the hand, the parting animation does NOT play.
- [ ] **ITEM-8:** Eligible (playable) cards are vertically raised halfway to the current level, selected cards are raised fully to the current level, non-eligible cards stay at baseline, and the tight non-rectangular hand contour accurately wraps all three tiers.
- [ ] Add/update unit and integration tests in `frontend/src/__tests__/handPresentation.test.tsx` and `frontend/src/__tests__/GameTable.test.tsx` verifying two-tier lift values, hover-parting stationary hovered card & 1-card no-op, constant card size on 30-card hands, and zero drag horizontal offset on rightmost cards (e.g., index 0 vs index 5 vs index 29).
- [ ] Run `cd frontend && npm test -- --run` and verify all tests pass.
- [ ] Do NOT edit `GamePage.tsx`, `LobbyPage.tsx`, `ActionBar.tsx`, `actionIcons.css`, `backend/`, `README.md`, or `ARCHITECTURE.md`.
