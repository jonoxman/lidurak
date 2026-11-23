<!-- WAVE:2 -->
# Ticket T-90-5: `GameTable` Exact Hand Highlight Alignment, Double-Click Redirect, Pass Countdown & Review Mode Support

## Context & Motivation
Building on the Wave 1 backend and CSS foundations, this ticket updates the frontend TypeScript types, REST client, and `GameTable.tsx` component to implement:
1. **Exact Hand Turn-Highlight Alignment (Req 3):** A robust layout for the active player's hand highlight box (`data-testid="hand-turn-highlight"`) that tightly encloses the rendered cards without guessing card positions via fragile arithmetic formulas.
2. **Double-Click Redirect to Play (Req 8):** Double-clicking a card in the player's hand whose only legal move is a redirect (`RedirectAttack`) automatically plays that redirection.
3. **Pass Button Countdown in Throw-In Phase (Req 14):** Displaying a countdown on the `Pass` button during the throw-in phase (both when a defender surrenders and when in the middle of a defense) styled identically to the `Surrender` button's 3-second countdown timer.
4. **Review Mode & POV Name Display in `GameTable` (Req 12 & 13):** Supporting `isReviewMode` on `GameTable` (hiding gameplay command buttons like `Pass`, `Surrender`, `Throw In` and target/redirect drop outlines while preserving user-side hand sorting) and ensuring player names are always shown instead of `"You"`.

## Scope & Files to Touch
- **Allowed files:**
  - `frontend/src/types.ts`
  - `frontend/src/api/client.ts`
  - `frontend/src/components/GameTable.tsx`
  - `frontend/src/components/ActionBar.tsx`
  - `frontend/src/styles/table.css`
  - `frontend/src/__tests__/GameTable.test.tsx`
  - `frontend/src/__tests__/types.test.ts`
- **Do NOT touch:** `frontend/src/pages/GamePage.tsx`, `frontend/src/app.css`, `frontend/src/__tests__/GamePage.test.tsx`, `README.md`, `ARCHITECTURE.md` (all handled in Wave 3).

## Detailed Requirements

### 1. Update Shared Frontend Types & Replay API Client (`types.ts`, `client.ts`)
- In `frontend/src/types.ts`:
  - Extend `PlayerGameView` with:
    - `discardCount?: number`
    - `lastDiscardCards?: Card[]`
    - `gameStartedAtMs?: number | null`
    - `gameEndedAtMs?: number | null`
  - Add interfaces for serialized game replay (`GET /api/games/:gameId/replay`):
    - `ReplayFrame`: `{ moveIndex: number; playerId?: string | null; action?: GameAction | null; elapsedMs: number; views: Record<string, PlayerGameView>; }`
    - `RecordedMove`: `{ moveIndex: number; playerId: string; action: GameAction; elapsedMs: number; }`
    - `GameReplay`: `{ gameId: string; moves: RecordedMove[]; frames: ReplayFrame[]; }`
- In `frontend/src/api/client.ts`:
  - Add `getGameReplay(gameId: string): Promise<GameReplay>` fetching `GET /api/games/${encodeURIComponent(gameId)}/replay`.

### 2. Robust Hand Turn-Highlight Box Alignment (`GameTable.tsx`, `table.css`)
- Inspect how `.hand-cards` / `[data-testid="hand-turn-highlight"]` and `.hand-card-slot` are laid out in `GameTable.tsx` and `table.css`.
- **Root Cause to Eliminate:** Never estimate the highlight box's width or position using arithmetic formulas that guess card positions, and never make `.hand-card-slot` narrower than the card inside it (which causes the last card to overflow outside the container's right edge) or apply `margin-left` to the first card (which shifts the first card outside the container's left edge).
- **Robust Implementation:**
  - Make `[data-testid="hand-turn-highlight"]` (`.hand-cards`) an `inline-flex` (or `flex` with `width: fit-content; max-width: 100%;`) container that directly wraps the `.hand-card-slot` elements with symmetric `padding` (`box-sizing: border-box`).
  - Each `.hand-card-slot` must have the exact same bounding width and height as the `.playing-card` it contains (`width: var(--hand-card-width, 84px); height: var(--hand-card-height, 120px); flex: 0 0 auto;`).
  - Overlap between neighboring cards must be applied **exclusively via negative `margin-left` on `.hand-card-slot:not(:first-child)`** (with `margin-left: 0` on `:first-child` and `margin-right: 0` on `:last-child`).
  - When surplus-card stacking is active (very large hands), any stacked offset must also be achieved via negative `margin-left` between adjacent slots rather than `transform: translateX(...)` that pushes cards outside `.hand-cards`.
  - Consequently, the browser's native CSS box model guarantees that `.hand-cards` (`data-testid="hand-turn-highlight"`) starts at the exact left edge of the first card and ends at the exact right edge of the last card—with zero position guessing!

### 3. Double-Clicking a Redirect-Only Card Automatically Plays the Redirection (`GameTable.tsx`)
- In `GameTable.tsx`, inspect the hand card `onDblClick` / double-click handler (`findSingleLegalActionForCard` or equivalent).
- Ensure that when collecting all legal actions in `view.legalActions` that can be played with the double-clicked `card`:
  - Include `InitialAttack` where `cardsEqual(action.card, card)`
  - Include `CoverCard` where `cardsEqual(action.handCard, card)`
  - Include `RedirectAttack` where `cardsEqual(action.card, card)`
  - Include `ThrowInCards` where `action.cards.length === 1 && cardsEqual(action.cards[0], card)`
- If the total number of matching legal actions for `card` across all action types is **exactly 1** (for example, a card of matching rank that cannot cover the attacking card and therefore can *only* legally be played as `RedirectAttack`), double-clicking that card must immediately invoke `onAction(matchingActions[0])`!
- (If a card can *both* cover and redirect—e.g. a trump card of the same rank as a non-trump attacking card—then it has 2 legal moves, so double-clicking does not guess between them; the user drags it to the target or redirect outline.)

### 4. Matching Countdown on the `Pass` Button & Review Mode Support (`GameTable.tsx`, `ActionBar.tsx`, `table.css`)
- Add optional props to `GameTableProps` (and `ActionBarProps` if applicable):
  - `passCountdownSeconds?: number | null`
  - `isReviewMode?: boolean`
- **Pass Button Countdown (Req 14):**
  - Inspect how the `Surrender` button renders its countdown timer when `surrenderCountdownSeconds` is active (e.g., `<span class="action-countdown-badge" data-testid="surrender-countdown">({surrenderCountdownSeconds}s)</span>` or equivalent inside the button).
  - Render a matching countdown on the `Pass` button whenever `passCountdownSeconds != null && passCountdownSeconds > 0` (using the exact same badge/timer structure and CSS styling as the `Surrender` button countdown, with `data-testid="pass-countdown"` and text matching the Surrender button format, e.g. `Pass (${passCountdownSeconds}s)`).
- **Review Mode in `GameTable` (Req 12):**
  - When `isReviewMode` is `true`:
    - Do NOT render any gameplay command buttons (`Pass`, `Surrender`, `Throw In`) in `[data-zone="table-controls"]` or `ActionBar`.
    - Do NOT render target drop outlines (`target-outline-*`), redirect drop outlines (`redirect-outline`), or the active turn highlight glow (`hand-turn-highlight` should not be in active-turn glowing state), and disable card dragging / double-click action submission.
    - **Keep user-side hand sorting (`sortMode`) fully functional** so changing `sortMode` (`'suit' | 'pairs' | 'rank'`) continues to reorder the viewer's hand cards on the board!
- **Player Names (Req 13):**
  - Verify `GameTable.tsx` never renders `"You"` in place of a player's actual `name`.

## Acceptance Criteria & Verification
1. Add unit tests in `frontend/src/__tests__/GameTable.test.tsx`:
   - Verify that double-clicking a card whose only legal action in `view.legalActions` is `RedirectAttack` calls `onAction({ type: 'RedirectAttack', card })`.
   - Verify that when a card has both `CoverCard` and `RedirectAttack` as legal actions, double-clicking does not auto-fire.
   - Verify that `.hand-cards` (`data-testid="hand-turn-highlight"`) uses `margin-left: 0` on the first card slot and negative `margin-left` only on subsequent slots so the container aligns with the cards without position-guessing offsets.
   - Verify that passing `passCountdownSeconds={12}` renders the countdown on the `Pass` button matching the `Surrender` button's countdown format.
   - Verify that `isReviewMode={true}` hides `Pass` and `Surrender` command buttons while still sorting the player's hand according to `sortMode`.
2. Run `cd frontend && npm test -- --run` and ensure all tests pass.
3. Write your implementation summary to `.reviews/agent_notes.md` and run `echo "DONE" > .tickets/STATUS`.
