<!-- WAVE:2 -->
# T-90-feedback-20261122_193457-5: Wire New QA Scenario Presets into Frontend Client, LobbyPage & GamePage Sidebar

## Objective
Expose the two new backend QA scenario presets (`qa-table-collapse-right` and `qa-surrender-timer`) alongside the 4 existing current-round presets in `frontend/src/api/client.ts`, `LobbyPage.tsx`, and `GamePage.tsx` (`[data-zone="sidebar-left"]`) so the human reviewer can launch every current-round test scenario (Items 1, 3, 4, and 6) in 1 click from either the Lobby or the in-game Left Sidebar.

## Scope & Owned Files
- `frontend/src/api/client.ts`
- `frontend/src/pages/LobbyPage.tsx`
- `frontend/src/pages/GamePage.tsx`
- `frontend/src/__tests__/LobbyPage.test.tsx`
- `frontend/src/__tests__/GamePage.test.tsx`
- **DO NOT** edit `GameTable.tsx`, `table.css`, `handLayout.ts`, `tableLayout.ts`, `TablePair.tsx`, `Card.tsx`, `README.md`, or `ARCHITECTURE.md`.

## Technical Design Requirements

1. **Update `QA_SCENARIOS` in `frontend/src/api/client.ts`:**
   - Keep the 4 existing current-round presets and add the 2 new presets for this round (total = 6 focused presets, zero obsolete presets):
     1. `qa-table-collapse-right` — Label: `Table Collapse (Edge & Row)` (tests Item 1: `top-right` defender with 3 covered + 2 uncovered cards; POV switch to `p1`/`p2`/`p3` tests `top-center`, `top-left`, and bottom left-edge snapping!)
     2. `qa-surrender-timer` — Label: `Active Surrender & Timer` (tests Item 4: active user `p0` in `SurrenderThrowIn` with incoming cards and live turn timer)
     3. `qa-normal-6-actions` — Label: `6-Card 10s & Actions` (tests Item 6 small-hand parting & Item 3 center-locked drag)
     4. `qa-medium-14-expand` — Label: `14-Card Expand Box` (tests Item 3 center-locked drag & Item 6 parting)
     5. `qa-large-30-compress` — Label: `30-Card Compress & Part` (tests Item 3 center-locked drag & Item 6 smooth compressed parting)
     6. `qa-single-card` — Label: `1-Card Hand (No Part)` (tests Item 6 1-card parting suppression & Item 3 drag)
   - Clicking any scenario triggers `POST /api/games/preset` with `{"preset": scenario.id}` and navigates to `#/g/<gameId>?player=<defaultPlayerId>`.

2. **Wire in `LobbyPage.tsx` and `GamePage.tsx`:**
   - Verify both `LobbyPage.tsx` and `GamePage.tsx` (`[data-zone="sidebar-left"]`) render directly from `QA_SCENARIOS` so both locations display the exact same 6 QA scenario buttons cleanly without overflow or layout breakage.
   - Ensure switching between presets from `[data-zone="sidebar-left"]` in `GamePage.tsx` cleanly loads the new game ID and `defaultPlayerId`.

3. **Update Frontend Tests:**
   - Update `frontend/src/__tests__/LobbyPage.test.tsx` and `frontend/src/__tests__/GamePage.test.tsx` to assert the updated 6 `QA_SCENARIOS` buttons appear in both `LobbyPage` and `GamePage`'s `[data-zone="sidebar-left"]`, and verify clicking `Table Collapse (Edge & Row)` sends `{"preset":"qa-table-collapse-right"}` and clicking `Active Surrender & Timer` sends `{"preset":"qa-surrender-timer"}`.

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-1e (QA Testability for Item 1):** `Table Collapse (Edge & Row)` (`qa-table-collapse-right`) is wired into `QA_SCENARIOS` in `client.ts`, rendered in `LobbyPage.tsx` and `[data-zone="sidebar-left"]` of `GamePage.tsx`, and sends `POST /api/games/preset` with `{"preset":"qa-table-collapse-right"}`.
- [ ] **ITEM-4b (QA Testability for Item 4):** `Active Surrender & Timer` (`qa-surrender-timer`) is wired into `QA_SCENARIOS` in `client.ts`, rendered in `LobbyPage.tsx` and `[data-zone="sidebar-left"]` of `GamePage.tsx`, and sends `POST /api/games/preset` with `{"preset":"qa-surrender-timer"}`.
- [ ] All 4 existing current-round presets (`qa-normal-6-actions`, `qa-medium-14-expand`, `qa-large-30-compress`, `qa-single-card`) remain wired and functional in both `LobbyPage.tsx` and `GamePage.tsx` (exact total = 6 current-round presets, no obsolete legacy presets).
- [ ] Tests updated and passing in `frontend/src/__tests__/LobbyPage.test.tsx` and `frontend/src/__tests__/GamePage.test.tsx`.
- [ ] Run `npm test -- --run` in `frontend/` and verify all tests pass.
- [ ] Write a concise summary to `.reviews/agent_notes.md` and run `echo "DONE" > .tickets/STATUS` only after all tests pass.

