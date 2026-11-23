<!-- WAVE:2 -->
# Ticket 5: Fixed-Size Tinted Play Area Box, Active Hand Highlight Alignment & Surrender Card Shift

## Summary
Implement three table arena visual and spatial improvements in `GameTable.tsx` and `table.css`:
1. Make the tinted box in the play area (where active bout cards are placed) a **fixed size relative to the table size** so it scales with the window size instead of dynamically changing size with the number of cards in play (Item 7).
2. Fix the highlighting box around the active user's cards when it is their turn to play so that the cards in the hand are always **strictly and accurately inside** this box (Item 8).
3. When a player surrenders (`BoutPhase === 'Surrendered'`), visually indicate this by shifting all of the cards in play towards the area of the game table close to the surrendering player's box (Item 11).

## Files to Modify
- `frontend/src/components/GameTable.tsx`
- `frontend/src/styles/table.css`
- `frontend/src/__tests__/GameTable.test.tsx`

*(Do NOT modify `GamePage.tsx`, `HeaderBar.tsx`, `CardBack.tsx`, `LobbyPage.tsx`, `app.css`, `README.md`, or `ARCHITECTURE.md` in this ticket.)*

## Requirements

### 1. Fixed-Size Tinted Box in the Play Area (Item 7)
- In Row 2 of `GameTable.tsx` (the central play area / battlefield where `tablePairs`, target outlines, and redirect outlines appear), the tinted container box currently grows or shrinks based on how many cards are in play.
- Give this tinted play-area box (`data-testid="play-area-box"` / `.battlefield-tinted-box` or existing battlefield container class) a **fixed width and height relative to the table size** (e.g., percentage / viewport-relative dimensions within the Row 2 grid area such as `width: 88%; height: 100%; min-height: 150px; box-sizing: border-box;` centered in Row 2) rather than `fit-content` or card-count-dependent sizing.
- Its dimensions relative to the table must remain constant regardless of whether there are 0, 1, 2, or 6 card pairs in play, while scaling smoothly when the window/table resizes.

### 2. Active User's Hand Turn Highlight Box Alignment (Item 8)
- When it is the active user's turn to play, the turn-highlighting box around the active user's hand (`data-testid="hand-turn-highlight"` or `.hand-cards-container` / `.player-hand` highlight wrapper) must align with the actual rendered cards so that **every card in the hand sits completely inside the highlight box**.
- Ensure:
  - The highlight border/glow wraps the actual card row container with `box-sizing: border-box` and symmetric internal padding.
  - The container's height and width match the full rendered height (`--card-h` plus any hover/trump offset headroom) and width of the cards in the hand so cards never protrude above, below, left, or right of the highlight box.

### 3. Shifting Cards in Play Toward the Surrendering Player's Box (Item 11)
- When `view.boutPhase === 'Surrendered'`, visually shift all of the cards in play (`tablePairs` group inside the play area) towards the area of the game table close to the surrendering defender's player box:
  - Determine the surrendering defender's seat direction relative to the active viewer: `'bottom'` (when the viewer is the defender), `'top-left'`, `'top-center'`, or `'top-right'` (matching the opponent seat in Row 1).
  - Set `data-surrendered="true"` and `data-surrender-target={defenderSeatDirection}` on the cards-in-play container (`data-testid="table-pairs-group"` or battlefield pairs wrapper).
  - Add CSS rules in `table.css` (using Flexbox/Grid alignment and smooth CSS `transform: translate(...)` shifts, never `position: absolute` or `position: fixed`) that shift the cards in play toward the `'top-left'`, `'top-center'`, `'top-right'`, or `'bottom'` edge of the play area closest to that player's box.

## Acceptance Criteria & Testing
1. Add unit tests in `frontend/src/__tests__/GameTable.test.tsx` verifying:
   - The tinted play-area box maintains its fixed table-relative sizing class/style across 0, 1, and multiple cards in play.
   - When it is the player's turn, all rendered hand cards (`.hand-slot` / `.card`) are contained directly inside the aligned turn-highlight box element.
   - When `boutPhase === 'Surrendered'`, the cards in play container has `data-surrendered="true"` and `data-surrender-target` set to `'bottom'`, `'top-left'`, `'top-center'`, or `'top-right'` matching the surrendering defender's seat.
2. Run `cd frontend && npm test -- --run` and ensure all frontend tests pass.
