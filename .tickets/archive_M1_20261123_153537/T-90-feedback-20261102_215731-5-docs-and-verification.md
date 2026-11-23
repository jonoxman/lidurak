<!-- WAVE:3 -->
# Ticket T-90-feedback-20261102_215731-5: Real-Time Documentation Synchronization (`README.md`, `ARCHITECTURE.md`, `play-local.sh`) & Full Stack Verification

## Summary
Synchronize `./README.md`, `./ARCHITECTURE.md`, and `./play-local.sh` with all newly implemented features and fixes from Wave 1 and Wave 2, and run the complete backend and frontend test suites to verify everything passes cleanly.

## File Scope (Wave 3)
- `README.md`
- `ARCHITECTURE.md`
- `play-local.sh`

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-DOCS-1 (`README.md` Synchronization):**
  - Update `README.md` so it accurately documents:
    - **Computer Opponents (`RandomBot` & `BasicBot`):** `RandomBot` plays its moves instantly (`0 ms` delay), while `BasicBot` plays after a short random delay (`500 ms`–`2000 ms`).
    - **Card Faces & Theme-Adaptive Card Fronts:** Pips never overlap the corner rank/suit symbol (including on `10`s), and the card front background is white in the Light theme and grey in the Dark theme.
    - **Table Textures in Light & Dark Themes:** All six felt table presets display the exact same texture pattern in both Light and Dark themes, differing only in their color palette.
    - **Hand Turn-Highlight Glow:** Tightly hugs the rendered cards in the player's hand and displays for the initial attacker as well as for all players able to throw in cards (`ThrowInCards`) after the initial attack has been played.
    - **Discard Pile:** Displays inside the `DECK` box without a numeric card counter, using the same single-row responsive overlapping logic as hands so cards always fit inside the discard pile box, with cards enlarged to match the talon deck size.
    - **Reflection Outline:** The dashed arrow reflection outline (`Perevod`) is always vertically aligned with the other cards in play.
    - **POV & Player List `(You)` Indicator:** Appends `(You)` to the end of the active user's name in both the POV selector/tabs and the `PLAYERS` list.
    - **Game Over Banner & Interactive Review Mode:** The Game Over banner pops up immediately when a game finishes and remains visible alongside the interactive Replay panel; visiting a finished game's URL loads the finished game and review mode immediately; pressing the Left and Right keyboard arrow keys (`ArrowLeft` / `ArrowRight`) steps backward and forward through replay frames.

- [ ] **ITEM-DOCS-2 (`ARCHITECTURE.md` Synchronization):**
  - Update `ARCHITECTURE.md` to document:
    - `GameActor` per-bot-type timing (`0.millis` instant execution for `RandomBotSeat`, `500.millis`–`2000.millis` random delay for `BasicBotSeat`) and `BoutPhase.GameOver` broadcast/replay guarantees.
    - `GamePage.tsx` game-over banner persistence during review mode, replay fallback hydration when visiting a finished game's URL, `ArrowLeft`/`ArrowRight` keyboard navigation in review mode, and `(You)` active viewer formatting in POV and `PLAYERS` list elements.
    - `GameTable.tsx` and `table.css` tight `.hand-cards` turn-highlight bounding box, throw-in hand glow eligibility, deck-sized overlapping discard pile without a counter badge, and vertically aligned `.redirect-outline`.
    - `Card.tsx` non-overlapping pip coordinates (including `10`s) and theme-dependent card front background (white in light theme, grey in dark theme).
    - `tableTextures.ts` and `table.css` shared texture geometry across dark and light palettes.

- [ ] **ITEM-DOCS-3 (`play-local.sh` & End-to-End Test Suite Verification):**
  - Verify `play-local.sh` is up to date and executable.
  - Run both backend and frontend test suites and confirm 100% pass rate:
    - `cd backend && sbt -batch test`
    - `cd frontend && npm test -- --run`

## Testing & Verification Commands
```bash
cd backend && sbt -batch test
cd frontend && npm test -- --run
```
Both suites must pass with zero failures before writing `.reviews/agent_notes.md` and signaling `DONE`.
