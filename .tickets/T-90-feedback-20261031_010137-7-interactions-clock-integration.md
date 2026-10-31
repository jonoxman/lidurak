<!-- WAVE:3 -->
# Ticket T-90-feedback-20261031_010137-7: Frontend Drag-Drop Snapping, Double-Click Play, Clock UI & Audio Integration

## Subsystem
Frontend User Interaction, Turn Clock UI & Web Audio Event Integration (`frontend/src/pages/GamePage.tsx`, `frontend/src/components/*`)

## Description & Scope
Implement magnetic drag-and-drop snapping with preview highlights, unambiguous double-click to play, right-sidebar digital turn clock display, and end-to-end Web Audio sound effect wiring across all game events.

### Requirements Covered
- **Item 3: Magnetic Drag-and-Drop Snapping**
  - When dragging a card within `48px` of a valid drop target (legal target player's outline, uncovered attacking card for defense, throw-in outline, or redirect outline), visually snap a preview outline into that slot with a highlight border.
  - Releasing mouse executes that play.
  - Ensure all drop targets have at least `16px` separation to avoid ambiguity.
- **Item 6: Double-Click to Play**
  - Double-clicking a card in hand plays it immediately if and only if there is **exactly one legal way** to play that card:
    - Opening attack when only 1 legal target player exists (`chaosMode == false` or only 1 opponent left).
    - Throw-in during an active bout (card rank matches table rank).
    - Defending when card can legally beat only one uncovered attacking card (and cannot also redirect).
  - If ambiguous (e.g. `chaosMode == true` opening attack with 2+ legal targets, or card covers 2 different cards, or card can both cover and redirect), ignore double-click and require dragging.
- **Item 19: Digital Turn Clock UI (`sidebar-right`)**
  - In `[data-zone="sidebar-right"]`, render the large digital turn clock (`00:XX`, font-size `2.25rem`, monospace).
  - Synchronize remaining seconds with backend `turnDeadline` / `secondsRemaining`. Defaults to `00:15`.
  - Trigger `soundEngine.playClockTick()` wooden mechanical click once per second during final 5 seconds (`00:05` down to `00:01`) for the active player being waited on.
- **Item 2: End-to-End Audio Event Wireup (`SoundEngine.ts`)**
  - Wire `SoundEngine` to game state transitions in `GamePage.tsx`:
    - Card attack played -> `playAttack(count)`.
    - Card covered -> `playDefend()`.
    - Perevod redirected -> `playRedirect()`.
    - Surrender / cards picked up -> `playSurrender(count)`.
    - Cards drawn from talon -> `playDraw(count)` (only for active viewer).
    - Game finished -> `playGameOver()` two-note chime.
- **Full Project Verification:**
  - Run both `sbt -batch test` and `npm test -- --run` to ensure all backend and frontend suites pass.

## Target Files
- `frontend/src/pages/GamePage.tsx`
- `frontend/src/components/GameTable.tsx`
- `frontend/src/components/Card.tsx`
- `frontend/src/components/TablePair.tsx`
- `frontend/src/audio/SoundEngine.ts`
- `frontend/src/__tests__/GamePage.test.tsx`
- `frontend/src/__tests__/GameTable.test.tsx`

## Implementation Steps
1. In `GamePage.tsx` / `GameTable.tsx`, implement pointer/drag events:
   - Calculate distance to valid drop zones on card drag; if `<= 48px`, snap outline preview into slot with highlight.
   - On drop, fire corresponding action (`initialAttack`, `coverCard`, `redirect`, `throwIn`).
2. Add double-click handler on hand cards:
   - Evaluate legal move permutations for clicked card. If count of legal targets/actions === 1, execute it immediately; otherwise no-op.
3. In `GamePage.tsx` right sidebar (`[data-zone="sidebar-right"]`):
   - Render digital clock `00:XX` (`font-family: monospace; font-size: 2.25rem;`).
   - Run interval ticking down to `00:00` based on `turnDeadlineMs`.
   - When active player and remaining seconds <= 5 and > 0, trigger `soundEngine.playClockTick()`.
4. Detect state changes between consecutive views to trigger audio effects:
   - Compare `tablePairs`, hand sizes, `talonCount`, and `durak`/`winners`.
   - Trigger appropriate `SoundEngine` methods without audio overlapping glitches.
5. Run full test suites: `sbt -batch test` and `npm test -- --run`.

## Verification Commands
- `sbt -batch test`
- `npm test -- --run`

## Completion Requirements
- Both backend (`sbt -batch test`) and frontend (`npm test -- --run`) test suites pass with zero failures.
- All 20 items from Milestone 1 specification are fully verified.
- Write summary into `.reviews/agent_notes.md`.
- Run sentinel command: `echo "DONE" > .tickets/STATUS`.
