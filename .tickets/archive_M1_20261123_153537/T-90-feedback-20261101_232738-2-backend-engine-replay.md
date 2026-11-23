<!-- WAVE:1 -->
# Ticket T-90-2: Backend Discard Pile Visibility, Overall Game Timer, Move-by-Move Serialization & Multi-Player Throw-In Clock

## Context & Motivation
This ticket implements all backend engine, state projection, serialization, and server actor features required for:
1. **Discard Pile Visibility (Req 7):** Tracking all discarded cards while revealing only the cards from the most recent bout that ended in a successful defense.
2. **Overall Game Timer (Req 10):** Starting the overall game clock on the very first move of the game and stopping it when the game reaches `GameOver`.
3. **Game Serialization & Replay API (Req 11 & 12):** Recording the entire game move-by-move (including initial deck order, trump suit, player hands, active turn, move timestamps relative to the game timer, and edge cases like rapid consecutive paired throw-ins) and serving it via REST for Game Review mode.
4. **Throw-In Phase Turn Clock & Auto-Pass for Every Eligible Player (Req 14):** Ensuring the turn clock ticks for *every* eligible throw-in player during both `SurrenderThrowIn` and mid-defense throw-in states, and automatically passing for any player whose clock runs out.

## Scope & Files to Touch
- **Allowed files:**
  - `backend/src/main/scala/durak/engine/GameState.scala`
  - `backend/src/main/scala/durak/engine/GameEngine.scala`
  - `backend/src/main/scala/durak/engine/PlayerGameView.scala`
  - `backend/src/main/scala/durak/engine/JsonCodecs.scala`
  - `backend/src/main/scala/durak/engine/GameReplay.scala` *(new file optional, or define in existing engine files)*
  - `backend/src/main/scala/durak/server/GameActor.scala`
  - `backend/src/main/scala/durak/server/GameManager.scala`
  - `backend/src/main/scala/durak/server/GameRoutes.scala`
  - `backend/src/test/scala/durak/**`
- **Do NOT touch:** Any files in `frontend/`, `README.md`, `ARCHITECTURE.md`, or `play-local.sh`.

## Detailed Requirements

### 1. Discard Pile Feature (`GameState`, `GameEngine`, `PlayerGameView`, `JsonCodecs`)
- In `GameState`:
  - Add `lastDiscardCards: Vector[Card] = Vector.empty` (defaulting to `Vector.empty` at game initialization).
  - When a bout ends in a **successful defense** (in `GameEngine` when all `tablePairs` are covered and all eligible attackers have passed), the cards from that bout (`val boutCards = state.tablePairs.flatMap(p => Vector(p.attack) ++ p.defense.toVector)`) are appended to `discardPile` AND `lastDiscardCards` is updated to `boutCards`.
  - When a bout ends in a **surrender** (defender picks up the table cards), no cards go to `discardPile`, and `lastDiscardCards` remains unchanged (still holding the cards from the last round that ended in a successful defense).
  - Verify the Card Conservation Invariant holds (`lastDiscardCards` is a subset/slice of `discardPile`, not counted twice).
- In `PlayerGameView`:
  - Add `discardCount: Int` (equal to `state.discardPile.size`).
  - Add `lastDiscardCards: Vector[Card]` (equal to `state.lastDiscardCards`).
  - Hidden earlier cards in `discardPile` (`discardPile.dropRight(lastDiscardCards.size)`) must NOT be leaked in `PlayerGameView` during an active game.
  - Update `JsonCodecs` to encode and decode `discardCount` and `lastDiscardCards` on `PlayerGameView` (and `lastDiscardCards` on `GameState`).

### 2. Overall Game Timer (`GameState`, `PlayerGameView`, `GameActor`, `JsonCodecs`)
- The overall game timer starts counting up from `0` **when the first move of the game is made**, and stops counting **when the game ends (`boutPhase == BoutPhase.GameOver`)**.
- Track in `GameState` (or `GameActor` projected into `GameState` / `PlayerGameView`):
  - `gameStartedAtMs: Option[Long] = None`
  - `gameEndedAtMs: Option[Long] = None`
- When a game is newly created (before any move is played), `gameStartedAtMs` is `None` and `gameEndedAtMs` is `None`.
- When the very first valid move (`GameAction`) is applied in `GameActor`, set `gameStartedAtMs = Some(nowMs)` (if the first move itself immediately ends the game, also set `gameEndedAtMs = Some(nowMs)`).
- On subsequent moves, keep `gameStartedAtMs` unchanged. As soon as any transition produces `state.boutPhase == BoutPhase.GameOver`, set `gameEndedAtMs = Some(nowMs)` (if not already set).
- Expose `gameStartedAtMs: Option[Long]` and `gameEndedAtMs: Option[Long]` on `PlayerGameView` and in `JsonCodecs`.

### 3. Move-by-Move Game Serialization & Replay Endpoint (`durak.engine`, `GameActor`, `GameRoutes`, `JsonCodecs`)
- Define serializable data structures (with full Circe `Encoder` and `Decoder` in `JsonCodecs`):
  - **Complete `GameState` & `GameConfig` JSON Codecs:** Ensure `GameConfig`, `PlayerState`, `GameState` have lossless round-trip JSON `Encoder` and `Decoder` instances (preserving `talon` order, `bottomTrumpCard`, `trumpSuit`, `discardPile`, `lastDiscardCards`, `tablePairs`, `players` with hands, `attackerIdx`, `defenderIdx`, `boutPhase`, `winners`, `durak`, etc.).
  - **`RecordedMove`:**
    - `moveIndex: Int` (1-based sequential index: `1, 2, 3, ...`)
    - `playerId: String` (seat that made the move)
    - `action: GameAction` (the atomic action applied)
    - `elapsedMs: Long` (time on the overall game timer when the move was made: `0L` for the first move `moveIndex == 1`, and `math.max(0L, nowMs - gameStartedAtMs)` for subsequent moves)
    - `stateAfter: GameState` (full `GameState` immediately after this move)
  - **`ReplayFrame`:**
    - `moveIndex: Int` (`0` for initial deal before any move; `1..N` for each recorded move)
    - `playerId: Option[String]` (`None` for frame `0`, `Some(playerId)` for `1..N`)
    - `action: Option[GameAction]` (`None` for frame `0`, `Some(action)` for `1..N`)
    - `elapsedMs: Long` (`0L` for frame `0` and frame `1`, and the move's `elapsedMs` for `2..N`)
    - `state: GameState`
    - `views: Map[String, PlayerGameView]` (precomputed `PlayerGameView.forViewer(state, p.id)` for every seat in `state.players`, with `turnDeadlineMs = None`, `gameStartedAtMs = Some(0L)`, `gameEndedAtMs = Some(elapsedMs)` so the frontend can render any player's POV at any move with the exact frozen timestamp!)
  - **`SerializedGame` (or `GameReplay`):**
    - `gameId: String`
    - `config: GameConfig`
    - `initialState: GameState`
    - `moves: Vector[RecordedMove]`
    - `frames: Vector[ReplayFrame]` (frame `0` constructed from `initialState`, followed by frames `1..N` from `moves`)
    - Helper `GameReplay.verifyReplay(serialized: SerializedGame): Either[String, Vector[GameState]]` that replays `moves` starting from `initialState` using `GameEngine.applyAction` to verify deterministic reproduction.
- **Edge Case — Paired / Multi-Card Throw-Ins in Quick Succession:**
  - If a player plays two paired cards one after the other in quick succession before another player responds (two separate `ThrowInCards` requests), each request is processed sequentially through `GameActor`'s atomic state mutex/ref and recorded as a separate `RecordedMove` with its own `moveIndex` and `elapsedMs`.
  - Additionally, if a single `GameAction.ThrowInCards(cards)` call ever contains multiple cards (`cards.size > 1`), decompose it in `GameActor` into individual single-card `GameAction.ThrowInCards(Vector(card))` applications one by one so that each thrown-in card is recorded as its own atomic move step in the serialized history!
- **REST Endpoint in `GameRoutes`:**
  - Add `GET /api/games/:gameId/replay` (and alias `GET /api/game/:gameId/replay`) returning `200 OK` with the `SerializedGame` JSON (including `gameId`, `config`, `initialState`, `moves`, and `frames`), or `404 Not Found` if `gameId` does not exist.

### 4. Turn Clock & Auto-Pass for Every Player in the Throw-In Phase (`GameActor`, `PlayerGameView`)
- Check how `promptedPlayerId` and `turnDeadlineMs` currently work in `GameActor.scala` and `PlayerGameView.scala`:
  - Currently, `promptedPlayerId(state)` returns a single `Option[String]`, so during a throw-in phase in 3- or 4-player games, only one attacker receives `turnDeadlineMs` while other eligible throw-in players see a frozen clock!
  - Update the turn clock logic so that **every player who is currently prompted to act** sees the active `turnDeadlineMs`:
    - Define `promptedPlayerIds(state: GameState): Set[String]`:
      - During `BoutPhase.GameOver`: `Set.empty`
      - During `BoutPhase.InitialAttack` (or `BoutPhase.Attacking` when `state.tablePairs.isEmpty`): `Set(state.players(state.attackerIdx).id)`
      - When `state.tablePairs.exists(!_.isCovered)` and `state.boutPhase != BoutPhase.SurrenderThrowIn` (defender facing uncovered cards): `Set(state.players(state.defenderIdx).id)`
      - **Throw-In Phase** (either `state.boutPhase == BoutPhase.SurrenderThrowIn` OR `state.tablePairs.nonEmpty && state.tablePairs.forall(_.isCovered)`): **every** active non-defender player who still holds cards and has not yet passed (`!p.hasPassed`, i.e., every player `p` for whom `PlayerGameView.computeLegalActions(state, p.id).contains(GameAction.PassTurn)`).
  - In `PlayerGameView.forViewer(state, viewerId)`:
    - Expose `turnDeadlineMs` for `viewerId` whenever `promptedPlayerIds(state).contains(viewerId)` (or keep `turnDeadlineMs` on `state` and set it on `PlayerGameView` for every viewer in `promptedPlayerIds(state)`).
  - **Deadline Duration & Auto-Action Execution in `GameActor`:**
    - During the throw-in phase (when `promptedPlayerIds(state)` are throw-in players with `PassTurn` legal):
      - Use the full 15-second turn clock (`turnDurationMs`, default `15000 ms`) whenever at least one prompted human throw-in player is on the clock (note: for a defender with no legal cover/redirect where only `DeclareSurrender` is legal, keep the 3-second `forcedDelayMs` auto-surrender).
      - When the turn clock deadline expires during a throw-in phase, automatically apply `GameAction.PassTurn` for every remaining un-passed human throw-in player in `promptedPlayerIds(state)` (recording each `PassTurn` move in the game replay history) so the bout resolves cleanly!

## Acceptance Criteria & Verification
1. Write comprehensive MUnit tests in `backend/src/test/scala/durak/`:
   - Verify `discardCount` and `lastDiscardCards` after a successful defense bout, after a second successful defense bout (only the second bout's cards are in `lastDiscardCards`, while `discardCount` equals the sum of both), and after a surrender bout (`lastDiscardCards` retains the last successful defense's cards).
   - Verify `gameStartedAtMs` is `None` before the first move, becomes `Some(...)` on the first move, and `gameEndedAtMs` becomes `Some(...)` when `GameOver` is reached.
   - Verify `SerializedGame` records `initialState`, every move with `elapsedMs`, splits/records rapid consecutive paired throw-ins as separate moves, round-trips through Circe JSON codecs, and `GET /api/games/:gameId/replay` returns the full replay with per-player `views` at each frame `0..N`.
   - Verify `promptedPlayerIds` includes all eligible throw-in players during both mid-defense throw-in (`allCovered`) and `SurrenderThrowIn`, and auto-passes on clock expiration.
2. Run `cd backend && sbt -batch test` and ensure all tests pass with zero warnings or errors.
3. Write your implementation summary to `.reviews/agent_notes.md` and run `echo "DONE" > .tickets/STATUS`.
