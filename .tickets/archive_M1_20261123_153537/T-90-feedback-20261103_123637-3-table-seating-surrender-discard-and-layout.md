<!-- WAVE:1 -->
# Ticket T-90-3: Relative Clockwise Opponent Seating, Surrender Half-Off Straddling, Compact Single-Row Play Area, Discard Overlap & Table Roundness (`GameTable.tsx`, `TablePair.tsx`, `table.css`)

## Summary
Implement all table layout, seating, discard overlap, surrender straddling, play-area card clustering, and table roundness requirements in `GameTable.tsx`, `TablePair.tsx`, and `table.css`:
1. **Discard Pile Face-Up Overlap Over Face-Down Stack (`ITEM-PREV-7a`, `ITEM-PREV-7b`, `ITEM-PREV-7c`):**
   - In `TableDeck` (`GameTable.tsx` + `table.css`), allow the revealed face-up discard row (`[data-testid="discard-visible-row"]`) to overlap the stationary face-down discard stack (`[data-testid="discard-facedown-stack"]`).
   - When `faceDownCount > 0` and `lastDiscardCards.length > 0`, the left-most revealed face-up card overlaps the face-down deck with the maximally allowed margin (e.g. shifted left over the face-down stack by `cardWidth - minReadablePeekPx`, leaving only the ~`20px`–`22px` minimum peek strip of the face-down stack visible on the left).
   - Spread the remaining revealed face-up cards evenly across the full remaining width of `[data-testid="discard-pile"]` (so when 2–5 cards are discarded, they spread evenly across the space; when more cards are present than can fit at comfortable spacing, tighten overlap up to the maximum allowed overlap where each card's left rank/suit strip stays visible; and activate the cursor-sliding hover animation **only** when there are too many face-up cards to fit even at maximum overlap).
2. **Realistic Clockwise Opponent Box Seating Relative to Active User's POV (`ITEM-ADD-1a`, `ITEM-ADD-1b`):**
   - Fix opponent seat placement in Row 1 of `GameTable.tsx` so that opponent boxes are always arranged in clockwise order relative to the active user's (`view.myId`) seat at `bottom`, for any number of players (`N = 2, 3, 4+`):
     - Build the canonical seat order (`p0, p1, ..., p(N-1)`) from all seats in the match (`view.myId` + `view.opponents.map(o => o.id)` sorted by canonical seat index `0 .. N-1`).
     - For any opponent at canonical index `oppIdx` when the viewer is at canonical index `myIdx`, compute the clockwise offset `offset = (oppIdx - myIdx + N) % N` (`1 <= offset <= N - 1`).
     - Map `offset` to top-row seats:
       - `N = 2`: `offset = 1 -> "top-center"`
       - `N = 3`: `offset = 1 -> "top-left"`, `offset = 2 -> "top-right"`
       - `N = 4`: `offset = 1 -> "top-left"`, `offset = 2 -> "top-center"`, `offset = 3 -> "top-right"`
     - Verify the exact 3P example from human feedback (`Alice = p0`, `Bob = p1`, `Carol = p2`):
       - When **Alice (`p0`)** is active user: **Bob (`p1`, offset 1)** is at `top-left`, and **Carol (`p2`, offset 2)** is at `top-right`.
       - When **Bob (`p1`)** is active user: **Carol (`p2`, offset 1)** is at `top-left`, and **Alice (`p0`, offset 2)** is at `top-right`.
       - When **Carol (`p2`)** is active user: **Alice (`p0`, offset 1)** is at `top-left`, and **Bob (`p1`, offset 2)** is at `top-right`.
     - Use the **exact same** relative seat mapping function for:
       - Opponent seat boxes in Row 1 (`data-seat="top-left" | "top-center" | "top-right"`),
       - The deflect arrow (`[data-testid="redirect-outline"]`, `data-target-seat`, and arrow glyph/angle),
       - Initial attack target outlines (`[data-testid="target-outline-<id>"]`, `data-anchor-seat`),
       - Bout card anchors (`data-anchor-seat`) and surrender target anchors (`data-surrender-target`).
3. **Surrender Half-On / Half-Off Play Area Straddling (`ITEM-ADD-4b`):**
   - Normalize `view.boutPhase` (e.g., `view.boutPhase.toLowerCase().replace(/[^a-z]/g, '') === 'surrenderthrowin'`) when computing `isSurrendered`.
   - When `isSurrendered` is true (`data-surrendered="true"` on `.table-pairs-group`), position `.table-pairs-group` so that the cards are **50% inside and 50% outside** the border of `.battlefield-tinted-box` (`[data-testid="play-area-box"]`) in the direction of the surrendering defender's player box (`data-surrender-target="bottom" | "top-left" | "top-center" | "top-right"`):
     - Compensate for the `12px` inner padding of `.battlefield-tinted-box` (e.g., `transform: translateY(calc(50% + 12px))` when `data-surrender-target="bottom"`, so the bottom border of `.battlefield-tinted-box` bisects the cards and the bottom half sticks out below the play area almost touching the active user's hand; `transform: translateY(calc(-50% - 12px))` when `data-surrender-target="top-left" | "top-center" | "top-right"`, so the top border of `.battlefield-tinted-box` bisects the cards and the top half sticks out above the play area toward that opponent's box).
     - Ensure no later CSS rule overrides `.table-pairs-group[data-surrendered="true"]` `transform` and `.battlefield-tinted-box` keeps `overflow: visible`.
4. **Compact Single-Row Play Area Cards & Outlines Near Defender (`ITEM-NEW-2a`, `ITEM-NEW-2b`):**
   - Place cards in `.table-pairs-group` closer together (tight `4px` gap or slight overlap when few cards are on the table, tightening into negative `margin-left` overlap as more cards are added) so all cards in play stay in a compact group in the area of the table close to the defending player (`data-anchor-seat`), with `.redirect-outline` and `.target-outline` positioned immediately alongside that compact area.
   - Enforce `flex-wrap: nowrap` on `.table-pairs-group` (`data-single-row="true"`) so cards in the play area **never** appear in two rows even when 6 bout pairs + reflection outline are present; instead overlap them horizontally while always leaving at least `22px` of the left side of every card (where the suit and rank index are drawn) visible (`data-min-visible-left`).
5. **Roundness Slider Applied to All Game Table Elements (`ITEM-NEW-1a`, `ITEM-NEW-1b`, `ITEM-NEW-3` CSS):**
   - Update `frontend/src/styles/table.css` (and `GameTable.tsx` inline/SVG styles such as `.redirect-outline` SVG `<rect>`) so `--app-roundness` controls the border radius of `.game-table` (`[data-zone="table-arena"]`), `.battlefield-tinted-box`, `.opponent-seat`, `.target-outline`, `.redirect-outline`, `.playing-card`, `.playing-card-back`, `.hand-cards`, and table buttons/badges, and ensure `.playing-card text` uses the serif font stack.

## Files to Modify
- `frontend/src/components/GameTable.tsx`
- `frontend/src/components/TablePair.tsx`
- `frontend/src/styles/table.css`
- `frontend/src/__tests__/GameTable.test.tsx`

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-PREV-7a, ITEM-PREV-7b, ITEM-PREV-7c (Discard Pile Overlap over Face-Down Deck):**
  > "7. This version looks better - however, ther should be more space for the face-up discarded cards. Allow them to overlap the face-down deck itself. The left-most revealed card should overlap the deck with the maximally allowed margin, with the other revealed cards being spread evenly across the space (and the mouse animation only applying if there are too many cards, as usual)."
  - In `TableDeck` (`GameTable.tsx` & `table.css`):
    - When `faceDownCount > 0` and `lastDiscardCards.length > 0`, `[data-testid="discard-visible-row"]` overlaps `[data-testid="discard-facedown-stack"]` so the leftmost revealed card starts shifted over the face-down stack with the maximally allowed overlap margin (`marginLeft: -(CARD_WIDTH - MIN_VISIBLE_STRIP_PX)`, e.g. `-58px` on an `80px` wide deck card, leaving `22px` of the face-down stack visible on the left; expose `data-overlaps-facedown="true"` and `data-facedown-overlap-px="58"` on `[data-testid="discard-visible-row"]`).
    - Spread the remaining revealed cards (`lastDiscardCards`) evenly across the expanded horizontal space (`availableWidth - MIN_VISIBLE_STRIP_PX`), tightening overlap as more revealed cards are present and enabling the mouse-hover sliding animation (`data-interactive-overflow="true"`) **only** when there are too many revealed face-up cards to fit even at maximum allowed overlap.
    - Keep `[data-testid="discard-facedown-stack"]` stationary (`pointer-events: none`, zero hover transform/shadow).
- [ ] **ITEM-ADD-1a & ITEM-ADD-1b (Realistic Clockwise Opponent Seating & Synchronized Arrows/Anchors):**
  > "1. The arrow direction is pointing at the correct player box. However, the player boxes are not in the correct position. They should be arranged in a realistic way relative to the active user's POV. For example, if when Alice is the active user, Bob is on the left, and Carol is on the right, then when Bob is the active user, Alice should be on the right and Carol should be on the left. Adjust the logic, making sure it is consistent for any number of players."
  - In `GameTable.tsx`:
    - Compute canonical seat order (`p0, p1, p2, ...`) and clockwise offset `offset = (targetIdx - myIdx + totalPlayers) % totalPlayers`.
    - Place opponent seat boxes in Row 1 according to `offset`:
      - 2 players: `offset 1 -> top-center`
      - 3 players: `offset 1 -> top-left`, `offset 2 -> top-right`
      - 4 players: `offset 1 -> top-left`, `offset 2 -> top-center`, `offset 3 -> top-right`
    - When Alice (`p0`) is active user in 3P: Bob (`p1`) renders in `[data-seat="top-left"]` and Carol (`p2`) renders in `[data-seat="top-right"]`.
    - When Bob (`p1`) is active user in 3P: Carol (`p2`) renders in `[data-seat="top-left"]` and Alice (`p0`) renders in `[data-seat="top-right"]`, and when Alice (`p0`) attacks Bob (`p1`), the deflect arrow (`[data-testid="redirect-outline"]`) points at Carol's box at `top-left` (`data-target-seat="top-left"`, `data-target-player="p2"`).
- [ ] **ITEM-ADD-4b (Surrender Half-On / Half-Off Play Area Straddling):**
  > "Second, in the pass phase (where the straddling effect should be visible) the cards are still in their play location, rather than halfway off the play area."
  - In `GameTable.tsx` and `table.css`:
    - Detect `SurrenderThrowIn` regardless of case/underscore formatting (`normalizeBoutPhase(view.boutPhase) === 'surrenderthrowin'`).
    - Set `data-surrendered="true"` and `data-surrender-target={defenderSeat}` on `.table-pairs-group`.
    - Apply `transform: translateY(calc(50% + 12px))` when `data-surrender-target="bottom"` and `transform: translateY(calc(-50% - 12px))` when `data-surrender-target="top-left" | "top-center" | "top-right"`, so the cards visibly straddle 50% on and 50% off the border of `.battlefield-tinted-box` in the direction of the surrendering player's box.
- [ ] **ITEM-NEW-2a & ITEM-NEW-2b (Compact Single-Row Play Area Cards & Outlines Near Defender):**
  > "2. Place cards in the play area closer together, with slight overlap if necessary, to keep all cards in play in the area of the table close to the defending player. Move the card outlines accordingly. Cards should never appear in two rows if there are too many to fit in one row in the play area, instead being overlapped together (but the left part of every card, where the suit and rank is shown, should always be displayed)."
  - In `GameTable.tsx`, `TablePair.tsx`, and `table.css`:
    - Keep `.table-pairs-group` single-row (`flex-wrap: nowrap`, `data-single-row="true"`) and compactly clustered near the defender's anchor edge/corner (`gap: 4px` or negative `margin-left` overlap as pair count grows), never wrapping onto a second row.
    - When multiple pairs are in play, dynamically overlap `.table-pair` items so the entire group stays within the defender's section of `.battlefield-tinted-box` while preserving at least `22px` of the left rank/suit strip of every card (`data-min-visible-left="22"`).
    - Position `.redirect-outline` and `.target-outline` immediately aligned with this compact defender-anchored card area.
- [ ] **ITEM-NEW-1a & ITEM-NEW-1b (Roundness Slider Affects All Game Table Elements):**
  > "1. The roundness slider in the theme menu should also affect all elements in the game table, including cards and the borders of the game table itself."
  - In `table.css` and `GameTable.tsx`:
    - Bind `--app-roundness` to `.game-table` (`border-radius: calc(var(--app-roundness, 8px) * 1.5)`), `.battlefield-tinted-box` (`border-radius: calc(var(--app-roundness, 8px) * 1.5)`), `.opponent-seat` (`border-radius: var(--app-roundness, 8px)`), `.target-outline` and `.redirect-outline` (`border-radius: var(--app-roundness, 8px)`), `.playing-card` and `.playing-card-back` (`border-radius: var(--app-roundness, 8px)`), `.hand-cards` (`border-radius: calc(var(--app-roundness, 8px) + 4px)`), and table action buttons/badges.
- [ ] **Automated Frontend Unit Tests (`frontend/src/__tests__/GameTable.test.tsx`):**
  - Add/update tests verifying:
    1. 3P and 4P clockwise opponent seating from Alice (`p0`), Bob (`p1`), Carol (`p2`), and Dave (`p3`) POVs, including that on Bob's POV (`p1`) in 3P, Carol (`p2`) is at `top-left` and Alice (`p0`) is at `top-right`, with `redirect-outline` pointing `top-left` to `p2`.
    2. `TableDeck` face-up discard row overlapping the face-down stack (`data-overlaps-facedown="true"`, leftmost card shifted over the face-down stack with maximum allowed margin, remaining face-up cards spread evenly).
    3. `SurrenderThrowIn` setting `data-surrendered="true"` and applying the half-on / half-off straddling transform toward `bottom` and `top-*` seats.
    4. Single-row compact play-area card overlap (`flex-wrap: nowrap`, `data-single-row="true"`, left rank/suit strip `>= 22px` visible even with 6 pairs).
  - Run `cd frontend && npm test -- --run` and ensure all tests pass.
