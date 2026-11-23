<!-- WAVE:1 -->
# Ticket `T-90-feedback-20261104_101228-1-single-hand-highlight-outline` (WAVE:1)
**Summary:** Fix `Previous-4` double highlight outline around the active player's hand so only the tight outline around the cards themselves (`.hand-cards`) remains and the vertically wider outer outline on `[data-zone="player-hand"]` (or any intermediate hand wrapper) is completely removed in both Dark and Light themes.

---

## Context & Root Cause Analysis
In the human QA review of `Previous-4`:
> **Previous-4:** *"It seems to work as it should. However there is now a double highlight outline - one is around the cards themselves (this one should stay) while the other is slightly wider vertically (this one should be removed)."*

When `[data-zone="player-hand"]` (`.player-hand-zone`) and its inner `.hand-cards` container both carry `data-highlighted="true"` (and `data-highlight-variant="defender" | "attacker" | "throw-in"`), any CSS selector targeting `[data-zone="player-hand"][data-highlighted="true"]`, `.player-hand-zone[data-highlighted="true"]`, or an unqualified `[data-highlighted="true"][data-highlight-variant="..."]` in Dark or Light mode (`[data-theme="light"]`) draws a second border/box-shadow/outline around the outer column (which is taller vertically due to reserved card-lift headroom, padding, or container stretch) in addition to the tight `.hand-cards` outline around the cards themselves.

---

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-PREV-4a (Preserve Working Defender/Attacker/Throw-In Tight Card Highlight):**
  - *"Previous-4. It seems to work as it should. However there is now a double highlight outline - one is around the cards themselves (this one should stay) while the other is slightly wider vertically (this one should be removed)."*
  - Keep the tight highlight outline around the cards themselves (`.hand-cards[data-highlighted="true"]`) working across all active highlight variants (`data-highlight-variant="defender"`, `"attacker"`, and `"throw-in"`) in both Dark and Light themes.
  - Ensure the defending player's `.hand-cards` container retains its pulsing crimson glow (`data-highlighted="true"`, `data-highlight-variant="defender"`) for as long as uncovered attacking cards remain on the table—including when the defender is defenseless (`legalActions = ["surrender"]`) and the 3-second `Surrender` countdown badge (`3 → 2 → 1`) is ticking—and immediately removes the glow (`data-highlighted="false"`, `data-highlight-variant="none"`, `data-surrendering="true"`) the moment `Surrender` is clicked manually or fires automatically into `BoutPhase.SurrenderThrowIn`.
  - Ensure `.hand-cards` continues to wrap only the rendered cards tightly with a symmetric `4px` padding/glow margin and shifts upward (`data-all-legal="true"`) when all cards in hand are legal so the single outline stays tightly centered around the cards on all four sides.

- [ ] **ITEM-PREV-4b (Remove Vertically Wider Outer Highlight Outline):**
  - Remove every visual highlight border, outline, box-shadow, background tint, and glow animation from the outer `[data-zone="player-hand"]` (`.player-hand-zone`) element and any intermediate wrapper (`.hand-scroll-viewport`) in both `:root` (Dark mode) and `[data-theme="light"]` (Light mode).
  - Scope **all** hand highlight glow rules in `frontend/src/styles/table.css` (and `frontend/src/app.css`, if any exist) strictly to `.hand-cards[data-highlighted="true"]` (e.g., `.hand-cards[data-highlighted="true"][data-highlight-variant="defender"]`, `.hand-cards[data-highlighted="true"][data-highlight-variant="attacker"]`, `.hand-cards[data-highlighted="true"][data-highlight-variant="throw-in"]`). Never use unqualified `[data-highlighted="true"]` or `.player-hand-zone[data-highlighted="true"]` / `[data-zone="player-hand"][data-highlighted="true"]` selectors to apply borders, outlines, backgrounds, or box-shadows.
  - Explicitly enforce on `.player-hand-zone`, `.player-hand-zone[data-highlighted="true"]`, `[data-zone="player-hand"][data-highlighted="true"]`, `[data-theme="light"] .player-hand-zone[data-highlighted="true"]`, `[data-theme="light"] [data-zone="player-hand"][data-highlighted="true"]`, and `.hand-scroll-viewport`:
    ```css
    border: none;
    outline: none;
    box-shadow: none;
    background: transparent;
    animation: none;
    ```
  - Preserve the data attributes (`data-highlighted`, `data-highlight-variant`, `data-highlight-role`, `data-defenseless`, `data-surrendering`) on `[data-zone="player-hand"]` and `.hand-cards` in `frontend/src/components/GameTable.tsx` so existing state queries remain backward-compatible while guaranteeing that **only `.hand-cards`** renders the visible outline.

- [ ] **15-Second Interactive QA Testability (1-Click QA Scenario Presets):**
  - Verify that clicking **`Defenseless Auto-Surrender`** (`defenseless-surrender`) or **`Surrender Half-Off`** (`surrender-half-off`) in the **`⚡ QA Scenarios`** panel (`LobbyPage.tsx` and left sidebar of `GamePage.tsx`, calling `POST /api/games/preset` in `GameRoutes.scala` / `GameManager.scala`) opens directly on **Bob (`p1`)** facing an uncovered attacking card during the 3-second auto-surrender countdown, displaying **exactly one** tight crimson highlight outline around `.hand-cards` (and zero outer vertically wider outline on `[data-zone="player-hand"]`) in both Dark and Light themes.
  - Verify that switching **`POV`** to **Alice (`p0`)** in **`Surrender Half-Off`** or opening **`4P Chaos Targets`** (`chaos-4p`) displays **exactly one** tight attacker/throw-in highlight outline around `.hand-cards` (and zero outer vertically wider outline on `[data-zone="player-hand"]`) in both Dark and Light themes.

---

## End-to-End Wiring & Files to Inspect / Modify
1. **Frontend Styles (`frontend/src/styles/table.css`):**
   - Audit every selector matching `player-hand`, `hand-cards`, `hand-scroll-viewport`, `data-highlighted`, or `data-highlight-variant` across both default (Dark) and `[data-theme="light"]` sections.
   - Ensure all visual glow/border/shadow/animation rules apply exclusively to `.hand-cards[data-highlighted="true"]` and that `.player-hand-zone` / `[data-zone="player-hand"]` / `.hand-scroll-viewport` are explicitly reset to `border: none; outline: none; box-shadow: none; background: transparent; animation: none;` in both Dark and Light modes.
2. **Frontend Component (`frontend/src/components/GameTable.tsx`):**
   - Verify `[data-zone="player-hand"]` and `.hand-cards` structure, inline styles, and attributes so nothing on the outer `[data-zone="player-hand"]` wrapper or `.hand-scroll-viewport` introduces a second border, outline, or box-shadow.
3. **Frontend Automated Tests (`frontend/src/__tests__/GameTable.test.tsx`, `frontend/src/__tests__/GamePage.test.tsx`):**
   - Add/update tests verifying that across `"defender"`, `"attacker"`, and `"throw-in"` highlight states (and in both Dark and Light themes), only `.hand-cards` carries the visual highlight outline/box-shadow/border while the outer `[data-zone="player-hand"]` element has `border: none`, `outline: none`, `box-shadow: none`, `background: transparent`, and `animation: none`.
   - Run `cd frontend && npm test -- --run` and ensure all tests pass.
