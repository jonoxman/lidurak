# Lidurak Technical Architecture

Lidurak is a real-time multiplayer implementation of **Durak** built with a **Scala 3** backend (`http4s` Ember, Cats Effect, and Circe) and a **TypeScript / Preact** frontend styled with a zero-overlap **CSS Grid** layout system.

---

## 1. Repository Directory Structure

~~~text
.
├── play-local.sh                 # Concurrent local launcher for backend (:8080) and frontend (:5173)
├── README.md                     # Public user & developer guide
├── ARCHITECTURE.md               # Technical architecture & protocol reference
├── backend/
│   ├── build.sbt                 # Scala 3 build definition (http4s Ember, Cats Effect, Circe, MUnit)
│   └── src/
│       ├── main/scala/durak/
│       │   ├── Main.scala        # Ember HTTP/WebSocket server entry point (:8080)
│       │   ├── engine/           # Pure functional Durak state machine, domain model & bots
│       │   │   ├── BasicBot.scala
│       │   │   ├── BoutPhase.scala
│       │   │   ├── Card.scala
│       │   │   ├── Deck.scala
│       │   │   ├── GameAction.scala
│       │   │   ├── GameConfig.scala
│       │   │   ├── GameEngine.scala
│       │   │   ├── GameState.scala
│       │   │   ├── PlayerState.scala
│       │   │   ├── RandomBot.scala
│       │   │   ├── Rank.scala
│       │   │   ├── Suit.scala
│       │   │   └── TablePair.scala
│       │   └── server/           # Actor runtime, REST/WebSocket routes, projections & presets
│       │       ├── DebugPresets.scala
│       │       ├── GameActor.scala
│       │       ├── GameManager.scala
│       │       ├── GameRoutes.scala
│       │       ├── JsonCodecs.scala
│       │       └── PlayerGameView.scala
│       └── test/scala/durak/     # MUnit test suites for engine rules, bots, and HTTP/WS routes
└── frontend/
    ├── package.json              # Node/Vite/Preact/Vitest scripts and dependencies
    ├── vite.config.ts            # Vite dev server (:5173) & API/WS proxy to :8080
    └── src/
        ├── main.tsx              # Application entry point
        ├── app.tsx               # Root router & global theme/settings synchronization
        ├── api/                  # REST client & reconnecting WebSocket client
        ├── audio/                # Procedural Web Audio API synthesizer (5 sound packs)
        ├── components/           # Modular Preact UI components
        │   ├── Card.tsx          # SVG playing card face renderer (70x100 viewBox)
        │   ├── CardBack.tsx      # 13 SVG card-back patterns (monochrome & gradient)
        │   ├── HowToPlay.tsx     # Collapsible rules reference panel
        │   ├── SiteHeader.tsx    # Top navigation bar, profile submenus & latency tracker
        │   └── SortBar.tsx       # Below-table hand sorting dropdown (Suit/Pairs/Rank/Custom)
        ├── pages/
        │   ├── LobbyPage.tsx     # Match creation, bot/variant config & health gate
        │   └── GamePage.tsx      # 3-column Lichess shell, 3x3 felt grid, drag/drop & replay UI
        ├── state/
        │   └── settings.ts       # Persistent UserSettings, theme palettes & CSS variable writer
        ├── styles/
        │   ├── app.css           # Global theme tokens, header gradients, lobby & submenu styles
        │   └── table.css         # 3-column shell, 3x3 table arena, card & animation rules
        └── utils/
            ├── boutLayout.ts     # Single-row bout pair & outline overlap calculator
            ├── handLayout.ts     # Responsive hand & discard pile overlap calculator
            ├── legalMoves.ts     # Client-side move validation & target resolution
            ├── seating.ts        # Relative clockwise POV seat mapping
            └── sortHand.ts       # Hand sorting algorithms (Suit, Pairs, Rank, Custom)
~~~

---

## 2. Scala 3 Game Engine (`durak.engine`)

The core game logic resides in `durak.engine` and is implemented as a purely functional, deterministic state machine with zero I/O dependencies.

### Domain Model
- **`Suit`, `Rank` & `Card` (`Suit.scala`, `Rank.scala`, `Card.scala`):**
  - Four suits (`Clubs`, `Diamonds`, `Hearts`, `Spades`) and thirteen ranks (`Two` through `Ace`).
  - `Card.covers(attack: Card, trumpSuit: Suit)` centralizes cover legality (same suit with higher rank, or a trump card against a non-trump attack).
  - `Deck.forPlayerCount` generates a 36-card deck (`Six` through `Ace`) for 2–3 players and a 52-card deck (`Two` through `Ace`) for 4 players.
- **`TablePair` (`TablePair.scala`):**
  - Pairs an attacking card with its optional defense card (`attack: Card`, `defense: Option[Card]`).
- **`BoutPhase` (`BoutPhase.scala`):**
  - `InitialAttack`: Waiting for the current attacker to open the bout with one or more cards of equal rank.
  - `Defense`: Active bout where the defender may cover uncovered attacks, reflect (`RedirectAttack`), or declare surrender (`DeclareSurrender`), and attackers may throw in matching ranks (`ThrowInCards`) or pass (`PassTurn`).
  - `SurrenderThrowIn`: The defender has surrendered; eligible attackers may throw in additional matching cards up to the bout's capacity before the defender picks up the table cards.
  - `BoutOver`: Transient resolution phase when transitioning between bouts.
  - `GameOver`: Terminal phase reached when at most one active player with cards remains after the talon is empty.
- **`GameConfig` (`GameConfig.scala`):**
  - Holds immutable match configuration: `playerCount` (`2..4`), `allowRedirect` (`Perevod`), `seed`, `playerTypes` (`"human"`, `"randomBot"`, `"basicBot"`), `chaosMode`, `transparentMode`, and `devMode`.
- **`GameState` (`GameState.scala`):**
  - Immutable snapshot containing `config`, `players: Vector[PlayerState]`, `talon: Vector[Card]`, `trumpSuit: Suit`, `bottomTrumpCard: Option[Card]`, `discardPile: Vector[Card]`, `lastDiscardedBout: Vector[Card]`, `tablePairs: Vector[TablePair]`, `attackerIdx: Int`, `defenderIdx: Int`, `boutPhase: BoutPhase`, `defenderInitialHandSize: Int`, `passedPlayers: Set[String]`, and `finishOrder: Vector[String]`.

### State Transitions (`GameEngine.scala`)
`GameEngine.applyAction(state: GameState, action: GameAction): Either[String, GameState]` validates and executes all player moves:
1. **`InitialAttack(playerId, cards, targetPlayerId)`:**
   - Valid in `BoutPhase.InitialAttack` when `playerId` is the current attacker, `cards` are non-empty, all share the same rank, and `cards.size <= state.maxBoutAttacks`.
   - In standard mode, the attack targets the clockwise defender (`defenderIdx`). In **Chaos Mode**, the attacker may target any seat returned by `eligibleInitialTargets(state)`.
   - Transitions `boutPhase` to `BoutPhase.Defense`.
2. **`CoverCard(playerId, attackIndex, defenseCard)`:**
   - Valid in `BoutPhase.Defense` when `playerId` is the current defender, `tablePairs(attackIndex)` is uncovered, and `defenseCard.covers(pair.attack, state.trumpSuit)` is true.
   - Resets `passedPlayers` so attackers can throw in cards matching the newly played defense card's rank.
3. **`RedirectAttack(playerId, cards)` (`Perevod`):**
   - Valid in `BoutPhase.Defense` when `config.allowRedirect` is true, all pairs currently on the table are uncovered, and `cards` match the rank of the attacking cards on the table.
   - In standard mode, transfers defense to the next clockwise active player holding at least `tablePairs.size + cards.size` cards. In **Chaos Mode**, `deterministicRedirectTarget` selects an eligible opponent deterministically from the state seed so replays remain pure and reproducible.
4. **`ThrowInCards(playerId, cards)`:**
   - Valid in `BoutPhase.Defense` or `BoutPhase.SurrenderThrowIn` for non-defending active players when every card in `cards` matches a rank already present on the table and total attacks do not exceed `maxBoutAttacks` (capped by `6` and `defenderInitialHandSize`).
5. **`DeclareSurrender(playerId)`:**
   - Valid in `BoutPhase.Defense` when `playerId` is the defender and at least one attack card is uncovered.
   - Transitions the bout to `BoutPhase.SurrenderThrowIn` (or immediately resolves card pickup if no other player can legally throw in further cards).
6. **`PassTurn(playerId)`:**
   - Records that an attacking player has finished throwing in cards.
   - Once all eligible attackers have passed:
     - In `BoutPhase.Defense` (when all attacks are covered), table cards move to `discardPile` (updating `lastDiscardedBout`), players draw back up to 6 cards from `talon` in bout order, and the defender becomes the next attacker.
     - In `BoutPhase.SurrenderThrowIn`, the defender picks up all table cards, attackers draw back up to 6 cards from `talon`, and the turn advances clockwise past the surrendering defender.
7. **Endgame & Durak Resolution:**
   - Once `talon` is empty, players whose hands reach `0` cards are appended to `finishOrder`.
   - When one or zero players remain with cards, `boutPhase` transitions to `BoutPhase.GameOver`.

### Automated Bot Players (`RandomBot.scala`, `BasicBot.scala`)
- **`RandomBot`:** Enumerates all legal `GameAction`s for a seat via `GameEngine.legalActions` and picks uniformly at random.
- **`BasicBot`:** Shares `RandomBot.legalActionsFor` and applies tactical heuristics:
  - Opens attacks with its lowest-ranked non-trump card (using a random trump only when holding all trumps).
  - Always covers or reflects incoming attacks when a legal defense exists (preferring lowest non-trump cards first), surrendering only when no legal defense is available.
  - Throws in matching non-trump cards (lowest rank first) and passes rather than spending trump cards.

---

## 3. Server Actors & REST / WebSocket Protocol (`durak.server`)

### Concurrency & Actor Runtime (`Main.scala`, `GameManager.scala`, `GameActor.scala`)
- **`Main`:** Boots an `EmberServerBuilder` HTTP and WebSocket server on `0.0.0.0:8080` with a 10-minute idle timeout paired with WebSocket ping heartbeats.
- **`GameManager`:** Concurrent registry mapping `gameId -> GameActor` instances, managing game creation, debug presets, and active WebSocket subscriptions.
- **`GameActor`:** Cats Effect actor managing a single match's lifecycle:
  - Serializes all state transitions, turn-clock countdowns (`15s` default), defenseless auto-surrender timers (`3s`), and scheduled bot moves (`2.0s` initial match delay, `200ms` for `RandomBot`, and `500ms–2000ms` for `BasicBot`).
  - Appends every committed `GameState` to an in-memory history vector so completed games provide full step-by-step replay frames.
  - Publishes per-seat `PlayerGameView` snapshots to connected WebSocket clients whenever state or timer ticks occur.

### Perspective Projection & Security (`PlayerGameView.scala`)
- `PlayerGameView.fromState` projects `GameState` for a specific viewer (`playerId`):
  - Includes the viewer's own cards (`myHand`), legal actions, and role flags.
  - Masks opponent hands (`hand: Vector.empty`, exposing only `cardCount`) unless `config.transparentMode` is enabled or `boutPhase == BoutPhase.GameOver` (or during post-game replay).
  - Enforces **POV Lock**: when `config.devMode == false` and the match is still in progress (`boutPhase != BoutPhase.GameOver`), requests attempting to view or act as a seat other than the authenticated requester are rejected with `403 Forbidden`.

### HTTP & WebSocket Endpoints (`GameRoutes.scala`)
- `GET /api/health` — Readiness probe and server timestamp for client latency tracking.
- `POST /api/games` — Creates a new match with player names, seat types (`human`, `randomBot`, `basicBot`), and variant flags (`allowRedirect`, `chaosMode`, `transparentMode`, `devMode`).
- `POST /api/games/preset/:presetId` (and `/api/debug/preset/:presetId`) — Instantiates deterministic scenario states from `DebugPresets.scala`.
- `GET /api/games/:gameId` — Fetches the current `PlayerGameView` for `playerId` (including `replayHistory` when the game is over).
- `POST /api/games/:gameId/action` — Submits a move (`InitialAttack`, `CoverCard`, `RedirectAttack`, `ThrowInCards`, `DeclareSurrender`, `PassTurn`).
- `POST /api/games/:gameId/rematch` — Starts a new match with the same players and configuration.
- `WS /ws/:gameId?playerId=<seat>&requesterId=<seat>` — Real-time bidirectional WebSocket stream delivering `GameStateView` updates, clock ticks, and `Ping`/`Pong` latency frames.

---

## 4. Frontend Architecture (`frontend/src`)

### 3-Column Lichess Shell & 3x3 Felt Table (`GamePage.tsx`, `table.css`)
The desktop game layout uses CSS Grid and Flexbox with zero overlapping freeform positioning between structural zones:
1. **Left Sidebar (`[data-zone="sidebar-left"]`):**
   - **`PLAYERS` Panel:** Renders each seat in turn order with presence indicators, centered card counts, active attacker/defender glow, status badges (`WINNER`, `OUT`, `PASSED`, `DURAK`), and click-to-switch POV support (when `devMode` is enabled or after `GameOver`).
   - **Scenario Presets, How to Play & Replay Controls:** Provides 1-click preset triggers, rules reference, and post-game move-by-move replay navigation.
2. **Center Arena (`[data-zone="table-arena"]` & `SortBar.tsx`):**
   - **Row 1 (Opponent Seats):** `assignSeats` (`seating.ts`) maps opponents clockwise relative to the active bottom seat (`top-center` in 2P; `top-left` and `top-right` in 3P; `top-left`, `top-center`, and `top-right` in 4P).
   - **Row 2 (Battlefield):** Centered `.battlefield-tinted-box` anchoring bout cards and drop outlines (`target-outline-<id>`, `throw-in-outline`, `redirect-outline`) toward the defending seat. `computeBoutLayout` (`boutLayout.ts`) dynamically overlaps pairs in a single non-wrapping row so all card indices remain legible. When a defender surrenders, the table cards slide half-off the battlefield border toward the surrendering seat while keeping the throw-in outline anchored inside the battlefield.
   - **Row 3 (Player Hand & Contextual Actions):** `.hand-cards` wraps the active player's SVG cards with a single turn-role highlight aura. Custom pointer-event drag handling supports both two-stage in-hand card reordering (collapsing the lifted card's gap and parting hovered neighbors, automatically setting `SortBar` to `Custom`) and magnetic drop targeting onto table outlines or uncovered attack cards.
   - **Below-Table `HAND SORTING` Bar (`SortBar.tsx`):** Normal-flow dropdown supporting `Suit`, `Pairs`, `Rank` (default), and `Custom`.
3. **Right Sidebar (`[data-zone="sidebar-right"]`):**
   - **Split Digital Clock:** Displays total elapsed `Game` time (`mm:ss`) above the `Turn` countdown (`00:XX`), pulsing the turn clock during its final 5 seconds.
   - **Deck & Discard Pile:** Renders the vertical talon stack with remaining count badge, perpendicular bottom trump card, trump suit badge, and a two-part discard pile (face-down previous bouts beside the face-up cards from `lastDiscardedBout`).
   - **Match Results:** Displays ordered winners, the final Durak, and a `Rematch` button when the game finishes.

### Theme, Palette & Audio Subsystems (`settings.ts`, `audio/`, `components/`)
- **`settings.ts`:** Persists user preferences (`theme`, `roundness`, `highlightPalette`, `glowIntensity`, `tableTexture`, `tableBrightness`, `tableContrast`, `tableHue`, `cardBack`, `soundPack`, `volume`) in `localStorage` and synchronizes CSS custom properties on `:root` across six distinct semantic highlight roles (UI selection, attacker/throw-in, defender/uncovered/surrender, trump border, reflection arrow, and urgent turn clock) for both Dark and Light themes.
- **`Card.tsx` & `CardBack.tsx`:** Pure SVG card renderers featuring theme-adaptive card faces, symmetric pip grids, gilded `2px` trump borders, and 13 procedural monochrome and multi-stop gradient card backs.
- **`audio/`:** Zero-asset Web Audio API synthesizer generating real-time sound effects across five selectable sound packs.
