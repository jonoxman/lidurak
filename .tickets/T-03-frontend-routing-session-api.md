<!-- WAVE:1 -->
# T-03: Frontend SPA Router, Multiplayer Types & Session/Lobby/Game WS Clients

## Goal
Build the lightweight frontend routing layer (`/` and `/g/:gameId`), TypeScript contracts mirroring the backend `PlayerGameView` & WebSocket protocols, `credentials: 'include'` REST clients for guest sessions and rooms, and resilient auto-reconnecting WebSocket clients for `/ws/lobby` and `/ws/games/:gameId`.

## Scope & Owned Files
Create new files strictly under:
- `frontend/src/types/multiplayer.ts`
- `frontend/src/router/useRoute.ts`
- `frontend/src/router/useRoute.test.ts`
- `frontend/src/api/sessionClient.ts`
- `frontend/src/api/lobbyClient.ts`
- `frontend/src/api/gameSocket.ts`
- `frontend/src/api/multiplayerClients.test.ts`

> **Do NOT edit** `App.tsx`, `GamePage.tsx`, `vite.config.ts`, `README.md`, or `ARCHITECTURE.md` in this ticket (page integration happens in Waves 2–4).

## Design Details
1. **Types (`frontend/src/types/multiplayer.ts`):**
   - `GuestSession { playerId: string; displayName: string; isGuest: boolean }`
   - `RoomStatus = 'WaitingForPlayers' | 'InProgress' | 'Finished'`
   - `RoomConfigView { playerCount: 2 | 3 | 4; allowRedirect: boolean; turnTimeoutSeconds: number; isPublic: boolean }`
   - `PublicPlayerSummary { id: string; name: string; rating: number | null; cardCount: number; isConnected: boolean; hasPassed: boolean; finishRank: number | null; seatIndex: number }`
   - `RoomSeatView { seatIndex: number; playerId: string | null; displayName: string | null; isConnected: boolean }`
   - `PlayerGameView` matching `T-02` exactly (reusing existing `Card` / `Suit` / `TablePair` types from the frontend if present, or defining compatible interfaces).
   - `LobbyRoomSummary`, `CreateRoomRequest`, `CreateRoomResponse`, `JoinRoomResponse`, `QuickPairRequest`, `QuickPairResponse`.
   - `WsClientMessage` & `WsServerMessage` discriminated unions on `type`.
   - `SocketStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'`.
2. **SPA Router (`frontend/src/router/useRoute.ts`):**
   - Pure `parseRoute(pathname: string)` returning:
     - `{ kind: 'lobby' }` for `/` (or unknown fallback to lobby)
     - `{ kind: 'game', gameId: string }` for `/g/:gameId` (URL-decoded, trimmed)
   - `navigate(path: string)`: calls `window.history.pushState({}, '', path)` and dispatches a custom route-change event so all mounted hooks update synchronously.
   - Preact hook `useRoute()` listening to `popstate` and custom navigation events and returning `{ route, navigate }`.
3. **Session & Lobby REST Clients (`sessionClient.ts`, `lobbyClient.ts`):**
   - All `fetch` calls MUST pass `credentials: 'include'` so `HttpOnly; SameSite=Strict` cookies are sent and stored automatically.
   - `sessionClient.ts`: `getOrCreateSession()`, `updateGuestName(displayName: string)`.
   - `lobbyClient.ts`:
     - `fetchLobbyRooms(): Promise<LobbyRoomSummary[]>`
     - `createRoom(req: CreateRoomRequest): Promise<CreateRoomResponse>`
     - `fetchGameView(gameId: string): Promise<PlayerGameView>`
     - `joinRoom(gameId: string): Promise<JoinRoomResponse>`
     - `leaveRoom(gameId: string): Promise<void>`
     - `joinQuickPair(req: QuickPairRequest): Promise<QuickPairResponse>`
     - `cancelQuickPair(): Promise<void>`
     - QA preset helpers: `seedLobbyPreset()`, `createActiveMatchPreset(playerCount?: number)`, `createSpectatorMatchPreset()`.
     - `connectLobbySocket(handlers)` opening `ws(s)://<host>/ws/lobby` with exponential backoff reconnect (`500ms` -> `5000ms` cap) and clean `close()` teardown.
4. **Game WebSocket Client (`gameSocket.ts`):**
   - `createGameSocket(gameId, handlers)` connecting to `ws(s)://<host>/ws/games/${encodeURIComponent(gameId)}`.
   - Tracks `SocketStatus` (`connecting`, `connected`, `reconnecting`, `disconnected`), automatically reconnects on unexpected close with capped exponential backoff, parses `GameViewUpdate` and `ActionRejected`, provides typed `sendAction(msg: WsClientMessage)` method, and cleanly closes without reconnecting when `dispose()` is called.

## Mandatory Acceptance Criteria Checklist
- [ ] **REQ-05:** `parseRoute` accurately resolves `/` to `{ kind: 'lobby' }` and `/g/:gameId` to `{ kind: 'game', gameId }`; `navigate` updates `window.location.pathname` via History API and notifies `useRoute()` listeners without page reloads.
- [ ] **REQ-05:** `frontend/src/types/multiplayer.ts` accurately mirrors `PlayerGameView`, `PublicPlayerSummary`, `RoomSeatView`, `LobbyRoomSummary`, `GuestSession`, `WsClientMessage`, and `WsServerMessage`.
- [ ] **REQ-05:** All REST calls in `sessionClient.ts` and `lobbyClient.ts` include `credentials: 'include'` and surface structured errors cleanly.
- [ ] **REQ-05:** `connectLobbySocket` and `createGameSocket` build protocol-appropriate URLs (`ws:` / `wss:` relative to `window.location.host`), parse incoming JSON messages safely, automatically reconnect on unexpected disconnects, and cancel pending timers on `dispose()` / `close()`.
- [ ] Vitest tests in `useRoute.test.ts` and `multiplayerClients.test.ts` verify route parsing/navigation, `credentials: 'include'` on fetch calls, WebSocket message dispatch, and reconnect/cleanup behavior.
- [ ] All frontend tests pass cleanly via `cd frontend && npm test -- --run`.

## Verification Commands
```bash
cd frontend && npm test -- --run
```

