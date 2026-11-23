<!-- WAVE:1 -->
# T-90-feedback-20261122_011021-2-icons-and-hand-geometry: Redesigned Themed Surrender & Pass Icons + Responsive Hand Overlap & Tight Non-Rectangular Contour Geometry Engine

## Scope & Owned Files
Only create/modify these frontend files:
- `frontend/src/components/icons/SurrenderIcon.tsx`
- `frontend/src/components/icons/PassIcon.tsx`
- `frontend/src/styles/actionIcons.css`
- `frontend/src/utils/handLayout.ts` (NEW pure TypeScript geometry & SVG path module)
- `frontend/src/__tests__/ActionIcons.test.tsx`
- `frontend/src/__tests__/handLayout.test.ts` (NEW unit test suite)

Do NOT touch `Card.tsx`, `CardBack.tsx`, `TablePair.tsx`, `ActionBar.tsx`, `GameTable.tsx`, `GamePage.tsx`, `LobbyPage.tsx`, or `table.css` in this ticket (Wave 2 integrates them cleanly with zero parallel conflicts).

## Requirements & Architecture

### 1. Redesigned `SurrenderIcon.tsx` (ITEM-7)
Design a crisp, instantly legible, non-verbal custom SVG icon (`SurrenderIcon`) depicting:
- **Top portion:** A small fan/stack of playing cards (2–3 cards clearly recognizable by crisp card silhouettes/outlines).
- **Middle portion:** A clear downward-pointing arrow (`↓`) originating from the cards and pointing down toward the hands (communicating "taking the cards into hand / surrendering").
- **Bottom portion:** Two open hands raised in a surrender gesture underneath the cards and arrow (left & right palms raised outward/upward with distinct finger/thumb silhouettes).
- Ensure clean `viewBox` (e.g., `0 0 48 48`), consistent stroke weight (`strokeWidth="2.2"` / `strokeLinecap="round"` / `strokeLinejoin="round"`), and semantic `data-testid` / `<g>` elements (e.g., `data-part="cards"`, `data-part="arrow"`, `data-part="hands"`) for reliable testing and crisp rendering at compact button sizes (`36px–44px`).
- Use `currentColor` / theme CSS variables so the icon harmonizes naturally with the dark emerald/felt/parchment/gold aesthetic of Lidurak rather than harsh bright red.

### 2. Redesigned `PassIcon.tsx` (ITEM-8)
Design a matching non-verbal custom SVG icon (`PassIcon`) in the **exact same visual language, stroke weight, proportions, and theme palette** as `SurrenderIcon`:
- Non-verbally communicates "Pass / Done / Yield turn" using the same card + gesture/arrow aesthetic (for example, cards sweeping/sliding away or a calm open hand/arrow-skip motif with cards moving aside/forward, or a clean check/skip-forward arc matching `SurrenderIcon`'s exact `viewBox="0 0 48 48"`, stroke weights, and corner radii).
- Include semantic `<g>` parts (e.g., `data-part="cards"`, `data-part="pass-indicator"`) and use `currentColor` / theme variables.

### 3. Compact Theme-Matched Icon Button Styles (`frontend/src/styles/actionIcons.css`)
- Style the compact icon-only action buttons (e.g., `.action-icon-btn`, `.action-icon-btn--surrender`, `.action-icon-btn--pass`) to be noticeably **smaller and more compact** than the previous wide text buttons (e.g., `48px × 48px` to `56px × 56px` rounded square or pill-square, desktop; `42px × 42px` mobile).
- **Eliminate bright red** on the surrender button! Style both buttons to fit the dark emerald felt (`#1e2923`), dark slate surface (`#141c18` / `#1b2620`), warm parchment/ivory (`#e8e4d9`) ink, subtle muted gold/emerald borders (`rgba(212, 175, 55, 0.35)` / `rgba(110, 231, 183, 0.35)`), and subtle tactile hover/active elevation. Differentiate Surrender and Pass gently via subtle warm-amber/bronze vs. cool-emerald/sage border/hover accents while keeping both unmistakably cohesive with the dark table theme.
- Ensure backwards compatibility with any existing class names referenced by `ActionBar.tsx` until Wave 2 finishes wiring (do not break existing `ActionIcons.test.tsx` or `GameTable.test.tsx` tests).

### 4. Pure Hand Overlap & Tight Non-Rectangular Contour Geometry Engine (`frontend/src/utils/handLayout.ts`) (ITEM-3 & ITEM-5)
Create a rock-solid, pure, framework-agnostic TypeScript module `handLayout.ts` that Wave 2's `GameTable.tsx` will consume:

#### A. Card Overlap & Responsive Fitting (`computeHandLayout`)
Given:
- `cardCount: number`
- `containerWidth: number` (measured live via `ResizeObserver` on `[data-zone="player-hand"]`)
- `baseCardWidth: number` (`100` desktop, `48` mobile)
- `baseCardHeight: number` (`140` desktop, `68` mobile)
- `liftedIndices: ReadonlySet<number>` (playable and/or selected cards shifted upward)
- `liftPx: number` (vertical upward shift for playable/selected cards, e.g. `18` desktop / `10` mobile; optionally supports distinct lift levels for playable vs. selected)

Compute exact layout metrics:
1. **Overlap Constraints:**
   - Minimum overlap = **20% of card width** (`maxStep = cardWidth * 0.80`).
   - Maximum overlap = **80% of card width** (`minStep = cardWidth * 0.20`), ensuring at least `20%` of each card's width (the left-side rank symbol and suit corner) is ALWAYS uncovered and visible on every card!
   - When `cardCount <= 1`: single card centered, overlap `0`.
   - When `cardCount >= 2`: compute ideal step to fit within `availableWidth = Math.max(containerWidth - horizontalPadding, cardWidth)`:
     `idealStep = (availableWidth - cardWidth) / (cardCount - 1)`
     Clamp `step = clamp(idealStep, minStep, maxStep)` (so overlap ratio `1 - step / cardWidth` stays within `[0.20, 0.80]`).
2. **Full-Deck / Extreme Hand Safety (e.g., 24–52 cards picked up into hand):**
   - If even at maximum 80% overlap (`step = cardWidth * 0.20`) the single-row width `cardWidth + (cardCount - 1) * minStep` would exceed `availableWidth` (e.g., 36–52 cards on a standard desktop or narrow viewport), DO NOT let the hand overflow off-screen or collide with `[data-zone="table-deck"]` or the right controls!
   - Instead, gracefully handle extreme counts by wrapping into **2 (or `rows`) tightly overlapping rows** OR smoothly scaling `cardWidth`/`cardHeight` within readable bounds (preferring readable 2-row fan/stacking or bounded scaling while preserving `>= 20%` left-side rank+suit visibility and keeping total width `<= availableWidth`) — explicitly returning each card's exact `{ index, x, y, width, height, row, lift }` relative to the hand stage box (`stageWidth`, `stageHeight`), with `stageWidth <= availableWidth` ALWAYS guaranteed!
3. Center the computed hand horizontally within `containerWidth` (or return exact `stageWidth` & `stageHeight` so Flexbox/Grid centers it naturally).

#### B. Tight Non-Rectangular SVG Hand Highlight Contour (`buildHandContourPath`)
Ignoring all past rectangular highlight-box specs, build a geometric SVG contour generator that accepts the exact array of laid-out card rectangles (`CardRect[]`: `{ x, y, width, height }`) plus optional `padding` (e.g. `6px`) and `cornerRadius` (e.g. `12px`):
- Computes the **exact rectilinear / rounded orthogonal union polygon (orthogonal hull / skyline perimeter)** tightly hugging the outer boundary of ALL cards in the hand!
- **Crucial Distortion Behavior:**
  - Because cards overlap horizontally, the top edge forms a stepped skyline: wherever one or more cards are shifted upward (`y` is smaller by `liftPx`), the top perimeter **steps sharply/smoothly upward** right at the left edge of the lifted card(s) and steps back down where the lifted card(s) end!
  - Similarly, the bottom edge traces the actual bottom of each card (stepping upward beneath raised cards if they are lifted off the baseline, and staying at the baseline under unlifted cards), so the highlight **distorts non-rectangularly** around the exact silhouette of the hand at all times!
  - Handles single card, uniform hand, alternating lifted/unlifted cards, contiguous lifted runs, all cards lifted, and multi-row extreme hands (30–52 cards) with clean rounded outer/inner corners and zero self-intersections!
- Return both:
  - `pathD: string` (valid SVG `<path d="...">` string)
  - `viewBox: { width: number; height: number }`
  - `isNonRectangular: boolean` (true whenever cards have differing vertical lifts, useful for `data-contour-shape="stepped" | "uniform"` attributes and deterministic tests!)

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-3 (New #1):** "The active player's hand highlight box doesn't match with or align to the player's actual card positions at all. Adjust the implementation, ignoring all past specs for this component, to make sure that the highlight box responsively wraps tightly around the hand at all times. This means that if certain cards are shifted upwards to be playable, the highlight box should distort accordingly to keep wrapped tightly around the hand as a whole ('box' is no longer the right word - the outline does not need to maintain a rectangular shape)." (Pure geometry & tight non-rectangular SVG contour path generator implemented and thoroughly unit-tested in `handLayout.ts` & `handLayout.test.ts`.)
- [ ] **ITEM-5 (New #3):** "Arrange the cards in the active user's hand subject to the following constraints: all cards should overlap by 20% of their width at minimum and by 80% of their width at maximum. (These percentages are approximate - adjust them as needed to make sure that the left-side rank symbol and suit is always visible on every card, and so that even if a player picks up every card into their hand, the hand won't look wrong graphically (i.e. go off screen or overlap UI elements)). Keep in mine New Item #1 when implementing this, and vice versa." (Pure overlap & full-deck fitting algorithm implemented and co-tested with the tight contour generator in `handLayout.ts` & `handLayout.test.ts`.)
- [ ] **ITEM-7 (New #5):** "Instead of the word 'Surrender', the surrender button should be smaller and non-verbally communicate the action with an icon. Design the icon to be two hands, raised in surrender, underneath some cards with an arrow pointing from the cards down towards the hands. Keep the position of the surrender button in the bottom right corner of the game table. Adjust the button to fit the aesthetic of the current theme as the other game elements do, instead of being the current bright red." (`SurrenderIcon.tsx` and compact theme-matched `actionIcons.css` implemented and tested in `ActionIcons.test.tsx`.)
- [ ] **ITEM-8 (New #6):** "Instead of the word 'Pass', the pass button should be smaller and non-verbally communicate the action with an icon. Design the icon with a similar aesthetic to the above specification for the surrender button. Also make the other button adjustments in an analogous way." (`PassIcon.tsx` and matching compact theme-matched `actionIcons.css` implemented and tested in `ActionIcons.test.tsx`.)
- [ ] Run `npm test -- --run` inside `frontend/` and ensure ALL frontend tests pass without breaking any existing tests.
