<!-- WAVE:1 -->
# Ticket T-90-feedback-20261103_152023-1-surrender-hand-highlight: Remove Red Hand Highlight for the Surrendering Player

## Summary
Ensure that a surrendering player never has a red highlight (or any turn-prompt glow) around their hand when they are the active user (`POV` viewer), because the purpose of hand/table highlights is solely to prompt a player to make a card move.

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-PREV-4 (Verbatim):** "Everything seems to work. One cosmetic chnage: the surrendering player should not have a red highlight around their hand when they are the active user (the purpose of the highlights is to prompt a player to make a move)."
- [ ] **End-to-End Frontend Wiring (`frontend/src/components/GameTable.tsx`, `frontend/src/pages/GamePage.tsx`, `frontend/src/styles/table.css`):**
  - Inspect how `[data-zone="player-hand"]` and its inner hand frame (`.hand-cards-frame` / `.player-hand` / `data-highlighted` / `data-turn-highlight` / `data-hand-highlight` / `data-surrendering` / `data-defenseless` or any danger/red glow class or attribute) are computed and styled in `frontend/src/components/GameTable.tsx` and `frontend/src/styles/table.css`.
  - When the active user (`view.myId`) is the surrendering player—both:
    1. During `BoutPhase.SurrenderThrowIn` when the viewer is the defender who surrendered (`defenderIdx` corresponds to `view.myId`), AND
    2. During `BoutPhase.Defense` when the viewer is the defender (`defenderIdx` corresponds to `view.myId`), including when the defender is defenseless (`view.defenderDefenseless === true` or `view.legalActions` contains `'surrender'` without `'cover'` or `'redirect'`) and/or while the 3-second auto-surrender countdown is running—
    the active user's hand container (`[data-zone="player-hand"]` and `.hand-cards-frame`) MUST NOT render a red highlight (or any hand border/box-shadow glow).
  - Remove or suppress any CSS rule or component state in `GameTable.tsx` / `table.css` that puts a red highlight around the active player's hand when surrendering or defenseless.
  - Keep existing valid highlights intact:
    - The pulsing green hand highlight around `.hand-cards-frame` remains active when the viewed player is prompted to play a card from their hand as an attacker/thrower (`InitialAttack` for the attacker, or when `'throwIn'` is in `view.legalActions` for a non-defender).
    - When the viewed player is defending and has legal `'cover'` or `'redirect'` moves in `BoutPhase.Defense`, the uncovered attacking cards on the table (`TablePair.tsx` / `.table-pair`) keep their defensive prompt highlight, and legal hand cards continue to lift, without applying any red highlight around the hand container itself.
- [ ] **15-Second QA Testability via Existing 1-Click Presets (`Surrender Half-Off` & `Defenseless Auto-Surrender`):**
  - Verify that clicking `Surrender Half-Off` or `Defenseless Auto-Surrender` in the `⚡ QA Scenarios` panel (`LobbyPage.tsx` / `GamePage.tsx`, wired to `POST /api/games/preset` in `GameRoutes.scala` and `GameManager.scala`) opens on **Bob (`p1`)** and shows **zero red highlight** around Bob's hand both during the 3-second auto-surrender countdown (`BoutPhase.Defense`) and after Bob surrenders (`BoutPhase.SurrenderThrowIn`).
  - Switching `POV` to **Alice (`p0`)** during `BoutPhase.SurrenderThrowIn` in `Surrender Half-Off` still shows the normal active-turn hand highlight on Alice's hand because Alice has a legal `7♥` throw-in move to make, while switching back to **Bob (`p1`)** shows no highlight around Bob's hand.
- [ ] **Automated Tests (`frontend/src/__tests__/GameTable.test.tsx` and/or `frontend/src/__tests__/GamePage.test.tsx`):**
  - Add or update unit/integration tests asserting that:
    1. When the active viewer is the surrendering defender in `BoutPhase.SurrenderThrowIn`, `.hand-cards-frame` / `[data-zone="player-hand"]` is NOT highlighted (`data-highlighted="false"`, no red/surrender/danger highlight class or style).
    2. When the active viewer is a defenseless defender in `BoutPhase.Defense` (`legalActions: ['surrender']`, `defenderDefenseless: true`), `.hand-cards-frame` / `[data-zone="player-hand"]` has no red highlight around the hand.
    3. An attacker during `InitialAttack` and an eligible thrower with `legalActions: ['throwIn', 'pass']` during `SurrenderThrowIn` still receive the hand highlight prompting them to make a move.
  - Run `cd frontend && npm test -- --run` and ensure all tests pass with zero warnings or errors.
