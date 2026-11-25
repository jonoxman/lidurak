# Lidurak Architecture

Lidurak is a full-stack web implementation of the card game Durak, pairing a Scala 3 game engine and HTTP/WebSocket server (`backend/`) with a Preact and TypeScript single-page application (`frontend/`).

## 1. Repository Layout

```text
.
├── backend/                  # Scala 3 engine (durak.engine) & server (durak.server), built with sbt
├── frontend/                 # Preact + TypeScript + Vite SPA
│   └── src/
│       ├── api/              # REST session/lobby clients and reconnecting WebSocket clients
│       ├── components/       # Table, card, header, sorting, and lobby UI components
│       │   └── lobby/        # CreateInviteTab, LobbyPoolTab, and related lobby panels
│       ├── pages/            # LobbyPage and GamePage
│       ├── router/           # History API routing hook (useRoute)
│       ├── state/            # Persisted UI preferences and theme management (settings)
│       ├── styles/           # Table grid CSS and felt/surface texture utilities
│       ├── types/            # Core game action builders and multiplayer wire-protocol parsers
│       ├── utils/            # Hand geometry/parting math and bout layout helpers
│       ├── app.css           # Global theme tokens (dark/light) and lobby/banner styles
│       └── app.tsx           # Root App component and dual hash/History router
├── play-local.sh             # Unified local launcher for backend and frontend servers
├── README.md                 # User and developer quick start
└── ARCHITECTURE.md           # Technical architecture reference
```

---

## 2. Scala 3 Engine (`durak.engine`)

The `durak.engine` package implements the pure ruleset and state machine for Durak matches, verified via `sbt -batch test`.

### Core Rules & Configuration

- **Deck Sizes:** 36-card deck for 2- and 3-player tables; 52-card deck for 4-player tables, with a revealed trump suit drawn for the talon.
- **Variants:**
  - **Redirect / Reflect (`allowRedirect`):** Controls whether a defender may pass an uncovered bout onward by matching the attack rank.
  - **Chaos Mode (`chaosMode`):** Allows attackers to target any eligible active opponent seat rather than strictly the clockwise neighbor.
- **Turn Clocks:** Configurable per-turn timeout (`15s` default, `30s`, or `60s`).

### Bout State Machine & Actions

Each round progresses through attack, defense, throw-in, and resolution phases driven by validated player actions:

1. **Initial Attack (`initialAttack` / `playAttack`):** Opens a bout with one or more cards against an eligible defender.
2. **Cover (`coverCard`):** Defender covers a specific uncovered attack index (`attackIndex`) using a higher card of the same suit or a trump card.
3. **Redirect (`redirectAttack`):** Defender forwards the bout to the next eligible seat (`redirectTargetId`) when redirect rules allow it.
4. **Throw-In (`throwInCards`):** Attackers add cards matching ranks present on the table up to the defender's remaining capacity, including during surrender throw-in phases.
5. **Pass (`passTurn`) & Surrender (`declareSurrender`):** Attackers signal completion of throw-ins; defenders forfeit the bout and collect table cards.

### Per-Viewer Projection (`PlayerGameView`)

The engine projects game state per viewer rather than broadcasting raw global state:

- Active players receive their own `hand`, `viewerSeat`, legal action flags (`awaitingAttack`, `defending`, `canRedirect`, `canThrowIn`, `throwInCards`, `throwInCapacity`, `eligibleTargetIds`, `redirectTargetId`), and bout phase (`boutPhase`).
- Spectators receive `viewerSeat: null` and an empty `hand`.
- Opponent summaries (`OpponentSummary`) expose only `id`, `name`, `cardCount`, `hasPassed`, and `finishRank`, concealing hidden cards unless Transparent Mode or post-game review is active.

---

## 3. Server Layer (`durak.server`)

The `durak.server` package hosts the HTTP REST API, WebSocket endpoints, room registry, quick-pair matchmaking, and bot-seat drivers.

### REST Endpoints

| Method & Path | Purpose |
| --- | --- |
| `GET /api/lobby` | Fetch open public rooms (`LobbyRoomSummary[]`) |
| `POST /api/games` | Create a room (`playerCount`, `allowRedirect`, `turnTimeoutSeconds`, `isPublic`); returns `gameId`, `seatIndex`, `inviteUrl` |
| `GET /api/games/:gameId` | Fetch the caller's `PlayerGameView` |
| `POST /api/games/:gameId/join` | Claim an open seat in a waiting room; returns `gameId`, `seatIndex`, `view` |
| `POST /api/games/:gameId/leave` | Leave a waiting room before the match starts |
| `POST /api/quick-pair` | Enter the quick-pairing queue (`searching` or `matched`) |
| `DELETE /api/quick-pair` | Cancel an active quick-pair search |
| `POST /api/qa/presets/seed-lobby` | Seed open rooms in the lobby pool |
| `POST /api/qa/presets/active-match` | Create an active bot-filled match (supports custom `playerCount` and `handSize`) |
| `POST /api/qa/presets/quick-pair-opponent` | Populate quick-pair opponents to trigger `quickPairMatched` |
| `POST /api/qa/presets/spectator-match` | Create a live match for a spectator viewer |

### WebSocket Protocol

- **`/ws/lobby`:** Pushes live lobby state to connected clients:
  - `lobbySnapshot` — initial list of open public rooms.
  - `lobbyUpdated` — incremental updates as rooms open, fill, or start.
  - `quickPairMatched` / `matchFound` — notifies a queued player of their assigned `gameId` and `seatIndex`.
  - `actionRejected` — error code and message when a lobby request fails.
- **`/ws/games/:gameId`:** Bidirectional match channel:
  - **Client-to-server (`WsClientMessage`):** `playAttack`, `coverCard`, `redirectAttack`, `throwInCards`, `declareSurrender`, `passTurn`, and `ping`. The server resolves the acting seat from the caller's session rather than trusting client-supplied player IDs.
  - **Server-to-client (`WsServerMessage`):** `gameViewUpdate` carrying a seat-filtered `PlayerGameView`, and `actionRejected` (`code`, `message`) on illegal moves.

---

## 4. Frontend Architecture (`frontend/src`)

The frontend is built with Preact, TypeScript, and Vite, tested with Vitest (`npm test -- --run`).

### Routing & Modes (`app.tsx`, `router/useRoute.ts`)

`App` coordinates two routing modes beneath `HeaderBar`:

- **History API (`/`, `/g/:gameId`):** Live multiplayer lobby (`LobbyPage`) and multiplayer table (`GamePage` with `mode="multiplayer"`).
- **Hash Routes (`#/`, `#/g/:gameId?player=:seat`, `#/g/:gameId/replay`):** Local/bot hotseat gameplay and post-game replay inspection.

### Lobby Modules (`pages/LobbyPage.tsx`, `components/lobby/`)

- `LobbyPage` owns a single persistent `LobbySocket` connection to `/ws/lobby` and distributes live room updates to child tabs.
- `CreateInviteTab` manages room creation (`Private invite link` vs `Public lobby pool`, 2–4 players, `allowRedirect`, and 15s/30s/60s turn clock).
- `LobbyPoolTab` renders the live room list with seat counts, rule badges, one-click `Join`, and empty-state room creation/seeding triggers.

### Socket & API Clients (`api/`)

- `sessionClient.ts` wraps HTTP JSON calls via `apiRequest`.
- `lobbyClient.ts` exposes typed REST helpers and `ReconnectingLobbySocket` for `/ws/lobby`.
- `gameSocket.ts` implements `createGameSocket` (`ReconnectingGameSocket`) for `/ws/games/:gameId`, translating local `GameAction` objects via `toWsClientMessage`, sending periodic `ping` keepalives (`20s`), and reconnecting with capped exponential backoff (`500ms` to `5000ms`).

### Zero-Overlap 3-Column Table Shell (`pages/GamePage.tsx`, `components/GameTable.tsx`)

The game view uses CSS Grid and Flexbox without overlapping `position: absolute` or `position: fixed` placement for seats, hands, bouts, or sidebars:

- **`[data-zone="sidebar-left"]`:** How to Play instructions, scenario preset triggers, and hotseat seat-switcher tabs.
- **`[data-zone="table-arena"]`:** 3×3 CSS Grid felt table:
  - **Row 1:** Opponent seats (`top-left`, `top-center`, `top-right`), mapped clockwise from the viewer.
  - **Row 2:** Active bout pairs (`TablePair`), defender-anchored target outlines (`target-outline-<id>`), throw-in outline, and single-card reflection outline (`redirect-outline`).
  - **Row 3:** Talon deck and trump card (`table-deck`), active player's hand (`player-hand`), and `SortBar` with contextual `Surrender` / `Pass` controls.
- **`[data-zone="sidebar-right"]`:** Turn countdown clock (`00:XX`) and match winner / Durak summary.

### Hand Layout, Drag-and-Drop & Performance (`components/GameTable.tsx`, `utils/handLayout.ts`)

- Hand cards are rendered via memoized `HandCardSlot` components using GPU-composited `transform: translate3d(...)` positioning (`cardTranslate3d`) so pointer hover parting (`computePartedCardLayout`) and lift states (`ELIGIBLE_LIFT_PX`, `SELECTED_LIFT_PX`) update only affected card slots.
- Supports both click/double-click play and drag-and-drop interactions onto attack targets, uncovered bout cards, throw-in slots, redirect outlines, and intra-hand reordering (`onReorderHand`).

### Theming & Visual Tokens (`app.css`, `styles/table.css`, `state/settings.ts`)

- `initSettings()` synchronizes theme selection (`dark`, `light`, or OS `prefers-color-scheme`), corner roundness, surface filters (`getTableFilterCss`), and highlight intensity (`--highlight-intensity`) onto `<html>`.
- `app.css` separates Royal Blue/Cobalt UI selection tokens (`--ui-select-accent`, `--ui-select-border`, `--ui-select-glow`) for navigation, lobby controls, and sorting chrome from gameplay action families defined in `styles/table.css`.
