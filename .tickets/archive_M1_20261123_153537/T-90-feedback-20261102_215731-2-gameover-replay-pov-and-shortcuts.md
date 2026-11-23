<!-- WAVE:1 -->
# Ticket T-90-feedback-20261102_215731-2: Game-Over Banner, Accessible Interactive Replay Mode, `(You)` Name Suffix & Keyboard Arrow Shortcuts

## Summary
1. Fix the Game-Over banner (`[data-testid="game-over-banner"]`) so it reliably pops up and stays visible when a game finishes (`ITEM-9`).
2. Fix interactive game review mode accessibility so when a game finishes, both live clients and users visiting the finished game's URL (`#/g/:gameId` or `#/g/:gameId?player=pX`) immediately see the finished game and interactive replay controls instead of hanging on `Loading game [game ID]` forever (`ITEM-12`).
3. Append ` (You)` to the end of the active user's name in both the POV element(s) and the `PLAYERS` list element (`ITEM-13`).
4. Add keyboard `ArrowLeft` and `ArrowRight` shortcuts in Review Mode to step backward and forward through replay frames (`ITEM-FOLLOWUP-1`).

## File Scope (Exclusive to this Ticket in Wave 1)
- `frontend/src/pages/GamePage.tsx`
- `frontend/src/types.ts`
- `frontend/src/api/client.ts`
- `frontend/src/app.tsx`
- `frontend/src/app.css`
- `frontend/src/__tests__/GamePage.test.tsx`
- `frontend/src/__tests__/types.test.ts`
- `frontend/src/__tests__/app.test.tsx`

**IMPORTANT:** Do NOT touch `frontend/src/components/GameTable.tsx`, `frontend/src/components/Card.tsx`, `frontend/src/styles/table.css`, `frontend/src/styles/tableTextures.ts`, `backend/**`, `README.md`, `ARCHITECTURE.md`, or `play-local.sh` in this ticket.

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-9 (Verbatim):** "9. The game-over banner does not pop up when a game is finished. Fix this."
  - In `frontend/src/types.ts` (`parsePlayerGameView` and `parseGameReplay`):
    - Audit every field validation in `parsePlayerGameView` and `parseGameReplay` for finished games (`boutPhase === 'GameOver'` / `'game_over'` / `'gameOver'`):
      - Ensure `parsePlayerGameView` accepts `boutPhase: 'GameOver'` (and case/snake variants normalized or preserved consistently), `bottomTrumpCard: null`, `turnDeadlineMs: null | undefined`, `gameStartedAtMs: number | null | undefined`, `gameEndedAtMs: number | null | undefined`, `durak: string | null | undefined`, `winners: string[]`, `opponents[i].finishRank: number | null | undefined`, `promptedPlayerIds: string[]`, `lastDiscardCards: Card[]`, `discardCount: number`, and empty `legalActions: []`.
      - Ensure `parseGameReplay` accepts the backend's `GET /api/games/:gameId/replay` payload structure (including `frames` where each frame's `views` map is parsed via `parsePlayerGameView` and `moves` array with `elapsedMs`).
  - In `frontend/src/pages/GamePage.tsx` and `frontend/src/app.css`:
    - Ensure `isGameOverPhase` checks `view?.boutPhase` AND `displayedView?.boutPhase` (AND `replay !== null && replay.frames.length > 0 && isGameOverPhase(lastReplayFrameView.boutPhase)`).
    - Whenever the match is over, ALWAYS render `[data-testid="game-over-banner"]` visibly above the table — NEVER hide `[data-testid="game-over-banner"]` when `reviewMode` activates or when stepping backward through earlier replay frames!
    - Compute the banner's Winner(s) and Durak announcement from the final finished game state (`view` if in `GameOver`, or the final frame of `replay`), and include `[data-testid="banner-lobby-button"]` (`Return to lobby`).

- [ ] **ITEM-12 (Verbatim):** "12. The interactive game review mode is not accessible - when the game finishes, visiting its URL displays Loading game [game ID] forever."
  - In `frontend/src/app.tsx`:
    - Ensure hash route parsing supports `#/g/:gameId`, `#/g/:gameId?player=pX`, `#/g/:gameId/replay`, etc., defaulting `playerId` to `'p0'` whenever `?player=` is omitted or empty.
  - In `frontend/src/pages/GamePage.tsx` and `frontend/src/api/client.ts`:
    - When `GamePage` mounts or `gameId` / `playerId` changes:
      1. Fetch `getGameView(gameId, playerId)` immediately via REST in parallel with connecting `GameWebSocket`.
      2. Also fetch `getGameReplay(gameId)` when `getGameView` resolves with `GameOver` OR as a fallback if `getGameView` fails or returns a finished match.
      3. If `view` is still `null` when `getGameReplay(gameId)` resolves with at least one frame (for example, when visiting the URL of a finished game), immediately hydrate `view` from the final replay frame (`frames[frames.length - 1].views[playerId] ?? Object.values(frames[frames.length - 1].views)[0]`) so `GamePage` NEVER stays stuck on `Loading game {gameId}`!
      4. Ensure that when visiting the URL of a finished game, `GamePage` immediately renders the finished game table, `[data-testid="game-over-banner"]`, and the `[data-testid="review-nav"]` replay controls (`[data-testid="review-prev-button"]`, `[data-testid="review-move-indicator"]`, `[data-testid="review-next-button"]`) initialized at the final frame (`frames.length - 1`).

- [ ] **ITEM-13 (Verbatim):** "13. Adjust this feature so that (You) is appended to the end of the active user's name in both the POV element and the player list element."
  - In `frontend/src/pages/GamePage.tsx`:
    - Define a helper (e.g., `formatPlayerDisplayName(seatId: string, baseName: string, activePlayerId: string): string`) that appends `' (You)'` when `seatId === activePlayerId` (unless `baseName` already ends with `' (You)'`), e.g. `'Alice (You)'`, and returns `baseName` (e.g. `'Bob'`) for all other seats.
    - Apply this formatting in **both**:
      1. **The POV element(s)**: both the header POV selector/menu (`[data-testid="pov-menu"]` / options or buttons) and the left-sidebar POV tabs (`[data-zone="sidebar-left"]` POV buttons) must show `${name} (You)` for the active user (`seatId === playerId`) and plain `${name}` for every other player.
      2. **The Player List element**: in the right-sidebar `PLAYERS` list (`[data-testid="players-list"]` / `.players-list`), the active user's row (`seatId === playerId`) must show `${name} (You)` and every other player's row must show plain `${name}`.
    - When the user switches POV to another seat (e.g., from `p0` Alice to `p1` Bob), the ` (You)` suffix must move to the newly active user (`Bob (You)`) in both the POV element and the player list element.

- [ ] **ITEM-FOLLOWUP-1 (Verbatim):** "- Keyboard Arrow Shortcuts in Review Mode: Make the left and right arrow keys also step backward and forward through replay frames."
  - In `frontend/src/pages/GamePage.tsx`:
    - While in review mode (`reviewMode` is true and `replay && replay.frames.length > 0`), register a `window` `keydown` event listener:
      - `event.key === 'ArrowLeft'`: step backward one frame (`Math.max(0, idx - 1)`) and call `event.preventDefault()`.
      - `event.key === 'ArrowRight'`: step forward one frame (`Math.min(replay.frames.length - 1, idx + 1)`) and call `event.preventDefault()`.
      - Ignore the key press if `event.ctrlKey || event.altKey || event.metaKey` or if the active/target element is an `<input>`, `<select>`, `<textarea>`, or `isContentEditable`.
    - Add unit tests in `frontend/src/__tests__/GamePage.test.tsx` verifying:
      1. Game-over banner (`[data-testid="game-over-banner"]`) pops up and remains visible when a game finishes and while in review mode.
      2. Visiting a finished game's URL loads the game and review mode immediately without getting stuck on `Loading game [game ID]`.
      3. `(You)` is appended to the active user's name in both the POV element and the `PLAYERS` list element.
      4. Pressing `ArrowLeft` and `ArrowRight` on `window` steps backward and forward through replay frames and clamps at `0` and `frames.length - 1`.

## Testing & Verification Commands
Run from `frontend/`:
```bash
cd frontend && npm test -- --run
```
All Vitest test suites must pass with zero errors.
