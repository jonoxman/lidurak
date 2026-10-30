## Code Review: T-14 Frontend WebSocket Client & Interactive Game Play

### ✅ Generally Well-Implemented

The core architecture is solid: the type validator, WebSocket manager, REST client, and routing are coherent and well-structured. The tests are comprehensive and meaningfully verify behavior.

---

### 🐛 Logic Bugs

**1. `connect()` resets `retries` on every explicit call — but NOT when a message is received**

In `websocket.ts`, `connect()` resets `retries = 0`, which satisfies the "resets retry budget when connect() is called after giving up" test. However, `onmessage` also resets `retries = 0` after a valid message. This is intentional per the comment, but the `connect()` reset happens *before* checking socket state — meaning calling `connect()` while a socket is mid-retry-backoff will cancel the pending timer AND reset the counter, leaving a dangling socket that may still call `scheduleReconnect()` later via its `onclose`. The old socket's `onclose` guard (`if (this.socket === socket) this.socket = null`) helps, but `scheduleReconnect()` is still called unconditionally after the null-check — meaning after a manual `connect()` call tears down the timer, the old socket's `onclose` can still schedule a new reconnect with a fresh `retries = 0`. This could produce a double-connect.

```typescript
// websocket.ts open()
socket.onclose = () => {
  if (this.socket === socket) this.socket = null;
  this.scheduleReconnect(); // <-- called even when this.socket !== socket (i.e., after reconnect via connect())
};
```

**2. `GamePage`: Card deduplication in `toggleCard` is fragile**

```typescript
const index = view.myHand.findIndex(
  (handCard) => handCard.suit === card.suit && handCard.rank === card.rank,
);
```

`findIndex` always returns the *first* match. If a player legitimately holds two identical cards (same suit+rank — impossible in standard Durak, but the type system doesn't enforce uniqueness), clicking the second copy always toggles the first. Since the ticket's domain implies standard Durak rules this is low-risk, but worth a comment.

**3. `parseRoute` — empty game ID not rejected**

```typescript
const match = /^\/g\/([^/]+)$/.exec(path);
```

The regex `[^/]+` matches one or more non-slash characters, so `#/g/%20` (a URL-encoded space) would decode to `" "` and route to `GamePage` with a whitespace-only `gameId`. The test `'#/g/'` correctly falls back to lobby (empty string fails the regex), but `#/g/%20` would slip through. Minor, but worth guarding.

---

### ⚠️ Missing Edge-Case Tests

**4. WebSocket test: `onopen` is never called on `MockWebSocket`**

`GameWebSocket.open()` doesn't attach an `onopen` handler currently, so this isn't a bug in the implementation — but the `live` state in `GamePage` is set via `onStateUpdate` (i.e., on first valid message), never by `onopen`. There's no test that verifies the "Connecting…" → "Connected" transition in the UI. The `GamePage.test.tsx` mocks the WebSocket to always return `isOpen() = false`, so the live indicator is never exercised.

**5. No test for `sendAction` REST fallback updating view state**

`GamePage.test.tsx` test "loads the view and sends actions through REST when the socket is closed" verifies `sendAction` is *called* but doesn't assert that `setView(result)` updates the rendered UI. The view update on REST fallback is not covered.

**6. `LobbyPage` is entirely untested**

The ticket requires `LobbyPage` to be tested (form, player count change, name fields, create-game API call, player-tab links). No test file exists for `LobbyPage`.

**7. `parseRoute` test for `#/g/%20` (whitespace game ID) is missing**

As noted above, the regex allows whitespace-encoded IDs through.

---

### 🔒 Security / Correctness

**8. `errorMessage` helper suppresses non-Error `fetch` rejections**

In `client.ts`, network failures throw a `TypeError` (e.g., DNS failure), which is caught and converted to a string. This is fine. But `sendAction`'s outer `.catch` in `GamePage.tsx` re-converts — the double-conversion is harmless but redundant.

**9. `autopilot.sh` change: silent removal of effort flags**

The diff drops `--effort` flags from `agy` calls. This is outside the ticket scope (T-14) and changes pipeline behavior. As a reviewer I'd flag this as a scope violation — `autopilot.sh` is infrastructure, not frontend code — but it passes the local test gate since it's a shell script.

---

### Summary

| Category | Issue | Severity |
|---|---|---|
| Logic bug | `onclose` schedules reconnect even after manual `connect()` replaces socket | Medium |
| Logic bug | `toggleCard` first-match deduplication | Low |
| Logic bug | Whitespace game IDs pass `parseRoute` regex | Low |
| Missing test | `live` state / "Connected" UI transition | Medium |
| Missing test | REST fallback view update in `GamePage` | Medium |
| Missing test | `LobbyPage` entirely uncovered | High |
| Scope | `autopilot.sh` changes are out-of-ticket scope | Low |

The WebSocket `onclose`/reconnect race and the absent `LobbyPage` tests are the most significant gaps against the acceptance criteria. The ticket explicitly requires tests for the interactive flow and the lobby page is a named file requirement.

VERDICT: CHANGES_REQUESTED
