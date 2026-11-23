<!-- WAVE:1 -->
# Ticket `T-90-feedback-20261104_133915-1-light-mode-highlights`: Make Light Mode Highlight Colors Slightly Paler by Default

## Summary
In Light mode (`[data-theme="light"]`), the highlight colors and auras across the game table and menus are currently too emphasized and saturated, making them visually distracting. Update the light-mode highlight palettes and default aura/border/surface opacity calibration across all 6 highlight presets (`Classic`, `Warm`, `Cool`, `Neon`, `Pastel`, `Royal`) and all 6 semantic highlight roles (`uiSelect`, `attacker`, `defender`, `trump`, `redirect`, `clockUrgent`) so that light-mode highlights are slightly paler and softer by default (`100%` intensity), while preserving clear semantic distinction between roles and full real-time responsiveness to the `Intensity` slider (`20%`–`200%`).

---

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-QA-1 (Verbatim from `<resolved_human_feedback>`):**
  > **# QA Playbook**
  > **1 (new).** The highlights in light mode don't really look good - the colors are too emphasized, making them visually distracting. Make the light mode highlight colors slightly paler by default.

- [ ] **Paler Light-Mode Base Colors Across All 6 Highlight Presets (`frontend/src/state/settings.ts`):**
  - Inspect `HIGHLIGHT_PRESETS` and the light-theme color definitions / token generators in `frontend/src/state/settings.ts` for all 6 presets (`classic`, `warm`, `cool`, `neon`, `pastel`, `royal`) and all 6 semantic roles (`uiSelect`, `attacker`, `defender`, `trump`, `redirect`, `clockUrgent`).
  - Adjust every light-mode role color so its hex/RGB value is **slightly paler and less harshly saturated** than the previous high-emphasis light-mode palette (shifting toward softer, slightly lighter/muted mid-tones with higher lightness and gentler chroma so they harmonize with a light surface instead of glaring against it):
    - `Classic` (Light): softer/paler cobalt-blue (`uiSelect`, e.g. `#4f7df3` / `#5b87f5` instead of heavy `#1d4ed8`), softer sage-emerald (`attacker`, e.g. `#3b9b64` / `#46a76f` instead of heavy `#15803d`), softer rose-crimson (`defender`, e.g. `#d45b5b` / `#dc6868` instead of heavy `#b91c1c`), softer warm honey-amber (`trump`, e.g. `#cc8a2e` / `#d4943a` instead of heavy `#b45309`), softer lavender-violet (`redirect`, e.g. `#9b6be0` / `#a375e6` instead of heavy `#7e22ce`), and softer tangerine-amber (`clockUrgent`, e.g. `#de7338` / `#e27c43` instead of heavy `#c2410c`).
    - Apply the same proportional softening/paling across the Light palettes of `Warm`, `Cool`, `Neon`, `Pastel`, and `Royal` so every preset in Light mode is visibly paler and calmer by default than before while retaining each preset's distinct character and keeping all 6 role preview lines in `HeaderBar.tsx` clearly distinguishable.
  - Keep Dark mode (`[data-theme="dark"]`) highlight colors and intensities unchanged.

- [ ] **Softer Light-Mode Aura, Border, Pulse, and Surface Opacity Calibration (`frontend/src/state/settings.ts`, `frontend/src/app.css`, `frontend/src/styles/table.css`):**
  - In `frontend/src/state/settings.ts` (where CSS custom properties `--ui-select-*`, `--role-attacker-*`, `--role-defender-*`, `--trump-*`, `--redirect-*`, `--clock-urgent-*` are computed and applied to `document.documentElement`) and in the static `[data-theme="light"]` fallback blocks in `frontend/src/app.css` and `frontend/src/styles/table.css`:
    - Reduce the default (`100%` intensity) light-mode border alphas, outer glow/halo alphas, pulse animation alphas, and background surface tint alphas so the highlights are subtle and non-distracting by default in Light mode (e.g., lowering light-mode border alphas from `~0.88–0.90` to `~0.55–0.68`, glow/pulse alphas from `~0.45–0.78` to `~0.24–0.38`, and surface tints to gentle `~0.08–0.12` washes at `100%` intensity).
    - Audit all `[data-theme="light"]` highlight rules in `frontend/src/app.css` and `frontend/src/styles/table.css` — including:
      - `.appearance-choice.active`, `.felt-swatch-btn.active`, `.card-back-swatch-btn.active`, `.sound-pack-btn.active`, `.highlight-preset-btn.active`, `.pov-tab.active`, `.sort-btn.active`
      - `.hand-cards[data-highlighted="true"][data-highlight-variant="attacker" | "throw-in" | "defender"]`
      - `li.status-badge[data-role="attacker"]` and `li.status-badge[data-role="defender"]`
      - `.target-outline`, `.redirect-outline`, `.table-card-uncovered`, `.playing-card.trump-card`
      - `.split-clock-half.clock-low` / `[data-low-time="true"]`
      - `.action-btn-pass` and `.action-btn-surrender`
    - Remove or soften any hardcoded `[data-theme="light"]` heavy `box-shadow` spreads or high-opacity `rgba(...)` overrides that bypassed the CSS custom properties and made light-mode highlights overly emphasized. Ensure they consume the paler CSS custom properties and scale smoothly with the `Intensity` slider (`20%`–`200%`).

- [ ] **End-to-End UI Wiring & 15-Second QA Testability (`HeaderBar.tsx`, `LobbyPage.tsx`, `GamePage.tsx`, `GameTable.tsx`):**
  - Verify that opening `http://localhost:5173`, switching `Guest ▸ Theme` to `Light`, and clicking any 1-click preset in **`⚡ QA Scenarios`** (`4P Chaos Targets`, `Surrender Half-Off`, or `3P Redirect (Bob POV)`) in `LobbyPage.tsx` or `GamePage.tsx` (`[data-zone="sidebar-left"]`) immediately displays the paler, calmer light-mode highlights across the menus (`HeaderBar.tsx`), player hand (`.hand-cards`), `PLAYERS` status rows, felt target/redirect outlines, trump badges/borders, and preview lines inside the 6 `Highlights` preset buttons in under 15 seconds.
  - Verify that dragging the `Intensity` slider (`20%`–`200%`) in `HeaderBar.tsx` still dynamically scales all light-mode highlight auras down or up in real time.

- [ ] **Automated Frontend Tests (`frontend/src/__tests__/`):**
  - Update and add unit tests in `frontend/src/__tests__/HeaderBar.test.tsx`, `frontend/src/__tests__/app.test.tsx`, and `frontend/src/__tests__/GamePage.test.tsx` verifying that:
    1. In Light mode (`[data-theme="light"]`), default highlight tokens (`--ui-select-*`, `--role-attacker-*`, `--role-defender-*`, `--trump-*`, `--redirect-*`, `--clock-urgent-*`) across all 6 presets resolve to the paler default light-mode colors and softer glow/border alphas.
    2. All 6 highlight roles remain mutually distinct in Light mode, and the `Intensity` slider (`20%`–`200%`) scales their alpha/glow values monotonically.
  - Run `cd frontend && npm test -- --run` and ensure all test suites pass with zero errors.
