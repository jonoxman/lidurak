<!-- WAVE:1 -->
# Ticket: `T-90-feedback-20261103_135755-3-frontend-auto-surrender-autopass-delays` — 3-Second Client-Side Auto-Surrender Delay & 1-Second Client-Side Auto-Pass Delay

## Assigned Items
- **ITEM-PREV-4a (Frontend Client-Side 3-Second Auto-Surrender Delay):**
  > "Previous-4. Make the client-side auto surrender happen on a 3-second delay instead of instantly. The auto-pass for the other players if they have no legal throw in cards should happen on a 1-second delay instead of instantly."
- **ITEM-PREV-4b (Frontend Client-Side 1-Second Auto-Pass Delay when No Legal Throw-In Cards):**
  > When the active human viewer is in a throw-in phase (`SurrenderThrowIn` or covered throw-in) with `'pass'` in `legalActions` and no `'throwIn'` in `legalActions`, automatically dispatch `PassTurn` after a **1-second (`1000 ms`) delay** instead of instantly.

---

## Context & End-to-End Wiring

### Current State & Problem
- In `frontend/src/pages/GamePage.tsx`:
  - Previously, client-side auto-surrender was either firing instantly or removed completely (`ActionBar` received no `surrenderSeconds` and `GamePage` ran no client-side auto-surrender timer).
  - The user requested:
    1. **Client-side auto-surrender on a 3-second (`3000 ms`) delay** instead of instantly when the defender has no legal cover or redirect move.
    2. **Auto-pass on a 1-second (`1000 ms`) delay** instead of instantly for other players when they have no legal throw-in cards.

### Required Changes

1. **`frontend/src/pages/GamePage.tsx` — 3-Second Client-Side Auto-Surrender (`CLIENT_AUTO_SURRENDER_DELAY_MS = 3000`):**
   - Export `const CLIENT_AUTO_SURRENDER_DELAY_MS = 3000;` (3 seconds).
   - Detect when the current human viewer (`!isBotViewer && !reviewMode && view != null`) is a defenseless defender:
     - `normalizeToken(view.boutPhase) === 'defense'`
     - `view.legalActions.includes('surrender')`
     - `!view.legalActions.includes('cover') && !view.legalActions.includes('redirect')` (or `view.defenderDefenseless === true`)
   - When this condition holds:
     - Start a 3-second (`3000 ms`) timer that dispatches `buildDeclareSurrender(playerId)` when `3000 ms` elapses.
     - Also track a 1-second interval / remaining seconds state (`surrenderCountdownSeconds`: `3` -> `2` -> `1`) and pass `surrenderSeconds={surrenderCountdownSeconds}` to `<ActionBar />` so the `Surrender` button stays visible and clickable for the full 3 seconds (allowing the human user to click `Surrender` manually at any time during the 3-second window or let it auto-surrender at `3000 ms`).
     - If the user clicks `Surrender` manually, switches `POV`, enters review mode, or the game state transitions before `3000 ms`, immediately clear the timeout/interval so `DeclareSurrender` is never dispatched twice.
   - When the defender *does* have a legal `'cover'` or `'redirect'` action in `view.legalActions`, do **not** start the 3-second client-side auto-surrender timer (the `Surrender` button simply remains visible with `surrenderSeconds={null}`).

2. **`frontend/src/pages/GamePage.tsx` — 1-Second Client-Side Auto-Pass When Viewer Has No Legal Throw-In Cards (`CLIENT_AUTO_PASS_DELAY_MS = 1000`):**
   - Export `const CLIENT_AUTO_PASS_DELAY_MS = 1000;` (1 second).
   - Detect when the current human viewer (`!isBotViewer && !reviewMode && view != null`) is an active non-defender in a throw-in state with no legal throw-in cards:
     - `view.legalActions.includes('pass')`
     - `!view.legalActions.includes('throwIn')`
     - `!view.myHasPassed`
   - When this condition holds:
     - Start a 1-second (`1000 ms`) timer that dispatches `buildPassTurn(playerId)` after `1000 ms` (instead of `0 ms`).
     - While waiting for the 1-second timer, the `Pass` button in `ActionBar` remains visible and clickable (with `passSeconds` showing `1` if no smaller server countdown applies), and clicking `Pass` manually or changing state/POV cancels the timer cleanly so `PassTurn` is never sent twice.

3. **`frontend/src/components/ActionBar.tsx`:**
   - Ensure `ActionBar` accepts `surrenderSeconds?: number | null` and renders the `Surrender` button enabled and clickable whenever `canSurrender` is true, showing `[data-testid="surrender-countdown"]` when `surrenderSeconds != null && surrenderSeconds > 0`.

4. **`frontend/src/__tests__/GamePage.test.tsx`:**
   - Update existing auto-surrender / auto-pass tests and add comprehensive tests using `vi.useFakeTimers()`:
     - **3-Second Auto-Surrender Test:** When `view` is in `Defense` with `legalActions: ['surrender']` and `defenderDefenseless: true`, verify:
       - The `Surrender` button (`[data-testid="surrender-button"]`) is visible on screen immediately (`0 ms`).
       - `DeclareSurrender` is **not** dispatched at `0 ms`, `1000 ms`, or `2999 ms`.
       - Advancing timers to `3000 ms` automatically dispatches `{ type: 'DeclareSurrender', playerId: 'p1' }`.
     - **Manual Surrender Before 3s Test:** Clicking `[data-testid="surrender-button"]` at `500 ms` dispatches `DeclareSurrender` immediately and advancing timers past `3000 ms` does not dispatch a duplicate `DeclareSurrender`.
     - **Defender With Legal Cover Does Not Auto-Surrender Test:** When `legalActions: ['cover', 'surrender']` (`defenderDefenseless: false`), advancing timers by `3000 ms` (or `5000 ms`) does **not** dispatch `DeclareSurrender`.
     - **1-Second Auto-Pass When No Legal Throw-In Cards Test:** When `view` is in `SurrenderThrowIn` with `legalActions: ['pass']` (no `'throwIn'`), verify:
       - `PassTurn` is **not** dispatched at `0 ms` or `900 ms`.
       - Advancing timers to `1000 ms` automatically dispatches `{ type: 'PassTurn', playerId: ... }`.

---

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-PREV-4a (3-Second Client-Side Auto-Surrender Delay):**
  > "Previous-4. Make the client-side auto surrender happen on a 3-second delay instead of instantly. The auto-pass for the other players if they have no legal throw in cards should happen on a 1-second delay instead of instantly."
  - When a human defender has no legal cover or redirect (`legalActions` has `'surrender'` and neither `'cover'` nor `'redirect'`), the `Surrender` button remains visible and clickable for 3 seconds and `GamePage` automatically dispatches `DeclareSurrender` after `3000 ms`.
  - When a human defender has at least one legal cover or redirect, client-side auto-surrender does not run.
- [ ] **ITEM-PREV-4b (1-Second Client-Side Auto-Pass Delay When No Legal Throw-In Cards):**
  - When a human thrower has `'pass'` in `legalActions` and no `'throwIn'` in `legalActions`, `GamePage` waits `1000 ms` (1 second) before automatically dispatching `PassTurn`.
- [ ] **Automated Test Verification:**
  - `cd frontend && npm test -- --run` passes with 0 errors.
