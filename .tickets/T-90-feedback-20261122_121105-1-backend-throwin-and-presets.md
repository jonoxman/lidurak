<!-- WAVE:1 -->
# Ticket: Backend Throw-In Eligibility Strictness, Multi-Card Throw-In Verification & QA Scenario Presets

## Context & Goal
Ensure the backend strictly computes per-viewer throw-in eligibility (`canThrowIn`, `throwInCards`, `throwInCapacity`), reliably supports atomic multi-card `ThrowInCards` deployment, and exposes 1-click QA Scenario Presets so a human reviewer can verify throw-in outline visibility (across eligible attacker, defender, passed player, and no-matching-cards player), multi-card throw-in, and full-deck/large-hand layout in under 15 seconds.

## Target Files
- `backend/src/main/scala/durak/engine/PlayerGameView.scala`
- `backend/src/main/scala/durak/engine/GameEngine.scala`
- `backend/src/main/scala/durak/server/GameRoutes.scala`
- `backend/src/test/scala/durak/engine/ThrowInEligibilitySuite.scala`
- `backend/src/test/scala/durak/engine/SurrenderThrowInSuite.scala`
- `backend/src/test/scala/durak/engine/PlayerViewSuite.scala`
- `backend/src/test/scala/durak/server/PresetSuite.scala`

## Implementation Details
1. **Strict `canThrowIn` & `throwInCards` Calculation (`PlayerGameView.scala`):**
   - Audit `PlayerGameView.forViewer` so that `canThrowIn` is `true` **if and only if** ALL of the following hold:
     - `state.boutPhase` is `BoutPhase.Defense` (with `state.tablePairs.nonEmpty`) OR `BoutPhase.SurrenderThrowIn` (with `state.tablePairs.nonEmpty`),
     - the viewer is NOT the defending player (`viewerIdx != state.defenderIdx`),
     - the viewer is active (`viewer.isActive`) and has NOT already passed (`!viewer.hasPassed`),
     - `throwInCapacity > 0` (respecting `state.maxBoutAttacks - state.tablePairs.size` and defender's remaining uncovered/hand capacity as defined by `GameEngine.applyThrowInCards`), AND
     - `throwInCards` (the cards in `viewer.hand` that can legally be thrown in right now via `GameEngine.applyAction(state, viewer.id, GameAction.ThrowInCards(viewer.id, List(card))).isRight`) is **non-empty**.
   - When any condition fails (viewer is defender, viewer already passed, viewer has no matching rank cards, or capacity is 0), set `canThrowIn = false` and `throwInCards = Nil`.
   - Ensure `myHasPassed` accurately reflects `viewer.hasPassed`.
2. **Atomic Multi-Card `ThrowInCards` Support (`GameEngine.scala`):**
   - Audit `applyThrowInCards` in `GameEngine.scala` to confirm a player can submit 2 or more legal cards in a single `GameAction.ThrowInCards(playerId, cards)` action:
     - Cards may have the same rank or different ranks as long as **every** card's rank is in `state.tableRanks`,
     - Every submitted card exists in the player's hand (no duplicates beyond what is held),
     - `cards.size <= throwInCapacity` (does not exceed `state.maxBoutAttacks` or defender's hand capacity),
     - Player is not the defender and has not passed.
   - Ensure passing a single invalid card in a batch rejects the entire `ThrowInCards` action cleanly without mutating state.
3. **1-Click QA Scenario Presets (`GameRoutes.scala`):**
   - Preserve all existing presets (`surrender-half-off`, `3p-redirect-bob`, etc.).
   - Add preset **`throw-in-visibility-3p`** (3-player hotseat human match: `p0` Alice, `p1` Bob, `p2` Carol; trump suit `Hearts`):
     - Bout state: `BoutPhase.Defense`, `attackerIdx = 0` (Alice), `defenderIdx = 1` (Bob), `tablePairs` contains `TablePair(Card(Spades, Seven), Some(Card(Spades, Eight)))` (covered attack, entering throw-in window with `maxBoutAttacks >= 5` and Bob holding enough cards to take up to 4+ additional attacks).
     - `p0` (Alice): holds at least 3 legal throw-in cards matching table ranks (e.g., `7♥`, `7♦`, `8♣`) PLUS 2–3 non-matching cards (e.g., `9♠`, `J♦`, `Q♣`) so the reviewer immediately sees lifted playable throw-in cards mixed with non-playable cards, sees `[data-testid="throw-in-outline"]`, can multi-select + double-click to throw in multiple cards at once, can drag a card onto the outline, or can click the compact Pass icon and watch the outline disappear.
     - `p1` (Bob, defender): holds 5+ cards; viewing Bob's POV immediately verifies the defender does NOT see `[data-testid="throw-in-outline"]`.
     - `p2` (Carol, non-defender): holds 4+ cards with **no** `7` or `8` ranks (e.g., `10♣`, `J♠`, `K♦`, `A♣`); viewing Carol's POV immediately verifies a non-defender with no valid throw-in cards does NOT see `[data-testid="throw-in-outline"]`.
   - Add preset **`mega-hand-30`** (2-player hotseat human match: `p0` Alice, `p1` Bob; trump suit `Hearts`):
     - Bout state: `BoutPhase.Defense`, `attackerIdx = 1` (Bob), `defenderIdx = 0` (Alice), `tablePairs` contains `TablePair(Card(Spades, Seven), None)` (uncovered `7♠` so Alice is defending and can test both the Surrender icon button AND lifted playable covering cards vs. non-playable cards in her huge hand!).
     - `p0` (Alice): holds **30 cards** in hand (a rich mix of suits and ranks including several cards that can legally cover `7♠`—e.g. `8♠`, `9♠`, `A♠`, `6♥`, `9♥`—and many cards that cannot cover `7♠`—e.g. clubs and diamonds) so the reviewer immediately observes 20%–80% overlap with zero overflow, visible rank/suit on every card, non-rectangular hand highlight wrapping the elevated playable cards among 30 cards, drag visibility, and the compact Surrender icon button.
     - `p1` (Bob): holds 5 cards; talon has 0 cards (or 1 bottom trump card if needed for deck display; ensure deck total stays valid and every card across hands + table + talon is unique!).
   - Ensure both presets are registered in `GameRoutes.scala` preset creation route (`POST /api/games/preset/:presetId` or equivalent) and returned if there is a presets listing endpoint.

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-QA1a / QA1b / QA1c (Backend):** "It works, but make the following adjustment: the additional card outline should only be visible to players that can legally play into it. In other words, it should not be visible if a player has no valid cards to throw in, is the defending player, or has already input a pass command." -> `PlayerGameView.forViewer` sets `canThrowIn = false` and `throwInCards = Nil` whenever the viewer is the defending player, has `hasPassed == true`, has zero valid throw-in cards in hand, or `throwInCapacity == 0`; and sets `canThrowIn = true` with exact legal `throwInCards` when all legality checks pass.
- [ ] **ITEM-NEW4c (Backend):** "To throw in multiple cards at once, the player can click to select multiple legal cards to throw in, and then double-click to deploy them all at once." -> `GameEngine.applyAction` with `GameAction.ThrowInCards(playerId, List(c1, c2, ...))` succeeds atomically for multi-card throw-ins (both same-rank and mixed-table-ranks) within `throwInCapacity` and rejects invalid batches.
- [ ] **ITEM-NEW3 / QA Presets (Backend):** `GameRoutes.scala` supports creating `throw-in-visibility-3p` and `mega-hand-30` presets with valid, duplicate-free card distributions, wired into the existing preset route.
- [ ] **Tests:** Unit tests added/updated in `ThrowInEligibilitySuite.scala`, `SurrenderThrowInSuite.scala`, `PlayerViewSuite.scala`, and `PresetSuite.scala`, and `sbt -batch test` passes with zero errors.

