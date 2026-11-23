<!-- WAVE:2 -->
# Ticket `T-90-feedback-20261104_195410-2`: Hand Reorder Gap-Close/Part Animation, Pointer Finger Drag Cursor, Always-Visible Throw-In Outline, Hand Outline & 10% Card Overlap, and Smooth Glow Animations

## Summary
Implement the interactive hand-reordering animation, cursor behavior, throw-in outline visibility, card overlap/hand-outline geometry, and smooth glow animation fixes from human QA feedback items **#6**, **#7**, **#8**, **#13 (`13a`, `13b`, `13c`)**, and **#15**:
1. Fix the manual hand reorganization animation so that when a card is dragged away from its original position, the remaining cards in the hand first move together to **close the gap** at its original slot (as if the card was removed from the hand entirely), and then smoothly **move apart to create a gap** at whichever position the card is dragged into within the hand.
2. Fix the mouse cursor so that hovering over a hand card and dragging it anywhere across the hand or table keeps the link-hovering **pointer finger** (`cursor: pointer`) active throughout the entire drag gesture (never reverting to the standard arrow pointer).
3. Display the "next card" throw-in outline (`[data-testid="throw-in-outline"]`) next to the current played cards during an ongoing attack (`tablePairs.length > 0`) **even if players don't have any cards they can legally place into it**.
4. Fix the active user's hand-highlighting outline (`.hand-cards`) so it **perfectly encompasses all `100px × 140px` cards**, and adjust the card layout in both the active user's hand AND inside non-active users' opponent player boxes so cards overlap by **at least ~10% of the card width at minimum**.
5. Fix the glitchy/jerky highlight glow animation on incoming uncovered cards (`.table-card-uncovered`) and audit all other glow elements across the UI so every glow pulse and entry transition is smooth and bug-free.

---

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-6 — Two-Stage Hand Reorganization Animation (Close Original Gap + Part at Target Insertion Slot):**
  - *Verbatim feedback:* "6. The function works correctly, but the animation is off. Set it up so that when the dragged card is moved away from its original position, the other cards move to close the gap (as if the card has been taken out of the hand entirely). After this, the cards should move apart to create gaps as is currently being done when the card is dragged into their position."
  - **End-to-End Wiring (`frontend/src/components/GameTable.tsx`, `frontend/src/styles/table.css`):**
    - In `frontend/src/components/GameTable.tsx`, when a card at `draggedIndex` is being dragged (`dragState !== null`) and the pointer has moved away from its starting threshold:
      1. **Close the original gap:** Treat the remaining `N - 1` non-dragged cards as a compacted sequence `0 .. N - 2` (and collapse the dragged card's in-hand wrapper slot in layout—e.g. `width: 0; margin-left: 0; opacity: 0; pointer-events: none; overflow: visible` or compute each remaining card's horizontal offset from its compacted index `compactedIdx = idx < draggedIndex ? idx : idx - 1` using the `N - 1` hand step)—so the cards to the right/left of `draggedIndex` smoothly slide together to close the gap where the dragged card used to be, exactly as if the card has been taken out of the hand entirely (`data-gap-closed="true"` on `.hand-cards`).
      2. **Part at the target insertion position:** While the dragged card is hovering over the hand (`reorderTargetIndex !== null`), open a clear insertion gap at `reorderTargetIndex` among the compacted cards by shifting cards before the insertion slot left (`data-part-direction="left"`, e.g. `translateX(-22px)`) and cards at/after the insertion slot right (`data-part-direction="right"`, e.g. `translateX(22px)`), or by inserting a gap offset at `reorderTargetIndex` with a smooth CSS transition (`transition: transform 160ms cubic-bezier(0.22, 1, 0.36, 1), margin-left 160ms cubic-bezier(0.22, 1, 0.36, 1)`).
      3. When the dragged card is moved outside the hand onto the battlefield (`reorderTargetIndex === null`), all remaining `N - 1` cards stay smoothly closed with no gap in the hand (`data-part-direction="none"`).
      4. Releasing the card inside the hand drops it into `reorderTargetIndex` and sets the sort mode to `'custom'` (reflected in the `SortBar` dropdown from Ticket 1).

- [ ] **ITEM-7 — Link-Hovering Pointer Finger (`cursor: pointer`) Throughout the Entire Drag Process:**
  - *Verbatim feedback:* "7. This is still not correct - with this latest change, the cursor now looks like the standard mouse pointer, instead of the link-hovering pointer finger."
  - **End-to-End Wiring (`frontend/src/components/GameTable.tsx`, `frontend/src/components/Card.tsx`, `frontend/src/styles/table.css`, `frontend/src/app.css`):**
    - Diagnose and eliminate every reason why the browser reverted to the standard arrow cursor during card hover or drag:
      1. Prevent native HTML5 drag-and-drop hijacking: add `draggable={false}` and `onDragStart={(e) => e.preventDefault()}` on `.hand-card-wrapper`, `.playing-card`, and `<svg>` elements inside cards.
      2. When a drag starts (`onPointerDown` / `onMouseDown`), set `document.body.setAttribute('data-dragging', 'true')` and `document.documentElement.setAttribute('data-dragging', 'true')` immediately (and clear both on `pointerup` / `pointercancel` / `mouseup` / unmount). If `setPointerCapture` is used, ensure the capturing element has `cursor: pointer !important`.
      3. Ensure `.drag-ghost` has `pointer-events: none` so it never intercepts hit-testing with a default cursor.
      4. In `frontend/src/styles/table.css` and `frontend/src/app.css`, enforce `cursor: pointer !important` on:
         - `.hand-card-wrapper, .hand-card-wrapper *, [data-zone="player-hand"] .playing-card, [data-zone="player-hand"] .playing-card *` (so hovering any part of a hand card—including SVG `<rect>`, `<text>`, `<g>`—always shows the pointer finger).
         - `html[data-dragging="true"], html[data-dragging="true"] *, body[data-dragging="true"], body[data-dragging="true"] *, .table-arena[data-dragging="true"], .table-arena[data-dragging="true"] *` (so throughout the entire drag across the hand, felt table, battlefield, opponent boxes, or sidebars, the cursor remains the link-hovering pointer finger `pointer`).

- [ ] **ITEM-8 — Always Display the "Next Card" Throw-In Outline (`throw-in-outline`) During an Ongoing Attack:**
  - *Verbatim feedback:* "8. This outline should still display even if players don't have any cards they can legally place into it."
  - **End-to-End Wiring (`frontend/src/components/GameTable.tsx`, `frontend/src/styles/table.css`):**
    - In `frontend/src/components/GameTable.tsx`, update the visibility condition for `[data-testid="throw-in-outline"]` so that whenever an attack is currently going on (`tablePairs.length > 0` and `phase !== 'GameOver'` and `tablePairs.length < 6`), the dashed `[data-testid="throw-in-outline"]` (`100px × 140px`) is **always rendered** in the next slot immediately to the right of the current played cards (`tablePairs`), **even when the viewing player (or any player) has zero legal throw-in cards in hand** (`legalThrowInCardIds.size === 0`) or is the defender/spectator.
    - Keep the drag-to-throw-in drop validation intact: dragging a legal throw-in card onto `[data-testid="throw-in-outline"]` (or double-clicking it) plays the throw-in card, whereas dragging an illegal card (or when it is not your turn to throw in) onto the outline is rejected and returns to the hand.
    - Ensure `computeBoutLayout` always accounts for the rendered `throw-in-outline` slot whenever `tablePairs.length > 0 && phase !== 'GameOver' && tablePairs.length < 6` so all played pairs + `throw-in-outline` (+ `redirect-outline` when applicable) stay on a single non-wrapping row with `>= 22px` minimum visible left strip.

- [ ] **ITEM-13a — Fix Active User's Card-Highlighting Outline (`.hand-cards`) to Perfectly Encompass All `100px × 140px` Cards:**
  - *Verbatim feedback:* "13. The cards look correct, but the card-highlighting outline for the user broke again. Adjust it so that it perfectly encompasses all of the cards."
  - **End-to-End Wiring (`frontend/src/components/GameTable.tsx`, `frontend/src/styles/table.css`):**
    - Inspect `.hand-cards` and `.hand-card-wrapper` in `frontend/src/components/GameTable.tsx` and `frontend/src/styles/table.css`.
    - Ensure `.hand-cards` is `display: inline-flex; align-items: center; box-sizing: content-box;` (or accurately sized `box-sizing: border-box` with explicit height matching the `140px` card height + symmetric padding) with **no fixed legacy height** (such as `112px` or `120px` from before the 25% increase) and **no clipped overflow** (`overflow: visible`), and that `.hand-card-wrapper` has exact dimensions `width: 100px; height: 140px; flex: 0 0 100px;` so the `.hand-cards` container width equals the exact visual span of the overlapped cards (`100 + (visibleCount - 1) * step`) and its height equals `140px` (plus a symmetric `6px` padding on all four sides: `padding: 6px`).
    - When `data-highlighted="true"` is active on `.hand-cards`, the border and pulsing glow must tightly and symmetrically wrap the entire `100px × 140px` card row on all four sides (top, right, bottom, left) without cutting through the bottoms/tops of the cards or extending into empty space.

- [ ] **ITEM-13b — Minimum ~10% Card-Width Overlap in the Active User's Hand:**
  - *Verbatim feedback:* "Additionally, in the hand, keep the cards closer together - they should overlap by about 10% of the card width at minimum, to mimic how cards are actually held in a hand."
  - **End-to-End Wiring (`frontend/src/components/GameTable.tsx`, `frontend/src/styles/table.css`):**
    - In `frontend/src/components/GameTable.tsx` (`computeHandLayout` / `DEFAULT_HAND_OVERLAP_PX`), update the minimum default overlap for the `100px`-wide active hand cards to **at least 10% of the card width**: `10px` minimum overlap (`marginLeft = -10px`, i.e. maximum `step = 90px` when space is abundant, `data-min-overlap-ratio="0.10"`).
    - When the hand holds more cards than can fit at `10px` overlap (`step = 90px`), continue tightening the overlap smoothly down to the `22px` minimum visible left strip (`step >= 22px`, `overlap <= 78px`) before engaging overflow stacks.
    - Apply the same `>= 10%` minimum overlap (`>= 10px` on `100px` cards) to the visible face-up discard row if it shares `computeHandLayout`.

- [ ] **ITEM-13c — Minimum ~10% Card-Width Overlap Inside Non-Active Users' Opponent Player Boxes:**
  - *Verbatim feedback:* "Make this same change also for the cards inside the non active user's player boxes."
  - **End-to-End Wiring (`frontend/src/components/GameTable.tsx`, `frontend/src/styles/table.css`):**
    - In `frontend/src/components/GameTable.tsx` (`computeOpponentHandOverlap` / opponent card row rendering for both face-down `CardBack` mini-cards and Transparent Mode's face-up `opponent-low-detail-card` mini-cards), ensure that adjacent cards inside `.opponent-seat` / `.opponent-hand-cards` **always overlap by at least 10% of the opponent mini-card width at minimum** (for example, on `44px` wide opponent mini-cards, minimum overlap is `>= 5px`, i.e., `marginLeft <= -5px` / `step <= 39px`, never a positive gap or `0px` overlap even when holding only 2–6 cards), and tighten further as the opponent holds more cards so the entire opponent hand stays centered and contained inside the opponent box.

- [ ] **ITEM-15 — Smooth Highlight Glow Around Incoming Cards & Audit All Glow Elements:**
  - *Verbatim feedback:* "15. The highlight glow around incoming cards has a slight glitchy and jerky visual effect to it. Fix this, make sure that the animation is smooth with no bugs. Also double-check that this doesn't happen to other glow elements I didn't notice in testing."
  - **End-to-End Wiring (`frontend/src/components/TablePair.tsx`, `frontend/src/components/GameTable.tsx`, `frontend/src/styles/table.css`, `frontend/src/app.css`):**
    - Identify and fix the root causes of the glitchy/jerky glow on incoming uncovered attack cards (`.table-card-uncovered` in `TablePair.tsx` / `table.css`) and all other glow elements:
      1. **Separate entry transform animation from pulsing glow animation:** When an attacking card enters the table (`TablePair.tsx`), do NOT put a `card-enter` animation on the same element that runs `uncovered-pulse` (or combine conflicting `animation` / `transition: all` declarations that cause the browser to snap or cancel `box-shadow` keyframes when entry finishes). Instead, apply any card entry transition to the outer `.table-pair` / `.table-pair-attack-slot` wrapper (or use clean non-overlapping properties) while `.table-card-uncovered` runs a dedicated, continuous `uncovered-pulse` `box-shadow` animation with `transition: border-color 150ms ease` (never `transition: all` or `transition: box-shadow` on an element with an active `box-shadow` `@keyframes` animation!).
      2. **Matched `@keyframes` shadow layers:** Audit every `@keyframes` glow rule in `frontend/src/styles/table.css` and `frontend/src/app.css` (`uncovered-pulse`, `hand-glow-pulse`, `target-pulse`, `redirect-pulse`, `urgent-clock-pulse`, opponent/player role glows). Ensure that the `0%, 100%` keyframe and the `50%` keyframe have the **exact same number and order of `box-shadow` layers** (with `inset` layers in identical positions) so the browser interpolates every shadow layer smoothly at 60fps without discrete mid-frame snapping.
      3. **Stable DOM keys:** Ensure `TablePair` in `GameTable.tsx` uses a stable key based on the attack card ID (`pair.attack.id`) rather than array index alone, and that WebSocket state refreshes / clock ticks do not unmount and remount `.table-card-uncovered`, `.hand-cards`, `.target-outline`, `.throw-in-outline`, `.redirect-outline`, `.opponent-seat`, or `.status-badge` DOM nodes.

---

## Testing & Verification Requirements
- Update and run the frontend Vitest suite (`cd frontend && npm test -- --run`):
  - `GameTable.test.tsx`:
    - Verify dragging a hand card away from its initial slot closes the original gap (`data-gap-closed="true"`) and hovering over another slot parts the cards (`data-part-direction="left"|"right"`).
    - Verify `cursor: pointer` and `data-dragging="true"` on `document.body` / `document.documentElement` during card drag, plus `draggable={false}` on hand cards.
    - Verify `[data-testid="throw-in-outline"]` is rendered whenever `tablePairs.length > 0` during an active bout, even when the viewer has no legal throw-in cards in hand.
    - Verify `.hand-cards` dimensions/attributes wrap `100px × 140px` cards cleanly and that active hand cards and opponent box mini-cards overlap by at least 10% of their card width (`marginLeft <= -10px` for `100px` hand cards; `marginLeft <= -Math.round(opponentCardWidth * 0.1)` for opponent cards).
    - Verify `.table-card-uncovered` and other glow elements have smooth, non-conflicting animation rules and stable keys.
