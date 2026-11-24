<!-- WAVE:1 -->
# T-90-feedback-20261124_002056-2: Constant-Width Hand Mouseover Animation for Small Hands (Milestone 1 Gameplay)

## Context & Objective
In the Milestone 1 gameplay interface (`handLayout.ts` / `GameTable.tsx` / `table.css`), hovering a card in the active player's hand currently expands the total horizontal span of the hand when the hand is small enough not to fill the maximal allowed width. The user requested that the overall width of the hand remain strictly constant during mouseover, only spreading apart and pushing together cards within the resting width as necessary.

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-5 (Verbatim — New #4):** "Minor visual change to the hand animation in the gameplay interface for Milestone 1: if the active user's hand is small enough not to fill the maximal allowed width, its width should still be kept constant when the mouseover animation plays. In other words, mousing over the hand should never increase the overall width of the hand, but only spread apart and push together cards as necessary."
- [ ] **Constant Bounding Width Invariant (`frontend/src/utils/handLayout.ts`):**
  - Compute the resting layout of the hand (`hoveredIndex === null`) with outer left edge `L_rest` (left edge of card `0`) and outer right edge `R_rest` (right edge of card `N - 1`), defining `W_rest = R_rest - L_rest`.
  - When any card `hoveredIndex = h` (`0 <= h < N`) is hovered:
    - The outer bounding edges MUST remain strictly fixed: `L_hover === L_rest` and `R_hover === R_rest`, so `W_hover === W_rest` for ALL hand sizes `N >= 1` (both when `W_rest < maxWidth` and when `W_rest >= maxWidth`).
    - For `N <= 2`: outer edges cannot move outward, so hovering applies vertical lift / z-index elevation without changing horizontal outer width.
    - For `N >= 3`: pin card `0` at `L_rest` and card `N - 1` at `R_rest - cardWidth`. If adjacent cards overlap at rest (`step < cardWidth`), spread space open around the hovered card `h` (shifting interior neighbors away from `h` up to full reveal / configured hover spread) while compressing the remaining interior gaps on the left (`0 .. h-1`) and right (`h+1 .. N-1`) within `[L_rest, R_rest]` so cards push together rather than expanding the overall hand width. If adjacent cards do not overlap at rest (`step >= cardWidth`), do not widen the hand beyond `[L_rest, R_rest]`.
    - Ensure card ordering remains strictly monotonically non-decreasing (`x[0] <= x[1] <= ... <= x[N-1]`) with no card overflowing outside `[L_rest, R_rest]`.
- [ ] **Live UI & CSS Enforcement (`frontend/src/components/GameTable.tsx` & `frontend/src/styles/table.css`):**
  - Wire the updated constant-width layout calculations directly into the active player's hand container (`[data-zone="player-hand"]`) in `GameTable.tsx`.
  - Verify CSS rules in `table.css` (e.g., card hover transitions, flex/grid margins, transforms) do NOT expand the rendered width of the hand container or push outer cards past their resting horizontal edges on mouseover.
  - Preserve all Zero-Overlap CSS Grid spatial rules (`min-width: 0; box-sizing: border-box;`, no `position: absolute` / `position: fixed` for zones/hands).
- [ ] **QA Testability (< 15 seconds):**
  - Hovering cards in a 6-card opening hand or any smaller 3–5 card hand in `GameTable` (reachable immediately via `Launch active projected match` or any local M1 match) must visibly keep the left and right outer edges of the hand rock-steady while interior cards spread apart and compress around the hovered card.
- [ ] **Do NOT modify** `README.md`, `ARCHITECTURE.md`, `LobbyPage.tsx`, `lobby.css`, `app.css`, `GamePage.tsx`, or any `backend/` files in this ticket.

## Scope & Files
- `frontend/src/utils/handLayout.ts`
- `frontend/src/components/GameTable.tsx`
- `frontend/src/styles/table.css`
- `frontend/src/__tests__/handLayout.test.ts`
- `frontend/src/__tests__/handPresentation.test.tsx`

## Verification Plan
1. Add comprehensive unit tests in `frontend/src/__tests__/handLayout.test.ts` covering small hands (`N = 1, 2, 3, 4, 5, 6` where `restingWidth < maxWidth`) and large hands (`N = 10, 14` where `restingWidth === maxWidth`): assert for every `hoveredIndex` that `hoverLeftEdge === restLeftEdge`, `hoverRightEdge === restRightEdge`, `hoverTotalWidth === restTotalWidth`, positions remain monotonically ordered, and overlapping small hands still increase reveal spacing around the hovered card while compressing outer flank gaps.
2. Add/update rendering tests in `frontend/src/__tests__/handPresentation.test.tsx` simulating mouseenter/hover across cards in a small hand and verifying the hand container's computed width and outermost card positions do not increase.
3. Run `cd frontend && npm test -- --run` and ensure all tests pass.
4. Write concise summary in `.reviews/agent_notes.md`, then run `echo "DONE" > .tickets/STATUS`.
