<!-- WAVE:2 -->
# Ticket 4 (Wave 2): 25% Larger Cards, 4P Aura Margins, Hand Drag Reordering ("Custom"), Pointer Cursor, Throw-In Outline, Transparent Mode Opponent Cards, Light Theme Labels & Left-Column Players/POV Consolidation

## Scope & Files to Touch
- **Touch ONLY the following files:**
  - `frontend/src/pages/GamePage.tsx`
  - `frontend/src/components/GameTable.tsx`
  - `frontend/src/components/TablePair.tsx`
  - `frontend/src/styles/table.css`
  - `frontend/src/app.css`
  - `frontend/src/__tests__/GamePage.test.tsx`
  - `frontend/src/__tests__/GameTable.test.tsx`
- **Do NOT touch `LobbyPage.tsx`, `Card.tsx`, `HeaderBar.tsx`, `SortBar.tsx`, `settings.ts`, or `backend/` in this ticket.**

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-13 & ITEM-1 — 25% Larger Cards in Play Area and Active User's Hand (`100×140`) + Full Highlight Aura Margin Inside Game Table (`GameTable.tsx`, `TablePair.tsx`, `table.css`):**
  > "1. The highlight outline looks a little strange in the 4-player mode since the highlight aura displays even off the game table. Adjust the margins so that there is always enough space between the player box and the game table for the full aura to fit on the game table alone."
  > "13. Increase the size of the cards in the play area and the active user's hand to fill the space more - there looks to be enough space for a 25% increase in dimensions. Double-check all overlapping and boundary enforcement to make sure everything still looks correctly."
  - Increase card dimensions by **25%** (`80px × 112px` -> **`100px × 140px`**) for:
    - All cards in the active user's hand (`[data-zone="player-hand"]`, `.hand-cards`, `.hand-card-wrapper`, `CARD_WIDTH = 100`, `CARD_HEIGHT = 140`).
    - All cards and card-sized outlines in the play area (`TablePair.tsx`, `.table-card-base`, `.table-card-cover`, `.target-outline`, `.throw-in-outline`, `.redirect-outline`, `.drag-ghost`).
  - Update `computeHandLayout` and `computeBoutLayout` in `GameTable.tsx` to use `cardWidth = 100` by default while preserving the `>= 22px` minimum visible left strip (`MIN_VISIBLE_CARD_LEFT_PX = 22`) so overlapped cards in hand and up to 6 pairs + outline on the table stay in a single non-wrapping row with their left rank/suit and bottom-left trump badge visible.
  - Adjust `.battlefield-tinted-box` height (e.g., `clamp(240px, 30vh, 320px)`) and `.table-arena` padding / grid spacing (`padding: 24px 28px 28px 28px` or explicit inset margins on Row 1 `.opponent-seat` and Row 3 `.player-hand-zone`, plus `data-aura-contained="true"` on `.table-arena`) so that in 2-player, 3-player, and especially **4-player mode**, there is always at least `24px–28px` of felt margin between every player box / `.hand-cards` highlight box and the outer border of `[data-zone="table-arena"]`, ensuring the full highlight aura fits completely on the game table alone without extending off the table or clipping.

- [ ] **ITEM-2 — Remove Green Outline Around Active User in Player List (`GamePage.tsx`, `table.css`, `app.css`):**
  > "2. Remove the green outline around the active user in the player list - (You) is sufficient to distinguish the user."
  - In `table.css`, `app.css`, and `GamePage.tsx`:
    - Remove any green border, outline, glow, or special `.status-badge.me` border styling around the active/viewed user's row in the `PLAYERS` list (`li.status-badge.me` must have no green outline or special self-distinguishing border; only the ` (You)` text suffix distinguishes which player is the active user).
    - Note: Keep the attacker (`data-role="attacker"`) and defender (`data-role="defender"`) role indicators only if applicable, or ensure `.status-badge.me` itself never applies a green border/outline.

- [ ] **ITEM-3 — High-Contrast Light Theme Styling for `TRUMP` Label and End-of-Game User List Labels (`table.css`, `app.css`):**
  > "3. In Light Theme, certain UI elements are not very distinguished, for example the TRUMP label under the deck, and the WINNER (and other) labels in the user list at the end of the game. Adjust the colors to be more visible in Light Theme (Dark Theme is good as is)"
  - In `[data-theme="light"]` (`table.css` / `app.css`), leave Dark Theme unchanged and adjust Light Theme styles for:
    - **The `TRUMP` label under the deck** (`.deck-trump-badge`, `.trump-suit-pill`, `[data-testid="trump-indicator"]`): give it a distinct, darker warm-amber/bronze border (`#b45309` / `rgba(180, 83, 9, 0.55)`), a visible tinted pill background (`#fef3c7` / `rgba(245, 158, 11, 0.22)`), and dark high-contrast text (`#78350f` / `#92400e`, with crisp red `#b91c1c` for ♥/♦ and `#0f172a` for ♠/♣ suit icons).
    - **All status labels in the `PLAYERS` list (`WINNER`, `OUT`, `DURAK`, `PASSED`)** (`[data-testid^="player-status-tag-"]`, `[data-testid^="player-durak-tag-"]`, `.status-tag`):
      - `WINNER`: rich emerald text (`#065f46`), soft emerald pill surface (`#d1fae5`), and visible emerald border (`#10b981`).
      - `DURAK`: deep crimson text (`#991b1b`), soft rose pill surface (`#fee2e2`), and visible crimson border (`#ef4444`).
      - `OUT`: crisp slate text (`#1e293b`), cool slate pill surface (`#cbd5e1`), and distinct slate border (`#64748b`).
      - `PASSED`: deep cobalt/amber-slate text (`#1e3a8a`), tinted pill surface (`#dbeafe`), and visible border (`#3b82f6`).

- [ ] **ITEM-5, ITEM-6a & ITEM-6b — Default `Rank` Sort, Manual Hand Reorganization with Parting Animation & Non-Persistent `"Custom"` Sort Mode (`GamePage.tsx`, `GameTable.tsx`, `table.css`):**
  > "5. Set the default Hand Sorting schema to Rank for new users, instead of Suit."
  > "6. Implement manual user-end hand reorganization. Clicking and dragging a card should allow the user to move it to any position in their hand. Animate the other cards in hand so they part when the card is dragged through the hand, making it clear which position the card will end up in. This should automatically set the user's Hand Sorting schema to a fourth new option, "Custom" (this should not persist between games)."
  - In `GamePage.tsx`:
    - Initialize `sortMode` from the user's saved non-custom sort setting (defaulting to `'rank'` for new users). Whenever `gameId` changes (starting or loading a new game), reset `'custom'` back to the user's non-custom sort mode (default `'rank'`) so `'custom'` never persists between games.
    - Maintain `customHandOrder: string[]` (array of card keys `${suit}-${rank}`). When the user drags and drops a card to reorder it within their hand (`onReorderHand(fromIndex, toIndex)` or `onReorderHand(newHandCards)`), update `customHandOrder` to the resulting card sequence and automatically set `sortMode` to `'custom'`.
    - While `sortMode === 'custom'`, preserve the user's custom card order across state updates (removing played cards and appending any newly drawn cards at the end).
  - In `GameTable.tsx` & `table.css`:
    - Allow clicking and dragging ANY card in the active user's hand (even when it is not the user's turn or when a card is not currently playable onto the table!) so the user can always reorganize their hand.
    - When the dragged card's pointer is inside or near the hand zone (`[data-zone="player-hand"]` / `.hand-cards`) and not snapped to a table drop zone, compute the target insertion index `reorderInsertIndex` (`0 .. hand.length - 1`) from the pointer's horizontal `clientX` position across the hand cards.
    - Animate the other cards in `.hand-cards` (`transition: transform 150ms ease-out`) so they visibly **part** around `reorderInsertIndex`: cards to the left of `reorderInsertIndex` shift left (e.g. `-18px`) and cards at or to the right of `reorderInsertIndex` shift right (e.g. `+18px`), exposing `data-reorder-target-index={reorderInsertIndex}` on `.hand-cards` and `data-part-direction="left" | "right"` on the parted `.hand-card-wrapper` elements.
    - Releasing the mouse while over the hand reorganization zone moves the dragged card to `reorderInsertIndex` and triggers `onReorderHand`, switching `HAND SORTING` to `"Custom"`.

- [ ] **ITEM-7 — Pointer Finger Cursor Throughout Card Dragging (`GameTable.tsx`, `table.css`, `app.css`):**
  > "7. The mouse cursor when dragging a card is not correct. It should be the pointer finger that appears when a link is covered throughout the entire dragging process."
  - In `table.css`, `app.css`, and `GameTable.tsx`:
    - Replace all `cursor: grab` / `cursor: grabbing` rules on `.hand-card-wrapper`, `.playing-card`, `.drag-ghost`, and `.table-arena` with `cursor: pointer`.
    - While a card drag is active (`dragState !== null`), set `data-dragging="true"` on `.table-arena` and apply `cursor: pointer !important` on `.table-arena[data-dragging="true"]`, `.table-arena[data-dragging="true"] *`, `.drag-ghost`, and `document.body` so the link pointer finger cursor remains active throughout the entire dragging process.

- [ ] **ITEM-8 — Dedicated "Next" Card Throw-In Outline During Ongoing Attack (`GameTable.tsx`, `table.css`):**
  > "8. Create an outline for the "next" card to be played next to the current played card when an attack is going on. Users should drag cards to this outline specifically to throw in additional cards, rather than just put them anywhere on the game table (the double-click control should remain, however)."
  - In `GameTable.tsx` & `table.css`:
    - When an attack is in progress (`view.tablePairs.length > 0`) and the active user can legally throw in additional cards (`view.legalActions.includes('throwIn')`, not in read-only replay mode, and not bot-locked), render a card-sized (`100px × 140px`) dashed attacker-emerald outline (`data-testid="throw-in-outline"`, class `target-outline throw-in-outline`) in the next slot immediately to the right of the current played cards inside `.table-pairs-group`.
    - Include the `throw-in-outline` slot in `computeBoutLayout`'s total slot count (alongside `tablePairs.length` and `redirect-outline` if both are present) so the single compact row inside `.battlefield-tinted-box` never wraps or overflows.
    - Register `throw-in-outline` as the **only** drag-and-drop drop zone for `type: 'throw-in'` (using magnetic snapping `SNAP_DISTANCE_PX` to the outline's center). Remove the generic "drop anywhere on the battlefield" fallback for throwing in cards, so dropping a card on the table outside the `throw-in-outline` snap radius does NOT play the card.
    - Keep the fast double-click control (`handleCardDoubleClick`) unchanged so double-clicking a legal throw-in card still plays it immediately.

- [ ] **ITEM-10b & ITEM-12a — Transparent Mode Low-Detail Opponent Cards & Removal of Trump Card Glowing Aura (`GameTable.tsx`, `GamePage.tsx`, `table.css`, `app.css`):**
  > "10. Implement "Transparent Mode". ... Rather than draw the full card sprites in the non-active users' player boxes, display a low-detail version that only shows the suit and rank (and trump-highlight, if necessary). Make sure that this mode is compatible with all all other modes and that no graphical glitches occur."
  > "12. Redesign the trump highlight on the cards as follows: First, remove the glowing aura from trump cards. ..."
  - In `table.css` and `app.css`:
    - Remove all glowing aura (`box-shadow` / glowing outline) rules from `.playing-card.trump-card` in both Dark and Light themes and across all palette presets/intensities. Trump cards are distinguished strictly by their symmetrical top-right and bottom-left trump badges from Ticket 2.
  - In `GameTable.tsx` and `table.css`:
    - When `view.transparentMode === true` (or when `opponent.cards && opponent.cards.length > 0`), render low-detail mini-cards (`data-testid="opponent-low-detail-card"`, class `opponent-low-detail-card`) inside each opponent's `.opponent-cards-fan` instead of face-down `CardBack` components.
    - Each `opponent-low-detail-card` displays **only** the card's rank symbol (`data-testid="low-detail-rank"`), suit icon (`data-testid="low-detail-suit"`), and—when `card.suit === view.trumpSuit`—the non-glowing symmetrical top-right and bottom-left trump highlight icons (`data-testid="low-detail-trump-top-right"` and `data-testid="low-detail-trump-bottom-left"`, inverted 180° relative to one another), with no center pips or court letter art.
    - Compute clean single-row overlap for `opponent-low-detail-card` inside the opponent box so even large hands fit inside `.opponent-seat` without overflowing, keeping the top-left card count badge (`data-testid="opponent-card-count-<id>"`) readable and glitch-free in 2P, 3P, and 4P modes.
  - In `GamePage.tsx`:
    - Add the **`Transparent Mode`** preset button (`data-testid="qa-preset-transparent-mode"`, preset id `'transparent-mode'`) to the left-sidebar **`⚡ QA Scenarios`** panel, and preserve `transparentMode` and `devMode` when clicking **`Rematch`**.

- [ ] **ITEM-14a (Frontend) & ITEM-14b — Move `PLAYERS` List to Top of Left Column, Remove `POV` Element & Consolidate Server-Gated POV Switching (`GamePage.tsx`, `table.css`, `app.css`):**
  > "14. Move the player list element from the right column to the top of the left column in the UI. Remove the POV element altogether - consolidate all POV element features, such as clicking to choose the player's POV, into the player list element. Set it up so that unless a dev mode variable is active, the user cannot select the POV until the game is over and in review mode. (The dev mode variable should default to active for now, since we are currently testing. Temporarily place a toggle for it in the lobby menu, so I can start a game and see the UI from a normal user's perspective.) Ensure also that the dev mode variable is handled server-side, so the user cannot modify it on their end using techniques such as inspect element."
  - In `GamePage.tsx`:
    - Move the **`PLAYERS`** panel (`data-testid="players-panel"`) from `[data-zone="sidebar-right"]` to the **very top of `[data-zone="sidebar-left"]`** (above `⚡ QA Scenarios`, `How to Play`, and `Replay`).
    - Remove the separate `POV` switcher element (`[data-testid="pov-switcher"]` / `.pov-tabs`) altogether from the UI.
    - Consolidate all POV switching into the `PLAYERS` list rows (`li.status-badge`, `data-testid="player-row-<id>"`):
      - Determine `canSwitchPov = (view.devMode !== false) || view.phase === 'gameOver'`.
      - When `canSwitchPov` is `true`, clicking a player row (`li.status-badge`) in the `PLAYERS` list switches the active POV to that player (`data-pov-clickable="true"`, `cursor: pointer`).
      - When `canSwitchPov` is `false` (`view.devMode === false && view.phase !== 'gameOver'`), clicking other player rows in `PLAYERS` does NOT switch POV (`data-pov-clickable="false"`, `aria-disabled="true"`), and any view fetch passes the initial seat `requesterId` to `getGameView(gameId, targetId, initialSeatId)` so the backend also rejects unauthorized mid-game seat switches with `403 Forbidden`.
      - When the game finishes (`view.phase === 'gameOver'`, review/replay mode), clicking any player row in `PLAYERS` switches POV to that player even if `devMode` was `false` during live play, keeping the current replay move index unchanged.

## Verification
- Run `cd frontend && npm test -- --run` and ensure all frontend test suites pass with zero errors.

