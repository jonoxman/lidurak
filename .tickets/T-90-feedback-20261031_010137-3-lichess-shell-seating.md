<!-- WAVE:1 -->
# Ticket T-90-feedback-20261031_010137-3: Frontend Lichess 3-Column Shell, Clockwise Seating & Lobby Chaos Option

## Subsystem
Frontend Layout & Lobby Settings (`frontend/src/pages/*`, `frontend/src/styles/*`, `frontend/src/types.ts`)

## Description & Scope
Implement the Lichess 3-column desktop layout shell, deterministic clockwise seating transformation for 2, 3, and 4 players, fixed Bottom-Left table deck placement, and Chaos Mode lobby controls.

### Requirements Covered
- **Items 8 & 9: Lichess 3-Column Desktop Shell & Zero Table Text Clutter**
  - Use a 3-column CSS Grid shell in `GamePage`:
    `grid-template-columns: 240px minmax(640px, 1fr) 260px; gap: 16px; max-width: 1440px; margin: 0 auto; padding: 16px; align-items: start;`
  - `[data-zone="sidebar-left"]`: Contains How to Play reference panel (moved off the top of screen) & hotseat player-switcher tabs.
  - `[data-zone="table-arena"]`: 3x3 CSS Grid felt table (`#1e2923`).
  - `[data-zone="sidebar-right"]`: Container for digital Turn Clock (`00:XX`) and Durak / Winner status badges.
  - **Zero Table Text Clutter:** Ensure no text banners ("Waiting for first attack...", "Waiting for next move...", "Your turn to defend") are rendered on the table or below the hand.
- **Item 10: Deterministic Clockwise Player Seating**
  - Compute relative clockwise offset for active viewer `myPlayerIndex = i` out of `N` players: `offset = (seatIndex - i + N) % N`.
  - **2 Players (`N = 2`):** Opponent (`offset == 1`) sits at **Top-Center** (`Row 1, Col 2`, `data-seat="top-center"`).
  - **3 Players (`N = 3`):** `offset == 1` (to viewer's left) sits at **Top-Left** (`Row 1, Col 1`, `data-seat="top-left"`). `offset == 2` sits at **Top-Right** (`Row 1, Col 3`, `data-seat="top-right"`).
  - **4 Players (`N = 4`):** `offset == 1` at **Top-Left** (`data-seat="top-left"`), `offset == 2` at **Top-Center** (`data-seat="top-center"`), `offset == 3` at **Top-Right** (`data-seat="top-right"`).
  - Opponent seats render compact badges: player name, card count, `WINNER` / `OUT` badge, and avatar slot.
- **Item 13: Talon Deck & Face-Up Trump Card in Bottom-Left (`Row 3, Col 1`)**
  - Position Talon Deck and perpendicular face-up Trump Card at **`Row 3, Col 1` (`data-zone="table-deck"`)** on the felt table grid.
- **Item 11: Lobby Chaos Mode Toggle**
  - In `LobbyPage.tsx`, add a checkbox for `Chaos mode` (default `false`), selectable only when `playerCount > 2`.
  - Pass `chaosMode` into `createGame` API call and update `frontend/src/types.ts` and `frontend/src/api/client.ts`.

## Target Files
- `frontend/src/pages/GamePage.tsx`
- `frontend/src/pages/LobbyPage.tsx`
- `frontend/src/components/GameTable.tsx`
- `frontend/src/styles/table.css`
- `frontend/src/types.ts`
- `frontend/src/api/client.ts`
- `frontend/src/__tests__/LobbyPage.test.tsx`
- `frontend/src/__tests__/GamePage.test.tsx`
- `frontend/src/__tests__/GameTable.test.tsx`

## Implementation Steps
1. Update `types.ts` and `client.ts` to include `chaosMode?: boolean`, `winners: string[]`, `durak?: string | null`.
2. Update `LobbyPage.tsx`:
   - Add `chaosMode` state (disabled if `playerCount === 2`).
   - Include `chaosMode` in `createGame(playerCount, names, allowRedirect, chaosMode)`.
3. In `GamePage.tsx` and `table.css`:
   - Restructure into the 3-column desktop shell with `[data-zone="sidebar-left"]`, `[data-zone="table-arena"]`, `[data-zone="sidebar-right"]`.
   - Move How to Play and player switchers into `sidebar-left`.
4. In `GameTable.tsx` and `table.css`:
   - Create 3x3 table grid (`grid-template-columns: 1fr 2fr 1fr; grid-template-rows: auto minmax(220px, 1fr) auto;`).
   - Implement clockwise relative seat offset calculation.
   - Render opponent seats in `Row 1` at `top-left`, `top-center`, `top-right`.
   - Render Talon Deck & perpendicular Trump Card in `Row 3, Col 1` (`data-zone="table-deck"`).
   - Strip all text status banners from table.

## Verification Commands
- `npm test -- --run`

## Completion Requirements
- All frontend tests pass (`npm test -- --run`).
- Zero absolute/fixed overlapping positioning used for seats, sidebars, or table zones.
- Update `.reviews/agent_notes.md` with implementation summary.
- Run `echo "DONE" > .tickets/STATUS`.
