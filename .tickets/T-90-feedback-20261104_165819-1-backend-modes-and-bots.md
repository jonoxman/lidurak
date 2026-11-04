<!-- WAVE:1 -->
# Ticket 1 (Wave 1): Backend Support for RandomBot Timing, Transparent Mode & Server-Side Dev Mode

## Scope & Files to Touch
- **Touch ONLY backend files:**
  - `backend/src/main/scala/durak/engine/GameConfig.scala`
  - `backend/src/main/scala/durak/engine/PlayerGameView.scala`
  - `backend/src/main/scala/durak/engine/JsonCodecs.scala`
  - `backend/src/main/scala/durak/server/GameActor.scala`
  - `backend/src/main/scala/durak/server/GameManager.scala`
  - `backend/src/main/scala/durak/server/GameRoutes.scala`
  - `backend/src/test/scala/durak/engine/PlayerViewSuite.scala`
  - `backend/src/test/scala/durak/engine/JsonCodecsSuite.scala`
  - `backend/src/test/scala/durak/server/GameActorSuite.scala`
  - `backend/src/test/scala/durak/server/GameRoutesSuite.scala`
  - `backend/src/test/scala/durak/server/PresetSuite.scala`
- **Do NOT touch any `frontend/` files or root documentation files in this ticket.**

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-9a & ITEM-9b — RandomBot 0.2s Play Delay & 2.0s Initial Game-Start Delay (`GameActor.scala`, `GameManager.scala`):**
  > "9. Set RandomBot's play delay to be very fast (0.2s) instead of instant. Additionally, when the game first starts, add a 2-second delay to allow time to click the game link and view the game between two RandomBots."
  - In `GameActor.scala`:
    - Change `DefaultRandomBotDelay` from `0.millis` to `200.millis` (`0.2s`).
    - Add `DefaultInitialBotStartDelay: FiniteDuration = 2.seconds` (`2000.millis`) as a configurable parameter on `GameActor.create` and `GameActor.createFrom` (defaulting to `DefaultInitialBotStartDelay` in production `GameManager` room creation, or configurable so existing unit tests that pass explicit short delays remain fast).
    - When a game first starts (before the first move of the match has been played, i.e., `moveHistory.isEmpty` and initial bot scheduling runs on actor initialization), wait `initialBotStartDelay` (`2.seconds` by default) before the first bot action is executed. Once that initial start delay has elapsed (or `moveHistory.nonEmpty`), `RandomBot` uses `randomBotDelay` (`200.millis` by default) between moves, and `BasicBot` continues using its `500ms–2000ms` delay.
    - Update `GameActorSuite.scala` / `GameRoutesSuite.scala` where needed so tests either pass fast test delays or allow enough time (`>= 3.seconds` or custom test delay) for all-RandomBot matches to finish.

- [ ] **ITEM-10a — Backend Support for "Transparent Mode" (`GameConfig.scala`, `PlayerGameView.scala`, `JsonCodecs.scala`, `GameRoutes.scala`, `GameManager.scala`):**
  > "10. Implement "Transparent Mode". This is a variant of the game in which all players' cards are visible to each user. It should be accessible through a checkbox in the game lobby (along with allowing redirections and chaos mode). Rather than draw the full card sprites in the non-active users' player boxes, display a low-detail version that only shows the suit and rank (and trump-highlight, if necessary). Make sure that this mode is compatible with all all other modes and that no graphical glitches occur."
  - In `GameConfig.scala`:
    - Add `transparentMode: Boolean = false` to `case class GameConfig(...)`.
  - In `PlayerGameView.scala`:
    - Add `cards: Vector[Card] = Vector.empty` to `case class OpponentInfo(...)`.
    - Add `transparentMode: Boolean = false` to `case class PlayerGameView(...)`.
    - In `PlayerGameView.forPlayer(state: GameState, playerId: String, ...)`:
      - Set `transparentMode = state.config.transparentMode`.
      - When `state.config.transparentMode` is `true`, populate each `OpponentInfo.cards` with that opponent's actual `playerState.hand` (when `state.config.transparentMode` is `false`, `OpponentInfo.cards` MUST remain `Vector.empty` during live play so hidden hands are not leaked).
      - In `GameReplay` / replay projection, preserve `state.config.transparentMode` on `PlayerGameView` and populate `OpponentInfo.cards` when `state.config.transparentMode` is `true` (or in review mode).
  - In `JsonCodecs.scala`:
    - Encode and decode `transparentMode` on `GameConfig` and `PlayerGameView` (with backward-compatible default `false` on decode).
    - Encode and decode `cards` on `OpponentInfo` (with default `Vector.empty` on decode).
  - In `GameRoutes.scala` & `GameManager.scala`:
    - Add `transparentMode: Option[Boolean] = None` to `CreateGameRequest` and forward `transparentMode = req.transparentMode.getOrElse(false)` when constructing `GameConfig`.
    - Preserve `transparentMode` in `POST /api/games/:gameId/rematch`.
    - Add a 1-click QA Scenario Preset `"transparent-mode"` in `GameManager.scala` / `GameRoutes.scala` (`POST /api/games/preset` with `preset = "transparent-mode"`): creates a 3-player game on Alice (`p0`) with `transparentMode = true`, `allowRedirect = true`, where Bob (`p1`) and Carol (`p2`) hold a deterministic mix of trump and non-trump cards so the reviewer can inspect low-detail opponent cards in 1 click.

- [ ] **ITEM-14a (Backend) — Server-Side `devMode` Variable & Mid-Game POV Access Control (`GameConfig.scala`, `PlayerGameView.scala`, `JsonCodecs.scala`, `GameRoutes.scala`, `GameManager.scala`):**
  > "14. Move the player list element from the right column to the top of the left column in the UI. Remove the POV element altogether - consolidate all POV element features, such as clicking to choose the player's POV, into the player list element. Set it up so that unless a dev mode variable is active, the user cannot select the POV until the game is over and in review mode. (The dev mode variable should default to active for now, since we are currently testing. Temporarily place a toggle for it in the lobby menu, so I can start a game and see the UI from a normal user's perspective.) Ensure also that the dev mode variable is handled server-side, so the user cannot modify it on their end using techniques such as inspect element."
  - In `GameConfig.scala`:
    - Add `devMode: Boolean = true` to `case class GameConfig(...)`.
  - In `PlayerGameView.scala`:
    - Add `devMode: Boolean = true` to `case class PlayerGameView(...)`, populated from `state.config.devMode` in `PlayerGameView.forPlayer`.
  - In `JsonCodecs.scala`:
    - Encode and decode `devMode` on `GameConfig` and `PlayerGameView` (defaulting to `true` when omitted).
  - In `GameRoutes.scala` & `GameManager.scala`:
    - Add `devMode: Option[Boolean] = None` to `CreateGameRequest` and pass `devMode = req.devMode.getOrElse(true)` into `GameConfig`.
    - Preserve `devMode` in `POST /api/games/:gameId/rematch`.
    - Enforce server-side POV lock when `devMode == false` and `state.boutPhase != BoutPhase.GameOver`:
      - On `GET /api/games/:gameId/view/:playerId` (and `GET /api/games/:gameId/view?player=...`) and WebSocket `/ws/games/:gameId/:playerId`:
      - Accept an optional query parameter `requester` (e.g. `?requester=p0`). Whenever `requester` is present and `requester != playerId`, if `!state.config.devMode && state.boutPhase != BoutPhase.GameOver`, reject the request with `Status.Forbidden` (`403 Forbidden`).
      - Additionally, track the first human seat viewed/connected in a non-devMode game (or validate via `requester` / session header) so that if a user in a single-human non-devMode game tries to switch POV via DOM tampering or direct view API call with `requester != playerId` before `BoutPhase.GameOver`, the server returns `403 Forbidden` (while once `state.boutPhase == BoutPhase.GameOver`, switching to any seat is permitted even when `devMode == false`).

## Verification
- Run `cd backend && sbt -batch test` and ensure all existing and new MUnit suites pass with zero errors.

