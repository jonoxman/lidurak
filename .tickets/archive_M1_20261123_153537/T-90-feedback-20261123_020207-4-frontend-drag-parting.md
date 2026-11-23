<!-- WAVE:2 -->
# T-90-feedback-20261123_020207-4: In-Hand Drag Reordering Card Parting Animation & Table Collapse Attack Drop Check (Frontend)

## Objective
1. Implement a localized, high-FPS (60fps `translate3d`) **in-hand card parting animation during card dragging** so that as the user drags a card around inside their hand, the other hand cards part cleanly around the live insertion slot, making it unmistakably obvious where the dragged card will land when released.
2. Verify (and fix if any frontend gating exists) that in the `'Table Collapse (Edge & Row)'` QA scenario (`qa-table-collapse-right`), the frontend `GameTable` allows playing BOTH valid attack/throw-in cards from the active user's hand without locking out the second card after the first card is sent.

## Scope & Target Files (Frontend Table & Hand Interaction Only)
- `frontend/src/utils/handLayout.ts`
- `frontend/src/components/GameTable.tsx`
- `frontend/src/styles/table.css`
- `frontend/src/__tests__/handLayout.test.ts`
- `frontend/src/__tests__/handPresentation.test.tsx`
- `frontend/src/__tests__/GameTable.test.tsx`
- **STRICT FORBIDDEN FILES:** Do NOT edit `README.md`, `ARCHITECTURE.md`, `play-local.sh`, `backend/*`, `frontend/src/pages/LobbyPage.tsx`, `frontend/src/pages/GamePage.tsx`, or `frontend/src/api/client.ts`.

## Implementation Requirements
1. **In-Hand Drag Reorder Parting Geometry (`frontend/src/utils/handLayout.ts`):**
   - Build directly on Wave 1's pure localized parting & GPU-composited `handLayout.ts` primitives.
   - Add pure helper(s) (e.g., `resolveDragInsertIndex` and `computeDragPartedCardPositions`) that take the hand count, container width, `dragSourceIndex`, and live `dragInsertIndex` (`0 .. remainingCount`, or `null` when dragging outside the hand):
     - Exclude/collapse the dragged source card's old spot so the remaining `N - 1` cards sit in their natural overlapping arrangement.
     - When `dragInsertIndex !== null`, open an unmistakable, visually prominent insertion gap right at `dragInsertIndex` (between remaining card `dragInsertIndex - 1` and remaining card `dragInsertIndex`, or cleanly shifting the first/last card inward/outward when targeting slot `0` or the rightmost slot `N - 1`).
     - Keep parting localized to the cards near the insertion slot (consistent with Wave 1's localized hover parting so distant cards in a 30-card hand stay overlapped as hand size demands!) while strictly maintaining monotonic order (`x[i] < x[i+1]`) and staying inside `[data-zone="player-hand"]` lane margins.
     - Works cleanly across small hands (2–6 cards) AND large compressed hands (e.g., 30 cards), and never breaks 1-card hands.
2. **Live Drag Tracking, Slot Preview & Deterministic Drop Commit (`frontend/src/components/GameTable.tsx` & `frontend/src/styles/table.css`):**
   - While dragging a card from `.hand-cards`:
     - Keep `[data-testid="drag-card-preview"]` strictly center-locked under the live cursor `(clientX, clientY)` (preserving previous-round Item #3).
     - Using the rAF-coalesced pointer tracking loop, detect when the pointer is over/within the hand lane (`[data-zone="player-hand"]` / `.hand-cards` with modest vertical tolerance) and compute `dragInsertIndex` via `resolveDragInsertIndex`, updating React state ONLY when `dragInsertIndex` changes to preserve 60fps performance.
     - Apply the parted coordinates to all non-dragged hand cards via GPU-composited `transform: translate3d(...)` so the slot opening animates smoothly at 60fps as the user drags left/right across their hand.
     - Hide or visually vacate the dragged source card in-hand (e.g., `opacity: 0; pointer-events: none;`) without triggering layout reflow, while exposing testable attributes (`data-drag-insert-index="<idx>"` on `.hand-cards` when an insertion slot is active, and `data-drag-source="true"` on the dragged card slot).
     - When the pointer moves out of the hand zone (e.g., up over `[data-zone="table-arena"]` to play a card onto the table), reset `dragInsertIndex` to `null` so the remaining hand cards smoothly close the gap.
     - When the user releases/drops the card while `dragInsertIndex !== null` (and not over a table drop target), commit the hand reorder to that EXACT `dragInsertIndex` so the card lands precisely in the parted slot that was previewed!
3. **Verify & Fix Any Frontend Multi-Attack / Throw-In Gating for Table Collapse (`frontend/src/components/GameTable.tsx`):**
   - Inspect how `GameTable.tsx` determines card playability, valid table drop zones (`target-outline-*`, throw-in target area), and action dispatch when `view.canThrowIn` / `view.throwInCards` / `view.throwInCapacity` are active during `BoutPhase.Defense` (including when uncovered cards are already on the table).
   - Ensure that after the active user drags or clicks their first valid attack/throw-in card onto the table in `qa-table-collapse-right`, the second valid card remains immediately draggable/playable onto the table attack/throw-in drop zone (no premature lockout from `isMyTurn`, `promptedPlayerIds`, stale `isSubmitting` guard, or missing throw-in drop target when uncovered cards exist).

## End-to-End Wiring
- **Frontend Components & Utilities:** `frontend/src/utils/handLayout.ts`, `frontend/src/components/GameTable.tsx`, and `frontend/src/styles/table.css`.
- **QA Scenario Testability (< 15 seconds):**
  - Drag parting is immediately testable in 1 click via `'6-Card 10s & Actions'` (`qa-normal-6-actions`) and `'30-Card Compress & Part'` (`qa-large-30-compress`).
  - Table Collapse 2-card attack/throw-in is immediately testable in 1 click via `'Table Collapse (Edge & Row)'` (`qa-table-collapse-right`).

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-NEW2 (Verbatim):** *"Implement the card parting animation for when the user drags cards around in their hand as well - the cards should part in a way that makes it obvious which slot the dragged card will end up in if let go."*
- [ ] **ITEM-NEW1 (Frontend Verification — Verbatim):** *"Potential bug: In the Table Collapse QA scenario, the active user can send only one card to attack, even though there are two valid cards to play. I don't see a reason for this, since the target player has 4 cards remaining in hand."*
- [ ] Dragging a card left/right across `.hand-cards` dynamically parts the neighboring hand cards via GPU-composited `transform: translate3d(...)` around the active `dragInsertIndex`, creating an unmistakable visual gap at the exact target slot (including left edge slot `0`, middle slots, and right edge slot `N - 1`) in both small (6-card) and large (30-card) hands.
- [ ] Moving the dragged card outside the hand zone smoothly closes the insertion gap; releasing inside the hand commits the reorder to the exact `dragInsertIndex` that was previewed.
- [ ] Center-locked `[data-testid="drag-card-preview"]` alignment and table drop zones (`cover:*`, `target-outline-*`, `redirect-outline`) remain completely intact.
- [ ] In `GameTable.tsx`, when `view.canThrowIn` is true and `view.throwInCards` contains valid matching cards (including when uncovered pairs are already on the table, as in `qa-table-collapse-right`), the user can play the first valid card and immediately play the second valid card without frontend UI gating.
- [ ] Automated tests in `handLayout.test.ts`, `handPresentation.test.tsx`, and `GameTable.test.tsx` verify: (a) `resolveDragInsertIndex` & `computeDragPartedCardPositions` open an unmistakable gap at `0`, middle, and `N - 1` while keeping distant cards in a 30-card hand anchored, (b) dragging a card across `.hand-cards` updates `data-drag-insert-index` and commits the reorder to that exact slot on drop, and (c) consecutive valid throw-in/attack cards can both be played during `Defense` with uncovered table pairs.
- [ ] Run `cd frontend && npm test -- --run` and confirm 100% pass.
- [ ] Write a concise summary in `.reviews/agent_notes.md`, then run `echo "DONE" > .tickets/STATUS`.
