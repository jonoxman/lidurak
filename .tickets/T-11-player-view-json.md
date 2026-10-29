# T-11: PlayerGameView Projection & Circe JSON Codecs

## Objective
Implement the `PlayerGameView` projection that strips hidden information from `GameState`, and define Circe JSON encoders/decoders for all engine types and WebSocket messages.

## Requirements

### File: `backend/src/main/scala/durak/engine/PlayerGameView.scala`

```scala
case class PublicPlayerSummary(
  id: String,
  name: String,
  cardCount: Int,
  hasPassed: Boolean,
  finishRank: Option[Int]
)

case class PlayerGameView(
  myId: String,
  myHand: List[Card],
  opponents: List[PublicPlayerSummary],
  tablePairs: Vector[TablePair],
  talonCount: Int,
  bottomTrumpCard: Option[Card],  // None when talon is empty
  trumpSuit: Suit,
  attackerIdx: Int,
  defenderIdx: Int,
  boutPhase: BoutPhase,
  legalActions: List[String],     // e.g. ["attack", "cover", "pass", "surrender", "redirect", "throwIn"]
  finishOrder: Vector[String],
  isDraw: Boolean,
  maxBoutAttacks: Int
)

object PlayerGameView:
  def forViewer(state: GameState, viewerId: String): PlayerGameView
```

**`forViewer` logic:**
1. Find the viewer's `PlayerState` by `viewerId`.
2. `myHand` = viewer's hand as `List[Card]`.
3. `opponents` = all other players mapped to `PublicPlayerSummary` (only `cardCount`, never actual cards).
4. `talonCount` = `state.talon.size`.
5. `bottomTrumpCard` = `state.bottomTrumpCard` only if `talon.nonEmpty`, else `None`.
6. Compute `legalActions` for this viewer based on current state (what actions the viewer can currently perform).

### File: `backend/src/main/scala/durak/engine/JsonCodecs.scala`

Provide Circe `Encoder` and `Decoder` instances for:
- `Suit`, `Rank`, `Card`
- `TablePair`, `BoutPhase`
- `PublicPlayerSummary`, `PlayerGameView`
- `GameAction` (all variants, for receiving WebSocket commands)

Use `circe-generic` semi-auto derivation or manual codecs. Ensure:
- `Suit` and `Rank` serialize as lowercase strings (e.g., `"hearts"`, `"ace"`)
- `Card` serializes as `{"suit": "hearts", "rank": "ace"}`
- `GameAction` uses a `"type"` discriminator field (e.g., `{"type": "initialAttack", "playerId": "...", "cards": [...]}`)

### Test File: `backend/src/test/scala/durak/engine/PlayerViewSuite.scala`

**Projection Tests:**
- Viewer's own hand is included correctly
- Opponent cards are NOT included (only `cardCount`)
- `talonCount` matches actual talon size
- `bottomTrumpCard` is `None` when talon is empty
- `legalActions` correctly lists available actions per phase and role

### Test File: `backend/src/test/scala/durak/engine/JsonCodecsSuite.scala`

**Round-Trip Tests:**
- `Card` encodes and decodes correctly
- `PlayerGameView` round-trips through JSON
- `GameAction.InitialAttack` decodes from JSON string
- `GameAction.CoverCard` decodes from JSON string
- `GameAction.RedirectAttack` decodes from JSON string
- All `GameAction` variants decode correctly with `"type"` discriminator

## Acceptance Criteria
- [ ] `PlayerGameView.forViewer` never leaks hidden state
- [ ] All JSON codecs round-trip correctly
- [ ] All tests pass

## Verification Command
```bash
cd backend && sbt test
```

