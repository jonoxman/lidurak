<!-- WAVE:2 -->
# Ticket T-90-feedback-20261031_180708-5-table-controls: SortBar Dropdown, Legal Card Shift, Fixed Player Ordering, Drag Pointer Cursor, Highlight Polish, and Text Selection Protection

## Wave: 2 (Runs in parallel with Header Bar & Preferences; builds on Wave 1 Card Sizing & Deck Layout)

## Overview & Scope
Refine the game table arena controls and presentation: condense SortBar into a space-efficient dropdown, automatically elevate legal hand cards, lock player ordering in Hotseat and Players lists, equalize opponent box dimensions, enforce pointer finger drag cursors, restrict text selection across game elements, distinguish attacker vs defender highlight colors, and tightly fit the attacker's hand highlight.

This addresses items **11**, **12**, **13**, **15**, **17**, **19**, **20**, **21**, and **22**:
- **Requirement 11:** Replace the three buttons ("Suit", "Pairs", "Rank") beside the hand with a single clean dropdown selector in the same location to conserve screen space.
- **Requirement 12:** In the user's hand, automatically shift cards that are currently legal to play upwards slightly (e.g. `transform: translateY(-8px)`) to provide visual indication of legal moves.
- **Requirement 13:** In the Hotseat menu and the Players list on the right, keep player order fixed (by seat index `p0`, `p1`, etc.) instead of reordering the active player to the top.
- **Requirement 15:** Make the dimensions of all opponent player boxes strictly equal to each other.
- **Requirement 17:** Turn the "Back to lobby" link at the top right of the game page into a styled button element matching site aesthetics.
- **Requirement 19:** During card dragging, prevent the cursor from turning into a circle-with-slash ("no" symbol); maintain the clickable element pointer finger / grabbing cursor throughout drag.
- **Requirement 20:** Prevent text highlighting (`user-select: none`) across all game elements, buttons, timers, and table area, with exceptions ONLY for the game ID, the HOW TO PLAY section, and players' names.
- **Requirement 21:** Use distinct highlight colors for the player about to attack vs the player about to be attacked. The attacking player's highlight must match the highlight of their hand.
- **Requirement 22:** Ensure the hand highlight box for the attacking player (from their perspective only) fits tightly around their cards without excessive padding/spacing.

## Affected Files
- `frontend/src/components/SortBar.tsx`
- `frontend/src/components/GameTable.tsx`
- `frontend/src/pages/GamePage.tsx`
- `frontend/src/styles/table.css`
- `frontend/src/__tests__/SortBar.test.tsx`
- `frontend/src/__tests__/GamePage.test.tsx`
- `frontend/src/__tests__/GameTable.test.tsx`

## Strict Autonomous Agent Rules Compliance
1. **Scope:** Only implement the UI controls, cursor fixes, selection restrictions, and layout polish in this ticket.
2. **Resuming Partial Work:** Run `git status` and `git diff` first.
3. **Mandatory Testing:** Run `npm test -- --run` and ensure all tests pass.
4. **Zero-Overlap Architecture:** Strictly follow CSS Grid rules. Col 3 of Row 3 holds the SortBar dropdown + Pass/Surrender button. No floating text banners.
5. **Completion Sentinel:** Run `echo "DONE" > .tickets/STATUS` after tests pass.

## Detailed Technical Specifications

### 1. Compact SortBar Dropdown (`frontend/src/components/SortBar.tsx`)
Replace the three separate buttons with a `<select>` or custom dropdown:
```tsx
<div class="sort-bar" data-testid="sort-bar">
  <label for="sort-mode-select" class="sr-only">Sort Hand</label>
  <select
    id="sort-mode-select"
    class="sort-dropdown"
    value={mode}
    onChange={(e) => onModeChange((e.target as HTMLSelectElement).value as SortMode)}
    data-testid="sort-dropdown"
  >
    <option value="suit">Sort: Suit</option>
    <option value="pairs">Sort: Pairs</option>
    <option value="rank">Sort: Rank</option>
  </select>
</div>
```

### 2. Legal Hand Card Elevation (`frontend/src/components/GameTable.tsx`, `frontend/src/styles/table.css`)
Determine if a card in `myHand` is legal to play given current table state, role (attacker/defender), and bout phase. Legal cards receive a CSS class `card-legal`:
```css
.card-slot.card-legal {
  transform: translateY(-8px);
  transition: transform 0.15s ease-out;
}
```

### 3. Fixed Player Ordering (`frontend/src/pages/GamePage.tsx`)
In the hotseat switcher and right sidebar player list:
- Do NOT sort active player to index 0.
- Render players in their natural, immutable seat order (`p0`, `p1`, `p2`, ...). Highlight the active player with active styling while preserving list position.

### 4. Uniform Opponent Box Sizing (`frontend/src/styles/table.css`)
In Row 1 of `[data-zone="table-arena"]`:
- Give `.opponent-seat` identical sizing rules: `flex: 1 1 0; min-width: 0; box-sizing: border-box; height: 110px;`.

### 5. "Back to Lobby" Button (`frontend/src/pages/GamePage.tsx`)
Replace `<a href="#" class="lobby-link">Back to lobby</a>` with:
```tsx
<button type="button" class="action-button secondary back-lobby-btn" onClick={() => navigate('/')}>
  Back to Lobby
</button>
```

### 6. Drag Cursor Pointer Fix (`frontend/src/components/Card.tsx`, `frontend/src/components/GameTable.tsx`)
In `onDragStart(event: DragEvent)`:
```ts
if (event.dataTransfer) {
  event.dataTransfer.effectAllowed = 'move';
}
```
In `onDragOver(event: DragEvent)` on drop targets:
```ts
event.preventDefault();
if (event.dataTransfer) {
  event.dataTransfer.dropEffect = 'move';
}
```
Set `.playing-card[draggable="true"] { cursor: pointer; }` and ensure dragging does not show a slashed circle.

### 7. Text Selection Protection (`frontend/src/styles/table.css`)
Apply `user-select: none; -webkit-user-select: none;` across `.table-arena`, `.action-bar`, `.sort-bar`, `.turn-clock`, and buttons.
Apply `user-select: text;` ONLY to `.game-id-text`, `.how-to-play-content`, and `.player-name`.

### 8. Distinct Attacker vs Defender Highlight Colors & Tight Hand Highlight
- Attacking seat highlight: `#3b82f6` (blue) or bright emerald `#10b981`.
- Defending seat highlight: `#ef4444` (crimson) or amber `#f59e0b`.
- The active attacking player's hand highlight (`[data-zone="player-hand"].is-attacker`) must match the attacker's highlight color and use `padding: 4px; display: inline-flex; width: fit-content;` so the outline wraps tightly around the cards without empty spacing.

## Step-by-Step Implementation Instructions
1. Refactor `SortBar.tsx` to render the clean dropdown.
2. In `GameTable.tsx`, compute `isLegal` for hand cards and apply `card-legal` class with `-8px` lift.
3. Lock player order in `GamePage.tsx` for both the hotseat tabs and sidebar player list.
4. Update `table.css` to enforce equal opponent box sizes and text selection restrictions.
5. Replace the "Back to lobby" link with a styled button element.
6. Configure `effectAllowed` and `dropEffect` in drag handlers to prevent the slashed circle cursor.
7. Update seat and hand highlight CSS for attacker vs defender, ensuring tight hand bounding.
8. Run unit and component tests.

## Verification Commands
```bash
cd /home/shade_of_ox/agent-project/frontend
npm test -- --run src/__tests__/SortBar.test.tsx
npm test -- --run src/__tests__/GamePage.test.tsx
npm test -- --run src/__tests__/GameTable.test.tsx
npm test -- --run
```
