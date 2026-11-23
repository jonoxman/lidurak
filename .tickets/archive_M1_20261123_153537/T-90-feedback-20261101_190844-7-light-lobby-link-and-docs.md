<!-- WAVE:3 -->
# Ticket 7: Light Theme Back-to-Lobby Contrast & Real-Time Documentation Synchronization

## Summary
1. Give the "Back to Lobby" element in `GamePage.tsx` strong visual contrast specifically in the light theme while keeping its dark-theme appearance unchanged (Item 5).
2. Update `./README.md` and `./ARCHITECTURE.md` to document all 13 features and fixes implemented across this feedback batch.

## Files to Modify
- `frontend/src/pages/GamePage.tsx`
- `frontend/src/styles/table.css`
- `frontend/src/app.css`
- `frontend/src/__tests__/GamePage.test.tsx`
- `README.md`
- `ARCHITECTURE.md`

## Requirements

### 1. Light Theme Contrast for Back to Lobby Element (Item 5)
- Keep the dark theme styling of the Back to Lobby element (`.back-to-lobby` / `.lobby-link` in `GamePage.tsx`) unchanged.
- Specifically under `html[data-theme='light']` (and the `@media (prefers-color-scheme: light)` rule for `html:not([data-theme])`), style the Back to Lobby button/link with high contrast:
  - Strong dark text color (e.g., `#0f172a` with `font-weight: 600`),
  - Distinct surface background (e.g., `#e2e8f0`, hover `#cbd5e1`),
  - Clearly visible border (e.g., `1px solid #64748b`, hover `#334155`).

### 2. Real-Time Documentation Maintenance (`README.md` & `ARCHITECTURE.md`)
- Update `./README.md` and `./ARCHITECTURE.md` so they accurately describe all changes from this batch:
  1. **Bot Legal Move Invariants:** `GameEngine`, `RandomBot`, and `BasicBot` prevent redirecting when the next active player has `0` cards or fewer than `tablePairs.size + 1` cards, prevent self-redirects and self-covers, and forbid defender actions once `BoutPhase.Surrendered` is entered.
  2. **`BasicBot`:** Heuristic bot option selectable in the Lobby seat dropdown below `RandomBot` (`"basicBot"` in `playerTypes`). Always defends or redirects over surrendering when legal, leads with its lowest-ranked non-trump card (or a random trump if holding only trumps), and throws in all legal non-trump cards when another player surrenders.
  3. **Ping Indicator Colors:** 3 and 4 bars are green, 2 bars are yellow, and 1 bar is red.
  4. **Sound Menu Volume Slider:** Plays a single sample sound only when the mouse/pointer is released from the slider.
  5. **Theme-Adaptive Monochrome Card Backs:** The 6 non-colorful card backs adapt to the current theme (`dark` vs `light`), while the 7 colorful gradient card backs stay unchanged.
  6. **Back to Lobby Light-Theme Contrast:** High-contrast border, surface, and text styling in the light theme.
  7. **Deck Box & Top-Left Counter:** Right sidebar deck box includes a `'DECK'` title, centers the deck + horizontal exposed trump + `TRUMP` badge assembly, and places the deck card counter oval on the top-left of the deck.
  8. **Hand Sorting Box:** The hand sorting dropdown (`SortBar`) sits outside the play area in its own box element directly under the deck box in the right sidebar.
  9. **Fixed-Size Tinted Play-Area Box:** The tinted box in the center battlefield has a fixed size relative to the table (scaling with the window) rather than resizing with the number of cards in play.
  10. **Active Hand Turn Highlight Alignment:** The turn-highlight box tightly encloses the rendered cards in the active player's hand.
  11. **Surrender Card Shift:** When a player surrenders, all cards in play shift toward the area of the table close to that player's box.
  12. **Opponent Player Boxes:** Opponent cards are centered inside their player box with a top-left counter oval instead of `'N cards'` text underneath.

## Acceptance Criteria & Testing
1. Add/update unit tests in `frontend/src/__tests__/GamePage.test.tsx` verifying the Back to Lobby element and its light-theme contrast styling.
2. Run both test suites (`cd backend && sbt -batch test` and `cd frontend && npm test -- --run`) and verify all tests pass with zero errors.
