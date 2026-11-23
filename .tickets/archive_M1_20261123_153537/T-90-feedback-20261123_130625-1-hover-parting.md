<!-- WAVE:1 -->
# Ticket T-90-feedback-20261123_130625-1: Unambiguous Single-Card Hover Parting in Large Hand

## Summary & Root Cause
In the previous implementation of localized hover parting (`frontend/src/utils/handLayout.ts` and `frontend/src/components/GameTable.tsx`), cards in `[data-zone="player-hand"]` stack left-to-right so card `i` overlaps the right portion of card `i - 1`, and card `i + 1` overlaps the right portion of card `i`. Because symmetric hover parting shifted left neighbours (`i - 1, i - 2, ...`) leftward and right neighbours (`i + 1, i + 2, ...`) rightward by equal magnitudes while pinning `i`, BOTH card `i - 1` (`x(i) - x(i - 1)`) AND the hovered card `i` (`x(i + 1) - x(i)`) opened up with the exact same exposed margin. Visually, this made it ambiguous which of the two equally revealed cards was under the cursor and about to be selected.

Adjust the hover parting geometry so that **only the single card the mouse is actually hovering over** is revealed with the widest margin, while keeping the smooth 60fps GPU-composited performance, localized displacement, and existing in-hand drag-parting behavior completely intact.

## Scope & Target Files
- `frontend/src/utils/handLayout.ts`
- `frontend/src/components/GameTable.tsx`
- `frontend/src/__tests__/handLayout.test.ts`
- `frontend/src/__tests__/handPresentation.test.tsx`
- (Do NOT touch `README.md`, `ARCHITECTURE.md`, `HeaderBar.tsx`, or `table.css` / `app.css` roundness styles owned by other tickets.)

## Implementation Requirements & End-to-End Wiring
1. **Asymmetric / Single-Card Reveal Geometry (`frontend/src/utils/handLayout.ts`):**
   - Inspect the hover parting calculation in `frontend/src/utils/handLayout.ts` (keeping `computeDragPartedCardPositions` / `resolveDragInsertIndex` intact for in-hand drag reordering).
   - Keep the hovered card `h` pinned at its resting X (`partDeltaX = 0`, `partDirection = 'none'`) so the card under the pointer never jumps away from the cursor.
   - Do **not** shift cards to the left of the hovered card (`j < h`) outward to create a matching gap behind `h` — keep `j <= h` at `partDeltaX = 0`, `partDirection = 'none'` so card `h - 1` remains at its normal resting overlap (`x(h) - x(h - 1) === restingStep`).
   - Shift only the local neighbours to the **right** of the hovered card (`h + 1 .. min(n - 1, h + radius)`) rightward with positive, monotonically decaying `partDeltaX` values (`partDirection = 'right'`) so that:
     - Card `h` (for `h < n - 1`) has exposed visible margin `x(h + 1) - x(h)` strictly and unmistakably larger than `x(h) - x(h - 1)` and strictly larger than every other overlapped card `j != h` (`j < n - 1`).
     - Cards remain strictly monotonic left-to-right (`x(j) <= x(j + 1)` with a non-negative / non-inverted step — take care that `delta(j) - delta(j + 1)` never exceeds the resting step and causes cards to cross over each other).
     - Distant cards outside the local right neighbourhood remain at `partDeltaX = 0`, `partDirection = 'none'` and stay overlapped as the hand size demands.
     - Right-boundary clamping keeps displaced cards inside the hand layout bounds without breaking the single-card reveal invariant.
   - Edge cases to handle cleanly:
     - Hovering the leftmost card (`h === 0`): `0` stays pinned at `partDeltaX = 0`, only local right neighbours shift right, revealing card `0` with the widest margin.
     - Hovering an interior card (e.g., `h === 15` in a 30-card hand): `0..15` stay at `partDeltaX = 0`, local right neighbours (`16..`) shift right, so **only** card `15` is revealed with the widest margin while card `14` stays overlapped at its resting margin.
     - Hovering the rightmost card (`h === n - 1`): already 100% uncovered on top of the stack; all cards remain at `partDeltaX = 0` so card `n - 2` is NOT falsely opened up to compete with card `n - 1`.
     - Single-card hand (`n === 1`): remains stationary (`partDeltaX = 0`, `partDirection = 'none'`).
2. **Live UI Wiring & Performance Preservation (`frontend/src/components/GameTable.tsx`):**
   - Wire the updated hover parting output into `HandCardSlot` inside `[data-zone="player-hand"]` in `frontend/src/components/GameTable.tsx`.
   - Preserve GPU-composited `transform: translate3d(...)` positioning, `memo(...)` isolation on `HandCardSlot`, and accurate `data-part-delta-x` / `data-part-direction` / `data-index` DOM attributes so sweeping across a 30-card hand stays smooth (<= 20ms median frame delta) and causes zero re-renders of `[data-zone="sidebar-left"]` or `.opponent-seat`.
   - Preserve all in-hand drag parting (`data-drag-source`, `data-dragging`, `onReorderHand`) and click/drag playability.
3. **QA Testability (< 15 Seconds via Existing 1-Click QA Scenario Presets):**
   - Ensure the existing `30-Card Compress & Part` (`qa-large-30-compress`) and `1-Card Hand (No Part)` (`qa-single-card`) QA Scenario Presets continue to work end-to-end so the human reviewer can click `30-Card Compress & Part` and immediately hover cards across the 30-card hand to observe only the hovered card opening with the widest margin.
4. **Unit & Component Tests:**
   - Update and expand `frontend/src/__tests__/handLayout.test.ts` and `frontend/src/__tests__/handPresentation.test.tsx` to assert:
     - For any interior hovered card `h` in a 30-card compressed hand, `exposedMargin(h) = x(h + 1) - x(h)` is strictly greater than `exposedMargin(h - 1) = x(h) - x(h - 1)` and strictly greater than `exposedMargin(j)` for all other overlapped cards `j != h` (`j < n - 1`).
     - Left neighbours (`j < h`) do NOT open an equal margin (specifically `partDeltaX === 0` and `partDirection === 'none'`).
     - Hovered card `h` has `partDeltaX === 0`, `partDirection === 'none'`.
     - Right local neighbours shift right (`partDeltaX > 0`, `partDirection === 'right'`), cards never invert order (`x(j) <= x(j + 1)`), and distant cards remain at `partDeltaX === 0`.
     - Hovering `index 0`, `index n - 1`, and a 1-card hand all satisfy the single-card unambiguous reveal rule.
     - Existing drag-parting tests remain green.

## Mandatory Acceptance Criteria Checklist
- [ ] **Verbatim Feedback (`ITEM-1` / `# Responses to QA Playbook` #1):** "The framerate is now good. However, this animation is too ambiguous. When hovering over a card in the large hand, two cards, usually the one being hovered over and the one to the left of it, are revealed (that is, less-overlapped) by an equally large margin. Adjust the animation so only one card in the hand is revealed with the widest margin (this should be the one the mouse is actually on), so it is clear which card is about to be selected."
- [ ] Wired end-to-end in `frontend/src/utils/handLayout.ts` and `frontend/src/components/GameTable.tsx` (`[data-zone="player-hand"]`).
- [ ] Hovering any card `h` in the `30-Card Compress & Part` (`qa-large-30-compress`) preset reveals **only** card `h` with the widest margin; card `h - 1` (to the left) is NOT revealed by an equally large margin.
- [ ] Hovered card stays pinned under the cursor (`data-part-delta-x="0"`), cards maintain monotonic left-to-right order without overlapping inversions, and distant cards remain overlapping at rest.
- [ ] GPU-composited `translate3d` and memoized `HandCardSlot` performance is preserved (no framerate regression) and in-hand drag parting continues to work.
- [ ] `cd frontend && npm test -- --run` passes with zero errors.
- [ ] Summary written to `.reviews/agent_notes.md`, no git commits made, and `echo "DONE" > .tickets/STATUS` executed only after all tests pass.
