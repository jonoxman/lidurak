<!-- WAVE:2 -->
# Ticket T-90-4: Players List Soft Role Glow, Inner Name Outline Removal, Active User Status Labels & Surrender Flow (`GamePage.tsx`, `app.css`, `types.ts`)

## Summary
Update `GamePage.tsx`, `app.css`, and `types.ts` to address all `PLAYERS` list and surrender interaction feedback items:
1. **Remove Inner Player Name Outline & Use Soft Glow on Player Boxes (`ITEM-ADD-2a`, `ITEM-ADD-2b`):**
   - In `GamePage.tsx` and `app.css`, do **not** outline `.status-name` inside the player row box (`li.status-badge`). Remove any border, outline, box-shadow, or role-box styling from `.status-name`.
   - On the player row box itself (`li.status-badge[data-role="attacker"]` and `li.status-badge[data-role="defender"]`), replace the sharp `2px solid` border/outline with a soft, diffused glow effect (`outline: none`, subtle `1px solid` semi-transparent border, and multi-layered soft `box-shadow` glow in green for attacker and amber for defender in both dark and light themes).
2. **Active User Status Label in `PLAYERS` List & No `OUT` Badge When Holding Cards (`ITEM-ADD-8a`, `ITEM-ADD-8b`):**
   - Update `types.ts` (`PlayerGameView` and `parsePlayerGameView`) to parse `myHasPassed` and `myFinishRank`.
   - In `GamePage.tsx`, compute status badges (`DURAK`, `WINNER`, `OUT`, `PASSED`) using the exact same rules for the active user's row (`myId`, e.g. `Alice (You)`) as for opponent rows:
     - Derive the active user's `finishRank` from `displayedView.myFinishRank` (falling back to `displayedView.winners.indexOf(displayedView.myId) + 1` when `myHand.length === 0`) and `hasPassed` from `displayedView.myHasPassed`.
     - **Strict Card-Count Guard (`ITEM-ADD-8b`):** Never show `WINNER` or `OUT` for any seat (active user or opponent) whose `cardCount > 0`! Only seats with `cardCount === 0` can display `WINNER` (`finishRank === 1`) or `OUT` (`finishRank > 1`).
     - Expose `data-testid={`player-status-tag-${player.id}`}` (and keep `data-testid={`player-durak-tag-${player.id}`}` when `DURAK`) on the rendered status pill so both active user and opponent status badges are directly testable.
3. **Ensure Human Defender Never Auto-Surrenders Client-Side (`ITEM-ADD-4a`):**
   - In `GamePage.tsx`, ensure there is no client-side timer or effect that automatically dispatches `DeclareSurrender` before the 15-second server turn clock expires, so that when opening `Surrender Half-Off` (or any defense turn), the human defender always sees and can click the `Surrender` button.

## Files to Modify
- `frontend/src/types.ts`
- `frontend/src/pages/GamePage.tsx`
- `frontend/src/app.css`
- `frontend/src/__tests__/GamePage.test.tsx`

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-ADD-2a & ITEM-ADD-2b (No Outline on Inner `.status-name` + Soft Glow on `li.status-badge`):**
  > "2. Do not outline the players' names inside of the label box. Additionally, make the box outlines in the player section a much softer glow effect, rather than the sharp boxes we have now."
  - In `GamePage.tsx` and `app.css`:
    - Remove `data-role` outline/border/box-shadow styling from `.status-name` (ensure `.status-badge .status-name` has `border: none; outline: none; box-shadow: none;`).
    - Style `.status-badge[data-role='attacker']` and `.status-badge[data-role='defender']` with `outline: none`, a soft translucent `1px solid` border, and a soft diffused outer/inner `box-shadow` glow (e.g., `box-shadow: 0 0 12px 2px rgba(45, 198, 83, 0.38), inset 0 0 8px rgba(45, 198, 83, 0.14)` for attacker and `0 0 12px 2px rgba(245, 158, 11, 0.38), inset 0 0 8px rgba(245, 158, 11, 0.14)` for defender, with theme-appropriate soft glow rules for `html[data-theme='light']`).
- [ ] **ITEM-ADD-8a & ITEM-ADD-8b (Active User Status Label & No False `OUT` Label When Holding Cards):**
  > "8. The active user's player label doesn't display their label in the player list unless they are the DURAK. Additionally, in this QA scenario, Bob is displayed as OUT even though he still has 3 cards in hand. Correct both of these."
  - In `types.ts` and `GamePage.tsx`:
    - Parse `myHasPassed?: boolean` and `myFinishRank?: number | null` on `PlayerGameView`.
    - For the active user's entry in the `PLAYERS` list (`id === displayedView.myId`), populate `hasPassed` (`Boolean(displayedView.myHasPassed)`) and `finishRank` (`displayedView.myHand.length === 0 ? (displayedView.myFinishRank ?? (winnerIdx >= 0 ? winnerIdx + 1 : null)) : null`).
    - When the active user finishes 1st (`finishRank === 1` and `cardCount === 0`), display `WINNER` on the active user's row; when the active user finishes 2nd+ (`finishRank > 1` and `cardCount === 0` and not `DURAK`), display `OUT` on the active user's row; when the active user has passed during a throw-in (`hasPassed === true`), display `PASSED` on the active user's row.
    - Never display `WINNER` or `OUT` for any player (including Bob in `Discard & Endgame Durak`) whose `cardCount > 0`.
- [ ] **ITEM-ADD-4a (No Premature Client Auto-Surrender; Surrender Button Ready on Load):**
  > "4. This feature does not appear to be working. Firstly, due to auto-surrender (Additional Feedback #5), there is no surrender button to click when the QA test starts."
  - In `GamePage.tsx`:
    - Remove or disable any client-side auto-surrender timer that dispatches `DeclareSurrender` on `BoutPhase.Defense`, ensuring the `Surrender` button remains visible and clickable for a human defender until they click `Surrender` (or the server's 15-second turn clock expires).
- [ ] **Automated Frontend Unit Tests (`frontend/src/__tests__/GamePage.test.tsx`):**
  - Add/update tests verifying:
    1. `.status-name` inside `[data-testid="players-list"]` does not carry a role outline/border while `li.status-badge[data-role="attacker"]` and `li.status-badge[data-role="defender"]` carry the soft glow role attributes.
    2. When the active user (`myId`) has `0 cards` and `myFinishRank = 1` (or is in `winners[0]`), their row in `PLAYERS` displays `WINNER`; when `myFinishRank = 2` (or `winners[1]`), their row displays `OUT`; when `myHasPassed = true`, their row displays `PASSED`.
    3. Any player with `cardCount > 0` (such as Bob with 3 cards) never displays `OUT` or `WINNER` even if a stale `finishRank` or `winners` entry is present.
    4. Loading a defense state where `"surrender"` is in `legalActions` renders the `Surrender` button without auto-dispatching surrender on mount.
  - Run `cd frontend && npm test -- --run` and ensure all tests pass.
