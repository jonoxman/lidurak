# Lidurak Architecture

Lidurak is a client-server implementation of the card game Durak composed of a **Scala 3 backend** (`backend/`) and a **Preact + TypeScript frontend** (`frontend/`).

---

## 1. Repository Directory Tree

```text
.
├── play-local.sh                  # Unified local launcher for backend and frontend
├── backend/                       # Scala 3 / sbt backend project
│   └── ...                        # Packages: durak.engine, durak.server
└── frontend/                      # Preact + TypeScript + Vite frontend project
    └── src/
        ├── app.css                # Global theme tokens (dark/light), lobby & shell styles
        ├── types.ts               # Wire contracts, action builders, and view/replay parsers
        ├── api/
        │   ├── client.ts          # REST API client & curated preset catalog
        │   └── websocket.ts       # WebSocket client (GameWebSocket) for live state sync
        ├── audio/
        │   └── SoundEngine.ts     # Client-side game audio feedback
        ├── pages/
        │   └── GamePage.tsx       # 3-column game shell, hotseat POV, replay & clock orchestration
        ├── components/
        │   ├── ActionBar.tsx      # Contextual Pass / Surrender controls
        │   ├── Card.tsx           # Parametric 70x100 SVG card face & corner-index geometry
        │   ├── CardBack.tsx       # SVG card back & shared corner radius helpers
        │   ├── GameTable.tsx      # 3x3 felt table, seats, drop targets, drag-and-drop & hand layout
        │   ├── SortBar.tsx        # Hand sort mode controls
        │   └── TablePair.tsx      # Attack/defense card pair & collapsed covered stack slot
        ├── state/
        │   └── settings.ts        # Theme resolution, highlight intensity, and persisted sort mode
        ├── styles/
        │   ├── table.css          # Felt table grid, card sizing breakpoints, and gameplay highlight styles
        │   └── tableTextures.ts   # Table surface filter helpers
        └── utils/
            ├── handLayout.ts      # Hand overlap, contour path, hover parting, and card lift math
            └── tableLayout.ts     # Bout partitioning, covered-stack edge collapse, and row spacing
```

---

## 2. Scala 3 Engine State Machine (`durak.engine`)

The `durak.engine` package implements the deterministic Durak ruleset and per-seat view projection:

- **Core Game State:** Tracks the talon deck, trump suit, discard pile, fixed-order player seats (`p0`, `p1`, ...), seat types (`human` vs. bot), per-player hands, pass flags, finish ranks, and the active bout state.
- **Bout Lifecycle & Phases:**
  - **Initial Attack:** The active attacker opens a bout by playing an initial card toward a legal target (`InitialAttack`). In standard play the target is the next active seat; in Chaos Mode (`chaosMode`), the engine exposes `eligibleTargetIds` so the attacker may aim at any active opponent.
  - **Defense & Cover:** The defender covers uncovered attacking cards (`CoverCard`) with either a higher rank of the same suit or any trump card against a non-trump attack.
  - **Redirect (Transfer):** When `allowRedirect` is enabled and no attack on the table has been covered yet, the defender may forward the bout (`RedirectAttack`) with a matching rank to the next eligible seat (`redirectTargetId`).
  - **Throw-In:** Attackers may add cards matching any rank currently on the table (`ThrowInCards`) up to the engine's remaining throw-in capacity (`throwInCapacity` / `throwInCards`). Throw-ins remain bounded both during live defense and after a defender declares surrender.
  - **Surrender & Pass Resolution:** Declaring surrender (`DeclareSurrender`) transitions the bout so attackers may complete remaining throw-ins before the defender absorbs all table cards and forfeits their next attack turn. Passing (`PassTurn`) resolves a fully defended bout to the discard pile and replenishes hands from the talon.
  - **Endgame Detection:** Once the talon is empty and players shed their hands, the engine assigns finish ranks until a single player remains with cards (the Durak) and transitions to a terminal game-over phase.
- **Seat-Scoped Projections (`PlayerGameView`):** The engine projects a viewer-specific snapshot containing the viewer's own hand, sanitized opponent summaries (`OpponentSummary` with card counts, pass state, and finish rank), legal action gates (`awaitingAttack`, `defending`, `canRedirect`, `canThrowIn`, `throwInCards`, `throwInCapacity`, `eligibleTargetIds`), and optional revealed opponent cards when `transparentMode` or `devMode` is enabled.

---

## 3. Server Actors & WebSocket / REST Protocol (`durak.server`)

The `durak.server` package hosts the concurrent match lifecycle, turn timers, replay recording, and HTTP/WebSocket endpoints consumed by the frontend:

- **Actor-Backed Match Rooms:** Each created game runs inside an isolated room coordinator that serializes incoming player actions and bot turns, manages the per-turn countdown clock (`turnPlayerId`, `turnSecondsRemaining`, defaulting to `15` seconds), and records per-step `ReplayFrame` snapshots containing each seat's `PlayerGameView`.
- **REST API Surface:**
  - `GET /api/health` — Readiness probe returning `2xx` when the backend is healthy.
  - `POST /api/games` — Accepts a `CreateGameRequest` (`playerCount`, `playerNames`, `allowRedirect`, `chaosMode`, `playerTypes`, and optional `transparentMode` / `devMode`) and returns `{ gameId, players }`.
  - `POST /api/games/preset` — Instantiates one of the curated scenario states (`qa-table-collapse-right`, `qa-surrender-timer`, `qa-normal-6-actions`, `qa-medium-14-expand`, `qa-large-30-compress`, `qa-single-card`) and returns `{ gameId, players, playerTypes, defaultPlayerId }`.
  - `GET /api/game/:gameId/view/:playerId` — Returns the `PlayerGameView` for `:playerId` (with optional `?requester=<id>` for viewer-scoped projection filtering).
  - `POST /api/game/:gameId/action` — Submits a serialized `GameAction` and returns the updated `PlayerGameView` (or a structured JSON `{ error }` payload on illegal moves).
  - `GET /api/games/:gameId/replay` — Returns the recorded `GameReplay` containing historical frames for match review.
- **WebSocket Synchronization (`GameWebSocket`):** Streams real-time `PlayerGameView` updates and clock ticks to connected clients so active seats, spectators/hotseat views, and opponent actions stay synchronized without polling.

---

## 4. Preact & CSS Grid Frontend Architecture (`frontend/src`)

### Application Shell & Three-Column Grid
`GamePage.tsx` orchestrates the match session, connecting REST (`api/client.ts`), live WebSocket updates (`api/websocket.ts`), client audio (`audio/SoundEngine.ts`), and user preferences (`state/settings.ts`) into a CSS Grid layout with explicit non-overlapping zones:
- **Left Sidebar (`[data-zone="sidebar-left"]`):** Hosts the **How to Play** reference, one-click **Scenario Presets**, and hotseat player-switcher tabs ordered by fixed seat index (`p0`, `p1`, ...).
- **Center Table Arena (`[data-zone="table-arena"]`):** A 3×3 CSS Grid felt surface:
  - **Row 1:** Clockwise-mapped opponent seats (`top-left`, `top-center`, `top-right`) sized uniformly (`240×140`).
  - **Row 2:** Active bout pairs (`TablePair.tsx`), defender-anchored target outlines (`target-outline-<id>`), throw-in outline, and single-card redirect outline (`redirect-outline`).
  - **Row 3:** Talon deck and trump indicator (`[data-zone="table-deck"]`), active player's hand (`[data-zone="player-hand"]`), `SortBar.tsx`, and contextual `ActionBar.tsx` (`Pass` / `Surrender`).
- **Right Sidebar (`[data-zone="sidebar-right"]`):** Renders the turn countdown clock (`00:XX`), overall match clock (`mm:ss`), and end-of-game standings/rematch controls.

### Card Rendering, Layout Geometry & Interaction
- **Parametric SVG Cards (`Card.tsx`, `CardBack.tsx`):** Cards render inside a fixed `70×100` SVG viewBox with symmetrically centered pip grids, serif court centerpieces (`J`, `Q`, `K`), sans-serif corner indices inside a `36px` left index strip, and CSS-token-driven border roundness. Standard desktop cards measure `100×140px`, scaling down to `48×68px` below the `900px` mobile breakpoint.
- **Hand & Table Layout (`utils/handLayout.ts`, `utils/tableLayout.ts`):**
  - Dynamically computes overlapping hand spacing so at least a `20px` left index strip remains visible per card, computes hover parting offsets, lifts playable/selected cards, and generates the hand contour path.
  - Partitions table pairs between active uncovered attacks and edge-collapsed covered stacks when the bout grows large.
- **Input & Drag-and-Drop (`GameTable.tsx`):** Supports click selection, double-click quick actions (`defenderDoubleClickAction`), hand reordering (`onReorderHand`), and HTML5 drag-and-drop with a center-locked custom drag preview and `48px` magnetic snap zones for `onAttackDrop`, `onCoverDrop`, `onThrowInDrop`, and `onRedirectDrop`. Bot seats and replay mode disable interactive move submission while keeping hand sorting active.
- **Theming & Accessibility (`app.css`, `styles/table.css`, `state/settings.ts`):** CSS custom properties drive Dark and Light themes (including `prefers-color-scheme: light` fallback), configurable highlight intensity (`--highlight-intensity`), and strict color-family separation between Cobalt UI/selection chrome and gameplay status highlights.
