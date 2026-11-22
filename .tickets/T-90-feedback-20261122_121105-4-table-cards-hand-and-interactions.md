<!-- WAVE:2 -->
# Ticket: Table Integration — Throw-In Visibility, Unified Larger Card Size, Drag Visibility, Tight Hand Contour, Multi-Select Throw-In & Compact Icon Buttons

## Context & Goal
Wire all Wave 1 primitives (`SurrenderIcon`, `PassIcon`, `actionIcons.css`, `handContour.ts`, and strict backend `canThrowIn`) into `Card.tsx`, `CardBack.tsx`, `TablePair.tsx`, `handLayout.ts`, `ActionBar.tsx`, `GameTable.tsx`, and `table.css` so every visual, layout, drag-and-drop, multi-card throw-in, and action-button requirement works seamlessly on the live game table.

## Target Files
- `frontend/src/components/Card.tsx`
- `frontend/src/components/CardBack.tsx`
- `frontend/src/components/TablePair.tsx`
- `frontend/src/utils/handLayout.ts`
- `frontend/src/components/ActionBar.tsx`
- `frontend/src/components/GameTable.tsx`
- `frontend/src/styles/table.css`
- `frontend/src/__tests__/Card.test.tsx`
- `frontend/src/__tests__/handLayout.test.ts`
- `frontend/src/__tests__/handPresentation.test.tsx`
- `frontend/src/__tests__/GameTable.test.tsx`

## Implementation Details
1. **Strict Conditional Visibility of Additional Card (`throw-in-outline`) (`GameTable.tsx`):**
   - Compute `canViewerThrowIn` strictly from `view`:
     - `Boolean(view.canThrowIn)` AND
     - viewer is NOT the defending player (`!isDefender`, i.e., `mySeatIdx !== view.defenderIdx`) AND
     - `!view.myHasPassed` AND
     - `(view.throwInCards?.length ?? 0) > 0` AND
     - `(view.throwInCapacity ?? 0) > 0`.
   - Render `[data-testid="throw-in-outline"]` (and `[data-testid="surrender-throw-in-anchor"]` when in surrender throw-in) **ONLY** when `canViewerThrowIn` is `true`.
   - When the viewer is the defending player, has already passed, or holds no valid cards to throw in, `[data-testid="throw-in-outline"]` MUST NOT be rendered in the DOM.
   - Preserve the previous round's surrender anchor placement behavior (`data-surrender-outline-position="below"` / `"above"` / `"inline"`, staying 100% on the shaded battlefield table) whenever `canViewerThrowIn` IS `true`.
2. **Unified Larger Card Size Matching Outlines (`Card.tsx`, `CardBack.tsx`, `TablePair.tsx`, `table.css`):**
   - Ensure playing cards (`Card.tsx`, `CardBack.tsx`, `.playing-card` / `.card`, table bout cards, hand cards, talon/trump card) use the **exact same larger dimensions** as `[data-testid="throw-in-outline"]` and `[data-testid="redirect-outline"]`:
     - Desktop: `100px × 140px` (`width: 100px; height: 140px; flex: 0 0 100px; box-sizing: border-box;`)
     - Mobile (`< 900px`): `48px × 68px` (`width: 48px; height: 68px; flex: 0 0 48px; box-sizing: border-box;`)
     - Expose consistent `data-card-width` and `data-card-height` attributes or CSS custom properties (`--card-width: 100px; --card-height: 140px;` / mobile `48px × 68px`) shared by cards, `throw-in-outline`, and `redirect-outline` so they can NEVER diverge in size.
   - Refine the top-left corner rank + suit typography and padding inside `Card.tsx` + `table.css` so the rank symbol and suit icon sit compactly within the leftmost `~18–20px` (on `100px` desktop card; proportionally on mobile) — guaranteeing the left-side rank symbol and suit are ALWAYS legible even at 80% horizontal card overlap!
3. **Fix Click-and-Drag Card Invisibility Bug (`Card.tsx`, `GameTable.tsx`, `table.css`):**
   - Inspect all drag handlers (`onDragStart`, `onDragEnd`, `onPointerDown`, drag state classes like `.is-dragging` / `.dragging` / `opacity: 0` / `visibility: hidden` / `display: none`).
   - Remove ANY styling or conditional rendering that hides or makes a card transparent/invisible when clicked and dragged!
   - Ensure cards remain fully rendered and visible (`opacity: 1; visibility: visible;`) at all times during click, drag-start, drag-over, drop, and drag-end/cancel (while preserving normal overlap z-order rules).
4. **Active Player Hand Overlap Layout (20%–80%) & Tight Non-Rectangular Hand Contour (`handLayout.ts`, `GameTable.tsx`, `table.css`):**
   - Wire `handLayout.ts` to delegate to `computeResponsiveHandLayout` and `computeTightHandContourPath` from `handContour.ts` using the live card dimensions (`100×140` desktop / `48×68` mobile) and measured width of `[data-zone="player-hand"]` (via `ResizeObserver` with sensible fallback for JSDOM/tests).
   - Remove the old misaligned rectangular hand highlight box completely (ignoring all past specs for that component!).
   - Render the active player's hand inside `[data-zone="player-hand"]` (keeping `[data-zone="player-hand"]` itself in Row 3 Col 2 of the CSS Grid — NO `position: fixed` or `position: absolute` for placing seats, hands, bouts, or sidebars!):
     - Inside the hand's own coordinate stage (`position: relative; width: totalWidth; height: totalHeight; max-width: 100%;`), render:
       1. An SVG contour layer (`data-testid="hand-highlight-contour"`, `pointer-events: none`) whose `viewBox` matches `0 0 totalWidth totalHeight` and draws `<path d={contourPath} />` tightly wrapping the exact live card rectangles — **including the upward shift (`liftPx`) of playable and selected cards**! Only highlight/glow the contour when it is the active player's turn / prompt (or active hand highlight state), while always keeping its geometry locked pixel-for-pixel to the actual card positions!
       2. Every card positioned at its exact `(card.x, card.y)` from `computeResponsiveHandLayout` (incorporating upward shift for playable / selected cards), ensuring:
          - 20% min to 80% max horizontal overlap,
          - Left-side rank and suit visible on every card,
          - Multi-row containment when holding many cards (e.g. 30–52 cards) so the hand NEVER overflows off-screen or overlaps `table-deck`, `SortBar`, action buttons, or sidebars.
5. **Remove "Throw In" Button & Implement Drag + Multi-Select Double-Click Throw-In (`ActionBar.tsx`, `GameTable.tsx`):**
   - **Completely remove** the "Throw In" button from `ActionBar.tsx` and any Throw-In button JSX/styles from `GameTable.tsx` and `table.css`.
   - **Single-card throw-in:**
     - Dragging any legal throw-in card onto `[data-testid="throw-in-outline"]` immediately throws it in via `onThrowIn([card])`.
     - Double-clicking a single legal throw-in card immediately throws it in via `onThrowIn([card])`.
   - **Multi-card throw-in (click to select multiple, double-click to deploy all at once):**
     - During a legal throw-in state (`canViewerThrowIn`), single-clicking a legal throw-in card toggles it in `selectedThrowInCards` (capped at `view.throwInCapacity`; clicking an already-selected card deselects it; non-legal cards cannot be selected).
     - Selected throw-in cards shift upward clearly (and show a subtle selection indicator) — and because `liftPx` includes selected cards, the tight non-rectangular hand contour wraps them too!
     - **Double-click deployment (race-free!):** When the user double-clicks a legal throw-in card (or double-clicks `[data-testid="throw-in-outline"]`), deploy **all** currently selected legal throw-in cards (including the double-clicked legal card if it wasn't yet selected, or without accidentally dropping it on the first click of the double-click!) in a single `onThrowIn(cardsToDeploy)` call, then clear selection!
       - *Implementation detail to prevent double-click deselection bug:* Track selection toggle carefully (e.g., if `event.detail >= 2` on `onClick`, ignore the toggle so the second click doesn't deselect before `onDoubleClick`; or defer deselection / keep a `lastSelectedBeforeClickRef` snapshot for `onDoubleClick` so clicking cards A, B, and then double-clicking B — or double-clicking C — deploys `[A, B]` or `[A, B, C]` cleanly every time!).
     - Also allow dragging when multiple legal throw-in cards are selected: dragging one of the selected cards onto `[data-testid="throw-in-outline"]` deploys the selected batch (or the single dragged card if dragging an unselected legal card).
     - Clear `selectedThrowInCards` whenever `view.myId`, `view.boutPhase`, `view.tablePairs.length`, or `canViewerThrowIn` changes.
6. **Compact Icon-Only Theme-Matched Surrender & Pass Buttons (`ActionBar.tsx`, `GameTable.tsx`, `table.css`):**
   - Update `ActionBar.tsx` to render:
     - Surrender button: ONLY `<SurrenderIcon />` inside a compact button using `.action-icon-btn.action-icon-btn--surrender` (`aria-label="Surrender"`, `title="Surrender"`, `data-testid="surrender-button"`). NO visible `"Surrender"` text!
     - Pass button: ONLY `<PassIcon />` inside a compact button using `.action-icon-btn.action-icon-btn--pass` (`aria-label="Pass"`, `title="Pass"`, `data-testid="pass-button"`). NO visible `"Pass"` text!
     - NO "Throw In" button!
   - Keep the button positioned in the **bottom-right corner of the game table** (Row 3, Col 3 of `[data-zone="table-arena"]`, alongside `SortBar` with clean flex/grid alignment and zero overlap).
   - Remove any legacy bright-red `.surrender-btn` / `.btn-danger` overrides in `table.css` that would fight `actionIcons.css`.
7. **Tests (`Card.test.tsx`, `handLayout.test.ts`, `handPresentation.test.tsx`, `GameTable.test.tsx`):**
   - Update existing assertions for the larger card size (`100×140`), icon-only Surrender/Pass buttons (`getByRole('button', { name: /surrender/i })` / `/pass/i`, asserting no visible text `"Surrender"`, `"Pass"`, or `"Throw In"`), and non-rectangular hand contour (`[data-testid="hand-highlight-contour"]`).
   - Add dedicated tests covering:
     - `throw-in-outline` hidden for defender, passed player, and player with no valid throw-in cards; visible for eligible throw-in player (`ITEM-QA1`).
     - Cards and outlines match in larger size (`ITEM-QA2`).
     - Non-rectangular SVG hand contour path distorts when playable/selected cards are lifted (`ITEM-NEW1`).
     - Clicking and dragging a card keeps it visible (`opacity !== '0'`, not `display: none` / `visibility: hidden`, still in DOM) (`ITEM-NEW2`).
     - 20%–80% overlap + 30-card hand contained inside hand container without overflow (`ITEM-NEW3`).
     - No "Throw In" button; drag-to-outline throws in card; clicking multiple legal cards + double-clicking deploys all selected cards in one `onThrowIn` call (`ITEM-NEW4`).
     - Compact icon-only Surrender and Pass buttons in bottom-right table corner (`ITEM-NEW5`, `ITEM-NEW6`).
   - Run `npm test -- --run` and ensure 100% pass.

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-QA1a / QA1b / QA1c (Frontend Table):** "It works, but make the following adjustment: the additional card outline should only be visible to players that can legally play into it. In other words, it should not be visible if a player has no valid cards to throw in, is the defending player, or has already input a pass command." -> Wired in `GameTable.tsx`.
- [ ] **ITEM-QA2:** "Currently, the throw-in and redirect outlines match in size, while the actual cards are substantially smaller. Ensure that the cards are also the (larger) size of the outlines." -> Wired across `Card.tsx`, `CardBack.tsx`, `TablePair.tsx`, `GameTable.tsx`, and `table.css`.
- [ ] **ITEM-NEW1:** "The active player's hand highlight box doesn't match with or align to the player's actual card positions at all. Adjust the implementation, ignoring all past specs for this component, to make sure that the highlight box responsively wraps tightly around the hand at all times. This means that if certain cards are shifted upwards to be playable, the highlight box should distort accordingly to keep wrapped tightly around the hand as a whole ("box" is no longer the right word - the outline does not need to maintain a rectangular shape)." -> Wired in `GameTable.tsx`, `handLayout.ts`, and `table.css`.
- [ ] **ITEM-NEW2:** "Bug: Clicking and dragging a card makes it invisible. Cards should be displayed at all times (aside from overlap rules as we have defined), regardless of if they are bing dragged or not." -> Fixed in `Card.tsx`, `GameTable.tsx`, and `table.css`.
- [ ] **ITEM-NEW3:** "Arrange the cards in the active user's hand subject to the following constraints: all cards should overlap by 20% of their width at minimum and by 80% of their width at maximum. (These percentages are approximate - adjust them as needed to make sure that the left-side rank symbol and suit is always visible on every card, and so that even if a player picks up every card into their hand, the hand won't look wrong graphically (i.e. go off screen or overlap UI elements)). Keep in mine New Item #1 when implementing this, and vice versa." -> Wired in `handLayout.ts`, `GameTable.tsx`, and `table.css`.
- [ ] **ITEM-NEW4a / 4b / 4c:** "Remove the "Throw In" button. Instead, cards can be thrown in by dragging them to the additional card outline or double clicking. To throw in multiple cards at once, the player can click to select multiple legal cards to throw in, and then double-click to deploy them all at once." -> Wired in `ActionBar.tsx` and `GameTable.tsx`.
- [ ] **ITEM-NEW5:** "Instead of the word "Surrender", the surrender button should be smaller and non-verbally communicate the action with an icon. Design the icon to be two hands, raised in surrender, underneath some cards with an arrow pointing from the cards down towards the hands. Keep the position of the surrender button in the bottom right corner of the game table. Adjust the button to fit the aesthetic of the current theme as the other game elements do, instead of being the current bright red." -> Wired in `ActionBar.tsx`, `GameTable.tsx`, and `table.css`.
- [ ] **ITEM-NEW6:** "Instead of the word "Pass", the pass button should be smaller and non-verbally communicate the action with an icon. Design the icon with a similar aesthetic to the above specification for the surrender button. Also make the other button adjustments in an analogous way." -> Wired in `ActionBar.tsx`, `GameTable.tsx`, and `table.css`.
- [ ] **Tests:** `Card.test.tsx`, `handLayout.test.ts`, `handPresentation.test.tsx`, and `GameTable.test.tsx` updated and `npm test -- --run` passes cleanly.

