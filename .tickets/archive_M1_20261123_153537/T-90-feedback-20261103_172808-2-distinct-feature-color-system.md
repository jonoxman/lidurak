<!-- WAVE:2 -->
# Ticket `T-90-feedback-20261103_172808-2-distinct-feature-color-system`: Consistent & Distinct Semantic Color System Across Unrelated UI & Gameplay Features

## Summary
Establish a strict, non-overlapping semantic color architecture across `frontend/src/app.css`, `frontend/src/styles/table.css`, `HeaderBar.tsx`, `GamePage.tsx`, `GameTable.tsx`, `SortBar.tsx`, `ActionBar.tsx`, and `LobbyPage.tsx` so that each unrelated feature uses its own distinct color family (e.g., the green used to highlight the active attacking player is never reused in the UI customization menus, chrome tabs/sorting buttons, or lobby form controls to indicate a UI selection) and every related element within a feature shares a consistent color in both Dark and Light modes.

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-1a, ITEM-1b & ITEM-1c (Verbatim Human Feedback):**
  > "1. Use consistent and distinct colors between each unrelated feature. For example, the green used to highlight the active player should not also be used in the UI customization menus to indicate a selection."
- [ ] **Semantic Feature Color Architecture (Strict Separation Across Both Dark & Light Themes):**
  Define dedicated CSS custom properties in `frontend/src/app.css` and `frontend/src/styles/table.css` for each feature domain, calibrated for high visibility in both Dark (`:root` / `[data-theme="dark"]`) and Light (`[data-theme="light"]`) modes:
  1. **UI Customization Menus & Chrome Selection Controls — Royal Blue / Cobalt (`--ui-select-*`):**
     - **Dark Mode:** Border/accent `#3b82f6` (`rgba(59, 130, 246, 0.85)`), soft halo `rgba(59, 130, 246, 0.4)`, active surface tint `rgba(59, 130, 246, 0.16)`.
     - **Light Mode:** Darker high-contrast cobalt border/accent `#1d4ed8` (`rgba(29, 78, 216, 0.9)`), halo `0 0 12px 2px rgba(29, 78, 216, 0.45)`, active surface tint `rgba(37, 99, 235, 0.14)`.
     - **Applied exclusively to UI/Menu selections & navigation chrome:**
       - `HeaderBar.tsx` Profile customization submenus: selected `Theme` option (`Device theme`, `Light`, `Dark`), selected `Table` felt swatch, selected `Card Back` swatch, selected `Sound` pack option, range slider accents (`Roundness`, `Brightness`, `Contrast`, `Hue`, `Master volume`), and brand/nav menu hover accents.
       - `GamePage.tsx` & `SortBar.tsx` chrome selectors: active `POV` seat-switcher tab, active `HAND SORTING` button (`Suit` / `Pairs` / `Rank`), and hover/focus states on `⚡ QA Scenarios` buttons and `Replay` step buttons.
       - `LobbyPage.tsx` form controls: selected player-count pill (`2`, `3`, `4`), focused player name/type inputs, variant checkboxes, and `Create Game` / `Rematch` primary action buttons.
     - **Must NEVER use green (`#22c55e`, `#15803d`, `#0f7636`) or crimson/amber gameplay colors.**
  2. **Active Attacker / Throw-In Gameplay Role — Emerald / Forest Green (`--role-attacker-*`):**
     - **Dark Mode:** Border `rgba(34, 197, 94, 0.85)` (`#22c55e`), pulsing glow `rgba(34, 197, 94, 0.55)`.
     - **Light Mode:** Deep forest-emerald border `rgba(15, 118, 54, 0.88)` (`#0f7636` / `#15803d`), pulsing glow `rgba(21, 128, 61, 0.78)`.
     - **Applied consistently to all Attacker / Throw-In gameplay elements in BOTH Dark and Light themes:**
       - Right-sidebar `PLAYERS` row for the active attacker (`li.status-badge[data-role="attacker"]` in `GamePage.tsx`).
       - Active player's hand highlight glow when attacking or throwing in (`.hand-cards[data-highlighted="true"][data-highlight-variant="attacker"]` in `GameTable.tsx` / `table.css`) — **note:** update Dark mode so `.hand-cards[data-highlight-variant="attacker"]` also uses Emerald Green instead of amber, ensuring the Attacker role uses the same green color on the hand and in the `PLAYERS` list across both themes!
       - Legal attack target outlines on the battlefield (`[data-testid^="target-outline-"]` in `GameTable.tsx`).
       - The contextual `Pass` button (`[data-testid="pass-button"]` in `ActionBar.tsx` / `table.css`).
  3. **Active Defender / Uncovered Attack / Surrender Gameplay Role — Crimson / Ruby Red (`--role-defender-*`):**
     - **Dark Mode:** Border `rgba(239, 68, 68, 0.88)` (`#ef4444`), pulsing glow `rgba(239, 68, 68, 0.6)`.
     - **Light Mode:** Dark crimson border `rgba(185, 28, 28, 0.9)` (`#b91c1c`), pulsing glow `rgba(185, 28, 28, 0.78)`.
     - **Applied consistently to all Defender gameplay elements in BOTH Dark and Light themes:**
       - Right-sidebar `PLAYERS` row for the active defender (`li.status-badge[data-role="defender"]` in `GamePage.tsx` / `app.css`) — updated from amber to Crimson Red so the defender role in `PLAYERS` matches the crimson defender hand glow, uncovered attack pulse, and `Surrender` button! (Keep `.status-name` inside the row free of any border/outline/box-shadow.)
       - Active player's hand highlight glow when defending (`.hand-cards[data-highlighted="true"][data-highlight-variant="defender"]` in `GameTable.tsx` / `table.css`).
       - Uncovered attacking cards pulsing on the felt (`.table-card-uncovered` in `TablePair.tsx` / `table.css`).
       - The contextual `Surrender` button (`[data-testid="surrender-button"]` in `ActionBar.tsx` / `table.css`).
  4. **Trump Suit & Trump Cards — Gold / Bronze (`--trump-*`):**
     - **Dark Mode:** Warm gold `#f59e0b` (`rgba(245, 158, 11, 0.85)`).
     - **Light Mode:** Deep bronze `#b45309` (`rgba(180, 83, 9, 0.9)`).
     - **Applied exclusively to Trump indicators:** Trump card border glow in hand and under the talon (`Card.tsx` / `table.css`), top-right card corner trump badge, and the `TRUMP` suit pill in the right-sidebar `DECK` box. (No longer shared with the attacker hand glow or the defender `PLAYERS` row.)
  5. **Reflection (`Perevod`) Redirect Outline — Royal Violet / Purple (`--redirect-*`):**
     - **Dark Mode:** Vibrant violet `#a855f7` (`rgba(168, 85, 247, 0.88)`).
     - **Light Mode:** Deep purple `#7e22ce` (`rgba(126, 34, 206, 0.9)`).
     - **Applied exclusively to Redirect (`Perevod`):** `[data-testid="redirect-outline"]` and its directional SVG arrow in `GameTable.tsx` / `table.css`, making reflection visually distinct from green attack target outlines (`[data-testid^="target-outline-"]`).
  6. **Active Clock Display (`Game` & `Turn` Clock Panel) — Cyan / Teal (`--clock-active-*`):**
     - **Dark Mode:** Cyan-teal `#22d3ee` / `rgba(6, 182, 212, 0.75)`.
     - **Light Mode:** Deep ocean-teal `#0e7490` / `rgba(14, 116, 144, 0.85)` (with the final 5-second low-time urgency state in warm orange-amber `#ea580c` / `#c2410c` so it remains distinct from defender crimson and normal teal).
- [ ] **Preserve Single Hand Highlight Outline from Wave 1:**
  - Do not reintroduce any border, outline, or box-shadow on `[data-zone="player-hand"]`; all hand highlight styles must remain scoped strictly to `.hand-cards`.
- [ ] **1-Click Immediate QA Testability (`⚡ QA Scenarios`):**
  - Verify that opening the `Guest` Profile customization menu (`Theme`, `Table`, `Card Back`, `Sound`) and clicking `Surrender Half-Off` or `3P Redirect (Bob POV)` in `⚡ QA Scenarios` immediately demonstrates the distinct color families side-by-side in both Dark and Light modes.
- [ ] **Automated Tests (`HeaderBar.test.tsx`, `GamePage.test.tsx`, `GameTable.test.tsx`, `LobbyPage.test.tsx`, `app.test.tsx`):**
  - Update and add unit tests verifying that:
    1. UI customization menu selections (`Theme`, `Table`, `Card Back`, `Sound`), `POV` active tab, `HAND SORTING` active button, and Lobby selectors use the Royal Blue (`--ui-select-*` / `#3b82f6` / `#1d4ed8`) palette and never use the attacker green (`#22c55e` / `#15803d` / `rgba(21, 128, 61, ...)`).
    2. Attacker `PLAYERS` row (`[data-role="attacker"]`), `.hand-cards[data-highlight-variant="attacker"]`, and attack target outlines consistently use Emerald Green in both Dark and Light themes.
    3. Defender `PLAYERS` row (`[data-role="defender"]`), `.hand-cards[data-highlight-variant="defender"]`, uncovered attack cards, and `Surrender` button consistently use Crimson Red in both Dark and Light themes.
    4. Trump indicators use Gold/Bronze, `[data-testid="redirect-outline"]` uses Violet/Purple, and the active clock half uses Cyan/Teal.
  - Run `cd frontend && npm test -- --run` and ensure all tests pass.
