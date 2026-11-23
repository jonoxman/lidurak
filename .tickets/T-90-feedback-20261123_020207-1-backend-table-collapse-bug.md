<!-- WAVE:1 -->
# T-90-feedback-20261123_020207-1: Fix Table Collapse QA Scenario Multi-Card Attack / Throw-In Bug (Backend)

## Objective
Diagnose and fix the backend engine, view, and/or preset bug causing the active player in the `'Table Collapse (Edge & Row)'` QA scenario (`qa-table-collapse-right`) to only be able to play one attack/throw-in card even though they hold two valid matching-rank cards and the defending player still has 4 cards remaining in hand.

## Scope & Target Files (Backend Only)
- `backend/src/main/scala/durak/engine/GameEngine.scala`
- `backend/src/main/scala/durak/engine/GameState.scala`
- `backend/src/main/scala/durak/engine/PlayerGameView.scala`
- `backend/src/main/scala/durak/server/GameManager.scala`
- `backend/src/main/scala/durak/server/GameRoutes.scala`
- `backend/src/test/scala/durak/server/PresetSuite.scala`
- `backend/src/test/scala/durak/engine/ThrowInEligibilitySuite.scala` / `backend/src/test/scala/durak/engine/AttackDefenseSuite.scala`
- **STRICT FORBIDDEN FILES:** Do NOT edit `README.md`, `ARCHITECTURE.md`, `play-local.sh`, `frontend/*`, or `backend/src/main/scala/durak/server/GameActor.scala`.

## Root-Cause Investigation & Implementation Requirements
1. **Audit the `'Table Collapse (Edge & Row)'` (`qa-table-collapse-right`) preset construction** in `GameManager.scala` / `GameRoutes.scala`:
   - Inspect `tablePairs.size`, `covered` vs `uncovered` counts, `defenderInitialHandSize`, `defender.hand.size` (4 cards), `boutPhase`, `attackerIdx`, `defenderIdx`, and the active user's hand (specifically the two valid matching-rank cards).
   - Verify whether the preset itself inadvertently hits the 6-card bout cap (`tablePairs.size == 5`, leaving `maxBoutAttacks - tablePairs.size == 1`) or sets `defenderInitialHandSize` incorrectly (e.g., equal to remaining hand size `4` instead of initial hand size before covering).
   - Ensure the `qa-table-collapse-right` preset maintains its visual purpose (multiple edge-collapsed covered pairs pinned to the `top-right` defender edge + active uncovered card(s) in the single table row + `top-right` defender holding 4 cards + active player holding 2 valid playable cards) while leaving enough bout attack capacity (`maxBoutAttacks - tablePairs.size >= 2` and `defender.hand.size - uncoveredCount >= 2`) so BOTH valid cards are genuinely legal to play under official Durak rules!
2. **Audit Durak Attack / Throw-In Capacity & Legality Rules** in `GameEngine.scala`, `GameState.scala`, and `PlayerGameView.scala`:
   - Verify `applyThrowInCards` and `candidateActions` / `legalActions` enforce exact Durak capacity:
     - Total bout attacks after throw-in: `state.tablePairs.size + cards.size <= state.maxBoutAttacks` (where `maxBoutAttacks = Math.min(6, defenderInitialHandSize)`).
     - Uncovered attacks after throw-in: `state.uncoveredCount + cards.size <= defender.hand.size` (NEVER double-counting already-covered pairs against the defender's remaining hand size!).
   - Verify that during `BoutPhase.Defense`, an eligible attacker (`playerIdx != defenderIdx && !player.hasPassed`) who throws in one valid matching card can IMMEDIATELY throw in a second valid matching card even while uncovered cards exist on the table, without being locked out by `isThrowInPhase`, `promptedPlayerIds`, `canThrowIn`, `throwInCards`, `throwInCapacity`, or `legalActions`.
   - Verify `PlayerGameView.forViewer` reports accurate `canThrowIn`, `throwInCards`, `throwInCapacity`, and `legalActions` both BEFORE playing the first valid card AND IMMEDIATELY AFTER playing the first valid card (so the second valid card remains listed as playable with `throwInCapacity >= 1` and `canThrowIn == true`).
3. **Preserve Existing Rules & Invariants:**
   - Do not weaken the 6-card Durak bout ceiling (`Math.min(6, defenderInitialHandSize)`), defender-hand uncovered limit (`uncoveredCount <= defender.hand.size`), or throw-in pass/surrender semantics verified by existing suites.

## End-to-End Wiring
- **Backend Route / Preset:** `GameRoutes.scala` & `GameManager.scala` (`qa-table-collapse-right` preset endpoint).
- **Backend Engine & View:** `GameEngine.applyThrowInCards`, `GameEngine.legalActions`, `GameState.maxBoutAttacks`, `PlayerGameView.forViewer` (`canThrowIn`, `throwInCards`, `throwInCapacity`, `legalActions`).
- **QA Scenario Testability (< 15 seconds):** The existing 1-click `'Table Collapse (Edge & Row)'` QA preset (`qa-table-collapse-right`) directly exposes this exact scenario immediately on click.

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-NEW1 (Verbatim):** *"Potential bug: In the Table Collapse QA scenario, the active user can send only one card to attack, even though there are two valid cards to play. I don't see a reason for this, since the target player has 4 cards remaining in hand."*
- [ ] In `qa-table-collapse-right`, the target (`top-right`) defender has 4 cards remaining in hand, covered pairs are present for edge-collapse testing, uncovered pair(s) are present on the single table row, and the active user holds 2 valid playable cards.
- [ ] Both valid playable cards can be played sequentially (1st card succeeds, and immediately afterward `PlayerGameView` still reports `canThrowIn == true`, `throwInCapacity >= 1`, and includes the 2nd valid card in `throwInCards`, and submitting the 2nd card via `GameEngine.applyAction` succeeds without error).
- [ ] Submitting both cards as a multi-card `ThrowInCards` (if supported by the engine) or as two consecutive single-card `ThrowInCards` actions works cleanly while respecting `tablePairs.size <= Math.min(6, defenderInitialHandSize)` and `uncoveredCount <= defender.hand.size`.
- [ ] Automated tests in `PresetSuite.scala` and `ThrowInEligibilitySuite.scala` explicitly cover loading `qa-table-collapse-right`, playing the first valid card, asserting the second valid card remains legal in `PlayerGameView`, and playing the second valid card successfully.
- [ ] Run `cd backend && sbt -batch test` and confirm 100% pass with zero warnings/regressions.
- [ ] Write a concise summary of root cause and fix in `.reviews/agent_notes.md`, then run `echo "DONE" > .tickets/STATUS`.
