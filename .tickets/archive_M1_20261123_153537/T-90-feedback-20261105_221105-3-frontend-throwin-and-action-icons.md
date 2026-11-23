<!-- WAVE:2 -->
# T-90-feedback-20261105_221105-3 — Throw-In Outline Legal Visibility, Remove "Throw In" Button + Multi-Card Click/Double-Click Throw-In, and Theme-Matched Icon-Only Surrender & Pass Buttons

## Summary
Update `GamePage.tsx`, `GameTable.tsx`, `ActionBar.tsx`, `LobbyPage.tsx`, and `table.css` to:
1. Show `[data-testid="throw-in-outline"]` ONLY to players who can legally play into it (never shown to the defending player, a player with no valid throw-in cards, or a player who has already passed) (`ITEM-1a`).
2. Remove the `"Throw In"` button completely, allowing cards to be thrown in by dragging to `[data-testid="throw-in-outline"]` or double-clicking, and supporting multi-card throw-in by clicking to select multiple legal cards and double-clicking to deploy them all at once (`ITEM-5`).
3. Replace the bright-red text `"Surrender"` button and text `"Pass"` button in the bottom-right corner of the table with smaller, theme-matched non-verbal SVG icon buttons (`ITEM-6`, `ITEM-7`).
4. Wire the `full-hand-pickup` QA Scenario Preset into the Lobby and Left Sidebar `⚡ QA Scenarios` panel alongside `surrender-half-off` so all items can be tested in under 15 seconds.

## Scope Constraints (STRICT)
- **ONLY touch files inside `frontend/`.** Do NOT modify `backend/`, `README.md`, `ARCHITECTURE.md`, or `play-local.sh`.
- Preserve all Wave 1 changes in `frontend/` (`100px × 140px` card dimensions, `20%–80%` hand overlap, `[data-testid="hand-highlight-contour"]`, and drag card visibility). Always run `git status` and `git diff` first.

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-1a (QA Playbook #1 — Throw-In Outline Only Visible to Players Who Can Legally Play Into It):**
  > "1. It works, but make the following adjustment: the additional card outline should only be visible to players that can legally play into it. In other words, it should not be visible if a player has no valid cards to throw in, is the defending player, or has already input a pass command."
  - In `frontend/src/pages/GamePage.tsx` and `frontend/src/components/GameTable.tsx` (and `frontend/src/utils/legalMoves.ts` if applicable):
    - Compute `canCurrentPlayerThrowIn` for the active/viewed POV player (`myPlayerId` / bottom seat):
      1. `boutPhase === 'Defense' || boutPhase === 'SurrenderThrowIn'`
      2. `tablePairs.length > 0`
      3. `myPlayerId !== defenderId` (NOT the defending player)
      4. `!myPlayer?.hasPassed` (has NOT already input a pass command)
      5. `myPlayer?.isActive !== false && myPlayer?.finishRank == null`
      6. Bout can accept at least 1 more attack card (`tablePairs.length < maxBoutAttacks` and, if `boutPhase === 'Defense'`, `uncoveredCount < defenderCardCount`)
      7. `myHand` contains at least one card whose rank matches a rank currently on the table (`tableRanks.has(card.rank)`), AND if `legalActions` is populated on `gameView`, `legalActions.some(a => a.type === 'ThrowInCards')` (falling back to the client-side rank+capacity check only when `legalActions` is omitted in minimal test fixtures).
    - Render `[data-testid="throw-in-outline"]` (and `[data-testid="surrender-throw-in-anchor"]` during surrender) **ONLY when `canCurrentPlayerThrowIn` is `true`**. When `canCurrentPlayerThrowIn` is `false`, neither `[data-testid="throw-in-outline"]` nor `[data-testid="surrender-throw-in-anchor"]` may be visible/rendered.

- [ ] **ITEM-5 (New #4 — Remove "Throw In" Button + Multi-Card Click-Select & Double-Click Throw-In):**
  > "4. Remove the "Throw In" button. Instead, cards can be thrown in by dragging them to the additional card outline or double clicking. To throw in multiple cards at once, the player can click to select multiple legal cards to throw in, and then double-click to deploy them all at once."
  - **Remove "Throw In" Button:**
    - Remove the `"Throw In"` button (`[data-testid="throw-in-btn"]` / any button labeled `"Throw In"`) from `GamePage.tsx`, `GameTable.tsx`, and `ActionBar.tsx`.
  - **Multi-Card Click Selection & Double-Click Deployment:**
    - During a throw-in phase (`Defense` or `SurrenderThrowIn` when `canCurrentPlayerThrowIn` is `true`), allow the active player to click any legal throw-in card in their hand (any card in `myHand` whose `rank` is in `tableRanks`) to toggle its selection state (`selectedIndices`, marked with `data-selected="true"` on `.hand-card-wrapper` and shifted upward so the tight hand highlight contour from Wave 1 wraps around the raised cards).
    - Cap the number of simultaneously selected throw-in cards to the remaining throw-in capacity (`maxThrowInCount = Math.min(maxBoutAttacks - tablePairs.length, boutPhase === 'Defense' ? defenderCardCount - uncoveredCount : maxBoutAttacks - tablePairs.length)`). Note: during throw-in, selected cards do NOT need to share the same rank with each other as long as every selected card's rank matches a rank on the table (`tableRanks.has(card.rank)`).
    - **Double-Click Handling (Crucial Click/DblClick Coordination):**
      - In the card click handler (`onClick` / pointer tap), if `event.detail >= 2` (the second click of a double-click), do NOT toggle/deselect the card so an already-selected card is never accidentally deselected right before `onDoubleClick` fires.
      - Also track the selection snapshot prior to the double-click sequence so that when `onDoubleClick` fires on a legal throw-in card `clickedIdx`:
        - Compute the union of all currently selected legal throw-in card indices and `clickedIdx` (capped at `maxThrowInCount`).
        - If 2 or more legal throw-in cards are in that union, dispatch a single `ThrowInCards` action with all of those cards (`cards: selectedLegalCards`) at once and clear the selection!
        - If only `clickedIdx` is in that union, dispatch `ThrowInCards` with `[myHand[clickedIdx]]` and clear the selection!
      - Similarly, during `InitialAttack` (or `RedirectAttack`), if multiple cards of the same rank are click-selected and the user double-clicks one of them (or drags one of them onto a target/redirect outline), deploy all selected same-rank cards together.
      - When dragging a card onto `[data-testid="throw-in-outline"]`: if the dragged card is part of a multi-card legal throw-in selection, deploy all selected legal throw-in cards together; otherwise deploy the single dragged card.

- [ ] **ITEM-6 (New #5 — Smaller Non-Verbal Theme-Matched Surrender Icon Button):**
  > "5. Instead of the word "Surrender", the surrender button should be smaller and non-verbally communicate the action with an icon. Design the icon to be two hands, raised in surrender, underneath some cards with an arrow pointing from the cards down towards the hands. Keep the position of the surrender button in the bottom right corner of the game table. Adjust the button to fit the aesthetic of the current theme as the other game elements do, instead of being the current bright red."
  - Keep the Surrender button (`[data-testid="surrender-btn"]`) in the bottom-right corner of the game table (`[data-zone="table-arena"]` Row 3, Col 3).
  - Do NOT render the visible text `"Surrender"` inside the button (`textContent` must be empty; provide `aria-label="Surrender"` and `title="Surrender"`).
  - Render a custom SVG icon (`[data-testid="surrender-icon"]`) inside `[data-testid="surrender-btn"]` containing:
    1. Fanned/grouped playing cards at the top (`<g data-icon-part="cards">`),
    2. A downward-pointing arrow (`<g data-icon-part="arrow-down">`) pointing from the cards down toward the hands,
    3. Two raised open hands in surrender at the bottom (`<g data-icon-part="raised-hands">`) underneath the cards and arrow.
  - Make the button compact (`44px × 44px` on desktop, `36px × 36px` on mobile) and style it to match the current theme aesthetic (`background: var(--bg-elevated, rgba(24, 34, 29, 0.85))`, `color: var(--text-primary)`, `border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.18))`, `border-radius: var(--ui-radius, 10px)`, subtle backdrop-filter and hover elevation) instead of bright red.

- [ ] **ITEM-7 (New #6 — Smaller Non-Verbal Theme-Matched Pass Icon Button):**
  > "6. Instead of the word "Pass", the pass button should be smaller and non-verbally communicate the action with an icon. Design the icon with a similar aesthetic to the above specification for the surrender button. Also make the other button adjustments in an analogous way."
  - Keep the Pass button (`[data-testid="pass-btn"]`) in the bottom-right corner of the game table (`[data-zone="table-arena"]` Row 3, Col 3).
  - Do NOT render the visible text `"Pass"` inside the button (`textContent` must be empty; provide `aria-label="Pass"` and `title="Pass"`).
  - Render a cohesive custom SVG icon (`[data-testid="pass-icon"]`) inside `[data-testid="pass-btn"]` matching the stroke weight, scale, and visual language of `[data-testid="surrender-icon"]` (e.g., playing cards `<g data-icon-part="cards">` paired with a waving/passing hand `<g data-icon-part="pass-hand">` and a forward/skip curved pass arrow `<g data-icon-part="arrow-pass">` arcing past the cards).
  - Apply the exact same compact dimensions (`44px × 44px` desktop, `36px × 36px` mobile) and theme-matched surface/border/hover aesthetic as `[data-testid="surrender-btn"]`.

- [ ] **QA Scenario Preset Wiring (`LobbyPage.tsx` & `GamePage.tsx`):**
  - Ensure `full-hand-pickup` (e.g. labeled `"Full Hand Pickup (30 Cards)"`, `data-testid="preset-btn-full-hand-pickup"`) is available in the `⚡ QA Scenarios` panel in both `LobbyPage.tsx` and the left sidebar of `GamePage.tsx` alongside `surrender-half-off` so the human reviewer can test both multi-card throw-in/surrender and 30-card hand overlap/contour in 1 click.

## Verification & Test Commands
Run the frontend test suite and ensure all tests pass:
```bash
cd frontend && npm test -- --run
```
Update/add unit tests in `frontend/src/__tests__/GamePage.test.tsx`, `frontend/src/__tests__/GameTable.test.tsx`, and `frontend/src/__tests__/LobbyPage.test.tsx` to verify:
1. `[data-testid="throw-in-outline"]` is hidden when the active player is the defender, has no matching rank cards in hand, or has `hasPassed: true`, and visible when the active player can legally throw in.
2. No `"Throw In"` button is rendered; clicking multiple legal throw-in cards selects them (`data-selected="true"`) and double-clicking deploys all selected legal throw-in cards in a single `ThrowInCards` action.
3. `[data-testid="surrender-btn"]` and `[data-testid="pass-btn"]` render `[data-testid="surrender-icon"]` and `[data-testid="pass-icon"]` with no visible `"Surrender"` or `"Pass"` text and use theme-matched compact styling.

