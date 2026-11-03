<!-- WAVE:3 -->
# Ticket `T-90-feedback-20261103_172808-3-docs-and-verification`: Synchronize Living Documentation (`README.md`, `ARCHITECTURE.md`, `play-local.sh`) & Full Stack Verification

## Summary
Update `./README.md`, `./ARCHITECTURE.md`, and verify `./play-local.sh` so all project documentation accurately reflects the single tight `.hand-cards` highlight outline (with no outer vertically wider outline on `[data-zone="player-hand"]`) and the consistent, distinct semantic color system across UI customization menus, chrome controls, and gameplay features in Dark and Light modes.

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-PREV-4a, ITEM-PREV-4b & ITEM-1c Documentation Synchronization:**
  - Update `./README.md`:
    - Document the distinct semantic color system across Dark and Light themes:
      - **Royal Blue (`#3b82f6` dark / `#1d4ed8` light):** UI customization menus (`Theme`, `Table`, `Card Back`, `Sound` selected options, swatches, and sliders), active `POV` tab, active `HAND SORTING` mode, `⚡ QA Scenarios` / `Replay` controls, and Lobby selectors / `Create Game` button.
      - **Emerald Green (`#22c55e` dark / `#15803d` light):** Active attacker row in `PLAYERS`, attacker/throw-in hand glow (`.hand-cards[data-highlight-variant="attacker"]`) in both Dark and Light themes, attack target outlines, and `Pass` button.
      - **Crimson Red (`#ef4444` dark / `#b91c1c` light):** Active defender row in `PLAYERS`, pre-surrender defender hand glow (`.hand-cards[data-highlight-variant="defender"]`), uncovered attacking card pulse, and `Surrender` button.
      - **Gold / Bronze (`#f59e0b` dark / `#b45309` light):** Trump card border glow, corner trump badge, and `TRUMP` suit badge.
      - **Violet / Purple (`#a855f7` dark / `#7e22ce` light):** Reflection (`Perevod`) redirect outline (`[data-testid="redirect-outline"]`) and arrow.
      - **Cyan / Teal (`#22d3ee` dark / `#0e7490` light):** Active `Game` / `Turn` clock half.
    - Document that the hand turn-highlight outline is rendered exclusively on `.hand-cards` tightly wrapping the cards themselves, while `[data-zone="player-hand"]` never draws a second vertically wider border, outline, or box-shadow.
  - Update `./ARCHITECTURE.md`:
    - Update the Frontend Architecture & CSS styling reference sections to describe the single `.hand-cards` highlight outline invariant and the semantic color token separation (`--ui-select-*`, `--role-attacker-*`, `--role-defender-*`, `--trump-*`, `--redirect-*`, `--clock-active-*`).
  - Verify `./play-local.sh` remains clean, executable, and aligned with current backend (`:8080`) and frontend (`:5173`) startup commands.
- [ ] **End-to-End Test Suite Verification:**
  - Run `cd backend && sbt -batch test` and `cd frontend && npm test -- --run` and confirm all backend and frontend test suites pass with zero errors.
