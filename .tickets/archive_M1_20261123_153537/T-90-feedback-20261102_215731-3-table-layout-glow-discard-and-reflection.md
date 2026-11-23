<!-- WAVE:1 -->
# Ticket T-90-feedback-20261102_215731-3: Tight Hand Turn-Highlight Glow for Throw-In Players, Discard Pile Overhaul & Reflection Outline Alignment

## Summary
1. Fix the active hand glowing box (`[data-testid="hand-turn-highlight"]`) in `GameTable.tsx` and `table.css` so that:
   - It tightly hugs only the rendered cards in the player's hand (`ITEM-3a`).
   - It displays not only for the opening attack (`InitialAttack`), but also after the first card has been played for all players who are able to throw in (`ThrowInCards`) (`ITEM-3b`).
2. Update the discard pile in `TableDeck` (`GameTable.tsx` and `table.css`) to:
   - Remove the counter for the number of discarded cards (`ITEM-7a`).
   - Use the same single-row responsive overlapping logic used to display hands (`handLayout` / `handMargins`) so the discarded cards always fit inside the discard pile box element (`ITEM-7b`).
   - Enlarge the discard pile cards to match the size of the talon deck cards (`ITEM-7c`).
3. Adjust the dashed arrow reflection outline (`[data-testid="redirect-outline"]`) in `GameTable.tsx`, `TablePair.tsx`, and `table.css` so it is always perfectly aligned vertically with the other cards in play (`ITEM-8`).

## File Scope (Exclusive to this Ticket in Wave 1)
- `frontend/src/components/GameTable.tsx`
- `frontend/src/components/TablePair.tsx`
- `frontend/src/styles/table.css`
- `frontend/src/__tests__/GameTable.test.tsx`

**IMPORTANT:** Do NOT touch `frontend/src/pages/GamePage.tsx`, `frontend/src/components/Card.tsx`, `frontend/src/styles/tableTextures.ts`, `frontend/src/types.ts`, `backend/**`, `README.md`, `ARCHITECTURE.md`, or `play-local.sh` in this ticket.

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-3a (Verbatim):** "3. The glowing box still doesn't hug the cards correctly. Additionally, it does not display after a first card has been played. The correct spec should be that it displays for all players that are able to throw in after the initial attack has been played." (Part 1: Hugging the cards)
  - In `frontend/src/components/GameTable.tsx` and `frontend/src/styles/table.css`:
    - Measure available hand width on the outer `[data-zone="player-hand"]` wrapper (not on `.hand-cards` with `width: 100%`), and style `.hand-cards` (`[data-testid="hand-turn-highlight"]`) with `display: inline-flex; width: fit-content; max-width: 100%; flex: 0 0 auto; align-items: center; justify-content: center; box-sizing: border-box;` and tight, symmetric padding (e.g., `padding: 4px; border-radius: calc(var(--card-radius, 8px) + 4px);`).
    - Ensure `.hand-slot` and `.playing-card` inside `.hand-cards` have no extra wrapper margins, baseline gaps, or stretched flex widths, so the glowing box (`turn-highlight` / `[data-active="true"]`) hugs the exact outer perimeter of the overlapped card cluster on all four sides (top, bottom, left, right).

- [ ] **ITEM-3b (Verbatim):** "3. The glowing box still doesn't hug the cards correctly. Additionally, it does not display after a first card has been played. The correct spec should be that it displays for all players that are able to throw in after the initial attack has been played." (Part 2: Displaying for all players able to throw in after the initial attack)
  - In `frontend/src/components/GameTable.tsx`:
    - Check how the hand turn-highlight state (`isHandHighlighted` / `showHandGlow` / `data-active` / `turn-highlight` class on `[data-testid="hand-turn-highlight"]`) is computed.
    - Ensure the glowing box around the hand displays whenever `!reviewMode` and:
      1. The player can play the initial attack (`view.legalActions.some(a => a.type === 'InitialAttack')`), **OR**
      2. After the initial attack has been played (`view.tablePairs.length > 0` / `view.boutPhase === 'Defense' || view.boutPhase === 'SurrenderThrowIn'`), the player is able to throw in cards (`view.legalActions.some(a => a.type === 'ThrowInCards')`).
    - Do NOT suppress the hand glowing box when `view.tablePairs.length > 0` or while attacking cards are uncovered or covered — any player who has at least one legal `ThrowInCards` action in `view.legalActions` must see the glowing box around their hand!

- [ ] **ITEM-7a (Verbatim):** "7. Make the following adjustments to the discard pile: remove the counter for the number of discarded cards; implement the same overlapping logic used to display hands to ensure the discarded cards always fit in the discard pile box element; enlarge the cards to match the size of the deck." (Part 1: Remove counter)
  - In `frontend/src/components/GameTable.tsx` (`TableDeck`) and `frontend/src/styles/table.css`:
    - Remove the counter badge/oval showing the number of discarded cards (`data-testid="discard-count-badge"` / `.discard-count` / numeric discard counter) from the discard pile so no discard count number is rendered.

- [ ] **ITEM-7b (Verbatim):** "7. Make the following adjustments to the discard pile: remove the counter for the number of discarded cards; implement the same overlapping logic used to display hands to ensure the discarded cards always fit in the discard pile box element; enlarge the cards to match the size of the deck." (Part 2: Hand overlapping logic so discarded cards always fit in the discard pile box)
  - In `frontend/src/components/GameTable.tsx` (`TableDeck`) and `frontend/src/styles/table.css`:
    - Render the discarded cards inside the discard pile box (`[data-testid="discard-pile"]`) using the same single-row overlap calculation used for hands (`handLayout` and `handMargins`, plus tightening overlap whenever `count` cards would otherwise exceed the discard pile container's inner width so `totalWidth <= availableWidth` is strictly guaranteed).
    - Measure the discard pile box's available inner width (via `ResizeObserver` with a sensible fallback width matching the sidebar box inner width, and support pointer movement `cursorFraction` across the discard row just like `.hand-cards`) and apply negative `marginLeft` to each card slot after the first so the cards never wrap (`flex-wrap: nowrap`) and never overflow the discard pile box element (`min-width: 0; max-width: 100%; overflow: hidden; box-sizing: border-box;`).

- [ ] **ITEM-7c (Verbatim):** "7. Make the following adjustments to the discard pile: remove the counter for the number of discarded cards; implement the same overlapping logic used to display hands to ensure the discarded cards always fit in the discard pile box element; enlarge the cards to match the size of the deck." (Part 3: Enlarge discard pile cards to match the size of the deck)
  - In `frontend/src/components/GameTable.tsx` (`TableDeck`) and `frontend/src/styles/table.css`:
    - Enlarge the cards rendered in the discard pile so their width and height match the exact card dimensions of the talon deck in `TableDeck` (e.g., matching `.table-talon-stack` / `.deck-card` width and height, removing any smaller `.discard-card` scale/size overrides).
    - Pass the deck card width as `cardWidth` into `handLayout(discardCards.length, discardAvailableWidth, discardCursorFraction, deckCardWidth)` so the overlap calculation uses the enlarged deck-sized card width.

- [ ] **ITEM-8 (Verbatim):** "8. Everything works correctly. However, adjust the dashed arrow reflection outline so that it always is perfectly aligned vertically with the other cards in play."
  - In `frontend/src/components/GameTable.tsx`, `frontend/src/components/TablePair.tsx`, and `frontend/src/styles/table.css`:
    - Inspect `.table-pairs-group`, `.table-pair`, `.attack-card`, and `[data-testid="redirect-outline"]` (`.redirect-outline`).
    - Ensure `.redirect-outline` has the exact same card height, `box-sizing: border-box`, and vertical alignment (`align-self` / `margin-top` / `margin-bottom`) as the `.attack-card` / `.table-pair` cards in `.table-pairs-group`, and eliminate any extra vertical offset, padding asymmetry, or height mismatch on `.table-pair` vs `.redirect-outline` so that `[data-testid="redirect-outline"]` is always perfectly aligned vertically (top edge, center, and bottom edge) with the other cards in play.

## Testing & Verification Commands
Run from `frontend/`:
```bash
cd frontend && npm test -- --run
```
Add and update unit tests in `frontend/src/__tests__/GameTable.test.tsx` covering `ITEM-3a`, `ITEM-3b`, `ITEM-7a`, `ITEM-7b`, `ITEM-7c`, and `ITEM-8`. All Vitest suites must pass.
