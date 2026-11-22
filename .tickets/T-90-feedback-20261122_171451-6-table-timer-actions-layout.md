<!-- WAVE:3 -->
# Ticket: Turn Timer Clearance Above Hand & Relocate Surrender/Pass Buttons to Lower Game Table Area

## Context & Objective
Finalize the `[data-zone="table-arena"]` CSS Grid layout after Wave 2's hand mechanics land so that:
1. The turn timer appearing above the active user's hand has dedicated non-overlapping clearance above fully-raised selected cards (Item #8) and the tight hand contour, while remaining in the same general location above the hand (Item #4).
2. The compact themed icon Surrender and Pass buttons (`ActionBar.tsx` / `SurrenderIcon` / `PassIcon`) are moved out of the bottom-right corner (Row 3 Col 3) onto the lower part of the game table area, positioned cleanly via CSS Grid/Flexbox so they NEVER overlap bout cards, outlines, the turn timer, the hand (including full-width 30-card hands from Item #5 and full-raised selected cards from Item #8), `[data-zone="table-deck"]`, or `SortBar` (Item #7).

## Target Files (Do Not Touch `GamePage.tsx`, `LobbyPage.tsx`, `Card.tsx`, `handLayout.ts`, `backend/`, `README.md`, or `ARCHITECTURE.md`)
- `frontend/src/components/ActionBar.tsx`
- `frontend/src/styles/actionIcons.css`
- `frontend/src/components/GameTable.tsx`
- `frontend/src/styles/table.css`
- `frontend/src/__tests__/ActionIcons.test.tsx`
- `frontend/src/__tests__/GameTable.test.tsx`

## Implementation Requirements
1. **Non-Overlapping Turn Timer Clearance Above Active Hand (Item #4):**
   - Locate the turn timer displayed above `[data-zone="player-hand"]` in `GameTable.tsx` / `table.css`.
   - Give the timer its own dedicated CSS Grid track / Flexbox row above the player hand zone, with explicit vertical clearance (padding/gap/margin >= `FULL_SELECTED_LIFT_PX` + contour stroke/padding + breathing room) between the timer's bottom edge and the top edge of a fully-raised selected card's highlight contour.
   - Verify that even when cards in `[data-zone="player-hand"]` are half-raised (eligible) or full-raised (selected, Item #8) AND hovered (Item #6) across a full maximal-box width (Item #5), the timer is NEVER clipped, cut off, or overlapped by cards, the hand contour, bout cards, or the relocated Surrender/Pass buttons.
   - Keep the timer in the same general location (centered/anchored above the active user's hand).
2. **Relocate Surrender & Pass Buttons to Lower Game Table Area (Item #7):**
   - Move the `ActionBar` (rendering the compact themed `SurrenderIcon` and `PassIcon` buttons) out of Row 3 Col 3 (bottom-right corner next to `SortBar`) and place it inside a dedicated non-overlapping CSS Grid / Flexbox slot in the **lower part of the game table area** (`[data-zone="table-arena"]`, e.g., a dedicated lower-table control band positioned directly below the Row 2 active bout/outlines track and cleanly separated from the turn timer and Row 3 hand/deck/sort controls — or alongside the timer in a dedicated non-overlapping lower-table flex/grid row with explicit `gap` so neither overlaps the other).
   - Keep `SortBar` cleanly in Row 3 Col 3 (bottom-right corner), and keep `[data-zone="table-deck"]` cleanly in Row 3 Col 1.
   - Verify the Surrender and Pass buttons:
     - Remain compact, non-verbal, themed icon buttons (retaining `SurrenderIcon` and `PassIcon` and their dark/felt theme — no bright red, no `"Surrender"`/`"Pass"` text labels, no `"Throw In"` button).
     - NEVER use `position: absolute` or `position: fixed` for placement (strictly CSS Grid / Flexbox with explicit `gap`, `min-width: 0`, `box-sizing: border-box` per `AGENTS.md`).
     - NEVER overlap bout pairs, defender target outlines, redirect outline, throw-in outline, the turn timer above the hand, `[data-zone="player-hand"]` (even in a 30-card maximal-box hand with fully-raised selected cards), `[data-zone="table-deck"]`, or `SortBar`.
   - Verify spatial harmony with Wave 2's Item #5 maximal hand box: ensure Row 3's layout allows `[data-zone="player-hand"]` to expand smoothly up to almost the full width of the play area without colliding with `[data-zone="table-deck"]` or `SortBar` (e.g., if needed, give `[data-zone="table-deck"]` and `SortBar` compact flanking tracks or a clean non-overlapping Row 3 grid layout that preserves all `AGENTS.md` zones and zero overlap).

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-4:** The turn timer appearing above the active user's hand sits in the same general location above the hand and has dedicated CSS Grid/Flexbox vertical clearance so it is NEVER cut off or overlapped by half-raised eligible cards, full-raised selected cards, the hand highlight contour, or any other game element.
- [ ] **ITEM-7:** The Surrender and Pass icon buttons are relocated from the bottom-right corner onto the lower part of `[data-zone="table-arena"]`, using CSS Grid/Flexbox (zero `position: absolute` / `position: fixed` structural placement), and never overlap bout cards, outlines, the turn timer, the active player's hand, the talon deck, or `SortBar`.
- [ ] Both Surrender (`qa-normal-6-actions` as Bob, `qa-large-30-compress` as Alice) and Pass (`qa-normal-6-actions` as Alice) buttons remain fully clickable, icon-only, themed, and properly wired to their game actions.
- [ ] Zero table text clutter is introduced (respecting `AGENTS.md` Rule #3).
- [ ] Add/update tests in `frontend/src/__tests__/ActionIcons.test.tsx` and `frontend/src/__tests__/GameTable.test.tsx` verifying:
  - Surrender and Pass buttons render inside the lower game table area slot (NOT inside the bottom-right `SortBar` corner container).
  - The turn timer above the hand renders in its dedicated non-overlapping container separate from the hand card transform container.
  - Clicking Surrender and Pass in the new location dispatches the exact expected actions.
- [ ] Run `cd frontend && npm test -- --run` (and `cd backend && sbt -batch test` if desired for full confidence) and verify 100% of tests pass with zero errors.
- [ ] Do NOT edit `GamePage.tsx`, `LobbyPage.tsx`, `Card.tsx`, `handLayout.ts`, `backend/`, `README.md`, or `ARCHITECTURE.md`.
