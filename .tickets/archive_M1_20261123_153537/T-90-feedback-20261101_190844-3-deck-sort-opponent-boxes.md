<!-- WAVE:1 -->
# Ticket 3: Deck Box Title & Centering, Top-Left Counter Ovals, Opponent Hand Centering, and Sidebar Hand Sort Box

## Summary
Implement four layout and counter improvements across the right sidebar and opponent player boxes:
1. Place the deck card counter oval on the **top left** of the deck instead of the bottom right (Item 6).
2. Add a `'DECK'` title to the box containing the deck in the right sidebar, and center the deck (along with the exposed trump card and `TRUMP` indicator in their same relative positions) horizontally within the box instead of aligning it to the left (Item 10).
3. Move the hand sorting dropdown (`SortBar`) outside of the play area into its own box element directly under the box holding the deck in the right sidebar (Item 9).
4. Center each non-user player's cards within their player box, remove the `'N cards'` text below their cards, and display a counter oval on the **top left** of their hand similar to the deck counter (Item 12).

## Files to Modify
- `frontend/src/pages/GamePage.tsx`
- `frontend/src/components/GameTable.tsx`
- `frontend/src/components/SortBar.tsx`
- `frontend/src/styles/table.css`
- `frontend/src/__tests__/GamePage.test.tsx`
- `frontend/src/__tests__/GameTable.test.tsx`

*(Do NOT modify `HeaderBar.tsx`, `CardBack.tsx`, `app.css`, `LobbyPage.tsx`, `README.md`, or `ARCHITECTURE.md` in this ticket.)*

## Requirements

### 1. Deck Box `'DECK'` Title, Centered Deck Assembly & Top-Left Counter Oval (Items 6 & 10)
- In the right sidebar (`[data-zone="sidebar-right"]`), add a `'DECK'` title header inside the box containing the deck (`[data-zone="table-deck"]`), styled consistently with the `'PLAYERS'` box header.
- Center the deck assembly (the vertical talon deck stack, the exposed horizontal trump card sticking out to its right, and the `TRUMP` suit badge underneath) horizontally within the deck box instead of left-aligning it, while keeping the relative positions of the deck, exposed trump card, and `TRUMP` indicator unchanged.
- Position the deck card counter oval (`.deck-count-badge` / `[data-testid="deck-count"]`) on the **top left** of the deck stack (`data-position="top-left"`) instead of on the bottom right.

### 2. Hand Sorting Dropdown in its Own Box Below the Deck Box (Item 9)
- Remove the hand sorting control (`SortBar`) from inside the felt play area (`GameTable.tsx` Row 3 Col 3). Keep the contextual `Surrender` / `Pass` action button in Row 3 Col 3 of `GameTable.tsx`.
- Render the hand sorting control (`SortBar`) in **its own box element** (e.g., `data-zone="hand-sort-box"` / `data-testid="hand-sort-box"` with class `sidebar-box sidebar-sort-box`) inside `[data-zone="sidebar-right"]` directly **underneath** the deck box (`[data-zone="table-deck"]`).
- Ensure `SortBar` provides a dropdown/selector for hand sorting (`Suit`, `Pairs`, `Rank`) and shares `sortMode` state with `GameTable` via `GamePage.tsx` (while keeping a default `sortMode = 'suit'` prop on `GameTable` so standalone `<GameTable />` unit tests work with or without an explicit prop).

### 3. Opponent Player Boxes: Centered Cards & Top-Left Counter Oval (Item 12)
- In `GameTable.tsx` Row 1 (`data-seat="top-left"`, `data-seat="top-center"`, `data-seat="top-right"`):
  - Center the non-user player's face-down cards horizontally within their player box (`justify-content: center; align-items: center`).
  - Remove the `'N cards'` / `'1 card'` text string rendered beneath the opponent's cards.
  - Display a counter oval on the **top left** of the opponent's hand (`data-testid={`opponent-card-count-${opponent.id}`}` and `data-position="top-left"`, styled consistently with the deck's top-left counter oval) showing `opponent.cardCount`.

## Acceptance Criteria & Testing
1. Update and add tests in `frontend/src/__tests__/GamePage.test.tsx` and `frontend/src/__tests__/GameTable.test.tsx` verifying:
   - The deck box in `sidebar-right` renders the `'DECK'` title, centers the deck + trump assembly, and places the deck card counter on the top-left (`data-position="top-left"`).
   - The hand sorting dropdown box (`[data-zone="hand-sort-box"]`) is rendered outside the play area in `sidebar-right` immediately after `[data-zone="table-deck"]`, and changing the sort mode reorders the active player's hand.
   - Opponent seats center their cards, do not render `'N cards'` text underneath, and display a counter oval on the top-left of their hand with their exact `cardCount`.
2. Run `cd frontend && npm test -- --run` and ensure all frontend tests pass.
