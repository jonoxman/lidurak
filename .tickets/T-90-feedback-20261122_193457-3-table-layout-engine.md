<!-- WAVE:1 -->
# T-90-feedback-20261122_193457-3: Single-Row Table Bout Layout Engine & Covered-Pair Edge-Stack Geometry

## Objective
Implement the pure layout calculation engine (`frontend/src/utils/tableLayout.ts`) and supporting `TablePair` presentation props (`frontend/src/components/TablePair.tsx`) for **Item 1**:
- Always move covered pairs immediately to the designated vertical edge of the game table (`left` for `top-left`, `top-center`, and `bottom` defender; `right` for `top-right` defender).
- Overlap multiple covered pairs maximally while keeping the full rank (including `'10'`) and suit of BOTH cards in every covered pair visible.
- Keep all remaining uncovered active cards (plus covered pairs and target/redirect outlines) collected in one single horizontal row, using a small gap by default and compressing gaps or allowing slight overlap when horizontal space is tight.

## Scope & Owned Files (Pure Layout Module + `TablePair.tsx`)
- `frontend/src/utils/tableLayout.ts` (new file)
- `frontend/src/components/TablePair.tsx`
- `frontend/src/__tests__/tableLayout.test.ts` (new file)
- **DO NOT** edit `GameTable.tsx`, `table.css`, `handLayout.ts`, `LobbyPage.tsx`, `GamePage.tsx`, `README.md`, or `ARCHITECTURE.md`.

## Technical Design Requirements

1. **Defender Seat -> Edge Resolution (`resolveCoveredPairsEdge`):**
   - Input: defender seat identifier (`'top-left' | 'top-center' | 'top-right' | 'bottom'`).
   - Exact mapping per human decision:
     - `'top-left'` -> `'left'`
     - `'top-center'` -> `'left'`
     - `'bottom'` (center/active player) -> `'left'`
     - `'top-right'` -> `'right'`

2. **Partitioning Table Pairs Preserving Original `attackIndex` (`partitionTablePairs`):**
   - Given `tablePairs: TablePair[]`:
     - Covered pairs (`pair.defense != null`): ALWAYS placed in the edge-pinned covered stack immediately upon being covered (never waiting for overflow).
     - Uncovered active pairs (`pair.defense == null`): placed in the active uncovered group.
   - Every partitioned entry MUST preserve its original `pairIndex` (index in `view.tablePairs`) so `CoverCard(playerId, attackIndex, card)` actions and drop targets always submit the exact backend `attackIndex`!

3. **Covered-Pair Maximal Visible-Index Overlap Geometry:**
   - Each covered `TablePair` consists of an attack card (`cardWidth × cardHeight`) plus its defense card shifted horizontally by `defenseOverhang = Math.round(cardWidth * BOUT_DEFENSE_OVERHANG_RATIO)` (`36px` on `100px` desktop card; proportional on `48px` mobile card, matching `CARD_INDEX_STRIP_WIDTH_PX`).
   - Total visual width of one covered pair is `coveredPairWidth = cardWidth + defenseOverhang` (`136px` desktop).
   - For multiple covered pairs (`k >= 2`) stacked at the vertical edge so that the full rank (including `'10'`) and suit of BOTH the attack card AND the defense card of every covered pair remain visible:
     - The attack card's visible left strip is `[0, indexStripWidth]` (`36px`).
     - The defense card's visible left strip is `[defenseOverhang, defenseOverhang + indexStripWidth]` (`[36px, 72px]`).
     - Therefore, the maximal-overlap horizontal step between consecutive covered pairs is `coveredPairStep = defenseOverhang + indexStripWidth` (`72px` on `100px` desktop card; proportional on mobile), i.e., negative margin `-(coveredPairWidth - coveredPairStep)` (`-64px` on `100px` desktop card) between consecutive covered pairs!
     - Verify: with `coveredPairStep = 72px`, pair `i`'s attack card exposes `36px` (`[0, 36]`), pair `i`'s defense card exposes `36px` (`[36, 72]`), and pair `i+1` starts cleanly at `72px` — keeping EVERY covered card's rank (`'10'` included) and suit 100% uncovered!
     - Total width of `k` covered pairs = `k === 0 ? 0 : coveredPairWidth + (k - 1) * coveredPairStep`.

4. **Single-Row Uncovered Active Cards & Gap/Overlap Compression (`computeTableBoutLayout`):**
   - Inputs:
     - `coveredCount: number`
     - `uncoveredCount: number`
     - `extraSlotCount: number` (e.g., target/redirect outline slots sharing the single row)
     - `availableWidth: number` (inner width of the bout row in `[data-zone="table-arena"]`)
     - `cardWidth: number` (`100` desktop / `48` mobile)
     - `indexStripWidth: number` (`36` desktop / proportional mobile)
     - `defenseOverhang: number` (`36` desktop / proportional mobile)
     - `defenderSeat: 'top-left' | 'top-center' | 'top-right' | 'bottom'`
   - Layout Rules:
     - **Default (plenty of space):**
       - Covered stack sits at `edge` (`'left'` or `'right'`) with `coveredPairStep = defenseOverhang + indexStripWidth`.
       - A small default gap `groupGap` (e.g., `16px` desktop, `8px` mobile) separates the covered stack from the uncovered active cards.
       - A small default gap `uncoveredGap` (e.g., `12px` desktop, `6px` mobile) separates adjacent uncovered active cards (and extra outline slots).
     - **Tight horizontal space (preventing wrap onto a second row):**
       - First reduce `groupGap` and `uncoveredGap` smoothly down toward `minGap` (`4px` / `0px`).
       - If the total row width still exceeds `availableWidth`, allow slight overlap (negative spacing) among uncovered active cards (clamping step down to at least `indexStripWidth` so uncovered cards' ranks & suits stay readable whenever physically possible, and compressing further only if mathematically forced by extreme narrow widths) so ALL cards ALWAYS remain on one single horizontal row (`totalWidth <= availableWidth`).
   - Output structure:
     - `coveredEdge: 'left' | 'right'`
     - `coveredPairWidth: number`
     - `coveredPairStep: number`
     - `coveredPairMarginPx: number` (negative overlap margin for covered pairs after the first)
     - `groupGapPx: number` (gap between covered stack and uncovered active cards)
     - `uncoveredStep: number`
     - `uncoveredMarginPx: number` (positive gap or negative slight-overlap margin between uncovered cards)
     - `singleRowGuaranteed: boolean`

5. **`TablePair.tsx` Support:**
   - Keep all existing props and behavior backward-compatible so existing tests pass immediately.
   - Add optional presentation props (e.g., `isCollapsedCovered?: boolean`, `coveredEdge?: 'left' | 'right'`, `style?: CSSProperties`) and semantic data attributes (`data-covered={pair.defense ? 'true' : 'false'}`, `data-covered-edge={coveredEdge}`) so Wave 2 (`GameTable.tsx` + `table.css`) can wire the covered stack and uncovered row cleanly and QA can inspect covered pairs deterministically.
   - Preserve `BOUT_DEFENSE_OVERHANG_RATIO = 0.36` so attack cards' `36px` rank+suit index strips remain fully exposed.

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-1a (Verbatim):** "Collapse table cards together as they are covered if there is not sufficient space. As cards are played into the game table area, they should always stay collected in one row. If necessary, this will require reducing the gaps between the cards already on the table when a new card is added, or even allow overlap." — `computeTableBoutLayout` guarantees a single horizontal row across 1..6 cards on desktop and mobile widths, reducing gaps first and allowing slight overlap among uncovered cards if needed.
- [ ] **ITEM-1b (Verbatim):** "Pairs of cards that are already covering/covered should be moved to the nearest vertical edge of the game table (left or right, depending on the target player), since they cannot be further interacted with directly. ... Default to left edge for the top-left and center player, and right edge for the top-right player. Always move covered pairs to the edge." — `resolveCoveredPairsEdge` maps `top-left`, `top-center`, and `bottom` -> `'left'`, and `top-right` -> `'right'`, and `partitionTablePairs` always extracts covered pairs immediately while preserving original `pairIndex`.
- [ ] **ITEM-1c (Verbatim):** "Multiple instances of these covering card pairs on the table should be overlapping maximally in such a way that the suit and rank of all cards is still visible, in a similar way to how the hand maximally overlaps." — `coveredPairStep` equals `defenseOverhang + indexStripWidth` (`72px` on `100px` desktop cards) so both attack and defense cards' full rank (including `'10'`) and suit remain uncovered across stacked covered pairs.
- [ ] **ITEM-1d (Verbatim):** "Remaining active as-yet uncovered cards should maintain a small gap between each other and the covered cards by default, but they can be allowed to overlap slightly if necessary to keep all cards on one single row in the game table area." — Default positive `groupGapPx` and `uncoveredMarginPx`, shrinking smoothly to negative slight-overlap only when needed to keep all elements on one row.
- [ ] Comprehensive unit tests in `frontend/src/__tests__/tableLayout.test.ts` verifying edge resolution for all 4 seats, original `pairIndex` preservation, covered-pair maximal overlap visibility math (`>= 36px` per card), default gaps, and single-row compression on tight viewports.
- [ ] Run `npm test -- --run` in `frontend/` and verify all tests pass.
- [ ] Write a concise summary to `.reviews/agent_notes.md` and run `echo "DONE" > .tickets/STATUS` only after all tests pass.

