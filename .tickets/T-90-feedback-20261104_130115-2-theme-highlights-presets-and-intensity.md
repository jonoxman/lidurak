<!-- WAVE:2 -->
# T-90-feedback-20261104_130115-2 — Theme 'Highlights' Section with 6 Color Scheme Presets, Multi-Line Button Previews, and Real-Time Intensity Slider

## Summary
Implement New Item `1` (`ITEM-NEW-1a`, `ITEM-NEW-1b`, `ITEM-NEW-1c`, `ITEM-NEW-1d`):
Add a **`Highlights`** section to the **`Theme`** submenu of the profile dropdown (`HeaderBar.tsx`), positioned below all existing Theme controls (`Device theme` / `Light` / `Dark` choices and the `Roundness` slider) and above the connection/ping tracker (`PING` / `SERVER DELAY`). The section provides:
1. **6 Highlight Color Scheme Presets** (including **`Warm`** and **`Cool`** alongside **`Classic`**, **`Neon`**, **`Pastel`**, and **`Royal`**) that re-theme the highlight colors appearing in the game and menus across both Dark and Light modes.
2. **Multi-Line Color Highlight Previews** inside each preset selection button, displaying horizontal/vertical preview lines of each highlight color effect in that preset's palette.
3. **Real-Time `'Intensity'` Slider** in the `Highlights` section that brightens or makes more subtle the highlight aura across all highlight effects on the table and menus in real time.

---

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-NEW-1a (Placement of 'Highlights' Section in Theme Submenu):**
  > "Add a 'Highlights' section to the theme section of the profile menu dropdown. This should be placed below all current elements of the theme section, but above the ping section."
  - In `frontend/src/components/HeaderBar.tsx`:
    - Inside the `Theme` submenu (`activeSubmenu === 'theme'`), render a dedicated **`Highlights`** section (`data-testid="theme-highlights-section"`, `.theme-highlights-section`) **after** the theme mode buttons (`Device theme`, `Light`, `Dark`) and the `Roundness` slider (`data-testid="roundness-slider"`), and **before** the `.connection-tracker` (`PING` / `SERVER DELAY`) section at the bottom of the dropdown menu.
    - Include a clear section heading/label `Highlights` (`.submenu-section-title` / `data-testid="theme-highlights-heading"`).

- [ ] **ITEM-NEW-1b (6 Highlight Color Scheme Presets Including Warm and Cool):**
  > "The highlights section should have a few preset options for the highlights appearing in the game and menus - these presets should include 6 options for highlight color schemes. Two examples of presets would be with warm and cool colors."
  - In `frontend/src/state/settings.ts`:
    - Define `HighlightPresetId = 'classic' | 'warm' | 'cool' | 'neon' | 'pastel' | 'royal'` (6 presets total, defaulting to `'classic'`), persisted in `localStorage` under `UserSettings` (`highlightPreset: HighlightPresetId`) with setter `setHighlightPreset(preset: HighlightPresetId)`.
    - Define `HIGHLIGHT_PRESETS` metadata array with all 6 presets, each providing distinct, non-overlapping semantic colors for both Dark and Light themes across the 6 semantic highlight slots (`uiSelect`, `attacker`, `defender`, `trump`, `redirect`, `clockUrgent`):
      1. **`classic` (`Classic`):** Default balanced palette — Cobalt UI (`#3b82f6` / `#1d4ed8`), Emerald Attacker (`#22c55e` / `#15803d`), Crimson Defender (`#ef4444` / `#b91c1c`), Gold Trump (`#f59e0b` / `#b45309`), Violet Redirect (`#a855f7` / `#7e22ce`), Orange-Amber Urgent Clock (`#ea580c` / `#c2410c`).
      2. **`warm` (`Warm`):** Warm-spectrum palette — Amber-Gold UI (`#d97706` / `#b45309`), Lime-Chartreuse Attacker (`#84cc16` / `#4d7c0f`), Fiery Coral-Crimson Defender (`#f43f5e` / `#be123c`), Sunburst Yellow-Gold Trump (`#eab308` / `#a16207`), Magenta-Rose Redirect (`#ec4899` / `#be185d`), Deep Vermilion Urgent Clock (`#ea580c` / `#9a3412`).
      3. **`cool` (`Cool`):** Cool-spectrum palette — Sky-Cyan UI (`#06b6d4` / `#0e7490`), Mint-Teal Attacker (`#10b981` / `#047857`), Indigo-Berry Defender (`#e11d48` / `#9f1239`), Ice-Blue / Silver-Gold Trump (`#38bdf8` / `#0369a1`), Deep Violet-Indigo Redirect (`#8b5cf6` / `#6d28d9`), Electric Coral-Pink Urgent Clock (`#f97316` / `#c2410c`).
      4. **`neon` (`Neon`):** High-energy vivid palette — Electric Cyan UI (`#00e5ff` / `#0284c7`), Neon Green Attacker (`#39ff14` / `#16a34a`), Hot Pink-Red Defender (`#ff2a85` / `#db2777`), Laser Yellow Trump (`#facc15` / `#ca8a04`), Ultraviolet Redirect (`#c084fc` / `#9333ea`), Neon Orange Urgent Clock (`#ff6b00` / `#ea580c`).
      5. **`pastel` (`Pastel`):** Soft, easy-on-the-eyes palette — Periwinkle Blue UI (`#818cf8` / `#4f46e5`), Sage-Mint Attacker (`#4ade80` / `#16a34a`), Soft Rose-Coral Defender (`#fb7185` / `#e11d48`), Honey-Peach Trump (`#fbbf24` / `#d97706`), Lavender Redirect (`#c084fc` / `#7c3aed`), Warm Apricot Urgent Clock (`#fb923c` / `#ea580c`).
      6. **`royal` (`Royal`):** Rich jewel-toned palette — Sapphire Blue UI (`#2563eb` / `#1e40af`), Jade Emerald Attacker (`#059669` / `#065f46`), Ruby Crimson Defender (`#dc2626` / `#991b1b`), Imperial Gold Trump (`#d97706` / `#92400e`), Amethyst Purple Redirect (`#9333ea` / `#5b21b6`), Copper-Garnet Urgent Clock (`#ea580c` / `#9a3412`).
    - When `highlightPreset` or `theme` changes, `applySettingsToDocument` in `frontend/src/state/settings.ts` must set `document.documentElement.dataset.highlightPreset = settings.highlightPreset` and dynamically update the CSS custom properties (`--ui-select-*`, `--role-attacker-*`, `--role-defender-*`, `--trump-*`, `--redirect-*`, `--clock-urgent-*`, and `--clock-low-*`) on `document.documentElement` so both menu selections and table highlights update immediately in real time.

- [ ] **ITEM-NEW-1c (Lines of Each Preset Color Highlight Effect Inside Each Selection Button):**
  > "Each preset should also have lines of each preset color highlight effect in their respective selection button, to give the user a preview."
  - In `frontend/src/components/HeaderBar.tsx` and `frontend/src/app.css`:
    - Render a 6-button preset grid/list inside `data-testid="theme-highlights-section"` where each button has `data-testid="highlight-preset-<id>"` (e.g. `highlight-preset-classic`, `highlight-preset-warm`, `highlight-preset-cool`, `highlight-preset-neon`, `highlight-preset-pastel`, `highlight-preset-royal`), `data-preset="<id>"`, and `.highlight-preset-btn` (with `.active` and `aria-pressed="true"` when selected).
    - Inside each preset button, render the preset label alongside a preview container (`data-testid="highlight-preset-preview-<id>"`, `.highlight-preset-lines`) containing **lines of each preset color highlight effect** (`.highlight-preview-line`, one line per highlight role in that preset: UI select, attacker, defender, trump, redirect, urgent clock), styled with that color's stroke/fill and subtle matching `box-shadow` glow aura so the user sees an accurate multi-line preview of the preset's highlight effects right inside the button.

- [ ] **ITEM-NEW-1d (Real-Time Highlight 'Intensity' Slider):**
  > "Additionally, implement an 'intensity' slider in the highlights section - this should allow the user to brighten or make more subtle the highlight aura, adjusting all highlight effects on the table in real time with the user's selection."
  - In `frontend/src/state/settings.ts`, `frontend/src/components/HeaderBar.tsx`, `frontend/src/app.css`, `frontend/src/styles/table.css`, and `frontend/src/pages/GamePage.tsx`:
    - Add `highlightIntensity: number` to `UserSettings` in `settings.ts` (range `20` to `200`, default `100` representing `100%`), persisted in `localStorage` and updated via `setHighlightIntensity(intensity: number)`.
    - In `HeaderBar.tsx` inside the `Highlights` section (`data-testid="theme-highlights-section"`), render an **`Intensity`** slider control (`data-testid="highlight-intensity-slider"`, `type="range"`, `min="20"`, `max="200"`, `value={settings.highlightIntensity}`) with a visible label `Intensity` and live percentage readout (`${settings.highlightIntensity}%`, `data-testid="highlight-intensity-value"`).
    - In `applySettingsToDocument` (`frontend/src/state/settings.ts`) and CSS (`app.css`, `table.css`), compute the intensity factor `scale = settings.highlightIntensity / 100` (from `0.2` subtle to `2.0` bright) and apply it in real time to:
      1. `document.documentElement.dataset.highlightIntensity = String(settings.highlightIntensity)` and `--highlight-intensity: ${scale}`.
      2. All semantic highlight token alpha/glow/shadow variables (`--ui-select-glow`, `--ui-select-border`, `--ui-select-bg`, `--role-attacker-glow`, `--role-attacker-pulse-outer`, `--role-attacker-pulse-halo`, `--role-attacker-border`, `--role-defender-glow`, `--role-defender-pulse-outer`, `--role-defender-pulse-halo`, `--role-defender-border`, `--trump-glow`, `--trump-border`, `--redirect-glow`, `--redirect-border`, `--clock-urgent-glow`, `--clock-low-glow`) and/or scaled `box-shadow` / `filter` rules on `.hand-cards[data-highlighted="true"]`, `.table-card-uncovered`, `li.status-badge[data-role="attacker" | "defender"]`, `.playing-card.trump-card`, `.target-outline`, `.redirect-outline`, and `.split-clock-half.clock-low`, plus the `.highlight-preview-line` bars inside the menu buttons.
      3. Dragging the `Intensity` slider (`onInput`) must immediately adjust all highlight auras on the live `GameTable` / `GamePage` and menu previews in real time without reloading or closing the dropdown.

---

## Automated Verification
Run:
```bash
cd frontend && npm test -- --run
```
Add comprehensive tests in `frontend/src/__tests__/HeaderBar.test.tsx` and `frontend/src/__tests__/GamePage.test.tsx` verifying:
1. Opening `Guest` ▸ `Theme` renders the `Highlights` section (`data-testid="theme-highlights-section"`) below the `Roundness` slider and above `.connection-tracker` (`ITEM-NEW-1a`).
2. The `Highlights` section renders all 6 preset buttons (`classic`, `warm`, `cool`, `neon`, `pastel`, `royal`) and clicking each updates `settings.highlightPreset`, `document.documentElement.dataset.highlightPreset`, and the active CSS custom properties (`--ui-select-accent`, `--role-attacker-accent`, `--role-defender-accent`, `--trump-accent`, `--redirect-accent`, `--clock-urgent-accent`) in real time (`ITEM-NEW-1b`).
3. Every preset button contains multiple `.highlight-preview-line` elements with distinct inline color/glow styles previewing that preset's highlight colors (`ITEM-NEW-1c`).
4. Changing the `Intensity` slider (`data-testid="highlight-intensity-slider"`) updates `settings.highlightIntensity`, `--highlight-intensity`, and the computed glow/aura variables on `document.documentElement` in real time (`ITEM-NEW-1d`).
