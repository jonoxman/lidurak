<!-- WAVE:1 -->
# Ticket T-90-1: Backend Engine & Server — Chaos Mode, Instant Surrender Auto-Pass, Replay Non-Move Filtering, Bot Input Lock, and QA Scenario Presets

## Scope & Files to Touch
- **Touch ONLY `backend/` files:**
  - `backend/src/main/scala/durak/engine/GameConfig.scala`
  - `backend/src/main/scala/durak/engine/GameAction.scala`
  - `backend/src/main/scala/durak/engine/GameEngine.scala`
  - `backend/src/main/scala/durak/engine/GameState.scala`
  - `backend/src/main/scala/durak/engine/PlayerGameView.scala`
  - `backend/src/main/scala/durak/engine/JsonCodecs.scala`
  - `backend/src/main/scala/durak/engine/RandomBot.scala`
  - `backend/src/main/scala/durak/engine/BasicBot.scala`
  - `backend/src/main/scala/durak/engine/GameReplay.scala`
  - `backend/src/main/scala/durak/server/GameActor.scala`
  - `backend/src/main/scala/durak/server/GameManager.scala`
  - `backend/src/main/scala/durak/server/GameRoutes.scala`
  - Backend test suites in `backend/src/test/scala/durak/...`
- **DO NOT touch `frontend/`, `README.md`, `ARCHITECTURE.md`, or `play-local.sh` in this ticket.**

---

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-CHAOS-1 (Backend Chaos Mode Engine Target Selection & Reflections):**
  > "Chaos Mode Engine Target Selection: Chaos mode should be implemented completely now. Make sure the UI is completely compatible - in Chaos mode, multiple players will have a card outline in front of them visible to the active user, for instance)."
  1. **`GameConfig.scala`**: Add `chaosMode: Boolean = false` to `GameConfig`.
  2. **`GameAction.scala` & `JsonCodecs.scala`**:
     - Update `GameAction.InitialAttack(cards: Vector[Card], targetPlayerId: Option[String] = None)` so an initial attack can optionally specify the target player's ID (e.g. `"p2"`).
     - Ensure `JsonCodecs` decodes `InitialAttack` whether `"targetPlayerId"` is present (`Some("p2")`) or omitted/null (`None`), and encodes `"targetPlayerId"` when present (or `null`/omitted when `None`) so existing tests and standard mode clients work seamlessly.
  3. **`GameEngine.scala`**:
     - Add helper `eligibleInitialTargets(state: GameState): Vector[Int]`:
       - When `state.boutPhase != BoutPhase.InitialAttack`, returns `Vector.empty`.
       - When `!state.config.chaosMode`, returns `Vector(state.defenderIdx)`.
       - When `state.config.chaosMode`, returns all seat indices `idx` (in clockwise order starting from `attackerIdx`) where `idx != state.attackerIdx` and `state.players(idx).hand.nonEmpty`.
     - In `applyInitialAttack`:
       - When `state.config.chaosMode` is `true`:
         - If `action.targetPlayerId` is `Some(targetId)`, verify `targetId` corresponds to a seat index in `eligibleInitialTargets(state)` (reject with `Left(InvalidAction(...))` if not). Set `defenderIdx = targetIdx`.
         - If `action.targetPlayerId` is `None`, default to `state.defenderIdx` (which is already a valid active opponent).
       - When `state.config.chaosMode` is `false`:
         - If `action.targetPlayerId` is `Some(targetId)` and `targetId != state.players(state.defenderIdx).id`, reject with `Left(InvalidAction(...))`.
     - Add helper `eligibleRedirectTargets(state: GameState): Vector[Int]`:
       - Returns seat indices `idx` where `idx != state.defenderIdx` and `state.players(idx).hand.size >= state.tablePairs.size + 1`.
       - In standard mode (`!state.config.chaosMode`), only the next clockwise active player with cards `nextActivePlayerIdx(state, state.defenderIdx)` is checked (so at most 1 seat).
       - In Chaos mode (`state.config.chaosMode`), all seats `idx != state.defenderIdx` with `hand.size >= state.tablePairs.size + 1` are eligible!
     - In `applyRedirectAttack`:
       - When `state.config.chaosMode` is `true`: select a target deterministically from `eligibleRedirectTargets(state)` (using a deterministic seed derived from `state.config.seed`, `state.talon.size`, `state.discardPile.size`, and `state.tablePairs.hashCode` so `GameEngine.applyAction` remains pure and repeatable), set `attackerIdx = state.defenderIdx` and `defenderIdx = chosenTargetIdx`.
  4. **`RandomBot.scala` & `BasicBot.scala`**:
     - In `RandomBot.legalActionsFor`: when `state.config.chaosMode` is `true` during `InitialAttack`, enumerate `InitialAttack(Vector(card), Some(state.players(targetIdx).id))` for each `targetIdx <- GameEngine.eligibleInitialTargets(state)` and each `card` in hand.

- [ ] **ITEM-ADD-1 (Backend Redirect Target Projection for 3P/4P Deflect Arrow):**
  > "1. The deflect arrow in the 3 player mode points in the wrong direction. With default player names, when Alice plays against Bob, from Bob's POV the arrow is pointing at Alice in the top-left of the table, when it should be pointing at Carol in the top-right."
  1. In `PlayerGameView.scala` and `JsonCodecs.scala`, add:
     - `eligibleTargetIds: Vector[String]` (populated during `InitialAttack` with `GameEngine.eligibleInitialTargets(state).map(state.players(_).id)`, empty otherwise).
     - `redirectTargetId: Option[String]` (populated when redirect is legal or during defense with the next clockwise active player `state.players(nextActivePlayerIdx(state, state.defenderIdx)).id` so that when `p0` Alice attacks `p1` Bob in a 3-player game, `redirectTargetId` is explicitly `Some("p2")` (Carol)).

- [ ] **ITEM-ADD-5 (Instant Auto-Pass in Surrender Phase When Player Has No Throw-In Cards):**
  > "5. If a player has no cards to throw in, they should automatically pass during the surrender phase. There should be no timed delay for this."
  1. In `GameEngine.scala`:
     - Write a helper `canPlayerThrowIn(state: GameState, seatIdx: Int): Boolean` that returns `true` if and only if:
       - `seatIdx != state.defenderIdx`
       - `state.players(seatIdx).hand.nonEmpty`
       - `state.tablePairs.size < maxBoutCards(state)` and `uncoveredCount(state) < state.players(state.defenderIdx).hand.size` (or in `SurrenderThrowIn`, total `tablePairs.size` is strictly less than the defender's initial hand capacity for the bout / `maxThrowInCards` allowed by the engine)
       - The player's hand contains at least one card whose rank matches a rank currently present in `state.tablePairs` (`tableRanks(state)`).
     - Write a helper `autoPassSurrenderThrowers(state: GameState): GameState`:
       - When `state.boutPhase == BoutPhase.SurrenderThrowIn`:
         - Mark every non-defender seat `idx != state.defenderIdx` where `!canPlayerThrowIn(state, idx)` as `hasPassed = true` immediately.
         - If all active non-defender seats now have `hasPassed == true`, immediately invoke `resolveSurrenderBout(updatedState)` right inside `GameEngine` so the surrender resolves synchronously in the same transition!
     - Call `autoPassSurrenderThrowers` at the end of `DeclareSurrender`, `ThrowInCards` (when in `SurrenderThrowIn`), and `PassTurn` (when in `SurrenderThrowIn`).
  2. In `GameActor.scala`:
     - Verify that no 3-second auto-action delay or 15-second turn clock is scheduled for any player during `SurrenderThrowIn` who has no legal `ThrowInCards` move (since `GameEngine` already auto-passes them and resolves the bout immediately with 0ms delay).

- [ ] **ITEM-PB-12c (Exclude "Non-Moves" from Replay Recording):**
  > "12. ... "non-moves" (for example, passing when throwing in after a surrender) should not be considered as moves for the purposes of the replay - that is, every move should be a visible action on the table."
  1. In `GameReplay.scala` / `GameActor.scala`:
     - Inspect how `GameReplay.recordMove(prevState, action, playerId, nextState, elapsedMs)` (or the replay frame builder in `GameActor` / `GameReplay`) records moves.
     - A move is a **"non-move"** if `action` is `GameAction.PassTurn` AND `nextState.tablePairs == prevState.tablePairs` AND `nextState.boutPhase == prevState.boutPhase` (for example, one player passes during `Defense` or `SurrenderThrowIn` while another player still has throw-in actions, so the cards on the table do not clear or move).
     - Also, if `DeclareSurrender` immediately resolves the bout (because `autoPassSurrenderThrowers` found that no other player had any cards to throw in), record the intermediate half-off surrender state frame OR record the surrender + resolution cleanly so every frame in `GameReplay.frames` represents a distinct visible action on the table, and intermediate `PassTurn` non-moves that leave `tablePairs` and `boutPhase` unchanged are NEVER added as separate replay steps!
     - If a `PassTurn` IS the final pass that resolves the bout (clearing `tablePairs` to `discardPile` or into the surrendering defender's hand and advancing to `InitialAttack` or `GameOver`), it DOES produce a visible change on the table (the table clears / cards are picked up), so that state transition updates/records the resolved table frame cleanly without extra no-op pass frames.

- [ ] **ITEM-ADD-8b (Assign `"DURAK"` to Last Player Out at Game Over):**
  > "8. ... Additionally, make sure that the last player out when the game ends also has the label "DURAK" assigned."
  1. In `GameEngine.scala` and `PlayerGameView.scala`:
     - Confirm that whenever a game transitions to `BoutPhase.GameOver` (and is not a simultaneous draw where all remaining players emptied their hands on the exact same bout), `state.durak` is set to `Some(lastPlayer.id)` and `PlayerGameView.durak` is `Some(lastPlayer.id)`.

- [ ] **ITEM-ADD-9 & ITEM-PB-9 (Bot Input Rejection & Rematch Metadata in `PlayerGameView`):**
  > "9. If a player is a bot, the game should not accept user input for that player's moves."
  > "9. Add to the banner also a "Rematch" button which starts a game with the same players (and/or bots)."
  1. In `PlayerGameView.scala` and `JsonCodecs.scala`:
     - Add fields to `PlayerGameView`:
       - `isBot: Boolean` (true when `state.config.isBotSeat(myIdx)` is true)
       - `playerTypes: Vector[String]` (`state.config.playerTypes`)
       - `allowRedirect: Boolean` (`state.config.allowRedirect`)
       - `chaosMode: Boolean` (`state.config.chaosMode`)
       - `eligibleTargetIds: Vector[String]`
       - `redirectTargetId: Option[String]`
     - In `PlayerGameView.forViewer(state, viewerId)`: when `state.config.isBotSeat(viewerIdx)` is `true`, set `legalActions = Vector.empty` in the projected `PlayerGameView` (bots compute their own moves from `GameState` via `RandomBot`/`BasicBot`, not from `PlayerGameView.legalActions`), so any client viewing a bot seat sees `isBot = true` and `legalActions = []`.
  2. In `GameActor.scala` and `GameRoutes.scala`:
     - Differentiate external client action submissions (`submitClientAction` called by HTTP `POST /api/games/:gameId/action` and WebSocket client messages) from internal bot/timeout fiber actions.
     - If an external client submits an action for a seat where `state.config.isBotSeat(seatIdx)` is `true`, reject it immediately with `Left(GameError.InvalidAction("Cannot submit user input for a bot player"))` (returning HTTP 400 on REST and ignoring/rejecting on WebSocket).
  3. In `GameRoutes.scala`:
     - Ensure `POST /api/games` (and `POST /api/game/create`) reads `"chaosMode": Boolean` from the JSON request body (defaulting to `false`) and passes `chaosMode = chaosMode` into `GameConfig` / `GameManager.createGame`.

- [ ] **1-Click QA Scenario Presets Endpoint (`POST /api/games/preset`):**
  - In `GameManager.scala` and `GameRoutes.scala`, add `POST /api/games/preset` (accepting `{ "preset": "<presetId>" }` and returning `{ "gameId": "...", "players": [...], "playerTypes": [...], "defaultPlayerId": "..." }`) supporting:
    1. `"3p-redirect-bob"`: 3-player game (`Alice`, `Bob`, `Carol`, `allowRedirect = true`), where Alice (`p0`) has just played `6♠` against Bob (`p1`), and Bob holds `6♥` in hand (`boutPhase = Defense`, `redirectTargetId = Some("p2")` Carol). `defaultPlayerId = "p1"`.
    2. `"chaos-4p"`: 4-player game (`Alice`, `Bob`, `Carol`, `Dave`, `chaosMode = true`, `allowRedirect = true`) at `InitialAttack` for Alice (`p0`), so all 3 opponents (`p1`, `p2`, `p3`) are in `eligibleTargetIds`. `defaultPlayerId = "p0"`.
    3. `"surrender-half-off"`: 3-player game (`Alice`, `Bob`, `Carol`) in `BoutPhase.SurrenderThrowIn` where Bob (`p1`) has declared surrender facing `7♠`, and Alice (`p0`) holds `7♥` so Alice is prompted to throw in or pass while the table cards stay half-on/half-off toward Bob. `defaultPlayerId = "p0"`.
    4. `"discard-and-endgame"`: 3-player game (`Alice`, `Bob`, `Carol`) where `talon` is empty, `discardPile` has 8 cards (`lastDiscardCards` has 4 face-up cards from the previous bout and 4 face-down cards stacked beneath), Carol (`p2`) is already out (`0 cards`, in `winners`), and Alice (`p0`) is attacking Bob (`p1`) with her final card so 1 move finishes the match and assigns Bob as `"DURAK"`. `defaultPlayerId = "p0"`.

---

## Verification Commands
```bash
cd backend && sbt -batch test
```
All existing and new MUnit suites must pass with zero errors.
