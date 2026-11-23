<!-- WAVE:1 -->
# T-90-feedback-20261122_011021-3-card-size-and-drag: Unified Full-Size Playing Cards & Always-Visible Drag Interaction

## Scope & Owned Files
Only modify these frontend files:
- `frontend/src/components/Card.tsx`
- `frontend/src/components/CardBack.tsx`
- `frontend/src/components/TablePair.tsx`
- `frontend/src/__tests__/Card.test.tsx`

Do NOT touch `GameTable.tsx`, `ActionBar.tsx`, `table.css`, `actionIcons.css`, `GamePage.tsx`, `LobbyPage.tsx`, or `backend/` in this ticket (Wave 2 applies shared `table.css` & `GameTable.tsx` layout wiring).

## Requirements & Architecture

### 1. Match Playing Card Size to Throw-In & Redirect Outlines (`Card.tsx`, `CardBack.tsx`, `TablePair.tsx`) (ITEM-2)
- Currently, `[data-testid="throw-in-outline"]` and `[data-testid="redirect-outline"]` render at the larger canonical card size (`100px × 140px` on desktop, `48px × 68px` below the mobile breakpoint), while actual rendered playing cards are substantially smaller.
- Update `Card.tsx`, `CardBack.tsx`, and `TablePair.tsx` so actual playing cards use the **exact same canonical dimensions** as the outlines (`100px × 140px` default/desktop, `data-card-width="100"`, `data-card-height="140"` or responsive CSS-driven `--card-width` / `--card-height` matching `100px × 140px` desktop and `48px × 68px` mobile) — remove any hardcoded smaller inline widths/heights or legacy compact scaling on active hand cards and table bout cards!
- Ensure `TablePair.tsx` renders both the attack card and the staggered defense card at the full canonical outline size (`100px × 140px` desktop / `48px × 68px` mobile) without shrinking either card inside the pair wrapper.
- Keep `CardBack.tsx` aligned with the full canonical card size for the talon deck (`[data-zone="table-deck"]`) while preserving any explicit `size="mini"` / opponent-fan compact variant used strictly for opponent miniature card fans in Row 1 seats.

### 2. Left-Side Rank & Suit Corner Visibility Guarantee (`Card.tsx`) (ITEM-5 support)
- Because active hand cards will overlap by up to **80% of their width** (leaving the leftmost **~20%** — roughly `20px` on a `100px` desktop card — uncovered on every card), structure the top-left corner index of `Card.tsx` so that:
  - Both the **rank symbol** (`6`–`10`, `J`, `Q`, `K`, `A`) and the **suit pip** (`♠`, `♥`, `♦`, `♣`) are stacked vertically and tightly anchored in the leftmost `~18px–20px` strip (`padding-left: 3px–4px`, compact font sizing for `"10"`, zero horizontal overflow past `20%` of card width).
  - Even when the adjacent card covers `80%` of the card from the right, both the rank and suit remain 100% uncovered and immediately readable!

### 3. Fix Bug: Dragging a Card Must Never Make It Invisible (`Card.tsx`) (ITEM-4)
- Diagnose and fix why clicking and dragging a card makes it disappear/invisible:
  - Never set `opacity: 0`, `visibility: hidden`, or `display: none` on a card when `isDragging` is true or inside `onDragStart`.
  - In HTML5 native drag-and-drop (`draggable={true}`), browsers sometimes hide or blank out the drag preview or source card if CSS transitions/transforms/opacity are mutated synchronously inside `onDragStart` or if a `dragging` class hides the element.
  - Ensure that:
    1. Inside `onDragStart`, the source card stays **fully visible (`opacity: 1`, `visibility: visible`)** — never fade it out to invisible (`opacity: 0`) or low-opacity ghosting that looks invisible.
    2. If `e.dataTransfer.setDragImage` is used, pass a guaranteed-visible element/clone with clean offsets (guarded safely for jsdom/test environments where `setDragImage` may be undefined).
    3. Clean up any `isDragging` visual highlight state reliably in `onDragEnd` (and pointer cancel/up if applicable).
    4. Keep `onClick` and `onDoubleClick` cleanly usable alongside `draggable` so clicking to select and double-clicking to throw in (ITEM-6) work smoothly without drag interference.

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-2 (QA Playbook #2):** "Currently, the throw-in and redirect outlines match in size, while the actual cards are substantially smaller. Ensure that the cards are also the (larger) size of the outlines." (`Card.tsx`, `CardBack.tsx`, and `TablePair.tsx` render full-size `100px × 140px` desktop / `48px × 68px` mobile cards matching the throw-in and redirect outlines.)
- [ ] **ITEM-4 (New #2):** "Bug: Clicking and dragging a card makes it invisible. Cards should be displayed at all times (aside from overlap rules as we have defined), regardless of if they are bing dragged or not." (`Card.tsx` keeps the card visibly displayed with `opacity: 1` / `visibility: visible` before, during, and after `dragStart` / `dragEnd`.)
- [ ] **ITEM-5 (New #3 — Card Face Support):** Top-left rank symbol and suit pip in `Card.tsx` are positioned cleanly within the leftmost 20% strip so every card's rank & suit remain readable even at 80% overlap.
- [ ] Add/update unit tests in `frontend/src/__tests__/Card.test.tsx` verifying:
  - Full canonical card dimensions (`100×140` metadata/classes, no smaller inline override).
  - Top-left rank & suit corner elements are present and cleanly structured.
  - Firing `dragStart` on a card does NOT make it invisible (never sets `opacity: 0`, `visibility: hidden`, or hidden class) and cleanly restores state on `dragEnd`.
- [ ] Run `npm test -- --run` inside `frontend/` and ensure 100% of frontend tests pass.
