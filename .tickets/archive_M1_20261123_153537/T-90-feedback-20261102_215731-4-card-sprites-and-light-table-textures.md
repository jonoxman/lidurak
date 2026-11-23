<!-- WAVE:2 -->
# Ticket T-90-feedback-20261102_215731-4: Card Sprite Pip Non-Overlap, Theme-Dependent Card Front Background & Light-Theme Table Textures

## Summary
1. Adjust the card sprites in `frontend/src/components/Card.tsx` (and `table.css`) so the pips on a card never overlap the card's corner rank/suit symbol — specifically fixing `10`s and verifying all ranks (`ITEM-NEW-1a`).
2. Make the background of the card fronts (where the pips are drawn) theme-dependent: white (`#ffffff`) in the light theme, and grey in the dark theme (`ITEM-NEW-1b`).
3. Adjust the light theme table texture choices in `frontend/src/styles/tableTextures.ts`, `frontend/src/styles/table.css`, and `frontend/src/components/HeaderBar.tsx` so that the exact same texture pattern displays in both Light and Dark themes, with only the color palette differing between themes (`ITEM-4`).

## File Scope (Wave 2)
- `frontend/src/components/Card.tsx`
- `frontend/src/styles/tableTextures.ts`
- `frontend/src/styles/table.css`
- `frontend/src/components/HeaderBar.tsx`
- `frontend/src/__tests__/Card.test.tsx`
- `frontend/src/__tests__/tableTextures.test.ts`
- `frontend/src/__tests__/HeaderBar.test.tsx`

**IMPORTANT:** Do NOT touch `backend/**`, `README.md`, `ARCHITECTURE.md`, or `play-local.sh` in this ticket. Preserve all Wave 1 changes in `frontend/src/styles/table.css`.

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-NEW-1a (Verbatim):** "1. Adjust the card sprites - the pips on the card should never overlap the card's rank symbol (this is currently a problem for 10s specifically). Additionally, make the background of the card fronts (where the pips are drawn) theme-dependent; they should be white in the light theme, and grey in the dark theme." (Part 1: Pip non-overlap)
  - In `frontend/src/components/Card.tsx`:
    - Inspect the SVG `viewBox="0 0 70 100"` corner rank/suit index coordinates (top-left rank text and corner suit glyph, plus the optional top-right trump badge at `(61, 10)` with `r=6`) and the pip coordinate tables for all number ranks (`2`–`10`), face cards (`J`, `Q`, `K`), and `A`.
    - Reposition the pip columns/rows and tune pip glyph sizing (especially for rank `10` / `'10'`, where the two-digit rank text extends further right and the 10-pip layout has 2 columns of 4 pips plus 2 center pips) so that no pip ever overlaps or touches the corner rank symbol, the corner suit symbol, the trump badge, or another pip:
      - Keep left-column pips safely to the right of the two-digit `"10"` rank index (e.g. `x >= 25`) or top-row pips safely below the corner index band (`y >= 26`), and right-column pips safely clear of the top-right trump badge.
    - Add unit tests in `frontend/src/__tests__/Card.test.tsx` asserting that for a `10` card (and across all ranks `2`–`10`, `J`, `Q`, `K`, `A`), every `.card-pip` coordinate/bounding box is strictly disjoint from the corner rank/suit symbol region and the trump badge region.

- [ ] **ITEM-NEW-1b (Verbatim):** "1. Adjust the card sprites - the pips on the card should never overlap the card's rank symbol (this is currently a problem for 10s specifically). Additionally, make the background of the card fronts (where the pips are drawn) theme-dependent; they should be white in the light theme, and grey in the dark theme." (Part 2: Theme-dependent card front background)
  - In `frontend/src/components/Card.tsx` and `frontend/src/styles/table.css`:
    - Resolve the active theme (`'light'` vs `'dark'`) in `Card.tsx` using `useSettings()` and the document's applied `data-theme` / `prefers-color-scheme` (matching the theme resolution pattern in `CardBack.tsx` and `tableTextures.ts`).
    - Set the card front background (both the inline SVG card-face `<rect>` fill where the pips are drawn AND the `.playing-card` CSS surface in `table.css`) based on the active theme:
      - **Light theme (`data-theme="light"`):** white (`#ffffff`).
      - **Dark theme (`data-theme="dark"`):** grey (e.g., `#cbd5e1` / `#d1d5db` neutral light-mid grey so both dark `#1e293b`/`#111827` spade/club pips and red `#dc2626` heart/diamond pips have crisp contrast while the card face is distinctly grey in dark mode).
    - Expose `data-card-theme="light" | "dark"` on the rendered card/SVG element and add unit tests in `frontend/src/__tests__/Card.test.tsx` verifying that switching between Light and Dark themes changes the card front background between white (`#ffffff`) and grey.

- [ ] **ITEM-4 (Verbatim):** "4. The light theme colors are correct, but none of the table choices display much of a texture compared to dark theme. Adjust the light theme choices for the table so that the same texture is displaying in both themes - the only adjustment between themes should be in the color palette itself."
  - In `frontend/src/styles/tableTextures.ts`, `frontend/src/styles/table.css`, and `frontend/src/components/HeaderBar.tsx`:
    - Keep the existing `lightBase` (`--table-felt-light`) and `lightBorder` (`--table-felt-border-light`) colors for all 6 presets (`emerald-felt`, `midnight-navy`, `burgundy-velvet`, `charcoal-slate`, `forest-moss`, `vintage-oak`).
    - Update `lightOverlay` in `tableTextures.ts` AND `--table-felt-overlay-light` in `table.css` for all 6 presets so that each preset's `lightOverlay` uses the **exact same multi-layer gradient structure, repeating-linear-gradient angles, radial-gradient positions, and pattern frequencies** as its dark `overlay`, changing ONLY the color palette stops (using light-theme-appropriate contrasting tints/shades with sufficient opacity so the felt crosshatch, diagonal twill, velvet sheen, slate grain, moss dapple, and oak wood-grain textures are just as visible in Light theme as in Dark theme).
    - In `HeaderBar.tsx` and `table.css`, ensure the `Table` submenu preview swatches (`[data-testid^="table-texture-"]` / `.texture-swatch`) render with `tableTexturePalette(preset, resolvedTheme)` (`base` + `overlay`) and remove any white-wash inset box-shadow veil in `table.css` that obscures the texture in light mode.
    - Add/update tests in `frontend/src/__tests__/tableTextures.test.ts` verifying that every preset's `lightOverlay` preserves the same repeating/radial texture layer structure as `overlay` while using the light color palette.

## Testing & Verification Commands
Run from `frontend/`:
```bash
cd frontend && npm test -- --run
```
All Vitest suites must pass with zero errors.
