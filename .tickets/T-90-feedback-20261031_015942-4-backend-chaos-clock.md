<!-- WAVE:2 -->
# Ticket: Backend Engine — Chaos Mode Variant, 15s Turn Clock & 3s Auto-Action Delay

## 1. Description & Goal
Implement the "Chaos Mode" game variant rules on the backend (Item 11), the 15-second turn clock with automatic move execution on timeout (Item 19), and the 3-second delay on automated state transitions (Item 18).

## 2. Requirements & Specification

### Item 11: "Chaos Mode" Game Variant Setting & Rules (Backend)
1. **Configuration & State:**
   - Add `chaosMode: Boolean = false` to `GameConfig`, game creation REST payload, and `GameState`.
   - Validate that `chaosMode` can only be `true` when `playerCount > 2`.
2. **Free Target Selection on Initial Attack:**
   - In standard mode (`chaosMode == false`), initial attack targets the next clockwise active player.
   - In `chaosMode == true`, the opening attacker may target **any** active player holding cards by providing `targetDefender: Option[PlayerId]` in `GameAction.InitialAttack` (or equivalent).
   - When an arbitrary player is attacked, the active defense shifts to that player (skipping intermediate players).
   - All subsequent throw-ins during that bout continue to target that chosen defender.
3. **Randomized Redirections:**
   - When `chaosMode == true` and a defender performs a redirection (`Perevod`), the server redirects the bout to a **randomly chosen active player** who holds enough cards in hand to cover the new total of uncovered cards (excluding the player performing the redirection).

### Items 18 & 19: 15-Second Turn Clock, 3-Second Delay & Timeout Defaults
1. **15-Second Turn Clock Deadline (Item 19):**
   - Track `turnDeadlineMs: Long` or remaining turn seconds in `GameState` and serialize it in `PlayerGameView`.
   - Reset the clock to 15 seconds (`00:15`) whenever any valid move is executed.
   - When idle or between bouts, display `00:15`.
2. **Timeout Defaults (Item 19):**
   - When 15 seconds elapse without an action from the player being waited on, execute default action automatically:
     - Waiting on initial attack -> play a random legal attack card from the attacker's hand (against a random legal target if `chaosMode == true`).
     - Waiting on defender -> automatically surrender (`takeCards`).
     - Waiting on attacker/throw-in -> automatically pass (`passTurn`).
3. **3-Second Auto-Action Delay (Item 18):**
   - Whenever an engine condition triggers an automatic action (e.g. defender has zero legal defense moves and must auto-surrender, or auto-advancing after all players pass), insert a **3-second delay** before applying the transition so the state change is not abrupt.

## 3. Files to Touch
- `backend/src/main/scala/durak/engine/GameConfig.scala`
- `backend/src/main/scala/durak/engine/GameState.scala`
- `backend/src/main/scala/durak/engine/GameAction.scala`
- `backend/src/main/scala/durak/engine/GameEngine.scala`
- `backend/src/main/scala/durak/engine/PlayerGameView.scala`
- `backend/src/main/scala/durak/engine/JsonCodecs.scala`
- `backend/src/main/scala/durak/server/GameActor.scala`
- `backend/src/main/scala/durak/server/GameRoutes.scala`
- `backend/src/test/scala/durak/engine/AttackDefenseSuite.scala`
- `backend/src/test/scala/durak/engine/RedirectSuite.scala`
- `backend/src/test/scala/durak/server/GameActorSuite.scala`

## 4. Verification & Testing
- Run `sbt -batch test` to verify all tests pass.
- Test scenarios:
  1. Chaos mode attack against non-adjacent player shifts defender.
  2. Chaos mode redirection randomly selects a valid active player.
  3. Turn clock resets to 15s on actions.
  4. Timeout triggers default action (attacker random card, defender surrender, pass).
  5. 3-second delay on automated state transitions.

## 5. Autonomous Agent Workflow Steps
1. Run `git status` and `git diff` to inspect current state.
2. Implement backend logic in engine and server actor.
3. Run `sbt -batch test` and fix any issues.
4. Document implemented features in `.reviews/agent_notes.md`.
5. Signal completion: `echo "DONE" > .tickets/STATUS`.
