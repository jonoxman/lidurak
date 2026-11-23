<!-- WAVE:3 -->
# Ticket T-90-feedback-20261031_182723-6: Hand Sorting Dropdown, Legal Card Lift, Pointer Drag Cursor, Auto-Surrender & Audio Integration

## Subsystem
Frontend Hand Controls & Game Interaction Loop (`frontend/src/components/SortBar.tsx`, `frontend/src/components/GameTable.tsx`, `frontend/src/pages/GamePage.tsx`)

## Wave
WAVE:3 (Builds on Wave 1 Sound Engine and Wave 2 Table/Arena components)

## Description & User Requirements
Polish hand interaction controls, visual move cues, card drag cursors, and turn audio/surrender automation:
1. **Compact Hand Sort Dropdown (Feedback Item 11)**:
   - In `frontend/src/components/SortBar.tsx`, replace the 3 individual buttons ("Suit", "Pairs", "Rank") with a single, clean dropdown select element positioned in the same location (`[data-zone="table-arena"]` Row 3, Col 3 controls area) to conserve screen space.
   - Maintain the same sorting behaviors: 'suit' (grouped by suit, trumps rightmost), 'pairs' (matching ranks together), 'rank' (ascending rank order).
2. **Visual Lift for Legal Hand Cards (Feedback Item 12)**:
   - In the active player's hand, automatically shift all cards that are currently legal to play upwards slightly (e.g., `transform: translateY(-8px)` or `-10px` via a `.legal-playable` CSS class).
   - This provides an immediate, zero-clutter visual indication of playable moves without rendering any text banners on the table.
   - Cards that cannot be legally played remain at normal baseline height.
3. **Cursor Pointer During Drag-and-Drop (Feedback Item 19)**:
   - Fix the issue where dragging a card changes the mouse cursor to a "no" / circle-with-slash symbol.
   - Ensure the cursor remains the "clickable element" pointer finger (`cursor: pointer`) throughout the entire drag-and-drop gesture across the table and drop targets.
4. **3-Second Defenseless Auto-Surrender (Feedback Item 18)**:
   - When the active player is being attacked and has no legal moves to defend (cannot cover any attacking card and cannot redirect), trigger an automatic surrender after 3 seconds.
   - Allow the player to manually click the Surrender button before the 3 seconds elapse.
   - Display a clean 3-second countdown indicator on or beside the Surrender button so the player understands the auto-surrender transition.
5. **Timer Tick Sound Integration (< 5 seconds) (Feedback Item 14)**:
   - In `frontend/src/pages/GamePage.tsx`, monitor the active turn clock.
   - Whenever the clock is ticking down below 5 seconds (at 4, 3, 2, 1 seconds remaining), invoke `soundEngine.playClockTick(remainingSeconds)` exactly once per second.
   - Play the ticking sound ONLY for the user whose turn clock is ticking (i.e. only if `view.myId === activeTimedPlayerId`).

## Acceptance Criteria
- [ ] Hand sorting controls render as a single compact dropdown replacing the 3 separate buttons.
- [ ] Cards in the active player's hand that are legal to play automatically shift upwards; non-legal cards do not shift.
- [ ] Dragging cards across the table preserves the pointer finger cursor (`cursor: pointer`), never displaying the slashed circle.
- [ ] If the defender has no legal defense, auto-surrender triggers after 3 seconds unless clicked earlier.
- [ ] A ticking sound plays once per second when the user's turn clock is below 5 seconds, only for that specific active user.
- [ ] All unit and integration tests in `frontend/src/__tests__/` pass (`npm test -- --run`).
- [ ] Backend tests continue to pass (`sbt -batch test`).

## Files to Modify / Create
- `frontend/src/components/SortBar.tsx` (dropdown select implementation)
- `frontend/src/components/GameTable.tsx` (apply legal card upward shift, drag cursor handlers)
- `frontend/src/pages/GamePage.tsx` (defenseless auto-surrender 3s timer, <5s tick audio invocation)
- `frontend/src/styles/table.css` (legal card lift styling, pointer cursor during drag)
- `frontend/src/__tests__/GamePage.test.tsx` (tests for auto-surrender timer, tick sound triggers)
- `frontend/src/__tests__/GameTable.test.tsx` (tests for SortBar dropdown and legal card lift)

## Verification Instructions
1. Run `npm test -- --run` and verify all frontend tests pass.
2. Run `sbt -batch test` to ensure full backend compatibility.
3. Test hand sorting dropdown, legal card upward elevation, drag cursor behavior, defenseless auto-surrender, and ticking sound.
4. Write concise notes in `.reviews/agent_notes.md` summarizing the interaction polish and verification.
5. Run `echo "DONE" > .tickets/STATUS` as the final step.
