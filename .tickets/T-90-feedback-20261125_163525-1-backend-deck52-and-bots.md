<!-- WAVE:1 -->
# Ticket T-90-1: Backend Support for 52-Card (<4P) Deck Setting, Multiplayer RandomBot/BasicBot Rooms, Instant Bot Pairing & All-Bot Spectator Mode

## Scope & File Ownership (WAVE 1 — Backend Only)
You own **ONLY `backend/**`** in this wave. Do **NOT** touch `frontend/**`, `README.md`, `ARCHITECTURE.md`, `agent-orchestration/`, or host scripts.

### Primary Files to Inspect & Update
- `backend/src/main/scala/durak/engine/GameConfig.scala`
- `backend/src/main/scala/durak/engine/Deck.scala`
- `backend/src/main/scala/durak/engine/GameEngine.scala`
- `backend/src/main/scala/durak/engine/PlayerGameView.scala`
- `backend/src/main/scala/durak/engine/JsonCodecs.scala`
- `backend/src/main/scala/durak/rooms/RoomModels.scala`
- `backend/src/main/scala/durak/rooms/RoomManager.scala`
- `backend/src/main/scala/durak/lobby/QuickPairingService.scala`
- `backend/src/main/scala/durak/http/MultiplayerRoutes.scala`
- `backend/src/main/scala/durak/http/QaPresetRoutes.scala`
- `backend/src/main/scala/durak/protocol/PlayerGameView.scala`
- `backend/src/main/scala/durak/protocol/ProtocolCodecs.scala`
- `backend/src/test/scala/durak/engine/DeckSuite.scala`
- `backend/src/test/scala/durak/engine/GameInitSuite.scala`
- `backend/src/test/scala/durak/rooms/RoomManagerSpec.scala`
- `backend/src/test/scala/durak/lobby/QuickPairingServiceSpec.scala`
- `backend/src/test/scala/durak/http/MultiplayerRoutesSpec.scala`

## Technical Implementation Requirements

### 1. 52-Card Deck Setting for `< 4` Players (`ITEM-6a`)
1. **`GameConfig` (`backend/src/main/scala/durak/engine/GameConfig.scala`):**
   - Add `deckSize: Option[Int] = None` as a trailing defaulted parameter on `GameConfig` so all existing callers remain source-compatible.
   - Add `def effectiveDeckSize: Int = if playerCount == 4 then 52 else deckSize.getOrElse(36)`.
2. **`Deck` & `GameEngine` (`Deck.scala`, `GameEngine.scala`):**
   - Keep `Deck.forPlayerCount(n: Int)` unchanged so existing tests pass.
   - Add `Deck.forConfig(config: GameConfig): Vector[Card]` (or `Deck.forGame(playerCount: Int, deckSize: Option[Int]): Vector[Card]`):
     - Validate `playerCount` is `2`, `3`, or `4`.
     - Validate `deckSize.forall(d => d == 36 || d == 52)` (throw `IllegalArgumentException` otherwise).
     - Validate `!(playerCount == 4 && deckSize.contains(36))` (4-player games always require 52 cards; throw `IllegalArgumentException` if `Some(36)` is explicitly passed for 4 players).
     - Return `Deck.standard52` when `playerCount == 4 || deckSize.contains(52)`, otherwise `Deck.standard36`.
   - Update `GameEngine.createGame` to shuffle `Deck.forConfig(config)` instead of `Deck.forPlayerCount(playerCount)` and validate `config` deck size in `GameEngine.validate`.
   - For a 2P 52-card game with 6-card hands, `talon.size` must be `40`; for a 3P 52-card game with 6-card hands, `talon.size` must be `34`.
3. **Room, Quick-Pairing, Protocol & QA Preset Wiring:**
   - Extend room creation models (`RoomModels.scala` / `MultiplayerRoutes.scala` `POST /api/games`) to accept optional `deckSize: Option[Int]` (`36` or `52`), returning HTTP `400` on invalid values (e.g., `deckSize = 40` or `playerCount = 4, deckSize = 36`).
   - Expose `deckSize: Int` (`36` or `52`) on `LobbyRoomSummary` (and `ProtocolCodecs`) so public pool tables advertise their deck size.
   - Extend `QuickPairingService.scala` and `MultiplayerRoutes.scala` (`POST /api/quick-pair`) to accept optional `deckSize: Option[Int]` (resolved to `52` for 4P, `36` default or `52` explicit for 2P/3P). Include `effectiveDeckSize` in the quick-pairing queue bucket key so `2P 15s 36-card` and `2P 15s 52-card` seekers NEVER cross-match, and pass `deckSize` when creating the matched room.
   - Update `QaPresetRoutes.scala` (`POST /api/qa/presets/quick-pair-opponent`) so that when a human player is queued in any quick-pair bucket (including 52-card 2P or 3P buckets), triggering the QA quick-pair opponent preset pairs into that exact bucket (`playerCount`, `turnTimeoutSeconds`, `allowRedirect`, `deckSize`) so human testers can verify 52-card quick pairing in < 15 seconds.

### 2. Multiplayer `RandomBot` & `BasicBot` Rooms, Instant Bot Quick-Pairing & All-Bot Spectator Mode (`ITEM-7a`)
1. **Instant Bot Quick-Pairing (`POST /api/quick-pair` in `MultiplayerRoutes.scala` & `QuickPairingService.scala`):**
   - Extend `QuickPairRequest` to accept optional `botOpponent: Option[String]` (accepting `"randomBot"` or `"basicBot"`, case-insensitive via `GameConfig.canonicalSeatType`; return HTTP `400` if `botOpponent` is non-empty and not a valid bot type).
   - When `botOpponent` is defined:
     - Do **NOT** enqueue anything into the human waiting queues (bots must NEVER match against normal human quick-pair seekers).
     - Immediately create and start a room via `RoomManager` with `playerCount` seats where Seat `0` is the human caller (`"human"`) and Seats `1 .. playerCount - 1` are all set to that bot (`"randomBot"` or `"basicBot"`), returning HTTP `200` with the immediate matched payload (`status = "matched"`, `gameId`, `seatIndex = 0`).
2. **Per-Seat Bot Configuration & Dev Spectator Mode in `POST /api/games` (`MultiplayerRoutes.scala`, `RoomModels.scala`, `RoomManager.scala`):**
   - Parameterize `RoomManager.create[F[_]](..., botMoveDelay: FiniteDuration = 500.millis, devMode: Boolean = true)` (keep defaults `500.millis` and `devMode = true` in `Main.scala`, while unit tests can pass `botMoveDelay = 20.millis` and test both `devMode = true` and `devMode = false`).
   - Extend `POST /api/games` request JSON to accept optional:
     - `seatTypes: Option[Vector[String]]` (if defined, must have length `== playerCount`, with each element validated as `"human"`, `"randomBot"`, or `"basicBot"`; otherwise return HTTP `400`).
     - `creatorSeatIndex: Option[Int]` (optional explicit seat index for the creator; `null`/omitted when `spectateAsCreator` is true or all seats are bots).
     - `spectateAsCreator: Option[Boolean]` (default `false`).
   - **Creator Lock vs Dev All-Bot Spectator Logic:**
     - Let `allBots = normalizedSeatTypes.forall(GameConfig.isBotType)` or `spectateAsCreator.contains(true)`.
     - If `allBots`:
       - When `devMode == false` (production mode), reject with HTTP `400 Bad Request` (`"Creator must occupy a seat"`).
       - When `devMode == true` (dev mode) and `normalizedSeatTypes.forall(GameConfig.isBotType)`:
         - Do **NOT** seat the creator in any player seat (`seatIndex = None`, `role = "spectator"` in the `POST /api/games` JSON response — keep existing fields intact and encode `seatIndex` as `null` plus `"role": "spectator"` when spectating, or numeric `seatIndex` plus `"role": "player"` when seated).
         - Pre-populate all seats with their configured bots (`RandomBot` / `BasicBot`, using clear display names such as `"RandomBot"` / `"BasicBot"` or `"BasicBot 1"`, `"BasicBot 2"`, `"BasicBot 3"` when multiple bots share a type), start the `GameState` immediately, and start the async bot turn loop!
     - If not `allBots`:
       - Determine the creator's seat (`creatorSeatIndex.getOrElse(normalizedSeatTypes.indexOf(GameConfig.HumanSeat))`), validating it is within `0 until playerCount` and has type `"human"` (return HTTP `400` otherwise).
       - Pre-populate every bot seat (`GameConfig.isBotType(normalizedSeatTypes(idx))`) immediately as occupied/ready.
       - Compute open seats in `LobbyRoomSummary` strictly from unoccupied `"human"` seats.
       - If `0` open `"human"` seats remain upon creation (e.g., 1 human creator + bots), deal and start the `GameState` immediately (with `config = GameConfig(..., playerTypes = normalizedSeatTypes, deckSize = deckSize)`), returning `{ gameId, seatIndex: <creatorSeat>, role: "player", ... }`.
       - If `>= 1` open `"human"` seats remain (e.g., 1 human + 1 `BasicBot` + 1 open human seat), wait until joining humans fill the remaining `"human"` seat(s), then immediately deal and start the game!
3. **Asynchronous Bot Turn Execution Across All Bout Phases (`RoomManager.scala`):**
   - Inspect `backend/src/main/scala/durak/server/GameActor.scala` to follow the exact Milestone 1 conventions for `RandomBot` and `BasicBot`.
   - Whenever a room has an active `GameState` (`!state.isGameOver`) and `state.promptedPlayerSeats` contains at least one bot seat (`state.config.isBotSeat(seatIdx)`):
     - **CRITICAL:** Check `state.promptedPlayerSeats` (NOT just `state.turnPlayerIdx`!), so bots also act promptly during throw-in / `PassTurn` windows (`BoutPhase.Defense` when all pairs are covered, and `BoutPhase.SurrenderThrowIn`).
     - Sleep `botMoveDelay` asynchronously on a background Cats Effect fiber, re-read the room's latest `GameState` atomically, pick a legal move via `BasicBot.chooseAction(state, botPlayerId)` for `"basicBot"` or `GameEngine.randomLegalAction(state, botPlayerId)` for `"randomBot"`, apply it via `GameEngine.applyAction`, reset/update turn deadlines if human players become prompted next, broadcast `gameViewUpdate` frames to all connected player and spectator WebSockets (`/ws/games/:gameId`), and loop until no bot seat is prompted or `state.isGameOver`.
4. **Spectator WebSocket Support for 2P, 3P, and 4P All-Bot Games (`durak.protocol.PlayerGameView`, `RoomManager.scala`):**
   - Ensure any non-seated WebSocket client (including the creator of a 2P, 3P, or 4P all-bot room) connecting to `/ws/games/:gameId` receives initial and subsequent `gameViewUpdate` broadcasts after every bot move, with `myHand = Nil`, `legalActions = Nil`, concealed talon/opponent card faces (unless `transparentMode`), and all 2, 3, or 4 seated players' public summaries (`id`, `name`, `cardCount`, `isTurn`, `status`, `finishRank`) included in `opponents` without throwing index errors.
   - Reject any gameplay action WebSocket message (`playAttack`, `coverCard`, `redirectAttack`, `throwInCards`, `declareSurrender`, `passTurn`) sent by a spectator connection with an error frame without mutating room state.

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-6a (Verbatim Requirement — "Implement as a game setting the option to play with all 52 cards even if there are less than 4 players. Add tiles on the homepage to play this mode with different player counts with this new setting. Do not include all variations - only three additional tiles should be created."):**
  - `GameConfig`, `Deck`, and `GameEngine.createGame` support playing with all 52 cards (`Deck.standard52`) when `playerCount` is `2` (`talon.size == 40`) or `3` (`talon.size == 34`), while defaulting `< 4` players to `36` cards and keeping `4` players on `52` cards.
  - `POST /api/games` (`MultiplayerRoutes`) and `RoomManager` accept `deckSize` (`36` or `52`), validate inputs (HTTP `400` on invalid deck sizes or `playerCount = 4` with `deckSize = 36`), and expose `deckSize` on `LobbyRoomSummary`.
  - `POST /api/quick-pair` (`QuickPairingService` & `MultiplayerRoutes`) separates queue buckets by `deckSize` (`36` vs `52`) and `POST /api/qa/presets/quick-pair-opponent` (`QaPresetRoutes`) matches waiting 52-card quick-pair entries so `< 15s` live QA verification succeeds.
- [ ] **ITEM-7a (Verbatim Requirement — "Implement the option to play with RandomBot and BasicBot. Three tiles should be added to the homepage tiles (for a total of 12, with Step 6 above): 2-player matches with BasicBot and RandomBot, and a 4-player match with all other players being BasicBot. Clicking these tiles should start the game immediately without waiting for additional players - the intuition is that the bot players are always counted as queued up for these types of games (but not for the normal game queue). Additionally include the option to add bot players into the Create a Game menu - the menu should have a section in which each seat at the table is selected to be either a human or a bot player. ... In production, the user creating the game will be locked in as one of the seats. However, for dev testing only, the user should also be able to start the game with all players being bots (i.e. deselect themselves as a player), in which case starting the game should send the user directly to the spectator mode in which they can watch the game freely but cannot interact with gameplay."):**
  - `POST /api/quick-pair` with `botOpponent` (`"randomBot"` or `"basicBot"`) immediately creates and starts a multiplayer match (`status: "matched"`, `seatIndex: 0`) without waiting for human players and without polluting normal human quick-pair queues.
  - `POST /api/games` accepts `seatTypes` (`"human"`, `"randomBot"`, `"basicBot"`), pre-populates bot seats, computes open seats from remaining `"human"` seats only, and starts immediately when zero open `"human"` seats remain.
  - When `devMode == false`, `POST /api/games` rejects all-bot / creator-unseated requests with HTTP `400`; when `devMode == true`, all-bot rooms start immediately with `seatIndex: null` and `role: "spectator"`.
  - `RoomManager` drives `RandomBot` and `BasicBot` moves asynchronously across all bout phases (`state.promptedPlayerSeats`), broadcasting live `gameViewUpdate` frames to players and spectators, and spectators cannot submit gameplay moves.
- [ ] **Mandatory Testing & Completion Protocol:**
  - Run `git status` and `git diff` first.
  - Add thorough unit/integration tests in `DeckSuite.scala`, `GameInitSuite.scala`, `RoomManagerSpec.scala`, `QuickPairingServiceSpec.scala`, and `MultiplayerRoutesSpec.scala` (including a full bot-vs-bot game advancing through multiple moves/completion over `RoomManager` with short test `botMoveDelay`, 52-card 2P/3P creation & quick-pair isolation, and `devMode = false` vs `devMode = true` all-bot validation).
  - Run `cd backend && sbt -batch test` and ensure **100% of tests pass**.
  - Write implementation summary to `.reviews/agent_notes.md` and run `echo "DONE" > .tickets/STATUS`.
