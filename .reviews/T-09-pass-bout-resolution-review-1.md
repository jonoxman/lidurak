I'll read all three files simultaneously to do a thorough review.
Now let me look at the existing codebase to cross-reference with the diff — particularly the `GameState`, `PlayerState`, `GameAction`, and related types to validate correctness.
Now let me look at the `TablePair` and `BoutPhase` types to complete my understanding:
Now let me run the test suite to verify all tests pass:
sbt is not available locally (it runs in Docker). I'll proceed with a thorough static analysis of the code.

---

## Code Review: T-09 Pass & Bout Resolution

### Summary of Changes

The diff introduces:
1. **`applyPassTurn`** in [`GameEngine.scala`](file:///home/shade_of_ox/agent-project/backend/src/main/scala/durak/engine/GameEngine.scala#L282-L302)
2. **`settlePasses`** helper at [L308–L320](file:///home/shade_of_ox/agent-project/backend/src/main/scala/durak/engine/GameEngine.scala#L308-L320)
3. **`resolveBout`** helper at [L327–L355](file:///home/shade_of_ox/agent-project/backend/src/main/scala/durak/engine/GameEngine.scala#L327-L355)
4. **`drawHands`** helper at [L361–L374](file:///home/shade_of_ox/agent-project/backend/src/main/scala/durak/engine/GameEngine.scala#L361-L374)
5. **`drawToHandSize`** helper at [L377–L386](file:///home/shade_of_ox/agent-project/backend/src/main/scala/durak/engine/GameEngine.scala#L377-L386)
6. **`BoutResolutionSuite.scala`** — 437-line test file

---

### Requirement Verification

#### `applyPassTurn` Validations (Ticket §PassTurn validations)

| Req | Check | Status |
|---|---|---|
| 1. Phase must be `Defense` or `SurrenderThrowIn` | `passablePhase` guard on L283–284 | ✅ |
| 2. `playerId` is NOT the defender | `playerIdx != state.defenderIdx` on L291 | ✅ |
| 3. Player is active | `passer.isActive` on L290 | ✅ |
| 4. Player has not already passed | `!passer.hasPassed` on L292 | ✅ |
| 5. During Defense: all cards covered OR table full | L293–297 | ✅ |

**Unknown player detection**: `state.players.lift(playerIdx)` — when `indexWhere` returns `-1`, `lift(-1)` returns `None`, yielding `Left(s"Unknown player: $playerId")`. ✅ Correct.

#### `settlePasses` — Auto-pass & trigger resolution

- Auto-passes non-defenders with empty hands or when table is full. ✅
- Triggers `resolveBout` only when **all** active non-defenders have passed. ✅

#### `resolveBout` — Case A (Successful Defense)

| Req | Implementation | Status |
|---|---|---|
| Move table cards to discard | `state.copy(tablePairs = Vector.empty, discardPile = state.discardPile ++ tableCards)` | ✅ |
| Draw in correct order | `drawHands(afterTable, includeDefender = true)` | ✅ |
| Old defender → new attacker | `newAttackerIdx = state.defenderIdx` (when `!surrendered`) | ✅ |
| New defender = next active clockwise | `drawn.nextActivePlayerIdx(newAttackerIdx)` | ✅ |
| Reset `boutPhase = InitialAttack` | L353 | ✅ |
| Reset all `hasPassed = false` | `drawn.players.map(_.copy(hasPassed = false))` L350 | ✅ |
| Set `defenderInitialHandSize` | `drawn.players(newDefenderIdx).hand.size` L354 | ✅ |

#### `resolveBout` — Case B (Surrender)

| Req | Implementation | Status |
|---|---|---|
| Defender picks up all table cards | `defender.copy(hand = defender.hand ++ tableCards)` | ✅ |
| Defender does NOT draw | `drawHands(afterTable, includeDefender = false)` | ✅ |
| Skip defender for next attack | `newAttackerIdx = drawn.nextActivePlayerIdx(state.defenderIdx)` | ✅ |
| New defender = next after new attacker | `drawn.nextActivePlayerIdx(newAttackerIdx)` | ✅ |
| `boutPhase = InitialAttack` | ✅ | ✅ |

#### `drawHands` — Draw Order

Draw order is: attacker → other non-defenders clockwise → defender. The implementation at L362–374:
- Starts with `attackerIdx`
- Generates `others` as offsets 1..(N-1) from attacker, filtered to exclude defender and inactive players
- Appends defender last (if `includeDefender`)

✅ Correct.

#### `drawToHandSize` — `bottomTrumpCard` clearing

When `remaining.isEmpty` (talon exhausted), `bottomTrumpCard = None`. ✅ Matches SPEC §3.1.

---

### Test Coverage Verification

| Ticket Test Requirement | Test Name | Present |
|---|---|---|
| Valid pass when all cards covered | `"a non-defender can pass once every attacking card is covered"` | ✅ |
| Valid pass during SurrenderThrowIn | `"a non-defender can pass during the surrender throw-in phase"` | ✅ |
| Reject: pass when uncovered cards remain | `"passing is rejected while attacking cards remain uncovered"` | ✅ |
| Reject: defender tries to pass | `"the defender cannot pass"` | ✅ |
| Reject: player already passed | `"a player cannot pass twice"` | ✅ |
| Reject: wrong phase | `"passing is rejected outside the defense and surrender phases"` | ✅ |
| Reject: unknown player | `"an unknown player cannot pass"` | ✅ |
| Auto-pass empty-hand players | `"players with empty hands are auto-passed"` | ✅ |
| Table cards → discard pile | `"table cards move to the discard pile after a successful defense"` | ✅ |
| Roles rotate on successful defense | `"successful defense rotates the defender into the attacker seat"` | ✅ |
| Draw order (attacker first, defender last) | `"players draw in order: attacker, other non-defenders clockwise, then defender"` | ✅ |
| Draw stops when talon empties | `"drawing stops when the talon empties and clears the bottom trump"` | ✅ |
| `bottomTrumpCard` drawn last | `"the bottom trump is drawn last when it is the final talon card"` | ✅ |
| Defender picks up table cards on surrender | `"a surrendering defender picks up every table card"` | ✅ |
| Non-defenders draw; defender does not (surrender) | `"non-defenders draw after a surrender while the defender does not"` | ✅ |
| Surrendering defender skipped for next attack | `"a surrendering defender is skipped for the next attack"` | ✅ |
| 3P successful defense role cycling | `"successful defense cycles the attack clockwise through a three-player game"` | ✅ |
| Role rotation skips finished players | `"role rotation skips finished players"` | ✅ |

All 18 test scenarios from the ticket are covered.

---

### Potential Issues Identified

#### ⚠️ Issue 1 — `drawHands` includes the attacker even if they are inactive

In `drawHands`, the draw order starts unconditionally with `attackerIdx +: ...`. There is **no guard** that `state.players(attackerIdx).isActive`. If somehow `attackerIdx` references a finished player (theoretically impossible at resolution time because the attacker must be active to have played the attack), `drawToHandSize` would still run on them. In practice this is safe given game flow invariants, but it is subtly brittle.

#### ⚠️ Issue 2 — `resolveBout` does NOT handle player elimination

The SPEC (§3.3) states:
> Once `talon.isEmpty`, any player whose hand reaches 0 cards immediately finishes the game and is recorded in `finishOrder`.

Neither `resolveBout` nor `drawToHandSize` updates `finishOrder` or sets `finishRank` for players who empty their hands after the draw. This is a missing requirement from the SPEC. **However**, the T-09 ticket itself does not list player elimination as a requirement — it is scoped only to pass/bout resolution/draw/role-rotation. So this is a pre-existing gap that belongs to a future ticket, not a failure of this ticket.

#### ✅ Issue 3 — `tablePairs.size >= maxBoutAttacks` as pass condition

The SPEC says auto-pass when `tablePairs.size == maxBoutAttacks`. The code correctly uses `>=` (defensive against overflow). ✅

#### ✅ Issue 4 — `settlePasses` in `SurrenderThrowIn` phase

In `SurrenderThrowIn`, `tableIsFull = tablePairs.size >= maxBoutAttacks` can auto-pass non-defenders. This is correct — the SPEC says auto-pass applies whenever "table is full" regardless of phase.

#### ⚠️ Issue 3 — Test: "drawing stops when talon empties" — defender hand size assertion

In the test at line 536:
```scala
assertEquals(next.players(0).hand.size, 5)
```
Attacker starts with 3 cards, table had 2 cards consumed (six+seven discarded), so after discard attacker still has 3 cards. Talon = `[first, bottom]` = 2 cards. Attacker needs 3 more cards to reach 6, but only 2 remain — so gets 2, giving `3 + 2 = 5`. ✅ Correct.

Defender line 539:
```scala
assertEquals(next.players(1).hand.size, 5)
```
Defender started with 5 cards and needed 1 to reach 6, but talon is already empty after attacker drew 2. So defender gets 0 more → stays at 5. ✅ Correct.

---

### Spec Cross-Check

- **SPEC §3.2 — `PassTurn` condition**: "all attacking cards on the table are covered OR in `PHASE_SURRENDER_THROW_IN`" — correctly gated at `applyPassTurn`. ✅
- **SPEC §3.3 — Draw order**: Attacker → clockwise non-defenders → defender. ✅
- **SPEC §3.1 — `bottomTrumpCard` cleared on talon empty**: ✅

---

### Verdict

The implementation correctly fulfills all T-09 requirements. All 18 required test cases are present, logically sound, and cover the specified edge cases. The identified minor concern (no inactive-player guard on `drawHands` attacker slot) is benign given game flow invariants. Player elimination tracking is intentionally out of scope for this ticket.

VERDICT: APPROVED
