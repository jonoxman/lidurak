# Lidurak Architecture

This document describes the technical structure of the Lidurak repository, covering the directory layout, the Scala 3 game engine, the server protocol, and the Preact frontend.

---

## 1. Repository Structure

```text
.
├── play-local.sh                  # Official local launcher for backend + frontend
├── backend/                       # Scala 3 backend (durak.engine, durak.server)
└── frontend/                      # Preact + Vite + TypeScript client
    └── src/
        ├── app.css                # Global theme variables, CSS tokens, and lobby/banner styles
        ├── api/
        │   ├── lobbyClient.ts     # REST room/matchmaking client & ReconnectingLobbySocket
        │   └── sessionClient.ts   # Cookie-backed guest session API & shared page cache
        ├── audio/                 # SoundEngine playback utilities
        ├── components/
        │   ├── BrandLogo.tsx      # Shared SVG brand lockup and lobby mosaic watermark
        │   ├── GameTable.tsx      # 3x3 CSS Grid table arena & memoized HandCardSlot
        │   ├── HeaderBar.tsx      # Top navigation, connection tracker & settings submenus
        │   ├── Card.tsx / CardBack.tsx / SortBar.tsx / TablePair.tsx
        │   └── lobby/             # Lobby room creation, invite, and matchmaking views
        ├── state/                 # Persistent user settings (theme, sound, table, highlights)
        ├── styles/                # Felt table CSS (table.css) and texture palettes
        ├── types/                 # Multiplayer DTO parsers and game action builders
        └── utils/                 # Pure hand layout (handLayout) and bout layout (tableLayout)
```

---

## 2. Scala 3 Engine State Machine (`durak.engine`)

The backend game engine models Durak matches as a deterministic state machine that validates moves and projects viewer-specific game state (`PlayerGameView`):

- **Deck & Configuration**: Supports standard deck sizes (36 or 52 cards), player counts, trump suit selection, and optional **Chaos Mode** (`chaosMode`) where attackers can target any active opponent.
- **Bout & Turn Lifecycle**: Tracks the current attacker (`attackerId`), defender (`defenderId`), active table pairs (`attack` card and optional `defense` card), bout phase (`boutPhase`, including `Defense` and surrender states), per-player `hasPassed` flags, and finish rankings (`finishRank`).
- **Move Legality & Projections**: Computes and projects viewer-scoped legality flags directly to the client rather than duplicating rule adjudication in the UI:
  - `playableKeys` / `awaitingAttack` / `defending`
  - `eligibleTargetIds` for valid attack targets
  - `canRedirect` and `redirectTargetId` for single-card rank reflections
  - `canThrowIn`, `throwInCards`, and `throwInCapacity` for bout throw-ins
  - `transparentMode` / review-mode hand reveals (`cards` on opponent summaries)
- **Turn Clock**: Tracks `turnPlayerId` and `turnSecondsRemaining` (`00:15` default).

---

## 3. Server Actors, REST API & WebSocket Protocol (`durak.server`)

The Scala 3 server manages guest sessions, room lifecycles, matchmaking queues, and live WebSocket broadcasts. In local development, Vite proxies API and WebSocket traffic to the backend (default host fallback `localhost:8080`).

### Authentication & Guest Sessions
- Cookie-based anonymous sessions using an `HttpOnly; SameSite=Strict` cookie (`lidurak_session`), sent via `credentials: 'include'`.
- `GET /api/session` — Returns the active `GuestSession` (`playerId`, `displayName`, `isGuest`) or mints a new guest cookie if none exists.
- `POST /api/session/name` — Updates the session's `displayName` (validated server-side to 2–20 printable characters).

### REST Endpoints
- **Lobby & Rooms**:
  - `GET /api/lobby` — Returns `LobbyRoomSummary[]` for open public rooms.
  - `POST /api/games` — Creates a room (`CreateRoomRequest`) and returns `CreateRoomResponse` (`gameId`, `seatIndex` or `null`, `inviteUrl`, and optional `role`: `'player' | 'spectator'`). Setting `creatorSeatIndex: null` / `spectateAsCreator: true` creates a room where the creator joins as a spectator.
  - `GET /api/games/:gameId` — Returns the caller's strictly filtered `PlayerGameView`.
  - `POST /api/games/:gameId/join` — Claims an open seat in a waiting room (`JoinRoomResponse`).
  - `POST /api/games/:gameId/leave` — Leaves a waiting room (rejected once the match has started).
- **Quick Pairing**:
  - `POST /api/quick-pair` — Enters a matchmaking bucket (`QuickPairRequest`), returning either `searching` or `matched`.
  - `DELETE /api/quick-pair` — Cancels an active quick-pair search.
- **Scenario Preset Endpoints**:
  - `POST /api/qa/presets/seed-lobby` — Seeds three open rooms into the Lobby Pool.
  - `POST /api/qa/presets/active-match` — Starts an active match (supports configurable `playerCount` and `handSize`) with the caller seated at index `0`.
  - `POST /api/qa/presets/quick-pair-opponent` — Populates the caller's quick-pair bucket with synthetic opponents to trigger `quickPairMatched`.
  - `POST /api/qa/presets/spectator-match` — Starts a match where the caller observes as a spectator (`seatIndex` null, empty hand).

### WebSocket Channels
- **`/ws/lobby`**: Managed on the frontend by `ReconnectingLobbySocket` with exponential backoff (`500ms` base delay, `5000ms` max delay). Delivers:
  - Initial lobby room snapshot (`onSnapshot`)
  - Incremental lobby pool updates (`onUpdated`)
  - Matchmaking assignments (`onMatchFound` / `onQuickPairMatched` with `gameId` and `seatIndex`)
  - Server-side rejection notices (`onActionRejected` with `code` and `message`)

---

## 4. Preact & CSS Grid Frontend Architecture (`frontend/src`)

### Client State & API Deduplication
- **`sessionClient.ts`**: Maintains a singleton in-flight promise and shared subscriber cache (`ensureGuestSession`, `subscribeGuestSession`, `getCachedGuestSession`) so `HeaderBar` and `LobbyPage` share a single `GET /api/session` call and update synchronously when `updateGuestName` succeeds.
- **`settings.ts`**: Manages persisted user preferences (`ThemeMode` `'dark' | 'light'` with `prefers-color-scheme: light` fallback, `SoundEngine` settings, `TABLE_TEXTURES`, `ALL_CARD_BACK_PATTERNS`, highlight presets/intensity `--highlight-intensity`, and `--app-roundness`).

### Chrome & Visual System (`app.css`, `HeaderBar.tsx`, `BrandLogo.tsx`)
- **Color Separation**: UI selection and navigation chrome uses a royal blue/cobalt palette (`--ui-select-accent`, `--ui-select-border`, `--ui-select-glow`), kept separate from gameplay legality and turn-state highlights in `styles/table.css`.
- **Unified Brand Vector**: `BrandLogo.tsx` provides a single SVG card-and-diamond lockup (`BRAND_NAME = 'LIDURAK'`) reused across the header, hero mark, and `getBrandLogoMosaicDataUri(theme)` background watermark for Quick Pairing tiles.

### 3-Column Desktop Shell & CSS Grid Felt Table (`GamePage`, `GameTable.tsx`)
The game view enforces a non-overlapping CSS Grid / Flexbox layout (`min-width: 0; box-sizing: border-box;` without `position: absolute` or `position: fixed` seat placement):
- **`[data-zone="sidebar-left"]`**: How to Play reference, scenario preset triggers (when applicable), and hotseat/POV player tabs.
- **`[data-zone="table-arena"]`**: 3x3 CSS Grid felt surface:
  - **Row 1**: Opponent seats (`data-seat="top-left"`, `data-seat="top-center"`, `data-seat="top-right"`), assigned clockwise from the viewer.
  - **Row 2**: Active bout cards (`TablePair`), defender-anchored target outlines (`data-testid="target-outline-<id>"`), and the single-card reflection outline (`data-testid="redirect-outline"`).
  - **Row 3**:
    - Column 1 (`[data-zone="table-deck"]`): Talon deck and revealed trump card.
    - Column 2 (`[data-zone="player-hand"]`): Active player's hand (or the `bottom-center` 4th bot seat in all-bot spectator matches).
    - Column 3: `SortBar` and contextual `Pass` / `Surrender` action button.
- **`[data-zone="sidebar-right"]`**: Digital turn clock (`00:XX`, `00:15` default) and match winner / Durak result display.

### Memoized Hand Layout & Interactions (`GameTable.tsx`, `handLayout.ts`)
- `HandCardSlot` is wrapped in `preact/compat` `memo` and positioned exclusively via `transform: translate3d(...)` (`cardX`, `liftPx`, `deltaX`), reading live event handlers from a mutable `api` ref. Pointer sweeps across large hands only re-render slots whose local parting or lift transforms change.
- Supports both click/double-click card play and drag-and-drop interactions (`onAttackDrop`, `onCoverDrop`, `onThrowInDrop`, `onRedirectDrop`, and in-hand card reordering via `onReorderHand`), disabled automatically when `isBot` / `isBotSeat` or `isReviewMode` is active.
