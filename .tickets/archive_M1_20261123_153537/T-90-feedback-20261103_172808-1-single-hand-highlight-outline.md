<!-- WAVE:1 -->
# Ticket `T-90-feedback-20261103_172808-1-single-hand-highlight-outline`: Remove Vertically Wider Outer Hand Highlight Outline (Single Tight Card-Group Outline Only)

## Summary
When a player's hand is highlighted (such as during pre-surrender defense or attack/throw-in), two nested highlight outlines are currently visible: one tightly wrapping the cards themselves (`.hand-cards`) and a second one that is slightly wider vertically around the outer hand container (`[data-zone="player-hand"]` / `.player-hand-zone`, which includes vertical headroom for lifted legal cards). Keep the inner highlight outline around the cards themselves (`.hand-cards`) and completely remove the outer, vertically wider highlight outline on `[data-zone="player-hand"]`.

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-PREV-4a & ITEM-PREV-4b (Verbatim Human Feedback):**
  > "Previous-4. It seems to work as it should. However there is now a double highlight outline - one is around the cards themselves (this one should stay) while the other is slightly wider vertically (this one should be removed)."
- [ ] **Keep the Tight Inner Highlight Around `.hand-cards`:**
  - In `frontend/src/components/GameTable.tsx`, `frontend/src/styles/table.css`, and `frontend/src/app.css`, `.hand-cards` (the inner flex container that tightly wraps the rendered hand cards with a symmetric `4px` margin/padding around the cards' bounding box) MUST remain the **sole** element that renders the visual hand highlight border, outline, background tint, and pulsing `box-shadow` glow (`data-highlighted="true"`, `data-highlight-variant="defender" | "attacker"`).
  - Verify that `.hand-cards` itself does not stretch vertically to fill the grid row (`align-self: center` or `height: fit-content`) and does not include extra top/bottom padding for card-lift headroom inside its border box, so its highlight outline hugs the top, bottom, left, and right edges of the cards symmetrically (`4px` padding).
  - Preserve the `Previous-4` behavior where the defender crimson glow on `.hand-cards` remains active whenever uncovered attacking cards are on the table—even when the defender has no legal moves (`defenderDefenseless`) and the 3-second `Surrender` countdown is ticking—and turns off immediately once `Surrender` is clicked or auto-fires (`BoutPhase.SurrenderThrowIn`).
- [ ] **Remove the Vertically Wider Highlight Outline on `[data-zone="player-hand"]` (and Any Outer Wrapper):**
  - Audit every CSS rule in `frontend/src/styles/table.css` and `frontend/src/app.css` matching `[data-zone="player-hand"]`, `.player-hand-zone`, `.hand-zone`, `[data-highlighted="true"]`, `[data-highlight-variant="defender"]`, or `[data-highlight-variant="attacker"]` (in both Dark mode and `[data-theme="light"]` Light mode).
  - Remove any `border`, `outline`, `box-shadow`, `background`, or `animation` from `[data-zone="player-hand"]` (and any intermediate wrapper outside `.hand-cards`).
  - Explicitly enforce `border: none; outline: none; box-shadow: none; background: transparent; animation: none;` on `[data-zone="player-hand"]` (including `[data-zone="player-hand"][data-highlighted="true"]`, `[data-zone="player-hand"][data-highlight-variant="defender"]`, and `[data-zone="player-hand"][data-highlight-variant="attacker"]` in both Dark and Light themes) so that keeping `data-highlighted` / `data-highlight-variant` data attributes on `[data-zone="player-hand"]` for testability never produces a second, vertically taller outline around the outer hand zone.
  - Scope all visual hand-glow CSS rules strictly to `.hand-cards[data-highlighted="true"]`, `.hand-cards[data-highlight-variant="defender"]`, and `.hand-cards[data-highlight-variant="attacker"]`.
- [ ] **1-Click Immediate QA Testability (`⚡ QA Scenarios`):**
  - Ensure that clicking **`Defenseless Auto-Surrender`** or **`Surrender Half-Off`** in the Lobby or Left Sidebar **`⚡ QA Scenarios`** panel (`GamePage.tsx` / `LobbyPage.tsx`) immediately displays Bob's defending hand with **only one** highlight outline tightly wrapping the cards (`.hand-cards`), and zero outer vertically wider outline on `[data-zone="player-hand"]`.
- [ ] **Automated Tests (`frontend/src/__tests__/GameTable.test.tsx` & `GamePage.test.tsx`):**
  - Add/update tests verifying that when the player's hand is highlighted (`data-highlight-variant="defender"` or `"attacker"` in both Dark and Light themes), `.hand-cards` has the active highlight class/styles while `[data-zone="player-hand"]` has no highlight border, outline, or box-shadow (`border: none; outline: none; box-shadow: none;`), and that only a single visual highlight container exists around the hand cards.
  - Run `cd frontend && npm test -- --run` and ensure 100% of frontend tests pass.
