<!-- WAVE:2 -->
# T-04: Authoritative `RoomManager` — Shareable Rooms, Seat Auth & Per-Viewer Broadcast

## Goal
Implement the concurrent, authoritative `RoomManager` in Cats Effect 3 that manages shareable `/g/:gameId` game rooms, seat join/leave & auto-start, strict seat ownership authorization on every incoming WebSocket action, live presence tracking (`isConnected`), reconnection persistence, turn-timeout enforcement, and strictly filtered per-viewer `PlayerGameView` broadcasting.

## Scope & Owned Files
Create new files strictly under:
- `backend/src/main/scala/durak/rooms/RoomModels.scala`
- `backend/src/main/scala/durak/rooms/RoomManager.scala`
- `backend/src/test/scala/durak/rooms/RoomManagerSpec.scala`

> **Do NOT edit** `Main.scala`, `README.md`, or `ARCHITECTURE.md` in this ticket (HTTP/WS wiring happens in `T-06`).

## Design Details
1. **Room State & Configuration (`RoomModels.scala`):**
   - `CreateRoomConfig(playerCount: Int, allowRedirect: Boolean = true, turnTimeoutSeconds: Int = 15, isPublic: Boolean = true, isQuickPair: Boolean = false)` (validates `playerCount` in `{2, 3, 4}` and `turnTimeoutSeconds` in `5..300`).
   - `SeatSlot(seatIndex: Int, playerId: Option[String], displayName: Option[String])`.
   - `GameRoom`:
     - `gameId: String` (URL-safe short ID, e.g., 8-char alphanumeric generated via `SecureRandom`).
     - `config: CreateRoomConfig`
     - `status: RoomStatus` (`WaitingForPlayers | InProgress | Finished`)
     - `seats: Vector[SeatSlot]` (length `config.playerCount`)
     - `gameState: Option[GameState]` (initialized via `durak.engine` with seeded RNG as soon as all seats are filled)
     - `turnDeadlineEpochMs: Option[Long]`
     - `createdAtEpochMs: Long`
     - `hostName: String`
   - `ConnectedClient(clientId: String, playerId: String, queue: Queue[F, WsServerMessage])`.
2. **Authoritative `RoomManager[F[_]]` (`RoomManager.scala`):**
   - Backed by `Ref[F, Map[String, ManagedRoom[F]]]` (with per-room `Semaphore` or serialized state updates to prevent race conditions) and a `Topic[F, List[LobbyRoomSummary]]` publishing open public room snapshots whenever public rooms change.
   - Operations:
     - `createRoom(host: GuestSession, config: CreateRoomConfig): F[Either[String, (GameRoom, Int)]]` — creates room, seats host in seat `0`, publishes lobby update if `config.isPublic`.
     - `createPresetRoom(config: CreateRoomConfig, prefilledSeats: Vector[(String, String)], autoStartIfFull: Boolean, seed: Option[Long] = None): F[GameRoom]` — clean internal method used by `QaPresetRoutes` in `T-06` so QA presets run through the EXACT same authoritative `RoomManager` and `PlayerGameView` pipeline.
     - `getRoomView(gameId: String, viewerId: String): F[Option[PlayerGameView]]` — returns strictly filtered `PlayerGameView.forViewer`.
     - `joinSeat(gameId: String, session: GuestSession): F[Either[String, (PlayerGameView, Int)]]` —
       - If `session.playerId` is already seated in `gameId`, returns their existing seat idempotently (reconnection support).
       - If `status == WaitingForPlayers` and an open seat exists, assigns the lowest open seat to `session.playerId`.
       - If assigning this seat fills all `config.playerCount` seats, transitions `status` to `InProgress`, deals initial `GameState` using `durak.engine` (`36` cards for 2–3P, `52` cards for 4P, respecting `allowRedirect`), sets initial `turnDeadlineEpochMs`, starts turn-timeout monitoring if applicable, and removes the room from the open Lobby Pool!
       - Broadcasts per-viewer `PlayerGameView` to all connected clients in the room and publishes lobby update.
     - `leaveSeat(gameId: String, playerId: String): F[Either[String, Unit]]` — allowed only while `status == WaitingForPlayers`; vacates seat (removes room if 0 seated players remain), broadcasts views & lobby update.
     - `subscribe(gameId: String, viewerId: String): Resource[F, (Stream[F, WsServerMessage], PlayerGameView)]` —
       - Registers `ConnectedClient` for `viewerId`, updates `connectedPlayerIds` (`isConnected = true` for that player), sends initial `PlayerGameView.forViewer` to the connecting client, and broadcasts updated presence (`isConnected = true`) to other connected clients in the room.
       - On `Resource` release (disconnect): removes client, computes remaining `connectedPlayerIds` (supporting multiple tabs per user gracefully), and broadcasts updated `PlayerGameView` with `isConnected = false` if no sockets remain for that player.
     - `handleAction(gameId: String, senderPlayerId: String, action: WsClientMessage): F[Either[ActionRejected, Unit]]` —
       - **Strict Seat Authorization:** Looks up `seatIdx` where `seats(seatIdx).playerId == Some(senderPlayerId)`.
       - If `senderPlayerId` is NOT seated (spectator) or room is not `InProgress`, returns `Left(ActionRejected("UNAUTHORIZED", ...))` without touching `gameState`.
       - Maps `WsClientMessage` to the corresponding `durak.engine` action bound strictly to the authenticated `seatIdx` (ignoring/preventing any spoofing of another seat index).
       - Validates and applies the move via the pure `durak.engine` state machine. On illegal move, returns `Left(ActionRejected("ILLEGAL_MOVE", reason))` strictly to the sender.
       - On legal move: updates `gameState` (and `status = Finished` if game over), updates `turnDeadlineEpochMs`, and broadcasts fresh `PlayerGameView.forViewer(room, client.playerId, connectedIds)` to EVERY connected client individually!
     - `listOpenPublicRooms: F[List[LobbyRoomSummary]]` and `lobbyUpdates: Stream[F, List[LobbyRoomSummary]]`.

## Mandatory Acceptance Criteria Checklist
- [ ] **REQ-06:** `RoomManager.createRoom` validates `playerCount` (`2`, `3`, `4`) and `turnTimeoutSeconds`, generates a shareable URL-safe `gameId`, seats the creator in seat 0, and sets `status = WaitingForPlayers`.
- [ ] **REQ-06:** `RoomManager.joinSeat` assigns the next open seat, auto-starts the match (`status = InProgress` with valid initial deal via `durak.engine`) as soon as all seats are filled, and removes started rooms from `listOpenPublicRooms`.
- [ ] **REQ-06:** `RoomManager.leaveSeat` vacates a player's seat during `WaitingForPlayers` (cleaning up empty waiting rooms) and rejects leaving an already-started match.
- [ ] **REQ-07:** `RoomManager.handleAction` strictly derives the acting seat from the authenticated `senderPlayerId`; commands from spectators or players attempting to act out of turn / for another seat are rejected with `ActionRejected` and never mutate `gameState`.
- [ ] **REQ-07:** Every state change broadcasts an individually projected `PlayerGameView.forViewer` to each connected client so Player A never receives Player B's cards and Spectators always receive `hand = Nil`.
- [ ] **REQ-08:** `RoomManager.subscribe` marks seated players `isConnected = true` on connect and `isConnected = false` on disconnect (broadcasting presence updates to peers), and reconnecting with the same `playerId` re-attaches seamlessly to the existing seat and restores their hand.
- [ ] Unit & concurrency tests in `RoomManagerSpec.scala` verify room creation, multi-player join & auto-start, seat spoofing rejection, spectator read-only isolation, per-viewer anti-cheat broadcast, and disconnect/reconnect presence transitions.
- [ ] All backend tests pass cleanly via `cd backend && sbt -batch test`.

## Verification Commands
```bash
cd backend && sbt -batch test
```

