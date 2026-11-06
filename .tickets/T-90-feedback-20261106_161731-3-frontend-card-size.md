<!-- WAVE:1 -->
# T-90-feedback-20261106_161731-3 — Frontend: Playing Cards Match Outline Size (Single Card-Size Token)

## Wave
WAVE 1. Runs in parallel with T-1 and T-2. Wave 2 (T-4 hand layout) depends on the tokens created here.

## Files Owned by This Ticket
- `frontend/src/components/Card.tsx`, `frontend/src/components/CardBack.tsx`, `frontend/src/components/TablePair.tsx`
- `frontend/src/styles/table.css` (**card-dimension rules and the bout/deck row sizing only**; do not restructure the hand zone, which T-4 will do)
- `frontend/src/components/GameTable.tsx` (**only** to replace hardcoded card width/height constants with the shared token; no other changes)
- `frontend/src/__tests__/Card.test.tsx`, `frontend/src/__tests__/GameTable.test.tsx` (size assertions)

## Do NOT Touch
`ActionBar.tsx`, icons, `actionIcons.css`, backend, `GamePage.tsx` / `LobbyPage.tsx` (except when unavoidable for sizing, which you must explain in your notes), `README.md`, `ARCHITECTURE.md`, `play-local.sh`.

## Context
The previous round locked the throw-in outline (`[data-testid="throw-in-outline"]`) and the redirect outline (`[data-testid="redirect-outline"]`) to **100px × 140px** on desktop (`flex: 0 0 100px; box-sizing: border-box`) and **48px × 68px** below the `900px` breakpoint. The actual card faces render much smaller. Cards must grow to the outline size. The outlines must not shrink.

## Implementation Spec
1. Create one source of truth:
   - CSS custom properties on the table root (`[data-zone="table-arena"]` or `.game-table`): `--card-w: 100px; --card-h: 140px; --card-radius: <current outline radius>;` and, inside `@media (max-width: 899px)`, `--card-w: 48px; --card-h: 68px;`.
   - A TS export in `Card.tsx`: `export const CARD_SIZE = { desktop: { w: 100, h: 140 }, mobile: { w: 48, h: 68 } }`. Also export `CARD_INDEX_WIDTH_RATIO` and `CARD_INDEX_HEIGHT_RATIO`: the fraction of card width/height taken up by the top-left rank+suit corner index, plus about 4px padding. T-4 will use these to compute maximum overlap.
2. Every **face-up and face-down playing card on the table** uses `width: var(--card-w); height: var(--card-h); flex: 0 0 var(--card-w); box-sizing: border-box; border-radius: var(--card-radius)`. That means:
   - hand cards in `[data-zone="player-hand"]`
   - bout attack and defense cards (`TablePair.tsx`)
   - the trump card and talon in `[data-zone="table-deck"]`
   - cards in the surrender half-off row
   - `Card` keeps `data-card-width` / `data-card-height` attributes that reflect the active size (100/140, or 48/68 on mobile).
   - **Excluded:** small opponent-seat card-count backs in row 1 and the transparent-mode reveal minis may stay compact.
3. The throw-in outline, redirect outline and defender target outlines (`target-outline-<id>`) consume the same `--card-w`/`--card-h`/`--card-radius` tokens, so cards and outlines are always pixel-identical.
4. Scale the card face content: rank/suit corner index and center pip/face glyphs grow proportionally with the card size (use `em`/`calc(var(--card-w) * k)`). The text must stay crisp and readable at both sizes.
5. Make the layout fit: row 2 (bout) and row 3 (deck / hand / `SortBar`) of the 3×3 grid must grow to fit 140px cards, including the covered-pair vertical stagger. Rows must not overlap each other. Grid rows use `auto`/`minmax(...)`, every grid child has `min-width: 0; box-sizing: border-box`, and spacing uses `gap`. No `position: absolute/fixed` to place zones. Do not change the hand's overlap algorithm here (that is T-4). Just make sure the hand cards render at the new size and the hand container does not overflow its column. Temporary horizontal scrolling inside the hand column is acceptable until T-4 lands.

## How the Human Tests It (under 15 seconds)
- Click **"Surrender Half-Off"** in "⚡ QA Scenarios". `7♠` on the felt is exactly the same size as the dashed emerald throw-in outline beside it. Bob's hand cards are the same size too.
- Click **"3P Redirect (Bob POV)"** (`3p-redirect-bob`). The redirect outline and the attack card are identical in size.

## Tests
- `Card.test.tsx`: `data-card-width="100"` / `data-card-height="140"` by default. The exported constants are correct.
- `GameTable.test.tsx`: hand cards, bout cards, the trump card, `throw-in-outline` and `redirect-outline` all share the same size class/token (`--card-w` / `--card-h`). Parse `table.css` (same approach as `tableTextures.test.ts`) to assert that the outline rules and the card rules reference the same variables, and that the mobile media query sets 48/68.
- Run `cd frontend && npm test -- --run`. Everything must pass.

## Mandatory Acceptance Criteria Checklist
- [ ] **(QA Playbook Item #2, verbatim):** "Currently, the throw-in and redirect outlines match in size, while the actual cards are substantially smaller. Ensure that the cards are also the (larger) size of the outlines."
  - [ ] Hand cards (`[data-zone="player-hand"]`), bout cards (`TablePair.tsx`), the trump/talon (`[data-zone="table-deck"]`) and surrender half-off cards render at 100×140px on desktop and 48×68px on mobile.
  - [ ] `throw-in-outline`, `redirect-outline` and `target-outline-<id>` keep their 100×140 / 48×68 size and share the same tokens as the cards.
  - [ ] Card face glyphs scale proportionally and stay readable.
  - [ ] Grid rows grow to fit. No zone overlap. No absolute positioning.
  - [ ] `CARD_SIZE`, `CARD_INDEX_WIDTH_RATIO` and `CARD_INDEX_HEIGHT_RATIO` are exported for T-4.
- [ ] `npm test -- --run` passes.

## Agent Workflow Reminders
1. Start with `git status` and `git diff`.
2. No `git commit`, `git checkout` or `git branch`.
3. Write a summary to `.reviews/agent_notes.md`, including the token names and exported constants.
4. Final step, only after all tests pass: `echo "DONE" > .tickets/STATUS`

