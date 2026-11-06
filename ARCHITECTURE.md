# Lidurak Technical Architecture

Lidurak is a full-stack, real-time multiplayer implementation of **Durak** built with a **Scala 3** backend (`Cask` + actor concurrency) and a **TypeScript / Preact** frontend styled with a zero-overlap **CSS Grid** layout system.

---

## 1. Repository Directory Structure

~~~text
.
├── play-local.sh                 # Concurrent local launcher for backend (:8080) and frontend (:5173)
├── README.md                     # Public user & developer documentation
├── ARCHITECTURE.md               # Technical architecture & protocol reference
├── backend/
│   ├── build.sbt                 # Scala 3.3.3 build definition (Cask, Castor, uPickle, MUnit)
│   └── src/
│       ├── main/scala/durak/
│       │   ├── engine/           # Pure functional Durak state machine & domain model
│       │   │   ├── Card.scala
│       │   │   ├── Deck.scala
│       │   │   ├── GameAction.scala
│       │   │   ├── GameConfig.scala
│       │   │   ├── GameEngine.scala
│       │   │   └── GameState.scala
│       │   ├── bot/              # Automated AI players (RandomBot, BasicBot)
│       │   │   ├── BasicBot.scala
│       │   │   ├── BotPlayer.scala
│       │   │   └── RandomBot.scala
│       │   └── server/           # Actor runtime, REST endpoints, WebSocket broadcaster & presets
│       │       ├── DebugPresets.scala
│       │       ├── GameActor.scala
│       │       ├── GameManager.scala
│       │       ├── JsonCodecs.scala
│       │       ├── PlayerGameView.scala
│       │       ├── Routes.scala
│       │       └── Server.scala
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
        │   ├── SiteHeader.tsx    # Top navigation bar, profile submenus & ping tracker
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

The core game logic resides in `durak.engine` and is implemented as a purely functional, deterministic state machine with zero I/O or framework dependencies.

### Domain Model
- **`Suit` & `Rank` (`Card.scala`):**
  - Four suits (`Clubs`, `Diamonds`, `Hearts`, `Spades`) and thirteen ranks (`Two` through `Ace`).
  - Matches with 2 or 3 players use a 36-card deck (`Six` through `Ace`); 4-player matches use a 52-card deck (`Two` through `Ace`).
- **`TablePair` (`GameState.scala`):**
  - Represents an attacking card and its optional covering card (`attack: Card`, `cover: Option[Card]`).
- **`BoutPhase` (`GameState.scala`):**
  - `Attacking`: Active bout where the defender may cover uncovered attacks or reflect (`Perevod`), and eligible attackers may throw in matching ranks once at least one attack card is on the table.
  - `SurrenderThrowIn`: The defender has declared surrender; no further covers or reflections are possible, and eligible attackers may throw in additional matching cards (up to the defender's initial hand capacity, max 6 pairs) before the defender picks up all table cards.
  - `GameOver`: Terminal phase reached when at most one player with cards remains after the talon is exhausted.
- **`GameConfig` (`GameConfig.scala`):**
  - Configures player count (`2..4`), deck size, `allowRedirects` (`Perevod`), `chaosMode` (free opening target selection + seeded random reflection receiver in 3P/4P), `transparentMode` (all opponent hands revealed in views), `devMode` (permits live POV switching across seats), and `turnTimeoutMs` (`15000 ms` default).
- **`GameState` (`GameState.scala`):**
  - Immutable snapshot containing `players: Vector[PlayerState]`, `deck: Vector[Card]`, `trumpCard: Card`, `trumpSuit: Suit`, `attackerIndex: Int`, `defenderIndex: Int`, `tablePairs: Vector[TablePair]`, `boutPhase: BoutPhase`, `passedPlayers: Set[String]`, `discardCount: Int`, `lastDiscardedBout: Vector[Card]`, `winners: Vector[String]`, `durak: Option[String]`, and `rngSeed: Long`.

### State Transitions (`GameEngine.scala`)
`GameEngine.applyAction(state: GameState, action: GameAction): Either[GameError, GameState]` validates and executes every move:
1. **`Attack(playerId, card, targetIdOpt)`:**
   - Valid only when `tablePairs.isEmpty` and `playerId` is the current attacker.
   - In standard mode, the defender is strictly the next clockwise active player. In **Chaos Mode**, the attacker may specify any active player holding cards via `targetIdOpt`.
2. **`CoverCard(playerId, card, targetIndex)`:**
   - Valid in `BoutPhase.Attacking` when `playerId` is the current defender and `tablePairs(targetIndex)` is uncovered.
   - `card` must beat the attack card (higher rank of the same suit, or any trump card if the attack card is non-trump).
   - Clears `passedPlayers` so attackers can react to the newly played cover card's rank.
3. **`RedirectAttack(playerId, card)` (`Perevod`):**
   - Valid in `BoutPhase.Attacking` when `allowRedirects` is enabled, `tablePairs.nonEmpty`, **all** pairs on the table are currently uncovered, and `card.rank` matches the rank of the attacking cards on the table.
   - The receiving player (next clockwise active player in standard mode, or a deterministically drawn active player other than the defender in Chaos Mode) must hold at least `tablePairs.length + 1` cards.
   - Appends `TablePair(card, None)` and advances `attackerIndex` / `defenderIndex` to the new roles.
4. **`ThrowIn(playerId, card)`:**
   - Valid in `BoutPhase.Attacking` or `BoutPhase.SurrenderThrowIn` when `tablePairs.nonEmpty`, `playerId` is not the defender, `card.rank` matches any attack or cover card currently on the table, `tablePairs.length < 6`, and the number of uncovered pairs is less than the defender's remaining hand size.
5. **`Surrender(playerId)`:**
   - Valid in `BoutPhase.Attacking` when `playerId` is the defender and at least one uncovered card is on the table.
   - Transitions `boutPhase` to `SurrenderThrowIn` (or immediately resolves pickup if no other active player can legally throw in further cards).
6. **`Pass(playerId)`:**
   - Marks an attacking/throwing player as having passed (`passedPlayers += playerId`).
   - Once all eligible attackers have passed (or have no legal throw-in cards left):
     - If in `BoutPhase.Attacking` and all pairs are covered, the bout cards move to the discard pile (`lastDiscardedBout` is updated with the bout's cards, `discardCount` increments), players draw from the talon up to 6 cards (attackers in order, then defender), and the defender becomes the next bout's initial attacker.
     - If in `BoutPhase.SurrenderThrowIn`, the defender picks up all cards on the table, attackers replenish from the talon up to 6 cards, and the turn advances clockwise past the surrendering defender.
7. **Endgame Elimination & Durak Resolution:**
   - Whenever the talon is empty and a player's hand reaches `0` cards, that player is appended to `winners` (and assigned a 1-based `finishRank`).
   - When `<= 1` player still holds cards, `boutPhase` transitions to `GameOver` and the sole remaining card-holder (if any) is recorded in `durak`.

---

## 3. Bot AI Subsystem (`durak.bot`)

Automated seats execute inside the server actor loop using pure strategy functions over `GameState`:
- **`RandomBot` (`RandomBot.scala`):**
  - Computes the complete list of legal `GameAction`s for its seat and picks one uniformly at random.
  - Paced by `GameActor.DefaultRandomBotDelay` (`200 ms`) after an initial `GameActor.DefaultInitialBotStartDelay` (`2.0 s`) at match creation.
- **`BasicBot` (`BasicBot.scala`):**
  - Paced by a randomized `500 ms`–`2000 ms` delay to mimic human cadence.
  - **Opening Attack:** Selects the lowest-ranked non-trump card in hand; falls back to the lowest trump only when holding all trumps.
  - **Defense:** Prefers reflecting (`RedirectAttack`) with a non-trump card if legal, otherwise covers each uncovered attack using the lowest-ranking legal same-suit card (or lowest trump if required). Surrenders only when no legal cover or reflection exists.
  - **Throw-In:** Throws in non-trump cards matching table ranks (lowest rank first) and passes rather than expending trumps.

---

## 4. Server Actors & REST / WebSocket Protocol (`durak.server`)

### Actor Concurrency (`GameActor.scala` & `GameManager.scala`)
- **`GameManager`:** Thread-safe registry mapping `gameId -> GameActor` instances, managing room lifecycle, WebSocket session subscriptions, and scenario presets.
- **`GameActor`:** Serializes all state mutations for a single match:
  - Processes incoming player actions, schedules bot turns, and runs the `15s` turn countdown timer.
  - Records every state transition in `history: Vector[GameState]`, enabling full post-game move replay.
  - Broadcasts tailored `PlayerGameView` payloads over WebSocket to each connected client after every state change or clock tick.

### Perspective Filtering & Access Control (`PlayerGameView.scala`)
- `PlayerGameView.fromState` projects a `GameState` for a specific `viewerId`:
  - Reveals the viewer's own hand (`myHand`) and status fields (`myHasPassed`, `myFinishRank`).
  - Conceals opponent hand cards (`cards: None`, exposing only `cardCount`) unless `config.transparentMode` is enabled or `boutPhase == BoutPhase.GameOver` (or replay inspection is active), in which case opponent `cards` are included for low-detail rendering or post-game review.
  - Enforces **POV Lock Security**: when `config.devMode == false` and `boutPhase != BoutPhase.GameOver`, any HTTP or WebSocket request where `requester != playerId` is rejected with `403 Forbidden`.

### HTTP & WebSocket Endpoints (`Routes.scala`)
- `GET /api/health` — Returns `{"status":"ok","serverTime":...}` for lobby readiness gating and client RTT ping measurement.
- `POST /api/games` — Creates a match with player names, seat types (`Human`, `RandomBot`, `BasicBot`), and variant flags (`allowRedirects`, `chaosMode`, `transparentMode`, `devMode`).
- `POST /api/debug/preset/:presetId` — Instantiates deterministic mid-game or endgame states (`surrender-half-off`, `3p-redirect-bob`, `chaos-4p`, `transparent-mode`, `defenseless-surrender`, `endgame-durak`, etc.).
- `GET /api/games/:gameId/view?playerId=<seat>&requester=<seat>` — Returns the current `PlayerGameView` JSON (including `replayFrames` once the match ends).
- `POST /api/games/:gameId/action` — Submits a player move (`attack`, `cover`, `redirect`, `throwIn`, `surrender`, `pass`).
- `POST /api/games/:gameId/rematch` — Creates a fresh match preserving the room's player and variant configuration.
- `WS /ws/games/:gameId?playerId=<seat>&requester=<seat>` — Pushes real-time `PlayerGameView` snapshots and clock synchronization frames.

---

## 5. Frontend Architecture (`frontend/src`)

### Zero-Overlap 3-Column Shell & 3x3 Felt Grid (`GamePage.tsx`, `table.css`)
The desktop game view (`GamePage.tsx`) uses a strict CSS Grid layout with zero `position: absolute` or `position: fixed` overlap between structural zones:
1. **Left Sidebar (`[data-zone="sidebar-left"]`):**
   - **`PLAYERS` Panel (`[data-testid="players-panel"]`):** Top-most sidebar box. Each row (`li.status-badge`) is a 3-column grid (presence dot + name, centered `N cards` count, and right-aligned status tag `WINNER` / `OUT` / `PASSED` / `DURAK`) that also acts as the POV selector when `devMode` is enabled or after `Game Over`.
   - **Scenario Presets & How to Play:** Interactive preset triggers and rules summary.
   - **`REPLAY CONTROLS`:** Post-game move stepper (`‹`, `›`, and keyboard arrow navigation).
2. **Center Arena Column (`[data-zone="table-arena"]` + `SortBar`):**
   - **Row 1 (Opponent Seats):** `data-seat="top-left"`, `data-seat="top-center"`, and `data-seat="top-right"`. Relative seat placement is computed by `assignSeats` (`seating.ts`) using the clockwise offset `(seatIdx - myIdx + N) % N` from the viewed seat (`bottom`), ensuring seats, target outlines, bout card placement, surrender directions, and reflection arrows rotate together when switching POV.
   - **Row 2 (Statically Centered Battlefield):** `.battlefield-tinted-box` occupies the center cell at a fixed table-relative footprint.
     - **Target Outlines (`[data-testid="target-outline-<id>"]`):** Anchored near the edge/corner of each legal target opponent before the opening attack.
     - **Bout Cards (`.table-pairs-group`):** Single-row flex container (`flex-wrap: nowrap`) anchored near the defender's seat edge/corner. `computeBoutLayout` (`boutLayout.ts`) calculates per-slot horizontal overlap so up to 6 pairs + throw-in outline + reflection outline fit on a single row while keeping at least `22px` of every card's left index visible.
     - **Throw-In Outline (`[data-testid="throw-in-outline"]`):** Pinned to the exact `100px × 140px` card footprint (`48px × 68px` below `900px`). Renders inline to the right of `.table-pairs-group` during normal play. When a player surrenders and `.table-pairs-group[data-surrendered="true"]` slides half-off the top or bottom border of `.battlefield-tinted-box`, the throw-in outline renders inside `.surrender-throw-in-anchor` (`data-placement="below"` for a top opponent surrender, `data-placement="above"` for a bottom player surrender) so it stays 100% inside the shaded battlefield.
     - **Reflection Outline (`[data-testid="redirect-outline"]`):** Card-sized violet outline with a directional SVG arrow pointing toward the seat that will receive the reflected attack.
   - **Row 3 (Player Hand & Actions):**
     - **Player Hand (`[data-zone="player-hand"]` / `.hand-cards`):** Inline-flex container that tightly wraps the `100px × 140px` hand cards and renders the single turn-highlight aura (`attacker`, `throw-in`, or `defender`). `computeHandLayout` (`handLayout.ts`) enforces at least `10px` (10%) default card overlap and smoothly increases overlap as the hand grows.
     - **Pointer-Driven Drag & Two-Stage Hand Reordering:** Uses pointer events (`pointerdown` / `pointermove` / `pointerup`) with native HTML5 drag disabled so `cursor: pointer` is preserved across the entire screen (`data-dragging="true"`). Lifting a card collapses its wrapper (`data-collapsed="true"`, `data-gap-closed="true"`) so the remaining cards close the gap immediately; dragging across `.hand-cards` parts adjacent cards (`data-part-direction="left" | "right"`, `translateX(±22px)`) at the target insertion index. Releasing over the hand commits the custom order and switches `SortBar` to `Custom`; releasing over a `[data-drop-zone]` target (with `48px` magnetic snap) submits the corresponding game action.
     - **Action Cell:** Renders contextual `Surrender` (including the 3-second auto-surrender countdown when defenseless) and `Pass` buttons.
   - **`HAND SORTING` Bar (`SortBar.tsx`):** Placed in normal flow directly beneath `[data-zone="table-arena"]`, rendering `<select data-testid="sort-select">` with `Suit`, `Pairs`, `Rank` (default), and non-persistent `Custom`.
3. **Right Sidebar (`[data-zone="sidebar-right"]`):**
   - **Split Clock Panel:** Elapsed `Game` timer (`mm:ss`) above the `Turn` countdown (`00:XX`), highlighting only the Turn half during its final 5 seconds (`00:05`–`00:01`).
   - **`DECK` & Discard Pile:** Talon stack with top-left count oval, perpendicular trump card, `TRUMP` suit pill, and the two-part discard pile (`discard-facedown-stack` on the left overlapped by the responsive `discard-visible-row` showing `lastDiscardedBout`).
   - **Match Results:** Displays `Winners`, `Durak`, and the `Rematch` action once `boutPhase == "GameOver"`.

### Semantic Theme & Highlight System (`settings.ts`, `app.css`, `table.css`)
`settings.ts` persists `UserSettings` in `localStorage` and writes CSS custom properties onto `:root`:
- **Six Non-Overlapping Color Families:**
  - `--ui-select-*`: Cobalt blue UI selection chrome.
  - `--role-attacker-*`: Emerald green attacker rows, seats, hand glow, target/throw-in outlines, and `Pass` button.
  - `--role-defender-*`: Crimson red defender rows, seats, hand glow, uncovered attack card pulse, and `Surrender` button.
  - `--trump-*`: Gold/bronze `2px` border on `.playing-card.trump-card` and `low-detail-trump` mini-cards.
  - `--redirect-*`: Violet reflection outline and directional arrow.
  - `--clock-urgent-*`: Orange-amber low-time alert (`<= 5s`).
- **Palette Calibration & Live Glow Scaling:**
  - All six presets (`Classic`, `Warm`, `Cool`, `Neon`, `Pastel`, `Royal`) define distinct token tables for `Dark` and `Light` modes (with softer, lower-saturation mid-tones in `Light`).
  - `--highlight-intensity-scale` (`0.2` to `2.0`) multiplies box-shadow radii and glow alphas across seat boxes, player rows, hand outlines, and table targets.
  - Smooth continuous keyframe animations (`turnPulse`, `lightUncoveredPulse`, `attackerPulse`, `defenderHandPulse`, `throwInPulse`) maintain identical shadow layer counts across `0%/100%` and `50%` keyframes, while `TablePair` keys by `suit:rank` so WebSocket updates never remount active animations.
