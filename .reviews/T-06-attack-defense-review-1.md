I'll read all the relevant files simultaneously to do a thorough review.
Now let me look at the existing engine models to understand the data structures referenced in the diff:
Now let me run the test suite to verify all tests pass:
`sbt` is not available in this environment. I have enough information from a thorough static review. Let me now conduct the full analysis.
I now have a complete picture. Let me do a thorough analysis of every requirement.

---

## Code Review: T-06 — Initial Attack & Defense (Cover) Move Processing

### Requirement Checklist

#### `InitialAttack` Validations

| # | Requirement | Implementation | Status |
|---|---|---|---|
| 1 | `boutPhase == BoutPhase.InitialAttack` | Line 80 ✓ | ✅ |
| 2 | `playerId` matches `players(attackerIdx).id` | Lines 83–84 ✓ | ✅ |
| 3 | `cards.nonEmpty` | Line 85 ✓ | ✅ |
| 4 | All cards in attacker's hand | Lines 86–87 via `removeCards` ✓ | ✅ |
| 5 | All cards share the same `Rank` | Lines 88–91 ✓ | ✅ |
| 6 | `cards.size <= maxBoutAttacks` | Lines 92–95 ✓ | ✅ |

#### `InitialAttack` State Transition

| # | Requirement | Implementation | Status |
|---|---|---|---|
| 1 | Remove played cards from attacker's hand | Line 98 ✓ | ✅ |
| 2 | Add each card as `TablePair(card, None)` | Line 99 ✓ | ✅ |
| 3 | Set `boutPhase = BoutPhase.Defense` | Line 100 ✓ | ✅ |

#### `CoverCard` Validations

| # | Requirement | Implementation | Status |
|---|---|---|---|
| 1 | `boutPhase == BoutPhase.Defense` | Lines 110–113 ✓ | ✅ |
| 2 | `playerId` matches `players(defenderIdx).id` | Lines 114–115 ✓ | ✅ |
| 3 | `defenseCard` in defender's hand | Lines 116–117 ✓ | ✅ |
| 4 | `attackIndex` valid into `tablePairs` | Lines 118–120 ✓ | ✅ |
| 5 | `tablePairs(attackIndex).defense.isEmpty` | Line 121 ✓ | ✅ |
| 6 | Legal cover check | Lines 133–135 via `isLegalCover` ✓ | ✅ |

#### `CoverCard` State Transition

| # | Requirement | Implementation | Status |
|---|---|---|---|
| 1 | Remove `defenseCard` from defender's hand | Line 128 ✓ | ✅ |
| 2 | Update `tablePairs(attackIndex)` with defense card | Line 129 ✓ | ✅ |

---

### Bug Analysis

#### ⚠️ Validation Order Issue in `applyCoverCard`

In `applyCoverCard`, `remainingHand` is computed (line 116) **before** validating that the `attackIndex` is valid (line 118) and that the slot isn't already covered (line 121). This means the card-removal computation happens against an index that may not even exist yet. However, since `removeCards` returns an `Option` and the result is only used later in the `yield`, this is not a correctness bug — the for-comprehension short-circuits before `remainingHand` is applied to state if any subsequent check fails. **No actual bug.**

#### ⚠️ Subtle Issue: `isLegalCover` — Trump vs Trump

The SPEC says:
> `(defenseCard.suit == att.suit && defenseCard.rank > att.rank)` OR `(defenseCard.suit == trumpSuit && att.suit != trumpSuit)`

For trump-vs-trump: Both cards have `suit == trumpSuit`. The **first** branch applies: `defense.suit == attack.suit && defense.rank.value > attack.rank.value` → **correctly requires higher rank**. The second branch's `att.suit != trumpSuit` condition correctly **excludes** trump-on-trump. This matches the SPEC exactly. ✅

#### ⚠️ Note on `removeCards` for Multi-Card Attack with Duplicate Cards

The `removeCards` helper removes one occurrence at a time using `indexOf` + `patch`. This correctly handles duplicate cards in the hand (e.g., two `Six of Spades`) by removing them one at a time. ✅

---

### Test Coverage Checklist

**Initial Attack Tests:**

| Requirement | Test | Status |
|---|---|---|
| Single-card attack succeeds, lands on table, transitions to Defense | `"a single-card initial attack..."` | ✅ |
| Multi-card attack (same rank) succeeds | `"a multi-card attack of the same rank..."` | ✅ |
| Reject: wrong player | `"initial attack is rejected when a non-attacker plays"` | ✅ |
| Reject: wrong phase | `"initial attack is rejected outside the initial attack phase"` | ✅ |
| Reject: cards not in hand | `"initial attack is rejected when a card is not in the attacker's hand"` | ✅ |
| Reject: different ranks | `"initial attack is rejected when cards have different ranks"` | ✅ |
| Reject: exceeds `maxBoutAttacks` | `"initial attack is rejected when it exceeds maxBoutAttacks"` | ✅ |
| Reject: empty card list | `"initial attack is rejected when it is empty"` | ✅ |

> [!NOTE] The ticket lists 7 initial attack tests; the implementation provides 8 (including an empty-list rejection). This is additive coverage, not a problem.

**Cover Card Tests:**

| Requirement | Test | Status |
|---|---|---|
| Same-suit higher rank covers | `"a same-suit higher rank covers the attack"` | ✅ |
| Trump covers non-trump of any rank | `"a trump covers a non-trump attack of any rank"` | ✅ |
| Reject: same suit lower rank | `"a same-suit lower rank cannot cover"` | ✅ |
| Reject: different non-trump suit | `"a different non-trump suit cannot cover"` | ✅ |
| Reject: trump vs trump with lower rank | `"trump over trump still requires a higher rank"` | ✅ |
| Reject: card not in defender's hand | `"covering is rejected when the card is not in the defender's hand"` | ✅ |
| Reject: attack already covered | `"covering an already covered attack is rejected"` | ✅ |
| Reject: wrong player | `"covering is rejected when the actor is not the defender"` | ✅ |
| Reject: wrong phase | `"covering is rejected outside the defense phase"` | ✅ |

**Bonus test (correct):** `"covering a later pair leaves earlier pairs untouched"` — verifies immutable vector update doesn't disturb other pairs. ✅

---

### Test Correctness Spot-Checks

- **`maxBoutAttacks` test (line 248–255):** 3 cards vs `defenderInitialHandSize = 2` → `maxBoutAttacks = 2` → 3 > 2 → correctly rejected. The `assertEquals(gs.maxBoutAttacks, 2)` assertion validates the precondition correctly. ✅
- **`defending` helper:** Sets `boutPhase = BoutPhase.Defense` and uses `tablePairs = if tablePairs.isEmpty then attackCards.map(TablePair(_)).toVector else tablePairs`. This correctly handles both explicit and implicit table setup. ✅
- **Trump test (line 282–293):** `trumpSuit = Suit.Spades` (default), attack is `Ace of Clubs`, defense is `Six of Spades` (trump). Low trump beats high non-trump. `isLegalCover`: `defense.suit == trumpSuit` (`Spades == Spades` ✓) AND `attack.suit != trumpSuit` (`Clubs != Spades` ✓). Returns `true`. ✅
- **"Covering a later pair" test (line 379–396):** `first` is already covered, `second` at index 1 is uncovered. Covers index 1 only. Verifies `first` remains unchanged. ✅

---

### Summary

All 6 `InitialAttack` validations and 3 state transitions are correctly implemented. All 6 `CoverCard` validations and 2 state transitions are correctly implemented. All ticket-required tests are present. All tests are logically correct against the implementation and the SPEC. No bugs found.

VERDICT: APPROVED
