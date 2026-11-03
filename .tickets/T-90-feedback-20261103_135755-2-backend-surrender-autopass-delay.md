<!-- WAVE:1 -->
# Ticket: `T-90-feedback-20261103_135755-2-backend-surrender-autopass-delay` — 1-Second Backend Auto-Pass Delay for Players with No Legal Throw-In Cards & Defenseless `Surrender Half-Off` QA Preset

## Assigned Items
- **ITEM-PREV-4b (Backend / Engine / Server):**
  > "Previous-4. Make the client-side auto surrender happen on a 3-second delay instead of instantly. The auto-pass for the other players if they have no legal throw in cards should happen on a 1-second delay instead of instantly."
- **ITEM-PREV-4a (QA Scenario Preset `surrender-half-off`):**
  > Ensure the `Surrender Half-Off` (`surrender-half-off`) 1-click QA Scenario Preset starts on Bob (`p1`) in `BoutPhase.Defense` with **no legal cover or redirect** (`defenderDefenseless = true`, `legalActions = Vector("surrender")`), while Carol (`p2`) holds no legal throw-in cards (so Carol auto-passes on a 1-second delay after Bob surrenders) and Alice (`p0`) holds `7♥` (so the bout stays in `BoutPhase.SurrenderThrowIn` with the straddling half-off cards visible on the table).

---

## Context & End-to-End Wiring

### Current State & Problem
1. **Instant (`0 ms`) Auto-Pass in `GameEngine.scala`:**
   - Currently, `GameEngine.applyAction` calls `autoPassSurrenderThrowers` synchronously inside `DeclareSurrender` and `ThrowInCards` (when in `BoutPhase.SurrenderThrowIn`).
   - That synchronous call marks every active non-defender who has no legal throw-in cards (`!canPlayerThrowIn(state, seatIdx)`) as `hasPassed = true` and immediately calls `resolveSurrenderBout` in the exact same transition (`0 ms` delay).
   - Consequently:
     - Players with no legal throw-in cards are marked `PASSED` at `0 ms` instead of after a **1-second (`1000 ms`) delay**.
     - When *no* player has a legal throw-in card left after a surrender (or after the last matching card is thrown in during `SurrenderThrowIn`), the bout resolves at `0 ms` in the same step, so the surrendered cards never stay in their half-off straddling position for 1 second before being picked up.
2. **`surrender-half-off` Preset in `GameManager.scala`:**
   - Currently, `surrender-half-off` gives Bob (`p1`) a `9♠` in hand so he can cover the uncovered `7♠` (`defenderDefenseless = false`). Because Bob has a cover move, the 3-second client-side auto-surrender never activates when opening `Surrender Half-Off`.

### Required Changes

1. **`backend/src/main/scala/durak/engine/GameEngine.scala`:**
   - In `handleDeclareSurrender` and `handleThrowInCards` (during `BoutPhase.SurrenderThrowIn`):
     - Do **not** synchronously auto-pass players without legal throw-in cards or synchronously resolve the surrender bout at `0 ms` when entering `BoutPhase.SurrenderThrowIn` or when throwing in a card during `BoutPhase.SurrenderThrowIn`.
     - Specifically:
       - When the defender declares `DeclareSurrender`:
         - If at least one other active player still holds cards (`activeNonDefenders.nonEmpty`), transition to `BoutPhase.SurrenderThrowIn` with `hasPassed = false` for active non-defenders (do not mark non-defenders with `!canPlayerThrowIn` as passed at `0 ms`). Only if no other active player holds any cards at all (`activeNonDefenders.isEmpty`) should `resolveSurrenderBout` run immediately.
       - When an attacker plays `ThrowInCards` during `BoutPhase.SurrenderThrowIn`:
         - Add the thrown-in card(s) to `tablePairs`, remove them from the thrower's hand, and reset `hasPassed = false` on active non-defenders who still hold cards (do not synchronously mark `!canPlayerThrowIn` players as passed at `0 ms`).
       - In `legalActions(state, playerId)` and `handlePassTurn`:
         - During `BoutPhase.SurrenderThrowIn`, any active non-defender (`seatIdx != state.defenderIdx && state.players(seatIdx).hand.nonEmpty && !state.players(seatIdx).hasPassed`) is allowed to `PassTurn(playerId)` (so `"pass"` is in `legalActions` for them whether or not they also have `"throwIn"`).
         - When `PassTurn(playerId)` is applied in `BoutPhase.SurrenderThrowIn`, mark `playerId` as `hasPassed = true`; if all active non-defenders with cards now have `hasPassed == true`, call `resolveSurrenderBout`.
       - Keep `GameEngine.autoPassSurrenderThrowers(state: GameState): GameState` and add a helper `GameEngine.playersNeedingAutoPass(state: GameState): Vector[String]` (returning the `id`s of active non-defenders with `hand.nonEmpty && !hasPassed && !canPlayerThrowIn(state, idx)` when `state.boutPhase == BoutPhase.SurrenderThrowIn` or when `state.tablePairs.nonEmpty && state.tablePairs.forall(_.isCovered)` in `BoutPhase.Attack`/`BoutPhase.Defense`) so `GameActor` can trigger their auto-pass after the **1-second (`1000 ms`) delay**!

2. **`backend/src/main/scala/durak/engine/PlayerGameView.scala`:**
   - Ensure `promptedPlayerIds` during `BoutPhase.SurrenderThrowIn` (and covered throw-in) includes active non-defenders who have not yet passed (`hand.nonEmpty && !hasPassed`), so the UI and server know which players are still pending a throw-in or auto-pass.

3. **`backend/src/main/scala/durak/server/GameActor.scala`:**
   - Add a configurable `noThrowInAutoPassDelay: FiniteDuration = 1.second` parameter (defaulting to `1.second` / `1000.millis`) to `GameActor` / `GameRoom`.
   - Whenever the room's `GameState` has `GameEngine.playersNeedingAutoPass(state).nonEmpty` (for example, right after `DeclareSurrender` or `ThrowInCards` when one or more active non-defenders have no legal throw-in cards):
     - Wait `noThrowInAutoPassDelay` (`1.second` by default), racing against state changes or cancellation if those players have already passed.
     - After the `1.second` delay elapses, automatically pass (`GameAction.PassTurn(pid)` or `GameEngine.autoPassSurrenderThrowers`) for all players in `GameEngine.playersNeedingAutoPass(currentState)`, update the room state & turn deadline, record visible replay frames if the bout resolves, and publish the updated `PlayerGameView` to the WebSocket `Topic`!
   - Ensure that if some players still have legal throw-in cards (like Alice with `7♥` in `surrender-half-off`) while others do not (like Carol in `surrender-half-off`), after `1.second` Carol is marked `hasPassed = true` (`PASSED`) and the state is broadcast, while the bout stays in `BoutPhase.SurrenderThrowIn` waiting on Alice's 15-second turn clock!
   - And if *no* player has any legal throw-in cards (or after Alice throws in her last matching `7♥` so neither Alice nor Carol has legal throw-in cards left), the bout stays in `BoutPhase.SurrenderThrowIn` for `1.second` (so the straddling half-off cards are visible on the table) and then at `1.second` all players without legal throw-in cards auto-pass and the bout resolves into the defender's hand!

4. **`backend/src/main/scala/durak/server/GameManager.scala` (`surrender-half-off` QA Scenario Preset):**
   - Update the `surrender-half-off` preset in `GameManager.scala` so that:
     - Bob (`p1`, `defaultPlayerId`) is in `BoutPhase.Defense` facing 3 pairs on the table (`6♣`/`9♣`, `8♥`/`J♥`, and uncovered `7♠`), with `trumpSuit = Suit.Clubs`.
     - Swap Bob's `9♠` (which could cover `7♠`) with a card from the talon or discard pile that **cannot** cover `7♠` and **cannot** redirect (for example, swap `Card(Suit.Spades, Rank.Nine)` in Bob's hand with `Card(Suit.Diamonds, Rank.Ten)` from the discard pile or talon so all 36 cards remain unique and strictly conserved).
     - Verify that in `surrender-half-off`:
       - Bob (`p1`) has `defenderDefenseless == true` and `legalActions == Vector("surrender")` (no `"cover"`, no `"redirect"`).
       - Carol (`p2`) holds no card of rank `6`, `7`, `8`, `9`, or `J` (`!GameEngine.canPlayerThrowIn(state, 2)`).
       - Alice (`p0`) still holds `Card(Suit.Hearts, Rank.Seven)` (`GameEngine.canPlayerThrowIn(state, 0) == true`).
       - Total cards across `hands + tablePairs + talon + discardPile == 36` with 36 distinct cards.

5. **Backend Test Suites (`backend/src/test/scala/durak/...`):**
   - Update `SurrenderAutoPassSuite.scala`, `SurrenderThrowInSuite.scala`, `ThrowInClockSuite.scala`, `GameActorSuite.scala`, and `PresetSuite.scala` to match and test the new 1-second delayed auto-pass behavior and the updated `surrender-half-off` preset:
     - Verify that `DeclareSurrender` enters `BoutPhase.SurrenderThrowIn` without immediately resolving the bout at `0 ms` when other players hold cards.
     - Verify in `GameActorSuite` / `ThrowInClockSuite` that players with no legal throw-in cards are NOT marked `hasPassed` immediately at `0 ms`, and ARE automatically marked `hasPassed` (and resolve the bout if no throwers remain) after the 1-second delay (`noThrowInAutoPassDelay`).
     - Verify in `PresetSuite` that `surrender-half-off` starts on `p1` (Bob) with `defenderDefenseless == true` and `legalActions == Vector("surrender")`, and after `DeclareSurrender("p1")`, `p2` (Carol) auto-passes after the 1-second delay while `p0` (Alice) remains eligible to throw in `7♥`.

---

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-PREV-4b (1-Second Auto-Pass Delay for Players with No Legal Throw-In Cards):**
  > "Previous-4. Make the client-side auto surrender happen on a 3-second delay instead of instantly. The auto-pass for the other players if they have no legal throw in cards should happen on a 1-second delay instead of instantly."
  - When a defender surrenders (`DeclareSurrender`) or when a throw-in card is played during `SurrenderThrowIn`, active non-defenders with no legal throw-in cards do NOT auto-pass at `0 ms`; instead they auto-pass after a **1-second (`1000 ms`) delay**.
  - When no player has a legal throw-in card after a surrender (or after the last matching card is thrown in), the bout remains in `BoutPhase.SurrenderThrowIn` (with the cards straddling half-off the play area) for 1 second before the auto-pass resolves the bout.
- [ ] **ITEM-PREV-4a (`surrender-half-off` Preset Ready for 3s Auto-Surrender & Manual Click):**
  - The `surrender-half-off` preset starts on Bob (`p1`) in `BoutPhase.Defense` with `defenderDefenseless == true` and `legalActions == Vector("surrender")`, Carol (`p2`) having no legal throw-in cards, Alice (`p0`) holding `7♥`, and all 36 cards strictly conserved.
- [ ] **Automated Test Verification:**
  - `cd backend && sbt -batch test` passes with 0 errors.
