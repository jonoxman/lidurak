<!-- WAVE:1 -->
# T-90-feedback-20261106_111512-2 — Frontend: icon-only Surrender & Pass buttons, remove "Throw In" button

## Context
The text buttons "Surrender" (currently bright red/crimson) and "Pass" become smaller icon-only buttons that match the theme. The "Throw In" button is removed.

Its replacement interactions (drag to outline, double-click, multi-select) are completed in Wave 3, ticket `-4-frontend-hand`. Single-card drag and double-click throw-in already exist and must keep working.

## Files owned by this ticket
- `frontend/src/components/ActionBar.tsx`: wherever Surrender, Pass and Throw In are rendered
- `frontend/src/components/GameTable.tsx`: **only** the Row 3 / Col 3 action cluster (`SortBar` + contextual button) markup, if that is where the buttons live
- `frontend/src/pages/GamePage.tsx`: **only** removing props or handlers wired exclusively to the Throw In *button*. **Keep** the underlying throw-in send function (e.g. `sendThrowIn(cards)`), because Wave 3 reuses it.
- New: `frontend/src/components/icons/SurrenderIcon.tsx`
- New: `frontend/src/components/icons/PassIcon.tsx`
- New: `frontend/src/styles/actionIcons.css` (import it from the component)
- Tests:
  - `frontend/src/__tests__/GameTable.test.tsx`
  - `frontend/src/__tests__/GamePage.test.tsx`
  - new `frontend/src/__tests__/ActionIcons.test.tsx`

**Do NOT touch:** `backend/`, `Card.tsx`, `TablePair.tsx`, the hand rendering, outlines, `table.css` card/hand sections, `README.md`, `ARCHITECTURE.md`, `play-local.sh`.

## Implementation Spec

### 1. Surrender icon (`SurrenderIcon.tsx`)
Inline SVG, `viewBox="0 0 32 32"`, `stroke="currentColor"`, stroke-width ≈ 1.6, round caps and joins, `fill="none"`. Light `currentColor` fills at ≤ 0.2 opacity are allowed for card faces.

Composition, top to bottom:
1. **Cards:** 2–3 small overlapping, slightly fanned rounded-rectangle playing cards in the upper third.
2. **Arrow:** a downward arrow (shaft + chevron head) pointing **from the cards down toward the hands**.
3. **Hands:** **two open hands raised in surrender**: palms facing the viewer, fingers up, placed symmetrically left and right, wrists at the bottom edge.

Root attributes: `aria-hidden="true"`, `data-icon="surrender-hands-cards"`.

### 2. Pass icon (`PassIcon.tsx`)
Same grid, stroke weight, palette and style as the Surrender icon.

Composition:
1. **Cards:** the same small card stack at the top.
2. **Arrow:** a horizontal or curved "skip / move on" arrow sweeping sideways (to the right) past the cards.
3. **Hand:** one flat hand, palm down, horizontal, in the classic card-table "wave-off / pass" gesture.

It must be clearly distinguishable from the Surrender icon at 32px.

Root attributes: `aria-hidden="true"`, `data-icon="pass-wave-cards"`.

### 3. Buttons
Both buttons:
- `data-testid="surrender-button"` / `data-testid="pass-button"`
- `aria-label="Surrender — take the cards"` / `aria-label="Pass — done throwing in"`, plus a matching `title` (hover tooltip only)
- **no visible text label**

Size:
- Desktop **40×40px**
- **32×32px** below the 900px breakpoint
- Both clearly smaller than the old text buttons
- border-radius 8px
- icon ≈ 70% of the button

Theme:
- Reuse the CSS variables and colors already used by `SortBar` buttons and table chrome (dark translucent felt background, the existing brass/ivory accent border and icon color).
- **No bright red.** Forbidden: `red`, `crimson`, `#dc2626`, `#ef4444`, or any similarly saturated red.
- Surrender may carry a *muted* warm accent (desaturated amber or terracotta) on hover or border.
- Pass may carry a muted emerald/sage accent that matches the throw-in outline's emerald.
- Hover: a subtle brighten. A `:focus-visible` ring. Disabled state at reduced opacity.

Visibility rules:
- Unchanged: Surrender appears only when it does today (the defender with uncovered pairs), and Pass only when it does today.

Position: Row 3, Col 3 of `[data-zone="table-arena"]`, **bottom-right corner of the table**.
- Use flex/grid only: `justify-self: end; align-self: end;` with `SortBar` above.
- **No `position: absolute/fixed`.**
- `min-width: 0; box-sizing: border-box`.

### 4. Remove "Throw In" button
- Delete the Throw In button and any props or state that only serve it.
- No element with the text or accessible name "Throw In" may remain anywhere in `GamePage`/`GameTable`/`ActionBar`.
- Existing drag-to-outline and double-click single-card throw-in must still work.
- Multi-card selection deploy is delivered in Wave 3.

### 5. Tests
- Update existing tests that query `getByText('Surrender')` / `getByText('Pass')` to use `getByRole('button', { name: /surrender/i })` / `{ name: /pass/i }` or the test ids.
- New tests:
  - Each button renders its SVG (`data-icon`) and has no visible text node.
  - It has an aria-label.
  - Clicking it dispatches the same action as before (`DeclareSurrender` / `PassTurn`).
  - `queryByRole('button', { name: /throw in/i })` is null in a throw-in state.
  - The button's class does not use the old red class or style.

## QA (human, < 15 s)
- **Surrender:** ⚡ QA Scenarios → `Surrender Half-Off` → the small themed icon button sits in the bottom-right corner of the table. Clicking it surrenders.
- **Pass:** after that surrender, switch POV to Alice in the left-sidebar PLAYERS panel → the Pass icon button appears in the same spot. There is no "Throw In" button.

## Mandatory Acceptance Criteria Checklist
- [ ] **New #5 (verbatim):** "Instead of the word "Surrender", the surrender button should be smaller and non-verbally communicate the action with an icon. Design the icon to be two hands, raised in surrender, underneath some cards with an arrow pointing from the cards down towards the hands. Keep the position of the surrender button in the bottom right corner of the game table. Adjust the button to fit the aesthetic of the current theme as the other game elements do, instead of being the current bright red."
  - [ ] Wired in `ActionBar.tsx` (or the Row 3 / Col 3 cluster in `GameTable.tsx`), rendered by `GamePage.tsx`. Dispatches `DeclareSurrender` through the existing action path.
- [ ] **New #6 (verbatim):** "Instead of the word "Pass", the pass button should be smaller and non-verbally communicate the action with an icon. Design the icon with a similar aesthetic to the above specification for the surrender button. Also make the other button adjustments in an analogous way."
  - [ ] Same location, size and theme rules as Surrender. Dispatches `PassTurn`.
- [ ] **New #4, button part (verbatim):** "Remove the "Throw In" button. Instead, cards can be thrown in by dragging them to the additional card outline or double clicking. To throw in multiple cards at once, the player can click to select multiple legal cards to throw in, and then double-click to deploy them all at once."
  - [ ] This ticket: the button is removed and the existing drag / double-click single throw-in still works. The multi-select part is in ticket `-4`.
- [ ] No absolute/fixed positioning, and no text banners added to the table.
- [ ] `npm test -- --run` passes.

## Workflow (AGENTS.md)
1. Run `git status` and `git diff` first.
2. No git commits, checkouts or branches.
3. Run `cd frontend && npm test -- --run` and fix all failures.
4. Write a summary to `.reviews/agent_notes.md`.
5. Final step only: `echo "DONE" > .tickets/STATUS`

