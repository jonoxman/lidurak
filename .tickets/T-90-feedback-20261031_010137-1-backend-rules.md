<!-- WAVE:1 -->
# Ticket T-90-feedback-20261031_010137-1: Backend Game Engine Rules, 36-Card Conservation & Chaos Mode Core

## Subsystem
Backend Scala Engine (`durak.engine.*`, `durak.server.*`)

## Description & Scope
Implement backend game rules updates, card conservation bug fixes, last-player-standing endgame resolution, and chaos mode variant mechanics across the engine.

### Requirements Covered
- **Item 0: Last-Player-Standing Victory Condition (Play Until Only One Durak Remains)**
  - In 3- or 4-player games, do NOT end the game when the first player empties their hand.
  - When the talon deck is empty (`talon.isEmpty` / `talonCount == 0`) and a player empties their hand, remove that player from active turn rotation and append them to `winners: List[PlayerId]` in finishing order (earlier finisher = higher placement).
  - Continue gameplay among remaining players who still hold cards until `activePlayersWithCards.size <= 1`.
  - The last remaining player holding cards is declared the `durak: Option[PlayerId]` (Some(durakPlayerId)). If the final two players empty their hands simultaneously on the same defense, `durak` is `None` (draw).
  - All clockwise turn-order helpers (`nextActivePlayer`, defender selection, redirection target) MUST skip players who have already emptied their hands.
- **Item 1: Fix Disappearing Card Bug on Surrender & Enforce 36-Card Conservation**
  - **Bug Fix:** When a defender with 1 card left faces an uncovered attacking card and surrenders (`takeCards` or auto-surrender), audit all surrender paths to guarantee that **every** attacking and defending card currently on the table (`tableBouts`) is transferred into the surrendering defender's hand before clearing the table and advancing the turn. No card may vanish into discard or void.
  - **Mandatory Invariant Test:** Add unit tests asserting that after every action (attack, cover, redirect, throw-in, pass, surrender, and deck draw), the total card count strictly equals 36:
    `talon.size + discardPile.size + players.map(_.hand.size).sum + tableBouts.flatMap(b => b.attack :: b.defense.toList).size == 36`.
- **Item 11: "Chaos Mode" Game Variant Setting (Backend Core)**
  - Add `chaosMode: Boolean = false` to `GameConfig`, `GameState`, and JSON codecs (`JsonCodecs.scala`, `PlayerGameView.scala`). Only valid/enabled when `playerCount > 2`.
  - **Free Target Selection on Initial Attack:** In chaos mode, opening attacker can target any active player with cards (not just left neighbor). Active defense shifts directly to that target player.
  - **Randomized Redirections:** When `chaosMode == true` and defender redirects (`Perevod`), redirect the bout to a randomly selected active player who holds enough cards to cover the new total uncovered count (excluding the redirecting defender).
- **Item 16: Suppress Server Error Exceptions & Log Invalid Actions**
  - Remove/prevent internal 500 crashes on invalid move attempts. Log invalid action attempts cleanly to server stdout/logger with player ID and action payload, returning an appropriate rejection without crashing game state.

## Target Files
- `backend/src/main/scala/durak/engine/GameState.scala`
- `backend/src/main/scala/durak/engine/GameEngine.scala`
- `backend/src/main/scala/durak/engine/GameConfig.scala`
- `backend/src/main/scala/durak/engine/PlayerGameView.scala`
- `backend/src/main/scala/durak/engine/JsonCodecs.scala`
- `backend/src/main/scala/durak/server/GameRoutes.scala`
- `backend/src/test/scala/durak/engine/EndgameSuite.scala`
- `backend/src/test/scala/durak/engine/SurrenderThrowInSuite.scala`
- `backend/src/test/scala/durak/engine/AttackDefenseSuite.scala`
- `backend/src/test/scala/durak/engine/RedirectSuite.scala`

## Implementation Steps
1. In `GameConfig.scala`, add `chaosMode: Boolean = false`. Validate that `chaosMode` can only be `true` if `playerCount > 2`.
2. Update `GameState.scala` and `PlayerGameView.scala`:
   - Add `winners: List[String]` (ordered list of players who exited without cards).
   - Add `durak: Option[String]`.
   - Add `chaosMode: Boolean`.
   - Update turn-order helper functions (`nextActivePlayer`, `findNextDefender`, etc.) to filter by `player.hand.nonEmpty || talon.nonEmpty`.
3. Fix Surrender in `GameEngine.scala`:
   - Ensure `takeCards` collects all `tableBouts.flatMap(b => b.attack :: b.defense.toList)` directly into defender's hand. Defender's hand size must increase by exactly the total cards on table.
4. Implement Chaos Mode logic in `GameEngine.scala`:
   - Initial attack action accepts optional `targetDefender: Option[String]`. If `chaosMode` is true, validate target is active with cards.
   - Perevod redirection picks random active candidate with `hand.size >= uncoveredCount` when `chaosMode == true`.
5. Update `JsonCodecs.scala` to serialize/deserialize `chaosMode`, `winners`, and `durak`.
6. Add 36-card conservation property tests in `SurrenderThrowInSuite.scala` and `EndgameSuite.scala`.

## Verification Commands
- `sbt -batch test`

## Completion Requirements
- All tests in `sbt -batch test` pass without failures.
- Update `.reviews/agent_notes.md` with implementation summary.
- Run `echo "DONE" > .tickets/STATUS`.
