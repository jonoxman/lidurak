<!-- WAVE:3 -->
# T-90-feedback-20261106_111512-4 — Frontend: tight silhouette hand outline, responsive overlap layout, drag/double-click/multi-select throw-in

## Dependencies
- Wave 1 `-1-backend`: `throwInCards`, `throwInCapacity`, `canThrowIn`, atomic multi-card `ThrowInCards`, presets.
- Wave 1 `-2`: Throw In button removed.
- Wave 2 `-3`: card tokens, outline gating, drag visibility.

New #1 and New #3 must be designed **together**, as the feedback requires.

## Files owned by this ticket
- `frontend/src/components/GameTable.tsx`: the `[data-zone="player-hand"]` section. You may extract it into a new `frontend/src/components/PlayerHand.tsx`.
- New: `frontend/src/components/handLayout.ts`, a pure layout function
- `frontend/src/components/Card.tsx`: only the corner-index geometry and an index-strip CSS variable
- `frontend/src/styles/table.css`: the hand section and Row 3 sizing
- `frontend/src/pages/GamePage.tsx`: wire the multi-card throw-in to the existing throw-in send path / websocket action
- Tests:
  - new `frontend/src/__tests__/handLayout.test.ts`
  - `GameTable.test.tsx`
  - `GamePage.test.tsx`

**Do NOT touch:** `backend/`, action icon components, outline visibility gating (done in `-3`), `README.md`, `ARCHITECTURE.md`, `play-local.sh`.

## Implementation Spec

### A. Hand layout (New #3), in `handLayout.ts`

```ts
computeHandLayout({ count, availableWidth, cardW, cardH, indexStripW, indexStripH, liftPx }) =>
  { rows: number[][], step: number, rowStep: number, totalWidth: number, totalHeight: number }
```

- `availableWidth` is the measured content width of `[data-zone="player-hand"]`, via `ResizeObserver`, re-run on resize.
- `indexStripW` is the width of the top-left rank + suit index plus ~4px padding. Expose it from `Card.tsx` as `--card-index-strip` (≈ 22px at 100px width, ≈ 12px at 48px).

Constants:
- `maxStep = 0.8·cardW` → overlap is at least 20%.
- `minStep = max(0.2·cardW, indexStripW)` → overlap is at most ~80%, reduced further only if the index needs more room.

Rules:
1. `count = 1`: one card, centered.
2. `step = min(maxStep, (W − cardW)/(count−1))`. If `step ≥ minStep`, use a **single row**, centered.
3. Otherwise, wrap into the smallest number of rows `r` such that `perRow = ceil(count/r)` fits at `minStep`.
   - Recompute `step` per row with the same formula.
   - Rows stack with `rowStep = indexStripH + 8px` (≈ 30% of `cardH`), so every back-row card's top-left index stays visible.
   - Later rows are in front.
4. Fallback, only if `r` rows would exceed the height cap (`cardH + 2·rowStep + lift`): apply `--hand-card-scale` (≥ 0.75) to hand cards only.

Placement:
- Use a flex row with negative `margin-left: calc(step − cardW)` per card, and negative `margin-top` per row. Raise cards with `transform: translateY(...)`.
- **No `position: absolute/fixed`.**
- DOM order is left → right, so each card's left index stays visible.
- Sort order (from `SortBar`) is preserved.

Space:
- Row 3 reserves `totalHeight` (including lift), so the hand **never overlaps Row 2 bout cards, Col 1 deck/trump or Col 3 SortBar/buttons**.
- It never overflows the viewport horizontally and never shows a scrollbar.
- Check this with the `huge-hand-36` and `huge-hand-52` presets on desktop and in a narrow (< 900px) window.

### B. Tight hand outline (New #1)
Ignore all previous specs for this highlight.
- Delete the rectangular highlight box: no border, outline, box-shadow or fixed-size element around the hand container.
- Show the highlight under the **same condition as today** (when the POV player is active or prompted).
- Implement it as a **silhouette outline** on the transparent hand-fan wrapper `[data-testid="hand-outline"]` with `data-outline="silhouette"`:
  - a chained `filter: drop-shadow(1.5px 0 0 var(--hand-outline-color)) drop-shadow(-1.5px 0 0 …) drop-shadow(0 1.5px 0 …) drop-shadow(0 -1.5px 0 …) drop-shadow(0 0 6px <glow>)`
  - the wrapper itself has no background, border or padding
- The outline then follows the exact union of the card shapes, including:
  - playable cards raised upward
  - selected cards raised further
  - hover lift and multi-row wraps
  - resizes
- An acceptable alternative is an SVG skyline path computed from `computeHandLayout`, rendered in the same grid cell (still no absolute positioning).

### C. Throw-in interactions (New #4)
These are active only when `view.canThrowIn` is true. Legal cards are those in `view.throwInCards`.

1. **Highlighting:** legal cards get the playable lift (`data-playable="true"`). Clicking an illegal card does nothing (no text banner).
2. **Single click** on a legal card toggles `data-selected="true"`, with extra lift and an accent ring. The silhouette outline follows.
   - Selection is capped at `view.throwInCapacity`. A click past the cap shows a brief deny wiggle and does not add the card.
3. **Double-click** on a legal card deploys `selection ∪ {that card}` as **one** `ThrowInCards(myId, cards)` action, through the existing throw-in send path in `GamePage.tsx`.
   - Handle the click events that come before a dblclick: ignore `click` events with `event.detail ≥ 2`. The first click's toggle is compensated by the union.
4. **Drag onto `[data-testid="throw-in-outline"]`:**
   - If the dragged card is selected, deploy the whole selection.
   - If not, deploy only that card.
5. Clear the selection after deploy, on POV switch, on phase change, or when `canThrowIn` becomes false. On every view update, drop selected cards that are no longer legal.
6. **No regressions:** initial-attack selection, cover-by-drag/click, redirect via `redirect-outline` and chaos targeting must behave exactly as before. Add regression tests.
7. No "Throw In" button may exist.

## Required Tests
- **`handLayout.test.ts`:** for `count ∈ 1..52`, `W ∈ {320, 480, 640, 900, 1200}`, desktop and mobile card sizes:
  - overlap stays in `[20%, max(80%, 1 − indexStripW/cardW)]`
  - the visible strip per card is ≥ `indexStripW`
  - `totalWidth ≤ W`
  - minimal rows
  - height ≤ the cap (with the scale fallback applied)
- **`GameTable`:**
  - `hand-outline` has `data-outline="silhouette"`, and the old rectangular highlight element or class is gone
  - legal and illegal card marking
  - click toggles selection
  - the capacity cap is enforced
  - a dblclick sends one action with all selected cards plus the clicked card
  - dragging a selected card to the outline sends the whole selection; dragging an unselected card sends one card
  - `event.detail` handling works
- **`GamePage`:** a multi-card throw-in reaches the websocket with a `cards` array.

## QA (human, < 15 s)
1. ⚡ `Throw-In Visibility (4P)` as Alice:
   - Click `7♥`, then `7♦` (both rise), then double-click `9♦` → all 3 land on the table in one move.
   - The outline hugs the raised cards.
2. ⚡ `Throw-In Capacity Cap`: only 2 cards can be selected.
3. ⚡ `Huge Hand (36)` / `Huge Hand (52)`:
   - Every card's corner rank and suit are visible.
   - Nothing is off screen or overlapping the deck, the buttons or the bout.
   - The outline wraps the hand tightly.
4. ⚡ `Surrender Half-Off` as Bob: the raised playable cards distort the outline.

## Mandatory Acceptance Criteria Checklist
- [ ] **New #1 (verbatim):** "The active player's hand highlight box doesn't match with or align to the player's actual card positions at all. Adjust the implementation, ignoring all past specs for this component, to make sure that the highlight box responsively wraps tightly around the hand at all times. This means that if certain cards are shifted upwards to be playable, the highlight box should distort accordingly to keep wrapped tightly around the hand as a whole ("box" is no longer the right word - the outline does not need to maintain a rectangular shape)."
  - [ ] Wired in `GameTable.tsx` / `PlayerHand.tsx` at `[data-zone="player-hand"]` → `[data-testid="hand-outline"]`.
- [ ] **New #3 (verbatim):** "Arrange the cards in the active user's hand subject to the following constraints: all cards should overlap by 20% of their width at minimum and by 80% of their width at maximum. (These percentages are approximate - adjust them as needed to make sure that the left-side rank symbol and suit is always visible on every card, and so that even if a player picks up every card into their hand, the hand won't look wrong graphically (i.e. go off screen or overlap UI elements)). Keep in mine New Item #1 when implementing this, and vice versa."
  - [ ] `handLayout.ts` is consumed by the hand in `GameTable.tsx`. Verified with `huge-hand-36` and `huge-hand-52`.
- [ ] **New #4 (verbatim):** "Remove the "Throw In" button. Instead, cards can be thrown in by dragging them to the additional card outline or double clicking. To throw in multiple cards at once, the player can click to select multiple legal cards to throw in, and then double-click to deploy them all at once."
  - [ ] Wired from hand handlers in `GameTable.tsx` → the `GamePage.tsx` throw-in send path → backend `GameEngine.applyThrowInCards` (atomic multi-card).
- [ ] No absolute/fixed positioning. No text banners. `min-width: 0; box-sizing: border-box`.
- [ ] `npm test -- --run` passes.

## Workflow (AGENTS.md)
1. Run `git status` and `git diff` first.
2. No git commits, checkouts or branches.
3. Run `cd frontend && npm test -- --run` and fix all failures. Also run `cd backend && sbt -batch test` to confirm nothing regressed.
4. Write a summary to `.reviews/agent_notes.md`.
5. Final step only: `echo "DONE" > .tickets/STATUS`

