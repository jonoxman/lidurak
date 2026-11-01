<!-- WAVE:2 -->
# Ticket T-90-4: Frontend App & Lobby — Server Readiness Loading Page, Redundant Title Removal, Bot Seat Dropdowns, & Light Theme Adaptation

## Summary
1. Display a themed loading page when the frontend opens before the backend server is ready (`checkServerHealth()`), preventing the user from attempting to create a game and receiving `"Could not create game (HTTP 500)"` (Feedback #1).
2. Ensure all elements on the Create a Game page (`LobbyPage.tsx`) and app shell adapt to the user's chosen theme, including the Light theme (Feedback #2).
3. Remove the redundant `<h1 class="app-title">Lidurak</h1>` below `<HeaderBar />` in `app.tsx` (Feedback #14).
4. Add a second dropdown next to each player's name input on the Create Game form in `LobbyPage.tsx` to select who is playing (`Human` or `RandomBot`) and pass `playerTypes` when creating a game (Feedback #17).

---

## Strict File Boundaries (Wave 2 Parallel Execution)
- **ONLY modify these exact files:**
  - `frontend/src/app.tsx`
  - `frontend/src/pages/LobbyPage.tsx`
  - `frontend/src/__tests__/app.test.tsx`
  - `frontend/src/__tests__/LobbyPage.test.tsx`
- **DO NOT touch any other files** (do not touch `GamePage.tsx`, `GameTable.tsx`, `table.css`, `HeaderBar.tsx`, `Card.tsx`, `CardBack.tsx`, `backend/`, or docs).

---

## Detailed Requirements

### 1. Remove Redundant `Lidurak` Heading Below Header Bar (`frontend/src/app.tsx`)
- Remove `<h1 class="app-title">Lidurak</h1>` from `App` in `frontend/src/app.tsx` since the `LIDURAK` brand link + logo in `HeaderBar` is always present at the top of the page.
- Update any assertions in `frontend/src/__tests__/app.test.tsx` that previously queried `.app-title`.

### 2. Server Readiness Loading Page (`frontend/src/pages/LobbyPage.tsx` / `frontend/src/app.tsx`)
- When the app / lobby loads, check backend readiness using `checkServerHealth()` from `../api/client`.
- While the backend server is still starting up (when `checkServerHealth()` returns `false` or rejects, or while waiting for the initial readiness check when `checkServerHealth` indicates the backend is not ready):
  - Display a clean, theme-aware loading view (`data-testid="server-loading"`, `role="status"`) with a loading indicator and message (e.g., `"Starting game server, please wait…"`), hiding the Create Game form so the user cannot submit and hit an HTTP 500 proxy error.
  - Poll `checkServerHealth()` periodically (e.g. every `1000ms`) until it returns `true`, then automatically transition to the Lobby form.
  - Also, if `createGame(...)` fails with an `HTTP 500` / `502` / `503` / `504` or network error because the server was still warming up, switch to the loading view and poll `checkServerHealth()` until the server is ready instead of showing `"Could not create game (HTTP 500)"`.
- **Testing Ergonomics Note:** Ensure `LobbyPage` accepts an optional `initialServerReady?: boolean` prop (or resolves `checkServerHealth()` cleanly when `fetch` is unmocked vs mocked in tests) and update `LobbyPage.test.tsx` and `app.test.tsx` so all existing lobby tests pass AND add explicit tests verifying that when the server health check returns 500 / `false`, the loading screen is displayed instead of the Create Game button until the server becomes ready.

### 3. Player Type Dropdown (`Human` vs `RandomBot`) in `LobbyPage.tsx`
- Maintain `playerTypes: string[]` state in `LobbyPage`, initialized to `['human', 'human']` (defaulting new seats to `'human'` or preserving existing selections when `playerCount` changes between 2, 3, and 4).
- For each player row in `.name-fields`, alongside the player name `<input>`, render a `<select>` dropdown (`aria-label={`Player ${index + 1} type`}`, `data-testid={`player-type-${index}`}`) with options:
  - `<option value="human">Human</option>`
  - `<option value="randomBot">RandomBot</option>`
- Pass `playerTypes` as the 5th argument to `createGame(playerCount, names, allowRedirect, playerCount > 2 && chaosMode, playerTypes)`.

### 4. Theme Adaptation on Create Game Page (`LobbyPage.tsx`)
- Ensure all elements rendered by `LobbyPage.tsx` (headings, form card, labels, player name inputs, player type dropdowns, checkboxes, created room links, loading state) use theme-aware classes that adapt to both dark and light themes (`html[data-theme="light"]`).

---

## Verification & Testing
1. Update and add unit tests in `frontend/src/__tests__/app.test.tsx` and `frontend/src/__tests__/LobbyPage.test.tsx`:
   - Verify `.app-title` (`<h1 class="app-title">Lidurak</h1>`) is no longer rendered below the header bar.
   - Verify the loading page is shown when the backend is not ready (e.g. `/api/health` returns HTTP 500) and transitions to the Create Game form once `/api/health` returns 200 OK.
   - Verify each player row in `LobbyPage` renders both a name input and a player type dropdown (`Human` / `RandomBot`), and selecting `RandomBot` passes `playerTypes` to `createGame`.
2. Run:
   ```bash
   cd frontend && npm test -- --run src/__tests__/app.test.tsx src/__tests__/LobbyPage.test.tsx
   ```
3. Write a concise summary of your changes in `.reviews/agent_notes.md` and run `echo "DONE" > .tickets/STATUS`.
