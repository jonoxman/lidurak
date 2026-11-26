<!-- WAVE:3 -->
# T-90-feedback-20261126_001630-3: Clean Homepage URL Navigation With Zero `#/` Hash Suffixes Anywhere

## Summary
Fix client-side routing and all header/in-app navigation elements so clicking the top-left `LIDURAK` logo (or any other navigation link/button anywhere in the application) navigates to the homepage and sets the browser URL bar to the exact root URL `/` (`http://localhost:5173/`), never keeping the previous path (e.g., `/g/<gameId>#/`) and never appending `#/` or `#` to the URL.

## Verbatim Human Feedback Covered (`ITEM-3a`, `ITEM-3b`)
> **# New — Item 1:**
> "1. Clicking the top-left LIDURAK logo in the header bar returns the user to the home page correctly, but keeps the current URL shown in the browser bar the same, adding #/ at the end of it. Instead, it should just go back to the homepage and set the URL to be exactly the home page. Also apply this change to any other such navigation elements (if there are any) - no element should ever put #/ at the end of the URL."

## Implementation Plan

### 1. Clean History API Router (`frontend/src/router/useRoute.ts`)
- Inspect `frontend/src/router/useRoute.ts` and all exported navigation helpers:
  - Ensure navigating to the homepage/lobby **always** calls `window.history.pushState(null, '', '/')` (unless already at exact `'/'` with empty `search` and empty `hash`, in which case ensure `hash` and `search` are cleared if non-empty via `replaceState(null, '', '/')`) and notifies route subscribers so `window.location.pathname === '/'`, `window.location.search === ''`, and `window.location.hash === ''`.
  - Ensure navigating to a game (`/g/<gameId>`) calls `window.history.pushState(null, '', '/g/' + encodeURIComponent(gameId))` with `window.location.hash === ''`.
  - Remove any code that writes `window.location.hash = '#/'` or `#/...`.
  - If the page is loaded directly with a trailing `#/` or `#` (or `#/g/<gameId>`), normalize the URL immediately via `window.history.replaceState(null, '', cleanPathname)` so `#/` never remains in the browser address bar.
  - Verify `popstate` (browser Back/Forward navigation) transitions cleanly between `/` and `/g/<gameId>` without ever introducing `#/`.

### 2. Top-Left `LIDURAK` Logo & Header Navigation Controls (`frontend/src/components/HeaderBar.tsx`)
- Inspect `HeaderBar.tsx`:
  - **Top-left `LIDURAK` brand logo link/button** (wrapping `[data-testid="brand-logo"][data-size="header"]`):
    - If rendered as an `<a>` element, change `href` from `"#/"` (or `"#"`) to `"/"`.
    - On unmodified primary clicks (`event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey`), call `event.preventDefault()` and invoke the clean SPA homepage navigation helper so the app transitions to `LobbyPage` without a full page reload **and** updates `window.location` to exact `/` (`http://localhost:5173/`—clearing `/g/<gameId>` and never adding `#/`).
  - **All other `HeaderBar.tsx` navigation and dropdown elements (`NAV_MENUS`: `"PLAY"`, `"PUZZLES"`, `"LEARN"`, `"WATCH"`, their submenu items, and `PROFILE_ITEMS`):**
    - Audit every `<a href=...>` and `onClick` handler in `HeaderBar.tsx`.
    - Any item that navigates to the lobby/homepage (such as `"PLAY"` or lobby/create-game menu entries) must use `href="/"` with `event.preventDefault()` + clean SPA navigation to `'/'`.
    - Any non-navigating menu button, placeholder nav item, or settings toggle must either be a `<button type="button">` or call `event.preventDefault()` without `href="#/"` / `href="#"`, ensuring clicking **any** element in `HeaderBar.tsx` never appends `#/` or `#` to the URL.

### 3. Full Codebase Audit of Navigation Elements (`frontend/src/`)
- Search all files in `frontend/src/` (`app.tsx`, `pages/GamePage.tsx`, `components/GameTable.tsx`, `pages/LobbyPage.tsx`, `components/lobby/QuickPairingTab.tsx`, `components/lobby/CreateInviteTab.tsx`, `components/lobby/LobbyPoolTab.tsx`, `components/lobby/QaLobbyPresets.tsx`) for `#/`, `href="#"`, `location.hash`, `hashchange`, `pushState`, `replaceState`, and `location.href`.
- Update every "Back to Lobby" / "Return to Home" / "Leave" / error-state link or button in `GamePage.tsx`, `app.tsx`, and lobby components so that every homepage navigation action sets the URL to exact `'/'` (`pathname === '/'`, `search === ''`, `hash === ''`) and **zero** elements anywhere in the DOM carry `href="#/"` or write `#/` to the URL.

## 15-Second Human Testability Check
- Open `http://localhost:5173`:
  1. Click any instant-bot Quick Pairing tile (e.g., **2P vs BasicBot**) on the homepage to jump into `/g/<gameId>` in 1 click.
  2. Click the top-left **LIDURAK** logo in `HeaderBar`: verify immediately (< 3 seconds) that the UI returns to the homepage AND the browser URL bar reads `http://localhost:5173/` (not `http://localhost:5173/g/<gameId>#/` and not `http://localhost:5173/#/`).
  3. Enter another instant-bot game and click `PLAY` (or any other header/game return-to-home navigation control) and verify the URL again becomes exact `http://localhost:5173/` with no `#/` suffix.

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-3a (Top-Left `LIDURAK` Logo Clean Homepage URL):** Clicking the top-left `LIDURAK` brand logo in `HeaderBar.tsx` from any route (including `/g/<gameId>`) navigates back to `LobbyPage` (`app.tsx` / `useRoute.ts`) and sets the browser URL to exact `/` (`window.location.pathname === '/'`, `window.location.search === ''`, `window.location.hash === ''`, with zero `/g/<gameId>` remnant and zero `#/` suffix).
- [ ] **ITEM-3b (Zero `#/` Across All Navigation Elements):** Auditing `useRoute.ts`, `HeaderBar.tsx`, `app.tsx`, `GamePage.tsx`, `GameTable.tsx`, `LobbyPage.tsx`, and `components/lobby/*`, no link, menu item, button, or router helper anywhere in the frontend has `href="#/"` or puts `#/` (or `#`) at the end of the browser URL when clicked.
- [ ] **Automated Tests:**
  - Update/add tests in `frontend/src/router/useRoute.test.ts` verifying navigation from `/g/test-room` to homepage sets `pathname === '/'`, `search === ''`, and `hash === ''`, handles `popstate` cleanly, and strips any legacy `#/` on initial load.
  - Update/add tests in `frontend/src/__tests__/HeaderBar.test.tsx`, `frontend/src/__tests__/GamePage.test.tsx`, and `frontend/src/__tests__/app.test.tsx` verifying that from `/g/<gameId>`, clicking the top-left `LIDURAK` logo (as well as `PLAY` and any in-game return-to-lobby control) transitions to the homepage with `window.location.pathname === '/'` and `window.location.hash === ''`, and asserting zero rendered `<a>` elements have `href="#/"` or `href="#"`.
  - Run `npm test -- --run` (and `sbt -batch test` for final full-suite verification) with zero errors.

## Constraints & Workflow Rules
- Start by running `git status` and `git diff` to inspect changes from Waves 1 and 2.
- Do **NOT** modify `README.md`, `ARCHITECTURE.md`, `./play-local.sh`, `agent-orchestration/`, or host scripts.
- Never run `git commit`, `git checkout`, or `git branch`.
- Run `npm test -- --run` (in `frontend/`) and `sbt -batch test` (in `backend/`) and fix all errors before finishing.
- Write a concise implementation summary to `.reviews/agent_notes.md`, then as your final command run `echo "DONE" > .tickets/STATUS`.
