I'll read all three files in parallel to conduct a thorough review.
Now let me run the tests to verify they pass, and also check the existing codebase for context on the `Card`, `Rank`, and `Suit` types that are being referenced.
`sbt` is not installed in this environment, so I'll proceed with a thorough static analysis. Let me read the supporting model files to check consistency.
Now I have everything I need. Let me compile my full review analysis.

---

## Code Review: T-04 Game State Data Structures

### File-by-File Comparison Against Ticket Requirements

#### ✅ `BoutPhase.scala`
Exact match to the ticket spec. All five enum cases present: `InitialAttack`, `Defense`, `SurrenderThrowIn`, `BoutOver`, `GameOver`.

#### ✅ `TablePair.scala`
Exact match: `case class TablePair(attack: Card, defense: Option[Card] = None)`.

#### ✅ `PlayerState.scala`
Exact match to the ticket spec. The two helper methods `isActive` and `hasCards` are present and correctly implemented as documented.

#### ✅ `GameConfig.scala`
Exact match to the ticket spec.

#### ✅ `GameAction.scala`
Exact match — all six enum cases match the ticket: `InitialAttack`, `CoverCard`, `RedirectAttack`, `ThrowInCards`, `DeclareSurrender`, `PassTurn` with the correct parameter signatures.

#### ✅ `GameState.scala`
Exact match to the case class definition. All four required helper methods are implemented and semantically correct:

- **`activePlayers`** — correctly filters on `finishRank.isEmpty` ✅
- **`activePlayersWithCards`** — correctly chains active + nonEmpty hand ✅
- **`maxBoutAttacks`** — `Math.min(6, defenderInitialHandSize)` ✅
- **`nextActivePlayerIdx`** — clockwise wrap using `Math.floorMod` + offset search; correctly falls back to `start` when no other active player found (all-finished edge case) ✅

---

### Unit Test Review (`GameStateSuite.scala`)

All four categories required by the ticket are covered:

| Ticket Requirement | Test(s) Present | Assessment |
|---|---|---|
| `activePlayers` filters finished players | `"activePlayers filters out finished players"` | ✅ Correct |
| `activePlayersWithCards` filters empty hands | `"activePlayersWithCards filters out empty hands"` | ✅ Correct — also validates that a player with `finishRank` AND empty hand is excluded (p3) |
| `maxBoutAttacks` returns `min(6, defenderInitialHandSize)` | `"maxBoutAttacks returns min(6, defenderInitialHandSize)"` | ✅ Five boundary cases: 7, 6, 4, 1, 0 |
| `nextActivePlayerIdx` wraps for 2/3/4 players, skips finished | 5 tests for 2/3/4-player wrap + skip finished + single-active | ✅ Comprehensive |

#### Test Correctness Spot-Checks

- **`"activePlayersWithCards"` test setup**: p3 has `handSize=0, finishRank=Some(1)` — correctly excluded both as finished AND empty-handed. ✅
- **`"nextActivePlayerIdx returns the only active seat when all others finished"`**: state has p0 (active) and p1 (finished). `nextActivePlayerIdx(0)` should return `0` (only active seat). The implementation falls through to `.getOrElse(start)` returning `start=0`. ✅
- **`"nextActivePlayerIdx skips finished players"`**: p1 and p3 finished; `nextActivePlayerIdx(0)` should skip p1 → return 2; `nextActivePlayerIdx(2)` should skip p3 → return 0. Both correct per implementation. ✅
- **`maxBoutAttacks` edge case `defenderInitialHandSize=0`**: returns `min(6,0) = 0`. Correct per spec. ✅

---

### SPEC.md Consistency Check

- `SPEC.md §3.2` confirms `maxBoutAttacks = Math.min(6, defenderInitialHandSize)` — matches. ✅
- `SPEC.md §3.3` references `finishOrder: Vector[PlayerId]` — the implementation uses `Vector[String]` with a comment confirming Player IDs. ✅
- `SPEC.md §4.1` references `finishRank: Option[Int]` in `PlayerState` — matches. ✅
- `SPEC.md §3.1` confirms `trumpSuit: Suit` and `bottomTrumpCard: Option[Card]` — both present. ✅

---

### No Issues Found

- No missing fields, no extraneous fields.
- No logic bugs detected in helper methods.
- No missing test cases per ticket requirements.
- No SPEC deviations.
- All types (`Card`, `Suit`, `Rank`) are present in the engine package and correctly used in tests.

---

VERDICT: APPROVED
