<!-- WAVE:2 -->
# T-90-feedback-20261122_193457-4: Wire Single-Row Covered-Pair Collapsing (Item 1) & Non-Overlapping Surrender Turn Timer (Item 4) into GameTable

## Objective
Wire Wave 1's `tableLayout.ts` into `GameTable.tsx` and `table.css` to deliver **Item 1** end-to-end in the live UI, AND resolve **Item 4** so the turn timer above the active user's hand clears BOTH raised/selected hand cards AND incoming cards during an active user's surrender (`SurrenderThrowIn`).

## Scope & Owned Files
- `frontend/src/components/GameTable.tsx`
- `frontend/src/styles/table.css`
- `frontend/src/__tests__/GameTable.test.tsx`
- **DO NOT** edit `handLayout.ts`, `client.ts`, `LobbyPage.tsx`, `GamePage.tsx`, `Card.tsx`, `README.md`, or `ARCHITECTURE.md`.
- **DO NOT** modify hand parting or card drag-image/cursor-lock logic (those are owned by Wave 3 Ticket 6).

## Technical Design & End-to-End Wiring Requirements

### Part A — Item 1: Single-Row Bout Area & Immediate Edge-Snapped Covered Pairs (`GameTable.tsx`, `table.css`)
1. **Determine Defender's Rendered Seat:**
   - Using the existing seat mapping in `GameTable.tsx` (which maps each opponent relative to `myId` to `'top-left' | 'top-center' | 'top-right'`, and `myId` itself to `'bottom'`), resolve `defenderSeat` for `view.defenderIdx`.
   - Call `resolveCoveredPairsEdge(defenderSeat)` from `frontend/src/utils/tableLayout.ts`:
     - `'top-left'`, `'top-center'`, `'bottom'` -> `'left'`
     - `'top-right'` -> `'right'`
2. **Measure Available Bout Row Width & Compute Layout:**
   - Use `ResizeObserver` / measured width of the Row 2 bout container (with sensible desktop/mobile fallback widths for jsdom tests) and pass `(covered.length, uncovered.length, extraOutlineCount, availableWidth, cardWidth, indexStripWidth, defenseOverhang, defenderSeat)` to `computeTableBoutLayout(...)`.
3. **Render Single-Row Bout Container (`flex-wrap: nowrap`):**
   - Inside `[data-zone="table-arena"]` Row 2, render the bout lane as a single horizontal Flexbox row (`display: flex; flex-wrap: nowrap; align-items: center; min-width: 0; box-sizing: border-box;`, NO `position: absolute` placement of bouts).
   - Add clear data attributes for QA & styling:
     - Bout container: `data-testid="table-bout-row"`, `data-covered-edge={layout.coveredEdge}`
     - Covered stack container (rendered whenever `covered.length > 0`): `data-testid="covered-pairs-stack"`, `data-edge={layout.coveredEdge}`
     - Uncovered active container: `data-testid="uncovered-pairs-row"`
   - **Edge Alignment:**
     - When `layout.coveredEdge === 'left'`: render `[data-testid="covered-pairs-stack"]` pinned flush to the **left edge** of the bout row, followed by `layout.groupGapPx`, followed by `[data-testid="uncovered-pairs-row"]` (and active target/redirect outlines).
     - When `layout.coveredEdge === 'right'`: render `[data-testid="uncovered-pairs-row"]` (and active target/redirect outlines) on the left/center, followed by `layout.groupGapPx`, with `[data-testid="covered-pairs-stack"]` pinned flush to the **right edge** of the bout row (e.g., `margin-left: auto` on the right-edge covered stack, or `justify-content: space-between` / flex order).
   - **Covered Pair Maximal Overlap:**
     - Render each covered `TablePair` inside `[data-testid="covered-pairs-stack"]` with consecutive overlap margin `marginLeft: idx === 0 ? 0 : layout.coveredPairMarginPx` (ensuring `coveredPairStep = defenseOverhang + indexStripWidth` = `72px` on desktop `100px` cards so both attack and defense cards' `'10'` rank & suit stay completely visible), with ascending `zIndex` (`idx + 1`) so stacking is clean and deterministic.
     - Covered pairs are non-interactive (`onCover` / drop target disabled on already-covered pairs).
   - **Uncovered Active Cards & Original `attackIndex` Preservation:**
     - Render each uncovered `TablePair` using its **original `pairIndex`** from `partitionTablePairs(view.tablePairs)` so clicking/dropping a covering card sends the exact `attackIndex` expected by the backend!
     - Apply `marginLeft: idx === 0 ? 0 : layout.uncoveredMarginPx` (small positive gap by default, shrinking to slight overlap if needed to stay strictly in one single row).
     - Preserve all existing defender-anchored target outlines (`data-testid="target-outline-<id>"`) and single-card arrow reflection outline (`data-testid="redirect-outline"`), keeping them inside the single-row layout without wrapping or colliding with covered pairs.

### Part B — Item 4: Turn Timer Clears BOTH Raised Hand AND Incoming Surrender Cards (`GameTable.tsx`, `table.css`)
1. **Audit Current Overlap Cause in `GameTable.tsx` & `table.css`:**
   - Inspect where the above-hand turn timer is rendered inside `[data-zone="table-arena"]` and how incoming cards / bout cards are positioned or animated when the active user (`myId === defenderId`) is in `boutPhase === 'surrenderThrowIn'` (or surrendering / receiving throw-in cards).
   - Identify why the turn timer currently collides with incoming cards during active-user surrender (e.g., negative margin / upward transform on the timer pushing it into Row 2, downward shift of defender-anchored/incoming surrender cards into the timer's band, or insufficient CSS Grid row separation).
2. **Enforce Dedicated Zero-Overlap Vertical Band (CSS Grid / Flexbox):**
   - Structure `[data-zone="table-arena"]` with explicit non-overlapping vertical tracks / flex bands (`gap`, `min-height`, `box-sizing: border-box`, zero `position: absolute` overlaps):
     - Row 1: Opponent seats (`top-left`, `top-center`, `top-right`).
     - Row 2: Single-row bout area (including incoming cards during `SurrenderThrowIn`) with bounded height and bottom clearance so incoming surrender cards NEVER descend into the lower-table control/timer band.
     - Dedicated Lower-Table Control & Turn Timer Band (between Row 2 and Row 3): houses the above-hand turn timer (keeping it in the same general location above `[data-zone="player-hand"]`) and `[data-testid="action-bar"]` (`data-placement="lower-table-controls"`), with explicit vertical clearance both **above** (clearing Row 2's bout & incoming surrender cards) and **below** (clearing `SELECTED_LIFT_PX` / `HAND_SELECTED_RAISED_OFFSET` of fully selected cards in `[data-zone="player-hand"]`).
     - Row 3: Col 1 = `[data-zone="table-deck"]`, Col 2 = `[data-zone="player-hand"]`, Col 3 = `SortBar`.
   - Ensure during `SurrenderThrowIn` (when the active user is the defender with 1–6 incoming cards on the table):
     - Incoming cards stay strictly above `timerRect.top` (`incomingCardRect.bottom <= timerRect.top`).
     - Raised playable and fully selected hand cards stay strictly below `timerRect.bottom` (`timerRect.bottom <= handCardRect.top`).
     - The timer remains unclipped (`overflow: visible`), legible, and clear of `[data-testid="action-bar"]`, `[data-zone="table-deck"]`, and `SortBar`.
   - Remember AGENTS.md Rule 3: **Zero Table Text Clutter** — do not add any explanatory text banners on the table.

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-1a (Verbatim):** "Collapse table cards together as they are covered if there is not sufficient space. As cards are played into the game table area, they should always stay collected in one row. If necessary, this will require reducing the gaps between the cards already on the table when a new card is added, or even allow overlap." — `[data-testid="table-bout-row"]` enforces `flex-wrap: nowrap` and dynamically reduces gaps / allows slight overlap so all covered and uncovered table cards stay on one single row.
- [ ] **ITEM-1b (Verbatim):** "Pairs of cards that are already covering/covered should be moved to the nearest vertical edge of the game table (left or right, depending on the target player), since they cannot be further interacted with directly. ... Default to left edge for the top-left and center player, and right edge for the top-right player. Always move covered pairs to the edge." — Wired in `GameTable.tsx` & `table.css`: covered pairs immediately snap to the left edge when defender is `top-left`, `top-center`, or bottom (`myId`), and to the right edge when defender is `top-right`.
- [ ] **ITEM-1c (Verbatim):** "Multiple instances of these covering card pairs on the table should be overlapping maximally in such a way that the suit and rank of all cards is still visible, in a similar way to how the hand maximally overlaps." — Covered pairs inside `[data-testid="covered-pairs-stack"]` overlap at `coveredPairStep = defenseOverhang + indexStripWidth` (`72px` desktop) keeping every covered card's rank (including `'10'`) and suit fully visible.
- [ ] **ITEM-1d (Verbatim):** "Remaining active as-yet uncovered cards should maintain a small gap between each other and the covered cards by default, but they can be allowed to overlap slightly if necessary to keep all cards on one single row in the game table area." — Uncovered active cards preserve original `attackIndex` for covering, maintain default gaps from each other and the covered stack, and compress smoothly to stay in one row.
- [ ] **ITEM-4a (Verbatim):** "The turn timer clears the active hand correctly, but now overlaps incoming cards in the case of an active user's surrender." — Turn timer sits in a dedicated non-overlapping band inside `[data-zone="table-arena"]` above `[data-zone="player-hand"]` that maintains strict vertical clearance from BOTH raised/selected hand cards AND incoming cards during an active user's surrender (`SurrenderThrowIn`), with zero bounding-box overlap against any gameplay element.
- [ ] Unit/component tests added in `frontend/src/__tests__/GameTable.test.tsx` verifying:
  - Covered pairs snap immediately to `data-edge="right"` for `top-right` defender and `data-edge="left"` for `top-left`, `top-center`, and bottom defender.
  - Clicking/dropping on an uncovered card after other pairs are covered submits the exact original `attackIndex`.
  - In `SurrenderThrowIn` with `myId` as defender and incoming cards on the table, the turn timer is rendered in its dedicated non-overlapping band and does not collide with incoming cards or raised hand cards.
- [ ] Run `npm test -- --run` in `frontend/` and verify all tests pass.
- [ ] Write a concise summary to `.reviews/agent_notes.md` and run `echo "DONE" > .tickets/STATUS` only after all tests pass.

