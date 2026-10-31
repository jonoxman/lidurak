<!-- WAVE:2 -->
# Ticket T-90-feedback-20261031_010137-6: Frontend Hand Controls, 3-Mode SortBar, Trump Glow & Turn Nudge Pulse

## Subsystem
Frontend Hand & Player Controls (`frontend/src/components/*`, `frontend/src/styles/*`)

## Description & Scope
Implement the 3-mode client-side hand sorting bar (`SortBar`), golden trump card visual highlights, minimalist Pass/Surrender controls in `Row 3, Col 3`, client-side invalid move suppression, and subtle turn nudge pulse animations.

### Requirements Covered
- **Item 4: Trump Card Visual Highlight**
  - Apply a subtle golden/amber border glow (`box-shadow: 0 0 10px rgba(212, 175, 55, 0.45); border-color: #d4af37;`) and a small corner trump badge to all trump cards in hand and in play.
- **Item 5: 3-Mode Client-Side Hand Sorting (`SortBar`)**
  - Place a compact `SortBar` in `Row 3, Col 3` directly adjacent to player hand with 3 toggle buttons:
    1. `Suit`: Grouped by suit, ascending rank within each suit; trump suit grouped to far right (Default sort).
    2. `Pairs`: Unsuited rank-order matching identical ranks/pairs together, regardless of suit.
    3. `Rank`: Pure rank order ascending where all trump cards rank higher than non-trump cards.
  - Sorting is strictly client-side and never mutates server state.
- **Item 7: Minimalist Hand Controls**
  - Remove `Attack` and `Redirect` text buttons and any instruction text below the hand.
  - Place contextual `Surrender` (shown only to defender when facing uncovered cards) and `Pass` (shown only to attackers when all bout cards are covered) buttons in **`Row 3, Col 3`** next to the `SortBar`.
- **Item 16: Suppress UI Error Banners (Client-Side)**
  - Remove invalid-move error banners from the UI DOM. Log drop rejection or invalid attempts via `console.warn` without rendering text banners on the screen.
- **Item 17: Turn Nudge Pulsing Animation**
  - Remove all text banners ("Your turn to defend", "It's X's turn").
  - On the **defending player's client only** (facing uncovered cards), apply subtle CSS pulse animation (`animation: turnPulse 2.4s infinite ease-in-out`) around uncovered attacking cards.
  - On the **active attacker's client only** (waiting to attack or throw in), apply the same subtle pulsing glow around their hand container.

## Target Files
- `frontend/src/components/Card.tsx`
- `frontend/src/components/SortBar.tsx` (New File)
- `frontend/src/components/ActionBar.tsx`
- `frontend/src/components/GameTable.tsx`
- `frontend/src/pages/GamePage.tsx`
- `frontend/src/styles/table.css`
- `frontend/src/__tests__/Card.test.tsx`
- `frontend/src/__tests__/GameTable.test.tsx`

## Implementation Steps
1. Update `Card.tsx` and `table.css`:
   - Detect if card matches `trumpSuit`.
   - Apply amber border glow and corner trump icon badge.
2. Create `frontend/src/components/SortBar.tsx`:
   - Add toggles: `Suit`, `Pairs`, `Rank`.
   - Implement sorting algorithms for all 3 modes; default to `Suit`.
3. In `ActionBar.tsx` / `GameTable.tsx`:
   - Remove standalone `Attack` / `Redirect` buttons.
   - Render contextual `Surrender` and `Pass` buttons in `Row 3, Col 3` alongside `SortBar`.
4. In `GamePage.tsx`:
   - Suppress error banner state rendering; emit `console.warn` on rejected actions.
5. In `table.css`:
   - Define `@keyframes turnPulse` (gentle opacity/box-shadow pulsing over 2.4s).
   - Apply to defender's uncovered bout cards and attacker's hand container when active.

## Verification Commands
- `npm test -- --run`

## Completion Requirements
- All tests pass in `npm test -- --run`.
- Zero text error banners rendered in DOM.
- Update `.reviews/agent_notes.md` with implementation summary.
- Run `echo "DONE" > .tickets/STATUS`.
