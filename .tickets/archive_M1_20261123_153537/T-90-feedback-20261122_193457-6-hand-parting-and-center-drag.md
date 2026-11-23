<!-- WAVE:3 -->
# T-90-feedback-20261122_193457-6: Smooth GPU-Composited Hand Parting (Item 6) & Center-Locked Card Dragging (Item 3)

## Objective
Integrate Wave 1's updated `handLayout.ts` into `GameTable.tsx`, `Card.tsx`, and `table.css` to deliver:
1. **Item 6:** Smooth, non-choppy 60fps hand mouseover parting animation that works on small hands (`2..6` cards) as well as medium (`14`) and large (`30`) hands, keeps the hovered card stationary, and stays disabled for 1-card hands.
2. **Item 3:** Pixel-perfect center-locked card dragging where the exact geometric center of the dragged card is locked to the mouse cursor `(clientX, clientY)` regardless of which part of the card was clicked, regardless of the card's index in the hand, and regardless of any active parting transform.

## Scope & Owned Files
- `frontend/src/components/GameTable.tsx`
- `frontend/src/components/Card.tsx` (only if needed for drag-preview rendering or pointer/draggable attributes)
- `frontend/src/styles/table.css`
- `frontend/src/__tests__/handPresentation.test.tsx`
- `frontend/src/__tests__/GameTable.test.tsx`
- **DO NOT** revert Wave 2's Item 1 (covered-pair edge collapsing) or Item 4 (non-overlapping surrender turn timer) changes in `GameTable.tsx` and `table.css`.
- **DO NOT** touch `README.md`, `ARCHITECTURE.md`, or backend files.

## Technical Design & End-to-End Wiring Requirements

### Part A — Item 6: Smooth, Non-Choppy Hand Parting Across All Multi-Card Hands (`GameTable.tsx`, `table.css`)
1. **Consume Wave 1's `handLayout.ts` Parting Deltas & Small-Hand Overlap:**
   - Render resting card spacing using the updated `handLayout.ts` resting positions (so `2..6` card hands have slightly increased resting overlap with explicit expansion headroom, while still exposing `>= 36px` rank+suit index strips and never shrinking card size).
   - Apply horizontal parting exclusively via GPU-composited `transform: translate3d(${partDeltaX}px, ${verticalLiftY}px, 0)` (NEVER animate `margin-left`, `left`, or layout widths on hover!).
2. **Eliminate Choppiness & Hover Flicker:**
   - Add `will-change: transform` and a smooth easing transition on hand card wrappers in `table.css` (e.g., `transition: transform 200ms cubic-bezier(0.22, 1, 0.36, 1)` — smooth, responsive, zero stuttering; disable transition only on the active drag preview itself so dragging tracks the cursor with 0ms lag).
   - Eliminate inter-card hover flicker: handle hover tracking stably across `[data-zone="player-hand"]` (e.g., `onMouseMove` / `onPointerMove` over the hand container resolving the topmost card at `clientX` using stable hit-testing or card `onMouseEnter` WITHOUT clearing `hoveredIndex` to `null` on individual card `onMouseLeave` — only reset `hoveredIndex` to `null` on the hand container's `onMouseLeave`!).
   - Coalesce high-frequency pointer updates if using continuous pointer coordinates (via `requestAnimationFrame` or index-deduplicated state updates) so React does not thrash the main thread during mouse sweeps.
   - Verify:
     - When `myHand.length === 1`: parting delta is strictly `0px` and no parting animation runs.
     - When `myHand.length >= 2` (including 2, 3, 4, 5, 6, 14, and 30 cards): hovering card `i` smoothly parts its neighbors while card `i` itself remains strictly stationary (`partDeltaX[i] === 0`).
     - During an active card drag, suppress distracting parting jitter or keep the hand stable until drag ends.

### Part B — Item 3: Center-Locked Card Dragging with Zero Cursor Offset (`GameTable.tsx`, `Card.tsx`, `table.css`)
1. **Why Previous Drag Still Misaligned:**
   - Native browser `dataTransfer.setDragImage(e.currentTarget, x, y)` suffers from browser-specific coordinate drift when the dragged card wrapper has CSS transforms (`translate3d` from parting/lift), negative margins, overlapping siblings, or when grab-point offsets (`clientX - rect.left`) are preserved instead of centering.
2. **Exact Center-Lock Implementation:**
   - Regardless of where on the card the user clicks (leftmost `36px` strip, top-left corner, bottom-right corner, or dead center), and regardless of the card's index (`0` through `29`) or current parting transform, the **exact geometric center of the dragged card (`cardWidth / 2`, `cardHeight / 2`)** MUST lock directly onto `(clientX, clientY)` from the instant dragging begins until drop/cancel!
   - Implement a clean, browser-independent center-locked drag preview while keeping all existing HTML5 drag-and-drop drop targets (`onDragOver`, `onDrop` on table, uncovered `TablePair`s, `target-outline-*`, `redirect-outline`) 100% functional:
     - On `dragstart`:
       - Call `e.dataTransfer.setDragImage(transparent1x1Pixel, 0, 0)` (cached 1×1 transparent `<canvas>`/`Image`) to suppress the browser's quirky, offset-prone native drag ghost completely.
       - Record the dragged card + exact rendered card dimensions (`width`, `height`, e.g., `100×140` desktop or `48×68` mobile) and initial pointer coordinates `(e.clientX, e.clientY)` in state/ref.
     - Render a transient floating drag-preview element (`data-testid="drag-card-preview"`, containing the untransformed `<Card />` at exact `width × height` with `pointer-events: none; z-index: 9999; transition: none;`) positioned so its **exact center** is always `(clientX, clientY)`:
       - `left: 0; top: 0; transform: translate3d(${clientX - width / 2}px, ${clientY - height / 2}px, 0);` (Note: this is ONLY a transient cursor-following drag preview while `draggingCard != null`, never used to position seats, hands, bouts, or sidebars — all layout zones strictly remain CSS Grid/Flexbox).
     - Update the preview's `(clientX, clientY)` smoothly via a `window`-level `dragover` listener (and `drag` listener ignoring browser end-of-drag `(0, 0)` sentinel events!) using direct DOM transform update (ref-based for 0-lag 60fps cursor tracking without React re-renders on every mouse pixel!) and clear the preview cleanly on `dragend`, `drop`, or Escape/cancel.
     - Also handle click-and-drag via `mousedown`/`pointerdown` pre-capture if needed so even before the first `dragover` fires, the preview immediately centers on the initial click coordinates `(clientX, clientY)`.
     - Verify edge cases:
       - Clicking the far-left `5px` edge of card index `0`, index `5` (6-card hand), index `13` (14-card hand), or index `29` (30-card hand): preview center `(previewRect.left + previewRect.width / 2, previewRect.top + previewRect.height / 2)` equals `(clientX, clientY)` within `<= 1px` horizontally AND vertically!
       - Clicking the bottom-right corner of a card: preview center STILL equals `(clientX, clientY)` within `<= 1px`!
       - Dragging a card while the hand is actively parted by mouseover: preview center STILL equals `(clientX, clientY)` with zero parting-offset drift!
       - Dropping onto uncovered `TablePair` (preserving original `attackIndex`), `target-outline-*`, `redirect-outline`, and the table attack/throw-in zone all execute the exact expected legal move and cleanly dismiss the drag preview.

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-3 (Verbatim):** "Compared to the previous version it seems somewhat better, but still there are cases where the mouse cursor and card are not aligned correctly. The center of the card should be perfectly locked to the mouse cursor when clicked, regardless of which part of the card was actually clicked on." — Dragging any card from `[data-zone="player-hand"]` renders `[data-testid="drag-card-preview"]` with its exact geometric center `(width / 2, height / 2)` locked to `(clientX, clientY)` (`<= 1px` tolerance) regardless of click position on the card, hand index (`0..29`), hand size (`1, 6, 14, 30`), viewport (`1440×900` or `375×812`), or active parting transform, with zero browser native ghost drift.
- [ ] **ITEM-6a (Verbatim):** "The animation looks correct, but seems a little choppy. Try to make it smoother if possible." — Hand parting animates exclusively via GPU-composited `transform: translate3d(...)` with smooth cubic-bezier easing, `will-change: transform`, and flicker-free hand-container hover tracking; the hovered card stays strictly stationary (`0px` horizontal shift) and 1-card hands do not animate.
- [ ] **ITEM-6b (Verbatim):** "Additionally, currently the animation does not play with a small hand (of 6 cards or less). If the reason is because the parting effect cannot separate cards past their minimum degree of overlap, make the default overlap for the hand a little larger than the minimum so that there is some margin to expand to for the sake of this animation specifically." — Hovering any card in a small hand (`2..6` cards, including `qa-normal-6-actions`) visibly and smoothly parts adjacent cards using the increased default resting overlap margin, while keeping full `'10'` rank & suit visible and preserving fixed `100×140` / `48×68` card sizes.
- [ ] Wave 2's Item 1 (single-row edge-snapped covered pairs) and Item 4 (non-overlapping turn timer during surrender) remain completely intact with zero regressions.
- [ ] Unit/component tests added/updated in `frontend/src/__tests__/handPresentation.test.tsx` and `frontend/src/__tests__/GameTable.test.tsx` verifying:
  - Small hand (6 cards and 3 cards) visibly parts on hover while keeping hovered card stationary; 1-card hand does not part.
  - Hand cards use GPU-composited `transform: translate3d(...)` transitions rather than animating layout properties.
  - Dragging cards at index `0`, middle, and rightmost index from off-center click points (e.g., top-left corner, left strip, bottom-right corner) locks `[data-testid="drag-card-preview"]` center directly to `(clientX, clientY)` with zero offset.
- [ ] Run `npm test -- --run` in `frontend/` and verify all tests pass.
- [ ] Write a concise summary to `.reviews/agent_notes.md` and run `echo "DONE" > .tickets/STATUS` only after all tests pass.
