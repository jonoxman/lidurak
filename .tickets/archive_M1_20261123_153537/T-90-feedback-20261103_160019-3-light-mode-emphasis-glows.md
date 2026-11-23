<!-- WAVE:2 -->
# T-90-3: Darken and Increase Visibility of All Light-Mode Emphasis & Highlighting Glows Across Game Area, Menus, and Sidebars

## Summary
In `<resolved_human_feedback>`, the user reported:
> *"1. In light mode, the highlighting glows around players' cards and in the menu are not very visible. Adjust the colors so that in light mode they are darker and more visible (the dark mode version looks good as is). This change should affect all of the emphasis glows in the project, including both in the game area and in the side bars."*

Currently, against the pale light-mode surfaces (`#f1f5f9` / `#e2e8f0` backgrounds, pale felt textures, and `#ffffff` card faces), light-mode glows use bright pastel colors or low-alpha shadows that wash out. Meanwhile, the dark-mode glows look good as-is and must NOT be changed.

This ticket audits and updates every emphasis and highlighting glow in **Light Mode** (`html[data-theme='light']` / `.theme-light` / `[data-table-theme='light']`) across `frontend/src/styles/table.css` and `frontend/src/app.css` so they use **darker, higher-contrast, richer colors with stronger opacity/spread** across the game area, menus, and sidebars, while leaving Dark Mode completely unchanged.

## Scope & Files to Touch
- `frontend/src/styles/table.css`
- `frontend/src/app.css`
- `frontend/src/__tests__/GameTable.test.tsx`
- `frontend/src/__tests__/GamePage.test.tsx`
- `frontend/src/__tests__/HeaderBar.test.tsx`
- `frontend/src/__tests__/app.test.tsx`

## Technical Implementation Details

### 1. Preserve All Dark-Mode Glow Rules Unchanged
- Do NOT alter the default / `html[data-theme='dark']` glow colors, shadows, borders, or keyframe animations.
- Scope all darker, higher-visibility glow overrides to `html[data-theme='light']` (and `[data-table-theme='light']` where applicable in `table.css`).

### 2. Game Area Emphasis Glows in Light Mode (`ITEM-1a` — `frontend/src/styles/table.css`)
Under `html[data-theme='light']` / `[data-table-theme='light']`, darken and strengthen the alpha/spread of all emphasis glows in the game area:
1. **Player Hand Turn-Prompt Glows (`.hand-cards[data-highlighted="true"]`):**
   - **Attack / Throw-In Hand Glow:** Use a darker, rich forest/emerald green or deep amber-ochre border and multi-layer `box-shadow` (e.g., border `rgba(15, 118, 54, 0.85)` or `#15803d` / `#b45309`, outer glow `0 0 14px 3px rgba(21, 128, 61, 0.65), inset 0 0 8px rgba(21, 128, 61, 0.28)` with light-mode pulse keyframes pulsing up to `0.82` alpha) so the hand glow is unmistakably visible against the pale felt.
   - **Defender Pre-Surrender Red Hand Glow (`.hand-cards[data-highlighted="true"][data-highlight-variant="defender"]`):** Use a darker crimson/ruby border and glow in light mode (e.g., border `#b91c1c` / `rgba(185, 28, 28, 0.9)`, `box-shadow: 0 0 16px 4px rgba(185, 28, 28, 0.68), inset 0 0 8px rgba(185, 28, 28, 0.3)` with light-mode pulse keyframes) so the pre-surrender red glow pops against light felt and white cards.
2. **Players' Cards Emphasis Glows (`.playing-card` in Hand and on Felt):**
   - **Trump Card Glow (`.playing-card--trump` / `[data-trump="true"]`):** Darken the golden/amber border and glow in light mode (e.g., deeper bronze/ochre `#b45309` / `rgba(180, 83, 9, 0.75)` with `box-shadow: 0 0 10px 2px rgba(180, 83, 9, 0.48)`) instead of pale yellow that blends into white cards.
   - **Legal / Playable / Hovered / Dragged Card Glow:** Strengthen the emphasis shadow/glow around lifted legal cards and dragged/snapped cards in light mode.
   - **Uncovered Attacking Card Pulse/Glow on Felt (`.table-pair--uncovered` / pulsing attack card when defending):** Use a darker crimson/amber emphasis glow and higher-contrast pulse keyframe under `html[data-theme='light']` so uncovered cards clearly demand attention.
3. **Target Outlines, Reflection (`Perevod`) Outline & Action Buttons on Table:**
   - Darken the border and glow of `[data-testid^="target-outline-"]` (`.target-outline`, including hover/magnetic snap active states), `[data-testid="redirect-outline"]` (`.redirect-outline`), and the table action buttons (`Surrender` crimson glow, `Pass` green/amber glow) under `html[data-theme='light']`.

### 3. Menu, Header & Sidebar Emphasis Glows in Light Mode (`ITEM-1b` — `frontend/src/app.css` & `frontend/src/styles/table.css`)
Under `html[data-theme='light']`, darken and increase the contrast/opacity of all emphasis glows in the sidebars, menus, and lobby:
1. **Right Sidebar `PLAYERS` List Attacker & Defender Role Glows (`li.status-badge[data-role="attacker"]` & `li.status-badge[data-role="defender"]`):**
   - Previously, `html[data-theme='light']` toned these down to faint low-alpha shadows. Update them in `html[data-theme='light']` to use darker, clearly visible diffused glows:
     - `li.status-badge[data-role="attacker"]`: darker emerald border (`rgba(21, 128, 61, 0.85)`) and stronger multi-layer glow (`0 0 14px 3px rgba(21, 128, 61, 0.58), inset 0 0 10px rgba(21, 128, 61, 0.24)`).
     - `li.status-badge[data-role="defender"]`: darker amber/ochre border (`rgba(180, 83, 9, 0.88)`) and stronger multi-layer glow (`0 0 14px 3px rgba(180, 83, 9, 0.60), inset 0 0 10px rgba(180, 83, 9, 0.25)`).
     - Keep `.status-name` free of its own border/outline/box-shadow (`border: none; outline: none; box-shadow: none;`).
     - Also darken the active green presence dot glow (`.presence-dot--online` / `[data-present="true"]`) in light mode so it reads crisply.
2. **Right Sidebar Active Clock Half Glow & Urgent Countdown Glow:**
   - In the split clock panel (`Game` clock top half, `Turn` clock bottom half), make the running half's emphasis glow/border/highlight and low-time warning glow darker and more visible under `html[data-theme='light']`.
3. **Left Sidebar & Below-Table Controls (`POV` Tabs, `⚡ QA Scenarios`, `Replay` Controls, `HAND SORTING` Active Button):**
   - Under `html[data-theme='light']`, give the active `POV` tab, active `HAND SORTING` mode button (`Suit` | `Pairs` | `Rank`), and hovered/focused `⚡ QA Scenarios` / `Replay` buttons a darker, clearly visible emphasis border and glow (`box-shadow`).
4. **Top Header & Appearance Profile Dropdown Menu Glows (`HeaderBar.tsx` / `app.css`) & Lobby (`LobbyPage.tsx`):**
   - In the Profile/Appearance dropdown menu (`Theme`, `Table` felt texture swatches, `Card Back` swatches, `Sound` pack items) and top navigation menus (`PLAY`, `PUZZLES`, `LEARN`, `WATCH`), update the selected/active item and swatch emphasis glows under `html[data-theme='light']` to use darker, high-visibility accent borders and shadows (e.g., deep forest/emerald `#15803d` / `#0f766e` or deep slate-blue/amber with `0 0 10px 2px` shadow at `0.55+` alpha) so selected menu items and swatches stand out clearly in light mode.
   - Similarly ensure Lobby page (`LobbyPage.tsx`) active player-count buttons, form focus glows, and the primary `Create Game` button glow are darker and high-visibility in light mode.

### 4. Automated Unit Tests
- Add and update tests in `frontend/src/__tests__/GameTable.test.tsx`, `frontend/src/__tests__/GamePage.test.tsx`, `frontend/src/__tests__/HeaderBar.test.tsx`, and `frontend/src/__tests__/app.test.tsx` verifying:
  - `html[data-theme='light']` defines dedicated darker, high-alpha glow rules in `table.css` and `app.css` for:
    - `.hand-cards[data-highlighted="true"]` (both default attack/throw-in and `[data-highlight-variant="defender"]` red glow),
    - trump cards and uncovered attacking cards on the table,
    - target and redirect outlines,
    - `li.status-badge[data-role="attacker"]` and `li.status-badge[data-role="defender"]` in the right sidebar,
    - active clock half, `POV` tabs, `HAND SORTING` active button, and profile/appearance menu active options/swatches,
  - While dark mode (`html[data-theme='dark']`) retains its existing glow styles unchanged.

## 15-Second Interactive QA Verification
1. Open `http://localhost:5173`, click `Guest` in the top-right header → `Theme` → select **`Light`**.
2. Inspect the appearance menu selection glows (`Theme`, `Table` swatches, `Card Back` swatches), then click **`Surrender Half-Off`** or **`4P Chaos Targets`** in **`⚡ QA Scenarios`**.
3. Verify in Light Mode that:
   - The hand highlight glow (red for Bob before surrender in `Surrender Half-Off`; green/amber for Alice in `4P Chaos Targets`), trump card glows, uncovered attack card glows, and target/redirect outlines on the felt are dark and immediately visible.
   - The `PLAYERS` list attacker/defender glows, active clock half glow, active `POV` tab, active `HAND SORTING` button, and menu selection highlights are dark and clearly visible against the light-mode panels.
   - Switching back to **`Dark`** mode preserves the original dark-mode glows unchanged.

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-1a (Game Area Light-Mode Emphasis Glows):** *"1. In light mode, the highlighting glows around players' cards and in the menu are not very visible. Adjust the colors so that in light mode they are darker and more visible (the dark mode version looks good as is). This change should affect all of the emphasis glows in the project, including both in the game area and in the side bars."* — Wired in `frontend/src/styles/table.css` so all light-mode emphasis glows in the game area (hand turn-prompt glows for attack/throw-in and pre-surrender defense, trump card glows, uncovered attacking card glows, target/redirect outlines, and table action buttons) use darker, high-visibility colors while dark mode remains unchanged.
- [ ] **ITEM-1b (Menu & Sidebar Light-Mode Emphasis Glows):** *"1. In light mode, the highlighting glows around players' cards and in the menu are not very visible. Adjust the colors so that in light mode they are darker and more visible (the dark mode version looks good as is). This change should affect all of the emphasis glows in the project, including both in the game area and in the side bars."* — Wired in `frontend/src/app.css` and `frontend/src/styles/table.css` so all light-mode emphasis glows in the menus, header dropdowns/swatches, left sidebar (`POV` tabs, `⚡ QA Scenarios`, `Replay`), `HAND SORTING` bar, and right sidebar (`PLAYERS` attacker/defender glows, presence dots, active clock half) use darker, high-visibility colors while dark mode remains unchanged.
- [ ] All frontend unit tests pass via `cd frontend && npm test -- --run`.

