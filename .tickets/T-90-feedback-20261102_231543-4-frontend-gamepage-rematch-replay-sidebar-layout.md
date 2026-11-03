<!-- WAVE:3 -->
# Ticket T-90-4: Frontend `GamePage`, `SortBar` & `LobbyPage` — Rematch Button, Replay POV/Sound/Non-Moves, PLAYERS Attacker/Defender Highlights & Centered Counts & DURAK Label, HAND SORTING Below Table, and QA Presets

## Scope & Files to Touch
- **Touch ONLY these files:**
  - `frontend/src/pages/GamePage.tsx`
  - `frontend/src/pages/LobbyPage.tsx`
  - `frontend/src/components/SortBar.tsx`
  - `frontend/src/app.css`
  - `frontend/src/__tests__/GamePage.test.tsx`
  - `frontend/src/__tests__/LobbyPage.test.tsx`
- **DO NOT touch `backend/`, `tableTextures.ts`, `README.md`, `ARCHITECTURE.md`, or `play-local.sh` in this ticket.**

---

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-PB-9 (Add "Rematch" Button to Game-Over Banner):**
  > "9. Add to the banner also a "Rematch" button which starts a game with the same players (and/or bots)."
  1. In `frontend/src/pages/GamePage.tsx`:
     - Inside `[data-testid="game-over-banner"]`, next to the existing `Return to lobby` button (`[data-testid="banner-lobby-button"]`), render a **`Rematch`** button (`[data-testid="banner-rematch-button"]`, text `Rematch`).
     - Track the match's configuration from `view` / `replay` (`playerCount`, `playerNames` in seat order `p0..pN`, `allowRedirect`, `chaosMode`, and `playerTypes` in seat order).
     - Clicking `Rematch` calls `createGame(playerCount, playerNames, allowRedirect, chaosMode, playerTypes)` and navigates to the new `gameId` with the current viewer's `playerId` (`onNavigateGame?.(res.gameId, playerId)` or `window.location.hash = `#/g/${res.gameId}?player=${encodeURIComponent(playerId)}``), resetting finished/replay state so the new match starts immediately with the exact same human and/or bot seats!

- [ ] **ITEM-PB-12a, ITEM-PB-12b, ITEM-PB-12c (Review Feature Enhancements):**
  > "12. Modify the following details about the review feature: when switching players in the POV menu, the replay move should not reset to the last move of the game as it currently does; sounds should be replayed as their moves are replayed in the viewer; "non-moves" (for example, passing when throwing in after a surrender) should not be considered as moves for the purposes of the replay - that is, every move should be a visible action on the table."
  1. **`ITEM-PB-12a` (Preserve `replayFrameIdx` on POV switch):**
     - In `GamePage.tsx`, separate the effect or state initialization that sets `replayFrameIdx = frames.length - 1` so that it ONLY initializes to the last frame when `gameId` changes or when a game first enters review mode (`replay` loads for the first time for that `gameId`), and **NEVER** resets `replayFrameIdx` when the user switches `playerId` via the header `POV` menu (`[data-testid="pov-menu"]`) or the left-sidebar `POV` tabs!
  2. **`ITEM-PB-12b` (Replay move sounds in viewer):**
     - In `GamePage.tsx`, when the user steps backward or forward in review mode (via `[data-testid="review-prev-button"]`, `[data-testid="review-next-button"]`, or `ArrowLeft`/`ArrowRight` keys), trigger the appropriate sound on `soundEngine` for the target frame/move:
       - Inspect `replay.moves[nextIdx - 1]` (or compare adjacent frames `prevFrame` and `nextFrame` via `triggerTableDiffSounds` / action type):
         - `InitialAttack` / `ThrowInCards` -> `soundEngine.play('cardPlay')`
         - `CoverCard` -> `soundEngine.play('cardCover')`
         - `RedirectAttack` -> `soundEngine.play('redirect')`
         - `DeclareSurrender` -> `soundEngine.play('surrender')`
         - Bout resolution / talon draw -> `soundEngine.play('cardDraw')` (or `'cardPlay'` if no draw)
         - Final `GameOver` frame -> `soundEngine.play('gameOver')`
  3. **`ITEM-PB-12c` (Filter non-moves from replay frames in viewer):**
     - In addition to the backend filtering in `GameReplay`, add a defensive filter in `GamePage.tsx` (e.g. `visibleReplayFrames(replay)`) that filters out any frame whose corresponding move was a non-resolving `PassTurn` where `tablePairs`, `discardCount`, `talonCount`, and `boutPhase` did not change from the previous frame, ensuring 100% guarantee that every step in `Move X / Y` corresponds to a visible change on the table.

- [ ] **ITEM-ADD-2 (Outline Currently Attacking and Currently Attacked Players in Right-Sidebar `PLAYERS` List):**
  > "2. Mark the currently attacking, and currently attacked, players in the PLAYERS element on the right of the page by outlining each player's name tag with the appropriate color highlight."
  1. In `frontend/src/pages/GamePage.tsx` and `frontend/src/app.css`:
     - In `[data-testid="players-list"]`, while the match is not in `GameOver` (`!isGameOverPhase(activeView.boutPhase)`):
       - Identify the currently attacking player (`seat.id === activeView.attackerId`) and the currently attacked / defending player (`seat.id === activeView.defenderId`).
       - Set `data-role="attacker"` on the attacking player's `.status-badge` row (and `.status-name` name tag) and `data-role="defender"` on the defending player's `.status-badge` row (and `.status-name` name tag), or `"none"` for other seats.
       - In `frontend/src/app.css`, style `.status-badge[data-role="attacker"]` / `.status-badge[data-role="attacker"] .status-name` with a distinct **attacker color outline** (e.g. `2px solid #2dc653` green highlight with subtle glow) and `.status-badge[data-role="defender"]` / `.status-badge[data-role="defender"] .status-name` with a distinct **defender color outline** (e.g. `2px solid #f59e0b` amber/red-orange highlight with subtle glow) in both dark and light themes!

- [ ] **ITEM-ADD-7 (Move `SORT` Element Below the Game Table and Rename Label to `HAND SORTING`):**
  > "7. With the discard pile, there are too many elements in the rightmost column. Move the SORT element to be below the game table in the UI. Also adjust its label to say HAND SORTING instead of simply SORT."
  1. In `frontend/src/components/SortBar.tsx`:
     - Change the visible label text from `Sort` to `HAND SORTING`.
  2. In `frontend/src/pages/GamePage.tsx` and `frontend/src/app.css`:
     - Remove `[data-zone="hand-sort-box"]` from `[data-zone="sidebar-right"]` (the rightmost column).
     - Place `[data-zone="hand-sort-box"]` **directly below the game table (`[data-zone="table-arena"]`)** inside a center column wrapper (e.g. `.table-column` containing `[data-zone="table-arena"]` on top and `[data-zone="hand-sort-box"]` directly below it), with its section title / label reading **`HAND SORTING`**.
     - Ensure zero overlap between `[data-zone="table-arena"]` and `[data-zone="hand-sort-box"]`.

- [ ] **ITEM-ADD-8a & ITEM-ADD-8b (Keep Card Count Centered in `PLAYERS` List & Assign `"DURAK"` to Last Player Out):**
  > "8. In the player list, keep the number of cards always in the center of the player's label so when a player goes out the text doesn't shift. Additionally, make sure that the last player out when the game ends also has the label "DURAK" assigned."
  1. **`ITEM-ADD-8a` (Centered card count in `PLAYERS` list):**
     - In `frontend/src/pages/GamePage.tsx` and `frontend/src/app.css`:
       - Structure every `.status-badge` row in `[data-testid="players-list"]` as a 3-column CSS Grid: `grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center;` (left column: presence dot + `.status-name` aligned start; middle column: `.status-cards` (`${seat.cardCount} cards`) strictly centered at the horizontal midpoint of the row with `justify-self: center; text-align: center;`; right column: `.status-state-slot` aligned end holding any status badge like `OUT #1`, `WINNER`, `DURAK`, `PASSED`, or empty when none).
       - Because the left and right columns are equal `1fr` tracks and `.status-cards` sits in the center `auto` column (`justify-self: center`), the card count text is **always** horizontally centered in the player's row and never shifts when a status badge (`OUT`, `WINNER`, `DURAK`, `PASSED`) appears or disappears!
  2. **`ITEM-ADD-8b` (`"DURAK"` label on the last player out):**
     - When the match is finished (`GameOver`) or `durakId` is known (`activeView.durak` or final replay frame's `durak`, or the sole remaining player not in `winners` when `GameOver`), render `<span class="status-tag durak-tag" data-testid={`player-durak-tag-${seat.id}`}>DURAK</span>` in the right column of that player's row in `[data-testid="players-list"]`!

- [ ] **ITEM-ADD-9 (Bot Seat Input Lock in `GamePage`):**
  > "9. If a player is a bot, the game should not accept user input for that player's moves."
  1. In `frontend/src/pages/GamePage.tsx`:
     - Compute `isBotViewer = Boolean(activeView.isBot || (activeView.playerTypes && activeView.playerTypes[seatIndex] && activeView.playerTypes[seatIndex] !== 'human'))`.
     - When `isBotViewer` is `true`, block `handleAction` from sending any `GameAction` over WebSocket or REST, and pass `isBot={isBotViewer}` (or disable actions) to `GameTable` so a human switching to a bot's POV cannot play cards, surrender, or pass on behalf of the bot.

- [ ] **1-Click QA Scenario Presets UI (`LobbyPage.tsx` & `GamePage.tsx` Left Sidebar):**
  - Add a compact **`⚡ QA Scenarios`** panel (`[data-testid="qa-scenarios"]`) in `LobbyPage.tsx` (and in `[data-zone="sidebar-left"]` of `GamePage.tsx`) with 1-click buttons calling `createPresetGame(presetId)` and navigating straight to the created game's `defaultPlayerId`:
    - `3P Redirect (Bob POV)` (`preset = "3p-redirect-bob"`)
    - `4P Chaos Targets` (`preset = "chaos-4p"`)
    - `Surrender Half-Off` (`preset = "surrender-half-off"`)
    - `Discard & Endgame Durak` (`preset = "discard-and-endgame"`)

---

## Verification Commands
```bash
cd frontend && npm test -- --run
```
All Vitest suites must pass with zero errors.
