<!-- WAVE:1 -->
# Ticket: Frontend UI Architecture — Lichess 3-Column Shell, Clockwise Seating & Zero Clutter

## 1. Description & Goal
Refactor the frontend desktop layout into the Lichess 3-column shell (Items 8 & 9), implement deterministic clockwise player seating in a 3x3 CSS Grid table felt (Item 10), relocate the Talon Deck and Trump card to Bottom-Left (Item 13), and eliminate all table text clutter in accordance with UI & CSS Grid spatial rules.

## 2. Requirements & Specification

### Items 8 & 9: Lichess 3-Column Shell & Zero Table Text Clutter
1. **Lichess 3-Column CSS Grid Shell:**
   - Update `frontend/src/pages/GamePage.tsx` and `frontend/src/styles/table.css` to use a strict 3-column desktop layout:
     ```css
     grid-template-columns: 240px minmax(640px, 1fr) 260px;
     gap: 16px;
     max-width: 1440px;
     margin: 0 auto;
     padding: 16px;
     align-items: start;
     box-sizing: border-box;
     ```
   - **Left Sidebar (`[data-zone="sidebar-left"]`):** Contains the "How to Play" panel (moved completely off the top of the table into this sidebar) and hotseat player-switcher tabs.
   - **Center Column (`[data-zone="table-arena"]`):** Minimalist felt game table (`#1e2923`).
   - **Right Sidebar (`[data-zone="sidebar-right"]`):** Digital turn clock placeholder (`00:15`) in monospace font (`font-size: 2.25rem; font-family: monospace;`), player status badges, and winner/durak indicators.
2. **Zero Table Text Clutter:**
   - Remove all instructional and status text banners from inside the game table and below the hand (e.g., *"Waiting for the first attack..."*, *"Waiting for the next move..."*, *"Your turn to defend"*).

### Item 10: Deterministic Clockwise Seating (3x3 CSS Grid Felt Table)
1. **Grid Arena Specification:**
   - Set `[data-zone="table-arena"]` to:
     ```css
     display: grid;
     grid-template-columns: 1fr 2fr 1fr;
     grid-template-rows: auto minmax(220px, 1fr) auto;
     gap: 16px;
     min-height: 620px;
     padding: 20px;
     background-color: #1e2923;
     border-radius: 8px;
     box-sizing: border-box;
     ```
   - **Row 1:** Opponent seats (`Col 1`, `Col 2`, `Col 3`).
   - **Row 2:** Bout area and target outlines (spans Col 1 to 3 or sits in Col 2).
   - **Row 3:** Col 1 = Talon Deck & Trump (`data-zone="table-deck"`), Col 2 = Active Player's Hand (`data-zone="player-hand"`), Col 3 = Controls / SortBar area (`data-zone="player-controls"`).
2. **Clockwise Seating Math:**
   - For active viewer index `i` out of `N` players, compute relative clockwise offset `offset = (seatIndex - i + N) % N`:
     - **2 Players (`N = 2`):** Opponent (`offset == 1`) sits at **Top-Center** (`Row 1, Col 2`, `data-seat="top-center"`).
     - **3 Players (`N = 3`):** Opponent `offset == 1` at **Top-Left** (`Row 1, Col 1`, `data-seat="top-left"`). Opponent `offset == 2` at **Top-Right** (`Row 1, Col 3`, `data-seat="top-right"`).
     - **4 Players (`N = 4`):** `offset == 1` at **Top-Left** (`Row 1, Col 1`), `offset == 2` at **Top-Center** (`Row 1, Col 2`), `offset == 3` at **Top-Right** (`Row 1, Col 3`).
   - Render compact opponent badges with player name, card count, avatar placeholder, and `WINNER` / `OUT` indicator.

### Item 13: Talon Deck & Displayed Trump Card at Bottom-Left
- Position the Talon Deck and perpendicular face-up Trump Card at **Bottom-Left (`Row 3, Col 1`, `data-zone="table-deck"`)**.
- The trump card sits face up beneath the face-down talon deck, rotated 90 degrees, showing rank, suit, and remaining deck count.

## 3. Files to Touch
- `frontend/src/pages/GamePage.tsx`
- `frontend/src/components/GameTable.tsx`
- `frontend/src/styles/table.css`
- `frontend/src/app.css`
- `frontend/src/__tests__/GamePage.test.tsx`
- `frontend/src/__tests__/GameTable.test.tsx`

## 4. Verification & Testing
- Run `npm test -- --run` to verify UI renders correctly without regressions.
- Verify in test assertions:
  - 3-column zones exist: `data-zone="sidebar-left"`, `data-zone="table-arena"`, `data-zone="sidebar-right"`.
  - Opponents are positioned according to clockwise formula (`data-seat="top-left"`, `data-seat="top-center"`, `data-seat="top-right"`).
  - Deck is located at `data-zone="table-deck"`.
  - No text clutter strings exist in the table DOM.

## 5. Autonomous Agent Workflow Steps
1. Run `git status` and `git diff` to inspect current state.
2. Refactor layout and CSS in `GamePage.tsx`, `GameTable.tsx`, and `table.css`.
3. Update and run test suite with `npm test -- --run`.
4. Document implemented features in `.reviews/agent_notes.md`.
5. Signal completion: `echo "DONE" > .tickets/STATUS`.
