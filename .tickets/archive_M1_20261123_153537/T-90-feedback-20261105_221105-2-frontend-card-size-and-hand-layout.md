<!-- WAVE:1 -->
# T-90-feedback-20261105_221105-2 — Card Size Parity (`100×140`), 20%–80% Hand Overlap, Tight Non-Rectangular Hand Highlight Contour, and Drag Card Visibility

## Summary
Update the frontend card rendering, hand layout calculation, hand highlight contour, and pointer drag rendering so that:
1. All playing cards match the larger `100px × 140px` size (`48px × 68px` below `900px` mobile breakpoint) of the throw-in and redirect outlines (`ITEM-1b`).
2. Active player hand cards overlap by `20%` of their width at minimum and `80%` of their width at maximum (adjusted so the left-side rank symbol and suit are always visible on every card, and even a 28–36 card hand never goes off screen or overlaps UI elements) (`ITEM-4`).
3. The active player's hand highlight contour responsively wraps tightly around the hand at all times, distorting non-rectangularly when playable/selected cards are shifted upwards (`ITEM-2`).
4. Clicking and dragging a card never makes it invisible — cards remain displayed at all times (`ITEM-3`).

## Scope Constraints (STRICT)
- **ONLY touch files inside `frontend/`.** Do NOT modify `backend/`, `README.md`, `ARCHITECTURE.md`, or `play-local.sh`.

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-1b (QA Playbook #2 — Cards Match the Larger Outline Dimensions):**
  > "2. Currently, the throw-in and redirect outlines match in size, while the actual cards are substantially smaller. Ensure that the cards are also the (larger) size of the outlines."
  - In `frontend/src/components/Card.tsx`, `frontend/src/components/TablePair.tsx`, `frontend/src/pages/GamePage.tsx` (and `frontend/src/components/GameTable.tsx` if used), `frontend/src/utils/boutLayout.ts`, `frontend/src/utils/handLayout.ts`, and `frontend/src/styles/table.css` (and `frontend/src/app.css` if applicable):
    - Set standard playing card dimensions on desktop to **`100px × 140px`** (`width: 100px; height: 140px; min-width: 100px; min-height: 140px; flex: 0 0 100px; box-sizing: border-box;`), matching `[data-testid="throw-in-outline"]`, `[data-testid="redirect-outline"]`, and `[data-testid^="target-outline-"]`.
    - Set standard playing card dimensions below the `900px` mobile breakpoint (`@media (max-width: 900px)`) to **`48px × 68px`**, matching the mobile outline size.
    - Ensure `Card.tsx` sets `width={100}`, `height={140}`, `data-card-width="100"`, and `data-card-height="140"` by default (while preserving explicit compact/mini overrides such as `.mini-card` for opponent transparent-mode badges if used), and ensure no CSS rule in `table.css` or `app.css` shrinks `.card-svg`, `.bout-card`, `.bout-pair`, or `.hand-card-wrapper` below `100px × 140px` on desktop.
    - Update `boutLayout.ts` and `handLayout.ts` default desktop card constants to `CARD_WIDTH = 100` and `CARD_HEIGHT = 140` (`48 × 68` on mobile).

- [ ] **ITEM-4 (New #3 — Active User Hand Overlap 20% Min to 80% Max, Left Index Always Visible, Full-Deck Safe):**
  > "3. Arrange the cards in the active user's hand subject to the following constraints: all cards should overlap by 20% of their width at minimum and by 80% of their width at maximum. (These percentages are approximate - adjust them as needed to make sure that the left-side rank symbol and suit is always visible on every card, and so that even if a player picks up every card into their hand, the hand won't look wrong graphically (i.e. go off screen or overlap UI elements)). Keep in mine New Item #1 when implementing this, and vice versa."
  - **Left-Side Rank & Suit Index Geometry (`Card.tsx`):**
    - Ensure the top-left rank label and suit symbol in `Card.tsx` (`viewBox="0 0 70 100"`, rendered at `100px × 140px`) are positioned near the left margin (centered around `x = 7.5` in the `70`-unit viewBox, occupying `x ∈ [2.5, 12.5]`, which is `~3.5px` to `~18px` at `100px` card width) so that even when the next card overlaps by `80%` of width (leaving the leftmost `20%` = `20px` of each card uncovered), the top-left rank symbol and suit pip on EVERY card in hand are 100% visible and unobstructed.
  - **Hand Overlap Calculation (`handLayout.ts`, `GamePage.tsx`, `GameTable.tsx`, `table.css`):**
    - For `N` cards of width `W` (`100px` desktop, `48px` mobile) in an available hand container width `availableWidth`:
      - Minimum overlap is **20% of card width** (`MIN_OVERLAP_RATIO = 0.20`, so maximum horizontal step/stride between consecutive cards is `maxStride = 0.80 * W = 80px`, i.e. `overlapPx = 20px` on desktop).
      - Maximum standard overlap is **80% of card width** (`MAX_OVERLAP_RATIO = 0.80`, so minimum standard horizontal step/stride is `minStride = 0.20 * W = 20px`, i.e. `overlapPx = 80px` on desktop, leaving a `20px` visible left strip on every card).
      - For `N <= 1`: `overlapPx = 0`, `stride = W`, `totalWidth = N * W`.
      - For `N >= 2`: compute `idealStride = (availableWidth - W) / (N - 1)`. Clamp `stride` between `0.20 * W` and `0.80 * W` so `overlapRatio = (W - stride) / W` stays within `[0.20, 0.80]`.
      - **Full-Deck Pickup Safeguard (25–52 cards):** If a player picks up almost the entire deck so that `W + (N - 1) * (0.20 * W) > availableWidth`, allow the stride to compress down to `Math.max(15, (availableWidth - W) / (N - 1))` (up to `~85%` overlap where the `15px–18px` left rank/suit index strip is still visible) and/or apply a responsive CSS scale/fit on `.hand-cards` so `totalWidth` NEVER exceeds `availableWidth`, NEVER goes off-screen, and NEVER overlaps the bottom-right Surrender/Pass buttons or talon/sidebar zones.
    - Expose `data-overlap-ratio`, `data-overlap-px`, `data-stride-px`, and `data-hand-width` on `.hand-cards` (and `data-card-x` / `data-card-y` on each `.hand-card-wrapper`) for deterministic testing.

- [ ] **ITEM-2 (New #1 — Tightly Wrapped, Non-Rectangular Hand Highlight Contour):**
  > "1. The active player's hand highlight box doesn't match with or align to the player's actual card positions at all. Adjust the implementation, ignoring all past specs for this component, to make sure that the highlight box responsively wraps tightly around the hand at all times. This means that if certain cards are shifted upwards to be playable, the highlight box should distort accordingly to keep wrapped tightly around the hand as a whole ("box" is no longer the right word - the outline does not need to maintain a rectangular shape)."
  - Remove the old loose rectangular CSS border/box-shadow on `.hand-cards` that failed to match card positions.
  - Size `.hand-cards` to the exact horizontal and vertical footprint of the overlapped cards (`width: ${totalHandWidth}px; height: ${cardHeight}px; position: relative; padding: 0;`).
  - Render an SVG highlight contour `<svg class="hand-highlight-contour" data-testid="hand-highlight-contour">` (with `<path data-testid="hand-highlight-path" d={contourPath} />`) anchored to `.hand-cards` that computes the exact tight outer boundary around all cards `i = 0 .. N-1` in the hand:
    - Each card `i` has known horizontal span `[x_i, x_i + W]` and vertical span `[y_i, y_i + H]`, where `y_i` is negative (e.g. `-14px`) when card `i` is shifted upwards as playable or selected, and `0` otherwise.
    - Compute the tight union boundary polygon/path (with a tight `3px–4px` padding offset around the cards and rounded joins `stroke-linejoin="round"`) across the x-axis breakpoints of all card rectangles `[x_i - pad, x_i + W + pad] × [y_i - pad, y_i + H + pad]`:
      - Trace the upper envelope `(x, minTop(x))` from left to right and the lower envelope `(x, maxBottom(x))` from right to left to form a closed SVG `<path d="M ... Z" />`.
      - When playable or selected cards are shifted upwards (`y_i < 0`) while other cards remain at `y = 0`, the contour path **distorts non-rectangularly** — stepping up tightly over the raised cards and stepping down tightly over the unraised cards (and stepping up along the bottom edge under raised cards that are not overlapped by unraised neighbors).
    - Style the contour `<path>` using the current theme's semantic role colors (`var(--hl-attacker-border)` / `var(--hl-attacker-glow)` when attacking/throwing-in, `var(--hl-defender-border)` / `var(--hl-defender-glow)` when defending, or a subtle neutral contour when waiting) and set `data-non-rectangular={hasMixedElevations ? "true" : "false"}` and `data-contour-width={totalHandWidth}` on `[data-testid="hand-highlight-contour"]`.

- [ ] **ITEM-3 (New #2 — Dragged Card Remains Visible at All Times):**
  > "2. Bug: Clicking and dragging a card makes it invisible. Cards should be displayed at all times (aside from overlap rules as we have defined), regardless of if they are bing dragged or not."
  - Fix the pointer-drag implementation in `GamePage.tsx` (and `GameTable.tsx`) and `table.css`:
    - Remove any `opacity: 0`, `visibility: hidden`, `display: none`, or zero-width clipping on a card when it is clicked and dragged (`isDragging` / `.dragging` / `.hand-card-slot`).
    - When a card is being dragged (either within the hand for custom reordering or toward the battlefield to play), the card itself (or its active dragged card element) MUST remain 100% visible (`opacity: 1; visibility: visible; pointer-events: none; z-index: 1000;`) at its full `100px × 140px` size translated smoothly with the pointer (`transform: translate3d(dx, dy, 0)`), and ensure parent containers (`.hand-cards`, `[data-zone="player-hand"]`, `[data-zone="table-arena"]`) do not clip the dragged card with `overflow: hidden`.

## Verification & Test Commands
Run the frontend test suite and ensure all tests pass:
```bash
cd frontend && npm test -- --run
```
Add/update unit tests in `frontend/src/__tests__/Card.test.tsx`, `frontend/src/__tests__/GamePage.test.tsx`, and `frontend/src/__tests__/GameTable.test.tsx` to verify:
1. Cards render at `100px × 140px` matching `[data-testid="throw-in-outline"]` and `[data-testid="redirect-outline"]`.
2. Hand overlap stays between `20%` and `80%` for normal hands and never overflows `availableWidth` even with 30–36 cards.
3. `[data-testid="hand-highlight-contour"]` tightly wraps the hand width and distorts non-rectangularly (`data-non-rectangular="true"`, with multiple distinct Y coordinates in `d`) when a subset of cards in hand is playable/raised.
4. Clicking and dragging a card (`pointerDown` + `pointerMove`) keeps the card visible (`opacity !== '0'`, `visibility !== 'hidden'`, present in DOM).

