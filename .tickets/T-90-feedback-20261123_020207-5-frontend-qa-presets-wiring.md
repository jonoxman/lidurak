<!-- WAVE:3 -->
# T-90-feedback-20261123_020207-5: Wire Fast Bots QA Preset & End-to-End Page Verification (Frontend)

## Objective
Wire the new `'Fast Bots (75% Faster)'` (`qa-fast-bots`) 1-click QA Scenario Preset into the Lobby and GamePage Left Sidebar so the human reviewer can test the 75% faster bot move cadence in under 5 seconds, and add page-level tests verifying both `qa-fast-bots` and `qa-table-collapse-right` end-to-end wiring.

## Scope & Target Files (Frontend API Client & Pages Only)
- `frontend/src/api/client.ts`
- `frontend/src/pages/LobbyPage.tsx`
- `frontend/src/pages/GamePage.tsx`
- `frontend/src/__tests__/LobbyPage.test.tsx`
- `frontend/src/__tests__/GamePage.test.tsx`
- **STRICT FORBIDDEN FILES:** Do NOT edit `README.md`, `ARCHITECTURE.md`, `play-local.sh`, `backend/*`, `frontend/src/components/GameTable.tsx`, `frontend/src/utils/handLayout.ts`, or `frontend/src/styles/table.css`.

## Implementation Requirements
1. **Wire `'Fast Bots (75% Faster)'` (`qa-fast-bots`) QA Preset (`client.ts`, `LobbyPage.tsx`, `GamePage.tsx`):**
   - Inspect the exact preset ID and payload added by Wave 2 (`T-90-feedback-20261123_020207-3-backend-bot-speed.md`) in `GameRoutes.scala` / `GameManager.scala` (read-only inspection) and add `qa-fast-bots` to the QA Scenario Preset registry in `frontend/src/api/client.ts` (if typed/enumerated there).
   - Add a 1-click `'Fast Bots (75% Faster)'` preset trigger button to the QA Scenarios section in BOTH `frontend/src/pages/LobbyPage.tsx` and `frontend/src/pages/GamePage.tsx` (`[data-zone="sidebar-left"]`), following the exact Lichess CSS Grid layout and zero-overlap spatial rules.
   - Clicking `'Fast Bots (75% Faster)'` creates/loads the `qa-fast-bots` backend preset and navigates directly to `#/g/<gameId>?player=<defaultPlayerId>` so the reviewer immediately sees the 3 bots playing moves 75% faster.
2. **Page-Level End-to-End Integration Tests (`LobbyPage.test.tsx`, `GamePage.test.tsx`):**
   - Add tests verifying the `'Fast Bots (75% Faster)'` (`qa-fast-bots`) preset button renders in both `LobbyPage` and `GamePage` (`[data-zone="sidebar-left"]`) and triggers the `qa-fast-bots` API call and navigation cleanly.
   - Add a `GamePage.test.tsx` regression test simulating the `'Table Collapse (Edge & Row)'` (`qa-table-collapse-right`) game view state where the active user plays the first valid card and immediately receives an updated view with the second valid card still playable, verifying `GamePage` dispatches both `throwIn` actions cleanly without blocking or suppressing the second move.

## End-to-End Wiring
- **Frontend API & Pages:** `frontend/src/api/client.ts`, `frontend/src/pages/LobbyPage.tsx`, `frontend/src/pages/GamePage.tsx` (`[data-zone="sidebar-left"]`).
- **QA Scenario Testability (< 15 seconds):**
  - 1 click on `'Fast Bots (75% Faster)'` (`qa-fast-bots`) in Lobby or Left Sidebar immediately demonstrates 75%-faster bot moves.
  - 1 click on `'Table Collapse (Edge & Row)'` (`qa-table-collapse-right`) in Lobby or Left Sidebar immediately allows testing both valid attack/throw-in cards.

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-NEW3 (UI Preset Wiring — Verbatim):** *"Reduce the time spent for the bots to make their moves by 75%."* — Reviewer can launch `'Fast Bots (75% Faster)'` (`qa-fast-bots`) in 1 click from `LobbyPage.tsx` or `GamePage.tsx` (`[data-zone="sidebar-left"]`) and immediately observe rapid bot moves in under 15 seconds.
- [ ] **ITEM-NEW1 (End-to-End Page Verification — Verbatim):** *"Potential bug: In the Table Collapse QA scenario, the active user can send only one card to attack, even though there are two valid cards to play. I don't see a reason for this, since the target player has 4 cards remaining in hand."* — `GamePage.test.tsx` verifies two consecutive valid attack/throw-in dispatches succeed cleanly in the Table Collapse scenario state.
- [ ] Zero CSS Grid overlaps, no `position: absolute`/`fixed` layout hacks, and zero table text clutter introduced in `LobbyPage.tsx` or `GamePage.tsx`.
- [ ] `LobbyPage.test.tsx` and `GamePage.test.tsx` pass with full coverage of the new `'Fast Bots (75% Faster)'` preset trigger and Table Collapse consecutive throw-in flow.
- [ ] Run `cd frontend && npm test -- --run` and confirm 100% pass.
- [ ] Write a concise summary in `.reviews/agent_notes.md`, then run `echo "DONE" > .tickets/STATUS`.
