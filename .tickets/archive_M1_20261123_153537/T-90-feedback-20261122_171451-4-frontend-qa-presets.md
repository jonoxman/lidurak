<!-- WAVE:2 -->
# Ticket: Frontend QA Scenario Preset Reduction & 1-Click Wiring

## Context & Objective
Update the frontend QA Scenario Preset catalog and 1-click triggers in `LobbyPage.tsx`, `GamePage.tsx` (`[data-zone="sidebar-left"]`), and `api/client.ts` to match the reduced 4-preset backend catalog from Wave 1 Ticket 1 (Item #9), removing all obsolete QA scenario buttons from previous rounds so the UI presents only the lean set of scenarios needed for this round's QA testing.

## Target Files (Preset Wiring ONLY — Do Not Touch `GameTable.tsx`, `Card.tsx`, `ActionBar.tsx`, `handLayout.ts`, `table.css`, `README.md`, or `ARCHITECTURE.md`)
- `frontend/src/api/client.ts` (update preset IDs / types / catalog if defined here)
- `frontend/src/pages/LobbyPage.tsx` (update QA preset buttons if rendered in Lobby)
- `frontend/src/pages/GamePage.tsx` (update QA preset triggers inside `[data-zone="sidebar-left"]`)
- `frontend/src/__tests__/LobbyPage.test.tsx`
- `frontend/src/__tests__/GamePage.test.tsx`

## Implementation Requirements
1. **Prune Obsolete QA Scenarios (Item #9):**
   - Remove all obsolete QA preset buttons/entries from previous rounds (e.g., old endgame, chaos, redirect, capacity-cap, throw-in-visibility-3p/4p, full-hand-pickup, huge-hand-36/52, surrender-half-off, etc.) from both `GamePage.tsx` (`[data-zone="sidebar-left"]`) and `LobbyPage.tsx` (wherever presets are listed).
2. **Wire the 4 Curated Current-Round Presets (1-Click Testability for Items #2–#8):**
   Wire exactly these 4 backend preset IDs (created in Wave 1 Ticket 1) into `[data-zone="sidebar-left"]` in `GamePage.tsx` (and Lobby if presets are surfaced there):
   - `qa-normal-6-actions` — `"6-Card 10s & Actions"` (verify `'10'` font/suit, 6-card default box, drag offset, timer clearance, hover parting, lower-table Surrender & Pass buttons via hotseat switch, two-tier raise)
   - `qa-medium-14-expand` — `"14-Card Expand Box"` (verify Option B expansion into maximal box at full card size, `'10'` visibility, drag, timer, parting, two-tier raise)
   - `qa-large-30-compress` — `"30-Card Compress & Part"` (verify full card size + super-overlap inside maximal box, smooth hover parting, rightmost drag, timer, lower-table Surrender button, two-tier raise)
   - `qa-single-card` — `"1-Card Hand (No Part)"` (verify 1-card hover-parting disabled, `'10'` typography, drag, timer, two-tier raise)
3. **Preserve Hotseat Player Switcher:**
   - Keep hotseat player-switcher tabs in `[data-zone="sidebar-left"]` working cleanly so switching between Bob (Surrender) and Alice (Pass + multi-select Throw-In) in `qa-normal-6-actions` takes 1 click.

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-9:** Only the 4 current-round QA scenarios (`qa-normal-6-actions`, `qa-medium-14-expand`, `qa-large-30-compress`, `qa-single-card`) appear in the live UI (`GamePage.tsx` `[data-zone="sidebar-left"]` and `LobbyPage.tsx` if applicable); all obsolete legacy QA scenario buttons are removed.
- [ ] Clicking any of the 4 preset buttons creates/loads the matching backend preset game cleanly and transitions immediately into the live playable table with active player hand and hotseat tabs.
- [ ] Update `frontend/src/__tests__/LobbyPage.test.tsx` and `frontend/src/__tests__/GamePage.test.tsx` to assert the reduced 4-preset list and remove assertions for pruned legacy presets.
- [ ] Run `cd frontend && npm test -- --run` and verify all tests pass.
- [ ] Do NOT edit `GameTable.tsx`, `Card.tsx`, `ActionBar.tsx`, `handLayout.ts`, `table.css`, `README.md`, or `ARCHITECTURE.md`.
