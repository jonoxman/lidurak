# T-05: Game Initialization — Shuffle, Deal, Trump, First Attacker

## Objective
Implement `GameEngine.createGame(config, playerNames)` that produces a fully initialized `GameState` ready for the first `InitialAttack`.

## Requirements

### File: `backend/src/main/scala/durak/engine/GameEngine.scala`

Create an object `GameEngine` with:

```scala
object GameEngine:
  def createGame(config: GameConfig, playerNames: Vector[String]): GameState
```

**Logic for `createGame`:**
1. Validate `playerNames.size == config.playerCount` and `playerCount in {2, 3, 4}`.
2. Generate the deck via `Deck.forPlayerCount(config.playerCount)`.
3. Shuffle using `new scala.util.Random(config.seed)` — use `random.shuffle(deck)`.
4. Deal 6 cards to each player sequentially (first 6 to player 0, next 6 to player 1, etc.).
5. The next card after all hands are dealt is the `bottomTrumpCard`. Place it logically at the **bottom** of the remaining talon (it will be the last card drawn). Set `trumpSuit` from this card's suit.
   - Implementation: after dealing, the remaining cards form the talon. The first of these remaining cards is the revealed bottom trump. Rearrange so `bottomTrumpCard` is `talon.last` and set `trumpSuit`.
6. **First attacker:** Find the player holding the lowest-rank trump card. If no player has a trump, `attackerIdx = 0`. `defenderIdx = nextActivePlayerIdx(attackerIdx)`.
7. Set `boutPhase = BoutPhase.InitialAttack`, `defenderInitialHandSize = players(defenderIdx).hand.size` (which is 6).

### Test File: `backend/src/test/scala/durak/engine/GameInitSuite.scala`

- **Deterministic shuffle:** Creating a game with the same seed twice yields identical states.
- **Hand sizes:** Every player receives exactly 6 cards after init.
- **No duplicate cards:** All cards across hands + talon are unique and sum to deck size.
- **Trump suit:** `trumpSuit` matches `bottomTrumpCard.get.suit`.
- **Bottom trump position:** `talon.last == bottomTrumpCard.get`.
- **First attacker — has trump:** Seed the game so at least one player has a trump. Verify the player with the lowest trump rank is `attackerIdx`.
- **First attacker — no trump:** Construct a scenario (or find a seed) where no player holds a trump card in their initial hand. Verify `attackerIdx == 0`.
- **Defender is clockwise:** `defenderIdx == (attackerIdx + 1) % playerCount` (when all players are active).
- **Bout phase:** `boutPhase == BoutPhase.InitialAttack`.
- **Player count validation:** Passing mismatched `playerNames.size` vs `config.playerCount` throws an exception.

## Acceptance Criteria
- [ ] `GameEngine.createGame` produces valid initial states
- [ ] All `GameInitSuite` tests pass

## Verification Command
```bash
cd backend && sbt test
```

