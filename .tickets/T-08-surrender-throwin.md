# T-08: Surrender Declaration & Throw-In Cards

## Objective
Implement `GameEngine.applyAction` for `DeclareSurrender` and `ThrowInCards` actions.

## Requirements

### In `GameEngine.applyAction`:

#### `DeclareSurrender(playerId)` handling:
- **Validations:**
  1. `boutPhase == BoutPhase.Defense`
  2. `playerId` matches `players(defenderIdx).id`
  3. At least 1 uncovered attacking card exists: `tablePairs.exists(_.defense.isEmpty)`
- **State transition:**
  1. Set `boutPhase = BoutPhase.SurrenderThrowIn`
  2. Reset all non-defending players' `hasPassed` to `false`
  3. Auto-pass any non-defending active player who has 0 cards or where `tablePairs.size >= maxBoutAttacks`

#### `ThrowInCards(playerId, cards)` handling:
- **Validations:**
  1. `boutPhase` is `Defense` or `SurrenderThrowIn`
  2. `playerId` is NOT the defender
  3. `playerId` is an active player (not finished)
  4. `cards.nonEmpty`
  5. All cards in `cards` are in the player's hand
  6. Every card's rank matches the rank of **at least one** card already on the table (either attack or defense side)
  7. `tablePairs.size + cards.size <= maxBoutAttacks`
  8. During `Defense` phase only: additionally ensure new uncovered cards don't exceed defender's current hand size (the defender must be able to potentially cover them)
- **State transition:**
  1. Remove played cards from the throwing player's hand
  2. Add each card as `TablePair(card, None)` to `tablePairs`
  3. If `boutPhase == BoutPhase.Defense`: reset all non-defending active players' `hasPassed` to `false`
  4. If `boutPhase == BoutPhase.SurrenderThrowIn`: do NOT reset passed flags (throw-in during surrender doesn't reopen passing)

### Test File: `backend/src/test/scala/durak/engine/SurrenderThrowInSuite.scala`

**Surrender Tests:**
- Valid surrender transitions to `SurrenderThrowIn`
- Reject: non-defender tries to surrender
- Reject: wrong phase (not Defense)
- Reject: all attacking cards are already covered (nothing to surrender to)

**Throw-In Tests:**
- Valid throw-in during Defense: card rank matches table, added to table
- Valid throw-in during SurrenderThrowIn
- Valid throw-in by non-attacker, non-defender (3P+ game)
- Reject: defender tries to throw in
- Reject: card rank doesn't match any table card
- Reject: would exceed `maxBoutAttacks`
- Reject: cards not in player's hand
- **Passed flags reset:** After throw-in during Defense, all non-defender passed flags are reset
- **No reset during Surrender:** After throw-in during SurrenderThrowIn, passed flags are NOT reset

## Acceptance Criteria
- [ ] `DeclareSurrender` and `ThrowInCards` fully implemented
- [ ] All `SurrenderThrowInSuite` tests pass

## Verification Command
```bash
cd backend && sbt test
```

