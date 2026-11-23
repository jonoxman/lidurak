<!-- WAVE:1 -->
# Ticket: Theme-Matched Compact Icon-Only Surrender & Pass SVG Icons and Styles

## Context & Goal
Redesign the Surrender and Pass button icons and their dedicated CSS styling so both buttons are smaller, strictly non-verbal (icon-only), and seamlessly harmonize with the dark felt table aesthetic instead of loud bright-red button styling.

## Target Files
- `frontend/src/components/icons/SurrenderIcon.tsx`
- `frontend/src/components/icons/PassIcon.tsx`
- `frontend/src/styles/actionIcons.css`
- `frontend/src/__tests__/ActionIcons.test.tsx`

## Implementation Details
1. **`SurrenderIcon.tsx` (Custom SVG Artwork):**
   - Design a clear, legible, non-verbal SVG icon (`viewBox="0 0 40 40"` or `"0 0 48 48"`, `aria-hidden="true"`, clean consistent stroke weight e.g. `1.8`–`2` with rounded caps/joins) communicating "surrender / take the cards" visually:
     - **Top region:** 2–3 slightly fanned small playing cards (`<rect>` / `<path>` card silhouettes with subtle corner roundness and crisp stroke/fill contrast).
     - **Middle region:** A clear downward-pointing arrow (`<path>` shaft + arrowhead) pointing **from the cards down towards the hands**.
     - **Bottom region:** **Two hands raised in surrender** (left and right open palms/fingers raised upward beneath the cards and arrow, symmetrically balanced and instantly recognizable even at compact button dimensions like `32px–36px`).
   - Add semantic `data-part` attributes (e.g., `data-part="cards"`, `data-part="down-arrow"`, `data-part="raised-hands"`) on the SVG groups so tests can verify every required visual element cleanly.
2. **`PassIcon.tsx` (Cohesive Companion SVG Artwork):**
   - Design a clear, legible, non-verbal SVG icon matching the exact `viewBox`, stroke weight, rounded cap/join style, visual density, and felt-table elegance of `SurrenderIcon.tsx`:
     - Depicts passing / concluding the bout turn cleanly (e.g., matching card motif with a crisp forward pass/skip-turn arrow or sweep/check arc in the exact same minimalist line-art + subtle translucent fill aesthetic as `SurrenderIcon.tsx`).
   - Add semantic `data-part` attributes (e.g., `data-part="pass-symbol"`) for testability.
3. **Compact Theme-Matched Button Styles (`frontend/src/styles/actionIcons.css`):**
   - Provide compact, smaller icon-only button classes (`.action-icon-btn`, `.action-icon-btn--surrender`, `.action-icon-btn--pass`) sized around `44px × 44px` to `52px × 52px` (`min-width`/`height` compact square/squircle with `border-radius: 10px`–`12px`, zero text label layout bloat).
   - **Theme Cohesion (NO Bright Red!):**
     - Replace any bright red / crimson backgrounds (`#dc2626`, `#ef4444`, `#b91c1c`, etc.) with a muted, refined dark-felt theme surface matching `SortBar` and table controls (e.g., translucent deep slate/forest charcoal `rgba(18, 28, 23, 0.86)` with subtle warm antique-gold / muted parchment or soft bronze/slate border `rgba(212, 184, 122, 0.35)` and crisp light-cream/warm-ivory icon stroke `#e8e2d2`).
     - Give `.action-icon-btn--surrender` and `.action-icon-btn--pass` subtle, refined hover/active/focus-visible accents that fit the dark felt palette (e.g., soft warm amber/muted terracotta-gold tint on surrender hover and soft sage/emerald-gold tint on pass hover—never loud neon/bright red or harsh primary fills!).
   - Keep existing exported class names compatible if `ActionBar.tsx` already imports `actionIcons.css`, so Wave 1 passes `npm test -- --run` cleanly prior to Wave 2 wiring.
4. **Tests (`frontend/src/__tests__/ActionIcons.test.tsx`):**
   - Verify `SurrenderIcon` renders SVG groups for cards, downward arrow, and two raised hands (`data-part="cards"`, `data-part="down-arrow"`, `data-part="raised-hands"`).
   - Verify `PassIcon` renders SVG matching `SurrenderIcon`'s `viewBox` and stroke aesthetic.
   - Verify `actionIcons.css` defines compact icon-only sizing and does NOT use bright red (`#ef4444`, `#dc2626`, `#ff0000`, `rgb(239, 68, 68)`, etc.) for the surrender button.
   - Run `npm test -- --run` and ensure all tests pass.

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-NEW5 (Icon & Theme Styling):** "Instead of the word "Surrender", the surrender button should be smaller and non-verbally communicate the action with an icon. Design the icon to be two hands, raised in surrender, underneath some cards with an arrow pointing from the cards down towards the hands. Keep the position of the surrender button in the bottom right corner of the game table. Adjust the button to fit the aesthetic of the current theme as the other game elements do, instead of being the current bright red." -> `SurrenderIcon.tsx` depicts two hands raised in surrender underneath cards with a downward arrow from the cards toward the hands; `actionIcons.css` provides compact, theme-matched styling without bright red.
- [ ] **ITEM-NEW6 (Icon & Theme Styling):** "Instead of the word "Pass", the pass button should be smaller and non-verbally communicate the action with an icon. Design the icon with a similar aesthetic to the above specification for the surrender button. Also make the other button adjustments in an analogous way." -> `PassIcon.tsx` matches `SurrenderIcon.tsx` in viewBox, stroke style, and visual aesthetic; `actionIcons.css` styles `.action-icon-btn--pass` analogously in compact size and table-theme palette.
- [ ] **Tests:** `ActionIcons.test.tsx` updated and `npm test -- --run` passes cleanly.

