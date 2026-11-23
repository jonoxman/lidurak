<!-- WAVE:1 -->
# Ticket T-90-1: Backend QA Scenario Presets (`surrender-half-off`, `discard-and-endgame`) & Active Viewer Status Projection (`PlayerGameView`)

## Summary
Fix the backend QA Scenario presets in `GameManager.scala` and the viewer status fields in `PlayerGameView.scala` / `JsonCodecs.scala` so that:
1. **`surrender-half-off` QA Scenario Preset (`ITEM-ADD-4a`):** Starts in `BoutPhase.Defense` on the defender's seat (`defaultPlayerId = "p1"`), where the defender holds at least one legal covering card in hand (so `legalActions` contains `"surrender"` and `"cover"`, guaranteeing the `Surrender` button is immediately visible and no auto-surrender triggers on load), multiple pairs are already on the table (e.g. 2 covered pairs + 1 uncovered attacking card so compact play-area clustering is also visible), and the attacker (`p0`) holds matching-rank cards in hand (`GameEngine.canPlayerThrowIn == true`) so clicking `Surrender` transitions into `BoutPhase.SurrenderThrowIn` (the pass / throw-in phase where cards straddle half-on and half-off the play area) instead of auto-passing immediately.
2. **`discard-and-endgame` QA Scenario Preset (`ITEM-ADD-8b`, `ITEM-PREV-7c`):** Fixes the bug where Bob (`p1`) was listed in `winners` / displayed as `OUT` while still holding 3 cards in hand. In a 3-player game (`Alice = p0`, `Bob = p1`, `Carol = p2`) with an empty talon:
   - Carol (`p2`) has already finished with `hand = Vector.empty` (`0 cards`) and `winners = Vector("p2")` (so Carol is `WINNER` with `0 cards`).
   - Bob (`p1`) holds 3 cards in hand and is **not** in `winners` (`finishRank = None`), so Bob is never displayed as `OUT` while holding 3 cards.
   - Alice (`p0`, `defaultPlayerId = "p0"`) holds 1 final card in hand that can be played immediately (e.g. Alice is defending against Bob's 1 attacking card and Alice's 1 card legally covers it, or Alice is attacking Bob with her last card and Bob must surrender/cover) so that in 1 click Alice empties her hand (`0 cards`), gets added to `winners` (`OUT`), and Bob is left as the last player with cards (`DURAK`), allowing the reviewer to immediately verify both Alice's own status label (`OUT` / `WINNER`) on `Alice (You)` and Bob's `DURAK` label!
   - Populate `discardPile` with at least 10–12 cards (so `discardCount >= 10` and `lastDiscardCards` has 4–6 revealed cards from the previous bout), enabling immediate 1-click inspection of the face-up discard cards overlapping the face-down discard stack (`ITEM-PREV-7a/b/c`).
3. **Viewer Status Fields in `PlayerGameView` (`ITEM-ADD-8a`, `ITEM-ADD-8b`):**
   - Expose `myHasPassed: Boolean` and `myFinishRank: Option[Int]` on `PlayerGameView` (and serialize them in `JsonCodecs.scala`) so the frontend `PLAYERS` list can render `WINNER`, `OUT`, and `PASSED` for the active user (`myId`) identically to opponents.
   - Enforce the invariant in `PlayerGameView.forViewer` that any seat (viewer or opponent) whose `hand.nonEmpty` (`cardCount > 0`) has `finishRank = None` (never `Some(...)` while holding cards).

## Files to Modify
- `backend/src/main/scala/durak/engine/PlayerGameView.scala`
- `backend/src/main/scala/durak/engine/JsonCodecs.scala`
- `backend/src/main/scala/durak/server/GameManager.scala`
- `backend/src/test/scala/durak/server/PresetSuite.scala`
- `backend/src/test/scala/durak/engine/PlayerViewSuite.scala`

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-ADD-4a (Backend Preset):**
  > "4. This feature does not appear to be working. Firstly, due to auto-surrender (Additional Feedback #5), there is no surrender button to click when the QA test starts. Second, in the pass phase (where the straddling effect should be visible) the cards are still in their play location, rather than halfway off the play area."
  - In `GameManager.scala` (`"surrender-half-off"` preset):
    - `defaultPlayerId` is `"p1"` (the defending human player, Bob).
    - `boutPhase` is `BoutPhase.Defense` with at least 1 uncovered `TablePair` (plus 1–2 covered `TablePair`s on the table, preserving total 36-card conservation across hands + tablePairs + talon + discardPile).
    - Defender `"p1"` holds at least one card in `hand` that can legally cover the uncovered `TablePair` (`legalActions` for `"p1"` contains both `"surrender"` and `"cover"`).
    - Attacker `"p0"` (human) holds at least one card in `hand` whose rank matches a rank currently on `tablePairs`, and defender `"p1"` holds enough cards so `tablePairs.size < maxBoutAttacks` (`GameEngine.canPlayerThrowIn(stateAfterSurrender, 0) == true`).
    - Consequently, when `"p1"` dispatches `GameAction.DeclareSurrender("p1")`, `GameEngine.applyAction` transitions to `BoutPhase.SurrenderThrowIn` and stays in `BoutPhase.SurrenderThrowIn` (waiting for `"p0"` to throw in or pass) instead of auto-passing immediately.
- [ ] **ITEM-ADD-8a & ITEM-ADD-8b (Backend Preset & `PlayerGameView`):**
  > "8. The active user's player label doesn't display their label in the player list unless they are the DURAK. Additionally, in this QA scenario, Bob is displayed as OUT even though he still has 3 cards in hand. Correct both of these."
  - In `PlayerGameView.scala` & `JsonCodecs.scala`:
    - Add `myHasPassed: Boolean = false` and `myFinishRank: Option[Int] = None` to `PlayerGameView` (with backward-compatible decoding defaults in `JsonCodecs.scala`).
    - In `PlayerGameView.forViewer(state, viewerId)`: compute `finishRank` for any player (both `myFinishRank` for the viewer and `finishRank` for each `OpponentView`) ONLY when that player's `hand.isEmpty` (`if player.hand.isEmpty then finishOrder.indexOf(player.id) match { case idx if idx >= 0 => Some(idx + 1); case _ => None } else None`).
    - Set `myHasPassed = viewerState.hasPassed`.
  - In `GameManager.scala` (`"discard-and-endgame"` preset):
    - In a 3-player game (`Alice = p0`, `Bob = p1`, `Carol = p2`), `talon` is empty and total cards across hands + tablePairs + discardPile equals `36`.
    - Carol (`p2`) has `hand = Vector.empty` (`0 cards`) and `winners = Vector("p2")` (`finishRank = Some(1)`, `WINNER`).
    - Bob (`p1`) has `3` cards in `hand` (`cardCount == 3`), is **not** in `winners`, and has `finishRank == None` (never `OUT` while holding 3 cards!).
    - Alice (`p0`, `defaultPlayerId = "p0"`) has `1` card in `hand` that can legally cover the single uncovered attack card on the table (or legally play as the final move of the bout), so that in 1 move Alice's hand becomes empty (`0 cards`), Alice gets `myFinishRank = Some(2)` (`OUT`) while Bob (`p1`, holding cards) becomes `durak = Some("p1")` (`DURAK`).
- [ ] **ITEM-PREV-7c (Discard Pile Preset Data in `discard-and-endgame`):**
  - Ensure `"discard-and-endgame"` in `GameManager.scala` has `discardPile.size >= 10` and `lastDiscardCards` (or the previous bout's revealed discard slice) containing `4` to `6` cards so that when `Discard & Endgame Durak` is clicked, both the face-down discard stack (`discardCount - lastDiscardCards.size >= 6`) and `4`–`6` face-up discard cards are immediately rendered in the `DECK` box.
- [ ] **Automated Backend Tests:**
  - Update `PresetSuite.scala` and `PlayerViewSuite.scala` to verify:
    1. `surrender-half-off` starts in `BoutPhase.Defense`, `"p1"` has `"surrender"` in `legalActions`, and applying `DeclareSurrender("p1")` transitions to `BoutPhase.SurrenderThrowIn` (does not immediately resolve the bout).
    2. `discard-and-endgame` has `p2` with `0` cards and `finishRank == Some(1)`, `p1` (Bob) with `3` cards and `finishRank == None` (not in `winners`), `p0` (Alice) with `1` card, and `discardCount > lastDiscardCards.size` with `lastDiscardCards.nonEmpty`.
    3. `PlayerGameView` populates `myHasPassed` and `myFinishRank`, and never sets `finishRank` for a player with `hand.nonEmpty`.
  - Run `cd backend && sbt -batch test` and ensure all suites pass.
