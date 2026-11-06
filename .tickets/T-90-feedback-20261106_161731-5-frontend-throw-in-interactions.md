<!-- WAVE:3 -->
# T-90-feedback-20261106_161731-5 — Frontend: Throw-In Outline Visibility Gating, Throw In Button Removal, Drag / Double-Click / Multi-Select Throw-In

## Wave
WAVE 3. Depends on T-1 (`canThrowIn`, multi-card `ThrowInCards`, presets), T-2 (`ActionBar.tsx` icon buttons) and T-4 (`PlayerHand.tsx`, `handLayout.ts`, drag fix). Runs in parallel with T-6 (docs only).

## Files Owned by This Ticket
- `frontend/src/components/GameTable.tsx`: throw-in outline rendering and gating (inline, surrender `above`, surrender `below`), drop target wiring
- `frontend/src/components/PlayerHand.tsx`: click-select, double-click deploy, selected state
- `frontend/src/components/ActionBar.tsx`: **remove the Throw In button** (keep the T-2 icon Surrender/Pass buttons untouched)
- `frontend/src/pages/GamePage.tsx`: dispatch of `ThrowInCards` with N cards via `frontend/src/api/websocket.ts` / `client.ts`; clearing selection on POV switch
- `frontend/src/types.ts` (only if the view/action types need `canThrowIn` or `cards: Card[]`)
- `frontend/src/styles/table.css`: selected-card style only
- Tests: `GameTable.test.tsx`, `GamePage.test.tsx`, plus a new `ThrowInInteractions.test.tsx` if you prefer

## Do NOT Touch
Backend, icons, `actionIcons.css`, `handLayout.ts` math (only pass `raised` flags in), `README.md`, `ARCHITECTURE.md`, `play-local.sh`.

## Implementation Spec

### A. Outline visibility (QA Playbook #1)
- Render `[data-testid="throw-in-outline"]` in **all** positions (`data-surrender-outline-position="inline" | "above" | "below"`, including inside `[data-testid="surrender-throw-in-anchor"]`) **only when `view.canThrowIn === true`** for the current POV. That flag comes from the backend `PlayerGameView` (T-1).
- That means it is hidden for:
  - the defender
  - a player with no legal throw-in cards
  - a player who has passed (`myHasPassed`)
  - capacity 0, game over, or replay/review mode
- Do not re-derive eligibility on the client. Use the server flag only (a defensive `&& !view.myHasPassed` guard is fine).
- When the outline is hidden, do not reserve a blank card-sized gap for it. The bout row closes up using `gap`.
- In hotseat, switching POV with the left-sidebar PLAYERS tabs immediately shows or hides the outline per seat.
- The redirect outline (`redirect-outline`) and target outlines are unchanged.

### B. Remove the Throw In button (New #4)
- Delete the "Throw In" button from `ActionBar.tsx`, `GameTable.tsx`, or wherever it renders, along with its CSS and tests. No replacement text appears anywhere (Zero Table Text Clutter rule).

### C. Throw-in interactions (New #4), only when `view.canThrowIn`
- **Legal cards** = the `view.throwInCards` intersected with the hand. Illegal cards ignore throw-in clicks, double-clicks and drops onto the outline. When they can't be thrown in, they also must not be raised as playable.
- **Drag to outline:** dropping a legal card on `throw-in-outline` dispatches `ThrowInCards(myId, [card])`. If the dragged card is part of the current multi-selection, dispatch the **whole selection** instead. If not, dispatch only the dragged card and clear the selection.
- **Single click:** toggles selection of a legal card. A selected card gets `data-selected="true"`, an emerald glow, and an extra raise passed to `PlayerHand` through `raised`, so the T-4 outline follows it. Selection is capped at `view.throwInCapacity`; clicks past the cap are ignored. Ignore clicks with `event.detail >= 2` so a double-click doesn't flicker the selection.
- **Double-click** on a legal card: dispatch `ThrowInCards(myId, unique(selected ∪ {card}))`, truncated to capacity, in hand order. A double-click with no selection throws in that one card.
- Clear the selection on: successful dispatch, phase change, POV switch, pass, a server update that makes a selected card illegal, and game over.
- Wire the dispatch in `GamePage.tsx` through the existing WebSocket action sender, sending one action with the full `cards` array (T-1 makes the backend accept it atomically).
- Existing click/drag behavior for initial attack, cover and redirect must keep working unchanged. Throw-in selection applies only when the viewer is not the defender and `view.canThrowIn` is true.
- Do not show any text hints, banners or error strings on the table.

### D. QA presets (from T-1). Make sure all are reachable in 1 click from "⚡ QA Scenarios" (Lobby and left sidebar)
- **`throw-in-visibility-3p`**: Alice sees the outline. Switch to Bob (defender): no outline. Switch to Carol (no valid cards): no outline. Back to Alice, press the Pass icon: the outline disappears.
- **`multi-throw-in`**: Alice clicks `7♥` and `7♦`, then double-clicks `7♣`. All three land at once. Also: let Bob surrender, then multi throw-in during the surrender phase.

## How the Human Tests It (under 15 seconds)
1. Click "Throw-In Visibility (3P)". The outline is visible as Alice. Switch to Bob or Carol: no outline. As Alice, click Pass: the outline disappears.
2. Click "Multi Throw-In". There is no Throw In button anywhere. Click `7♥` and `7♦` (they lift and glow, and the hand outline follows), then double-click `7♣`: all three are thrown in at once. Also try dragging one 7 onto the dashed outline, and double-clicking a single 7.

## Tests
- `GameTable.test.tsx`:
  - the outline is absent when `canThrowIn` is false (defender, passed and no-card fixtures) and present when true, in the inline, above and below positions
  - no element has the text or role name "Throw In"
- Interaction tests:
  - drop on the outline dispatches 1 card
  - drop of a selected card dispatches the whole selection
  - click, click, double-click dispatches 3 cards in one action
  - the selection cap is respected
  - illegal-card clicks are ignored
  - the selection clears on POV switch
  - `data-selected` toggles
  - attack, cover and redirect behavior is unchanged
- `GamePage.test.tsx`: the WebSocket send payload contains `ThrowInCards` with the full `cards` array.
- Run `cd frontend && npm test -- --run`. Everything must pass. Also run `cd backend && sbt -batch test` to confirm the backend still passes end to end.

## Mandatory Acceptance Criteria Checklist
- [ ] **(QA Playbook Item #1, verbatim):** "It works, but make the following adjustment: the additional card outline should only be visible to players that can legally play into it. In other words, it should not be visible if a player has no valid cards to throw in, is the defending player, or has already input a pass command."
  - [ ] `throw-in-outline` is gated on `view.canThrowIn` in `GameTable.tsx` for the inline, above and below positions.
  - [ ] Hidden for players with no valid cards.
  - [ ] Hidden for the defender.
  - [ ] Hidden after a pass.
  - [ ] Updates live when switching hotseat POV.
- [ ] **(New Item #4, verbatim):** "Remove the "Throw In" button. Instead, cards can be thrown in by dragging them to the additional card outline or double clicking. To throw in multiple cards at once, the player can click to select multiple legal cards to throw in, and then double-click to deploy them all at once."
  - [ ] The Throw In button is removed from `ActionBar.tsx` / `GameTable.tsx` along with its CSS and tests.
  - [ ] Dragging onto `throw-in-outline` throws in.
  - [ ] Double-clicking a legal card throws it in.
  - [ ] Clicking to select several legal cards, then double-clicking, deploys them all in one `ThrowInCards` action, dispatched from `GamePage.tsx`.
  - [ ] Selected cards lift and the T-4 hand outline follows them.
- [ ] The 1-click presets `throw-in-visibility-3p` and `multi-throw-in` are reachable from the Lobby and the left sidebar.
- [ ] No table text banners. No absolute positioning.
- [ ] `npm test -- --run` and `sbt -batch test` pass.

## Agent Workflow Reminders
1. Start with `git status` and `git diff`.
2. No `git commit`, `git checkout` or `git branch`.
3. Write a summary to `.reviews/agent_notes.md`.
4. Final step, only after all tests pass: `echo "DONE" > .tickets/STATUS`

