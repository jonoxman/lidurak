<!-- WAVE:1 -->
# T-90-feedback-20261106_161731-2 — Frontend: Icon-Only Surrender & Pass Buttons (Themed, Compact, Bottom-Right)

## Wave
WAVE 1. Runs in parallel with T-1 (backend) and T-3 (card size). No shared files.

## Files Owned by This Ticket
- `frontend/src/components/icons/SurrenderIcon.tsx` (already exists: redesign to the spec below)
- `frontend/src/components/icons/PassIcon.tsx` (already exists: redesign to the spec below)
- `frontend/src/components/ActionBar.tsx` (renders the contextual Surrender / Pass button in `[data-zone="table-arena"]` row 3, column 3, next to `SortBar`)
- `frontend/src/styles/actionIcons.css`
- `frontend/src/__tests__/ActionIcons.test.tsx`

## Do NOT Touch
`GameTable.tsx`, `GamePage.tsx`, `table.css`, `Card.tsx`, backend, `README.md`, `ARCHITECTURE.md`, `play-local.sh`. Do **not** remove the "Throw In" button in this ticket; T-5 (Wave 3) does that. If the Surrender/Pass buttons are currently rendered from `GameTable.tsx` instead of `ActionBar.tsx`, move only the button markup into `ActionBar.tsx` (or a new `ActionIconButton.tsx`) and leave a one-line usage in `GameTable.tsx`. Record this in `agent_notes.md`.

## Implementation Spec

### Shared button style (`actionIcons.css`)
- Class: `.action-icon-button`. Size **44×44px** on desktop and **34×34px** below the `900px` breakpoint. Both are much smaller than the current text buttons.
- Shape: rounded square (`border-radius: 10px`), `box-sizing: border-box`, `display: inline-flex`, centered icon, `flex: 0 0 auto`.
- Theme: match the dark felt table (`#1e2923`) and the other game elements. Use a dark felt-tone background (for example `rgba(0,0,0,0.28)` over felt, or the panel token already in use), a 1–2px border, and an icon color in the existing muted cream/gold accent tokens used by `SortBar` and the outlines. **No bright red background, border or icon** (remove any `#ff…`/crimson/`red` values from these buttons).
- States: `:hover` brightens the border and icon slightly; `:focus-visible` shows a theme-colored ring; `:disabled` uses reduced opacity. Optional: surrender uses a subtle warm (desaturated amber/rust) accent on hover only, but it must still read as part of the theme.
- Placement: stays in `[data-zone="table-arena"]` row 3, column 3 (bottom-right of the game table) inside the existing flex container with `SortBar`, using `gap` spacing. **No `position: absolute/fixed`.** Use `min-width: 0` on its container.

### Surrender icon (`SurrenderIcon.tsx`)
- Inline SVG, `viewBox="0 0 48 48"`, strokes and fills use `currentColor`, `aria-hidden="true"`.
- Composition, top to bottom:
  1. **A small fan of 2–3 playing cards** at the top (rounded rectangles, slightly rotated, overlapping).
  2. **An arrow pointing down** from the cards toward the hands.
  3. **Two open hands raised in surrender** at the bottom (palms facing out, fingers up, one left and one right, mirrored).
- Must read clearly at 34px and 44px. Use stroke width around 2 at viewBox scale.
- Mark the root with `data-icon="surrender"`.

### Pass icon (`PassIcon.tsx`)
- Same visual language as the surrender icon: `viewBox="0 0 48 48"`, `currentColor`, same stroke weight, the same card-fan motif, and a hand.
- Composition: **a small card fan at the top, one open hand below it held palm-down/flat in a "wave-off / I'm done" gesture, and a curved arrow sweeping sideways (left to right) away from the cards**. The meaning is "pass the turn along" and must be clearly different from surrender's downward arrow into two raised hands.
- Mark the root with `data-icon="pass"`.

### Button markup (`ActionBar.tsx`)
- Replace the visible words "Surrender" and "Pass" with the icons. **No visible text label.**
- Accessibility: `aria-label="Surrender"` / `aria-label="Pass"` and `title` tooltips of the same text. Keep the existing `data-testid` values the tests and QA playbooks rely on (for example the current surrender and pass button test IDs). Add `data-action-icon="surrender"` / `"pass"`.
- Keep the existing visibility logic exactly as it is (surrender shows when the viewer is the defender and surrender is legal; pass shows when pass is legal) and keep the existing click handlers and dispatch.

## How the Human Tests It (under 15 seconds)
- Click **"Surrender Half-Off"** (`surrender-half-off`) in "⚡ QA Scenarios". As "Bob (You)", the small themed surrender icon button sits in the bottom-right of the table. Click it and the surrender happens.
- Switch POV to Alice in the left-sidebar PLAYERS panel. The small themed pass icon button shows in the same bottom-right spot.

## Tests
- `ActionIcons.test.tsx`:
  - each icon renders an SVG with `data-icon`
  - the buttons have no visible text "Surrender" or "Pass" (`queryByText` returns null), but `getByRole('button', {name: 'Surrender'})` and `{name: 'Pass'}` both work
  - clicks fire the existing handlers
  - the button has class `.action-icon-button`
- A CSS assertion (parse `actionIcons.css` like `tableTextures.test.ts` does, or use computed styles): no `red`/`crimson`/`#ff0000`/`#dc2626`-type values in `.action-icon-button` rules, and width/height are 44px and 34px.
- Run `cd frontend && npm test -- --run`. Everything must pass.

## Mandatory Acceptance Criteria Checklist
- [ ] **(New Item #5, verbatim):** "Instead of the word "Surrender", the surrender button should be smaller and non-verbally communicate the action with an icon. Design the icon to be two hands, raised in surrender, underneath some cards with an arrow pointing from the cards down towards the hands. Keep the position of the surrender button in the bottom right corner of the game table. Adjust the button to fit the aesthetic of the current theme as the other game elements do, instead of being the current bright red."
  - [ ] The word "Surrender" is no longer visible. The button is icon-only, 44px on desktop and 34px on mobile.
  - [ ] The icon shows two raised open hands below a card fan, with a downward arrow from the cards to the hands.
  - [ ] The button stays in `[data-zone="table-arena"]` row 3, column 3 (bottom-right), wired through `ActionBar.tsx`.
  - [ ] Styled with the felt theme tokens. No bright red.
- [ ] **(New Item #6, verbatim):** "Instead of the word "Pass", the pass button should be smaller and non-verbally communicate the action with an icon. Design the icon with a similar aesthetic to the above specification for the surrender button. Also make the other button adjustments in an analogous way."
  - [ ] The word "Pass" is no longer visible. The button is icon-only and the same size as the surrender button.
  - [ ] The pass icon shares the card-fan and hand visual language, with a sideways sweeping arrow.
  - [ ] Same bottom-right placement, same themed styling, same hover/focus/disabled states as surrender.
- [ ] Accessible names `Surrender` and `Pass` are present. Existing `data-testid`s are preserved.
- [ ] No `position: absolute/fixed`. Uses flex with `gap`.
- [ ] `npm test -- --run` passes.

## Agent Workflow Reminders
1. Start with `git status` and `git diff`. The icon files already exist, so resume rather than recreate.
2. No `git commit`, `git checkout` or `git branch`.
3. Write a summary to `.reviews/agent_notes.md`.
4. Final step, only after all tests pass: `echo "DONE" > .tickets/STATUS`

