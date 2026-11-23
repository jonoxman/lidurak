<!-- WAVE:2 -->
# T-90-feedback-20261106_111512-3 — Frontend: throw-in outline visibility, full-size cards, drag-visibility bug, QA preset entries

## Dependencies
Wave 1 must be done first:
- `-1-backend` provides `throwInCards` / `throwInCapacity` / `canThrowIn` and 4 new presets.
- `-2-frontend-action-icons` provides the icon buttons.

## Files owned by this ticket
- `frontend/src/types.ts`: add `throwInCards: Card[]`, `throwInCapacity: number`, `canThrowIn: boolean` to the game view type (optional, default to empty / 0 / false when absent)
- `frontend/src/components/GameTable.tsx`: outlines (`throw-in-outline`, `surrender-throw-in-anchor`, `redirect-outline`, `target-outline-<id>`), bout rendering, and hand-card drag handlers
- `frontend/src/components/TablePair.tsx`, `frontend/src/components/Card.tsx`, `frontend/src/components/CardBack.tsx` (if used for sizing)
- `frontend/src/styles/table.css`: card-size tokens, bout row, outline styles
- `frontend/src/app.css`: only if card sizing lives there
- `frontend/src/pages/LobbyPage.tsx` and the left-sidebar ⚡ QA Scenarios panel in `frontend/src/pages/GamePage.tsx`: preset entries only
- Tests:
  - `frontend/src/__tests__/GameTable.test.tsx`
  - `frontend/src/__tests__/Card.test.tsx`
  - `frontend/src/__tests__/LobbyPage.test.tsx`
  - `frontend/src/__tests__/GamePage.test.tsx`
  - `frontend/src/__tests__/types.test.ts`

**Do NOT touch:** `backend/`, the action icon components, the hand overlap/outline layout (that is Wave 3), `README.md`, `ARCHITECTURE.md`, `play-local.sh`.

## Implementation Spec

### 1. Throw-in outline visibility (QA #1)
In `GameTable.tsx`, render `[data-testid="throw-in-outline"]` **only when `view.canThrowIn === true`** for the current POV viewer. In hotseat, this is the selected player in the PLAYERS panel.
- Replace any existing client-side heuristic. The backend field is the single source of truth.
- A missing field means hidden.
- This applies to every position: `data-surrender-outline-position="inline" | "above" | "below"`.
- When hidden:
  - The outline element is **not in the DOM**, and there is no drop target.
  - `surrender-throw-in-anchor` may keep an empty card-sized spacer with `visibility: hidden`, `aria-hidden="true"`, `data-outline-hidden="true"` and no handlers, so the half-off taken cards do not jump.
- Switching POV re-evaluates the condition immediately.
- `redirect-outline` and `target-outline-<id>` logic is unchanged.

### 2. Cards are the same (larger) size as the outlines (QA #2)
- Define one source of truth in `table.css`:
  - `:root { --card-w: 100px; --card-h: 140px; --card-radius: <current outline radius>; }`
  - `@media (max-width: 899px) { --card-w: 48px; --card-h: 68px; }`
- Use these variables for:
  - attack and defense cards in `TablePair.tsx`
  - surrender taken (half-off) cards
  - the active player's hand cards
  - `throw-in-outline`, `redirect-outline` and `target-outline-<id>`

  The talon, trump card and opponent seat backs may keep their current size.
- **Find and remove the real cause of the visual shrink.** The previous round reported `data-card-width="100"` while the rendered cards were visibly smaller. Check for:
  - an inner face or SVG with a fixed smaller px size, or no `width/height: 100%`
  - `transform: scale(<1)` / `zoom` on cards, pairs or the battlefield
  - `flex-shrink`/`max-width`/padding compressing the face
- The **visible face** must fill exactly `var(--card-w) × var(--card-h)`.
- The bout row in Row 2 must never shrink cards to fit.
  - Use `flex-wrap: wrap` with a `gap` so up to 6 covered pairs wrap onto a second line.
  - Covered pairs keep their defense offset inside a container sized to the card plus that offset.
- Keep the `data-card-width`/`data-card-height` attributes, but make them reflect the token values.

### 3. Dragging a card must not make it invisible (New #2)
- Remove anything that hides the source card during drag: `opacity: 0`, `visibility: hidden`, `display: none`, a `.dragging` hide class, or unmounting the card.
- The source card stays rendered in the hand at full visibility for the whole drag.
- Drag preview:
  - **HTML5 DnD:** call `e.dataTransfer.setDragImage(<the rendered, painted card element>, offsetX, offsetY)` synchronously in `onDragStart`, **before** any state update that re-renders. Never pass an unmounted or off-DOM element.
  - **Pointer-based drag:** the moving card must not be clipped by `overflow: hidden` on ancestors or hidden behind the felt by z-index.
  - Touch drag must also show the card.
- Overlap rules between hand cards still apply.

### 4. ⚡ QA Scenarios entries (LobbyPage + left sidebar of GamePage)
If the preset list is hard-coded on the frontend, add one-click entries. If it is fetched from the backend, just verify they appear.

| Label | Preset id |
|---|---|
| `Throw-In Visibility (4P)` | `throw-in-visibility-4p` |
| `Throw-In Capacity Cap` | `throw-in-capacity-cap` |
| `Huge Hand (36)` | `huge-hand-36` |
| `Huge Hand (52)` | `huge-hand-52` |

## Required Tests
- `throw-in-outline` renders when `canThrowIn` is true. It is absent when false, in each of these cases:
  - a defender view
  - a view with `myHasPassed`
  - a view with empty `throwInCards`
  - all three surrender positions
- `Card` and `TablePair`: the card root uses `var(--card-w)`/`var(--card-h)`. The face child is `100%`. There is no scale transform class.
- A CSS assertion (reading `table.css` as text, like `tableTextures.test.ts`): the outline and card selectors reference the same tokens.
- Drag: `fireEvent.dragStart` on a hand card → the card stays in the document with no hidden style or class, and `setDragImage` is called with a card element.
- Lobby and sidebar list the 4 new presets, and clicking one calls the preset API with the right id.

## QA (human, < 15 s)
1. ⚡ `Throw-In Visibility (4P)`: as Alice, the emerald outline is visible. Switch POV to Bob (defender), Carol (no 7/9) and Dave (passed): the outline is hidden for each.
2. ⚡ `Surrender Half-Off`: `7♠` is exactly the size of the dashed outline next to it.
3. Drag any hand card: it stays visible the whole time.

## Mandatory Acceptance Criteria Checklist
- [ ] **QA Playbook #1 (verbatim):** "It works, but make the following adjustment: the additional card outline should only be visible to players that can legally play into it. In other words, it should not be visible if a player has no valid cards to throw in, is the defending player, or has already input a pass command."
  - [ ] Wired in `GameTable.tsx` (`throw-in-outline`, including inside `surrender-throw-in-anchor`), gated by `view.canThrowIn` from the backend `PlayerGameView.forViewer`. Updates on hotseat POV switch in `GamePage.tsx`.
- [ ] **QA Playbook #2 (verbatim):** "Currently, the throw-in and redirect outlines match in size, while the actual cards are substantially smaller. Ensure that the cards are also the (larger) size of the outlines."
  - [ ] Bout cards (`TablePair.tsx`/`Card.tsx`), taken cards and hand cards render visibly at `--card-w × --card-h` (100×140 desktop, 48×68 mobile), the same size as the `throw-in-outline` / `redirect-outline` / `target-outline-<id>` outlines.
- [ ] **New #2 (verbatim):** "Bug: Clicking and dragging a card makes it invisible. Cards should be displayed at all times (aside from overlap rules as we have defined), regardless of if they are bing dragged or not."
  - [ ] Fixed in the hand drag handlers in `GameTable.tsx` / `Card.tsx`.
- [ ] The 4 new QA presets can be launched in 1 click from `LobbyPage.tsx` and the `GamePage.tsx` left sidebar.
- [ ] No absolute/fixed layout positioning. Zero table text clutter.
- [ ] `npm test -- --run` passes.

## Workflow (AGENTS.md)
1. Run `git status` and `git diff` first.
2. No git commits, checkouts or branches.
3. Run `cd frontend && npm test -- --run` and fix all failures.
4. Write a summary to `.reviews/agent_notes.md`, including the root cause of the card shrink and of the drag invisibility.
5. Final step only: `echo "DONE" > .tickets/STATUS`

