<!-- WAVE:2 -->
# Ticket T-90-feedback-20261031_010137-4: Backend Turn Clock Engine, 3s Auto-Action Delay & Timeout Defaults

## Subsystem
Backend Game Actor, Timers & Auto-Actions (`durak.server.GameActor`, `durak.engine.*`)

## Description & Scope
Implement the backend 15-second turn deadline clock, 3-second delay on automatic engine actions, default timeout move executions, and turn clock state synchronization via WebSocket and REST.

### Requirements Covered
- **Item 18: 3-Second Delay Before Automatic Actions**
  - Whenever a game state triggers an automatic action (such as auto-surrendering when a defender has no legal move or auto-advancing bouts), wait **3 seconds** (`3000ms`) before executing so the transition never feels jarring.
- **Item 19: 15-Second Turn Clock & Timeout Defaults**
  - Track a 15-second turn deadline (`turnDeadlineMs` / remaining seconds `00:15` down to `00:00`) in `GameState` / `PlayerGameView`.
  - Reset deadline to `15` seconds whenever any valid move is made.
  - When a player is actively waited on and 15 seconds elapse without an action:
    - **Waiting on initial attack:** Automatically play a random legal attack card from attacker's hand (against a random legal target if `chaosMode == true`).
    - **Waiting on defender:** Automatically surrender (`takeCards`).
    - **Waiting on attacker/throw-in:** Automatically pass (`passTurn`).
  - When the game is idle or between states, remaining turn clock reports `15` seconds (`00:15`).
  - Broadcast clock updates and state changes to connected players via WebSocket.

## Target Files
- `backend/src/main/scala/durak/server/GameActor.scala`
- `backend/src/main/scala/durak/engine/GameState.scala`
- `backend/src/main/scala/durak/engine/GameEngine.scala`
- `backend/src/main/scala/durak/engine/PlayerGameView.scala`
- `backend/src/main/scala/durak/engine/JsonCodecs.scala`
- `backend/src/test/scala/durak/server/GameActorSuite.scala`
- `backend/src/test/scala/durak/engine/GameStateSuite.scala`

## Implementation Steps
1. Add `turnDeadlineEpochMs: Option[Long]` and `secondsRemaining: Int` to `GameState` and `PlayerGameView`.
2. In `GameActor.scala`:
   - Maintain a scheduled fiber or timer for turn deadline (15 seconds).
   - When a valid action arrives, cancel pending timeout and reset turn deadline to `System.currentTimeMillis() + 15000L`.
   - On timeout expiry:
     - Check current waiting state (waiting for attacker attack -> pick random attack; waiting for defender -> `takeCards`; waiting for throw-in -> `passTurn`).
     - Apply action through `GameEngine` and broadcast updated state.
3. In `GameEngine.scala` / `GameActor.scala`:
   - Implement the 3-second delay for automatic transitions (e.g., auto-surrender or auto-advance) before applying next bout state.
4. Update `JsonCodecs.scala` to serialize turn clock fields in `PlayerGameView`.
5. Add unit and actor tests in `GameActorSuite.scala` testing timeout auto-plays, timer resets, and 3-second delay pacing.

## Verification Commands
- `sbt -batch test`

## Completion Requirements
- All tests pass in `sbt -batch test`.
- Clock state is synchronized over WebSocket.
- Update `.reviews/agent_notes.md` with implementation summary.
- Run `echo "DONE" > .tickets/STATUS`.
