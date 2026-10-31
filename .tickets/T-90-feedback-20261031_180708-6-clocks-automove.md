<!-- WAVE:3 -->
# Ticket T-90-feedback-20261031_180708-6-clocks-automove: Activity Clocks, Low-Time Ticking Audio, 3-Second Auto-Surrender, and Timeout Random Legal Move

## Wave: 3 (Builds on Wave 1 Audio Engine & Backend APIs, and Wave 2 Table Arena Layout)

## Overview & Scope
Implement active turn clock countdowns displayed above each player box, trigger low-time ticking audio for the active user when under 5 seconds, execute an automatic random legal move upon clock expiration, and automatically surrender a defenseless defender after 3 seconds.

This addresses items **14** and **18** of the requirements:
- **Requirement 14:**
  - Whenever a player is awaited for an action, their clock starts ticking down.
  - Display each player's active clock in a small digital format (`00:XX`) directly above each player's player box (where their card count/deck is held).
  - Each player's clock resets whenever an action is taken.
  - When the clock runs out (0 seconds), the player automatically executes a random legal move (which can include passing, throwing in, defending, attacking, or surrendering).
  - When the clock drops below 5 seconds, play the ticking sound effect for only the user whose clock is ticking (calling `soundEngine.playTick(...)`).
- **Requirement 18:**
  - If a player is being attacked and has no legal way to defend (no legal cover cards and no legal redirect), start a 3-second countdown after which they automatically surrender (or they can manually click Surrender before then).

## Affected Files
- `frontend/src/pages/GamePage.tsx`
- `frontend/src/components/GameTable.tsx`
- `frontend/src/audio/SoundEngine.ts`
- `frontend/src/types.ts`
- `frontend/src/styles/table.css`
- `frontend/src/__tests__/GamePage.test.tsx`
- `frontend/src/__tests__/GameTable.test.tsx`

## Strict Autonomous Agent Rules Compliance
1. **Scope:** Only implement clock countdowns, per-player clock badges, low-time ticking integration, 3-second defenseless auto-surrender, and timeout random legal move execution.
2. **Resuming Partial Work:** Run `git status` and `git diff` first.
3. **Mandatory Testing:** Run `npm test -- --run` and `sbt -batch test`.
4. **Spatial Rules:** Player clock badges must be rendered within each player's designated box layout (Row 1 opponent seats and Row 3 Col 2 player hand), never as freeform overlapping absolute elements.
5. **Zero Table Clutter:** Do not render text banners like "Waiting for first attack..." or error messages on the table.
6. **Completion Sentinel:** After all tests pass and `.reviews/agent_notes.md` is updated, run:
   `echo "DONE" > .tickets/STATUS`

## Detailed Technical Specifications

### 1. Active Turn Clock Ticking & Per-Player Badges (`GamePage.tsx`, `GameTable.tsx`)
- Ensure `turnDeadlineMs` or local countdown ticks every 100ms:
  ```ts
  const secondsLeft = Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));
  ```
- Render a small digital clock badge (`data-testid="player-clock-<id>"`) above each opponent's card box in Row 1 and above the viewer's hand zone in Row 3.
- When an action is submitted and state updates, reset the deadline/clock.

### 2. Low-Time Ticking Audio Hook
- For the active viewer player only (`view.activePlayerId === myId`):
  - When `secondsLeft < 5` and `secondsLeft > 0`, trigger `soundEngine.playTick(secondsLeft)` once per second transition.
  - Do not trigger ticking sounds for other players' turns.

### 3. Automatic Random Legal Move on Clock Expiration (`GamePage.tsx`)
- When `secondsLeft === 0` for the active local viewer:
  - Query all currently legal actions for the player:
    - If legal actions include `pass`, `declareSurrender`, or legal card plays (attacks, covers, throw-ins, redirects).
  - Pick a random legal action uniformly from available legal moves.
  - Dispatch the chosen action via REST/WebSocket (`sendActionRest` or `socket.sendAction`).

### 4. 3-Second Defenseless Auto-Surrender (`GamePage.tsx`)
- Detect when the player is under attack and defenseless:
  ```ts
  const isDefending = view.defenderId === myId && view.tablePairs.some(p => !p.defense);
  const hasLegalDefense = myHand.some(card => 
    view.tablePairs.some(pair => !pair.defense && isLegalCover(pair.attack, card, view.trumpSuit)) ||
    (view.canRedirect && isLegalRedirect(card, view.tablePairs))
  );
  const mustAutoSurrender = isDefending && !hasLegalDefense && !isGameOverPhase(view.phase);
  ```
- When `mustAutoSurrender` becomes true:
  - Start a 3-second timer.
  - If the timer completes without the user manually pressing Surrender, automatically dispatch `buildDeclareSurrender()`.
  - Cancel the timer if table state changes (e.g. bout ends or player switches).

## Step-by-Step Implementation Instructions
1. In `GamePage.tsx`, wire a 100ms interval updating `nowMs`.
2. Pass individual player remaining seconds to `GameTable.tsx` and render `.player-mini-clock` inside each opponent seat and player hand header.
3. Integrate `soundEngine.playTick(secondsLeft)` when viewer's clock is under 5 seconds.
4. Implement `executeRandomLegalMove(view)` when active player's clock reaches 0.
5. Implement the 3-second defenseless auto-surrender timer hook.
6. Write unit and component tests in `frontend/src/__tests__/GamePage.test.tsx` simulating clock countdown, ticking audio invocations, defenseless auto-surrender dispatch, and timeout random action execution.

## Verification Commands
```bash
cd /home/shade_of_ox/agent-project/frontend
npm test -- --run src/__tests__/GamePage.test.tsx
npm test -- --run src/__tests__/GameTable.test.tsx
npm test -- --run
cd /home/shade_of_ox/agent-project/backend
sbt -batch test
```
