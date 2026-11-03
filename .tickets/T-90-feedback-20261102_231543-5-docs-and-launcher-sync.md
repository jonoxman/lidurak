<!-- WAVE:4 -->
# Ticket T-90-5: Real-Time Documentation & Launcher Synchronization (`README.md`, `ARCHITECTURE.md`, `play-local.sh`)

## Scope & Files to Touch
- **Touch ONLY these files:**
  - `README.md`
  - `ARCHITECTURE.md`
  - `play-local.sh` (verify/keep synchronized if any startup details changed)
- **DO NOT modify `backend/` or `frontend/` source code in this ticket.**

---

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-DOCS (`README.md` & `ARCHITECTURE.md` Synchronization):**
  1. **`README.md` Updates:**
     - Document **Chaos Mode** full compatibility: initial attacker can target any active player holding cards by dragging onto any of the multiple target outlines (`data-testid="target-outline-<id>"`) positioned near each player's edge/corner of the shaded play area, and reflections (`Perevod`) redirect to a randomly chosen eligible player.
     - Document the **Statically Centered Shaded Play Area**: `.battlefield-tinted-box` stays statically centered and fixed in size (never shifting with the active player and never expanding when a player runs out of cards); cards and outlines anchor near the target player's edge/corner with a small margin; during surrender throw-ins, cards move half-on and half-off the shaded play area toward the surrendering player's box.
     - Document **Immediate Auto-Pass on Surrender**: players with no legal throw-in cards automatically pass with zero timed delay during the surrender phase.
     - Document **Hand Turn-Highlight Alignment**: when all cards in the player's hand are legal to play, the hand turn-highlight outline moves upward to match the lifted cards' position.
     - Document **Table Brightness Calibration**: default slider remains at `100%`, while absolute brightness is calibrated slightly darker in light mode and slightly lighter in dark mode (with dark mode still darker than light mode).
     - Document **Discard Pile Stack vs Overlap**: face-down discard cards remain in a single stack with no hover animation, while visible face-up cards from the last bout use the responsive overlap row.
     - Document **`HAND SORTING` Below the Game Table**: the hand sorting control (`HAND SORTING`) sits directly below the center felt table rather than in the right sidebar.
     - Document **`PLAYERS` List Enhancements**: attacker and defender name tags are outlined with their respective highlight colors, card counts stay horizontally centered in each player row even when status tags appear, and the last remaining player at game end is labeled `DURAK`.
     - Document **Game-Over `Rematch` Button & Review Mode Improvements**: 1-click `Rematch` with the same players/bots/variants, POV switching in review mode preserves the current move index, move sounds replay as you step through moves, non-moves are excluded from replay steps, and bot seats reject manual user move input.
     - Document the **1-Click QA Scenarios** (`3P Redirect (Bob POV)`, `4P Chaos Targets`, `Surrender Half-Off`, `Discard & Endgame Durak`).
  2. **`ARCHITECTURE.md` Updates:**
     - Update Section 2.1 (`GameEngine` & `GameAction`): remove the outdated note saying *"Chaos Mode Variant (not implemented in the engine yet)"* and document `GameConfig.chaosMode`, `GameAction.InitialAttack(cards, targetPlayerId)`, `eligibleInitialTargets`, `eligibleRedirectTargets`, `autoPassSurrenderThrowers`, and `GameReplay` non-move filtering.
     - Update Section 2.2 & 2.3 (`PlayerGameView`, `GameActor`, `GameRoutes`): document `isBot`, `eligibleTargetIds`, `redirectTargetId`, bot-seat client input rejection, and `POST /api/games/preset`.
     - Update Section 3 (`GamePage.tsx`, `GameTable.tsx`, `tableTextures.ts`): document `[data-zone="hand-sort-box"]` (`HAND SORTING`) placement below `[data-zone="table-arena"]`, static `.battlefield-tinted-box` sizing and edge/corner card anchoring, half-on/half-off surrender positioning, single-stack face-down discard vs overlapping face-up discard cards, `PLAYERS` 3-column centered card count & attacker/defender outlines & `DURAK` tag, `Rematch` button, and replay POV preservation + sound playback.
  3. **Run Full Backend & Frontend Verification Suites:**
     - Run `cd backend && sbt -batch test` and `cd frontend && npm test -- --run` to ensure the entire project builds and passes all tests cleanly.

---

## Verification Commands
```bash
cd backend && sbt -batch test
cd frontend && npm test -- --run
```
