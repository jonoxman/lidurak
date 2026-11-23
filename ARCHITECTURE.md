# Lidurak Architecture

## 1. Repository Structure

```text
.
├── play-local.sh                  # Local launcher for backend and frontend
├── backend/                       # Scala 3 game engine and HTTP/WebSocket server
│   └── src/main/scala/durak/
│       ├── engine/                # Pure game rules, state machine, and replay types
│       └── server/                # Cats Effect rooms, turn clocks, bot drivers, HTTP/WS API
└── frontend/                      # Preact + TypeScript + CSS Grid client
    └── src/
        ├── api/                   # Typed REST client (client.ts)
        ├── components/            # Table, Card, CardBack, TablePair, SortBar, sidebars/pages
        ├── state/                 # Client settings and highlight/theme state
        ├── styles/                # Felt arena CSS Grid and semantic theme tokens (table.css, etc.)
        ├── utils/                 # Pure hand geometry (handLayout.ts) and table bout layout
        └── types.ts               # Shared frontend request, action, view, and replay types
```

## 2. Scala 3 Engine (`durak.engine`)

The `durak.engine` package models Durak gameplay as a deterministic state machine over immutable `GameState` values:

- **Configuration (`GameConfig`):** Configures player count, seat types (human seats, `GameConfig.RandomBotSeat`, and `GameConfig.BasicBotSeat`), Redirect (Perevod) support, Chaos Mode (targeting any active opponent), Transparent Mode, and Dev Mode.
- **Game Creation & Transitions (`GameEngine`):** `GameEngine.createGame(config, playerNames)` initializes a dealt match state. Incoming `GameAction` commands (such as `InitialAttack`, cover actions, redirect actions, throw-ins, passes, and surrenders) are validated against the current bout phase and player hand before producing the next `GameState`.
- **Bout & Endgame State:** Tracks the active attacker, defender, eligible targets, uncovered/covered table pairs, bout phase (attack, defense, surrender throw-in), pass state per seat, finish ranks, and turn deadline (`turnDeadlineMs`).
- **Replay Serialization (`SerializedGame`, `GameReplay`):** Captures the pristine initial deal (`GameReplay.initial(gameId, initialState)`) and subsequent state transitions so completed matches can be fetched and stepped through in review mode.

## 3. Server Actors & Protocol (`durak.server`)

The backend concurrency layer is built on Cats Effect and `fs2`:

### Room & Concurrency Model (`GameActor`, `GameRoom`)
`GameActor.create` and `GameActor.createFrom` instantiate a `GameRoom` with an 8-character ID from `GameManager.generateGameId()` and manage concurrent access cleanly:
- **`stateRef: Ref[IO, GameState]`**: Holds the authoritative current match state.
- **`lock: Semaphore[IO]`**: Serializes submitted moves so multi-card actions and clock/bot transitions apply atomically.
- **`topic: Topic[IO, GameState]`**: Broadcasts state updates to connected subscribers.
- **`replay: Ref[IO, SerializedGame]`**: Records the match history from the opening deal.
- **`povSeat: Ref[IO, Option[String]]`**: In non-Dev-Mode games, locks onto the first inspected human seat so clients cannot tamper with seat queries to view another player's hidden hand.
- **`clockStop: Deferred[IO, Unit]`**: Coordinates shutdown of the room's background fibers.

### Turn Clock & Bot Drivers
- **Turn Clock (`DefaultTurnSeconds = 15`, `ClockPollMillis = 250`):** Tracks `turnDeadlineMs` and automatically plays a legal fallback move when an active player's timer expires. When a defender holds no legal defense or redirect, a `DefenselessGraceSeconds = 3` window applies before auto-surrender.
- **Surrender Throw-In Pacing (`DefaultNoThrowInAutoPassDelay = 1s`):** Holds surrendered bouts briefly before auto-passing seats that have no legal throw-in cards, keeping surrendered cards and throw-ins visible on the table.
- **Bot Driver (`BotPollMillis = 50`):** Drives computer-controlled seats:
  - `BasicBotSeat`: Uses human-paced delays (`DefaultBotDelayMin = 125ms`, `DefaultBotDelayMax = 500ms`).
  - `RandomBotSeat`: Plays after a brief initial start delay (`DefaultInitialBotStartDelay = 500ms`) and short inter-move delay (`DefaultRandomBotDelay = 50ms`).
- **Audit Logging:** Rejected client actions are logged via `GameActor.logRejected` to SLF4J and stdout.

### HTTP / REST Endpoints
Consumed by `frontend/src/api/client.ts`:
- `GET /api/health` — Backend readiness/health check.
- `POST /api/games` — Creates a match from `CreateGameRequest` (`playerCount`, `playerNames`, `allowRedirect`, `chaosMode`, `playerTypes`, optional `transparentMode`, optional `devMode`), returning `{ gameId, players }`.
- `POST /api/games/preset` — Creates one of the 7 scripted QA/demo scenarios (`qa-table-collapse-right`, `qa-surrender-timer`, `qa-normal-6-actions`, `qa-medium-14-expand`, `qa-large-30-compress`, `qa-single-card`, `qa-fast-bots`), returning `{ gameId, players, playerTypes, defaultPlayerId }`.
- `GET /api/game/:gameId/view/:playerId` — Returns a `PlayerGameView` projection for the requested seat (accepts optional `?requester=<id>` for Transparent/Dev projection filtering).
- `POST /api/game/:gameId/action` — Submits a `GameAction` and returns the updated `PlayerGameView` or `{ error }`.
- `GET /api/games/:gameId/replay` — Returns the recorded `GameReplay` for post-match review.

## 4. Preact & CSS Grid Frontend (`frontend/src`)

### API & Type Parsing (`frontend/src/api/client.ts`, `frontend/src/types.ts`)
- `client.ts` wraps all REST calls (`checkServerHealth`, `createGame`, `createPresetGame`, `getGameView`, `getGameReplay`, `sendAction`) and validates payloads via `parsePlayerGameView` and `parseGameReplay`.
- Action builders (`buildInitialAttack`, `buildCoverCard`, `buildRedirectAttack`) construct typed `GameAction` payloads for submission.

### CSS Grid Felt Arena (`frontend/src/styles/table.css`)
- **`[data-zone='table-arena']`:** A 3-column (`1fr 2fr 1fr`), 4-row CSS Grid with viewport-clamped track heights (`--seat-row-height`, `--battlefield-height`, `--hand-row-height` with `--hand-timer-clearance`, and `--actions-row-height`) so seats, bout pairs, hand, and lower action controls remain cleanly separated without absolute-positioned overlaps.
- **Felt Layering:** Uses a dedicated `::before` grid-spanning surface layer (`--table-felt`, `--table-felt-overlay`, `--table-filter`) so brightness/contrast/hue filters tint the felt without affecting card graphics.
- **Semantic Color Tokens:** Dark (`:root`) and light (`:root[data-theme='light']`) themes define distinct color families scaled by `--highlight-intensity`:
  - `--role-attacker-*` (emerald/green: attack, throw-in, pass)
  - `--role-defender-*` (crimson/red: defense, uncovered attacks, surrender)
  - `--trump-*` (gold/bronze: trump card indicators)
  - `--redirect-*` (violet/purple: redirect outline and arrow)
  - `--clock-active-*` & `--clock-urgent-*` (cyan/teal active clock, orange-amber low-time state)

### Table Rendering & Hand Geometry (`GameTable.tsx`, `handLayout.ts`)
- **`GameTable.tsx`:** Renders seat assignments (`top-left`, `top-center`, `top-right`), opponent boxes with role auras and optional revealed mini-cards in Transparent/review modes, active bout pairs (`TablePair`), drag-and-drop/click/double-click targets for attacks, covers, throw-ins, and redirects, and a memoized `HandCardSlot` component that applies GPU-composited `translate3d(...)` transforms via a stable `HandCardSlotApi` ref so pointer sweeps only repaint local neighboring cards.
- **`utils/handLayout.ts`:** Pure, DOM-free layout engine providing:
  - `computeHandLayout`: Maintains constant full card dimensions (`100x140` desktop, `48x68` mobile), uses a `0.36` resting overlap for 2–6 card hands inside a 6-card default box, expands up to `maximalBoxWidth` for medium hands, and compresses up to the exposed `36px` index strip (`DEFAULT_MIN_VISIBLE_INDEX_STRIP_PX`) before super-compressing large hands.
  - `computePartedCardLayout` / `computeDragPartedCardPositions`: Opens localized gaps around a hovered or dragged card (`HAND_HOVER_PARTING_RADIUS = 3`) while keeping distant cards pinned.
  - `getCardVerticalLiftPx`: Computes three elevation tiers (`0px` resting, `9px` playable/eligible, `18px` selected).
  - `buildHandContourPath`: Generates a non-rectangular SVG contour path hugging the laid-out, lifted, and parted cards.
