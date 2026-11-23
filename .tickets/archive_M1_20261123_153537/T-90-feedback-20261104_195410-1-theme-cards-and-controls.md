<!-- WAVE:1 -->
# Ticket `T-90-feedback-20261104_195410-1`: Palette Glow Slider & Player Box Glows, Light Mode Status Labels, SortBar Dropdown, Gilded-Only Trump Cards, Dark Face-Down Outlines & `REPLAY CONTROLS`

## Summary
Implement the theme, card-rendering, sidebar, and sorting-control updates from human QA feedback items **#1**, **#3**, **#4**, **#5**, **#10**, **#12**, **#16**, and **#17**:
1. Fix the palette intensity slider so sliding it dynamically scales the glow around player boxes (both `.opponent-seat` boxes on the felt table and `.status-badge` rows in the `PLAYERS` list) in real time in both Dark and Light themes, and rename the slider label from `"Intensity"` to `"Glow"`.
2. Make Light Mode status labels (`WINNER`, `OUT`, `PASSED`, `DURAK`) in the `PLAYERS` panel consistent with Dark Mode: `WINNER`, `OUT`, and `PASSED` must all share the same uniform color and have **no border** (`border: none`), with a slightly darker color in Light Mode for contrast, while only `DURAK` has a border (and distinct styling).
3. Restore the `<select>` dropdown menu in `SortBar.tsx` (`HAND SORTING`) instead of the 4-button row UI, keeping `Rank` as the default for new users and keeping the fourth `Custom` option inside the dropdown (`Suit`, `Pairs`, `Rank`, `Custom`).
4. Remove the circles and extra suit symbols signifying a trump card (`trump-badge-top-right` and `trump-badge-bottom-left`) from both full-size face-up trump cards (`Card.tsx`) and low-detail Transparent Mode opponent trump cards (`GameTable.tsx`), keeping **only the gilded border** on both.
5. Rename the `REPLAY` section heading in `GamePage.tsx` to `REPLAY CONTROLS`.
6. Brighten the card outlines for face-down cards (`CardBack.tsx`) in Dark Mode so overlapping face-down cards in opponent hands, the talon deck, and the discard stack are clearly distinguishable.

---

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-1a — Palette Glow Slider Scales Glow Around Player Boxes:**
  - *Verbatim feedback:* "1. Sliding the palette intensity slider doesn't seem to affect the glow around player boxes. Fix this - additionally, rename the slider from "Intensity" to "Glow"."
  - **End-to-End Wiring (`frontend/src/state/settings.ts`, `frontend/src/styles/table.css`, `frontend/src/app.css`, `frontend/src/components/GameTable.tsx`, `frontend/src/pages/GamePage.tsx`):**
    - Inspect how `highlightIntensity` (`20`–`200`, default `100`) in `frontend/src/state/settings.ts` computes and applies CSS custom properties on `:root` (`--highlight-intensity`, `--role-attacker-glow`, `--role-attacker-border`, `--role-attacker-bg`, `--role-defender-glow`, `--role-defender-border`, `--role-defender-bg`, etc.).
    - Ensure that **opponent player seat boxes** on the felt table (`.opponent-seat` / `[data-seat="top-left" | "top-center" | "top-right"]` in `GameTable.tsx` and `table.css`) carry `data-role="attacker" | "defender" | "none"` (matching the seat's active bout role in `GameTable.tsx`) and that their glow (`box-shadow`) and border (`border-color`) are driven directly by the intensity-scaled CSS custom properties (`var(--role-attacker-glow)`, `var(--role-attacker-border)`, `var(--role-defender-glow)`, `var(--role-defender-border)`) with glow radii scaled by `var(--highlight-intensity-scale, 1)` (where `--highlight-intensity-scale` is `highlightIntensity / 100`, e.g., `0.2` at `20%` and `2.0` at `200%`).
    - Ensure that **`PLAYERS` list rows** (`li.status-badge[data-role="attacker"]` and `li.status-badge[data-role="defender"]` in `GamePage.tsx` and `app.css`) in **both** Dark Mode and Light Mode (`:root[data-theme='light']`) use the intensity-scaled CSS custom properties (`var(--role-attacker-glow)`, `var(--role-attacker-border)`, `var(--role-defender-glow)`, `var(--role-defender-border)`) and scale their `box-shadow` spread/blur radii with `var(--highlight-intensity-scale, 1)` rather than overriding them with static hardcoded `rgba(...)` rules in `app.css`.
    - Sliding the `Glow` slider from `20%` to `200%` must visibly soften or intensify the glow around both the opponent player boxes on the felt table and the player rows in the `PLAYERS` list in real time without closing the menu.

- [ ] **ITEM-1b & ITEM-4 — Rename Slider from `"Intensity"` to `"Glow"` in `Palettes` Section:**
  - *Verbatim feedback:* "1. ... additionally, rename the slider from "Intensity" to "Glow"." & "4. Rename the slider in this section from "Intensity" to "Glow"."
  - **End-to-End Wiring (`frontend/src/components/HeaderBar.tsx`):**
    - Inside the `Guest ▸ Theme` submenu under the `Palettes` section (`[data-testid="theme-highlights-section"]`), change the visible slider label text from `Intensity` to `Glow` (while preserving `data-testid="highlight-intensity-slider"` and existing setting keys so `UserSettings.highlightIntensity` remains backwards-compatible).

- [ ] **ITEM-3 — Light Mode Status Labels Consistent with Dark Mode (Uniform Color, No Border on Non-Durak Labels, Darker Contrast):**
  - *Verbatim feedback:* "3. In dark mode, all status labels are the same color, while in light mode, they are different colors and have a border (in dark mode, only DURAK has a border). Adjust the light mode version to be consistent with dark mode, keeping the color slightly darker for more contrast."
  - **End-to-End Wiring (`frontend/src/app.css`, `frontend/src/pages/GamePage.tsx`):**
    - In Dark Mode, `.status-out` (`WINNER`, `OUT`, `PASSED`) all share the same uniform color and have **no border**, whereas only `.status-durak` (`DURAK`) has a border and distinct crimson styling.
    - Update the Light Mode rules (`:root[data-theme='light']` / `[data-theme="light"]` in `frontend/src/app.css`) for the status pills (`[data-status="WINNER"]`, `[data-status="OUT"]`, `[data-status="PASSED"]`, `.status-out`) so that:
      1. `WINNER`, `OUT`, and `PASSED` all share the **exact same uniform color scheme** in Light Mode (do NOT color `WINNER` green, `OUT` slate, and `PASSED` blue separately).
      2. `WINNER`, `OUT`, and `PASSED` have **no border** (`border: none` / `border-color: transparent`), matching Dark Mode where only `DURAK` has a border.
      3. Their uniform Light Mode background and text color is slightly darker for strong readability and contrast against the light `.status-badge` row (e.g., background `#cbd5e1`, text `#1e293b`, `font-weight: 700`, `border: none`).
      4. `DURAK` (`.status-durak` / `[data-status="DURAK"]`) remains the **only** status label in Light Mode with a visible border (e.g., `#dc2626` / `#ef4444` border with dark crimson text `#991b1b` on `#fecaca` / `#fee2e2`).
      5. Keep the Light Mode `TRUMP` badge under the deck high-contrast as already established.

- [ ] **ITEM-5 — Restore `<select>` Dropdown Menu in `HAND SORTING` (`SortBar.tsx`) with `Custom` Option:**
  - *Verbatim feedback:* "5. Restore the dropdown menu that was there before, instead of this new button UI. Keep the new Custom option in this dropdown."
  - **End-to-End Wiring (`frontend/src/components/SortBar.tsx`, `frontend/src/pages/GamePage.tsx`, `frontend/src/app.css`, `frontend/src/styles/table.css`):**
    - In `frontend/src/components/SortBar.tsx`, replace the 4-button row UI with a `<select>` dropdown menu (`data-testid="sort-select"`, class `sort-select`) inside the `HAND SORTING` container (`data-testid="sort-bar"`).
    - Include all four options inside the `<select>` dropdown in order:
      - `<option value="suit" data-testid="sort-suit">Suit</option>`
      - `<option value="pairs" data-testid="sort-pairs">Pairs</option>`
      - `<option value="rank" data-testid="sort-rank">Rank</option>`
      - `<option value="custom" data-testid="sort-custom">Custom</option>`
    - Keep `Rank` (`'rank'`) as the default sorting mode for new users (`DEFAULT_SORT_MODE = 'rank'`).
    - Selecting an option via `onChange` on the `<select>` calls `onChange(e.currentTarget.value as SortMode)`. When the user manually reorders their hand (Item 6), the `<select>` value automatically reflects `'custom'` (`Custom`). When a new game starts, `'custom'` is still non-persistent and resets to the user's saved non-custom sort mode (`'rank'` by default).

- [ ] **ITEM-12 — Remove Circles and Extra Suit Symbols Signifying a Trump Card (`Card.tsx`), Keeping Only the Gilded Border:**
  - *Verbatim feedback:* "12. Remove the circles and extra suit symbols signifying a trump card altogether, keeping only the gilded border."
  - **End-to-End Wiring (`frontend/src/components/Card.tsx`, `frontend/src/styles/table.css`, `frontend/src/app.css`):**
    - In `frontend/src/components/Card.tsx`, completely remove the top-right and bottom-left trump badge circles and suit symbols (`data-testid="trump-badge-top-right"`, `data-testid="trump-badge-bottom-left"`, and any `.trump-badge` SVG `<g>` / `<circle>` / `<text>` elements).
    - Keep `isTrump` applying the `.trump-card` class (`data-trump="true"`, `data-trump-glow="false"`) and the gilded gold border (`--trump-border` / `--trump-accent` on `.playing-card.trump-card` and its SVG frame stroke) with **no glowing aura** and **no extra trump circles or suit badges**.

- [ ] **ITEM-10 — Low-Detail Transparent Mode Cards Use Gilded Border Only (No Trump Highlight Icons):**
  - *Verbatim feedback:* "10. In the low-detail cards, there is no need to display the trump highlight icons. However, give the low-detail trump cards the same gilded border that the large trump cards have, as in point 12."
  - **End-to-End Wiring (`frontend/src/components/GameTable.tsx`, `frontend/src/styles/table.css`):**
    - In `frontend/src/components/GameTable.tsx`, inside the Transparent Mode low-detail opponent card renderer (`[data-testid="opponent-low-detail-card"]`), remove the `low-detail-trump-top-right` and `low-detail-trump-bottom-left` badge icons altogether.
    - When a low-detail card's suit matches `trumpSuit` (`isTrump`), apply the `trump-card` / `low-detail-trump` class (`data-trump="true"`) and style `.opponent-low-detail-card.trump-card` (and `[data-trump="true"]`) in `frontend/src/styles/table.css` with the exact same gilded border (`border: 2px solid var(--trump-border, #f59e0b)` / `stroke: var(--trump-border, #f59e0b)` and no box-shadow glow) that the full-size `.playing-card.trump-card` uses.

- [ ] **ITEM-16 — Rename `REPLAY` Section to `REPLAY CONTROLS`:**
  - *Verbatim feedback:* "16. Rename the REPLAY section to REPLAY CONTROLS"
  - **End-to-End Wiring (`frontend/src/pages/GamePage.tsx`):**
    - In `frontend/src/pages/GamePage.tsx`, change the heading of the post-game replay panel in the left sidebar from `Replay` / `REPLAY` to `REPLAY CONTROLS`.

- [ ] **ITEM-17 — Brighter Card Outlines for Face-Down Cards in Dark Mode:**
  - *Verbatim feedback:* "17. Make the card outlines for face-down cards in dark mode brighter, for more visibility."
  - **End-to-End Wiring (`frontend/src/components/CardBack.tsx`, `frontend/src/styles/table.css`, `frontend/src/app.css`):**
    - In `frontend/src/components/CardBack.tsx` (and corresponding CSS in `table.css` / `app.css`), brighten the outer frame stroke and border of face-down cards when in Dark Mode (`data-card-theme="dark"` / `:root[data-theme="dark"]`) for both monochrome and gradient card-back designs (e.g., increasing outer frame stroke in Dark Mode to a bright silver-slate `#94a3b8` / `#cbd5e1` with `strokeWidth="2"` and `.card-back` border `rgba(203, 213, 225, 0.65)` in Dark Mode) so that overlapping face-down cards in opponent hands, the talon deck, and the face-down discard stack have crisp, clearly visible outlines in Dark Mode. Keep Light Mode face-down card outlines crisp and unchanged.

---

## Testing & Verification Requirements
- Update and run the frontend Vitest suite (`cd frontend && npm test -- --run`) to cover all updated behaviors:
  - `HeaderBar.test.tsx`: verify the slider label reads `Glow` inside `Palettes` and dragging it updates `--highlight-intensity` / `--highlight-intensity-scale` and scales player box glows.
  - `Card.test.tsx`: verify face-up trump cards render the `.trump-card` gilded border and do **not** render `trump-badge-top-right` or `trump-badge-bottom-left`, and verify `CardBack` in dark mode uses the brighter outer frame stroke.
  - `GamePage.test.tsx` & `GameTable.test.tsx`: verify `SortBar` renders a `<select data-testid="sort-select">` with `Suit`, `Pairs`, `Rank`, and `Custom` options (defaulting to `Rank`), verify low-detail trump cards in Transparent Mode have `data-trump="true"` and `.trump-card` gilded border without trump corner icons, verify Light Mode status tags (`WINNER`, `OUT`, `PASSED`) share uniform borderless styling while `DURAK` has a border, and verify the replay panel heading reads `REPLAY CONTROLS`.
