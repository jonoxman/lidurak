# T-03: Core Domain Models — Suit, Rank, Card, Deck

## Objective
Implement the foundational immutable data types for the Durak card engine: `Suit`, `Rank`, `Card`, and `Deck` object with 36-card and 52-card generation. All types go in `backend/src/main/scala/durak/engine/`.

## Requirements

### File: `backend/src/main/scala/durak/engine/Suit.scala`
```scala
package durak.engine

enum Suit:
  case Clubs, Diamonds, Hearts, Spades
```

### File: `backend/src/main/scala/durak/engine/Rank.scala`
```scala
package durak.engine

enum Rank(val value: Int):
  case Two extends Rank(2)
  case Three extends Rank(3)
  case Four extends Rank(4)
  case Five extends Rank(5)
  case Six extends Rank(6)
  case Seven extends Rank(7)
  case Eight extends Rank(8)
  case Nine extends Rank(9)
  case Ten extends Rank(10)
  case Jack extends Rank(11)
  case Queen extends Rank(12)
  case King extends Rank(13)
  case Ace extends Rank(14)
```
- Provide `Ordering[Rank]` via `Rank.value`.

### File: `backend/src/main/scala/durak/engine/Card.scala`
```scala
package durak.engine

case class Card(suit: Suit, rank: Rank)
```
- Provide `Ordering[Card]` (compare by rank value, then suit ordinal as tiebreaker).

### File: `backend/src/main/scala/durak/engine/Deck.scala`
```scala
package durak.engine

object Deck:
  def standard36: Vector[Card] = // All Suit × Rank where rank.value >= 6
  def standard52: Vector[Card] = // All Suit × Rank
  def forPlayerCount(n: Int): Vector[Card] = n match
    case 2 | 3 => standard36
    case 4     => standard52
    case _     => throw IllegalArgumentException(...)
```

### Test File: `backend/src/test/scala/durak/engine/DeckSuite.scala`
- `standard36` has exactly 36 cards, no duplicates, minimum rank is `Six`.
- `standard52` has exactly 52 cards, no duplicates, minimum rank is `Two`.
- `forPlayerCount(2)` and `forPlayerCount(3)` return 36; `forPlayerCount(4)` returns 52.
- `forPlayerCount(5)` throws `IllegalArgumentException`.
- `Card` ordering: `Card(Hearts, Six) < Card(Hearts, Ace)`.

## Acceptance Criteria
- [ ] All model files compile with no warnings
- [ ] `DeckSuite` tests all pass

## Verification Command
```bash
cd backend && sbt test
```

