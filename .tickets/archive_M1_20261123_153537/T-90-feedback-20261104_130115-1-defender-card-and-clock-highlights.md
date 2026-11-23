<!-- WAVE:1 -->
# T-90-feedback-20261104_130115-1 — Defender-Only Uncovered Card Highlight (Cleared on Surrender) & Urgent-Only Clock Highlighting

## Summary
Implement QA Responses `Previous-4` (`ITEM-PREV-4a`, `ITEM-PREV-4b`) and `1` (`ITEM-QA-1`):
1. **Uncovered In-Play Card Highlighting (`ITEM-PREV-4a` & `ITEM-PREV-4b`):**
   - The pulsing highlight on uncovered attacking cards in play on the felt (`.table-card-uncovered` inside `TablePair.tsx` / `GameTable.tsx`) must **stop being highlighted immediately when the decision is made to surrender** (both when the defender clicks `Surrender` / auto-surrender fires client-side, and throughout `BoutPhase.SurrenderThrowIn` when `isSurrendered` is true), because those cards can no longer be covered.
   - Furthermore, the highlight on uncovered in-play cards must **only ever be visible to the defender** (`isDefender` / `view.myId === defenderId`). When any other player (the initial attacker, a throw-in attacker, or a spectator/other seat via `POV`) views the table, uncovered attacking cards on the felt must not show the `.table-card-uncovered` highlight/glow.
2. **Clocks Unhighlighted Except Under 5 Seconds (`ITEM-QA-1`):**
   - Neither the overall **Game** clock half nor the **Turn** clock half in the right sidebar (`.split-clock-panel` / `.split-clock-half`) may be highlighted during normal operation (`> 5` seconds remaining).
   - Remove the active cyan/teal border, glow, surface tint, and digit color on `.split-clock-half[data-active="true"]` and `.split-clock-value`.
   - Only when the turn timer ticks down to the final 5 seconds (`turnSecondsRemaining <= 5 && turnSecondsRemaining > 0` while the turn clock is active, i.e., `data-low-time="true"` / `.split-clock-half.clock-low`) should the Turn clock half highlight with the urgent low-time aura.

---

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-PREV-4a (Uncovered In-Play Card Stops Highlighting on Surrender):**
  > "Previous-4. This is good. One final change - the latest in-play highlighted card should stop being highlighted when the decision is made to surrender, since that card can no longer be covered anymore."
  - In `frontend/src/pages/GamePage.tsx`, `frontend/src/components/GameTable.tsx`, and `frontend/src/components/TablePair.tsx`:
    - Pass whether the uncovered card highlight is allowed (`highlightUncovered?: boolean` or computed from `isDefender && !isSurrendered && !surrenderPending`) down from `GamePage.tsx` → `GameTable.tsx` → `TablePair.tsx`.
    - Specifically, an uncovered attack card (`pair.defense === null`) may only receive the `.table-card-uncovered` class and `data-uncovered-highlighted="true"` when ALL of the following hold:
      1. `pair.defense === null` (the card is uncovered),
      2. `view.boutPhase === 'Defense'` (not `'SurrenderThrowIn'`, not `'GameOver'`),
      3. The defender has NOT made the decision to surrender (`!isSurrendered` and not `surrenderSubmitted` / `isSurrendering` in `GamePage.tsx` after clicking `Surrender` or after the 3-second client auto-surrender timer triggers),
      4. The table is not in read-only replay/review mode (`!isReviewMode`).
    - As soon as the defender clicks `Surrender` (or the 3-second auto-surrender countdown fires, or `boutPhase === 'SurrenderThrowIn'`), every uncovered card on the table must immediately drop `.table-card-uncovered` and set `data-uncovered-highlighted="false"`, removing all crimson border, `box-shadow`, and pulse animation on that card.

- [ ] **ITEM-PREV-4b (Uncovered In-Play Card Highlight Visible ONLY to the Defender):**
  > "Additionally, the highlight on that card should not be visible to any player other than the defender."
  - In `frontend/src/pages/GamePage.tsx`, `frontend/src/components/GameTable.tsx`, and `frontend/src/components/TablePair.tsx`:
    - Gate the uncovered card highlight strictly on `view.myId === defenderId` (i.e., the active viewer in `POV` is the current bout's defender, and not a bot seat if locked, or specifically `view.myId === defenderPlayerId`).
    - When viewing the table from ANY non-defender seat (e.g., Alice `p0` or Carol `p2` when Bob `p1` is defending), `.table-card-attack` must NOT have the `.table-card-uncovered` class and must have `data-uncovered-highlighted="false"`, even when `pair.defense === null` and `boutPhase === 'Defense'`.

- [ ] **ITEM-QA-1 (Do Not Highlight Either Clock Except When Timer Ticks Below 5 Seconds):**
  > "1. Do not highlight either of the clocks, except for when the timer ticks below 5 seconds."
  - In `frontend/src/pages/GamePage.tsx`, `frontend/src/styles/table.css`, and `frontend/src/app.css`:
    - Keep `data-active="true" | "false"` on both `.split-clock-half` elements for structural/test tracking of whether the game or turn clock is ticking, and add/maintain `data-highlighted="true" | "false"` on each `.split-clock-half`:
      - For the **Game** clock (`data-testid="game-clock-half"`): `data-highlighted="false"` at all times (the Game clock counts up and never ticks below 5 seconds on a countdown).
      - For the **Turn** clock (`data-testid="turn-clock-half"`): `data-highlighted="true"` **ONLY** when the turn timer is actively counting down in its final 5 seconds (`isTurnClockActive && turnSeconds <= 5 && turnSeconds > 0`, i.e., `data-low-time="true"` / `.clock-low`). When `turnSeconds > 5` or when the turn clock is inactive, `data-highlighted="false"`.
    - In `frontend/src/styles/table.css` and `frontend/src/app.css`:
      - Update `.split-clock-half[data-active="true"]` (in both Dark and Light themes) so that when `:not(.clock-low)` / `[data-low-time="false"]`, it has **no highlight**: `background: transparent; box-shadow: none; outline: none; border-color: transparent;` (preserving only the subtle horizontal divider `border-bottom` between the top and bottom clock halves), and `.split-clock-half[data-active="true"]:not(.clock-low) .split-clock-value` uses the neutral unhighlighted clock text color (`var(--text-primary)` / `#f8fafc` in Dark and `#0f172a` in Light, with `text-shadow: none`).
      - Keep the urgent highlight on `.split-clock-half.clock-low` / `.split-clock-half[data-low-time="true"]` (`--clock-urgent-*` / `--clock-low-*`) when the turn clock is at `<= 5` seconds (`00:05` down to `00:01`).

- [ ] **15-Second QA Testability with Existing Presets (`Surrender Half-Off` & `Defenseless Auto-Surrender`):**
  - Verify that clicking **`Surrender Half-Off`** (`surrender-half-off`) or **`Defenseless Auto-Surrender`** (`defenseless-surrender`) in **`⚡ QA Scenarios`** (`LobbyPage.tsx` / `GamePage.tsx` left sidebar):
    1. Opens on **Bob** (`p1`, defender) in `BoutPhase.Defense`: the uncovered attacking card (`7♠` or `J♠`) has `.table-card-uncovered` and `data-uncovered-highlighted="true"`, and neither the `Game` clock nor the `Turn` clock (`00:15`) is highlighted (`data-highlighted="false"`).
    2. Clicking **`Surrender`** (or waiting 3 seconds for client auto-surrender) immediately changes the uncovered card on the felt to `data-uncovered-highlighted="false"` and removes `.table-card-uncovered`.
    3. Switching `POV` to **Alice** (`p0`) or **Carol** (`p2`) while `7♠` is uncovered in `BoutPhase.Defense` immediately shows `data-uncovered-highlighted="false"` (no `.table-card-uncovered` class) because Alice and Carol are not the defender.
    4. Waiting until the active `Turn` clock ticks down to `00:05`–`00:01` highlights only the Turn clock half (`data-low-time="true"`, `data-highlighted="true"`).

---

## Automated Verification
Run:
```bash
cd frontend && npm test -- --run
```
Add or update unit/integration tests in `frontend/src/__tests__/GameTable.test.tsx` and `frontend/src/__tests__/GamePage.test.tsx` covering:
1. Uncovered attack card has `.table-card-uncovered` and `data-uncovered-highlighted="true"` ONLY when viewed by the defender in `BoutPhase.Defense` before surrendering.
2. Uncovered attack card has `data-uncovered-highlighted="false"` and no `.table-card-uncovered` class when viewed by the attacker or another non-defender seat (`ITEM-PREV-4b`).
3. Uncovered attack card immediately loses `.table-card-uncovered` and sets `data-uncovered-highlighted="false"` when the defender clicks `Surrender`, when the client auto-surrender timer triggers, or when `boutPhase === 'SurrenderThrowIn'` (`ITEM-PREV-4a`).
4. Both `game-clock-half` and `turn-clock-half` have `data-highlighted="false"` and no active highlight class/glow when `turnSeconds > 5`, and `turn-clock-half` switches to `data-highlighted="true"` / `.clock-low` (`data-low-time="true"`) only when `turnSeconds <= 5` (`ITEM-QA-1`).
