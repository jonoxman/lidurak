<!-- WAVE:3 -->
# T-90-feedback-20261124_002056-6: Frontend Persistent Quick Pairing Searching Queue, Real-Time Match Navigation & QA Triggers

## Context & Objective
With Wave 2's backend deferred-room `QuickPairingService` and session-scoped `/ws/lobby` `quickPairMatched` push in place, this ticket updates the frontend lobby client, `QuickPairingTab`, `LobbyPage`, and `QaLobbyPresets` so clicking any quick-pairing tile keeps the user on the Lobby screen with the searching status visible until a match is actually found (or cancelled), and wires 1-click QA presets so a human reviewer can verify the searching → matched transition and small-hand hover animation in under 15 seconds.

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-1b (Verbatim — QA Response #6 Frontend):** "Clicking the quick pairing 2P 15s tile displays the searching status for a split second, but immediately places the user into the new room that was just created. The correct behavior would be that players in the quick pairing queue are not considered to be active players within a room until a match has been found, so they should stay on the lobby screen with the searching status until then."
- [ ] **Typed Client & Real-Time `/ws/lobby` Match Handling (`frontend/src/types/multiplayer.ts` & `frontend/src/api/lobbyClient.ts`):**
  - Update `QuickPairResponse` to a discriminated union:
    - `{ status: 'searching'; playerCount: number; turnTimeoutSeconds: number; allowRedirect: boolean; queuedCount: number; requiredCount: number }`
    - `{ status: 'matched'; gameId: string; seatIndex: number }`
  - Update `LobbyWsMessage` / `connectLobbySocket` to parse and emit `{ type: 'quickPairMatched'; gameId: string; seatIndex: number }` events from `/ws/lobby`.
  - Add `triggerQaQuickPairOpponent()` calling `POST /api/qa/presets/quick-pair-opponent` and `launchQaSmallHandMatch()` calling `POST /api/qa/presets/active-match` with `{ playerCount: 2, handSize: 4 }` (matching the Wave 2 Ticket 4 backend preset contract).
- [ ] **Persistent Lobby Searching State (`frontend/src/pages/LobbyPage.tsx` & `frontend/src/components/lobby/QuickPairingTab.tsx`):**
  - Keep `/ws/lobby` connected while on `LobbyPage` (specifically including while the `Quick Pairing` tab is active / searching, not solely on the `Lobby Pool` tab) so `quickPairMatched` events are received immediately without refreshing.
  - When the user clicks any Quick Pairing tile (e.g., `[data-testid="quick-pair-2-15"]`):
    - Call `POST /api/quick-pair`.
    - If the response is `{ status: 'searching', ... }`: **remain on `LobbyPage`** (`window.location.pathname === '/'`) and keep `[data-testid="quick-pair-searching"]` (`role="status"`) visible with the spinner, active queue label (e.g., `"Searching for a 2P • 15s table… (1/2)"`), and `"Cancel"` button.
    - If the response is `{ status: 'matched', gameId }` (completing player) OR when a `quickPairMatched` WebSocket frame arrives on `/ws/lobby` (previously waiting player): clear the searching state and navigate via History API to `/g/<gameId>` (opening the live M1 `GamePage` match).
  - Clicking `"Cancel"` inside `[data-testid="quick-pair-searching"]` calls `DELETE /api/quick-pair`, clears the searching status, and stays on `LobbyPage`.
  - If the user clicks a different Quick Pairing tile while already searching or unmounts/leaves cleanly, handle state transitions without stale callbacks or duplicate navigations.
- [ ] **1-Click QA Scenario Presets (`frontend/src/components/lobby/QaLobbyPresets.tsx`):**
  - Add a 1-click button `[data-testid="qa-quick-pair-opponent"]` (e.g., `"Match queued quick-pair opponent"`) in `QaLobbyPresets.tsx` (and/or actionable while searching) that calls `POST /api/qa/presets/quick-pair-opponent` so a human reviewer can click `2P • 15s`, confirm they remain on the Lobby screen with the searching status, and then click `[data-testid="qa-quick-pair-opponent"]` to watch themselves transition into the matched live M1 `GamePage` room in under 15 seconds.
  - Add a 1-click button `[data-testid="qa-small-hand-match"]` (e.g., `"Launch small-hand match (4 cards)"`) in `QaLobbyPresets.tsx` that launches an active 2P match with a 4-card hand so a human reviewer can immediately test the constant-width small-hand mouseover animation (New #4) in 1 click on any screen width.
- [ ] **End-to-End Wiring Points:**
  - `frontend/src/types/multiplayer.ts` (`QuickPairResponse` union, `quickPairMatched` WS frame)
  - `frontend/src/api/lobbyClient.ts` (`joinQuickPair`, `cancelQuickPair`, `connectLobbySocket`, QA preset client calls)
  - `frontend/src/pages/LobbyPage.tsx` (persistent `/ws/lobby` subscription handling `quickPairMatched` -> `navigate('/g/' + gameId)`)
  - `frontend/src/components/lobby/QuickPairingTab.tsx` (persistent searching banner until matched or cancelled)
  - `frontend/src/components/lobby/QaLobbyPresets.tsx` (`qa-quick-pair-opponent` and `qa-small-hand-match` 1-click triggers)
- [ ] **Do NOT modify** `README.md`, `ARCHITECTURE.md`, or any `backend/` files in this ticket.

## Scope & Files
- `frontend/src/types/multiplayer.ts`
- `frontend/src/api/lobbyClient.ts`
- `frontend/src/api/multiplayerClients.test.ts`
- `frontend/src/components/lobby/QuickPairingTab.tsx`
- `frontend/src/components/lobby/QaLobbyPresets.tsx`
- `frontend/src/pages/LobbyPage.tsx`
- `frontend/src/pages/LobbyPage.test.tsx`
- `frontend/src/__tests__/LobbyPage.test.tsx`

## Verification Plan
1. Update/add tests in `frontend/src/api/multiplayerClients.test.ts`, `frontend/src/pages/LobbyPage.test.tsx`, and `frontend/src/__tests__/LobbyPage.test.tsx` verifying:
   - Clicking `2P • 15s` when server returns `{ status: 'searching', ... }` keeps `[data-testid="quick-pair-searching"]` visible and does NOT navigate away from `/`.
   - Clicking `Cancel` calls `DELETE /api/quick-pair` and hides `[data-testid="quick-pair-searching"]`.
   - Receiving a `{ type: 'quickPairMatched', gameId: 'abc12345', seatIndex: 0 }` message over `/ws/lobby` while searching navigates to `/g/abc12345`.
   - Receiving immediate `{ status: 'matched', gameId: 'xyz98765', seatIndex: 1 }` from `POST /api/quick-pair` navigates directly to `/g/xyz98765`.
   - Clicking `[data-testid="qa-quick-pair-opponent"]` and `[data-testid="qa-small-hand-match"]` invokes their respective QA preset endpoints cleanly.
2. Run `cd frontend && npm test -- --run` and `cd frontend && npm run build` and ensure all tests and build pass.
3. Write concise summary in `.reviews/agent_notes.md`, then run `echo "DONE" > .tickets/STATUS`.
