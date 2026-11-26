<!-- WAVE:1 -->
# T-90-feedback-20261126_001630-1: Consistent `Guest-XXXX` Session Name From First Page Load (Zero Generic `"Guest"` Placeholder)

## Summary
Fix the guest session initialization and rendering pipeline end-to-end so that on a brand-new visit to `http://localhost:5173` (no existing cookies or storage), the generated `Guest-XXXX` display name appears immediately and consistently from the very first moment the UI renders—never showing a generic `"Guest"` placeholder on initial paint or staying stuck on `"Guest"` until a browser reload, and keeping the exact same `Guest-XXXX` name across initial load, lobby controls, and subsequent page reloads.

## Verbatim Human Feedback Covered (`ITEM-1a`, `ITEM-1b`)
> **# QA responses — Item 3 (referencing Previous Round Item #3: "If the user is not logged in (always the case in the current phase of implementation), display the automatically generated guest name in the top-right profile menu."):**
> "3. Bug: On first loading the page, the generic "Guest" name is shown. Only after reloading the page does the generated Guest-XXXX name display. The same name should display consistently from the moment the user loads the page - at no time should the user be able to see a generic placeholder."

## Root-Cause Investigation & Implementation Plan

### 1. Backend Session Creation & Cookie Consistency (`backend/src/main/scala/durak/session/` & `MultiplayerRoutes.scala`)
- Inspect `SessionRoutes.scala`, `SessionStore.scala`, `SessionModels.scala`, `SessionCookie.scala`, and `MultiplayerRoutes.scala`:
  - Verify that when `GET /api/session` is called with **no** session cookie (cold first visit), `SessionStore` immediately generates a `Guest-XXXX` display name (never `"Guest"`), stores the session, sets the `Set-Cookie` response header, and returns that exact `Guest-XXXX` `displayName` in the JSON response body of that first `GET /api/session` call.
  - Verify that no other route called during lobby startup (such as `GET /api/rooms` in `MultiplayerRoutes.scala`) either provisions a competing guest session with a `"Guest"` fallback name or overwrites the session cookie created by `GET /api/session`.

### 2. Eliminate Generic `"Guest"` Fallbacks & Bootstrap Session Before First UI Paint (`frontend/src/`)
- **`frontend/src/api/sessionClient.ts`:**
  - Ensure `ensureGuestSession()` deduplicates concurrent callers via a single shared in-flight `Promise` (`credentials: 'include'`), updates the module-level session cache synchronously as soon as `GET /api/session` resolves, and notifies all listeners registered via `subscribeGuestSession()`.
  - Remove any `DEFAULT_GUEST_LABEL = 'Guest'` or hardcoded `'Guest'` display-name fallback. If `GET /api/session` fails completely in an offline/unmocked unit-test environment, only fall back to a generated `Guest-XXXX` format (never the bare placeholder `"Guest"`), while in normal operation always using the authoritative `Guest-XXXX` returned by `GET /api/session`.
- **`frontend/src/api/lobbyClient.ts` & `frontend/src/pages/LobbyPage.tsx`:**
  - Ensure initial lobby API calls (such as fetching rooms in `LobbyPage.tsx` / `lobbyClient.ts`) do not race ahead of `ensureGuestSession()` when no session is cached yet, preventing concurrent unauthenticated requests on cold load from minting two different session cookies on the first visit (which would cause reload to show a different `Guest-XXXX` than first load).
  - Ensure `LobbyPage.tsx` does not initialize or overwrite the guest display name with `"Guest"`.
- **`frontend/src/main.tsx` & `frontend/src/app.tsx`:**
  - In `main.tsx` (and/or `App` in `app.tsx`), await `ensureGuestSession()` before first painting the visible header/page shell when no cached guest session exists yet so that in the live browser at `http://localhost:5173`, `getCachedGuestSession()` already holds the server's `Guest-XXXX` session on the very first rendered DOM frame. At **no** moment—not even during the initial few milliseconds while `GET /api/session` is in flight—may the user see `"Guest"` or see the name swap from a placeholder to `Guest-XXXX`.
- **`frontend/src/components/HeaderBar.tsx`:**
  - Remove `DEFAULT_GUEST_LABEL = 'Guest'` (and any hardcoded `'Guest'` fallback string).
  - Initialize state from `getCachedGuestSession()?.displayName ?? ''`; inside `useEffect`, subscribe via `subscribeGuestSession`, immediately re-read `getCachedGuestSession()` after subscribing (closing any render-to-effect race window), and invoke `ensureGuestSession()` so standalone `<HeaderBar />` mounts in tests also resolve and render `Guest-XXXX` cleanly.
  - While `displayName` is empty in standalone test renders before `ensureGuestSession()` settles, never render the generic string `"Guest"`.
  - Preserve the existing Item #4 button child ordering in `HeaderBar.tsx`: guest `displayName` label on the left and `.menu-icon` user SVG icon on the right (`iconRect.left >= nameRect.right`), and live synchronization when `updateGuestName()` (`POST /api/session/name`) is called.

## 15-Second Human Testability Check
- Open `http://localhost:5173` in a fresh incognito/private browser window (empty cookies and storage):
  1. Observe immediately (< 1 second) from the very first paint that the top-right profile menu button displays a generated `Guest-XXXX` name and **never** flashes or displays `"Guest"`.
  2. Reload the page (`Ctrl+R` / `F5`) and verify the **exact same** `Guest-XXXX` name continues to display in the top-right profile menu and lobby.

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-1a (Fix First-Load `"Guest"` Bug):** On first loading `http://localhost:5173` with no existing cookies or local/session storage, the top-right profile menu in `HeaderBar.tsx` (wired through `sessionClient.ts`, `main.tsx`, `app.tsx`, `LobbyPage.tsx`, and backend `SessionRoutes.scala` / `SessionStore.scala`) immediately displays the backend-generated `Guest-XXXX` name without requiring a page reload.
- [ ] **ITEM-1b (Consistent Name From Moment of Load & Zero Generic Placeholder):** At no point during initial load, async session resolution, or subsequent renders does `HeaderBar.tsx`, `LobbyPage.tsx`, or `app.tsx` render a generic `"Guest"` placeholder. Furthermore, reloading the page after the first visit displays the exact same `Guest-XXXX` name that appeared on the initial load (no duplicate/conflicting first-load session creation across `/api/session` and `/api/rooms`).
- [ ] **Regression Preservation (Previous Round Items #3 & #4):** Only one `GET /api/session` request is issued per page load; renaming the guest via `updateGuestName()` (`POST /api/session/name`) immediately updates the top-right profile menu in `HeaderBar.tsx`; and the user icon remains positioned to the right of the `displayName` text (`iconRect.left >= nameRect.right`).
- [ ] **Automated Tests:**
  - Backend tests (`SessionRoutesSpec.scala` / `SessionStoreSpec.scala`): verify cold `GET /api/session` (no cookie) returns `200` with `displayName` matching `^Guest-[A-Za-z0-9]+$` (never `"Guest"`), sets `Set-Cookie`, and returns the identical `displayName` on subsequent requests carrying that cookie.
  - Frontend tests (`HeaderBar.test.tsx`, `app.test.tsx`, `multiplayerClients.test.ts`): verify that on a cold load with a delayed async `GET /api/session` mock, `"Guest"` never appears in the profile button at any point before or after resolution, `Guest-XXXX` renders cleanly and consistently across reloads, and `sbt -batch test` plus `npm test -- --run` pass with zero errors.

## Constraints & Workflow Rules
- Start by running `git status` and `git diff` to check workspace state.
- Do **NOT** modify `README.md`, `ARCHITECTURE.md`, `./play-local.sh`, `agent-orchestration/`, or host scripts.
- Never run `git commit`, `git checkout`, or `git branch`.
- Run both `sbt -batch test` (in `backend/`) and `npm test -- --run` (in `frontend/`) and fix all failures.
- Write a concise implementation summary to `.reviews/agent_notes.md`, then as your final command run `echo "DONE" > .tickets/STATUS`.
