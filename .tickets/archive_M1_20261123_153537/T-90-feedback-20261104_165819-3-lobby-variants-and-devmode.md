<!-- WAVE:2 -->
# Ticket 3 (Wave 2): Lobby Checkboxes for Transparent Mode & Dev Mode + QA Scenario Trigger

## Scope & Files to Touch
- **Touch ONLY the following files:**
  - `frontend/src/pages/LobbyPage.tsx`
  - `frontend/src/__tests__/LobbyPage.test.tsx`
- **Do NOT touch `GamePage.tsx`, `GameTable.tsx`, `Card.tsx`, `HeaderBar.tsx`, `table.css`, `app.css`, or `backend/` in this ticket.**

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-10b (Lobby UI) — "Transparent Mode" Checkbox & QA Scenario Preset (`LobbyPage.tsx`, `LobbyPage.test.tsx`):**
  > "10. Implement "Transparent Mode". This is a variant of the game in which all players' cards are visible to each user. It should be accessible through a checkbox in the game lobby (along with allowing redirections and chaos mode). Rather than draw the full card sprites in the non-active users' player boxes, display a low-detail version that only shows the suit and rank (and trump-highlight, if necessary). Make sure that this mode is compatible with all all other modes and that no graphical glitches occur."
  - In `frontend/src/pages/LobbyPage.tsx`:
    - Add a `"Transparent mode (all hands visible)"` (or `"Transparent mode"`) checkbox (`data-testid="transparent-mode-checkbox"`, default `false`) in the match variant checkboxes section alongside `"Allow redirects"` and `"Chaos mode"`.
    - Make `"Transparent mode"` selectable for all player counts (`2`, `3`, and `4` players) and compatible with both `"Allow redirects"` and `"Chaos mode"`.
    - Pass `transparentMode` in the `createGame` payload when `"Create Game"` is clicked.
    - Add a 1-click **`Transparent Mode`** button (`data-testid="qa-preset-transparent-mode"`, calling `createPresetGame('transparent-mode')`) in the Lobby's **`⚡ QA Scenarios`** panel so a human reviewer can jump straight into a Transparent Mode match in 1 click.

- [ ] **ITEM-14a (Lobby UI) — Temporary "Dev Mode" Toggle in the Lobby Menu (`LobbyPage.tsx`, `LobbyPage.test.tsx`):**
  > "14. ... Set it up so that unless a dev mode variable is active, the user cannot select the POV until the game is over and in review mode. (The dev mode variable should default to active for now, since we are currently testing. Temporarily place a toggle for it in the lobby menu, so I can start a game and see the UI from a normal user's perspective.) Ensure also that the dev mode variable is handled server-side, so the user cannot modify it on their end using techniques such as inspect element."
  - In `frontend/src/pages/LobbyPage.tsx`:
    - Add a `"Dev mode (allow POV switching)"` checkbox/toggle (`data-testid="dev-mode-checkbox"`) in the Lobby form alongside the variant checkboxes.
    - Default `devMode` to **`true` (checked)** so testing defaults to active dev mode, while allowing the user to uncheck it in the lobby before clicking `"Create Game"` to experience the UI from a normal user's perspective (`devMode: false`).
    - Pass `devMode` in the `createGame` request payload.
  - Add unit tests in `frontend/src/__tests__/LobbyPage.test.tsx` verifying:
    - The `"Transparent mode"` checkbox (`data-testid="transparent-mode-checkbox"`) defaults to unchecked (`false`) and passes `transparentMode: true` to `createGame` when checked.
    - The `"Dev mode"` checkbox (`data-testid="dev-mode-checkbox"`) defaults to checked (`true`) and passes `devMode: false` to `createGame` when unchecked.
    - The `Transparent Mode` button in `⚡ QA Scenarios` triggers the `'transparent-mode'` preset.

## Verification
- Run `cd frontend && npm test -- --run src/__tests__/LobbyPage.test.tsx` and ensure all tests pass.

