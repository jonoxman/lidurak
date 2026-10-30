## Code Review: T-14 Frontend WebSocket Client & Interactive Game Play

### ✅ What's Correct

- `GameWebSocket` exponential backoff (1s, 2s, 4s, max 3 retries) matches the test assertions exactly
- `parsePlayerGameView` validation is thorough and matches all `types.test.ts` expectations
- `hasLegalAction` alias normalization correctly handles `initialAttack`/`attack`, `throwInCards`/`throwIn`, etc.
- REST fallback in `GamePage` when socket is closed — matches `GamePage.test.tsx`
- Hash-based routing (`/#/g/:gameId?player=p0`) is clean and testable
- `disconnect()` correctly sets `closedByUser = true` before clearing the timer, preventing a race

---

### 🐛 Bugs & Logic Issues

**1. `connect()` clears `reconnectTimer` before auto-reconnect fires (reconnect race)**
```ts
connect(): void {
  this.closedByUser = false;
  if (this.reconnectTimer != null) {
    clearTimeout(this.reconnectTimer);   // ← cancels a pending auto-reconnect
    this.reconnectTimer = null;
  }
```
If `connect()` is called manually while an auto-reconnect is scheduled, the scheduled reconnect is silently cancelled without triggering a new one immediately — but `open()` is called right after so this is actually fine. **Not a bug.**

**2. `retries` counter is never reset on manual `connect()` call**

After three failed auto-reconnects exhaust the budget, calling `socket.connect()` again will not reconnect because `retries` is still `>= maxRetries` and `scheduleReconnect()` will return early. The user is permanently stuck unless they construct a new `GameWebSocket`. The ticket's *"reopens a closed socket when connect() is called again"* test passes (it calls `connect()` before any retries), but this edge case is unhandled.

**3. `toggleCard` uses `suit+rank` for uniqueness — fails with duplicate hand cards**
```ts
const index = view.myHand.findIndex(
  (handCard) => handCard.suit === card.suit && handCard.rank === card.rank,
);
```
In Durak the same card cannot appear twice, so this is safe. ✅

**4. `LobbyPage` imports `'../styles/table.css'`** — this import belongs in a shared entry point, not a feature page. It's a minor coupling issue but not a functional bug since the CSS is globally scoped.

**5. `canAttack` allows up to `maxBoutAttacks` cards for an *initial* attack, but the Durak rule caps initial attacks at the defender's hand size.** The backend enforces this, but the button will be enabled for oversized selections, causing silent server rejections. Low severity.

**6. `onclose` called twice on explicit `disconnect()`**
```ts
disconnect(): void {
  ...
  socket.close();          // triggers socket.onclose → scheduleReconnect()
}
```
`scheduleReconnect()` checks `this.closedByUser` first — but at the point `onclose` fires, `this.socket` has already been set to `null` and `closedByUser` is `true`, so `scheduleReconnect` returns immediately. **Not a bug.**

---

### 🔒 Security

- No XSS vectors; all dynamic content goes through Preact's VDOM (auto-escaped).
- `encodeURIComponent` on `gameId`/`playerId` in the WebSocket URL — correct.
- No credentials or tokens stored unsafely.

---

### 🧪 Missing / Weak Tests

**7. No test for `retries` not resetting after manual `connect()` call** — the bug in point 2 is undetected.

**8. `types.test.ts` doesn't test `parsePlayerGameView` with a *missing* required field** (e.g., no `attackerIdx`). The `rejects payloads` test only covers `null`, wrong types for a few fields, and a malformed nested object — `attackerIdx`, `defenderIdx`, `maxBoutAttacks` are never tested as missing.

**9. `GamePage.test.tsx` does not test:**
- Card selection toggling
- `coverAttack` path (click table card)
- Game-over display (`boutPhase === 'GameOver'`)
- Error banner rendering

These are acceptance criteria in the ticket.

**10. No test for the hash router (`parseRoute`)** — the `app.test.tsx` only verifies the lobby renders by default, not that `#/g/xyz?player=p1` routes to `GamePage`.

---

### 📋 Ticket Requirements Not Covered

| Requirement | Status |
|---|---|
| WebSocket connects and receives state updates | ✅ Tested |
| Card selection produces correct `GameAction` | ⚠️ Partially (only REST pass action tested in `GamePage.test.tsx`) |
| Multiple player views accessible | ✅ Via player-switch dropdown |
| Game over display | ✅ Implemented, ❌ Not tested |
| `allowRedirect` toggle wired through | ✅ |
| `/g/:gameId` route | ✅ Hash-based |

---

### Summary of Required Changes

1. **Reset `retries = 0` inside `connect()`** so a manual reconnect after backoff exhaustion works.
2. **Add a `parseRoute` unit test** covering the game route with query params.
3. **Expand `GamePage.test.tsx`** to cover game-over rendering and card-cover interaction.
4. **Expand `types.test.ts`** to test missing required numeric fields (e.g., `attackerIdx`).

VERDICT: CHANGES_REQUESTED
