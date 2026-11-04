<!-- WAVE:2 -->
# Ticket `T-90-feedback-20261104_101228-2-distinct-feature-color-system` (WAVE:2)
**Summary:** Implement `Item 1` by establishing and enforcing consistent, mutually distinct semantic color families across all unrelated features (UI customization menus & controls vs. active attacker vs. active defender vs. trump indicators vs. `Perevod` reflection vs. active turn/game clocks) in both Dark and Light themes.

---

## Context & Requirement Analysis
In `<resolved_human_feedback>`:
> **1.** *"Use consistent and distinct colors between each unrelated feature. For example, the green used to highlight the active player should not also be used in the UI customization menus to indicate a selection."*

Previously, multiple unrelated UI features shared overlapping colors:
- UI customization menus (`Theme`, `Table`, `Card Back`, `Sound`), Lobby selections (`Number of Players` pills, checkboxes, `Create Game`), and game chrome controls (`POV` tabs, `HAND SORTING` buttons) used green (`#4ade80` / `#22c55e` / `#15803d`), colliding with the active attacker player highlight and legal attack target outlines.
- Attacker hand glow in Dark mode, defender row in the `PLAYERS` sidebar, and trump card indicators overlapped on amber/gold (`#f59e0b`).
- Reflection (`Perevod`) outlines and attack target outlines overlapped on green.

Every unrelated feature must use its own consistent, non-overlapping semantic color family across both Dark and Light themes.

---

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-1a (Consistent & Mutually Distinct Semantic Color Token Architecture in Dark & Light Modes):**
  - *"1. Use consistent and distinct colors between each unrelated feature. For example, the green used to highlight the active player should not also be used in the UI customization menus to indicate a selection."*
  - Define and enforce 6 non-overlapping semantic color families via CSS custom properties in `:root` (Dark theme) and `[data-theme="light"]` (Light theme) across `frontend/src/app.css` and `frontend/src/styles/table.css`:
    1. **UI Customization Menus, Chrome & Selection Controls (`--ui-select-*` — Royal Blue / Cobalt):**
       - Dark: `--ui-select-accent: #3b82f6`, `--ui-select-border: rgba(59, 130, 246, 0.85)`, `--ui-select-glow: rgba(59, 130, 246, 0.4)`, `--ui-select-bg: rgba(59, 130, 246, 0.16)`, `--ui-select-text: #93c5fd`.
       - Light: `--ui-select-accent: #1d4ed8`, `--ui-select-border: rgba(29, 78, 216, 0.9)`, `--ui-select-glow: rgba(29, 78, 216, 0.45)`, `--ui-select-bg: rgba(37, 99, 235, 0.14)`, `--ui-select-text: #1e3a8a`.
    2. **Active Attacker / Throw-In Gameplay Role (`--role-attacker-*` — Emerald Green):**
       - Dark: `--role-attacker-accent: #22c55e`, `--role-attacker-border: rgba(34, 197, 94, 0.85)`, `--role-attacker-glow: rgba(34, 197, 94, 0.55)`, `--role-attacker-bg: rgba(34, 197, 94, 0.14)`.
       - Light: `--role-attacker-accent: #15803d`, `--role-attacker-border: rgba(15, 118, 54, 0.88)`, `--role-attacker-glow: rgba(21, 128, 61, 0.78)`, `--role-attacker-bg: rgba(21, 128, 61, 0.18)`.
    3. **Active Defender / Uncovered Attack / Surrender Role (`--role-defender-*` — Crimson Red):**
       - Dark: `--role-defender-accent: #ef4444`, `--role-defender-border: rgba(239, 68, 68, 0.88)`, `--role-defender-glow: rgba(239, 68, 68, 0.6)`, `--role-defender-bg: rgba(239, 68, 68, 0.15)`.
       - Light: `--role-defender-accent: #b91c1c`, `--role-defender-border: rgba(185, 28, 28, 0.9)`, `--role-defender-glow: rgba(185, 28, 28, 0.78)`, `--role-defender-bg: rgba(185, 28, 28, 0.18)`.
    4. **Trump Indicators (`--trump-*` — Gold / Bronze):**
       - Dark: `--trump-accent: #f59e0b`, `--trump-border: rgba(245, 158, 11, 0.8)`, `--trump-glow: rgba(245, 158, 11, 0.42)`, `--trump-bg: rgba(245, 158, 11, 0.14)`.
       - Light: `--trump-accent: #b45309`, `--trump-border: rgba(180, 83, 9, 0.9)`, `--trump-glow: rgba(180, 83, 9, 0.55)`, `--trump-bg: rgba(180, 83, 9, 0.16)`.
    5. **Reflection (`Perevod`) Outline & Arrow (`--redirect-*` — Royal Violet / Purple):**
       - Dark: `--redirect-accent: #a855f7`, `--redirect-border: rgba(168, 85, 247, 0.9)`, `--redirect-glow: rgba(168, 85, 247, 0.55)`, `--redirect-bg: rgba(168, 85, 247, 0.14)`.
       - Light: `--redirect-accent: #7e22ce`, `--redirect-border: rgba(126, 34, 206, 0.92)`, `--redirect-glow: rgba(126, 34, 206, 0.65)`, `--redirect-bg: rgba(126, 34, 206, 0.15)`.
    6. **Active Turn & Game Clocks (`--clock-active-*` — Cyan / Teal, plus Orange-Amber urgency):**
       - Dark: `--clock-active-accent: #22d3ee`, `--clock-active-border: rgba(6, 182, 212, 0.75)`, `--clock-active-glow: rgba(6, 182, 212, 0.38)`, `--clock-active-bg: rgba(6, 182, 212, 0.12)`, `--clock-urgent-accent: #ea580c`.
       - Light: `--clock-active-accent: #0e7490`, `--clock-active-border: rgba(14, 116, 144, 0.85)`, `--clock-active-glow: rgba(14, 116, 144, 0.55)`, `--clock-active-bg: rgba(14, 116, 144, 0.14)`, `--clock-urgent-accent: #c2410c`.

- [ ] **ITEM-1b (UI Customization Menus, Lobby & Non-Role Chrome Exclusively Use Royal Blue / Cobalt `--ui-select-*`):**
  - In `frontend/src/components/HeaderBar.tsx` and `frontend/src/app.css`:
    - Selected options in `Theme` (`Device theme`, `Light`, `Dark`), `Table` felt swatches, `Card Back` swatches, and `Sound` pack rows (`.appearance-choice.active`, `.felt-swatch-btn.active`, `.card-back-swatch-btn.active`, `.sound-pack-btn.active`), plus all appearance/audio range sliders (`Roundness`, `Brightness`, `Contrast`, `Hue`, `Master volume`) and header brand/navigation hover states must use the Royal Blue / Cobalt `--ui-select-*` variables and **never** use emerald green (`#4ade80`, `#22c55e`, `#15803d`).
  - In `frontend/src/pages/LobbyPage.tsx` and `frontend/src/app.css`:
    - Active player-count selector buttons (`2`, `3`, `4`), focused text/select inputs, variant checkboxes (`Allow redirects`, `Chaos Mode`), `Create Game` button, and `Rematch` button must use the Royal Blue / Cobalt `--ui-select-*` family.
  - In `frontend/src/pages/GamePage.tsx`, `frontend/src/components/SortBar.tsx`, and `frontend/src/styles/table.css`:
    - Active `POV` player-switcher tab (`.pov-tab.active`), active `HAND SORTING` button (`Suit` / `Pairs` / `Rank`, `.sort-btn.active`), `⚡ QA Scenarios` button hover/focus states, and `Replay` step button hover/focus states must use the Royal Blue / Cobalt `--ui-select-*` family.

- [ ] **ITEM-1c (Consistent & Distinct Gameplay Role / Feature Colors Across Table & Sidebars):**
  - **Active Attacker / Throw-In (Emerald Green `--role-attacker-*`):**
    - Right-sidebar `PLAYERS` attacker row (`li.status-badge[data-role="attacker"]`), attacking and throw-in `.hand-cards` glow (`.hand-cards[data-highlighted="true"][data-highlight-variant="attacker"]`, `.hand-cards[data-highlighted="true"][data-highlight-variant="throw-in"]`), legal attack target outlines on the felt (`.target-outline`), and the `Pass` button (`.action-btn-pass`) all use `--role-attacker-*` in both Dark and Light themes (no amber hand glow in Dark mode).
  - **Active Defender / Uncovered Attack / Surrender (Crimson Red `--role-defender-*`):**
    - Right-sidebar `PLAYERS` defender row (`li.status-badge[data-role="defender"]`), defending `.hand-cards` glow (`.hand-cards[data-highlighted="true"][data-highlight-variant="defender"]`), pulsing uncovered attacking cards on the felt (`.table-card-uncovered`), and the `Surrender` button (`.action-btn-surrender`) all use `--role-defender-*` in both Dark and Light themes (the `PLAYERS` defender row is crimson red, matching the defender's hand and `Surrender` button, rather than amber).
  - **Trump Indicators (Gold / Bronze `--trump-*`):**
    - Trump cards in hand/under the talon (`.playing-card.trump-card`), the top-right trump badge on cards, and the `TRUMP` suit badge in the `DECK` box exclusively use `--trump-*`.
  - **Reflection / `Perevod` (Royal Violet / Purple `--redirect-*`):**
    - `[data-testid="redirect-outline"]` (`.redirect-outline`) and its directional SVG arrow in `GameTable.tsx` / `table.css` exclusively use `--redirect-*` so reflection is immediately distinguishable from green attack target outlines.
  - **Active Clock (Cyan / Teal `--clock-active-*` & Orange-Amber Urgency):**
    - Active `Game` and `Turn` clock halves (`.split-clock-half[data-active="true"]`) and digits in `GamePage.tsx` / `table.css` exclusively use `--clock-active-*` (switching to `--clock-urgent-accent` in the final 5 seconds).

- [ ] **15-Second Interactive QA Testability (1-Click QA Scenario Presets):**
  - Verify that a human reviewer opening `http://localhost:5173` can test all distinct feature colors in under 15 seconds:
    1. Open `Guest` Profile dropdown (`HeaderBar.tsx`) and click `Theme`, `Table`, `Card Back`, and `Sound` to observe Royal Blue / Cobalt (`--ui-select-*`) selection highlights in both `Dark` and `Light` modes.
    2. Click **`Surrender Half-Off`** (`surrender-half-off`) in **`⚡ QA Scenarios`** (`LobbyPage.tsx` / `GamePage.tsx`) to observe Crimson Red (`--role-defender-*`) on Bob's defender `PLAYERS` row, Bob's `.hand-cards` glow, the uncovered `7♠`, and the `Surrender` button; switch **`POV`** to **Alice** to observe Emerald Green (`--role-attacker-*`) on Alice's attacker `PLAYERS` row and `.hand-cards` glow alongside Gold/Bronze (`--trump-*`) on trump cards and Cyan/Teal (`--clock-active-*`) on the active clock.
    3. Click **`3P Redirect (Bob POV)`** (`3p-redirect-bob`) in **`⚡ QA Scenarios`** to observe the Royal Violet / Purple (`--redirect-*`) reflection outline and arrow (`[data-testid="redirect-outline"]`).

---

## End-to-End Wiring & Files to Inspect / Modify
1. **Global & Table Styles (`frontend/src/app.css`, `frontend/src/styles/table.css`):**
   - Verify and enforce all 6 CSS custom property families (`--ui-select-*`, `--role-attacker-*`, `--role-defender-*`, `--trump-*`, `--redirect-*`, `--clock-active-*`) in `:root` and `[data-theme="light"]`, and ensure no UI menu/chrome selector uses attacker green and no unrelated gameplay features share colors.
2. **Frontend Components (`frontend/src/components/HeaderBar.tsx`, `frontend/src/components/GameTable.tsx`, `frontend/src/components/SortBar.tsx`, `frontend/src/pages/GamePage.tsx`, `frontend/src/pages/LobbyPage.tsx`):**
   - Verify all inline styles, SVG strokes/fills (including the `Perevod` reflection arrow in `GameTable.tsx`), and class bindings reference the distinct semantic color tokens.
3. **Frontend Automated Tests (`frontend/src/__tests__/HeaderBar.test.tsx`, `frontend/src/__tests__/GamePage.test.tsx`, `frontend/src/__tests__/GameTable.test.tsx`, `frontend/src/__tests__/LobbyPage.test.tsx`):**
   - Add/verify unit and DOM style assertions confirming that:
     - UI customization menu active items (`Theme`, `Table`, `Card Back`, `Sound`), `POV` tabs, `HAND SORTING` buttons, and Lobby selections use `--ui-select-*` (Royal Blue / Cobalt) and never green.
     - Attacker role row, attacker/throw-in `.hand-cards` glow, target outlines, and `Pass` button use `--role-attacker-*` (Emerald Green).
     - Defender role row, defender `.hand-cards` glow, uncovered attack cards, and `Surrender` button use `--role-defender-*` (Crimson Red).
     - Trump indicators use `--trump-*` (Gold / Bronze).
     - `redirect-outline` and its arrow use `--redirect-*` (Royal Violet / Purple).
     - Active clock uses `--clock-active-*` (Cyan / Teal).
   - Run `cd frontend && npm test -- --run` and ensure all tests pass.
