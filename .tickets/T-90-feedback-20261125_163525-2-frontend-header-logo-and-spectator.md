<!-- WAVE:1 -->
# Ticket T-90-2: Frontend Header Guest Name & Right-Aligned User Icon, Scalable BrandLogo Component, Multiplayer Client Contracts & 4P Spectator Table Support

## Scope & File Ownership (WAVE 1 — Frontend Header, Logo, Contracts & Gameplay Spectator Only)
You run in parallel with Ticket T-90-1 (`backend/**`). Do **NOT** touch `backend/**`, `frontend/src/pages/LobbyPage.tsx`, `frontend/src/components/lobby/**`, `frontend/src/styles/lobby.css`, `frontend/src/pages/LobbyPage.test.tsx`, `frontend/src/__tests__/LobbyPage.test.tsx`, `README.md`, `ARCHITECTURE.md`, `agent-orchestration/`, or host scripts.

### Primary Files to Create / Update
- `frontend/src/components/BrandLogo.tsx` *(new)*
- `frontend/src/components/HeaderBar.tsx`
- `frontend/src/api/sessionClient.ts`
- `frontend/src/app.css`
- `frontend/src/types/multiplayer.ts`
- `frontend/src/api/lobbyClient.ts`
- `frontend/src/api/multiplayerClients.test.ts`
- `frontend/src/components/GameTable.tsx`
- `frontend/src/pages/GamePage.tsx`
- `frontend/src/utils/tableLayout.ts`
- `frontend/src/styles/table.css`
- `frontend/src/__tests__/HeaderBar.test.tsx`
- `frontend/src/__tests__/GameTable.test.tsx`
- `frontend/src/__tests__/GamePage.test.tsx`

## Technical Implementation Requirements

### 1. Guest Name in Top-Right Profile Menu (`ITEM-3`) & User Icon on Right Side of Name (`ITEM-4`)
1. **Shared Guest Session Loader (`frontend/src/api/sessionClient.ts`):**
   - Inspect `sessionClient.ts` to see how guest sessions (`GET /api/session` or `POST /api/session`) are currently fetched/stored.
   - Add a shared memoized/in-flight deduplicated helper (e.g., `ensureGuestSession()` + `getCachedGuestSession()` + optional listener/reset helper for tests) so both `HeaderBar.tsx` and `LobbyPage.tsx` retrieve the exact same backend-generated guest `displayName` without issuing duplicate competing session requests, degrading gracefully without unhandled rejections when `fetch` is unavailable in isolated component unit tests.
2. **Profile Menu Button Guest Name & Icon Order (`frontend/src/components/HeaderBar.tsx`, `frontend/src/app.css`):**
   - When the user is not logged in (guest session, always the case in the current phase), `HeaderBar.tsx` must fetch/display the automatically generated guest name in the top-right profile menu button (and inside the profile dropdown header if a user label is shown; while loading or in unit tests with no mocked session endpoint unless passed via optional prop `guestName?: string`, fall back cleanly to cached guest name or default guest label, updating immediately once `ensureGuestSession()` resolves).
   - **Rearrange the profile menu's button element** (`HeaderBar.tsx` & `app.css`) so the **name of the user is on the LEFT** and the **user icon is on the RIGHT** side of the user's name (`[guestName] [userIcon]` in DOM order and visual flex order, with `iconRect.left >= nameRect.right`).
   - Preserve existing profile menu behaviors (opening/closing dropdown, clicking outside to close dropdown, Dark/Light theme switcher, Roundness slider, Sound toggle, etc.).

### 2. Large Scalable Version of Top-Left Logo (`ITEM-8a` — `frontend/src/components/BrandLogo.tsx`)
1. Inspect the exact logo mark + wordmark currently rendered in the top-left of `HeaderBar.tsx`.
2. Create `frontend/src/components/BrandLogo.tsx`:
   - Export `<BrandLogo size="header" | "large" className?: string />` rendering a crisp, scalable vector `<svg>` version of that exact top-left logo.
   - Update `HeaderBar.tsx` to render `<BrandLogo size="header" />` in the top-left brand link/container so the header logo and large mosaic logo share one single source of truth.
   - Export `getBrandLogoMosaicDataUri(theme: 'dark' | 'light'): string` returning a `url("data:image/svg+xml,...")` CSS value (with `preserveAspectRatio="xMidYMid meet"` and subtle theme-appropriate stroke/fill contrast for dark and light palettes) so Wave 2 (`QuickPairingTab.tsx`) can render the faded large logo across the Quick Pairing mosaic tiles cleanly via CSS `background-image`.

### 3. Backward-Compatible Multiplayer Types & HTTP Client Contracts (`ITEM-7b` — `types/multiplayer.ts`, `lobbyClient.ts`)
Inspect `frontend/src/types/multiplayer.ts` and `frontend/src/api/lobbyClient.ts` and extend them **strictly backward-compatibly** (all new request fields optional so existing `LobbyPage.tsx`, `QuickPairingTab.tsx`, and `CreateInviteTab.tsx` compile and pass tests without edits in Wave 1) to match Ticket T-90-1's backend JSON contract:
- `SeatType = 'human' | 'randomBot' | 'basicBot'`
- `DeckSize = 36 | 52`
- `CreateRoomRequest` (or `CreateGamePayload`): add optional `deckSize?: DeckSize`, `seatTypes?: SeatType[]`, `creatorSeatIndex?: number | null`, `spectateAsCreator?: boolean`.
- `CreateRoomResponse`: allow `seatIndex: number | null` and optional `role?: 'player' | 'spectator'`.
- `LobbyRoomSummary`: add optional `deckSize?: number`.
- `QuickPairRequest`: add optional `deckSize?: DeckSize` and `botOpponent?: 'randomBot' | 'basicBot'`.

### 4. Spectator Mode Layout & Read-Only Enforcement for 2P, 3P, and 4P All-Bot Matches (`ITEM-7b` — `GamePage.tsx`, `GameTable.tsx`, `tableLayout.ts`, `styles/table.css`)
When a user in dev mode starts an all-bot match (including a **4-player** all-bot match) and is sent to `/g/:gameId` as a spectator:
- `view.myHand` is `[]`, `view.legalActions` is `[]`, and `view.opponents` contains all seated players (`2`, `3`, or **`4`** bot players!).
- Inspect `frontend/src/utils/tableLayout.ts`, `frontend/src/components/GameTable.tsx`, and `frontend/src/pages/GamePage.tsx`:
  - Ensure `tableLayout.ts` and `GameTable.tsx` support `opponents.length === 4` in spectator mode without crashing, dropping the 4th player, or violating CSS Grid spatial rules (`NEVER` use `position: absolute` or `position: fixed` to place seats, hands, bouts, or sidebars!). Specifically: place 3 seats in Row 1 (`data-seat="top-left"`, `data-seat="top-center"`, `data-seat="top-right"`) and when `opponents.length === 4` (spectator watching a 4-player match with empty `myHand`), render the 4th bot seat cleanly in Row 3 Col 2 (`[data-zone="player-hand"]` / `data-seat="bottom-center"`) showing its name, turn highlight, and face-down `CardBack`s!
  - Ensure spectators have **zero gameplay interaction** (`Pass` / `Surrender` buttons hidden, target/redirect outlines hidden, card clicks/drags disabled, and zero table text banners per AGENTS.md Rule 3).

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-3 (Verbatim Requirement — "If the user is not logged in (always the case in the current phase of implementation), display the automatically generated guest name in the top-right profile menu."):**
  - Wired into `HeaderBar.tsx` via `sessionClient.ts`: opening `http://localhost:5173/` or `/g/:gameId` displays the backend-generated guest `displayName` in the top-right profile menu button (observable in < 2 seconds).
- [ ] **ITEM-4 (Verbatim Requirement — "Rearrange the profile menu's button element so that the user icon is on the right side of the name of the user, instead of on the left as it is currently."):**
  - Wired into `HeaderBar.tsx` and `app.css`: inside the profile menu button element, the user's name element comes first (left) and the user icon element comes second (right).
- [ ] **ITEM-8a (Verbatim Requirement — "Create a large version of the logo currently used in the top-left of the page."):**
  - Created in `frontend/src/components/BrandLogo.tsx`, rendered in the top-left of `HeaderBar.tsx`, and exported with `size="large"` plus `getBrandLogoMosaicDataUri(theme)` for Wave 2's lobby tile mosaic.
- [ ] **ITEM-7b (Verbatim Requirement — "...for dev testing only, the user should also be able to start the game with all players being bots (i.e. deselect themselves as a player), in which case starting the game should send the user directly to the spectator mode in which they can watch the game freely but cannot interact with gameplay."):**
  - `types/multiplayer.ts` and `lobbyClient.ts` support `deckSize`, `seatTypes`, `creatorSeatIndex`, `spectateAsCreator`, and `botOpponent`.
  - `GamePage.tsx`, `GameTable.tsx`, and `tableLayout.ts` render 2P, 3P, and 4P spectator games cleanly inside the 3x3 CSS Grid felt table (all 4 bot seats visible without overlap in a 4-bot match) while blocking all gameplay interactions.
- [ ] **Mandatory Testing & Completion Protocol:**
  - Run `git status` and `git diff` first.
  - Add/update unit tests in `HeaderBar.test.tsx` (guest name display + name-left/icon-right order + `BrandLogo`), `multiplayerClients.test.ts` (new request/response fields), `GameTable.test.tsx`, and `GamePage.test.tsx` (4-player all-bot spectator rendering & read-only enforcement).
  - Run `cd frontend && npm test -- --run` and ensure **100% of frontend tests pass** (including untouched `LobbyPage.test.tsx`).
  - Write implementation summary to `.reviews/agent_notes.md` and run `echo "DONE" > .tickets/STATUS`.
