<!-- WAVE:1 -->
# T-90-2: Restore Red Hand Glow Before Surrender Is Declared and Remove Only Once Surrender Is Pressed or Auto-Fires

## Summary
In the previous round, the red/crimson hand highlight on the active defender's hand was removed across all of `BoutPhase.Defense` (including before the defender decided to surrender and during the `3 → 2 → 1` auto-surrender countdown). The user clarified in `<resolved_human_feedback>`:
> *"Previous-4. The red glow should still appear before the decision to surrender is made (even if there are no legal moves, it should display until the surrender button is pressed or "presses itself"."*

This ticket updates `frontend/src/components/GameTable.tsx`, `frontend/src/pages/GamePage.tsx`, and `frontend/src/styles/table.css` so that:
1. **Before the decision to surrender is made** (i.e., while `boutPhase === 'Defense'` and the active player is the defender facing one or more uncovered attacking cards, **even when they have no legal cover/redirect moves and the `Surrender 3 → 2 → 1` countdown is ticking**), the **red glow around the defender's hand** (`[data-zone="player-hand"]` / `.hand-cards`) **MUST appear** (`data-highlighted="true"`, `data-highlight-role="defender"` / red defending glow).
2. **Once the Surrender button is pressed manually OR "presses itself" automatically** (when the 3-second countdown fires `DeclareSurrender` or the bout transitions into `BoutPhase.SurrenderThrowIn`), the red glow around the surrendering player's hand **immediately disappears** (`data-highlighted="false"`, `data-surrendering="true"`).

## Scope & Files to Touch
- `frontend/src/components/GameTable.tsx`
- `frontend/src/pages/GamePage.tsx`
- `frontend/src/styles/table.css`
- `frontend/src/__tests__/GameTable.test.tsx`
- `frontend/src/__tests__/GamePage.test.tsx`

*(Do NOT touch `Card.tsx`, `Card.test.tsx`, `app.css`, or backend files in this ticket.)*

## Technical Implementation Details

### 1. Defender Hand Red Glow State Machine (`GameTable.tsx` & `GamePage.tsx`)
- Inspect how `isHandHighlighted`, `isDefenselessDefender`, `isSurrenderingDefender`, and `surrenderSubmitted` / `onAction` are computed in `frontend/src/components/GameTable.tsx` (and any props passed from `frontend/src/pages/GamePage.tsx`):
  - **When the active player is the defender in `BoutPhase.Defense` facing uncovered attacking cards (`hasUncoveredAttacks`) and has NOT yet pressed `Surrender` (and the auto-surrender timer has not yet fired):**
    - Even if `legalActions` only contains `'surrender'` (no `'cover'` and no `'redirect'`, i.e., `data-defenseless="true"` while the `3 → 2 → 1` countdown is running), the decision to surrender has **not** yet been made/executed.
    - Therefore, `[data-zone="player-hand"]` and `.hand-cards` MUST set:
      - `data-highlighted="true"`
      - `data-highlight-variant="defender"` (or `data-role="defender"` / `.hand-cards--defender` so it renders the **red glow** around the defender's hand, distinct from the attacker/throw-in glow)
      - `data-surrendering="false"`
  - **When the Surrender button is pressed manually by the user OR "presses itself" when the 3-second auto-surrender countdown reaches 0 (and throughout `BoutPhase.SurrenderThrowIn` when the active player is the defender):**
    - Track a local latch (e.g., `hasTriggeredSurrender` in `GameTable.tsx` / `GamePage.tsx`, set to `true` immediately when the user clicks `[data-testid="surrender-button"]` or when the `CLIENT_AUTO_SURRENDER_DELAY_MS` timer fires `DeclareSurrender`, and reset when a new bout begins or `boutPhase !== 'Defense'`).
    - Also whenever `boutPhase === 'SurrenderThrowIn'` and `isDefender` is true, the defender has already surrendered.
    - In both cases (immediately upon button press / auto-press AND throughout `BoutPhase.SurrenderThrowIn`), `[data-zone="player-hand"]` and `.hand-cards` MUST set:
      - `data-highlighted="false"`
      - `data-surrendering="true"`
      - And remove all red/crimson border, outline, and box-shadow glow from the surrendering player's hand!
  - **When the active player is an attacker or eligible throw-in player (`initialAttack` or `throwIn` in `legalActions`):**
    - Keep `data-highlighted="true"` (with the normal attacker/throw-in glow) as before.
  - **Bot lock & Replay / GameOver:**
    - When `isBot` is true (`data-bot-locked="true"`), or in replay mode / `BoutPhase.GameOver`, `data-highlighted="false"` as before.

### 2. Red Glow Styling on the Defender's Hand Before Surrender (`frontend/src/styles/table.css`)
- Ensure `frontend/src/styles/table.css` defines a clear, pulsing **red glow** on `.hand-cards[data-highlighted="true"][data-highlight-variant="defender"]` (and/or `[data-zone="player-hand"][data-highlighted="true"][data-highlight-variant="defender"]` depending on where the tight 4px hand-glow box is drawn) while `data-surrendering="false"`.
- Ensure that when `data-highlighted="false"` or `data-surrendering="true"` (i.e. after `Surrender` is pressed or presses itself into `SurrenderThrowIn`), `.hand-cards` and `[data-zone="player-hand"]` have `box-shadow: none; border-color: transparent; outline: none;`.
- Preserve the tight `4px` symmetric hand-glow wrapper behavior (`data-all-legal="true"` lift behavior when all cards are legal, baseline wrapper otherwise).

### 3. Automated Unit Tests (`GameTable.test.tsx` & `GamePage.test.tsx`)
- Update and add tests in `frontend/src/__tests__/GameTable.test.tsx` and `frontend/src/__tests__/GamePage.test.tsx` covering:
  1. **Defender with legal cover/redirect (`BoutPhase.Defense`):** `[data-zone="player-hand"]` / `.hand-cards` has `data-highlighted="true"` and `data-highlight-variant="defender"` (red glow active).
  2. **Defenseless defender before surrender decision (`BoutPhase.Defense`, `legalActions = ['surrender']`, `3 → 2 → 1` countdown active):** `[data-zone="player-hand"]` / `.hand-cards` STILL has `data-highlighted="true"` and `data-highlight-variant="defender"` (red glow is shown while the countdown runs before surrender is pressed or presses itself).
  3. **Pressing Surrender manually OR auto-surrender countdown firing ("presses itself"):** As soon as `[data-testid="surrender-button"]` is clicked or the `3000ms` timer fires `DeclareSurrender`, AND when the view is in `BoutPhase.SurrenderThrowIn` for the surrendering defender, `[data-zone="player-hand"]` and `.hand-cards` switch to `data-highlighted="false"` and `data-surrendering="true"` with no red glow.
  4. **Other players during `BoutPhase.SurrenderThrowIn`:** Switching POV to an attacker who holds a legal throw-in card (e.g., Alice `p0` in `surrender-half-off`) shows `data-highlighted="true"` on Alice's hand, while switching back to Bob (`p1`) shows `data-highlighted="false"`.

## 15-Second Interactive QA Verification
1. Open `http://localhost:5173` and click **`Surrender Half-Off`** or **`Defenseless Auto-Surrender`** in **`⚡ QA Scenarios`** (Lobby or Left Sidebar).
2. Observe Bob's (`p1`) hand during the `Surrender 3 → 2 → 1` countdown: verify the **red glow appears around Bob's hand** before the surrender decision is made.
3. Either click **`Surrender`** immediately or wait 3 seconds for the button to "press itself": verify that the moment `Surrender` is pressed (or auto-fires into `SurrenderThrowIn` while the table cards slide half-off toward Bob), the red glow around Bob's hand immediately disappears (`data-highlighted="false"`).

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-PREV-4 (Red Glow Before Surrender Is Made, Removed Once Surrender Is Pressed or Auto-Fires):** *"Previous-4. The red glow should still appear before the decision to surrender is made (even if there are no legal moves, it should display until the surrender button is pressed or "presses itself"."* — Wired in `frontend/src/components/GameTable.tsx`, `frontend/src/pages/GamePage.tsx`, and `frontend/src/styles/table.css` so that the active defender's hand displays the red glow (`data-highlighted="true"`, `data-highlight-variant="defender"`) throughout `BoutPhase.Defense` while uncovered attacks remain (including when `legalActions = ['surrender']` during the `3 → 2 → 1` countdown), and removes the red glow (`data-highlighted="false"`, `data-surrendering="true"`) as soon as the `Surrender` button is clicked or auto-surrenders into `BoutPhase.SurrenderThrowIn`.
- [ ] All unit tests in `frontend/src/__tests__/GameTable.test.tsx` and `frontend/src/__tests__/GamePage.test.tsx` pass via `cd frontend && npm test -- --run`.

