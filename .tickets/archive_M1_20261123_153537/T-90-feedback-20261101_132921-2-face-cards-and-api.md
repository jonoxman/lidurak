<!-- WAVE:1 -->
# Ticket T-90-2: Frontend Cards & API Layer — Face Card (J, Q, K) Corner Pips with Outward Rotation, Server Health API, & WebSocket Keepalive/Presence

## Summary
1. Update the SVG design for face cards (`J`, `Q`, `K`) in `Card.tsx` so their interior pips sit at the ends of the letter (`J` = 3 pips, `Q` = 1 pip, `K` = 4 pips) and are rotated so the distinguishing part of each suit (top half for Heart/Club, bottom half for Spade/Diamond) faces outwards from the letter.
2. Update `types.ts`, `client.ts`, and `websocket.ts` to support server readiness health checks (`checkServerHealth`), bot player types in game creation (`playerTypes`), WebSocket keepalive heartbeats (preventing 60-second idle timeouts), and player presence updates (`sendPresence`).

---

## Strict File Boundaries (Wave 1 Parallel Execution)
- **ONLY modify these exact files:**
  - `frontend/src/components/Card.tsx`
  - `frontend/src/__tests__/Card.test.tsx`
  - `frontend/src/types.ts`
  - `frontend/src/__tests__/types.test.ts`
  - `frontend/src/api/client.ts`
  - `frontend/src/api/websocket.ts`
  - `frontend/src/__tests__/websocket.test.ts`
- **DO NOT touch any other files** (do not touch `CardBack.tsx`, `HeaderBar.tsx`, `app.tsx`, `LobbyPage.tsx`, `GamePage.tsx`, `GameTable.tsx`, `app.css`, `table.css`, or `backend/`).

---

## Detailed Requirements

### 1. Face Card (`J`, `Q`, `K`) Pip Placement & Outward Rotation (`frontend/src/components/Card.tsx`)
Instead of arranging extra pips on face cards (`jack`, `queen`, `king`) in a diamond pattern:
- **Pip Positions at the Ends of the Center Letter (`viewBox="0 0 70 100"`, center letter around `(35, 50)`):**
  - **`jack` (`J`):** **3 pips** total:
    - `top-left` (at the top-left end of the `J`, e.g., `{ x: 24, y: 33, corner: 'top-left' }`)
    - `top-right` (at the top-right end of the `J`, e.g., `{ x: 46, y: 33, corner: 'top-right' }`)
    - `bottom-left` (at the bottom-left hook/point of the `J`, e.g., `{ x: 24, y: 67, corner: 'bottom-left' }`)
  - **`queen` (`Q`):** **1 pip** total:
    - `bottom-right` (at the bottom-right tail/point of the `Q`, e.g., `{ x: 46, y: 67, corner: 'bottom-right' }`)
  - **`king` (`K`):** **4 pips** total:
    - `top-left` (at the top-left stem end of the `K`, e.g., `{ x: 24, y: 33, corner: 'top-left' }`)
    - `top-right` (at the top-right arm end of the `K`, e.g., `{ x: 46, y: 33, corner: 'top-right' }`)
    - `bottom-left` (at the bottom-left stem end of the `K`, e.g., `{ x: 24, y: 67, corner: 'bottom-left' }`)
    - `bottom-right` (at the bottom-right leg end of the `K`, e.g., `{ x: 46, y: 67, corner: 'bottom-right' }`)
- **Outward Pip Rotation Rule:**
  - "For these cards, rotate the pips so that their distinguishing parts (these are the top half of the heart and club, and the bottom half of the spade and diamond are facing outwards from the letter."
  - In standard upright (`0deg`) orientation:
    - The **top half** of a `hearts` (`♥`) or `clubs` (`♣`) pip points **UP (`0deg`)**.
    - The **bottom half** of a `spades` (`♠`) or `diamonds` (`♦`) pip points **DOWN (`180deg`)**.
  - Outward diagonal angles from the center letter `(35, 50)` (measured clockwise from UP / `0deg`):
    - `top-left`: `-45` degrees (or `315`)
    - `top-right`: `45` degrees
    - `bottom-right`: `135` degrees
    - `bottom-left`: `-135` degrees (or `225`)
  - Therefore, compute the rotation angle for each face pip as:
    - For `hearts` and `clubs` (top half faces outward):
      - `top-left`: `-45`
      - `top-right`: `45`
      - `bottom-right`: `135`
      - `bottom-left`: `-135`
    - For `spades` and `diamonds` (bottom half faces outward, i.e., shifted by `180` degrees so the bottom half points in the outward direction):
      - `top-left`: `135`
      - `top-right`: `-135`
      - `bottom-right`: `-45`
      - `bottom-left`: `45`
  - Render each face-card extra pip with `class="card-pip face-pip"`, `data-corner={corner}`, `data-rotation={angle}`, and `transform={`rotate(${angle} ${x} ${y})`}` (with `text-anchor="middle"` and `dominant-baseline="central"` so rotation pivots cleanly around `(x, y)`).

### 2. Shared Types (`frontend/src/types.ts`)
- Add `PlayerType = 'human' | 'randomBot'`.
- In `OpponentView`, add optional `isPresent?: boolean`.
- In `PlayerGameView`, add optional `presentPlayers?: string[]`.

### 3. REST Client (`frontend/src/api/client.ts`)
- Add `checkServerHealth(): Promise<boolean>`:
  - Performs `GET /api/health`.
  - Returns `true` if `response.ok` is `true`, and `false` if `!response.ok` or if `fetch` throws/rejects.
- Update `createGame`:
  ```ts
  export async function createGame(
    playerCount: number,
    playerNames: string[],
    allowRedirect: boolean,
    chaosMode = false,
    playerTypes?: string[],
  ): Promise<CreatedGame>
  ```
  Include `playerTypes` in the JSON request body when provided (or default to `Array(playerCount).fill('human')`).

### 4. WebSocket Keepalive & Presence Support (`frontend/src/api/websocket.ts`)
- Add a periodic keepalive timer (`20_000ms` interval) while the WebSocket is `OPEN` that sends `JSON.stringify({ type: 'ping' })` so idle connections never trigger a 60-second timeout. Clear this timer on `close` / `disconnect`.
- Ignore non-view control frames (such as `{"type":"pong"}` or empty/ping messages that lack `myId`/`boutPhase`) in `onmessage` without throwing or invoking `onUpdate` with invalid data.
- Add `sendPresence(isPresent: boolean): void` on `GameWebSocket`:
  - Sends `JSON.stringify({ type: 'presence', isPresent })` if the socket is `OPEN`, or queues/sends the latest presence state once `onopen` fires.

---

## Verification & Testing
1. Update and add unit tests in:
   - `frontend/src/__tests__/Card.test.tsx`:
     - Verify `jack` renders 3 `.face-pip` elements at `top-left`, `top-right`, `bottom-left`.
     - Verify `queen` renders 1 `.face-pip` element at `bottom-right`.
     - Verify `king` renders 4 `.face-pip` elements at `top-left`, `top-right`, `bottom-left`, `bottom-right`.
     - Verify outward rotations differ by 180 degrees between `hearts`/`clubs` and `spades`/`diamonds` at each corner.
   - `frontend/src/__tests__/types.test.ts` and `frontend/src/__tests__/websocket.test.ts`:
     - Verify `sendPresence` and periodic keepalive ping frames work cleanly.
2. Run:
   ```bash
   cd frontend && npm test -- --run src/__tests__/Card.test.tsx src/__tests__/types.test.ts src/__tests__/websocket.test.ts
   ```
3. Write a concise summary of your changes in `.reviews/agent_notes.md` and run `echo "DONE" > .tickets/STATUS`.
