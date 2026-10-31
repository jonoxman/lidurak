<!-- WAVE:2 -->
# Ticket T-90-feedback-20261031_010137-5: Frontend Defender-Anchored Battlefield, Target Outlines & Perevod Outline

## Subsystem
Frontend Battlefield Table (`frontend/src/components/*`, `frontend/src/styles/table.css`)

## Description & Scope
Implement defender-anchored bout positioning, initial attack target outlines (including Chaos Mode multi-targeting), card-shaped Perevod redirection outline with directional arrows, and subtle redirection shake.

### Requirements Covered
- **Item 12: Defender-Anchored Bout Area & Target Outlines**
  - **Initial Attack Target Outlines:** Before the first card of a bout is played, render a highlighted single-card Target Outline (`width: 72px; height: 104px; border: 2px dashed #629924; border-radius: 8px;`, `data-testid="target-outline-<playerId>"`) directly in front of each legal attack target.
    - If `chaosMode == false`, render 1 target outline in front of the clockwise defender (at `top-left`, or `top-center` in 2p).
    - If `chaosMode == true`, render target outlines in front of all active opponents with cards.
    - All players see these target outlines.
  - **Defender-Anchored Bout Cards:** In Row 2 of felt table (`[data-zone="table-arena"]`), position `tableBouts` and active drop outlines in the zone of the **current defending player**:
    - If opponent at `top-left`, `top-center`, or `top-right` is defending, anchor bout row in front of their seat (`justify-self: start / center / end; align-self: start;`).
    - If active viewer (bottom player) is defending, anchor bout cards at the bottom of battlefield area (`align-self: end; justify-self: center;` directly above viewer's hand).
- **Item 14: Card-Shaped Redirection (`Perevod`) Outline with Directional Arrow**
  - Remove the text `"PEREVODZHU!"`.
  - Make reflection outline the exact size and shape of a single card (`width: 72px; height: 104px;`, `data-testid="redirect-outline"`), placed immediately to the right of attacking cards in the bout row whenever redirection is legal.
  - Inside outline, render an SVG multi-arrow reflection icon with a directional arrow pointing toward the seat (`top-left`, `top-center`, `top-right`) of the target receiving player (or a split shuffle arrow icon when `chaosMode == true` with >2 active players).
- **Item 15: Subtle Reflection Shake**
  - Implement a subtle `180ms` horizontal nudge (`±4px`) CSS animation on redirection, eliminating excessive screen shake.

## Target Files
- `frontend/src/components/GameTable.tsx`
- `frontend/src/components/TablePair.tsx`
- `frontend/src/styles/table.css`
- `frontend/src/__tests__/GameTable.test.tsx`

## Implementation Steps
1. In `GameTable.tsx`, compute the current defender's relative seat position (`top-left`, `top-center`, `top-right`, or `bottom`).
2. Style Row 2 (`.table-center` / `.bout-arena`) to anchor cards dynamically to the defender's position using CSS grid alignment (`justify-self`, `align-self`).
3. Render Target Outlines before initial attack:
   - Calculate legal target IDs based on `chaosMode` and active players with cards.
   - Render `data-testid="target-outline-<id>"` with dashed `#629924` border in front of each target seat.
4. Implement `data-testid="redirect-outline"`:
   - Size: `72px x 104px`.
   - Render SVG reflection arrow pointing toward next defender's seat (or split arrow for chaos).
   - Remove any `"PEREVODZHU!"` text.
5. In `table.css`, add subtle shake animation (`@keyframes redirectNudge { 0% { transform: translateX(0); } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } 100% { transform: translateX(0); } }`, `180ms ease-in-out`).

## Verification Commands
- `npm test -- --run`

## Completion Requirements
- All tests pass in `npm test -- --run`.
- Outlines match `data-testid="target-outline-<playerId>"` and `data-testid="redirect-outline"`.
- Update `.reviews/agent_notes.md` with implementation summary.
- Run `echo "DONE" > .tickets/STATUS`.
