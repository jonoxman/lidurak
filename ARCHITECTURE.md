# Lidurak Architecture

Lidurak is a full-stack web implementation of the card game Durak, pairing an authoritative **Scala 3** backend (`backend/`, packages `durak.engine` and `durak.server`) with a **Preact + TypeScript + Vite** frontend (`frontend/`).

---

## 1. Repository Directory Tree

```text
.
├── play-local.sh                       # Unified local launcher for backend and frontend
├── backend/                            # Scala 3 / sbt backend service
│   └── src/
│       ├── main/scala/durak/
│       │   ├── engine/                 # Pure Durak rules & bout state machine
│       │   └── server/                 # Actors, HTTP/WebSocket routes, session & lobby state
│       └── test/scala/durak/           # sbt test suite
└── frontend/                           # Preact + Vite SPA
    └── src/
        ├── app.tsx                     # Root shell, theme init, dual router dispatch
        ├── api/
        │   ├── client.ts               # Local/hotseat game & health REST client
        │   ├── sessionClient.ts        # Cookie-backed guest session REST client
        │   ├── lobbyClient.ts          # Lobby, quick-pair, QA presets & /ws/lobby client
        │   └── gameSocket.ts           # Reconnecting /ws/games/:gameId client
        ├── components/
        │   ├── HeaderBar.tsx           # Global navigation bar & settings access
        │   └── lobby/
        │       ├── QuickPairingTab.tsx # 2P/3P/4P quick-match preset grid & cancel flow
        │       ├── LobbyPoolTab.tsx    # Live public room list hydrated via REST + WS
        │       ├── CreateInviteTab.tsx # Custom room configurator (seats, clock, visibility)
        │       └── QaLobbyPresets.tsx  # One-click lobby/match/spectator state launchers
        ├── pages/
        │   ├── LobbyPage.tsx           # Server readiness gate, guest badge, lobby tabs & local editor
        │   ├── GamePage.tsx            # Local hotseat / bot 3-column table view
        │   └── MultiplayerGamePage.tsx # Live WebSocket-driven 3-column table & spectator view
        ├── router/
        │   └── useRoute.ts             # History-API router for / and /g/:gameId
        ├── state/
        │   └── settings.ts             # Persisted theme, roundness, and surface preferences
        ├── styles/
        │   ├── table.css               # 3-column desktop shell & 3x3 CSS Grid felt table
        │   └── lobby.css               # Lobby panels, tabs, and pool styling
        └── types/
            └── multiplayer.ts          # Runtime parsers & TypeScript contracts for REST/WS
```

---

## 2. Scala 3 Engine State Machine (`durak.engine`)

The `durak.engine` package encapsulates pure, deterministic Durak game logic independent of transport or concurrency concerns:

- **Deck & Configuration:** Supports 2–4 players, selecting a 36-card deck for 2–3 players and a 52-card deck for 4 players, with configurable redirect/reflection (`allowRedirect`) and per-turn clock limits (`turnTimeoutSeconds`).
- **Bout Lifecycle & Turn Transitions:**
  - Enforces legal attack initiation, follow-up throw-ins matching ranks currently on the table, single-card defense beats (higher rank of the same suit or trump suit), and optional card redirection/reflection to the next active player when all table attacks are undefended and matching-rank rules hold.
  - Processes **Pass** (ending the attack phase when all attacks are covered and replenishing hands up to 6 cards from the talon) and **Surrender** (defender picks up all cards in the active bout after attackers finish throwing in).
  - Evaluates player elimination as the talon empties and hands reach zero, culminating in winner/Durak resolution.
- **Bot Players:** Provides stateless decision strategies (`RandomBot` and `BasicBot`) integrated cleanly with the same move-validation rules as human players.

---

## 3. Server Actors & Protocol (`durak.server`)

The `durak.server` package hosts the stateful runtime, authentication, matchmaking, and real-time room supervision:

### Session & Projection Security
- **Guest Sessions:** `GET /api/session` mints an `HttpOnly; SameSite=Strict` cookie (`lidurak_session`) representing a `playerId` and `displayName`. `POST /api/session/name` validates display name updates (2–20 printable characters).
- **Zero-Leak View Projection:** Every room projects state strictly per viewer (`PlayerGameView`). A seated player receives only their own hand and public opponent card counts; an unseated spectator receives `viewerSeat: null` and `hand: []`, preventing hidden-card leakage over either REST or WebSocket.

### REST API
| Endpoint | Purpose |
| :--- | :--- |
| `GET /api/health` | Backend readiness check polled by the frontend on startup |
| `GET /api/session` | Fetch or mint the `lidurak_session` guest cookie |
| `POST /api/session/name` | Update the current guest's display name |
| `GET /api/lobby` | Snapshot of open public rooms in the Lobby Pool |
| `POST /api/games` | Create a public or private room (`{ gameId, seatIndex, inviteUrl }`) |
| `GET /api/games/:gameId` | Fetch the caller's strictly projected `PlayerGameView` |
| `POST /api/games/:gameId/join` | Claim an open seat in a waiting room |
| `POST /api/games/:gameId/leave` | Leave a waiting room before match start |
| `POST /api/quick-pair` | Join or match an open Quick Pairing table by preset |
| `DELETE /api/quick-pair` | Cancel an active Quick Pairing request |
| `POST /api/qa/presets/seed-lobby` | Seed open public rooms into the Lobby Pool |
| `POST /api/qa/presets/active-match` | Create an active human-vs-bot projected match |
| `POST /api/qa/presets/spectator-match` | Create an active full match for spectator verification |

### WebSocket Protocol
- **`/ws/lobby`:** Pushes an initial `lobbySnapshot` of open public rooms followed by incremental `lobbyUpdated` broadcasts, `matchFound` notifications when Quick Pairing seats a player, and `actionRejected` errors.
- **`/ws/games/:gameId`:** Bidirectional room stream. Clients send typed `WsClientMessage` actions and periodic `ping` keepalive frames; the server pushes per-connection `gameViewUpdate` (`PlayerGameView`) frames on every state transition (including turn-clock timeouts) and `actionRejected` (`code`, `message`) frames when an action is invalid.

---

## 4. Frontend Architecture (`frontend/src`)

### Dual Routing (`app.tsx` & `router/useRoute.ts`)
- **History API (`/`, `/g/:gameId`):** Drives the online multiplayer `LobbyPage` and `MultiplayerGamePage`, supporting direct link sharing and browser reloads.
- **Hash Routes (`#/g/:gameId?player=:seat`, `#/g/:gameId/replay`, `#/`):** Drives local/bot hotseat tables and replays in `GamePage`, allowing instant seat switching without network sessions.

### Resiliency & Transport Clients
- **`sessionClient.ts`:** Wraps `fetch` with `credentials: 'include'` so the `HttpOnly` cookie is sent on every API call and maps non-2xx responses to typed `MultiplayerApiError` instances.
- **`lobbyClient.ts` & `gameSocket.ts`:** Build relative `ws:`/`wss:` URLs against `location.host` (compatible with the Vite proxy), parse server frames through runtime validators in `types/multiplayer.ts`, send `20_000ms` keepalive pings on game sockets, and reconnect on unexpected drops using capped exponential backoff (`500ms` base up to `5000ms` ceiling).

### CSS Grid Table Layout (`styles/table.css`)
The game view enforces a zero-overlap Lichess-style three-column shell without absolute/fixed positioning for game regions:
- **Left Sidebar (`[data-zone="sidebar-left"]`):** Rules reference, preset triggers, and local hotseat player switcher.
- **Center Arena (`[data-zone="table-arena"]`):** A 3×3 CSS Grid felt surface (`#1e2923`):
  1. **Row 1:** Opponent seats (`top-left`, `top-center`, `top-right`).
  2. **Row 2:** Active bout pairs, defender-anchored target outlines (`target-outline-<id>`), and the redirect outline (`redirect-outline`).
  3. **Row 3:** Talon deck and trump card (`table-deck`), active player's hand (`player-hand`), and `SortBar` with contextual `Surrender` / `Pass` actions.
- **Right Sidebar (`[data-zone="sidebar-right"]`):** Digital `00:XX` turn clock (`00:15` default) and end-of-game winner/Durak summary.
