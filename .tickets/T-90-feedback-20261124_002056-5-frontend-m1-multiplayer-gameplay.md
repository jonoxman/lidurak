<!-- WAVE:2 -->
# T-90-feedback-20261124_002056-5: Hook Original Milestone 1 Gameplay Interface into Multiplayer & Remove Placeholder Completely

## Context & Objective
Milestone 2 introduced a lightweight placeholder page (`MultiplayerGamePage.tsx`) for `/g/:gameId` routes instead of reusing the full Milestone 1 gameplay interface (`GamePage.tsx`, `GameTable.tsx`, `ActionBar.tsx`, `SortBar.tsx`, `Card.tsx`, `CardBack.tsx`, `TablePair.tsx`, `SoundEngine.ts`, digital `00:XX` turn clock, and theme support). This ticket wires the original Milestone 1 `GamePage` interface into all `/g/:gameId` multiplayer routes (handling `WaitingForPlayers`, `InProgress`, `Finished`, and read-only Spectator modes) and **completely removes** the lightweight placeholder (`MultiplayerGamePage.tsx`, `MultiplayerGamePage.test.tsx`, and placeholder-only styles/references) from the repository.

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-4b (Verbatim — New #3 Frontend):** "Hook in the original gameplay interface as was developed in Milestone 1 for all gameplay elements. The current lightweight placeholder interface should be removed from the project completely."
- [ ] **Complete Removal of Lightweight Placeholder:**
  - Delete `frontend/src/pages/MultiplayerGamePage.tsx` and `frontend/src/pages/MultiplayerGamePage.test.tsx` completely from the workspace.
  - Remove all imports and references to `MultiplayerGamePage` from `frontend/src/app.tsx` and any tests or barrel files.
  - Remove any CSS rules in `frontend/src/styles/lobby.css` (or `app.css`) that were exclusively used by the deleted `MultiplayerGamePage` placeholder.
- [ ] **Hook Original M1 Gameplay Interface into `/g/:gameId` (`frontend/src/app.tsx` & `frontend/src/pages/GamePage.tsx`):**
  - Update `frontend/src/app.tsx` so History-API `/g/:gameId` routes render `GamePage` in multiplayer mode (`mode="multiplayer"` / `gameId`), while legacy M1 hash routes (`#/g/:gameId?player=:seat`) continue rendering `GamePage` in local/bot mode with zero regression.
  - Update `frontend/src/types/multiplayer.ts` and `frontend/src/api/gameSocket.ts` to decode the enriched backend `PlayerGameView` (from Wave 1 Ticket 1) and provide a clean adapter mapping multiplayer `PlayerGameView` → M1 `PlayerGameView` consumed by `GameTable.tsx`, `ActionBar.tsx`, `SortBar.tsx`, and `GamePage.tsx`.
  - In `GamePage.tsx` multiplayer mode:
    - Hydrate initial room state via `GET /api/games/:gameId` (`getGameView`) and maintain live updates via `/ws/games/:gameId` (`connectGameSocket`), sending authenticated `GameAction` messages (`InitialAttack`, `CoverCard`, `RedirectAttack`, `ThrowInCards`, `DeclareSurrender`, `PassTurn`) over the WebSocket and reacting to `gameViewUpdate` and `actionRejected` frames.
    - **`WaitingForPlayers` state:** Render an M1-themed room staging panel (within the M1 layout, obeying all theme variables and CSS Grid rules) showing the shareable invite URL + Copy link button, room config badges (player count, deck size, redirect, turn clock, visibility), seat roster, `"Join room"` button (`POST /api/games/:gameId/join`) when `viewerSeat === null`, and `"Leave room"` button (`POST /api/games/:gameId/leave`) when seated. Automatically transition into the live M1 felt table the moment `status` becomes `InProgress`.
    - **`InProgress` & `Finished` states:** Render the full original M1 3-column Lichess layout (`[data-zone="sidebar-left"]`, `[data-zone="table-arena"]` with `GameTable`, `Card`, `CardBack`, `TablePair`, `SortBar`, `ActionBar`, drag/click interactions, defender-anchored target outlines, redirect outline, constant-width hand hover animation, `SoundEngine`, and `[data-zone="sidebar-right"]` with digital `00:XX` turn clock and winner/durak/draw results + back-to-lobby navigation).
    - **Spectator mode (`viewerSeat === null` during `InProgress` / `Finished`):** Render the M1 felt table in read-only spectator mode with all seats' face-down card counts, active bout pairs, talon/trump, turn clock, and zero leaked hand cards or interactive move triggers.
    - **No hotseat tabs in multiplayer:** Only show M1 hotseat player-switcher tabs in local M1 hotseat mode; never render them in authenticated multiplayer mode.
    - **Zero Table Text Clutter:** Strictly preserve `AGENTS.md` spatial & zero-clutter rules — never render text banners like `"Waiting for first attack..."`, `"Your turn to defend"`, or invalid-move error strings on the felt table or below the hand.
- [ ] **End-to-End Wiring Points:**
  - `frontend/src/app.tsx` (`/g/:gameId` -> `GamePage` multiplayer mode; `#/g/:gameId` -> `GamePage` local mode; `/` -> `LobbyPage`)
  - `frontend/src/pages/GamePage.tsx` (multiplayer REST + `/ws/games/:gameId` lifecycle, `WaitingForPlayers` staging, live `GameTable` / `SortBar` / `ActionBar` / `SoundEngine` / right-sidebar clock & results, spectator view)
  - `frontend/src/types/multiplayer.ts` & `frontend/src/api/gameSocket.ts` (typed M1-compatible multiplayer view & WS action dispatch)
- [ ] **QA Testability (< 15 seconds):**
  - Clicking `[data-testid="qa-active-match"]`, `[data-testid="qa-invite-room"]`, or `[data-testid="qa-spectator-match"]` on `LobbyPage` navigates directly to `/g/<gameId>` and renders the full original Milestone 1 `GamePage` interface (active table, waiting invite staging, or read-only spectator table) with zero trace of `MultiplayerGamePage`.
- [ ] **Do NOT modify** `README.md`, `ARCHITECTURE.md`, `LobbyPage.tsx`, `QuickPairingTab.tsx`, `CreateInviteTab.tsx`, `LobbyPoolTab.tsx`, `QaLobbyPresets.tsx`, or any `backend/` files in this ticket.

## Scope & Files
- DELETE `frontend/src/pages/MultiplayerGamePage.tsx`
- DELETE `frontend/src/pages/MultiplayerGamePage.test.tsx`
- `frontend/src/types/multiplayer.ts`
- `frontend/src/api/gameSocket.ts`
- `frontend/src/app.tsx`
- `frontend/src/pages/GamePage.tsx`
- `frontend/src/styles/lobby.css` (only removing dead `MultiplayerGamePage`-only placeholder styles if present)
- `frontend/src/__tests__/GamePage.test.tsx`
- `frontend/src/__tests__/app.test.tsx`
- `frontend/src/api/multiplayerClients.test.ts`

## Verification Plan
1. Verify `MultiplayerGamePage.tsx` and `MultiplayerGamePage.test.tsx` are completely deleted and zero imports/references to `MultiplayerGamePage` remain anywhere in `frontend/src/`.
2. Add/update tests in `frontend/src/__tests__/GamePage.test.tsx` and `frontend/src/__tests__/app.test.tsx` covering:
   - `/g/:gameId` renders `GamePage` (not a placeholder) in `WaitingForPlayers` (with invite copy, Join/Leave controls), `InProgress` (with `GameTable`, `SortBar`, `ActionBar`, `00:XX` turn clock, and WebSocket action dispatch), `Finished` (with winner/durak results), and read-only Spectator mode (zero hand cards leaked).
   - Legacy `#/g/:gameId?player=p0` M1 local/bot mode continues to pass all existing tests.
3. Run `cd frontend && npm test -- --run` and `cd frontend && npm run build` (or TypeScript typecheck) and ensure all tests and build pass cleanly.
4. Write concise summary in `.reviews/agent_notes.md`, then run `echo "DONE" > .tickets/STATUS`.
