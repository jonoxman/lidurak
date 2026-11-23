# Lidurak Architecture

> **Note on Snapshot Scope:** Only a subset of `frontend/src` files was provided in the codebase snapshot for this document. Directory entries and internal Scala symbols under `backend/` (`durak.engine`, `durak.server`) and unshown `frontend/src` files are noted by their observed interfaces rather than inferred.

## 1. Repository Directory Structure

```text
.
├── play-local.sh                  # Local launcher starting backend and frontend
├── backend/                       # Scala 3 / sbt backend (durak.engine, durak.server)
└── frontend/
    └── src/
        ├── app.css                # Global theme tokens (Dark/Light), lobby & shell styles
        ├── api/
        │   ├── client.ts          # REST API client & QA preset triggers
        │   └── websocket          # GameWebSocket client for live game updates
        ├── audio/
        │   └── SoundEngine        # Sound effect playback for live play & replay steps
        ├── components/
        │   ├── ActionBar.tsx      # Contextual Pass & Surrender controls
        │   ├── Card.tsx           # SVG playing card face renderer & layout constants
        │   ├── CardBack           # Card back SVG component
        │   ├── GameTable.tsx      # Felt table arena, seats, bout pairs, hand & DnD
        │   ├── SortBar            # Hand sort-mode selector
        │   ├── TablePair          # Attack/defense card pair renderer
        │   └── icons/
        │       ├── PassIcon       # Pass button glyph
        │       └── SurrenderIcon  # Surrender button glyph
        ├── pages/
        │   └── GamePage.tsx       # 3-column game shell, clocks, POV tabs & replay review
        ├── state/
        │   └── settings           # Theme mode, highlight intensity, roundness & sort state
        ├── styles/
        │   ├── actionIcons.css    # ActionBar square icon-button & countdown styles
        │   ├── table.css          # Felt table CSS Grid layout & responsive card styles
        │   └── tableTextures      # Table surface filter helpers (getTableFilterCss)
        ├── types                  # Domain types, view/replay parsers & action builders
        └── utils/
            └── handLayout         # Hand contour, overlap, parting & lift geometry
```

## 2. Scala 3 Engine (`durak.engine`)

The backend game engine runs in `backend/` under package `durak.engine` (internal Scala class and enum names were not present in the provided snapshot). As observed from the frontend's typed state projections and action builders, the engine enforces the Durak state machine with the following contract:

- **Match Configuration (`CreateGameRequest`):**
  - `playerCount`, `playerNames`, and `playerTypes` (`human` or bot seats).
  - Rule & inspection flags: `allowRedirect`, `chaosMode`, `transparentMode`, and `devMode`.
- **Card & Cover Rules:**
  - Cards carry `suit` (`spades`, `hearts`, `diamonds`, `clubs`) and `rank` (`two` through `ace`).
  - A defense card legally covers an attack if it is the same suit with a higher rank, or if it is a trump card against a non-trump attack.
- **State Transitions (`GameAction`):**
  - `initialAttack` (`buildInitialAttack`)
  - `coverCard` (`buildCoverCard`)
  - `throwInCards` (`buildThrowInCards`)
  - `redirectAttack` (`buildRedirectAttack`)
  - `passTurn` (`buildPassTurn`)
  - `declareSurrender` (`buildDeclareSurrender`)
- **Authoritative Seat Projections (`PlayerGameView`):**
  - Projects `myId`, `myHand`, `opponents` (`id`, `name`, `cardCount`, `hasPassed`, `finishRank`, and optional revealed `cards` in Transparent/review modes), `tablePairs`, `talonCount`, `discardCount`, `trumpSuit`, `boutPhase`, and active turn/clock metadata (`turnPlayerId`, `turnSecondsRemaining`).
  - Computes per-seat legality gates consumed directly by the UI: `legalActions`, `eligibleTargetIds`, `redirectTargetId`, `canRedirect`, `canThrowIn`, `throwInCards`, and `throwInCapacity`.
- **Replay Recording (`GameReplay`):**
  - Records ordered `ReplayFrame` snapshots containing the triggering `action` and frozen per-seat `views` for post-game review.

## 3. Server Actors & REST/WebSocket Protocol (`durak.server`)

The server layer in `backend/` under `durak.server` exposes HTTP REST endpoints and WebSocket updates consumed by `frontend/src/api/client.ts` and `GameWebSocket`:

| Transport | Endpoint | Purpose |
| :--- | :--- | :--- |
| REST `GET` | `/api/health` | Health check (`2xx` readiness probe) |
| REST `POST` | `/api/games` | Creates a game with `CreateGameRequest`; returns `{ gameId, players }` |
| REST `POST` | `/api/games/preset` | Creates a scripted scenario room (`qa-normal-6-actions`, `qa-medium-14-expand`, `qa-large-30-compress`, `qa-single-card`); returns `{ gameId, players, playerTypes, defaultPlayerId }` |
| REST `GET` | `/api/game/:gameId/view/:playerId` | Fetches `PlayerGameView` for a seat; accepts optional `?requester=<id>` to scope Transparent/debug visibility |
| REST `GET` | `/api/games/:gameId/replay` | Fetches the recorded `GameReplay` frames for review mode |
| REST `POST` | `/api/game/:gameId/action` | Submits a `GameAction` and returns the updated `PlayerGameView` (or `{ error }`) |
| WebSocket | `GameWebSocket` | Real-time table state push updates integrated in `GamePage.tsx` |

*(Internal `durak.server` actor classes, routing DSL, and WebSocket message schemas were not included in the provided codebase snapshot.)*

## 4. Preact & CSS Grid Frontend Architecture (`frontend/src`)

### Layout & Shell (`GamePage.tsx`, `app.css`)
- **Three-Column Desktop Shell:** `GamePage.tsx` organizes the live match view into `[data-zone="sidebar-left"]` (How to Play instructions, scenario presets, hotseat POV switchers in fixed `seatOrderedPlayerIds` order), `[data-zone="table-arena"]` (felt table), and `[data-zone="sidebar-right"]` (digital `00:XX` turn clock, `mm:ss` overall match clock, and Durak/winner results).
- **Replay Review Mode:** `GamePage.tsx` fetches `getGameReplay`, filters out no-op `passTurn` frames via `visibleReplayFrames` / `isNonMoveFrame`, and steps through `ReplayFrame` snapshots with `SoundEngine` cues while disabling move submission.
- **Theming (`app.css`, `state/settings`):** CSS custom properties drive Dark mode (default) and Light mode (`html[data-theme='light']` and `@media (prefers-color-scheme: light)`), `--highlight-intensity`, `--app-roundness`, and Cobalt/Royal Blue navigation/selection accents (`--ui-select-*`).

### Felt Table & Hand Interaction (`GameTable.tsx`, `ActionBar.tsx`, `Card.tsx`)
- **Seat Assignment & Bout Anchoring:** Opponent seats map clockwise from the viewer into `top-left`, `top-center`, and `top-right` slots (`SEAT_BOX` `240x140`). Uncovered and covered pairs render via `TablePair`, alongside `TableDeck` and drop outlines for initial attacks, throw-ins, and redirects.
- **Responsive Card & Hand Geometry:** `Card.tsx` renders an SVG card face inside a `70x100` viewBox with corner index strips (`CARD_INDEX_STRIP_WIDTH_PX = 36`), pip grids (`PIP_LAYOUTS`), serif court letters (`J`, `Q`, `K`), and center Ace pips. Cards default to `100x140` on desktop and `48x68` below the `900px` breakpoint (`CARD_MOBILE_BREAKPOINT_PX`). `utils/handLayout` computes hand overlap (`20%`–`80%`), parting, contour paths, and vertical lift for selected/playable cards.
- **Input & Contextual Controls:** `GameTable.tsx` supports magnetic drag-and-drop (`SNAP_DISTANCE_PX = 48`) for attacks, covers, throw-ins, redirects, and hand reordering, plus double-click actions. `ActionBar.tsx` renders icon-only `Pass` (`passTurn`) and `Surrender` (`declareSurrender`) buttons inside the lower-table control band only when permitted by `legalActions` and never for bot-controlled seats.
