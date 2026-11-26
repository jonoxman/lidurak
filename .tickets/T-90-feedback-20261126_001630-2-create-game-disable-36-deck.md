<!-- WAVE:2 -->
# T-90-feedback-20261126_001630-2: Grey Out Invalid 36-Card Deck Option for 4 Players in Create a Game

## Summary
Update the Create a Game menu on the lobby page so that when `4` players is selected, the `36`-card deck option remains visible in the UI, is non-selectable (`disabled`), automatically yields selection to `52` cards, and is visually greyed out in both Dark and Light themes.

## Verbatim Human Feedback Covered (`ITEM-2`)
> **# QA responses — Item 6 (referencing Previous Round Item #6: "Implement as a game setting the option to play with all 52 cards even if there are less than 4 players..."):**
> "6. It seems to work correctly. However, also grey out the 36 card option in the Create a Game menu if it is not valid to select (because there are 4 players)."

## Implementation Plan

### 1. Create a Game Deck-Size Control (`frontend/src/pages/LobbyPage.tsx` & `frontend/src/components/lobby/CreateInviteTab.tsx`)
- Inspect the deck-size setting control inside the Create a Game panel (`.lobby-form` in `LobbyPage.tsx` and/or `CreateInviteTab.tsx`).
- Ensure both deck-size choices (`36` cards and `52` cards) remain rendered in the Create a Game menu for all player counts (`2`, `3`, and `4`)—do **not** hide the deck-size setting or remove the `36`-card option when `playerCount === 4`.
- Note on UI rendering so the greyed-out 36-card option is immediately visible in the Create a Game menu:
  - If the deck-size control is already rendered as visible side-by-side option buttons/pills/radios (`36` / `52`), set `disabled={playerCount === 4}` and `aria-disabled={playerCount === 4}` on the `36`-card option button/control and apply a dedicated disabled/greyed-out style class when `playerCount === 4`.
  - If the deck-size control is currently a `<select>` dropdown (or if both `<select>` / segmented options are present), ensure the `36`-card option is explicitly disabled (`disabled={playerCount === 4}`, `aria-disabled={playerCount === 4}`) and visually greyed out (if using a closed `<select>` where the `36` option wouldn't even be visible on the form until opened, evaluate replacing or styling appropriately—while preserving existing accessible labels/roles expected by `LobbyPage.test.tsx`, OR if `LobbyPage.test.tsx` queries `select` vs `button`, keep existing test queries passing while ensuring the `36`-card option is visibly greyed out and `disabled` when `playerCount === 4`). Specifically:
    - If `LobbyPage` uses button/toggle pills for `36` and `52`: mark the `36` button `disabled` and style `:disabled` visibly muted/greyed out right on the form.
    - If `LobbyPage` uses `<select>`: ensure `<select>` itself is NOT hiding the distinction or leaving `<option value="36">` enabled—set `<option value={36} disabled={playerCount === 4}>` with explicit `option:disabled` grey styling, OR if switching to side-by-side `36` / `52` option pills makes the greyed-out 36-card option directly visible on the panel without opening a native OS menu, verify and update `LobbyPage.test.tsx` cleanly while preserving compact `.lobby-form` height!
- Enforce state invariants in `LobbyPage.tsx` / `CreateInviteTab.tsx`:
  - Whenever `playerCount` changes to `4`, immediately coerce `deckSize` state to `52`.
  - While `playerCount === 4`, attempting to click or select `36` must be a no-op and `POST /api/games` must submit `deckSize: 52`.
  - Switching `playerCount` back to `2` or `3` immediately re-enables the `36`-card option so the user can freely toggle between `36` and `52` cards.

### 2. Disabled / Greyed-Out Styling (`frontend/src/app.css` & `frontend/src/styles/lobby.css`)
- Add explicit CSS rules in `app.css` and/or `styles/lobby.css` for the disabled 36-card deck option in `.lobby-form` across both default Dark theme and `html[data-theme="light"]`:
  - Muted/greyed foreground text color, subdued border/background, reduced opacity (for button/pill/radio controls), and `cursor: not-allowed`.
  - Strictly preserve Previous Round Item #5 (Lobby Glow Rule): resting elements and `:disabled` elements in `.lobby-form` must have `box-shadow: none` (even when hovered!).
  - Strictly preserve Previous Round Item #1 & Item #7 spatial rules: add **zero** explanatory helper text and do **not** increase `.lobby-form` vertical height.

## 15-Second Human Testability Check
- Open `http://localhost:5173`:
  1. Look at the **Create a Game** panel: with `2` or `3` players selected, verify both `36` and `52` card options are active and selectable.
  2. Select `4` players in **Create a Game**: immediately observe (< 3 seconds) that selection switches to `52` cards and the `36`-card option is greyed out and unclickable.
  3. Switch back to `2` players and verify the `36`-card option is no longer greyed out and can be selected again.

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-2 (Grey Out Invalid 36-Card Option for 4 Players):** In the Create a Game menu (`LobbyPage.tsx` / `CreateInviteTab.tsx` and `app.css` / `styles/lobby.css`), when `4` players is selected, the `36`-card deck option remains visible, has `disabled` (`disabled === true` / `aria-disabled="true"`), cannot be selected, automatically switches active deck selection to `52` cards, and renders visually greyed out in both Dark and Light themes (`html[data-theme="light"]`).
- [ ] **Re-enable for 2 & 3 Players:** When `2` or `3` players is selected in Create a Game, both `36`-card and `52`-card options are enabled (`disabled === false`), un-greyed, and submit the chosen `deckSize` (`36` or `52`) to `POST /api/games`.
- [ ] **Layout & Glow Regressions Prevented:** Zero explanation subtext is added to Create a Game, `.lobby-form` panel height is not inflated, and no resting or disabled element emits a `box-shadow` glow.
- [ ] **Automated Tests:** Add/update unit tests in `frontend/src/__tests__/LobbyPage.test.tsx` (and `frontend/src/pages/LobbyPage.test.tsx` if present) asserting that selecting 4 players switches `deckSize` to `52`, sets `disabled === true` and applies the greyed-out disabled styling/state on the 36-card option, blocks selecting `36` while 4 players is active, and re-enables `36` when switching back to 2 or 3 players. Run `npm test -- --run` with zero failures.

## Constraints & Workflow Rules
- Start by running `git status` and `git diff` to inspect changes from Wave 1.
- Do **NOT** modify `README.md`, `ARCHITECTURE.md`, `./play-local.sh`, `agent-orchestration/`, or host scripts.
- Never run `git commit`, `git checkout`, or `git branch`.
- Run `npm test -- --run` (in `frontend/`) and fix all errors before finishing.
- Write a concise implementation summary to `.reviews/agent_notes.md`, then as your final command run `echo "DONE" > .tickets/STATUS`.
