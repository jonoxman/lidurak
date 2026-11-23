<!-- WAVE:1 -->
# Ticket 1: Backend Engine & RandomBot Legal Move Invariants

## Summary
Fix illegal move bugs in the Durak game engine and `RandomBot` where:
1. A bot could redirect an attack (`RedirectAttack`) when the next player had no cards (or insufficient cards) left in their hand, causing the bot to redirect to itself or an empty-handed player and subsequently cover its own cards.
2. A defending bot could continue playing `DeclareSurrender`, `CoverCard`, or `RedirectAttack` after already surrendering (`BoutPhase.Surrendered`).

Ensure that `GameEngine.applyAction`, `PlayerGameView`, `RandomBot.legalActionsFor`, and `GameActor` enforce strict legal move invariants in every phase and seat configuration.

## Files to Modify
- `backend/src/main/scala/durak/engine/GameEngine.scala`
- `backend/src/main/scala/durak/engine/PlayerGameView.scala`
- `backend/src/main/scala/durak/engine/RandomBot.scala`
- `backend/src/main/scala/durak/server/GameActor.scala`
- `backend/src/test/scala/durak/engine/RedirectSuite.scala`
- `backend/src/test/scala/durak/engine/SurrenderThrowInSuite.scala`
- `backend/src/test/scala/durak/engine/RandomBotSuite.scala`
- `backend/src/test/scala/durak/server/GameActorSuite.scala`

*(Do NOT modify any frontend files, `README.md`, or `ARCHITECTURE.md` in this ticket.)*

## Requirements

### 1. Strict `RedirectAttack` Validation (`GameEngine.scala`)
- `RedirectAttack(card)` must only be valid when:
  - `state.config.allowRedirect` is `true`.
  - The game is in an active bout before any defense or surrender: `state.boutPhase != BoutPhase.InitialAttack && state.boutPhase != BoutPhase.Surrendered && state.boutPhase != BoutPhase.GameOver`.
  - The acting player is the current defender (`playerIdx == state.defenderIdx`).
  - `state.tablePairs.nonEmpty` and every pair on the table is currently uncovered (`state.tablePairs.forall(_.defense.isEmpty)`).
  - Adding the redirected card does not exceed the 6-card bout limit (`state.tablePairs.size < 6`).
  - The defender holds `card` in their hand and `card.rank` matches the rank of the attacking cards currently on the table.
  - **Next Defender Target Invariants:**
    - Find the next active player with cards in clockwise order after `state.defenderIdx` (`nextDefenderIdx`).
    - `nextDefenderIdx` **must not** be `state.defenderIdx` (`nextDefenderIdx != state.defenderIdx`). A player can never redirect an attack to themselves.
    - The target player `state.players(nextDefenderIdx)` **must currently hold at least `state.tablePairs.size + 1` cards in their hand** (`state.players(nextDefenderIdx).hand.size >= state.tablePairs.size + 1`). In particular, if the next player has `0` cards left in their hand (e.g., they just attacked with their last card) or fewer cards than the resulting number of attacking cards on the table, `RedirectAttack` is illegal and must return `Left(...)`.

### 2. Strict Phase & Role Validation for `CoverCard`, `DeclareSurrender`, `ThrowInCards`, and `PassTurn` (`GameEngine.scala`)
- **`CoverCard`:**
  - Must require `playerIdx == state.defenderIdx` and `playerIdx != state.attackerIdx`.
  - Must reject `CoverCard` with `Left(...)` whenever `state.boutPhase == BoutPhase.Surrendered`, `state.boutPhase == BoutPhase.InitialAttack`, or `state.boutPhase == BoutPhase.GameOver`. A player can never cover cards after declaring surrender or cover their own attack.
- **`DeclareSurrender`:**
  - Must require `playerIdx == state.defenderIdx`, `state.tablePairs.exists(_.defense.isEmpty)`, and `state.boutPhase != BoutPhase.Surrendered && state.boutPhase != BoutPhase.InitialAttack && state.boutPhase != BoutPhase.GameOver`.
  - Once `state.boutPhase == BoutPhase.Surrendered`, any subsequent `DeclareSurrender` must return `Left(...)`.
  - When `DeclareSurrender` is applied, if any non-defender player has `hand.isEmpty` (0 cards in hand), mark such empty-handed non-defender players as `hasPassed = true` (since a player with 0 cards cannot throw in any cards), and if all non-defender active players have already passed (or have 0 cards in hand / no capacity remains for throw-ins), resolve or transition cleanly without allowing the defender to act again.
- **`ThrowInCards` & `PassTurn`:**
  - During `BoutPhase.Surrendered`, the defender (`playerIdx == state.defenderIdx`) has **zero** legal actions (`ThrowInCards` and `PassTurn` are only for non-defender players who have not yet passed).
  - Ensure `ThrowInCards` checks that the number of uncovered table cards after the throw-in does not exceed the defender's current hand size (`uncoveredCount + cards.size <= defender.hand.size`) and total table pairs does not exceed `6`.

### 3. `RandomBot`, `PlayerGameView`, and `GameActor` Turn Prompting
- In `RandomBot.legalActionsFor(state, playerId)` and `PlayerGameView.forViewer(state, viewerId)`:
  - Ensure every candidate action is filtered through `GameEngine.applyAction(state, playerId, action).isRight`.
  - During `BoutPhase.Surrendered`, `RandomBot.legalActionsFor(state, defenderId)` and the defender's `legalActions` in `PlayerGameView` must be `Vector.empty`.
- In `GameActor.scala`:
  - Ensure the bot loop only prompts a bot seat when that seat is the active prompted player for the current phase (attacker in `InitialAttack`, defender when uncovered cards exist and `boutPhase != BoutPhase.Surrendered`, or an un-passed non-defender thrower when all table cards are covered or `boutPhase == BoutPhase.Surrendered`) and `RandomBot.legalActionsFor(state, botId).nonEmpty`.
  - Never allow a bot to submit moves when `state.boutPhase == BoutPhase.GameOver`.

## Acceptance Criteria & Testing
1. Add unit tests in `RedirectSuite.scala` verifying:
   - `RedirectAttack` is rejected when the other player in a 2-player game attacked with their last card (`hand.isEmpty`).
   - `RedirectAttack` is rejected when the next clockwise active player has fewer than `tablePairs.size + 1` cards in hand.
   - A player can never redirect an attack to themselves or become both attacker and defender.
2. Add unit tests in `SurrenderThrowInSuite.scala` and `RandomBotSuite.scala` verifying:
   - Once `DeclareSurrender` is played (`BoutPhase.Surrendered`), the defender cannot play `DeclareSurrender`, `CoverCard`, or `RedirectAttack`, and `RandomBot.legalActionsFor(state, defenderId)` returns `Vector.empty`.
   - Full simulated games with `RandomBot` never produce illegal redirects, self-covers, or repeated surrenders.
3. Run `cd backend && sbt -batch test` and ensure all suites pass.
