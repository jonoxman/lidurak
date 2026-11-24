<!-- WAVE:1 -->
# T-90-feedback-20261124_002056-3: Lobby Quick Pairing Height, "Create a Game" Rename/Reorder & Milestone 1 Theme Design System

## Context & Objective
The Milestone 2 lobby panels (`LobbyPage`, `QuickPairingTab`, `LobbyPoolTab`, `CreateInviteTab`, `QaLobbyPresets`) currently use hardcoded Lichess dark-only hex colors in `lobby.css`, have compact quick-pairing tiles, and label the third tab `"Create Invite Link"` with player count listed before visibility. This ticket updates the lobby layout and refactors all new lobby elements to adopt the Milestone 1 visual design system so they dynamically respond to every theme selectable in the `HeaderBar` profile menu.

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-2a (Verbatim — New #1a):** "The lobby quick pairing tiles should be adjusted to be about double their current height (keep the layout the same)."
  - Increase the rendered height of `.quick-pair-tile` buttons inside `QuickPairingTab.tsx` / `frontend/src/styles/lobby.css` to approximately 2x their current height (e.g., via `min-height` / balanced vertical padding) while preserving the exact same grid layout (`3x2` on desktop, responsive columns on smaller screens) and internal centered typography layout (title + subtitle).
- [ ] **ITEM-2b (Verbatim — New #1b):** "Rename the third section (currently "Create Invite Link") to "Create a Game""
  - Update the tab label in `frontend/src/pages/LobbyPage.tsx` from `"Create Invite Link"` to `"Create a Game"`.
  - Update headings, `aria-label`, and accessible text in `frontend/src/components/lobby/CreateInviteTab.tsx` from `"Create Invite Link"` to `"Create a Game"`.
- [ ] **ITEM-2c (Verbatim — New #1c):** "and rearrange the UI within this section: the first choice should be if the game is a private link or not, followed by the rest of the options as currently arranged."
  - In `frontend/src/components/lobby/CreateInviteTab.tsx`, move the Visibility / Private Link selector (`"Private invite link"` vs `"Public lobby pool"`) to be the **first** form control at the top of the `"Create a Game"` form.
  - Keep all remaining controls immediately below it in their existing order: Player Count (`2`, `3`, `4` players + `"36-card deck"` / `"52-card deck"` note), `Redirect / reflect` toggle, `Turn clock` selector, and the primary submit button.
- [ ] **ITEM-3 (Verbatim — New #2):** "Adopt the style of the Milestone 1 design for these newly created lobby elements. All elements respond appropriately to the choice of theme in the profile menu."
  - Inspect `frontend/src/state/settings.ts`, `frontend/src/components/HeaderBar.tsx`, and `frontend/src/app.css` to use the exact Milestone 1 CSS custom properties / theme classes / design tokens across `frontend/src/styles/lobby.css` and all lobby components (`LobbyPage.tsx`, `QuickPairingTab.tsx`, `LobbyPoolTab.tsx`, `CreateInviteTab.tsx`, `QaLobbyPresets.tsx`).
  - Eliminate hardcoded dark-only hex overrides (`#161512`, `#262421`, `#bababa`, etc.) from `lobby.css` wherever they prevent theme switching; ensure surfaces, borders, text, muted text, badges, segmented options, quick-pairing tiles, hover/focus states, searching status banner, lobby pool rows, guest name editor, and QA presets panel all adapt cleanly and maintain high contrast across EVERY theme selectable in the `HeaderBar` profile menu.
  - Adopt Milestone 1 visual styling (button styles, panel borders/radii/shadows, typography, spacing) while strictly preserving zero-overlap CSS Grid/Flexbox spatial rules (`min-width: 0; box-sizing: border-box;`, explicit `gap`, zero `position: absolute` / `position: fixed` on layout sections/panels, zero horizontal overflow).
- [ ] **End-to-End Wiring Points:**
  - `frontend/src/pages/LobbyPage.tsx` (tab navigation with `"Create a Game"`, M1-themed page shell & guest identity bar)
  - `frontend/src/components/lobby/QuickPairingTab.tsx` (double-height tiles with unchanged layout)
  - `frontend/src/components/lobby/CreateInviteTab.tsx` (renamed `"Create a Game"` with private/public visibility choice first)
  - `frontend/src/components/lobby/LobbyPoolTab.tsx` & `QaLobbyPresets.tsx` (M1 theme-reactive styling)
  - `frontend/src/styles/lobby.css` & `frontend/src/app.css` (theme tokens wired to profile menu theme state)
- [ ] **QA Testability (< 15 seconds):**
  - Open `http://localhost:5173`, immediately observe double-height Quick Pairing tiles, switch themes in the `HeaderBar` profile menu to verify every lobby element updates live, and click the `"Create a Game"` tab to verify private/public visibility is the first option.
- [ ] **Do NOT modify** `README.md`, `ARCHITECTURE.md`, `GameTable.tsx`, `GamePage.tsx`, `table.css`, `handLayout.ts`, `MultiplayerGamePage.tsx`, or any `backend/` files in this ticket.

## Scope & Files
- `frontend/src/styles/lobby.css`
- `frontend/src/app.css`
- `frontend/src/components/lobby/QuickPairingTab.tsx`
- `frontend/src/components/lobby/CreateInviteTab.tsx`
- `frontend/src/components/lobby/LobbyPoolTab.tsx`
- `frontend/src/components/lobby/QaLobbyPresets.tsx`
- `frontend/src/pages/LobbyPage.tsx`
- `frontend/src/pages/LobbyPage.test.tsx`
- `frontend/src/__tests__/LobbyPage.test.tsx`

## Verification Plan
1. Update/add tests in `frontend/src/pages/LobbyPage.test.tsx` and `frontend/src/__tests__/LobbyPage.test.tsx` verifying:
   - Tab `"Create a Game"` exists and `"Create Invite Link"` is replaced.
   - Within `"Create a Game"`, the private/public visibility control appears in DOM order before Player Count, Redirect/Reflect, and Turn Clock.
   - All 6 quick-pairing tiles render with preserved labels/testids and double-height styling hooks.
   - Changing the active theme updates the root theme attribute/class without hardcoded style regressions in lobby panels.
2. Run `cd frontend && npm test -- --run` and ensure all tests pass.
3. Write concise summary in `.reviews/agent_notes.md`, then run `echo "DONE" > .tickets/STATUS`.
