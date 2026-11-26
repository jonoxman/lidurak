# Lidurak Architecture

## 1. Repository Layout

The workspace is split into a Scala 3 backend (`backend/`), a Preact + TypeScript frontend (`frontend/`), and a root local launcher (`./play-local.sh`):

```text
.
├── play-local.sh
├── README.md
├── ARCHITECTURE.md
├── backend/                 # Scala 3 engine (durak.engine) & server (durak.server)
└── frontend/
    └── src/
        ├── main.tsx         # Bootstraps guest session before first render
        ├── app.tsx          # SPA shell, History-API router, settings init
        ├── api/
        │   ├── client.ts        # Game REST calls, health check, QA preset triggers
        │   ├── gameSocket.ts    # Live multiplayer game socket adapter
        │   ├── lobbyClient.ts   # Lobby REST & /ws/lobby WebSocket client
        │   ├── sessionClient.ts # Single-flight guest session & rename client
        │   └── websocket.ts     # GameWebSocket client
        ├── audio/
        │   └── SoundEngine.ts   # Web Audio sound effects (cardPlay, cardCover, redirect, etc.)
        ├── components/
        │   ├── ActionBar.tsx    # Contextual Pass / Surrender controls
        │   ├── BrandLogo.tsx    # Top-bar brand mark
        │   ├── CardBack.tsx     # Configurable card back SVG patterns
        │   ├── GameTable.tsx    # 3x3 CSS Grid felt table, seats, bout pairs, deck
        │   ├── HeaderBar.tsx    # Top navigation, connection tracker, preferences menu
        │   ├── SortBar.tsx      # Hand sorting controls
        │   └── lobby/
        │       ├── CreateInviteTab.tsx  # Room configurator (visibility, seats, deck, clock)
        │       ├── LobbyPoolTab.tsx     # Live public rooms list
        │       ├── QaLobbyPresets.tsx   # One-click state-dependent scenario presets
        │       └── QuickPairingTab.tsx  # Matchmaking queue UI
        ├── pages/
        │   ├── GamePage.tsx     # 3-column game view, action dispatch, replay stepper
        │   └── LobbyPage.tsx    # Readiness gate, lobby tabs, hotseat & preset launcher
        ├── router/
        │   └── useRoute.ts      # History-API router (/, /g/:gameId, /g/:gameId?player=:seat)
        ├── state/
        │   └── settings.ts      # Persisted theme, roundness, highlight, sort, and audio prefs
        ├── styles/
        │   ├── lobby.css        # Lobby layout and controls
        │   ├── table.css        # 3-column desktop shell & 3x3 felt table grid
        │   └── tableTextures.ts # Felt surface palettes and CSS filter helpers
        └── types/
            ├── index.ts         # Core game actions, PlayerGameView, GameReplay, ReplayFrame
            └── multiplayer.ts   # GuestSession, LobbyRoomSummary, QuickPair, SocketStatus
```

*(Note: The Scala source files inside `backend/` were not included in the supplied codebase snapshot, so `durak.engine` and `durak.server` are documented below strictly at the observed protocol and state-contract boundary.)*

## 2. Scala 3 Engine State Machine (`durak.engine`)

The backend game engine models Durak as a deterministic, action-driven state machine with per-seat hidden-information projections and replay capture:

- **Match Configuration**:
  - **Seats**: 2 to 4 seats, each assigned a `PlayerType` (`human`, `randomBot`, or `basicBot`).
  - **Deck Size**: 36 or 52 cards (4-player games enforce a 52-card deck).
  - **Rules & Clock**: Configurable `allowRedirect` flag and `turnTimeoutSeconds` (`15`, `30`, or `60`).
- **Action Space (`GameAction`)**:
  - `InitialAttack`: Opens a bout from the active attacker.
  - `CoverCard`: Covers an uncovered table attack with a higher rank of the same suit or any trump against a non-trump.
  - `ThrowInCards`: Adds attacking cards matching ranks already present on the table.
  - `RedirectAttack`: Reflects the bout to the next defender (when enabled and before any attack pair is covered), advancing `attackerIdx` / defender seats.
  - `PassTurn`: Resolves a fully covered bout (moving cards to discard and refilling hands from the talon) or passes throw-in priority.
  - `DeclareSurrender`: Defender picks up all table cards and skips their next attack turn.
- **State Projections & Replays**:
  - Every state transition produces per-seat `PlayerGameView` snapshots containing public fields (`tablePairs`, `talonCount`, `discardCount`, `boutPhase`, `attackerIdx`, `opponents`) alongside only the receiving seat's private hand (`myId`).
  - Completed and ongoing matches expose a `GameReplay` sequence of `ReplayFrame` entries—each holding the triggering `action` and seat-indexed `views`—plus `startedAtMs` and `endedAtMs` timestamps.

## 3. Server Actors & WebSocket / REST Protocol (`durak.server`)

The `durak.server` layer coordinates guest sessions, lobby matchmaking, room lifecycle, bot turns, and real-time table synchronization.

### REST Endpoints

- **Health**:
  - `GET /api/health` — Readiness probe polled every `1000ms` by `LobbyPage` on cold boot until the backend is ready.
- **Guest Sessions** (`frontend/src/api/sessionClient.ts`):
  - `GET /api/session` — Returns `{ playerId, displayName, isGuest }` (`guest-xxxxxxxx` / `Guest-XXXX`) and issues an `HttpOnly; SameSite=Strict` `lidurak_session` cookie. Clients send `credentials: 'include'` on all requests.
  - `POST /api/session/name` — Updates `displayName` (validated server-side to 2–20 printable characters) and returns the updated `GuestSession`.
- **Lobby, Rooms & Game Actions** (`frontend/src/api/lobbyClient.ts`, `frontend/src/api/client.ts`):
  - Room discovery and lifecycle under `/api/lobby` (listing public `LobbyRoomSummary` entries, creating private or public rooms with `createRoom`, joining via `joinRoom`, leaving via `leaveRoom`, and managing quick-pair tickets via `joinQuickPair` / `cancelQuickPair`).
  - Game endpoints for fetching seat projections (`fetchGameView` / `getGameView`), creating local or preset tables (`createGame` / `createPresetGame`), dispatching moves (`sendAction`), and retrieving `GameReplay` history (`getGameReplay`).

### WebSocket Channels

- **Lobby Socket (`/ws/lobby`)**:
  - Streams initial room snapshots (`onSnapshot`), incremental room list updates (`onUpdated`), and `quickPairMatched` notifications that transition queued players into `/g/:gameId`.
- **Game Socket (`GameWebSocket` / `createGameSocket`)**:
  - Maintains per-table real-time connections for live multiplayer rooms and local/bot tables, streaming updated `PlayerGameView` states and turn clock updates to connected clients.

## 4. Preact & CSS Grid Frontend (`frontend/src`)

### Bootstrapping & Shared Guest Identity

`frontend/src/main.tsx` awaits `ensureGuestSession()` before mounting `<App />`. `sessionClient.ts` deduplicates concurrent `GET /api/session` calls through a single-flight promise (`inFlightGuestSession`), caches the authoritative `GuestSession`, and notifies subscribers (`HeaderBar`, `LobbyPage`) via `subscribeGuestSession`. If `/api/session` is unreachable, `localFallbackGuestSession()` supplies a stable transient `Guest-XXXX` identity without poisoning the authoritative cache.

### Routing & Global Header

`frontend/src/app.tsx` pairs `useRoute` (History-API navigation) with a persistent `HeaderBar`:

- `/` renders `LobbyPage`.
- `/g/:gameId` renders `GamePage` in `multiplayer` mode.
- `/g/:gameId?player=:seat` renders `GamePage` in local hotseat/bot mode anchored to that seat.

`HeaderBar.tsx` renders top-level navigation (`PLAY`, `PUZZLES`, `LEARN`, `WATCH`), a 4-bar latency meter (`connectionLevel`), and a profile dropdown with in-place submenus for `Sound`, `Theme`, `Table`, and `Card Back`, backed by `state/settings.ts`.

### Lobby Architecture

`LobbyPage.tsx` maintains a single `/ws/lobby` subscription across all tabs (`QuickPairingTab`, `LobbyPoolTab`, `CreateInviteTab`) so quick-pair searches persist across tab switches. `CreateInviteTab.tsx` handles visibility (`Private invite link` vs. `Public lobby pool`), player counts (`2`, `3`, `4`), deck sizes (`36` or `52`, forcing `52` at 4 players), redirect toggling, turn clocks (`15`, `30`, `60`), and per-seat `human` / `randomBot` / `basicBot` assignments. `QaLobbyPresets.tsx` provides one-click access to state-dependent game scenarios.

### Zero-Overlap 3-Column Game Table

`GamePage.tsx`, `GameTable.tsx`, and `styles/table.css` implement a three-column desktop shell without `position: absolute` or `position: fixed` placement for seats, hands, bouts, or sidebars:

- **`[data-zone="sidebar-left"]`**: *How to Play* rules list, QA scenario preset triggers, and hotseat seat-switcher tabs (highlighting the active viewer with ` (You)`).
- **`[data-zone="table-arena"]`**: 3×3 CSS Grid felt table (`#1e2923`):
  - **Row 1**: Opponent seats (`data-seat="top-left"`, `data-seat="top-center"`, `data-seat="top-right"`).
  - **Row 2**: Active bout attack/defense pairs, defender target outlines (`data-testid="target-outline-<id>"`), and the single-card reflection target (`data-testid="redirect-outline"`).
  - **Row 3**: Column 1 holds the talon deck and trump card (`data-zone="table-deck"`); Column 2 holds the active player's hand (`data-zone="player-hand"`); Column 3 holds `SortBar` and `ActionBar` (`Surrender` / `Pass`).
- **`[data-zone="sidebar-right"]`**: Digital turn countdown (`00:XX`, `00:15` default), overall match clock (`formatGameClock`), winner/Durak summary, and post-game replay navigation (`visibleReplayFrames` filters out non-move `PassTurn` frames while `playReplayFrameSound` triggers matching `SoundEngine` cues).
