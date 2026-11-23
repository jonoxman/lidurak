<!-- WAVE:1 -->
# Ticket T-90-feedback-20261102_215731-1: Instant RandomBot Moves, Throw-In Prompt Projection & Game-Over/Replay Endpoint Reliability

## Summary
1. Update the backend bot runner (`GameActor.scala`) so `RandomBot` plays its moves instantly (`0.millis` delay, yielding via `IO.cede`), while `BasicBot` retains its existing random delay (`500 ms`–`2000 ms` by default) between moves.
2. Verify and fix `GameEngine`, `PlayerGameView`, `GameReplay`, `GameActor`, and `GameRoutes` for finished games (`BoutPhase.GameOver`) and throw-in eligibility (`ThrowInCards`) so that:
   - Whenever a game finishes (including when instant `RandomBot` seats finish a match rapidly or when a human/bot plays the final card), `BoutPhase.GameOver` and `gameEndedAtMs` are recorded in both the live room `Ref` and the `GameReplay` frames, published over the WebSocket `Topic`, and served without error on `GET /api/games/:gameId/view`, `GET /api/games/:gameId/replay`, and `/ws/game/:gameId/:playerId`.
   - After the initial attack has been played (`BoutPhase.Defense` and `BoutPhase.SurrenderThrowIn`), every player who is able to throw in cards receives their legal `ThrowInCards` actions in `PlayerGameView.legalActions` and is included in `promptedPlayerIds` when eligible.

## File Scope (Exclusive to this Ticket in Wave 1)
- `backend/src/main/scala/durak/server/GameActor.scala`
- `backend/src/main/scala/durak/server/GameRoutes.scala`
- `backend/src/main/scala/durak/engine/GameEngine.scala`
- `backend/src/main/scala/durak/engine/PlayerGameView.scala`
- `backend/src/main/scala/durak/engine/GameReplay.scala`
- `backend/src/main/scala/durak/engine/JsonCodecs.scala`
- `backend/src/test/scala/durak/server/GameActorSuite.scala`
- `backend/src/test/scala/durak/server/GameRoutesSuite.scala`
- `backend/src/test/scala/durak/engine/PlayerViewSuite.scala`
- `backend/src/test/scala/durak/engine/GameReplaySuite.scala`

**IMPORTANT:** Do NOT touch any files in `frontend/`, `README.md`, `ARCHITECTURE.md`, or `play-local.sh` in this ticket.

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-NEW-2 (Verbatim):** "2. Set RandomBot to play its moves instantly. BasicBot should keep its random delay between moves it has now."
  - In `backend/src/main/scala/durak/server/GameActor.scala`:
    - When scheduling/running a bot move for a prompted bot seat `seatIdx`, check `state.config.seatType(seatIdx)`:
      - For `GameConfig.RandomBotSeat`: play the move **instantly** (`0.millis` sleep; use `IO.cede` so fiber scheduling remains fair and HTTP/WebSocket handlers are never starved during all-`RandomBot` games).
      - For `GameConfig.BasicBotSeat`: keep the existing random delay between `minBotDelay` and `maxBotDelay` (`500.millis` to `2000.millis` by default, while still honoring constructor overrides in tests if provided for `BasicBot`).
    - Ensure that if a test in `GameActorSuite.scala` explicitly passes custom delays or tests bot timing, `RandomBot` executes with zero delay and `BasicBot` uses the configured random delay range.

- [ ] **ITEM-3b (Backend Projection Verification — Verbatim):** "3. The glowing box still doesn't hug the cards correctly. Additionally, it does not display after a first card has been played. The correct spec should be that it displays for all players that are able to throw in after the initial attack has been played."
  - In `backend/src/main/scala/durak/engine/GameEngine.scala` and `backend/src/main/scala/durak/engine/PlayerGameView.scala`:
    - Verify that after the initial attack has been played (`BoutPhase.Defense` and `BoutPhase.SurrenderThrowIn`), `GameEngine.legalActions(state, playerId)` returns `GameAction.ThrowInCards` for every active non-defender player who has not passed and holds at least one card matching a rank currently on the table (while the bout card cap `Math.min(6, state.defenderInitialHandSize)` has not been reached and the defender still holds cards to cover or has surrendered).
    - Verify `PlayerGameView.forViewer(state, viewerId)` includes those `ThrowInCards` actions in `legalActions` and includes every player who can currently act (including players with legal `ThrowInCards`) in `promptedPlayerIds` when appropriate, without breaking turn-clock ownership for the defender when uncovered cards are on the table.

- [ ] **ITEM-9 & ITEM-12 (Backend GameOver & Replay Reliability — Verbatim):**
  - "9. The game-over banner does not pop up when a game is finished. Fix this."
  - "12. The interactive game review mode is not accessible - when the game finishes, visiting its URL displays Loading game [game ID] forever."
  - Inspect and verify the entire backend `BoutPhase.GameOver` path across `GameEngine.scala`, `PlayerGameView.scala`, `GameReplay.scala`, `GameActor.scala`, and `GameRoutes.scala`:
    1. **Safe `PlayerGameView.forViewer` at `BoutPhase.GameOver`:**
       - Ensure `PlayerGameView.forViewer(state, viewerId)` never throws an `IndexOutOfBoundsException` or `NoSuchElementException` when `state.boutPhase == BoutPhase.GameOver` (including in a draw where all players have 0 cards, or when `viewerId` is any valid seat `p0..pN`, or if `viewerId` is unknown/missing — fallback safely to `p0` in `GameRoutes` if a viewer query parameter is omitted or blank).
       - Ensure `turnDeadlineMs` is `None` when `state.boutPhase == BoutPhase.GameOver`, `gameEndedAtMs` is `Some(endedAtMs)`, `winners` and `durak` are populated, and `legalActions` and `promptedPlayerIds` are empty.
    2. **Complete Broadcast & Replay Recording in `GameActor.scala`:**
       - When any move (by a human, by an instant `RandomBot`, by a `BasicBot`, or by a turn-clock auto-action) transitions `state.boutPhase` to `BoutPhase.GameOver`:
         - Set `gameEndedAtMs` on the room state if not already set.
         - Append the final `GameOver` frame to the room's `GameReplay` history with frozen `PlayerGameView` snapshots for every seat (`p0`, `p1`, ...).
         - Broadcast the updated `GameOver` state to the WebSocket `Topic` so all connected clients immediately receive the `BoutPhase.GameOver` `PlayerGameView` frame.
         - Keep the finished room stored in `GameManager` so subsequent calls to `GET /api/games/:gameId/view?player=p0`, `GET /api/game/:gameId/view/p0`, `GET /api/games/:gameId/replay`, `GET /api/game/:gameId/replay`, and `/ws/game/:gameId/:playerId` always succeed immediately and never hang or 404/500.
    3. **Instant All-Bot / Human+Bot Game Completion (15-Second QA Testability):**
       - Because `RandomBot` now plays with `0.millis` delay, creating a game with `RandomBot` seats allows a human reviewer at `http://localhost:5173` to reach `BoutPhase.GameOver` in under 2 seconds and immediately test both the Game-Over banner (`ITEM-9`) and Interactive Game Review Mode (`ITEM-12`). Verify with an automated test in `GameActorSuite` / `GameRoutesSuite` that a 2-player `RandomBot` vs `RandomBot` game created via `POST /api/games` finishes rapidly, transitions to `BoutPhase.GameOver`, and returns valid `200 OK` JSON from both `GET /api/games/:gameId/view?player=p0` (with `boutPhase == "GameOver"`) and `GET /api/games/:gameId/replay` (with `frames.nonEmpty` and the final frame in `BoutPhase.GameOver`).

## Testing & Verification Commands
Run from `backend/`:
```bash
cd backend && sbt -batch test
```
All existing and new MUnit suites must pass with zero errors.
