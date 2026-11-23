<!-- WAVE:3 -->
# Ticket 5 (Wave 3): Synchronize README.md, ARCHITECTURE.md & play-local.sh and Run Full Verification

## Scope & Files to Touch
- **Touch ONLY the living documentation and launcher files:**
  - `README.md`
  - `ARCHITECTURE.md`
  - `play-local.sh` (verify/update if needed)
- **Do NOT modify application source code unless fixing a failing test discovered during full-stack verification.**

## Mandatory Acceptance Criteria Checklist

- [ ] **Real-Time Documentation & Launcher Synchronization (`README.md`, `ARCHITECTURE.md`, `play-local.sh`):**
  - Update `README.md` to accurately document all 14 newly implemented changes:
    1. 4-player mode and table margin adjustments ensuring the full highlight aura fits inside the game table alone (`ITEM-1`).
    2. Removal of the green outline around the active user in the `PLAYERS` list, relying on ` (You)` (`ITEM-2`).
    3. High-contrast Light Theme colors for the `TRUMP` label under the deck and `WINNER`, `OUT`, `DURAK`, and `PASSED` labels in the `PLAYERS` list (`ITEM-3`).
    4. Renaming of the `Highlights` section in `Guest ▸ Theme` to `Palettes` (`ITEM-4`).
    5. Default Hand Sorting schema set to `Rank` for new users (`ITEM-5`).
    6. Manual drag-and-drop hand reorganization with parting card animation and automatic non-persistent `"Custom"` sort mode (`ITEM-6a`, `ITEM-6b`).
    7. Pointer finger cursor (`cursor: pointer`) throughout the entire card-dragging process (`ITEM-7`).
    8. Dedicated `"next"` card throw-in outline (`data-testid="throw-in-outline"`) next to played cards during an ongoing attack (`ITEM-8`).
    9. `RandomBot` `0.2s` (`200ms`) play delay and `2.0s` initial game-start delay (`ITEM-9a`, `ITEM-9b`).
    10. `"Transparent Mode"` lobby checkbox, `Transparent Mode` QA Scenario preset (`transparent-mode`), and low-detail rank/suit/trump opponent cards (`ITEM-10a`, `ITEM-10b`).
    11. Inverted (`180°`) rank symbol and suit icon on the bottom-right corner of every face-up card (`ITEM-11`).
    12. Removal of the glowing aura from trump cards and placement of symmetrical, mutually inverted trump highlight icons in both the top-right and bottom-left corners (`ITEM-12a`, `ITEM-12b`).
    13. 25% larger cards (`100px × 140px`) in the play area and active user's hand with single-row overlap and boundary enforcement (`ITEM-13`).
    14. Consolidation of `POV` switching into the `PLAYERS` list at the top of the left sidebar, removal of the separate `POV` element, and server-enforced `devMode` gating with the temporary Lobby toggle (`ITEM-14a`, `ITEM-14b`).
  - Update `ARCHITECTURE.md` to document `GameConfig.transparentMode`, `GameConfig.devMode`, `OpponentInfo.cards`, `PlayerGameView.transparentMode` / `devMode`, `GameActor` initial 2s bot delay + 0.2s `RandomBot` delay, server-side `requester` POV lock on `/api/games/:id/view`, `SortMode` `'custom'`, `100×140` card layout metrics, `throw-in-outline`, and the left-sidebar `PLAYERS` POV consolidation.
  - Verify `./play-local.sh` starts both backend (`:8080`) and frontend (`:5173`) cleanly.

## Verification
- Run `cd backend && sbt -batch test` and `cd frontend && npm test -- --run` and confirm 100% of backend and frontend tests pass.
