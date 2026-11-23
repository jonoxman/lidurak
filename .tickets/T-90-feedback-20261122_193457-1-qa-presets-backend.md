<!-- WAVE:1 -->
# T-90-feedback-20261122_193457-1: Backend QA Scenario Presets for Table Collapse & Active Surrender Timer

## Objective
Add two deterministic backend QA scenario presets (`qa-table-collapse-right` and `qa-surrender-timer`) to the existing `POST /api/games/preset` endpoint so human reviewers and automated QA can verify **Item 1** (covered-pair edge collapsing across all defender seats and single-row crowding) and **Item 4** (non-overlapping turn timer during an active user's surrender with incoming cards) in 1 click without manually playing multiple turns.

## Scope & Owned Files (Backend Only)
- `backend/src/main/scala/durak/server/GameManager.scala`
- `backend/src/main/scala/durak/server/GameRoutes.scala` (if preset names/validation are referenced there)
- `backend/src/test/scala/durak/server/PresetSuite.scala`
- `backend/src/test/scala/durak/server/GameRoutesSuite.scala` (if preset route tests live here)
- **DO NOT** touch any frontend files, `README.md`, `ARCHITECTURE.md`, or `play-local.sh`.

## Required Presets & Exact Contracts

Keep all 4 existing current-round presets intact (`qa-normal-6-actions`, `qa-medium-14-expand`, `qa-large-30-compress`, `qa-single-card`) and add the following 2 presets:

### 1. `qa-table-collapse-right` (For Item 1 — Covered-Pair Edge Snapping & Single-Row Crowding)
- **Player Setup:** 4 human players (`p0`, `p1`, `p2`, `p3`, `playerTypes = Vector("human", "human", "human", "human")`, `devMode = true`, `allowRedirect = true`) using a valid 52-card-consistent non-duplicate card distribution.
- **Default Viewer (`defaultPlayerId`):** `"p0"` (so from `p0`'s initial POV, `p1` is `top-left`, `p2` is `top-center`, and `p3` is `top-right`).
- **Bout State:**
  - `attackerIdx = 0` (`p0`), `defenderIdx = 3` (`p3`, seated at `top-right` from `p0`'s view), `boutPhase = BoutPhase.Defense`.
  - `defenderInitialHandSize = 6` (so `maxBoutAttacks = 6`).
  - `tablePairs` contains **3 covered pairs + 2 uncovered attack cards** (5 pairs total on the table, with at least one `'ten'` card in a covered pair so full `'10'` rank & suit visibility in the collapsed covered stack can be immediately verified):
    - Covered Pair 0: e.g., `Ten` of a non-trump suit covered by a higher same-suit card.
    - Covered Pair 1: e.g., `Eight` covered by a higher card.
    - Covered Pair 2: e.g., `Nine` covered by a higher card.
    - Uncovered Pair 3: e.g., `Seven` (no defense yet).
    - Uncovered Pair 4: e.g., `Eight` of another suit (no defense yet).
  - **Hands:**
    - `p3` (defender) holds at least 3 cards including legal covering cards for both uncovered attacks (so switching POV to `p3` lets the reviewer cover a card and watch it immediately snap to the left edge!).
    - `p0` (attacker) holds at least 4 cards including a throw-in card matching a rank already on the table (e.g., `Seven`, `Eight`, `Nine`, or `Ten`) so `p0` can throw in a 6th card to test single-row crowding.
    - `p1` and `p2` hold 6 valid cards each.
  - **Why 4P with `defenderIdx = 3`:**
    - Viewing as `p0`: defender `p3` is at `top-right` -> covered pairs collapse to the **RIGHT** edge.
    - Switching POV to `p1`: defender `p3` is at `top-center` -> covered pairs collapse to the **LEFT** edge.
    - Switching POV to `p2`: defender `p3` is at `top-left` -> covered pairs collapse to the **LEFT** edge.
    - Switching POV to `p3`: defender `p3` is at **bottom (active player)** -> covered pairs collapse to the **LEFT** edge.
  - Ensure all cards across hands, `tablePairs`, `talon`, `bottomTrumpCard`, and `discardPile` are unique (no duplicate cards).

### 2. `qa-surrender-timer` (For Item 4 — Active User Surrender Incoming Cards vs. Turn Timer)
- **Player Setup:** 3 human players (`p0`, `p1`, `p2`, `playerTypes = Vector("human", "human", "human")`, `devMode = true`) with unique valid 36-card distribution.
- **Default Viewer (`defaultPlayerId`):** `"p0"`.
- **Bout State:**
  - `attackerIdx = 2` (`p2`), `defenderIdx = 0` (`p0`, the active bottom user!), `boutPhase = BoutPhase.SurrenderThrowIn`.
  - `defenderInitialHandSize = 6`.
  - `tablePairs` contains **4 incoming cards** (e.g., 1 covered pair + 3 uncovered attack/throw-in cards, or 4 uncovered incoming cards) representing the bout cards incoming to the surrendering defender `p0`.
  - `p1` and `p2` have `hasPassed = false` and hold matching-rank throw-in cards (so `promptedPlayerIds` is non-empty, `turnDeadlineMs` is actively armed via `GameActor` / preset creation with a live turn clock, and switching POV to `p1` or `p2` lets the reviewer throw in additional incoming cards while observing `p0`).
  - `p0` holds 5–6 cards in hand (so the active user's hand and the turn timer above it are both clearly populated while `p0` is surrendering).
  - Ensure `presentPlayers` / `turnDeadlineMs` initialization causes the turn clock to start immediately when `p0` loads the preset (matching how `GameActor` arms turn clocks on existing presets).

## Wiring Requirements
- Wire both preset IDs (`"qa-table-collapse-right"` and `"qa-surrender-timer"`) into `GameManager` preset factory and `POST /api/games/preset` in `GameRoutes.scala`.
- Return the standard preset response (`gameId`, `defaultPlayerId`, etc.) matching existing presets.

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-1e (QA Testability for Item 1):** `POST /api/games/preset` with `{"preset":"qa-table-collapse-right"}` creates a valid 4-player game with `defaultPlayerId = "p0"`, `defenderIdx = 3` (`top-right` from `p0`'s POV), `boutPhase = Defense`, 3 covered pairs (at least one containing a `'ten'`) + 2 uncovered pairs on `tablePairs`, no duplicate cards, and valid covering/throw-in cards in hands.
- [ ] **ITEM-4b (QA Testability for Item 4):** `POST /api/games/preset` with `{"preset":"qa-surrender-timer"}` creates a valid game with `defaultPlayerId = "p0"`, `defenderIdx = 0` (active viewer is the surrendering defender), `boutPhase = SurrenderThrowIn`, multiple incoming cards in `tablePairs`, active non-passed attackers with throw-in cards, and an active turn timer (`turnDeadlineMs > 0` / ticking clock) once the viewer connects.
- [ ] All 4 existing presets (`qa-normal-6-actions`, `qa-medium-14-expand`, `qa-large-30-compress`, `qa-single-card`) continue working without regression.
- [ ] Unit and route tests added in `PresetSuite.scala` (and `GameRoutesSuite.scala` if applicable) verifying deck integrity (zero duplicate cards), phases, defender indices, `tablePairs` counts, and HTTP `200`/`201` responses.
- [ ] Run `sbt -batch test` in `backend/` and verify all tests pass.
- [ ] Write a concise summary to `.reviews/agent_notes.md` and run `echo "DONE" > .tickets/STATUS` only after all tests pass.

