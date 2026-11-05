<!-- WAVE:3 -->
# Ticket `T-90-feedback-20261104_195410-3`: Synchronize `README.md`, `ARCHITECTURE.md`, and `play-local.sh`

## Summary
Update `./README.md`, `./ARCHITECTURE.md`, and `./play-local.sh` to accurately document all changes implemented in Wave 1 (`T-90-feedback-20261104_195410-1`) and Wave 2 (`T-90-feedback-20261104_195410-2`), and run both backend and frontend test suites to ensure 100% green status.

---

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-DOCS — Synchronize Living Project Documentation (`./README.md`, `./ARCHITECTURE.md`, `./play-local.sh`):**
  - **`./README.md`:**
    - Document the `Glow` slider (renamed from `Intensity`) inside `Guest ▸ Theme ▸ Palettes` and that it dynamically scales the glow around opponent player seat boxes on the felt table as well as player rows in `PLAYERS`, hand glows, and outlines.
    - Document the Light Mode status labels (`WINNER`, `OUT`, `PASSED`, `DURAK`) in `PLAYERS`: consistent with Dark Mode, `WINNER`, `OUT`, and `PASSED` share the same uniform darker high-contrast color and have no border, while only `DURAK` has a border.
    - Document the restored `<select>` dropdown menu in `HAND SORTING` (`Suit`, `Pairs`, `Rank`, `Custom`, with `Rank` as default for new users and `Custom` non-persistent across games).
    - Document the two-stage hand reordering animation (closing the gap at the dragged card's original position as if removed from the hand, then parting cards at the target insertion slot) and the persistent link-hovering pointer finger cursor (`cursor: pointer`) before and throughout dragging.
    - Document that `[data-testid="throw-in-outline"]` always displays next to current played cards during an ongoing attack, even if players have no cards they can legally place into it.
    - Document that trump cards (both full-size `Card.tsx` and Transparent Mode low-detail opponent mini-cards) use **only the gilded border** (`.trump-card`), with all trump corner circles and extra suit symbols removed.
    - Document the fixed `.hand-cards` highlight outline encompassing all `100px × 140px` cards and the minimum ~10% card-width overlap in both the active user's hand (`>= 10px` overlap) and non-active users' opponent boxes.
    - Document the smooth, bug-free glow animation on incoming uncovered cards (`.table-card-uncovered`) and other glow elements, the `REPLAY CONTROLS` section title, and the brighter Dark Mode outlines on face-down cards (`CardBack.tsx`).
    - Include a concise 15-second QA verification checklist for all updated items.
  - **`./ARCHITECTURE.md`:**
    - Update component and CSS architecture sections (`HeaderBar.tsx`, `SortBar.tsx`, `Card.tsx`, `CardBack.tsx`, `GameTable.tsx`, `TablePair.tsx`, `GamePage.tsx`, `settings.ts`, `table.css`, `app.css`) to match the current implementation.
  - **`./play-local.sh`:**
    - Verify `./play-local.sh` is executable and cleanly starts both backend (`:8080`) and frontend (`:5173`) servers.

---

## Testing & Verification Requirements
- Run `cd backend && sbt -batch test` and `cd frontend && npm test -- --run` and verify all tests pass with zero errors.
