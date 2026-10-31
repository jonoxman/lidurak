<!-- WAVE:3 -->
# Ticket: Frontend Table Integration — Bout Outlines, Drag-Snap, Double-Click, Chaos Lobby & Audio/Clock Wiring

## 1. Description & Goal
Complete the full interactive game table integration: render defender-anchored bout areas and initial attack target outlines (Item 12), card-shaped redirection outlines with directional arrows (Item 14), magnetic drag-snapping (Item 3), unambiguous double-click to play (Item 6), Chaos Mode lobby configuration (Item 11), right-sidebar digital clock display with 5s audio warning (Items 18 & 19), SoundEngine event triggers (Item 2), and client-side error banner suppression (Item 16).

## 2. Requirements & Specification

### Item 11: "Chaos Mode" Setting in LobbyPage
- Add `chaosMode` checkbox to `LobbyPage.tsx` Create Game form (default `false`).
- Disable/hide the option when `playerCount <= 2`.
- Send `chaosMode` in `createGame` API payload.

### Item 12: Defender-Anchored Bout Area & Target Outlines
1. **Initial Attack Target Outlines:**
   - Before the first card of a bout is played, render a highlighted single-card Target Outline (`width: 72px; height: 104px; border: 2px dashed #629924; border-radius: 8px;`, `data-testid="target-outline-<playerId>"`) directly in front of every player who is a legal attack target.
   - When `chaosMode == false`, render 1 target outline in front of the clockwise defender.
   - When `chaosMode == true`, render target outlines in front of all legal active opponents.
2. **Defender-Anchored Cards in Play:**
   - In Row 2 of `[data-zone="table-arena"]`, anchor active bout cards directly in front of the defending player:
     - Defender at `top-left`: `justify-self: start; align-self: start;`
     - Defender at `top-center`: `justify-self: center; align-self: start;`
     - Defender at `top-right`: `justify-self: end; align-self: start;`
     - Defender is active viewer (bottom): `align-self: end; justify-self: center;` directly above the player's hand.

### Item 14: Card-Shaped Redirection Outline with Directional Arrow
- Render single-card sized outline (`width: 72px; height: 104px;`, `data-testid="redirect-outline"`) to the immediate right of attacking cards when redirection is legal.
- Inside the outline, render an SVG multi-arrow reflection icon with a directional arrow pointing toward the target receiving seat (`top-left`, `top-center`, or `top-right`), or split shuffle icon if `chaosMode == true`. Remove any `"PEREVODZHU!"` text.

### Items 3 & 6: Magnetic Drag-and-Drop Snapping & Double-Click to Play
1. **Magnetic Drag Snapping (Item 3):**
   - When dragging a card within `48px` of a valid drop slot (target outline, uncovered card, throw-in slot, redirect outline), snap a preview highlight into that slot. Releasing drops the card and executes the action. Ensure drop zones have at least `16px` separation.
2. **Double-Click to Play (Item 6):**
   - Double-clicking a card immediately plays it if there is **only one legal way** to play it (single legal attack target, matching throw-in rank, or single beatable defense card). If ambiguous, ignore double-click.

### Items 18 & 19 (Frontend): Digital Clock Display & Audio Wiring
- In `[data-zone="sidebar-right"]`, render the digital turn clock (`00:XX`) updating live from `turnDeadlineMs` down to `00:00`.
- During the final 5 seconds (`00:05` down to `00:01`), trigger `SoundEngine.playClockTick()` once per second for the active waited-on player.

### Item 2: Wire SoundEngine to Game Events
- Trigger `SoundEngine` on state transitions:
  - Attack: `playAttackCard(count)`.
  - Cover: `playDefendCard()`.
  - Redirect: `playRedirect()`.
  - Surrender: `playSurrender(tableCardsCount)`.
  - Talon draw: `playTalonDraw(cardsDrawn)` (played **only** for the player drawing).
  - Game Over: `playGameOver()`.

### Item 16: Suppress UI Error Banners
- Remove all invalid action banner popups from the UI.
- Log rejection warnings to `console.warn` on client drag rejection.

## 3. Files to Touch
- `frontend/src/pages/LobbyPage.tsx`
- `frontend/src/pages/GamePage.tsx`
- `frontend/src/components/GameTable.tsx`
- `frontend/src/components/TablePair.tsx`
- `frontend/src/types.ts`
- `frontend/src/api/client.ts`
- `frontend/src/styles/table.css`
- `frontend/src/__tests__/LobbyPage.test.tsx`
- `frontend/src/__tests__/GamePage.test.tsx`
- `frontend/src/__tests__/GameTable.test.tsx`

## 4. Verification & Testing
- Run `npm test -- --run` to ensure all frontend unit and integration tests pass.
- Verify:
  - Target outlines appear with `data-testid="target-outline-<playerId>"`.
  - Redirect outline appears with `data-testid="redirect-outline"`.
  - Double-click plays unambiguous cards and ignores ambiguous cards.
  - Turn clock counts down and triggers tick sounds.
  - Chaos mode option toggles in LobbyPage.

## 5. Autonomous Agent Workflow Steps
1. Run `git status` and `git diff` to inspect current state.
2. Implement integration logic across frontend pages and components.
3. Run `npm test -- --run` and fix any test regressions.
4. Document implemented features in `.reviews/agent_notes.md`.
5. Signal completion: `echo "DONE" > .tickets/STATUS`.
