<!-- WAVE:2 -->
# T-90-feedback-20261124_002056-4: Backend Deferred-Room Quick Pairing Queue, Real-Time Match Notification & QA Presets

## Context & Objective
Currently, `QuickPairingService` immediately creates a `GameRoom` and returns `{ gameId, seatIndex: 0 }` when the first player clicks a quick-pairing tile (e.g., `2P • 15s`), which forces the user into an empty waiting room instead of keeping them in the lobby searching queue. This ticket redesigns `QuickPairingService`, `WsProtocol`, `MultiplayerRoutes`, and `QaPresetRoutes` so queued players remain outside any room until `playerCount` matching players have joined the bucket, at which point a room is atomically created, started, and pushed to all matched players in real time.

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-1a (Verbatim — QA Response #6 Backend):** "Clicking the quick pairing 2P 15s tile displays the searching status for a split second, but immediately places the user into the new room that was just created. The correct behavior would be that players in the quick pairing queue are not considered to be active players within a room until a match has been found, so they should stay on the lobby screen with the searching status until then."
- [ ] **Deferred Room Creation in `QuickPairingService` (`backend/src/main/scala/durak/lobby/QuickPairingService.scala`):**
  - Maintain an in-memory waiting queue keyed by `(playerCount, turnTimeoutSeconds, allowRedirect)` storing queued `GuestSession` identities (`playerId`, `displayName`) — do **NOT** create a `GameRoom` or seat players in `RoomManager` while the bucket has fewer than `playerCount` distinct queued players.
  - Ensure a player can only be in one quick-pair bucket at a time (re-enqueueing moves/deduplicates their entry cleanly).
  - When a player calls `enqueue` and the bucket still has `< playerCount` players: return a typed `Searching` result (e.g., `QuickPairResult.Searching(playerCount, turnTimeoutSeconds, allowRedirect, queuedCount, requiredCount)`) with **no `gameId`** and **no room created**.
  - When the `playerCount`-th distinct player joins the same bucket: atomically dequeue all `playerCount` players, create a private `GameRoom` via `RoomManager`, seat all `playerCount` players in order (seats `0 .. playerCount - 1`) so the room starts immediately in `RoomStatus.InProgress`, return `QuickPairResult.Matched(gameId, seatIndex)` to the completing caller, AND emit a per-player match notification (`(playerId, gameId, seatIndex)`) so every previously waiting player is notified immediately over `/ws/lobby`.
  - When a player cancels (`cancel(playerId)` via `DELETE /api/quick-pair`): remove them from any active queue bucket and return `204 No Content` without affecting any rooms.
  - Provide a status lookup method (e.g., `statusFor(playerId)` / `GET /api/quick-pair/status`) if helpful so reconnecting clients can observe whether they are still queued.
- [ ] **Real-Time Match Delivery over `/ws/lobby` (`backend/src/main/scala/durak/protocol/WsProtocol.scala`, `ProtocolCodecs.scala`, `MultiplayerRoutes.scala`):**
  - Add a server WebSocket message variant (e.g., `WsServerMessage.QuickPairMatched(gameId: String, seatIndex: Int)` serialized with `"type": "quickPairMatched"`).
  - Authenticate the `/ws/lobby` WebSocket connection via the existing `lidurak_session` cookie so `MultiplayerRoutes` delivers `QuickPairMatched` **only** to the matched player's own `/ws/lobby` socket(s) (never broadcasting another player's match event to unrelated lobby viewers).
  - Update `POST /api/quick-pair` response JSON to clearly distinguish searching vs matched:
    - Searching: `{ "status": "searching", "playerCount": ..., "turnTimeoutSeconds": ..., "allowRedirect": ..., "queuedCount": ..., "requiredCount": ... }` (HTTP `200` or `202` — keep `200` with explicit `status` field so clients parse uniformly without error handling ambiguity).
    - Matched: `{ "status": "matched", "gameId": "...", "seatIndex": ... }` (HTTP `200`).
- [ ] **1-Click QA Scenario Presets (`backend/src/main/scala/durak/http/QaPresetRoutes.scala`):**
  - Add `POST /api/qa/presets/quick-pair-opponent` so a human reviewer who clicked `2P • 15s` (or any quick-pair tile) and is observing the persistent searching state on the Lobby can trigger synthetic QA opponent(s) to join their exact active quick-pair bucket (defaulting to `2P • 15s • Redirect ON` if no active bucket is found) and immediately trigger the real-time `quickPairMatched` match-found transition in 1 click!
  - Also support an optional `handSize` integer parameter (e.g., `2..6`, default `6`) on `POST /api/qa/presets/active-match` (or add `POST /api/qa/presets/small-hand-match` dealing 4 cards) so a human reviewer can also jump directly into a small-hand active match in 1 click to inspect the constant-width hand hover animation (New #4) on any viewport size.
- [ ] **End-to-End Wiring Points:**
  - `backend/src/main/scala/durak/lobby/QuickPairingService.scala` (`enqueue`, `cancel`, match notification stream/topic)
  - `backend/src/main/scala/durak/protocol/WsProtocol.scala` & `ProtocolCodecs.scala` (`QuickPairMatched`, `QuickPairResponse` codecs)
  - `backend/src/main/scala/durak/http/MultiplayerRoutes.scala` (`POST /api/quick-pair`, `DELETE /api/quick-pair`, `/ws/lobby` session-scoped match push)
  - `backend/src/main/scala/durak/http/QaPresetRoutes.scala` (`POST /api/qa/presets/quick-pair-opponent`, optional small-hand support on `active-match`)
- [ ] **Do NOT modify** `README.md`, `ARCHITECTURE.md`, or any `frontend/` files in this ticket.

## Scope & Files
- `backend/src/main/scala/durak/lobby/QuickPairingService.scala`
- `backend/src/main/scala/durak/protocol/WsProtocol.scala`
- `backend/src/main/scala/durak/protocol/ProtocolCodecs.scala`
- `backend/src/main/scala/durak/http/MultiplayerRoutes.scala`
- `backend/src/main/scala/durak/http/QaPresetRoutes.scala`
- `backend/src/test/scala/durak/lobby/QuickPairingServiceSpec.scala`
- `backend/src/test/scala/durak/http/MultiplayerRoutesSpec.scala`

## Verification Plan
1. Add unit tests in `QuickPairingServiceSpec.scala` verifying:
   - First player in 2P/3P/4P bucket receives `Searching`, creates ZERO rooms in `RoomManager`, and is not seated in any room.
   - Cancelling removes the player cleanly and creates ZERO rooms.
   - When the final required player joins the same bucket, a single room is created in `InProgress` status with all queued players seated, returning `Matched` to the last caller and emitting match notifications for every previously waiting player.
   - Distinct buckets (different `playerCount`, `turnTimeoutSeconds`, or `allowRedirect`) never cross-match.
2. Update `MultiplayerRoutesSpec.scala` to test `POST /api/quick-pair` searching vs matched payloads, `DELETE /api/quick-pair`, `/ws/lobby` session-scoped `quickPairMatched` delivery, and `POST /api/qa/presets/quick-pair-opponent`.
3. Run `cd backend && sbt -batch test` and ensure all tests pass.
4. Write concise summary in `.reviews/agent_notes.md`, then run `echo "DONE" > .tickets/STATUS`.
