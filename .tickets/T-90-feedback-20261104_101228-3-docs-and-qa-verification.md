<!-- WAVE:3 -->
# Ticket `T-90-feedback-20261104_101228-3-docs-and-qa-verification` (WAVE:3)
**Summary:** Synchronize `./README.md`, `./ARCHITECTURE.md`, and `./play-local.sh` with the single tight `.hand-cards` highlight outline (`Previous-4`) and the distinct semantic feature color architecture (`Item 1`), and verify the full backend and frontend test suites.

---

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-DOCS (Real-Time Documentation & Launcher Synchronization):**
  - Update `./README.md` to ensure the User Interface & Gameplay Guide and the `⚡ QA Scenario Presets` table accurately document:
    1. **Single Hand Highlight Outline (`Previous-4` / `ITEM-PREV-4a`, `ITEM-PREV-4b`):** Only the inner `.hand-cards` element renders the pulsing highlight outline around the cards themselves (crimson for defending while uncovered attacks remain, including during the 3-second defenseless auto-surrender countdown until `Surrender` is pressed or auto-fires; emerald for attacking/throwing in), while the outer `[data-zone="player-hand"]` column (`border: none; outline: none; box-shadow: none; background: transparent; animation: none`) never renders a second, vertically wider outline in either Dark or Light mode.
    2. **Consistent & Distinct Semantic Feature Colors (`Item 1` / `ITEM-1a`, `ITEM-1b`, `ITEM-1c`):** Document the 6 non-overlapping color families across Dark and Light themes:
       - Royal Blue / Cobalt (`--ui-select-*`) for UI customization menus (`Theme`, `Table`, `Card Back`, `Sound`), sliders, Lobby controls, `POV` tabs, and `HAND SORTING` buttons.
       - Emerald Green (`--role-attacker-*`) for active attacker `PLAYERS` row, attacking/throw-in `.hand-cards` glow, attack target outlines, and `Pass` button.
       - Crimson Red (`--role-defender-*`) for active defender `PLAYERS` row, defending `.hand-cards` glow, uncovered attacking cards, and `Surrender` button.
       - Gold / Bronze (`--trump-*`) for trump card borders, corner trump badges, and the `DECK` trump pill.
       - Royal Violet / Purple (`--redirect-*`) for the `Perevod` reflection outline (`[data-testid="redirect-outline"]`) and its directional arrow.
       - Cyan / Teal (`--clock-active-*`) for the active `Game` / `Turn` clock half (and warm orange-amber for the final 5-second countdown).
    3. **15-Second QA Verification Flow:** Document how to verify both items immediately using the `Guest` Profile menu and the 1-click `⚡ QA Scenarios` presets (`Defenseless Auto-Surrender`, `Surrender Half-Off`, `3P Redirect (Bob POV)`, `4P Chaos Targets`).
  - Update `./ARCHITECTURE.md` to ensure the frontend styling architecture (`frontend/src/app.css`, `frontend/src/styles/table.css`) and component reference (`HeaderBar.tsx`, `GameTable.tsx`, `GamePage.tsx`, `SortBar.tsx`, `LobbyPage.tsx`) accurately describe the single `.hand-cards` highlight invariant and the 6 semantic CSS variable families.
  - Inspect `./play-local.sh` to confirm it cleanly launches both backend (`:8080`) and frontend (`:5173`) servers without error.
  - Run both automated test suites (`cd backend && sbt -batch test` and `cd frontend && npm test -- --run`) and confirm 100% pass rate.

---

## End-to-End Wiring & Files to Inspect / Modify
1. **`./README.md`:** Verify and update UI documentation and QA preset walkthroughs.
2. **`./ARCHITECTURE.md`:** Verify and update technical reference for CSS Grid zones, hand highlight scoping, and semantic color tokens.
3. **`./play-local.sh`:** Verify launcher script integrity.
