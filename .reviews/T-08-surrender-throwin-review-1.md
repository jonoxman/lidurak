I'll read all the relevant files to conduct a thorough review.
Now let me examine the existing codebase to cross-check the implementation details:
Now I have a complete picture. Let me do a thorough analysis.
I now have everything I need to provide a comprehensive review. Let me analyze the implementation against every requirement.

---

## Code Review: T-08 Surrender & Throw-In

### 1. `DeclareSurrender` — Requirement Checklist

| Requirement | Implementation | Status |
|---|---|---|
| Phase must be `BoutPhase.Defense` | ✅ `check(state.boutPhase == BoutPhase.Defense, ...)` | ✅ Pass |
| `playerId` must match `players(defenderIdx).id` | ✅ `check(defender.id == playerId, ...)` | ✅ Pass |
| At least 1 uncovered attacking card | ✅ `check(state.tablePairs.exists(_.defense.isEmpty), ...)` | ✅ Pass |
| Transition to `BoutPhase.SurrenderThrowIn` | ✅ `state.copy(..., boutPhase = BoutPhase.SurrenderThrowIn)` | ✅ Pass |
| Reset non-defenders' `hasPassed` to `false` then auto-pass cardless/full-bout | ✅ `player.copy(hasPassed = player.hand.isEmpty \|\| boutIsFull)` | ✅ Pass |
| Finished players are skipped (not modified) | ✅ `player.finishRank.nonEmpty` guard in `zipWithIndex` map | ✅ Pass |
| Defender's `hasPassed` is not touched | ✅ `if idx == state.defenderIdx ... then player` | ✅ Pass |

**Subtle nuance on requirement 2 (state transition, step 2+3):** The ticket says "reset all non-defending players' `hasPassed` to `false`" and then "auto-pass any non-defending active player who has 0 cards or where `tablePairs.size >= maxBoutAttacks`". The implementation combines these into a single assignment `player.copy(hasPassed = player.hand.isEmpty || boutIsFull)` which is semantically equivalent and correct — a reset-then-auto-pass in one step.

---

### 2. `ThrowInCards` — Requirement Checklist

| Requirement | Implementation | Status |
|---|---|---|
| Phase must be `Defense` or `SurrenderThrowIn` | ✅ `phaseAllowsThrowIn` guard | ✅ Pass |
| `playerId` is NOT the defender | ✅ `check(defender.id != playerId, ...)` | ✅ Pass |
| Player is active (not finished) | ✅ `check(thrower.finishRank.isEmpty, ...)` | ✅ Pass |
| `cards.nonEmpty` | ✅ `check(cards.nonEmpty, ...)` | ✅ Pass |
| All cards in player's hand | ✅ `removeCards(thrower.hand, cards)` → `Left` if missing | ✅ Pass |
| Every card's rank matches a rank on the table (attack OR defense side) | ✅ `tableRanks` collects both attack and defense ranks via `flatMap` | ✅ Pass |
| `tablePairs.size + cards.size <= maxBoutAttacks` | ✅ Explicit `check` | ✅ Pass |
| During `Defense` only: uncovered cards ≤ defender's hand size | ✅ `state.tablePairs.count(_.defense.isEmpty) + cards.size <= defender.hand.size` | ✅ Pass |
| Remove cards from thrower's hand | ✅ `player.copy(hand = remainingHand)` | ✅ Pass |
| Add each as `TablePair(card, None)` | ✅ `cards.map(card => TablePair(card))` | ✅ Pass |
| During `Defense`: reset all non-defending active players' `hasPassed` | ✅ `if state.boutPhase == BoutPhase.Defense && idx != state.defenderIdx && updated.finishRank.isEmpty then updated.copy(hasPassed = false)` | ✅ Pass |
| During `SurrenderThrowIn`: do NOT reset passed flags | ✅ The `if` condition excludes this case (no else branch resets flags) | ✅ Pass |

---

### 3. Test Coverage Checklist

| Required Test | Present | Line |
|---|---|---|
| Valid surrender → `SurrenderThrowIn` | ✅ | L228 |
| Reject: non-defender surrenders | ✅ | L245 |
| Reject: wrong phase (not Defense) | ✅ | L257 |
| Reject: all cards covered | ✅ | L270 |
| Surrender: auto-passes cardless non-defenders | ✅ | L284 |
| Surrender: auto-passes all when bout is full | ✅ | L303 |
| Valid throw-in during Defense | ✅ | L327 |
| Throw-in matching a covering (defense-side) rank | ✅ | L349 |
| Valid throw-in during SurrenderThrowIn | ✅ | L368 |
| Throw-in by non-attacker/non-defender (3P) | ✅ | L386 |
| Reject: defender throws in | ✅ | L407 |
| Reject: rank not on table | ✅ | L420 |
| Reject: exceeds `maxBoutAttacks` | ✅ | L433 |
| Reject: cards not in hand | ✅ | L456 |
| Reject: wrong phase | ✅ | L469 |
| Reject: finished player throws in | ✅ | L483 |
| Reject: empty throw-in | ✅ | L498 |
| Defense throw-in resets all non-defender `hasPassed` | ✅ | L510 |
| SurrenderThrowIn throw-in does NOT reset `hasPassed` | ✅ | L532 |

All ticket-required tests plus additional edge-case coverage are present.

---

### 4. Other Observations

- **`applyAction` dispatch:** Both new cases are correctly routed (`case other =>` fallback path is still intact).
- **No regression to existing actions:** `CoverCard` and `RedirectAttack` are untouched except for the insertion of the two new cases above the `case other` fallback — no inadvertent shadowing.
- **`DefenderInitialHandSize` check in throw-in:** The check uses `state.tablePairs.count(_.defense.isEmpty) + cards.size <= defender.hand.size`, which correctly counts only currently **uncovered** attacking cards, not the total. This matches the SPEC ("a single move add more uncovered cards than `defender.hand.size`").
- **Surrender check allows surrender when some cards are covered and some aren't:** `state.tablePairs.exists(_.defense.isEmpty)` — correct per SPEC ("at least 1 uncovered attacking card on the table").
- **`boutPhase` is not updated by `ThrowInCards`** (only `tablePairs` and `players`), which is correct: a throw-in doesn't change the phase.
- **No stray mutations:** The implementation is purely functional (all `state.copy`), consistent with the rest of the engine.

---

### 5. Potential Concern (Minor — Not a Blocker)

In `applyDeclareSurrender`, the ticket requirement says:

> Reset all non-defending players' `hasPassed` to `false`, then auto-pass…

The implementation skips the explicit reset step — it directly sets `hasPassed = player.hand.isEmpty || boutIsFull` for every active non-defender. This means a previously-passed player who has cards and the bout isn't full gets their flag reset to `false` **as part of the same computation**, which is exactly the intended semantic. The logic is correct and equivalent.

---

VERDICT: APPROVED
