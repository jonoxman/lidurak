<!-- WAVE:2 -->
# T-90-feedback-20261106_161731-4 — Frontend: Responsive Hand Overlap Layout, Tight Skyline Hand Outline, and Drag-Visibility Bug Fix

## Wave
WAVE 2. Depends on T-3 (the `--card-w`/`--card-h` tokens and `CARD_INDEX_*` ratios) and on T-1 (the `full-hand-4p` preset). T-5 (Wave 3) builds multi-select on top of this.

## Files Owned by This Ticket
- **New:** `frontend/src/components/handLayout.ts`: a pure layout and outline-path function.
- **New:** `frontend/src/components/PlayerHand.tsx`: the hand renderer, extracted from `GameTable.tsx`.
- `frontend/src/components/GameTable.tsx`: replace the inline hand and old highlight box with `<PlayerHand/>` in row 3, column 2 (`[data-zone="player-hand"]`). Fix the drag handlers.
- `frontend/src/components/Card.tsx`: only for drag-visibility fixes (`draggable`, drag classes).
- `frontend/src/styles/table.css`: hand-zone rules. **Delete** the old rectangular hand-highlight rules.
- **New:** `frontend/src/__tests__/handLayout.test.ts`. Update `GameTable.test.tsx` and `Card.test.tsx`.

## Do NOT Touch
`ActionBar.tsx`, icons, `actionIcons.css`, backend, `README.md`, `ARCHITECTURE.md`, `play-local.sh`. Do not change throw-in outline visibility or the Throw In button (T-5 does that).

## Implementation Spec

### A. Overlap algorithm (`handLayout.ts`)
`computeHandLayout({ count, containerWidth, cardW, cardH, indexW, indexH, raisedOffset, raised: boolean[], padding }) => { cards: {x, y, row}[], width, height, rows, step, rowStep, outlinePath }`
- Horizontal step `s` (the visible slice of each card) = `cardW × (1 − overlap)`.
  - `sMax = 0.80 × cardW` (overlap of 20% minimum, even with only 2–6 cards: cards always overlap by at least about 20%).
  - `sMin = max(0.20 × cardW, indexW)` (overlap of 80% maximum, but **never** hide the top-left rank+suit index; `indexW = CARD_INDEX_WIDTH_RATIO × cardW`).
  - Calculation: `cardsPerRowMax = floor((containerWidth − cardW) / sMin) + 1`. If `count ≤ cardsPerRowMax`, use a single row with `s = clamp((containerWidth − cardW)/(count − 1), sMin, sMax)`.
- **Wrapping (huge hands, for example 40+ cards in 4P):** if `count > cardsPerRowMax`, split into `rows = ceil(count / cardsPerRowMax)` balanced rows. Rows stack with vertical step `rowStep = max(indexH + 6px, 0.34 × cardH)`, so each row's top-left indexes stay visible above the row below. Later rows render on top.
- Each row is centered horizontally. Card order follows the current `SortBar` sort.
- Raised (playable) cards get `y −= raisedOffset` (keep the existing raise amount, about 18px on desktop and scaled on mobile).
- **Never overflow:** `width ≤ containerWidth` always. The hand height is reserved in the grid row (the row uses `auto`), so the hand never overlaps row 2 (the bout) or columns 1 and 3 (deck, `SortBar`, Pass/Surrender). No horizontal page scroll at any viewport width from 360px up.

### B. Rendering (`PlayerHand.tsx`), no absolute positioning
- Measure the container width with `ResizeObserver` and recompute on resize.
- Render rows as a flex column. Each row is a flex row. Cards after the first get `margin-left: calc(step − cardW)` (negative). Rows after the first get `margin-top: calc(rowStep − cardH)` (negative). Raised cards use `transform: translateY(−raisedOffset)` with the existing transition.
- **Outline overlay without absolute positioning:** wrap the cards and an `<svg data-testid="hand-outline">` in a CSS Grid container where both children share `grid-area: 1 / 1`. The SVG is `pointer-events: none`, sized to the computed `width`/`height` plus padding.

### C. Tight non-rectangular outline (replaces the old highlight box entirely)
- `outlinePath` = an SVG path that traces the **outer boundary of the union of all card rectangles**, each expanded by `padding` (about 6px), using each card's final `x, y` including the raise. A single row gives a "skyline": the top edge steps up over raised cards and back down. The bottom edge also follows raised cards when a run of raised cards lifts the hand bottom. Multiple rows give the union boundary across rows. No interior holes are needed.
  - Suggested approach: coordinate-compress the x/y edges, mark covered cells, then trace the boundary, merging collinear points.
  - Draw it with `stroke-linejoin="round"` and optionally rounded corners. Reuse the existing highlight color and glow from the theme. `fill="none"`.
- Render it as `<path data-testid="hand-outline-path" data-outline-shape="union">`.
- It is visible under the **same conditions** as the current active-player hand highlight (keep the existing condition, for example when the viewer is prompted). It must update immediately when any of these change: resize, hand count, sort order, the raised/playable set, POV switch (hotseat tabs in the left sidebar), card size breakpoint.
- The outline is computed from the same layout data used to place the cards, so it can never drift from the real card positions. While cards animate their raise, the path either animates with the same duration or snaps to the final positions. It must never lag permanently.
- Remove all old highlight-box CSS and markup and any previous fixed-size or rectangle specs for this component.

### D. Drag-visibility bug (New #2)
- Find the cause in the `GameTable.tsx` drag handlers, `Card.tsx`, and the `table.css` `.dragging` / `[data-dragging]` rules. Likely causes: `opacity: 0` / `visibility: hidden` on the source during drag, a `setDragImage` with an unpainted or offscreen element, or a transparent drag image.
- Required behavior: while a card is being dragged from the hand (for attack, cover, redirect, or throw-in onto any outline), **a full-opacity, full-size card preview follows the pointer**. The original card **stays rendered in the hand** (`opacity: 1`, `visibility: visible`, no `display: none`). It may get a non-hiding `data-dragging="true"` style such as a glow.
- If the drop is cancelled or invalid (Esc, or dropping off-target), the card stays visible in its original place. On a successful drop, it leaves the hand through the normal state update.
- The same rules apply on touch/pointer-based dragging if supported.

### E. QA preset usage
- Uses the T-1 preset **`full-hand-4p`** (Bob holds 40 cards with raised playable covers). Make sure it is reachable in 1 click from "⚡ QA Scenarios" in the Lobby and left sidebar. If T-1 did not add it to the frontend list, add the entry here.

## How the Human Tests It (under 15 seconds)
1. Click **"Full Hand (4P)"** in "⚡ QA Scenarios":
   - Bob's 40 cards wrap into balanced rows inside the hand column.
   - Every card's top-left rank and suit is visible.
   - Nothing goes off screen or overlaps the deck, `SortBar`, buttons or bout.
   - The outline hugs the hand and steps up around the raised playable cards.
2. Resize the window. The overlap and outline adapt live.
3. Switch POV to Alice (4 cards). The cards overlap by about 20% and the outline wraps tightly.
4. Drag any card. It stays visible while dragging, and a visible card follows the cursor.

## Tests
- `handLayout.test.ts`:
  - 2 cards in a wide container → `step = 0.8·cardW`
  - 40 cards → rows > 1, `step ≥ max(0.2·cardW, indexW)`, `width ≤ containerWidth`
  - mid-size hands → step clamped within `[sMin, sMax]`
  - outline path for 3 cards with the middle one raised contains the expected step-up vertices
  - multi-row path bounds equal the union bounds plus padding
- `GameTable.test.tsx` / `Card.test.tsx`:
  - `hand-outline` and `hand-outline-path` render with `data-outline-shape="union"`
  - the old highlight-box element/class is gone
  - after `fireEvent.dragStart` on a hand card (with a mocked `dataTransfer.setDragImage`), the card has no `opacity: 0` / `visibility: hidden` / `display: none` style or hiding class, and `setDragImage` (if used) is called with an element whose size matches the card
  - the card remains in the DOM after `dragEnd` without a drop
- Run `cd frontend && npm test -- --run`. Everything must pass.

## Mandatory Acceptance Criteria Checklist
- [ ] **(New Item #1, verbatim):** "The active player's hand highlight box doesn't match with or align to the player's actual card positions at all. Adjust the implementation, ignoring all past specs for this component, to make sure that the highlight box responsively wraps tightly around the hand at all times. This means that if certain cards are shifted upwards to be playable, the highlight box should distort accordingly to keep wrapped tightly around the hand as a whole ("box" is no longer the right word - the outline does not need to maintain a rectangular shape)."
  - [ ] The old highlight box is removed. It is replaced by the SVG union outline in `PlayerHand.tsx`, rendered in `GameTable.tsx` row 3, column 2 `[data-zone="player-hand"]`.
  - [ ] The outline is built from the same layout data as the cards and follows raised playable cards (non-rectangular).
  - [ ] It updates on resize, hand changes, sort, playable-set changes and POV switches.
- [ ] **(New Item #2, verbatim):** "Bug: Clicking and dragging a card makes it invisible. Cards should be displayed at all times (aside from overlap rules as we have defined), regardless of if they are bing dragged or not."
  - [ ] The source card stays visible during drag. A full-opacity, full-size preview follows the pointer.
  - [ ] Cancelled or invalid drops leave the card visible in place.
- [ ] **(New Item #3, verbatim):** "Arrange the cards in the active user's hand subject to the following constraints: all cards should overlap by 20% of their width at minimum and by 80% of their width at maximum. (These percentages are approximate - adjust them as needed to make sure that the left-side rank symbol and suit is always visible on every card, and so that even if a player picks up every card into their hand, the hand won't look wrong graphically (i.e. go off screen or overlap UI elements)). Keep in mine New Item #1 when implementing this, and vice versa."
  - [ ] Overlap is clamped to about 20%–80%. The maximum overlap is reduced further if needed so the top-left index is always visible.
  - [ ] Huge hands wrap into balanced rows with the indexes visible. Nothing goes off screen or overlaps other UI zones, and nothing scrolls horizontally.
  - [ ] Layout and outline come from the single `computeHandLayout` source, so they always agree.
  - [ ] The 1-click `full-hand-4p` QA preset is available in the Lobby and the left sidebar.
- [ ] No `position: absolute/fixed`. The overlay uses grid-area stacking, flex and `gap`.
- [ ] `npm test -- --run` passes.

## Agent Workflow Reminders
1. Start with `git status` and `git diff`.
2. No `git commit`, `git checkout` or `git branch`.
3. Write a summary to `.reviews/agent_notes.md`, including the drag-bug root cause.
4. Final step, only after all tests pass: `echo "DONE" > .tickets/STATUS`

