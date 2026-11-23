<!-- WAVE:1 -->
# T-90-feedback-20261123_020207-2: Localized Hand Hover Parting & 60fps GPU-Composited Animation Performance (Frontend)

## Objective
Rework the hand hover parting behavior and animation pipeline so that:
1. **Only the cards very close to the cursor part at all**, while most cards remain overlapping as the size of the hand demands (reversing the wide/global spread behavior).
2. **Animation framerate is silky-smooth (60fps)** by moving hand card positioning/parting to GPU-composited `transform: translate3d(...)`, removing layout-thrashing CSS animations, and eliminating redundant pointer-move React re-renders.

## Scope & Target Files (Frontend Hand-Layout & Hover Parting Only)
- `frontend/src/utils/handLayout.ts`
- `frontend/src/components/GameTable.tsx`
- `frontend/src/styles/table.css`
- `frontend/src/__tests__/handLayout.test.ts`
- `frontend/src/__tests__/handPresentation.test.tsx`
- `frontend/src/__tests__/GameTable.test.tsx`
- **STRICT FORBIDDEN FILES:** Do NOT edit `README.md`, `ARCHITECTURE.md`, `play-local.sh`, `backend/*`, `frontend/src/pages/LobbyPage.tsx`, `frontend/src/pages/GamePage.tsx`, or `frontend/src/api/client.ts`.

## Implementation Requirements
1. **Strictly Localized Parting Geometry (`frontend/src/utils/handLayout.ts`):**
   - Update `computePartedCardPositions` so that hovering card index `h` ONLY parts cards very close to `h` (tight local radius of immediate neighbors around the cursor, e.g., `|i - h| <= 2` or `<= 3` with sharp local decay so distant cards have **exact `0px` displacement** from their resting positions!).
   - Specifically, in a large compressed hand (e.g., 30 cards in `qa-large-30-compress`):
     - Most cards in the hand MUST remain strictly at their resting overlapping positions (`Math.abs(partedX[i] - restX[i]) === 0` for cards outside the immediate local neighborhood of the hovered card).
     - The hovered card `h` and its immediate adjacent cards part cleanly enough to expose card `h`'s face/index strip clearly while strictly preserving monotonic left-to-right card ordering (`x[0] < x[1] < ... < x[n-1]`) and keeping all cards within `[data-zone="player-hand"]` / `[data-zone="table-arena"]` horizontal lane margins (`HAND_LANE_MARGIN_PX`).
   - Preserve small-hand (2–6 cards) resting overlap slightly larger than the minimum overlap so small hands still exhibit a crisp local parting response on hover, and ensure a `1`-card hand never shifts horizontally (`0px` shift).
   - Export clean pure helper(s) for resting positions and localized parting displacements so Wave 2 can reuse the exact same high-FPS `translate3d` positioning primitives for in-hand drag parting.
2. **60fps GPU-Composited Rendering (`frontend/src/components/GameTable.tsx` & `frontend/src/styles/table.css`):**
   - Replace any layout-triggering animated CSS properties (`left`, `top`, `margin-left`, `width`, `transition: all`) on hand card wrappers with pure compositor-only `transform: translate3d(${x}px, ${y}px, 0)` (anchoring card wrappers at `left: 0` inside the hand track or applying pure `translate3d` delta offsets from static base positions, respecting the Zero-Overlap CSS Grid rules for zones/sidebars/seats).
   - Restrict CSS transitions on hand card slots strictly to `transform` (e.g., `transition: transform 120ms cubic-bezier(0.22, 1, 0.36, 1)`) and avoid animating expensive paint properties (`box-shadow`, `filter`, `margin`, `left`) across the hand during pointer sweeps.
   - Coalesce pointer hover tracking (`onPointerMove` / `onMouseMove`) via `requestAnimationFrame` and skip `setHoveredCardIndex` whenever the resolved index has not changed, preventing redundant React renders on sub-pixel mouse movement.
   - Memoize hand card slot elements (`React.memo`) and layout computation (`useMemo`) so hovering across a 30-card hand only updates the handful of cards whose `transform` actually changed and never re-renders the table arena, opponents, or sidebars.
   - Preserve center-locked `[data-testid="drag-card-preview"]` cursor alignment, non-overlapping turn timer / surrender behavior, and edge-collapsed covered table pairs.

## End-to-End Wiring
- **Frontend Components & Utilities:** `frontend/src/utils/handLayout.ts` (`computePartedCardPositions`, `resolveHoveredCardIndex`), `frontend/src/components/GameTable.tsx` (`[data-zone="player-hand"]` / `.hand-cards`), and `frontend/src/styles/table.css`.
- **QA Scenario Testability (< 15 seconds):** Immediately testable in 1 click using the existing `'30-Card Compress & Part'` (`qa-large-30-compress`), `'6-Card 10s & Actions'` (`qa-normal-6-actions`), and `'1-Card Hand (No Part)'` (`qa-single-card`) QA presets in Lobby & Left Sidebar.

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-QA6 (Verbatim):** *"When I said 'smooth' I meant that the frame rate of the animation feels a little choppy. In fact, for the way the animation looks, I want the opposite of this change: only the cards very close to the cursor should part at all, with most cards remaining overlapping as the size of the hand demands. Try to implement this and improve the performance/framerate of the animation, if possible."*
- [ ] In a 30-card hand (`qa-large-30-compress`), hovering a middle card (e.g., index 15) shifts ONLY cards very close to the hovered index (local neighborhood around the cursor) while distant cards (e.g., indices `0..10` and `20..29`) remain untouched at their resting overlapping positions (`dx === 0`).
- [ ] Card ordering remains strictly monotonic (`x[i] < x[i+1]`) across all hover indices (`0` through `N - 1`) and all cards remain inside the hand lane margins.
- [ ] Small hands (2–6 cards, e.g. `qa-normal-6-actions`) still locally part adjacent cards on hover, and a 1-card hand (`qa-single-card`) produces `0px` horizontal shift.
- [ ] Hand card parting animates exclusively via GPU-composited `transform: translate3d(...)` with `transition` restricted to `transform` (no animated `left`/`margin-left`/`transition: all`), and pointer-move hover resolution is rAF-coalesced and deduplicated by hovered index to prevent React render thrashing.
- [ ] Unit and component tests in `handLayout.test.ts`, `handPresentation.test.tsx`, and `GameTable.test.tsx` verify: (a) distant cards remain at `dx === 0` during hover in a 30-card hand, (b) immediate neighbors around the hovered index part cleanly with monotonic coordinates, (c) small-hand (6-card) local parting and 1-card no-part invariants, and (d) `translate3d` transform-based positioning.
- [ ] Run `cd frontend && npm test -- --run` and confirm 100% pass.
- [ ] Write a concise summary of changes in `.reviews/agent_notes.md`, then run `echo "DONE" > .tickets/STATUS`.
