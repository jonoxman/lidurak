# T-10: Endgame — Player Elimination, Victory Conditions, Draw Detection

## Objective
Implement post-bout player elimination checks, finish ordering, game-over detection, and the 2-player simultaneous draw condition.

## Requirements

### In `GameEngine` (extend `resolveBout` or add `checkEndgame`):

After the draw phase of bout resolution, add an endgame check step:

#### Player Elimination
- When `talon.isEmpty`: any active player whose `hand.isEmpty` is **eliminated** (finished the game successfully).
- Set their `finishRank` to `finishOrder.size + 1` and append their `id` to `finishOrder`.
- Process eliminations in a consistent order (by seat index).

#### 2-Player Draw Detection
- After a successful defense bout (Case A), if `talon.isEmpty` and both remaining players have `hand.isEmpty` simultaneously (attacker played last cards, defender covered with last cards), mark `isDraw = true`, and both players are added to `finishOrder` with the same `finishRank`.

#### Game Over Check
- After eliminations, if `activePlayersWithCards.size <= 1`:
  - If exactly 1 player remains with cards: they are the **Durak** (last place). Set their `finishRank` to `finishOrder.size + 1`, add to `finishOrder`.
  - Set `boutPhase = BoutPhase.GameOver`.
- If `activePlayersWithCards.size == 0` (all players finished, e.g., 2-player draw): set `boutPhase = BoutPhase.GameOver`.

### Test File: `backend/src/test/scala/durak/engine/EndgameSuite.scala`

**Elimination Tests:**
- Player with empty hand after talon is depleted gets `finishRank` assigned
- Multiple players finishing in same bout get ranks in seat order
- Player finishing first gets `finishRank = 1`

**Durak Detection Tests:**
- Last player with cards is the Durak (highest `finishRank`)
- Game phase transitions to `GameOver`

**2-Player Draw Tests:**
- Construct a late-game state where talon is empty, attacker plays last card(s), defender covers with last card(s) → both finish simultaneously → `isDraw == true`, both have same `finishRank`

**3/4-Player Endgame Tests:**
- Players eliminated in correct order over multiple bouts
- Game ends when only 1 player has cards remaining

**Full Game Simulation Test:**
- Play through a complete 2-player game using a fixed seed, applying a predetermined sequence of legal actions, and verify the game reaches `GameOver` with correct `finishOrder`

## Acceptance Criteria
- [ ] Endgame logic fully implemented and integrated into bout resolution
- [ ] All `EndgameSuite` tests pass

## Verification Command
```bash
cd backend && sbt test
```

