<!-- WAVE:2 -->
# Ticket 6: Theme-Adaptive Non-Colorful Card Backs

## Summary
Make the 6 non-colorful (monochrome) card backs change their palette to accommodate the current theme (`dark` vs `light`). Keep their existing appearance in the dark theme, give them a clean, high-contrast light-theme appearance in the light theme, and leave the 7 colorful card backs unchanged across themes (Item 4).

## Files to Modify
- `frontend/src/components/CardBack.tsx`
- `frontend/src/app.css`
- `frontend/src/__tests__/Card.test.tsx`

*(Do NOT modify `GamePage.tsx`, `GameTable.tsx`, `HeaderBar.tsx`, `table.css`, `README.md`, or `ARCHITECTURE.md` in this ticket.)*

## Requirements

### 1. Theme-Aware Monochrome Card Backs (`CardBack.tsx` & `app.css`)
- In `CardBack.tsx`:
  - The 6 non-colorful card backs (`CARD_BACK_PATTERNS`: `'classic-hatch'`, `'royal-diamond'`, `'celtic-weave'`, `'hex-mesh'`, `'chevron'`, `'starburst'`) must detect and respond to the active theme (`dark` vs `light`, resolving `'device'` via `prefers-color-scheme` or `document.documentElement.dataset.theme`).
  - **Dark Theme (`'dark'`):** Keep the existing dark-theme fill, border, and pattern stroke colors unchanged.
  - **Light Theme (`'light'`):** Use a dedicated light-theme palette for the 6 non-colorful card backs (e.g., light crisp slate/ivory card back base `#e2e8f0` / `#f1f5f9`, contrasting outer/inner frame border `#64748b` / `#94a3b8`, and clear geometric pattern strokes/fills `#334155` / `#475569`) so they look sharp and well-contrasted on the light theme.
  - Expose `data-card-back-theme={resolvedTheme}` on non-colorful `<CardBack />` elements (and `data-colorful="false"` vs `data-colorful="true"`) so tests and CSS can inspect the active card back theme.
- **Colorful Card Backs Unchanged:**
  - The 7 colorful card backs (`COLORFUL_CARD_BACK_PATTERNS`: `'classic-crimson'`, `'royal-sapphire'`, `'emerald-gold'`, `'sunset-prism'`, `'amethyst-nebula'`, `'cyber-neon'`, `'coral-wave'`) **must not** change their colors, gradients, or motifs when switching between dark and light themes.

## Acceptance Criteria & Testing
1. Add unit tests in `frontend/src/__tests__/Card.test.tsx` verifying:
   - Each of the 6 non-colorful card backs (`CARD_BACK_PATTERNS`) uses the dark palette in `dark` theme and switches to the light palette (`data-card-back-theme="light"` and updated SVG fill/stroke colors) when the theme is set to `light`.
   - Each of the 7 colorful card backs (`COLORFUL_CARD_BACK_PATTERNS`) renders the exact same gradient and motif colors in both `dark` and `light` themes.
2. Run `cd frontend && npm test -- --run` and ensure all frontend tests pass.
