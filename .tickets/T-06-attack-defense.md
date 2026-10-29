# T-06: Initial Attack & Defense (Cover) Move Processing

## Objective
Implement `GameEngine.applyAction` for `InitialAttack` and `CoverCard` actions with full validation and state transitions.

## Requirements

### File: `backend/src/main/scala/durak/engine/GameEngine.scala`

Add to `GameEngine`:

```scala
def applyAction(state: GameState, action: GameAction): Either[String, GameState]
```

Returns `Left(errorMessage)` for illegal moves, `Right(newState)` for valid moves.

#### `InitialAttack(playerId, cards)` handling:
- **Validations:**
  1. `boutPhase == BoutPhase.InitialAttack`
  2. `playerId` matches `players(attackerIdx).id`
  3. `cards.nonEmpty`
  4. All cards in `cards` are in the attacker's hand
  5. All cards share the exact same `Rank`
  6. `cards.size <= maxBoutAttacks`
- **State transition:**
  1. Remove played cards from attacker's hand
  2. Add each card as `TablePair(card, None)` to `tablePairs`
  3. Set `boutPhase = BoutPhase.Defense`

#### `CoverCard(playerId, attackIndex, defenseCard)` handling:
- **Validations:**
  1. `boutPhase == BoutPhase.Defense`
  2. `playerId` matches `players(defenderIdx).id`
  3. `defenseCard` is in the defender's hand
  4. `attackIndex` is a valid index into `tablePairs`
  5. `tablePairs(attackIndex).defense.isEmpty` (not already covered)
  6. Legal cover check:
     - `(defenseCard.suit == attackCard.suit && defenseCard.rank.value > attackCard.rank.value)` OR
     - `(defenseCard.suit == trumpSuit && attackCard.suit != trumpSuit)`
- **State transition:**
  1. Remove `defenseCard` from defender's hand
  2. Update `tablePairs(attackIndex)` to include the defense card

### Test File: `backend/src/test/scala/durak/engine/AttackDefenseSuite.scala`

**Initial Attack Tests:**
- Valid single-card attack succeeds, cards appear on table, phase transitions to `Defense`
- Valid multi-card attack (same rank) succeeds
- Reject: wrong player tries to attack
- Reject: wrong phase
- Reject: cards not in hand
- Reject: cards of different ranks
- Reject: more cards than `maxBoutAttacks`

**Cover Card Tests:**
- Valid same-suit higher-rank cover succeeds
- Valid trump-over-non-trump cover succeeds
- Reject: same suit but lower rank
- Reject: different non-trump suit
- Reject: trump vs trump with lower rank (must be higher)
- Reject: card not in defender's hand
- Reject: attack index already covered
- Reject: wrong player (not defender)
- Reject: wrong phase

## Acceptance Criteria
- [ ] `applyAction` handles `InitialAttack` and `CoverCard` correctly
- [ ] All `AttackDefenseSuite` tests pass

## Verification Command
```bash
cd backend && sbt test
```

