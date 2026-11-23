<!-- WAVE:1 -->
# Ticket T-90-4: Theme-Dependent Table Palette, Smaller Trump Card Gold Circle & Trump Deck Positioning

## Context & Motivation
1. **Theme-Dependent Table Colors (Req 4):** The current table felt and arena colors look great in dark theme, but are far too dark when the user switches to light theme. When switching to light theme, the table felt textures and table surface chrome should become paler to match the light theme aesthetic, and switch back to the deep dark colors in dark theme.
2. **Smaller Gold Circle on Trump Cards (Req 6):** The gold trump indicator circle on trump cards in `Card.tsx` / `table.css` is slightly too large and can overlap the suit pips on cards. Its size must be reduced slightly so it never overlaps any pips.
3. **Trump Card Position Under the Talon Deck (Req 15):** In the `DECK` box, the horizontal trump card at the bottom of the vertical talon deck slightly sticks out past the left and bottom sides of the vertical deck. It needs to be shifted a few pixels right and a few pixels up relative to the vertical deck.

## Scope & Files to Touch
- **Allowed files:**
  - `frontend/src/styles/tableTextures.ts`
  - `frontend/src/components/Card.tsx`
  - `frontend/src/styles/table.css`
  - `frontend/src/__tests__/tableTextures.test.ts`
  - `frontend/src/__tests__/Card.test.tsx`
- **Do NOT touch:** `GameTable.tsx`, `GamePage.tsx`, `HeaderBar.tsx`, `LobbyPage.tsx`, `app.css`, `settings.ts`, `README.md`, `ARCHITECTURE.md`, or backend files.

## Detailed Requirements

### 1. Theme-Dependent Table Colors (`tableTextures.ts`, `table.css`)
- In `frontend/src/styles/tableTextures.ts`:
  - Each `TableTexturePreset` in `TABLE_TEXTURES` (`emerald-felt`, `midnight-navy`, `burgundy-velvet`, `charcoal-slate`, `forest-moss`, `vintage-oak`) should define both its dark-theme palette and a paler light-theme palette (e.g., `lightBackground`, `lightBorderColor`, `lightAccentGlow` or a helper `getTableTextureStyle(textureId, filters, theme?: 'dark' | 'light')`).
  - Also update `table.css` (and/or CSS custom properties set by `tableTextures.ts` and `:root[data-theme="light"]` in `table.css`) so that **even when `getTableTextureStyle` is called with or without an explicit theme parameter**, the live `.game-table` / `.game-table-felt` and the `.texture-swatch` previews automatically adapt when `:root[data-theme="light"]` vs `:root[data-theme="dark"]` is active!
    - Specifically: if `tableTextures.ts` outputs CSS variables or uses `light-dark(...)` / `:root[data-theme="light"]` overrides in `table.css` alongside theme-aware helper values in `tableTextures.ts`, then switching the theme in `settings.ts` (which sets `document.documentElement.dataset.theme = 'light' | 'dark'`) will **immediately** make the table felt, battlefield tinted box (`.battlefield-tinted-box`), opponent seat boxes (`.opponent-seat`), and table borders paler in light theme and restore the rich dark palette in dark theme—without needing any changes to `HeaderBar.tsx` or `GameTable.tsx` call sites!
  - Recommended light-theme felt palettes for the 6 presets:
    - `emerald-felt`: pale sage/mint felt (e.g. radial gradient `#d6eadf` to `#b5d6c5`, border `#8cb8a2`)
    - `midnight-navy`: pale sky/slate blue felt (e.g. `#d8e4f2` to `#b8cce4`, border `#8ea9ca`)
    - `burgundy-velvet`: pale rose/mauve felt (e.g. `#f0d8df` to `#dcb6c2`, border `#be8e9d`)
    - `charcoal-slate`: pale cool silver-slate felt (e.g. `#e2e8f0` to `#cbd5e1`, border `#94a3b8`)
    - `forest-moss`: pale olive-meadow felt (e.g. `#dfe9d5` to `#c4d6b4`, border `#9ab386`)
    - `vintage-oak`: pale warm sand/oak felt (e.g. `#efe3d0` to `#dcc7a8`, border `#b89d78`)
  - In `frontend/src/styles/table.css` under `:root[data-theme="light"]` (and `[data-theme="light"]`):
    - Make `.game-table`, `.game-table-felt`, `.battlefield-tinted-box`, `.opponent-seat`, `.target-outline`, `.redirect-outline`, and card-count badges use paler, harmonious light-theme surfaces, borders, and readable dark text (`#0f172a` / `#1e293b`), while keeping dark theme (`:root[data-theme="dark"]` / default) unchanged.

### 2. Slightly Reduce Gold Circle Size on Trump Cards (`Card.tsx`, `table.css`)
- Inspect `frontend/src/components/Card.tsx` and `frontend/src/styles/table.css` for the gold trump badge (`data-testid="trump-indicator"` / `.card-trump-badge` / `.trump-badge`).
- Slightly reduce its dimensions (for example, from `18px–22px` down to `12px–14px` width/height, smaller font-size/icon `8px–9px`, positioned neatly in the top-right corner `top: 3px; right: 3px;`) so that the gold circle never touches or overlaps the central `.card-pips` / `.card-pip` area on any number card (`6`–`10`, `2`–`5`, `A`) or face card (`J`, `Q`, `K`).

### 3. Shift Horizontal Trump Card Slightly Right and Up Under the Talon Deck (`table.css`)
- Inspect `.deck-assembly`, `.deck-cards-stack`, `.deck-talon-stack`, and `.deck-trump-card` (`[data-testid="trump-card"]`) in `frontend/src/styles/table.css`.
- Move `.deck-trump-card` a few pixels to the right (e.g., `+6px` to `+10px` horizontally) and a few pixels up (e.g., `-5px` to `-8px` vertically) relative to `.deck-talon-stack` so that the rotated horizontal trump card never sticks out past the left or bottom edges of the vertical talon deck while clearly extending out to the right.

## Acceptance Criteria & Verification
1. Add/update unit tests in `frontend/src/__tests__/tableTextures.test.ts` and `frontend/src/__tests__/Card.test.tsx`:
   - Verify light vs dark theme palette differences in `tableTextures.ts` / `table.css`.
   - Verify the trump indicator badge renders with its compact non-overlapping dimensions on trump cards.
2. Run `cd frontend && npm test -- --run` and ensure all tests pass.
3. Write your implementation summary to `.reviews/agent_notes.md` and run `echo "DONE" > .tickets/STATUS`.
