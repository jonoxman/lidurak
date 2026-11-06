<!-- WAVE:1 -->
# T-90-feedback-20261105_221105-1 — Backend Multi-Card Throw-In Support & QA Scenario Presets (`surrender-half-off` & `full-hand-pickup`)

## Summary
Ensure the Scala 3 backend engine and scenario presets (`GameEngine.scala`, `GameRoutes.scala` / `DebugPresets.scala`, `PlayerGameView.scala`) cleanly support multi-card `ThrowInCards` actions and provide immediate 1-click QA Scenario Preset states to test:
1. Multi-card click-to-select + double-click throw-in (`ITEM-5`) and role-based throw-in outline visibility (`ITEM-1a`) within 15 seconds via `surrender-half-off` (ensuring Alice holds at least two rank-7 throw-in cards, e.g. `7♥` and `7♦`, so she can select multiple legal throw-in cards and deploy them at once, or throw in one and see the outline remain until she has no legal throw-in cards left or passes).
2. Extreme large-hand overlap (`ITEM-4`, e.g., when a player picks up almost the entire deck into their hand) via a `full-hand-pickup` (or `large-hand-overlap`) preset on `POST /api/games/preset/:presetId` and `POST /api/debug/preset/:presetId`.

## Scope Constraints (STRICT)
- **ONLY touch files inside `backend/`.** Do NOT modify any files in `frontend/`, `README.md`, `ARCHITECTURE.md`, or `play-local.sh` in this ticket (frontend files are handled in parallel/subsequent tickets).

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-1a (QA Playbook #1 — Throw-In Legality & Preset Support):**
  > "1. It works, but make the following adjustment: the additional card outline should only be visible to players that can legally play into it. In other words, it should not be visible if a player has no valid cards to throw in, is the defending player, or has already input a pass command."
  - Verify `GameEngine.canPlayerThrowIn(state, seatIdx)` and `GameEngine.legalActions(state, playerId)` (exposed via `PlayerGameView.fromState` in `PlayerGameView.scala`) only emit `GameAction.ThrowInCards` when:
    1. `boutPhase` is `BoutPhase.Defense` or `BoutPhase.SurrenderThrowIn` and `tablePairs.nonEmpty`,
    2. `playerId` is an active non-defender (`seatIdx != state.defenderIdx` and `player.isActive`),
    3. `!player.hasPassed` (when a player has already input `PassTurn`, `legalActions` must NOT include `ThrowInCards` or `PassTurn` for that player),
    4. `state.tablePairs.size < state.maxBoutAttacks` and (in `Defense`) `state.uncoveredCount < defender.hand.size`, and
    5. `player.hand` contains at least one card whose rank is in `state.tableRanks`.
  - Check `GameEngine.candidateActions` in `backend/src/main/scala/durak/engine/GameEngine.scala`: if `player.hasPassed` is true, `candidateActions` must return `Nil` (or filter out `ThrowInCards`) so a player who has already passed has zero `ThrowInCards` actions in `PlayerGameView.legalActions`!

- [ ] **ITEM-5 (New #4 — Multi-Card Throw-In Engine & Preset Support):**
  > "4. Remove the "Throw In" button. Instead, cards can be thrown in by dragging them to the additional card outline or double clicking. To throw in multiple cards at once, the player can click to select multiple legal cards to throw in, and then double-click to deploy them all at once."
  - Verify `GameEngine.applyAction` (`applyThrowInCards` in `backend/src/main/scala/durak/engine/GameEngine.scala`) accepts `GameAction.ThrowInCards(playerId, cards)` with 1 or more cards (`cards.size >= 1`) whenever all cards exist in `thrower.hand`, all cards match ranks currently in `state.tableRanks`, and `state.tablePairs.size + cards.size <= state.maxBoutAttacks` (and in `Defense`, `state.uncoveredCount + cards.size <= defender.hand.size`), and that `!thrower.hasPassed` is enforced so a player who has already passed cannot throw in cards until passing is reopened.
  - In `surrender-half-off` preset (`GameRoutes.scala` / `DebugPresets.scala`), ensure Alice (`p0`) holds at least two rank-7 cards (e.g., `Card(Suit.Hearts, Rank.Seven)` and `Card(Suit.Diamonds, Rank.Seven)`) in her hand while `Card(Suit.Spades, Rank.Seven)` is on the table against Bob (`p1`), and Bob has at least 3 cards in hand (`defenderInitialHandSize >= 3`). This allows the human reviewer to switch POV to Alice in `surrender-half-off` and immediately click-select both `7♥` and `7♦` and double-click to throw them both in at once!

- [ ] **ITEM-4 (New #3 — Large Hand / Full-Deck Pickup QA Scenario Preset Support):**
  > "3. Arrange the cards in the active user's hand subject to the following constraints: all cards should overlap by 20% of their width at minimum and by 80% of their width at maximum. (These percentages are approximate - adjust them as needed to make sure that the left-side rank symbol and suit is always visible on every card, and so that even if a player picks up every card into their hand, the hand won't look wrong graphically (i.e. go off screen or overlap UI elements)). Keep in mine New Item #1 when implementing this, and vice versa."
  - Add/support a `full-hand-pickup` preset in `GameRoutes.scala` (or `DebugPresets.scala` where presets are defined) that creates a deterministic 2-player match where the active viewer (`p0`, Alice) holds a massive hand of 28–30 cards (with `p1`, Bob, holding the remaining 6–8 cards and an active attack or initial attack phase with playable cards shifted up), so a reviewer can verify in 1 click that a near-full-deck hand stays inside the table without overflowing or overlapping UI elements while keeping every card's left-side rank and suit visible.

## Verification & Test Commands
Run the backend test suite and ensure all tests pass:
```bash
cd backend && sbt -batch test
```
Update/add unit tests in `backend/src/test/scala/durak/engine/SurrenderThrowInSuite.scala` and `backend/src/test/scala/durak/server/PresetSuite.scala` to cover:
1. `GameEngine.legalActions` returning no `ThrowInCards` when a player has `hasPassed == true`, is the defender, or holds no matching ranks.
2. Multi-card `GameAction.ThrowInCards` with 2+ cards deployed simultaneously in both `BoutPhase.Defense` and `BoutPhase.SurrenderThrowIn`.
3. `surrender-half-off` (with Alice holding multiple rank-7 throw-in cards) and `full-hand-pickup` preset creation.

