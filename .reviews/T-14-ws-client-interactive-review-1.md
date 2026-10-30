## Review Round 1 of 4 — T-14: Frontend WebSocket Client & Interactive Game Play

---

### Summary of Changes

The implementation covers all required files from the ticket: `types.ts`, `api/client.ts`, `api/websocket.ts`, `pages/GamePage.tsx`, `pages/LobbyPage.tsx`, `app.tsx`, and the accompanying test files. The implementer notes address prior review items.

---

### Detailed Review

#### `frontend/src/types.ts`
- All required interfaces are present and match the ticket spec.
- `parsePlayerGameView` performs thorough runtime validation with clear error messages — good defensive boundary.
- `hasLegalAction` with aliases correctly handles backend naming variation (`initialAttack` ↔ `attack`, `throwInCards` ↔ `throwIn`, etc.).
- `normalizeToken` strips all non-alpha chars before lowercasing — handles camelCase/PascalCase correctly.
- Error messages for missing numeric fields (`attackerIdx`, `defenderIdx`, `maxBoutAttacks`) propagate the field name, matching test assertions.

#### `frontend/src/api/client.ts`
- All three required exports (`createGame`, `getGameView`, `sendAction`) are present.
- Player ID extraction from the `createGame` response handles both `string` and `{ id: string }` object shapes — robust against backend variance.
- URL segments are properly `encodeURIComponent`-encoded in `getGameView` and `sendAction`.
- `sendAction` returns `PlayerGameView | { error: string }` as specified.

#### `frontend/src/api/websocket.ts`
- URL construction uses `encodeURIComponent` for both `gameId` and `playerId` — correctly handles special chars (confirmed by `encodes game and player ids` test).
- The stale-socket guard (`if (this.socket !== socket) return`) in `onclose` correctly fixes the double-connect race from prior review.
- Explicit `connect()` resets `retries = 0` so the budget resets after manual reconnect — confirmed by the test `resets the retry budget when connect() is called after giving up`.
- Exponential backoff: delays are 1s, 2s, 4s (max 3 retries) — matches `maxRetries = 3` and `delay = 1000 * 2 ** this.retries` with pre-increment. Verified against the backoff test.
- `closedByUser` flag is checked in both `scheduleReconnect` and the timer callback — `disconnect()` reliably prevents reconnect.
- `connect()` guards against re-opening an `OPEN` or `CONNECTING` socket — no-op correctly.
- `isOpen()` is exposed and used in `GamePage` for the WS-vs-REST dispatch decision.

#### `frontend/src/pages/GamePage.tsx`
- Effect correctly tears down on `[gameId, playerId]` dependency change via `active` flag and `socket.disconnect()`.
- `selection` is tied to the current `view` reference (`selection?.view === view`) — stale selection is dropped atomically when a new view arrives, avoiding the race mentioned in the comment.
- `toggleCard` uses `findIndex` with suit+rank equality — the comment acknowledges the Durak uniqueness assumption; reviewed and accepted per prior round.
- REST fallback fires when `socket.isOpen()` is false — correct for the initial load window.
- `onTableCardClick` is only wired when `cover` is legal — prevents accidental coverage dispatch.
- GameOver display correctly checks `isGameOverPhase` (case-insensitive), shows winner/Durak/draw, and suppresses action buttons.
- `boutPhase === "GameOver"` is never used as a raw string comparison — always goes through `isGameOverPhase()`.

#### `frontend/src/pages/LobbyPage.tsx`
- Satisfies the M1 local lobby requirement: player count selector (2/3/4), name fields, redirect toggle, create button.
- Player link `href` format `#/g/${gameId}?player=${id}` matches `parseRoute` in `app.tsx`.
- Error banner uses `role="alert"` — accessible.

#### `frontend/src/app.tsx`
- `parseRoute` correctly handles: decode errors (try/catch → lobby), empty/whitespace-only game IDs (`.trim()` → lobby), missing player param (`|| 'p0'`), URL-encoded IDs.
- Hash-change listener is properly cleaned up in the effect return.

#### Tests
- `websocket.test.ts`: 13 tests covering connect URL, state updates, malformed message rejection, serialization, closed-socket no-send, backoff timing, stale socket guard, re-open, budget reset, URL encoding, and disconnect-stops-reconnect. Comprehensive.
- `types.test.ts`: Covers parse success, optional field normalization, rejection of bad payloads, missing numeric fields, token normalization, phase helpers, and all six action builders including JSON-safety round-trip.
- `GamePage.test.tsx`: 5 tests covering REST load, cover UX, GameOver display, WS live transition, and REST fallback re-render.
- `LobbyPage.test.tsx`: 4 tests covering default form state, count change, game creation with links, and error banner.
- `app.test.tsx`: 5 `parseRoute` edge-case tests including whitespace IDs and malformed percent-encoding.

---

### Issues Found

No High or Medium severity bugs found. All ticket requirements are implemented. Test coverage is thorough. The stale-socket, whitespace game ID, and selection-race fixes from prior review are correctly addressed.

---

VERDICT: APPROVED
