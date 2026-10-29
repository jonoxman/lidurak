# T-07: Redirect / Reflect Mechanic

## Objective
Implement `GameEngine.applyAction` for `RedirectAttack` with full validation, role rotation, and `defenderInitialHandSize` update.

## Requirements

### In `GameEngine.applyAction`:

#### `RedirectAttack(playerId, cards)` handling:
- **Validations:**
  1. `boutPhase == BoutPhase.Defense`
  2. `config.allowRedirect == true`
  3. `playerId` matches `players(defenderIdx).id`
  4. ALL table pairs have `defense.isEmpty` (zero cards are currently covered)
  5. `cards.nonEmpty` and all cards in `cards` are in the defender's hand
  6. All cards in `cards` have the **exact same Rank** as the existing attacking cards on the table
  7. Compute `nextDefIdx = nextActivePlayerIdx(defenderIdx)` (the player clockwise after current defender, who is NOT the current defender)
  8. `players(nextDefIdx).hand.size >= (tablePairs.size + cards.size)` — next defender must have enough cards
  9. `(tablePairs.size + cards.size) <= 6` — total cannot exceed 6
- **State transition:**
  1. Remove played cards from the (old) defender's hand
  2. Add each card as `TablePair(card, None)` to `tablePairs`
  3. Old `defenderIdx` becomes new `attackerIdx`
  4. `nextDefIdx` becomes new `defenderIdx`
  5. Update `defenderInitialHandSize` to `players(nextDefIdx).hand.size`
  6. Reset all players' `hasPassed` to `false`

### 2-Player Redirect Note
In a 2-player game, after redirect the original attacker becomes the new defender. Ensure `nextActivePlayerIdx(defenderIdx)` correctly returns the original attacker in this case.

### Test File: `backend/src/test/scala/durak/engine/RedirectSuite.scala`

- **Valid redirect (2P):** Defender redirects with a matching-rank card; roles swap
- **Valid redirect (3P):** Defender redirects; attack passes to the next clockwise player
- **Reject:** `config.allowRedirect == false`
- **Reject:** Some cards on the table are already covered
- **Reject:** Redirect cards have a different rank than table cards
- **Reject:** Next defender doesn't have enough cards
- **Reject:** Total table pairs would exceed 6
- **Reject:** Cards not in defender's hand
- **Role rotation correctness:** After redirect, `attackerIdx` is the old defender, `defenderIdx` is the next clockwise player
- **`defenderInitialHandSize` update:** Correctly set to new defender's hand size after redirect
- **Chain redirect (3P):** Defender A redirects to B, then B redirects to original attacker (if conditions met)

## Acceptance Criteria
- [ ] Redirect mechanic fully implemented with validation
- [ ] All `RedirectSuite` tests pass

## Verification Command
```bash
cd backend && sbt test
```

