<!-- WAVE:2 -->
# Ticket `T-90-feedback-20261104_133915-2-light-theme-background-header`: Darker Cool-Grey Light Theme Background & Inverse Header Bar Lightening Gradient

## Summary
Update the Light theme (`[data-theme="light"]`) page background and header bar styling so that:
1. The light theme background in general is slightly darker and a little more grey than beige across the entire app (`LobbyPage.tsx` and `GamePage.tsx`).
2. The header bar (`HeaderBar.tsx` / `.site-header`) has an inverse effect to the dark theme header bar: in Light mode, the header bar is slightly darker than the rest of the page, with a smooth top-to-bottom lightening gradient that extends a little way down past the header bar to match the rest of the page background.

---

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-NEW-1a (Verbatim from `<resolved_human_feedback>`):**
  > **# New**
  > **1 (Part A).** Adjust the light theme background in general to be slightly darker and a little more grey than beige.

- [ ] **ITEM-NEW-1b (Verbatim from `<resolved_human_feedback>`):**
  > **# New**
  > **1 (Part B).** Additionally, give the header bar an inverse effect to the dark theme one - it should be slightly darker than the rest of the page, with a lightening gradient to match the rest of the page a little way down past the header bar.

- [ ] **Slightly Darker, Greyer-Than-Beige Light Theme Background (`frontend/src/app.css`, `frontend/src/styles/table.css`):**
  - Inspect all `[data-theme="light"]` page, shell, panel, and surface background tokens in `frontend/src/app.css` and `frontend/src/styles/table.css` (such as `--bg-base`, `--bg-page`, `--bg-surface`, `--bg-elevated`, `--bg-panel`, `html[data-theme="light"]`, `body`, `.app-shell`, `.lobby-page`, `.game-page`, sidebar panels, and dropdown surfaces).
  - Replace any warm/beige-tinted or overly bright off-white backgrounds with a **slightly darker, neutral/cool grey palette** (where the RGB channels are neutral/cool grey `R <= G <= B`, never warm beige `R > B`, and overall luminance is noticeably slightly darker than the previous light theme):
    - For example, set the primary rest-of-page background (`--bg-base` / `--bg-page`) to a soft medium-light cool grey around `#d8dde4` / `#dce1e7` (instead of bright `#f1f5f9` / `#f8fafc` or warm beige), with coordinated grey surface/panel tokens (e.g., `--bg-surface: #e4e8ee`, `--bg-elevated: #eceff4`) and crisp slate borders/text so cards, sidebars, and controls have clean contrast against the grey backdrop.

- [ ] **Inverse Light-Theme Header Bar with Lightening Gradient Extending Past the Header Bar (`frontend/src/app.css`, `frontend/src/components/HeaderBar.tsx`):**
  - Inspect how the Dark theme header bar (`.site-header`) and top-of-page background gradient are structured in `frontend/src/app.css` and `frontend/src/components/HeaderBar.tsx`.
  - Implement the **inverse effect** for `[data-theme="light"]`:
    1. **Header bar slightly darker than the rest of the page:** At the top of the viewport (the header bar region), the surface is noticeably darker grey than the rest of the light-theme page background `--bg-base` (for example, starting around `#b8c0cc` / `#bec6d2` at `0px` at the top of the header bar, stepping through `~#c8cfd9` across the header bar height, compared to the rest-of-page `--bg-base` `#d8dde4` / `#dce1e7`).
    2. **Lightening gradient extending a little way down past the header bar:** Instead of stopping abruptly at the bottom edge of `.site-header`, the background lightens smoothly via a top-to-bottom `linear-gradient(180deg, ...)` that starts at the darker header shade at the top of the page, passes seamlessly through the bottom of `.site-header`, and continues lightening **a little way down past the header bar** (e.g., reaching the steady rest-of-page background `--bg-base` at roughly `120px`–`180px` from the top of the page, or `~60px`–`120px` below the header bar) so that the transition into the main page background (`LobbyPage.tsx` and `GamePage.tsx`) is continuous and seamless.
    3. Ensure `.site-header` in `[data-theme="light"]` does not paint a lighter opaque background or harsh solid border that breaks the continuous top-down lightening gradient into `.app-shell` / `body` / `.game-page` / `.lobby-page`.
    4. Expose clean CSS custom properties (e.g., `--header-bg-top`, `--header-gradient-mid`, `--page-top-gradient`) and/or `data-header-gradient="lightening"` on `.site-header` in Light mode (`"darkening"` ordark-theme equivalent in Dark mode) so the inverse gradient behavior can be asserted deterministically in tests.

- [ ] **End-to-End UI Wiring & 15-Second QA Testability (`HeaderBar.tsx`, `LobbyPage.tsx`, `GamePage.tsx`, `GameTable.tsx`):**
  - Verify that opening `http://localhost:5173` and selecting `Guest ▸ Theme ▸ Light` immediately updates both `LobbyPage.tsx` and `GamePage.tsx` (accessible in 1 click via **`⚡ QA Scenarios`** in the lobby or left sidebar):
    - The general page background is visibly slightly darker and cool/neutral grey (not beige).
    - The header bar (`HeaderBar.tsx`) is visibly darker than the lower page background and lightens smoothly via a top-down gradient extending a little way down past the header bar until it matches the rest of the page.

- [ ] **Automated Frontend Tests (`frontend/src/__tests__/`):**
  - Add/update tests in `frontend/src/__tests__/HeaderBar.test.tsx`, `frontend/src/__tests__/app.test.tsx`, and `frontend/src/__tests__/GamePage.test.tsx` verifying:
    1. Light-theme `--bg-base` / page background uses the slightly darker, greyer-than-beige palette (`R <= G <= B`, darker luminance than `#f0f0f0`).
    2. Light-theme `.site-header` / `.app-shell` applies the darker header top shade and the top-down lightening gradient extending past the header bar to match `--bg-base`, inverse to Dark mode.
  - Run `cd frontend && npm test -- --run` and ensure all tests pass.
