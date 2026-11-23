# T-09: Pass Logic & Bout Resolution (Draw, Discard, Role Rotation)

## Objective
Implement `PassTurn` action handling and the complete bout resolution logic: card drawing, discard/pickup, and attacker/defender role rotation for the next bout.

## Requirements

### In `GameEngine.applyAction`:

#### `PassTurn(playerId)` handling:
- **Validations:**
  1. `boutPhase` is `Defense` or `SurrenderThrowIn`
  2. `playerId` is NOT the defender
  3. `playerId` is an active player
  4. Player has not already passed (`hasPassed == false`)
  5. During `Defense` phase: all attacking cards must be covered (`tablePairs.forall(_.defense.isDefined)`) OR `tablePairs.size >= maxBoutAttacks`
- **State transition:**
  1. Set the player's `hasPassed = true`
  2. Check if all active non-defending players have now passed (auto-pass players with 0 cards or where table is full)
  3. If all have passed → trigger bout resolution (see below)

#### Bout Resolution — `resolveBout(state: GameState): GameState`

Implement as a private helper. Called when all non-defenders have passed.

**Determine outcome based on `boutPhase`:**

**Case A — Successful Defense** (phase was `Defense`, all cards covered):
1. Move all table cards (attack + defense) to `discardPile`
2. Clear `tablePairs`
3. Draw cards (see draw order below)
4. **Role rotation:** old `defenderIdx` becomes new `attackerIdx`; new `defenderIdx` = `nextActivePlayerIdx(new attackerIdx)`
5. Set `boutPhase = BoutPhase.InitialAttack`

**Case B — Surrender** (phase was `SurrenderThrowIn`):
1. Defender picks up ALL cards from the table (both attack and defense cards) into their hand
2. Clear `tablePairs`
3. Draw cards — but **defender does NOT draw** (they just picked up cards)
4. **Role rotation:** new `attackerIdx` = `nextActivePlayerIdx(defenderIdx)` (skip the defender); new `defenderIdx` = `nextActivePlayerIdx(new attackerIdx)`
5. Set `boutPhase = BoutPhase.InitialAttack`

**Card Drawing Order** (while `talon.nonEmpty` and player has < 6 cards):
1. Primary attacker draws to 6
2. Other non-defending active players draw to 6 in clockwise seat order from attacker
3. Defender draws to 6 last (skipped entirely in Case B)

After drawing, set `defenderInitialHandSize` to the new defender's hand size.
Reset all players' `hasPassed = false`.

### Test File: `backend/src/test/scala/durak/engine/BoutResolutionSuite.scala`

**Pass Tests:**
- Valid pass when all cards covered
- Reject: pass when uncovered cards remain (Defense phase)
- Reject: defender tries to pass
- Reject: player already passed
- Auto-pass players with empty hands

**Successful Defense Tests:**
- Table cards go to discard pile
- Players draw to 6 in correct order (attacker first, defender last)
- Roles rotate: defender becomes attacker
- Bout phase resets to `InitialAttack`

**Surrender Tests:**
- Defender picks up all table cards
- Non-defenders draw (defender does not)
- Roles skip surrendering defender
- Bout phase resets to `InitialAttack`

**Drawing Tests:**
- Draw order: attacker → clockwise non-defenders → defender
- Drawing stops when talon is empty (partial draws)
- `bottomTrumpCard` is the last card drawn from talon; after talon empties, `bottomTrumpCard = None`

**3-Player Role Rotation:**
- After successful defense in 3P: verify correct attacker/defender cycling
- After surrender in 3P: verify defender is skipped for attack turn

## Acceptance Criteria
- [ ] Pass and bout resolution fully implemented
- [ ] All `BoutResolutionSuite` tests pass

## Verification Command
```bash
cd backend && sbt test
```

