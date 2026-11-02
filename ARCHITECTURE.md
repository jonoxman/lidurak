# Lidurak — Technical Architecture & System Reference

## 1. Repository Structure
~~~text
.
├── README.md          # Setup, startup, and user interface guide
├── ARCHITECTURE.md    # Technical architecture, engine state machine & protocol reference
├── play-local.sh      # Local development launcher (starts backend :8080 & frontend :5173)
├── backend/           # Scala 3.3.3 + Http4s Ember + Cats Effect 3 + Circe + MUnit
│   ├── build.sbt
│   └── src/
│       ├── main/scala/durak/
│       │   ├── Main.scala              # HTTP/WS server entrypoint on 0.0.0.0:8080
│       │   ├── engine/                 # Pure, deterministic, immutable Durak state machine
│       │   └── server/                 # Stateful Cats Effect game actors, clock fibers & HTTP/WS routes
│       └── test/scala/durak/           # MUnit test suites (engine & server invariants)
└── frontend/          # TypeScript 5 + Preact + Vite + Vitest
    ├── package.json
    ├── vite.config.ts                  # Proxies /api and /ws to localhost:8080
    └── src/
        ├── app.tsx                     # Hash-based router (#/ lobby and #/g/:gameId?player=pX)
        ├── app.css                     # Shell, header, theme tokens & page-level surface styling
        ├── types.ts                    # Shared TypeScript interfaces & action builders
        ├── api/                        # REST client (client.ts) and WebSocket manager (websocket.ts)
        ├── audio/SoundEngine.ts        # Zero-dependency Web Audio API procedural sound synthesizer
        ├── state/settings.ts           # Observable appearance store (theme, roundness, felt, card back)
        ├── pages/                      # LobbyPage.tsx & GamePage.tsx (3-column Lichess layout)
        ├── components/                 # HeaderBar.tsx, GameTable.tsx (3x3 grid), Card.tsx, CardBack.tsx, TablePair.tsx
        ├── styles/tableTextures.ts     # Felt presets + brightness/contrast/hue filter helpers
        ├── styles/table.css            # Lichess dark theme palette & non-overlapping CSS Grid rules
        └── __tests__/                  # Vitest DOM, layout, audio & interaction test suites
~~~

---

## 2. Backend Architecture (`backend/src/main/scala/durak/`)

### 2.1 Pure Game Engine (`durak.engine`)
All core rules reside in side-effect-free Scala 3 case classes and enums:
- **`Card`, `Suit`, `Rank`:** Models suits (`Clubs`, `Diamonds`, `Hearts`, `Spades`) and ranks (`Two` through `Ace`, supporting 36-card decks for 2–3 players and 52-card decks for 4 players).
- **`GameConfig`:** Stores `playerCount`, `allowRedirect`, `seed`, and `playerTypes` (per-seat `"human"` / `"randomBot"`; any seat the vector does not name is human). `config.isBotSeat(idx)` marks computer-controlled seats and `GameConfig.normalizePlayerTypes(playerCount, types)` pads or truncates a request's seat list.
- **`GameState` & `BoutPhase`:**
  - Tracks `players: Vector[PlayerState]`, `talon: Vector[Card]`, `bottomTrumpCard: Option[Card]`, `trumpSuit: Suit`, `discardPile: Vector[Card]`, `tablePairs: Vector[TablePair]`, `attackerIdx: Int`, `defenderIdx: Int`, `boutPhase: BoutPhase`, `winners: Vector[String]`, `durak: Option[String]`, and `presentPlayers: Set[String]` (human seats that reported an open connection). Presence is derived through `isPresentSeat(idx)` / `isPlayerPresent(id)` / `presentPlayerIds`, and bot seats are always present.
  - **Card Conservation Invariant:** Across all transitions (`InitialAttack`, `CoverCard`, `RedirectAttack`, `ThrowInCards`, `DeclareSurrender`, `PassTurn`, and bout resolution draws), total cards across `talon + discardPile + hands + tablePairs` remains strictly constant (`36` or `52`).
  - **Last-Player-Standing Victory:** Players who empty their hands once `talon.isEmpty` are appended to `winners` in order of finish and skipped by clockwise turn helpers (`nextActivePlayer`). Play continues until `activePlayersWithCards.size <= 1`, designating the final remaining player holding cards as `durak`.
  - **Chaos Mode Variant (not implemented in the engine yet):** `GameAction.InitialAttack` carries no target seat, so an opening attack always aims at the clockwise defender. Selecting an arbitrary target still requires a target-aware variant in `GameAction` / `GameEngine`.

### 2.2 Anti-Cheat State Projection (`PlayerGameView`)
- `PlayerGameView.forViewer(state, viewerId)` strips all hidden information before serialization.
- A connected client receives only their own `myHand: Vector[Card]`, public summaries for opponents (`id`, `name`, `cardCount`, `hasPassed`, `finishRank`, `isPresent`), `talonCount`, `bottomTrumpCard`, `trumpSuit`, `tablePairs`, `legalActions`, `turnDeadlineMs`, and `presentPlayers` (ids of every present seat, in seat order) so the UI can draw green/grey presence dots.

### 2.3 Concurrent Server Actors & Turn Clock (`durak.server`)
- **`GameActor`:** Wraps each match's `GameState` in a `Cats Effect` `Ref[IO, ...]` and broadcasts personalized `PlayerGameView` snapshots over a `Topic[IO, ...]` to connected WebSocket clients. `setPresence(room, playerId, isPresent)` stores presence in the state and re-publishes it whenever the value changes, so presence dots update without anyone having to play a move.
- **`RandomBot` seat driver (`engine/RandomBot` + `GameActor.startBots`):**
  - `RandomBot.legalActionsFor(state, playerId)` enumerates opening attacks (every hand card), covers, redirects, surrenders, throw-ins and passes for the seat's role and phase, then keeps only the actions `GameEngine.applyAction` accepts; `RandomBot.chooseAction(state, playerId, rng)` picks one uniformly.
  - One driver fiber per room (started only when a seat is a bot) waits a random `500 ms`–`2000 ms` — constructor-overridable for fast tests — and submits the chosen move through the same `applyAction` pipeline as a client, so clock restarts, validation and broadcasts are shared. The pause races a state-change watch, so a move for a superseded position is dropped instead of played.
  - The prompted seat is the attacker during `InitialAttack`, the defender while an attack is uncovered, and otherwise any un-passed thrower — the same ordering the turn clock uses. Human seats are only ever animated by the turn clock.
- **15-Second Turn Clock & 3-Second Auto-Action Delay:**
  - Every valid state transition resets `turnDeadlineMs = now + 15000`.
  - Background fibers monitor the turn deadline and execute the default timeout move (`InitialAttack` with a random card, `DeclareSurrender` for a defender, or `PassTurn` for a thrower) if 15 seconds elapse without input.
  - Forced automatic actions wait 3 seconds before firing so players can visually read the table state.
- **`GameRoutes`:**
  - `GET /api/health`: Readiness probe returning `200 {"status":"ok"}`; the frontend polls it before offering game creation.
  - `POST /api/games` (alias `POST /api/game/create`): Creates a match with `playerCount`, `playerNames`, `allowRedirect`, and `playerTypes` (`"human"` / `"randomBot"` per seat, normalized to exactly `playerCount` entries). The response is `{ gameId, players, playerTypes }`.
  - `GET /api/games/:gameId/view?player=:playerId` (alias `GET /api/game/:gameId/view/:playerId`): Returns that seat's `PlayerGameView` JSON.
  - `POST /api/games/:gameId/action` (alias `POST /api/game/:gameId/action`): Submits a `GameAction` for a player.
  - `POST /api/games/:gameId/presence`: Body `{ "playerId": "p0", "isPresent": true }` (an `"active"` flag is also accepted) records human presence and returns that seat's view.
  - `GET /ws/game/:gameId/:playerId`: Bi-directional WebSocket streaming `PlayerGameView` updates. Text frames are `{"type":"ping"}`, `{"type":"presence","isPresent":…}` or a `GameAction`; incoming `Ping` / `Pong` frames are ignored silently. Opening the socket marks the seat present and closing it marks it absent.
  - **Keepalive & idle timeout:** the outbound stream merges a `WebSocketFrame.Ping()` every `20 s`, and `Main` raises Ember's idle timeout to `10 minutes` (from the 60-second default), which is what stopped idle tables from dying with `java.util.concurrent.TimeoutException`.

---

## 3. Frontend Architecture (`frontend/src/`)

### 3.1 Lichess 3-Column Shell & Deterministic 3x3 Table Grid
- **`GamePage.tsx`** renders three non-overlapping top-level CSS Grid columns:
  1. `[data-zone="sidebar-left"]`: How-to-Play reference card & hotseat player-switcher tabs.
  2. `[data-zone="table-arena"]`: The central felt table (`GameTable.tsx`).
  3. `[data-zone="sidebar-right"]`: Monospace digital turn clock (`00:XX`), the `PLAYERS` list with presence dots, the `TableDeck` (talon + horizontal trump + `TRUMP` badge) and the match winner/Durak badges.
- **`GameTable.tsx`** uses a 3-column x 3-row CSS Grid without freeform `position: absolute` layout:
  - **Row 1 (Clockwise Opponent Seats):** Computes relative seat offset `(seatIdx - myIdx + N) % N` to map opponents into `data-seat="top-left"`, `data-seat="top-center"`, and `data-seat="top-right"`.
  - **Row 2 (Defender-Anchored Battlefield):** Positions target outlines (`data-testid="target-outline-<playerId>"`), active `TablePair` cards, and the single-card SVG arrow reflection outline (`data-testid="redirect-outline"`) directly in front of the defending player's seat.
  - **Row 3 (Player Controls):** Places `[data-zone="player-hand"]` at `Col 2` and the client-side `SortBar` (`Suit` / `Pairs` / `Rank`) + contextual `Surrender` / `Pass` button at `Col 3`. The talon no longer sits on the felt: `TableDeck` renders in `sidebar-right` as a vertical deck with the horizontal trump sharing one grid cell (left edges aligned) and a `TRUMP` badge below it in normal flow.

### 3.2 Header Bar, Settings Store & Appearance Subsystems
- **`HeaderBar.tsx`:** Owns the brand link (inline SVG mark followed by the `LIDURAK` wordmark inside one `<a class="header-brand">`), the hover navigation menus, and the profile dropdown with its live connection tracker.
  - **In-place submenus:** `PROFILE_ITEMS` marks four rows (`Sound`, `Theme`, `Table`, `Card Back`) with a `SubmenuId`. Selecting one swaps the main list for `<div class="profile-submenu-panel">`, whose first child is a `button.submenu-header[data-testid="submenu-back"]` holding a left chevron and `SUBMENU_LABELS[id]`; activating it clears the submenu state. The connection tracker stays pinned to the bottom of the panel in both modes.
  - **Connection tracker:** `connectionLevel(pingMs)` maps latency to a 1–4 bar tier (`≤60`, `≤150`, `≤300`, else `1`). Labels render `PING` / `SERVER DELAY` with a lowercase `ms` unit. A `useEffect` keyed on the tier sets `connection-bars-updating` for 360 ms only when the tier changes, so the bars animate on change and sit still otherwise. The active bars are coloured by tier — green (`#2dc653`) for `level >= 3`, yellow (`#eab308`) for `2`, red (`#ef4444`) for `1` — exposed as `data-bar-color` on `.signal-bars` and on every `.signal-bar[data-active]`, with matching rules in `app.css`. The `lag-switch` range input (`0–500 ms`) overrides the reported ping through local state.
  - **Live felt previews:** every `Table` swatch receives `backgroundColor`, `backgroundImage` and `filter` from `getTableFilterCss(...)`, so the brightness/contrast/hue sliders repaint previews and the table together.
  - **Sound previews:** pack buttons audition a random effect from the chosen pack immediately. The volume slider is silent while dragging (`onInput` only stores the level via `setVolume` / `soundEngine.setVolume` and repaints the `%` readout); `onPointerUp` / `onMouseUp` / `onTouchEnd` call `soundEngine.playSampleSound(undefined, volume)`, deduplicated by a ref flag reset on the next tick so one gesture plays exactly one sample at the released volume.
- **`state/settings.ts`:** Tiny observable store (`getSettings`, `setSettings`, `subscribeSettings`, `useSettings`, `resetSettings`). `applySettings` writes `data-theme`, `data-table-texture`, `data-card-back` and the `--app-roundness`, `--table-felt(-overlay)`, `--table-texture-bg(-overlay)`, `--table-brightness`, `--table-contrast`, `--table-hue` and `--table-filter` custom properties on `<html>`; `initSettings()` keeps `Device theme` in sync with `prefers-color-scheme`.
- **`styles/tableTextures.ts`:** `TABLE_TEXTURES` holds six presets (`emerald-felt` is `DEFAULT_TABLE_TEXTURE_ID`), each with a base colour and layered CSS overlay. `textureFilter` / `getTableFilterCss` clamp and stringify `brightness() contrast() hue-rotate()`, and `tableTextureStyle` / `getTableTextureStyle` return the same values as an inline style object, which is what keeps previews and the arena identical.
- **`components/CardBack.tsx`:** `CARD_BACK_PATTERNS` holds the six monochrome pattern tiles, `COLORFUL_CARD_BACK_PATTERNS` the seven gradient designs, and `ALL_CARD_BACK_PATTERNS` drives the picker. Colourful backs render a three-stop `<linearGradient>` plus a motif tile (stripes, diamonds, rings, rays, sparkle, grid, waves); `CARD_BACK_LABELS` supplies display names. `CardBack` follows `settings.cardBack` when no `pattern` prop is given, so the header setting reaches every face-down card.
- **`app.css` (theme layer):** Dark tokens live on `:root`; `html[data-theme='light']` (plus a `prefers-color-scheme: light` fallback for `html:not([data-theme])`) redefines surfaces, panels, inputs, borders, text and accent colours. Lobby, game and panel rules consume `--app-panel`, `--app-input-bg`, `--app-border`, `--app-text` and `--app-text-strong` instead of hardcoded hex values, so every page, form, button and panel adapts to the chosen theme.

### 3.3 Interaction & Web Audio Subsystems
- **Magnetic Drag-Snap & Double-Click:** Pointer drag handlers compute Euclidean distance to valid drop zones, snapping a preview highlight when within `48px`. Double-clicking a hand card evaluates all legal actions for that card and dispatches immediately if and only if exactly one target/action is legal.
- **`SoundEngine.ts`:** Synthesizes procedural sound effects via the browser Web Audio API (card slap thuds at distinct pitches for attack/cover/redirect/surrender, player-specific page-turn brushes on talon draw, 5-second clock warning ticks, and a Lichess-style two-note game-over chime). Five packs (`SOUND_PACKS`) each voice every `SoundEvent`; `playSampleSound(pack?, volume?)` previews a random effect from `SAMPLE_EVENTS`, optionally through a one-off preview gain bus at the supplied volume, without mutating the persisted pack or volume.

### 3.4 Card Rendering (`components/Card.tsx`)
- `Card.tsx` draws every face in an inline SVG `viewBox="0 0 70 100"`. Number ranks map to fixed pip tables; aces get one large ornate pip; `J`/`Q`/`K` render a center letter at `(35, 50)` with `dominant-baseline="central"`.
- **Face pips (`class="card-pip face-pip"`):** `judge`-style corner tables place pips at the ends of the letter — `jack` = 3 (`top-left`, `top-right`, `bottom-left`), `queen` = 1 (`bottom-right`), `king` = 4 (all corners). Each pip carries `data-corner`, `data-rotation`, and `transform="rotate(angle x y)"`.
- **Outward rotation:** `facePipAngle(suit, corner)` returns `-45` / `45` / `135` / `-135` for hearts & clubs (distinguishing top half faces out) and the 180-degree opposite set (`135` / `-135` / `-45` / `45`) for spades & diamonds (bottom half faces out).

### 3.5 REST & WebSocket Client (`api/`)
- **`client.ts`:**
  - `createGame(playerCount, playerNames, allowRedirect, chaosMode, playerTypes?)` → `POST /api/game/create`; `playerTypes` (`'human' | 'randomBot'` per seat) defaults to all `'human'`.
  - `checkServerHealth()` → `GET /api/health`, resolving `true` for a 2xx response and `false` for any error, so the lobby can poll backend readiness.
  - `getGameView()` and `sendAction()` validate every payload with `parsePlayerGameView`.
- **`websocket.ts` (`GameWebSocket`):**
  - Validates each frame through `parsePlayerGameView` and ignores control/malformed frames (`{"type":"pong"}`, bare pings, empty payloads) without touching UI state.
  - Sends `{"type":"ping"}` every `20_000ms` while `OPEN` as an application-level heartbeat (the server also pushes a WebSocket `Ping` every 20 s and now allows a 10-minute idle timeout instead of Ember's 60-second default); the timer is cleared on close and `disconnect()`.
  - `sendPresence(isPresent)` emits `{"type":"presence", isPresent}`, queues the latest value until `onopen`, and re-sends it after an automatic reconnect.
  - Reconnects with 1s/2s/4s exponential backoff, at most three retries.
- **`types.ts` presence fields:** `PlayerType = 'human' | 'randomBot'`; `PublicPlayerSummary.isPresent` and `PlayerGameView.presentPlayers` are optional, validated by the parser when present.

### 3.6 Hand Layout, Felt Filters & Presence
- **Hand geometry (`GameTable.tsx`):** `handLayout(count, availableWidth, cursorFraction, cardWidth)` returns `{ overlap, visibleCount, hiddenLeft, hiddenRight }`. Overlap starts at `HAND_MIN_OVERLAP = 8px` and tightens only up to `cardWidth - max(12px, 28% of the card width)`, so the top-left rank/suit index stays readable; past that capacity the surplus stacks at 100% overlap on the ends. `handMargins()` turns the layout into per-slot negative margins, `.hand-slot[data-hidden='true']` drops behind the visible row (`z-index: 0`, no pointer events), and pointer movement across `.hand-cards` moves cards between the hidden left/right stacks. `handOffsets()`/`handMargins()` never wrap: `.hand-cards` is `flex-wrap: nowrap`. Opponent seats use `opponentOverlap()` inside a fixed `208×32` row that reacts only to card count. Widths are measured with a `ResizeObserver` on the hand column, falling back to `HAND_FALLBACK_WIDTH` when layout is unavailable.
- **Felt layer:** the arena carries `data-texture` plus `--table-filter` from `useSettings()`, and `[data-zone='table-arena']::before` paints `--table-felt`/`--table-felt-overlay` across the whole grid while `filter: var(--table-filter)` applies brightness/contrast/hue to the surface only — cards stay untinted and match the header's live previews.
- **Presence:** `GamePage` tracks `document.hasFocus()` plus 30-second mouse/keyboard activity (`PRESENCE_IDLE_MS`), reports changes through `GameWebSocket.sendPresence`, and renders `presence-dot` in every `PLAYERS` row from `PlayerGameView.presentPlayers`, `PublicPlayerSummary.isPresent`, or the local activity state for the viewer. Dots are green (`--durak-accent`) when present and grey otherwise.
- **Frozen clocks:** `viewerOnClock` compares `turnPlayerId` with `myId`; the right-sidebar clock renders `00:15` with `data-active="false"` unless the viewer is the timed player, while each seat and hand clock shows its own player's remaining seconds.
### 3.7 Lobby Readiness & Seat Types (`pages/LobbyPage.tsx`, `app.tsx`)
- **App shell:** `App` renders `<HeaderBar />` directly above the routed page with no `<h1 class="app-title">` — the `LIDURAK` brand link already titles every page, so the duplicate heading is gone.
- **Readiness gate:** `LobbyPage` probes `checkServerHealth()` (i.e. `GET /api/health`) on mount and then every `1000 ms` until it succeeds. While the backend is not ready it renders the themed `.server-loading-page` block (`data-testid="server-loading"`, `role="status"`, message `Starting game server, please wait…`) instead of the form, so no click can reach a proxy `HTTP 500`; the poll unlocks the form on its own once the server answers.
- **Warm-up recovery:** a `createGame(...)` failure that looks like a booting backend — an `HTTP 500` / `502` / `503` / `504` message or a `TypeError` from `fetch` — drops the lobby back into the loading state and re-polls instead of showing an error banner. Any other failure (for example an unsupported player count) still renders `.error-banner`.
- **`initialServerReady?: boolean` prop:** starts the lobby unlocked and skips the probe; tests and caller-known server state use it, the app itself leaves it unset.
- **Seat types:** `playerTypes` state mirrors the seats (`['human', 'human']` initially), stays length-matched when the count changes and preserves earlier choices, and is passed as the fifth `createGame(...)` argument. Every player row renders its name `<input>` plus a `<select data-testid="player-type-<index>" aria-label="Player <n> type">` offering `Human` / `RandomBot` (`human` / `randomBot` values, matching the backend's `GameConfig.playerTypes`).
- **Theming:** every lobby element uses the shared token-driven classes (`lobby-form`, `field`, `name-fields`, `checkbox-field`, `.server-loading-page`, `created-game`, `player-tabs`, `error-banner`), so the Create a Game page follows `html[data-theme='light']` without page-specific colour overrides.
