<!-- WAVE:3 -->
# T-06: Backend Lobby/Quick-Pairing Service, Authenticated REST/WS Routes, QA Presets & `Main.scala` Wiring

## Goal
Implement the Quick Pairing matchmaking service, all M2 multiplayer REST & WebSocket routes (`/api/games`, `/api/lobby`, `/api/quick-pair`, `/ws/lobby`, `/ws/games/:gameId`), and the authoritative QA Scenario Preset endpoints (`/api/qa/presets/*`), then wire `SessionStore`, `RoomManager`, `QuickPairingService`, and all routes into `Main.scala`.

## Scope & Owned Files
Create/update files strictly under:
- `backend/src/main/scala/durak/lobby/QuickPairingService.scala` (NEW)
- `backend/src/main/scala/durak/http/MultiplayerRoutes.scala` (NEW)
- `backend/src/main/scala/durak/http/QaPresetRoutes.scala` (NEW)
- `backend/src/main/scala/durak/Main.scala` (UPDATE — wire M2 services & routes while preserving existing M1 local/inspector routes if present)
- `backend/src/test/scala/durak/http/MultiplayerRoutesSpec.scala` (NEW)

> **Do NOT edit** `README.md` or `ARCHITECTURE.md`. Only touch `./play-local.sh` if server startup commands or environment variables change (they should remain `0.0.0.0:8080`).

## Design Details
1. **Quick Pairing Service (`QuickPairingService.scala`):**
   - `QuickPairRequest(playerCount: Int, turnTimeoutSeconds: Int = 15, allowRedirect: Boolean = true)`.
   - `pair(session: GuestSession, req: QuickPairRequest): F[Either[String, (String, Int)]]`:
     - Atomically checks if an open public Quick Pairing room already exists with matching `(playerCount, turnTimeoutSeconds, allowRedirect)` and open seats (where the player is not already in another waiting quick-pair room or returns their existing one).
     - If found, calls `roomManager.joinSeat(existingGameId, session)` and returns `(existingGameId, seatIndex)`.
     - Otherwise, calls `roomManager.createRoom(session, CreateRoomConfig(..., isPublic = true, isQuickPair = true))` and returns `(newGameId, 0)`.
   - `cancel(session: GuestSession): F[Unit]`: removes the player from any waiting Quick Pairing room they currently occupy.
2. **Multiplayer REST & WebSocket Routes (`MultiplayerRoutes.scala`):**
   - Every state-mutating or session-scoped endpoint resolves or auto-mints a `GuestSession` via `SessionCookie.resolveOrCreate` and attaches the `HttpOnly; SameSite=Strict` cookie whenever a new guest session is created.
   - REST Endpoints:
     - `GET /api/lobby`: returns `200 OK` JSON array of open public `LobbyRoomSummary`.
     - `POST /api/games`: creates room via `RoomManager.createRoom`, returns `201 Created` `{ gameId, seatIndex, inviteUrl: "/g/" + gameId }`.
     - `GET /api/games/:gameId`: returns `200 OK` strictly filtered `PlayerGameView` via `RoomManager.getRoomView(gameId, session.playerId)` (or `404 Not Found`). NEVER returns raw `GameState`.
     - `POST /api/games/:gameId/join`: seats requester via `RoomManager.joinSeat`, returns `200 OK` `{ gameId, seatIndex, view }` (or `409 Conflict` if full/started, `404` if missing).
     - `POST /api/games/:gameId/leave`: leaves seat while waiting, returns `204 No Content` or `409 Conflict`.
     - `POST /api/quick-pair`: calls `QuickPairingService.pair`, returns `200 OK` `{ gameId, seatIndex }`.
     - `DELETE /api/quick-pair`: calls `QuickPairingService.cancel`, returns `204 No Content`.
   - WebSocket Endpoints (using `WebSocketBuilder2[F]`):
     - `GET /ws/lobby`: immediately emits `LobbySnapshot(currentOpenRooms)` followed by live `LobbyUpdated(rooms)` frames from `roomManager.lobbyUpdates`.
     - `GET /ws/games/:gameId`:
       - Extracts session token via `SessionCookie.extractToken` (or optional `?token=` query param fallback for WS clients if needed); resolves `GuestSession` (or assigns ephemeral spectator ID if anonymous viewer has no cookie yet).
       - Subscribes to `roomManager.subscribe(gameId, viewerId)` inside a `Resource` scope so connect/disconnect presence (`isConnected`) is guaranteed even on abrupt disconnects!
       - Incoming text frames are decoded as `WsClientMessage`:
         - `Ping` -> replies `Pong`.
         - Game action messages -> routed to `roomManager.handleAction(gameId, viewerId, msg)`; if `Left(rejected)`, sends `ActionRejected` only to that client.
         - Malformed JSON -> sends `ActionRejected("INVALID_PAYLOAD", ...)` without crashing the WebSocket stream.
3. **QA Scenario Preset Routes (`QaPresetRoutes.scala`):**
   - All presets create real rooms inside `RoomManager` so anti-cheat projection and WebSocket broadcasts work identically to real games:
     - `POST /api/qa/presets/seed-lobby`: creates 3 open public rooms (`2P • 15s Redirect ON`, `3P • 30s Redirect OFF`, `4P • 15s Redirect ON`) hosted by synthetic guest IDs (`qa-host-1..3`) so `/ws/lobby` immediately broadcasts live joinable rooms.
     - `POST /api/qa/presets/active-match`: seats the caller as Seat 0 and fills remaining seats (`playerCount`, default 2) with synthetic opponents (`qa-opp-1..`), auto-starting the game so the caller immediately enters an active projected `/g/:gameId` match; returns `{ gameId, seatIndex: 0 }`.
     - `POST /api/qa/presets/spectator-match`: creates a full active 2P match with all seats occupied by synthetic players (`qa-spec-p1`, `qa-spec-p2`) NOT matching the caller's `playerId`, returning `{ gameId }` so opening `/g/:gameId` immediately demonstrates read-only Spectator mode (`viewerSeat: None`, `hand: []`).
4. **`Main.scala` Wiring:**
   - Instantiate `InMemorySessionStore`, `RoomManager`, and `QuickPairingService`.
   - Mount `SessionRoutes`, `MultiplayerRoutes`, and `QaPresetRoutes` alongside any existing M1 routes on `0.0.0.0:8080` with `EmberServerBuilder`.

## Mandatory Acceptance Criteria Checklist
- [ ] **REQ-11:** `GET /api/lobby`, `POST /api/games`, `GET /api/games/:gameId`, `POST /api/games/:gameId/join`, `POST /api/games/:gameId/leave`, `POST /api/quick-pair`, and `DELETE /api/quick-pair` are implemented, handle guest cookies automatically, and never expose raw `GameState`.
- [ ] **REQ-11:** `QuickPairingService` atomically matches players requesting identical `(playerCount, turnTimeoutSeconds, allowRedirect)` presets into the same room and creates a new public quick-pair room when none is waiting.
- [ ] **REQ-11:** `GET /ws/lobby` streams an immediate `LobbySnapshot` and live `LobbyUpdated` events whenever public rooms are created, joined, left, or started.
- [ ] **REQ-11:** `GET /ws/games/:gameId` authenticates the viewer via session cookie/header, streams per-viewer `PlayerGameView` updates, enforces seat ownership on all incoming actions, and cleanly updates `isConnected` on connect and disconnect.
- [ ] **REQ
