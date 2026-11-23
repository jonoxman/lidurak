<!-- WAVE:2 -->
# Ticket T-90-feedback-20261123_130625-2: Bind Hand Outline Highlight to Theme Roundness Slider

## Summary
The Theme menu includes a Roundness slider that dynamically controls corner roundness across UI elements, but the highlight of the player's hand outline does not currently respond to it. Wire the hand outline highlight so its corner radius dynamically responds live to changes in the Theme menu's Roundness slider.

## Scope & Target Files
- `frontend/src/state/settings.ts` (read/verify CSS custom property emitted for the Roundness slider)
- `frontend/src/styles/table.css`
- `frontend/src/app.css` (if hand outline / highlight or theme radius variables are defined here)
- `frontend/src/components/GameTable.tsx` (if the hand outline highlight uses inline styles, SVG `rx`/`ry`, or class bindings)
- `frontend/src/__tests__/GameTable.test.tsx` and/or `frontend/src/__tests__/handPresentation.test.tsx`
- (Do NOT touch `README.md` or `ARCHITECTURE.md`.)

## Implementation Requirements & End-to-End Wiring
1. **Audit Theme Roundness Slider Mechanism (`frontend/src/state/settings.ts`, `frontend/src/components/HeaderBar.tsx`, `frontend/src/app.css`):**
   - Inspect how the Theme menu's Roundness slider stores its setting and propagates it into CSS custom properties (e.g., `--ui-radius`, `--card-radius`, `--panel-radius`, `--theme-roundness`, or `--hand-radius` applied on `:root` / `document.documentElement`).
   - Identify every element, wrapper, border, `outline`, `box-shadow`, SVG shape, or pseudo-element (`::before` / `::after`) that renders the hand outline AND the highlight of the hand outline inside `[data-zone="player-hand"]` (for example: resting hand outline, active-turn / prompted highlight, eligible-move glow, drag/drop highlight, or focus/hover outline).
2. **Bind Hand Outline Highlight to Roundness (`frontend/src/styles/table.css`, `frontend/src/app.css`, `frontend/src/components/GameTable.tsx`):**
   - Replace any hardcoded `border-radius` (or missing `border-radius` / mismatched `::before` / `::after` / SVG `rx` radius) on the hand outline and its highlight layer(s) so they dynamically derive their corner radius from the Theme menu's Roundness CSS variable (e.g., `var(--...)` or `calc(...)` consistent with the rest of the UI roundness system).
   - Ensure that at Roundness = minimum (`0`), the hand outline highlight has sharp corners (`0px`), and as the user slides Roundness upward toward maximum, the hand outline highlight smoothly and visibly rounds to match the hand outline and other rounded panels without clipping or detached corner artifacts.
   - Maintain strict Zero-Overlap Lichess CSS Grid spatial rules (`min-width: 0; box-sizing: border-box;`, no freeform `position: absolute` layout shifts).
3. **QA Testability (< 15 Seconds via Existing 1-Click QA Scenario Presets):**
   - Immediately testable in under 15 seconds: open `http://localhost:5173`, click `6-Card 10s & Actions` (`qa-normal-6-actions`) so the active player's hand outline highlight is clearly visible, open the Theme menu in `HeaderBar`, and drag the Roundness slider from one end to the other to verify the hand outline highlight corners respond live.
4. **Unit & Component Tests:**
   - Add/update tests in `frontend/src/__tests__/GameTable.test.tsx` (and/or `frontend/src/__tests__/handPresentation.test.tsx`) verifying:
     - The hand outline highlight element/class binds its radius to the Theme Roundness CSS variable (not a static hardcoded pixel value).
     - Updating the Roundness setting via `settings.ts` / Theme controls updates the CSS variable read by the hand outline highlight across minimum, default, and maximum roundness values.

## Mandatory Acceptance Criteria Checklist
- [ ] **Verbatim Feedback (`ITEM-2` / `# New` #1):** "The highlight of the hand outline should also respond to the Roundness slider in the Theme menu."
- [ ] Wired end-to-end across `frontend/src/state/settings.ts`, `frontend/src/styles/table.css` (and `frontend/src/app.css` / `frontend/src/components/GameTable.tsx` where the hand outline highlight is rendered/styled).
- [ ] Both the hand outline and every active/prompted/turn/drag highlight layer (border, outline, glow, box-shadow, pseudo-elements, or SVG overlay) respond live to the Theme menu Roundness slider from 0 (sharp) to max (rounded) with no detached corner artifacts.
- [ ] Directly testable in under 15 seconds using existing QA Scenario Presets (e.g., `6-Card 10s & Actions`) + Theme menu Roundness slider.
- [ ] `cd frontend && npm test -- --run` passes with zero errors.
- [ ] Summary written to `.reviews/agent_notes.md`, no git commits made, and `echo "DONE" > .tickets/STATUS` executed only after all tests pass.
