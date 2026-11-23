<!-- WAVE:1 -->
# T-90-feedback-20261122_193457-2: Hand Layout Math — Small-Hand Default Overlap Headroom & Smooth Parting Computation

## Objective
Update the pure hand layout and parting engine in `frontend/src/utils/handLayout.ts` to fulfill **Item 6**'s mathematical foundation:
1. Give small hands (`2 <= cardCount <= 6`) a slightly larger default resting overlap than the minimum overlap (while keeping full `'10'` rank & suit visible and preserving fixed `100×140` / `48×68` card dimensions) so there is explicit expansion margin for the mouseover parting animation.
2. Make the parting position math smooth, continuous-friendly, bounded, strictly stationary on the hovered card, and disabled for 1-card hands (`cardCount <= 1`).

## Scope & Owned Files (Pure Frontend Math Only)
- `frontend/src/utils/handLayout.ts`
- `frontend/src/__tests__/handLayout.test.ts`
- **DO NOT** edit `GameTable.tsx`, `table.css`, `TablePair.tsx`, `LobbyPage.tsx`, `GamePage.tsx`, `README.md`, or `ARCHITECTURE.md`.

## Technical Design Requirements

1. **Preserve Option B Two-Box Invariants & Fixed Card Size:**
   - Card dimensions NEVER shrink (`100px × 140px` desktop, `48px × 68px` mobile).
   - At rest, every card in small (`2..6`) and medium (e.g. `14`) hands MUST expose at least `CARD_INDEX_STRIP_WIDTH_PX` (`36px` desktop, proportional on mobile) so the full `'10'` rank and enlarged suit indicator remain completely uncovered.
   - Medium hands (e.g. 14 cards) still expand horizontally beyond the 6-card default box up to the maximal box (`arenaWidth - 2 * HAND_LANE_MARGIN_PX`) using `>= CARD_INDEX_STRIP_WIDTH_PX` step.
   - Very large hands (e.g. 30 cards) still stay inside the maximal box by compressing the resting step below `CARD_INDEX_STRIP_WIDTH_PX`.

2. **Small-Hand (`2 <= cardCount <= 6`) Default Resting Overlap with Parting Expansion Margin (`ITEM-6b`):**
   - Previously, small hands (`<= 6` cards) did not animate on mouseover because they sat at minimum overlap (or full spread) with no expansion headroom.
   - Increase the default resting overlap for small hands slightly beyond the minimum overlap so that `defaultSmallHandStep < maxPartedStep` while keeping `defaultSmallHandStep >= CARD_INDEX_STRIP_WIDTH_PX` (and comfortable readability):
     - Example desktop (`cardWidth = 100px`, `indexStrip = 36px`): if minimum-overlap/parted max step is e.g. `~84px–96px` (or `cardWidth` with small gap / tiny overlap), set the resting default step for `2..6` cards so cards clearly overlap slightly at rest (e.g., `~62px–68px`, exposing ~62–68% of each card — well above the `36px` rank+suit floor, while leaving `~20px–30px` of expansion margin per adjacent card during parting!).
     - Ensure the 6-card default box width reflects this updated 6-card resting span consistently (and scales proportionally on mobile `48px` cards).
     - Verify that for every `n` in `{2, 3, 4, 5, 6}`, hovering any card produces a strictly positive increase in spacing around the hovered card compared to rest (`partedGap > restingStep`)!

3. **Smooth, Jitter-Free Parting Position Math (`ITEM-6a`):**
   - Inspect `computePartedCardPositions` (and related exports in `handLayout.ts`) so that:
     - **1-card guard:** When `cardCount <= 1` or `hoveredIndex === null`, all parting deltas are strictly `0`.
     - **Stationary hovered card:** For any valid `hoveredIndex` (`0 <= hoveredIndex < cardCount`), `partedX[hoveredIndex] === restingX[hoveredIndex]` (exact `0px` displacement for the card under the mouse pointer).
     - **Smooth falloff across neighbors:** Instead of an abrupt step jump on only 1 neighbor, use a smooth continuous kernel (e.g., Gaussian / cosine falloff by distance from `hoveredIndex`) that widens gaps closest to `hoveredIndex` (revealing the hovered card and its immediate neighbors cleanly, up to `maxPartedStep`, at least revealing `>= CARD_INDEX_STRIP_WIDTH_PX` even in compressed 30-card hands!) while smoothly tightening overlap among cards farther from `hoveredIndex` so the hand stays nicely bounded within the maximal hand lane (never overflowing outside `[arenaLeft + margin, arenaRight - margin]`).
     - **Export GPU-delta helper:** Return both absolute `positions` and per-card `deltas` (`partedX[i] - restingX[i]`) so `GameTable.tsx` (in Wave 3) can animate parting purely via GPU-composited `transform: translate3d(deltaX, liftY, 0)` with zero layout reflow!
     - **Optional continuous hover support:** If helpful, also support a fractional/continuous focus coordinate or smooth weight so pointer motion across the hand never snaps abruptly, while preserving full backward compatibility with the existing `computePartedCardPositions(...)` function signature (or keeping it clean and well-typed for Wave 3).

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-6a (Verbatim):** "The animation looks correct, but seems a little choppy. Try to make it smoother if possible." — `handLayout.ts` computes smooth, bounded, continuous-falloff per-card parting offsets (`deltas`) suitable for 60fps GPU-composited `transform: translate3d(...)` rendering, keeps the hovered card strictly stationary (`delta[hoveredIndex] === 0`), and returns all-zero deltas when `cardCount <= 1` or hover is inactive.
- [ ] **ITEM-6b (Verbatim):** "Additionally, currently the animation does not play with a small hand (of 6 cards or less). If the reason is because the parting effect cannot separate cards past their minimum degree of overlap, make the default overlap for the hand a little larger than the minimum so that there is some margin to expand to for the sake of this animation specifically." — Default resting overlap for `2..6` card hands is slightly increased beyond minimum overlap (while still exposing `>= CARD_INDEX_STRIP_WIDTH_PX` = `36px` desktop / proportional mobile so full `'10'` rank & suit remain visible) so hovering any card in a 2-, 3-, 4-, 5-, or 6-card hand measurably parts adjacent cards around the hovered card.
- [ ] Existing Option B invariants preserved: fixed card size (`100×140` desktop, `48×68` mobile), 14-card hand expands within maximal box with step `>= 36px`, 30-card hand compresses `< 36px` within maximal box, and parted 30-card hand reveals the hovered card and neighbors while remaining within the maximal box.
- [ ] Comprehensive unit tests added/updated in `frontend/src/__tests__/handLayout.test.ts` covering `n = 1, 2, 3, 6, 14, 30` at rest and under hover at first, middle, and last indices.
- [ ] Run `npm test -- --run` in `frontend/` and verify all tests pass.
- [ ] Write a concise summary to `.reviews/agent_notes.md` and run `echo "DONE" > .tickets/STATUS` only after all tests pass.

