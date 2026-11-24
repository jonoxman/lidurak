# Lidurak Architecture

## 1. Repository Directory Tree

```text
.
├── play-local.sh                          # Local full-stack launcher (sbt backend + Vite frontend)
├── backend/
│   └── src/main/scala/durak/
│       ├── Main.scala                     # Cats Effect IOApp entrypoint & http4s Ember server
│       ├── engine/                        # Pure Scala 3 Durak rules engine & JSON codecs
│       │   ├── BasicBot.scala             # Heuristic bot selecting lowest non-trump plays
│       │   ├── BoutPhase.scala            # Bout state enum
│       │   ├── Card.scala                 # Card model & trump/suit cover logic
│       │   ├── Deck.scala                 # 36-card and 52-card deck builders
│       │   ├── GameAction.scala           # Player action ADT
│       │   ├── GameConfig.scala           # Match configuration & seat types
│       │   ├── GameEngine.scala           # Pure state transitions & legal move generation
│       │   ├── GameReplay.scala           # Deterministic move log, frozen views & verification
│       │   ├── GameState.scala            # Immutable match state & derived turn queries
│       │   └── JsonCodecs.scala           # Circe encoders/decoders for engine & view types
│       ├── server/                        # Local game orchestration & HTTP/WebSocket routes
│       ├── http/                          # Multiplayer & scenario preset HTTP/WebSocket routes
│       ├── lobby/                         # Quick-pairing matchmaking service
│       ├── rooms/                         # Multiplayer room lifecycle management
│       └── session/                       # In-memory session store & session routes
└── frontend/
    └── src/                               # Preact UI & CSS Grid table layout (served via Vite)
```

## 2. Scala 3 Engine State Machine (`durak.engine`)

The core game rules live in `durak.engine` as pure, immutable data structures and transition functions.

### Core Data Model

- **`Deck` & `Card`:** `Deck.forPlayerCount` selects `standard36` (ranks Six–Ace) for 2–3 players and `standard52` for 4 players. `Card.covers(attack, trumpSuit)` encodes legal cover rules (higher rank of the same suit, or any card of `trumpSuit` over a non-trump attack).
- **`GameConfig`:** Configures `playerCount`, `allowRedirect`, `seed`, `playerTypes` (`human`, `randomBot`, `basicBot`), `chaosMode`, `transparentMode`, and `devMode`.
- **`GameState`:** Holds `players: Vector[PlayerState]`, `talon`, `trumpSuit`, `bottomTrumpCard`, `discardPile`, `tablePairs: Vector[TablePair]`, `attackerIdx`, `defenderIdx`, `boutPhase`, `defenderInitialHandSize`, `finishOrder`, `isDraw`, `turnDeadlineMs`, `presentPlayers`, `lastDiscardCards`, `gameStartedAtMs`, and `gameEndedAtMs`.

### Bout Phase State Machine

`BoutPhase` defines five phases:

1. `InitialAttack`: The player at `attackerIdx` initiates a bout via `GameAction.InitialAttack`. Under standard rules the target is `defenderIdx`; when `chaosMode` is enabled, `GameEngine.eligibleInitialTargets` allows targeting other active players with cards.
2. `Defense`: The defender responds with `GameAction.CoverCard` (targeting an uncovered `TablePair`), `GameAction.RedirectAttack` (when `allowRedirect` is enabled, all table attacks are uncovered and share the redirect card's rank, and an eligible next defender has enough cards), or `GameAction.DeclareSurrender`. Other active players who have not passed may play `GameAction.ThrowInCards` or `GameAction.PassTurn`.
3. `SurrenderThrowIn`: Entered after `DeclareSurrender`, allowing non-defending active players to throw in matching-rank cards or pass before the defender picks up all table cards.
4. `BoutOver`: Transient resolution phase during bout cleanup, card draw from the talon, and role rotation (`nextActivePlayerIdx`).
5. `GameOver`: Terminal state once players finish in `finishOrder`; `GameState.durak` and `GameState.winners` expose the final standings (or `isDraw` when applicable).

### Derived Queries, Bots & Replay

- **Turn & Prompt Queries:** `GameState` computes `maxBoutAttacks` (`min(6, defenderInitialHandSize)`), `isThrowInPhase`, `promptedPlayerIds`, `turnPlayerIdx`, `canDefenderRedirect`, and `defenderIsDefenseless`.
- **Legal Action Generation:** `GameEngine.legalActions` filters candidate `GameAction` values through `GameEngine.applyAction` so validation is single-source-of-truth.
- **Bots:** `BasicBot.chooseAction` builds on `RandomBot.legalActionsFor`, prioritizing lowest-ranked non-trump cards across attacks, defenses, and throw-ins before falling back to trumps, surrenders, or passes.
- **Replay Verification:** `GameReplay` records `RecordedMove` and `ReplayFrame` entries (with `frozenViews` snapshots) into `SerializedGame`. `GameReplay.verifyReplay` replays every move sequentially through `GameEngine.applyAction` and asserts state equivalence (ignoring wall-clock timestamps and presence).
- **JSON Serialization:** `JsonCodecs` provides Circe codecs for `Suit`, `Rank`, `BoutPhase`, `Card`, `TablePair`, `PublicPlayerSummary`, and `PlayerGameView`.

## 3. Server, HTTP/REST & WebSocket Architecture (`durak.server` & Companion Packages)

`durak.Main` (`cats.effect.IOApp.Simple`) boots an `http4s` Ember server on `0.0.0.0:8080` with an `IdleTimeout` of 10 minutes and wires `WebSocketBuilder2[IO]` into `Main.httpApp`.

### Request Routing & Services

`Main.httpApp` composes five route modules:

- **`POST /api/games` Dispatcher (`sharedGameCreation`):** Inspects incoming JSON payloads for a `playerNames` field and delegates local game creation to `GameRoutes` (`durak.server`) or multiplayer game creation to `MultiplayerRoutes` (`durak.http`).
- **Local Engine Runtime (`durak.server.GameManager`, `durak.server.GameRoutes`):** Manages local/hotseat game state, turn-clock deadlines, bot execution, and client HTTP/WebSocket updates.
- **Multiplayer & Matchmaking (`durak.http.MultiplayerRoutes`, `durak.rooms.RoomManager`, `durak.lobby.QuickPairingService`):** Coordinates online multiplayer rooms, quick-pairing queues, and multiplayer game WebSocket/HTTP transport.
- **Sessions (`durak.session.SessionStore`, `durak.session.SessionRoutes`):** Maintains in-memory player session state across connections.
- **QA Scenario Presets (`durak.http.QaPresetRoutes`):** Exposes preset endpoints backed by `SessionStore` and `RoomManager` to jump directly into specific match states.

### Viewer Projection Protocol

Server updates project `GameState` per viewer into `PlayerGameView` (serialized via `JsonCodecs`):

- **Viewer State:** `myId`, `myName`, `myHand`, `myStatus`, `myHasPassed`, `myFinishRank`, `isBot`, and `legalActions`.
- **Table & Deck State:** `tablePairs`, `talonCount`, `bottomTrumpCard`, `trumpSuit`, `discardCount`, `lastDiscardCards`, `attackerIdx`, `defenderIdx`, `boutPhase`, and `maxBoutAttacks`.
- **Masked Opponents (`PublicPlayerSummary`):** Each opponent exposes `id`, `name`, `cardCount`, `hasPassed`, `finishRank`, `status`, `isTurn`, `isPresent`, and `cards` (populated when permitted, such as transparent/review modes).
- **Clock, Targeting & Results:** `turnPlayerId`, `turnDeadlineMs`, `turnSecondsRemaining`, `promptedPlayerIds`, `presentPlayers`, `defenderDefenseless`, `eligibleTargetIds`, `redirectTargetId`, `finishOrder`, `winners`, `durak`, `isDraw`, `gameStartedAtMs`, and `gameEndedAtMs`.

## 4. Preact & CSS Grid Frontend Architecture (`frontend/src`)

The frontend is a Preact application served in development by Vite on port `5173`.

### Three-Column `GamePage` Shell

`GamePage` uses CSS Grid and Flexbox with explicit gap spacing and `box-sizing: border-box` (avoiding `position: absolute` or `position: fixed` placement for seats, hands, bouts, or sidebars):

1. **Left Sidebar (`[data-zone="sidebar-left"]`):** Hosts the How to Play panel, scenario preset triggers, and local hotseat player-switcher tabs.
2. **Center Felt Table (`[data-zone="table-arena"]`):** A 3x3 CSS Grid felt surface (`#1e2923`):
   - **Row 1 (Opponents):** Opponent seats mapped to `data-seat="top-left"`, `data-seat="top-center"`, and `data-seat="top-right"`.
   - **Row 2 (Active Bout):** Attack/defense card pairs, defender-anchored attack target outlines (`data-testid="target-outline-<id>"`), and the single-card reflection outline (`data-testid="redirect-outline"`).
   - **Row 3 (Player Controls):** Column 1 renders the talon deck and face-up trump card (`[data-zone="table-deck"]`), Column 2 renders the active player's hand (`[data-zone="player-hand"]`), and Column 3 renders `SortBar` alongside contextual **Surrender** / **Pass** action buttons.
3. **Right Sidebar (`[data-zone="sidebar-right"]`):** Displays the digital `00:XX` turn countdown clock (`00:15` default) and end-of-match winner / Durak standings.
