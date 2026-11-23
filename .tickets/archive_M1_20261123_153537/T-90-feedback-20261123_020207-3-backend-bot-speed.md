<!-- WAVE:2 -->
# T-90-feedback-20261123_020207-3: Reduce Bot Move Time by 75% & Add Fast Bots QA Preset (Backend)

## Objective
Reduce the time spent for bots to make their moves by **75%** (i.e., to 25% of the current move delay) across the backend actor scheduling loop, and add a dedicated `'Fast Bots (75% Faster)'` (`qa-fast-bots`) backend QA Scenario Preset so a human reviewer can observe rapid bot play in 1 click within seconds.

## Scope & Target Files (Backend Only)
- `backend/src/main/scala/durak/server/GameActor.scala`
- `backend/src/main/scala/durak/server/GameManager.scala`
- `backend/src/main/scala/durak/server/GameRoutes.scala`
- `backend/src/test/scala/durak/server/GameActorSuite.scala`
- `backend/src/test/scala/durak/server/PresetSuite.scala`
- `backend/src/test/scala/durak/server/ThrowInClockSuite.scala` (only if assertions reference old bot delay timings)
- **STRICT FORBIDDEN FILES:** Do NOT edit `README.md`, `ARCHITECTURE.md`, `play-local.sh`, or `frontend/*`.

## Implementation Requirements
1. **75% Bot Move Time Reduction (`backend/src/main/scala/durak/server/GameActor.scala`):**
   - Inspect all bot scheduling / think-time / action pacing delay constants in `GameActor.scala` (and check `GameManager.scala` for any default bot delay passed into `GameActor`).
   - Reduce every bot move delay duration by exactly **75%** (new delay = `originalDelay / 4`, i.e., 25% of the previous duration). Record the exact previous and new duration values in `.reviews/agent_notes.md`.
   - Ensure bot actions across all phases (`InitialAttack`, `Defense` cover/redirect/surrender, `SurrenderThrowIn` throw-in/pass, and chained bot-to-bot turns) execute cleanly at the faster cadence without dropping WebSocket broadcasts, double-firing moves, or breaking turn-clock resets.
   - Keep any constructor/parameterized delay override intact so deterministic tests continue to work cleanly.
2. **1-Click QA Scenario Preset (`qa-fast-bots`) in `GameRoutes.scala` & `GameManager.scala`:**
   - Add a backend QA preset with ID `qa-fast-bots` (e.g., 4-player game with `p0` as `"human"` and `p1`, `p2`, `p3` as `"basicBot"`, configured so `p1` is immediately on turn to attack `p2` in `BoutPhase.InitialAttack` with a healthy mid-game talon and 6-card hands).
   - Ensure the preset starts active immediately when the human player (`p0`) connects via WebSocket so the human reviewer immediately watches `p1`, `p2`, and `p3` rapidly execute attacks, defenses, throw-ins, and passes at the new 75%-faster bot cadence in under 5 seconds!
   - Do not disturb `qa-table-collapse-right` or any other existing presets.

## End-to-End Wiring
- **Backend Actor:** `GameActor.scala` bot turn scheduler & default bot delay constant(s).
- **Backend Preset Route:** `GameRoutes.scala` & `GameManager.scala` supporting preset ID `qa-fast-bots` alongside existing QA presets (to be wired into Lobby & Left Sidebar buttons in Wave 3).
- **QA Scenario Testability (< 15 seconds):** Loading `qa-fast-bots` drops the reviewer straight into an active bot-vs-bot bout with 3 `BasicBot` opponents moving immediately.

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-NEW3 (Verbatim):** *"Reduce the time spent for the bots to make their moves by 75%."*
- [ ] All bot move / think delay constants in `GameActor.scala` (and `GameManager.scala` if applicable) are reduced by 75% (equal to 25% of their prior value), with before/after values documented in `.reviews/agent_notes.md`.
- [ ] Consecutive bot turns (attack -> defense -> throw-in -> pass -> bout resolution) run cleanly at the faster speed with zero race conditions, duplicate actions, or missed state broadcasts.
- [ ] Backend QA Scenario Preset `qa-fast-bots` is implemented in `GameManager.scala` and exposed via `GameRoutes.scala`, creating a 4-player game (`p0` human + `p1`, `p2`, `p3` BasicBots) where a bot is immediately on turn to attack another bot.
- [ ] Tests in `GameActorSuite.scala` and `PresetSuite.scala` verify: (a) the default bot move delay constant reflects the 75% reduction, (b) a multi-step bot turn sequence completes rapidly and legally, and (c) `qa-fast-bots` creates cleanly with valid state and immediate legal bot actions.
- [ ] Run `cd backend && sbt -batch test` and confirm 100% pass.
- [ ] Write a concise summary in `.reviews/agent_notes.md`, then run `echo "DONE" > .tickets/STATUS`.
