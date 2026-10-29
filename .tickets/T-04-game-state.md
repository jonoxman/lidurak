# T-04: Game State Data Structures

## Objective
Define all case classes and ADTs for the Durak game state machine: `BoutPhase`, `TablePair`, `PlayerState`, `GameConfig`, `GameAction`, and `GameState`.

## Requirements

All files in `backend/src/main/scala/durak/engine/`.

### File: `BoutPhase.scala`
```scala
enum BoutPhase:
  case InitialAttack
  case Defense
  case SurrenderThrowIn
  case BoutOver       // Transient phase during resolution
  case GameOver
```

### File: `TablePair.scala`
```scala
case class TablePair(attack: Card, defense: Option[Card] = None)
```

### File: `PlayerState.scala`
```scala
case class PlayerState(
  id: String,
  name: String,
  hand: Vector[Card],
  hasPassed: Boolean = false,
  finishRank: Option[Int] = None  // 1 = first out, etc. Last = Durak
)
```
- A player is "active" (still in the game) iff `finishRank.isEmpty`.
- A player "has cards" iff `hand.nonEmpty`.

### File: `GameConfig.scala`
```scala
case class GameConfig(
  playerCount: Int,
  allowRedirect: Boolean = true,
  seed: Long = System.currentTimeMillis()
)
```

### File: `GameAction.scala`
```scala
enum GameAction:
  case InitialAttack(playerId: String, cards: List[Card])
  case CoverCard(playerId: String, attackIndex: Int, defenseCard: Card)
  case RedirectAttack(playerId: String, cards: List[Card])
  case ThrowInCards(playerId: String, cards: List[Card])
  case DeclareSurrender(playerId: String)
  case PassTurn(playerId: String)
```

### File: `GameState.scala`
```scala
case class GameState(
  config: GameConfig,
  players: Vector[PlayerState],
  talon: Vector[Card],          // Remaining draw pile (hidden)
  trumpSuit: Suit,
  bottomTrumpCard: Option[Card], // Last card of talon, shown face-up
  discardPile: Vector[Card],
  tablePairs: Vector[TablePair],
  attackerIdx: Int,
  defenderIdx: Int,
  boutPhase: BoutPhase,
  defenderInitialHandSize: Int,
  finishOrder: Vector[String],   // Player IDs in order of finishing
  isDraw: Boolean = false
)
```
- Helper methods:
  - `activePlayers: Vector[PlayerState]` — players with `finishRank.isEmpty`
  - `activePlayersWithCards: Vector[PlayerState]` — active players with `hand.nonEmpty`
  - `maxBoutAttacks: Int` — `Math.min(6, defenderInitialHandSize)`
  - `nextActivePlayerIdx(fromIdx: Int): Int` — next seat clockwise among active players

### Test File: `backend/src/test/scala/durak/engine/GameStateSuite.scala`
- `activePlayers` correctly filters finished players
- `activePlayersWithCards` correctly filters empty hands
- `maxBoutAttacks` returns `min(6, defenderInitialHandSize)`
- `nextActivePlayerIdx` wraps around correctly for 2, 3, and 4 players, skipping finished players

## Acceptance Criteria
- [ ] All data structure files compile
- [ ] `GameStateSuite` tests pass

## Verification Command
```bash
cd backend && sbt test
```

