<!-- WAVE:1 -->
# Ticket T-90-2: Card Sprite Serif Typography & Dynamic SVG Roundness (`Card.tsx`, `CardBack.tsx`)

## Summary
Implement the card sprite requirements from **New Additional Specifications #1** and **#3**:
1. **Fancier, Serifed Font on Card Sprites (`ITEM-NEW-3`):** Update `Card.tsx` so that all rank numbers (`2`–`10`) and letters (`J`, `Q`, `K`, `A`)—both the top-left corner index `<text>` and the center court-card letter `<text>` on `J`, `Q`, `K`—use a classic, ornate serifed font family (`'Cinzel', 'Playfair Display', 'Georgia', 'Times New Roman', 'Palatino Linotype', 'Book Antiqua', serif`) with `font-weight="700"`, while strictly preserving the existing non-overlapping pip/corner coordinates (`y = 21` corner rank band, `y = 33` pip start).
2. **Dynamic Roundness on Face-Up and Face-Down Card SVGs (`ITEM-NEW-1b`):** Connect `Card.tsx` and `CardBack.tsx` to `useSettings()` so that `settings.roundness` (`0`–`16` px) dynamically scales the SVG `<rect>` corner radius (`rx` / `ry`) as well as the outer card container's border radius, ensuring that moving the `Roundness` slider in the `Theme` menu from `0px` to `16px` reshapes all face-up and face-down cards seamlessly.

## Files to Modify
- `frontend/src/components/Card.tsx`
- `frontend/src/components/CardBack.tsx`
- `frontend/src/__tests__/Card.test.tsx`

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-NEW-3 (Fancier Serifed Font for Card Numbers & Letters):**
  > "3. Use a slightly fancier, serifed font for the numbers and letters on the card sprites."
  - In `frontend/src/components/Card.tsx`:
    - Define and apply a classic serif font stack constant (e.g. `export const CARD_SERIF_FONT_FAMILY = "'Cinzel', 'Playfair Display', 'Georgia', 'Times New Roman', 'Palatino Linotype', 'Book Antiqua', serif"`) to:
      1. The top-left corner rank `<text>` element (`2`–`10`, `J`, `Q`, `K`, `A`), with `class="card-rank-index"` and `data-font-style="serif"`.
      2. The center face-card letter `<text>` element (`J`, `Q`, `K`), with `class="card-face-letter"` and `data-font-style="serif"`.
    - Preserve the exact corner rank coordinates and pip layout so no pip ever touches the rank index, corner suit, or trump badge on any rank from `2` to `A`.
- [ ] **ITEM-NEW-1b (Roundness Slider Applies to Card Sprites & Card Backs):**
  > "1. The roundness slider in the theme menu should also affect all elements in the game table, including cards and the borders of the game table itself."
  - In `frontend/src/components/Card.tsx` and `frontend/src/components/CardBack.tsx`:
    - Read `settings.roundness` via `useSettings()`.
    - Compute the SVG outer frame `<rect>` `rx` and `ry` proportionally from `settings.roundness` (e.g., `const svgCornerRadius = Math.round((settings.roundness / 8) * 6 * 10) / 10`, yielding `0` at `roundness = 0`, `6` at the default `roundness = 8`, and `12` at `roundness = 16`), and in `CardBack.tsx` scale the inner decorative border `<rect>` corner radius proportionally (`Math.max(0, svgCornerRadius - 1.5)`).
    - Expose `data-roundness={String(settings.roundness)}` on `.playing-card` and `.playing-card-back` and apply `style={{ borderRadius: 'var(--app-roundness, 8px)' }}` (or CSS variable binding) so both the HTML card wrapper and the SVG frame corners match the user's `Roundness` slider setting.
- [ ] **Automated Frontend Unit Tests (`frontend/src/__tests__/Card.test.tsx`):**
  - Add tests verifying:
    1. Number cards (`2`–`10`) and letter cards (`J`, `Q`, `K`, `A`) render their rank `<text>` (and court letter `<text>` on `J`, `Q`, `K`) with the serif font family (`data-font-style="serif"` and `fontFamily` containing `Georgia` / `Playfair Display` / `Times New Roman` / `serif`).
    2. Updating `setSettings({ roundness: 0 })` and `setSettings({ roundness: 16 })` dynamically updates the `rx`/`ry` attributes on the `<rect>` elements inside both `Card` and `CardBack` as well as `data-roundness`.
  - Run `cd frontend && npm test -- --run` and ensure all tests pass.
