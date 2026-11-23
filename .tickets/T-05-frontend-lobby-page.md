<!-- WAVE:2 -->
# T-05: Homepage Lobby UI — Quick Pairing, Real-Time Lobby Pool, Invite Creator & QA Presets

## Goal
Build the Lichess-inspired Homepage Lobby (`/`) component suite featuring *Quick Pairing* (`2P`/`3P`/`4P` presets), real-time *Lobby Pool* streamed over `/ws/lobby`, *Create Invite Link* configurator, guest display name badge, and 1-click Lobby QA Scenario Presets.

## Scope & Owned Files
Create new files strictly under:
- `frontend/src/pages/LobbyPage.tsx`
- `frontend/src/components/lobby/QuickPairingTab.tsx`
- `frontend/src/components/lobby/LobbyPoolTab.tsx`
- `frontend/src/components/lobby/CreateInviteTab.tsx`
- `frontend/src/components/lobby/QaLobbyPresets.tsx`
- `frontend/src/styles/lobby.css`
- `frontend/src/pages/LobbyPage.test.tsx`

> **Do NOT edit** `App.tsx`, `GamePage.tsx`, `vite.config.ts`, `README.md`, or `ARCHITECTURE.md` in this ticket (`App.tsx` routing integration happens in `T-08`).

## Design Details
1. **Visual Design & Layout Invariants (`lobby.css`):**
   - Dark-mode Lichess aesthetic: `#161512` page background, `#262421` surface cards/panels, `#bababa` primary text, `#629924` active turn / primary CTA / live status green, `#c33` trump suit / accent red.
   - Pure CSS Grid & Flexbox with explicit `gap`, `min-width: 0; box-sizing: border-box;`. **NO `position: absolute` or `position: fixed`** for placing layout sections or panels.
   - Responsive from `360px` mobile screens up to `1920px` desktop monitors without horizontal overflow.
2. **Top Header & Guest Identity (`LobbyPage.tsx`):**
   - Calls `getOrCreateSession()` on mount to hydrate the visitor's `GuestSession`.
   - Displays Lidurak brand header + live lobby connection indicator + editable guest identity badge (`Guest-XXXX`) allowing inline rename via `updateGuestName(...)`.
   - Tab navigation bar switching between:
     - `Quick Pairing` (default active tab)
     - `Lobby Pool` (shows live count badge of open rooms)
     - `Create Invite Link`
3. **Quick Pairing Tab (`QuickPairingTab.tsx`):**
   - Responsive 3-column (desktop) / 2-column (mobile) grid of Lichess-style pairing tiles covering `2P`, `3P`, and `4P` presets:
     - `2P • 15s` (Redirect ON), `2P • 30s` (Redirect ON)
     - `3P • 15s` (Redirect ON), `3P • 30s` (Redirect ON)
     - `4P • 15s` (Redirect ON), `4P • 30s` (Redirect ON)
   - Clicking a tile calls `joinQuickPair(preset)`:
     - Immediately navigates to `/g/${res.gameId}` once assigned to an open/matched room (or shows active searching indicator with a Cancel button calling `cancelQuickPair()` if queued).
4. **Real-Time Lobby Pool Tab (`LobbyPoolTab.tsx`):**
   - Subscribes to `/ws/lobby` via `connectLobbySocket` (with initial REST hydration fallback via `fetchLobbyRooms()`).
   - Renders live open public rooms in a clean table/card list showing:
     - Host display name
     - Player count (`filledSeats / playerCount`, e.g., `1 / 2`, `2 / 3`)
     - Rules badges (`Redirect ON` / `Redirect OFF`, `36-card` vs `52-card` derived from playerCount)
     - Turn clock (`15s`, `30s`, `60s`)
     - 1-click **Join** button that calls `joinRoom(room.gameId)` and navigates to `/g/${room.gameId}`.
   - Displays a clean empty-state prompt when no public rooms are open (with quick button to Create Room or Seed QA Rooms).
5. **Create Invite Link Tab (`CreateInviteTab.tsx`):**
   - Configurable controls:
     - Players: `2`, `3`, or `4` (segmented buttons; notes 36-card deck for 2–3P, 52-card deck for 4P).
     - Redirect / Reflect: `ON` (default) / `OFF` toggle.
     - Time Control per Turn: `15s` (default), `30s`, `60s`.
     - Visibility: `Private Invite Link` (`isPublic: false`) vs `Public Lobby Pool` (`isPublic: true`).
   - Submitting calls `createRoom(...)` and navigates directly to `/g/${res.gameId}`.
6. **1-Click Lobby QA Scenario Presets (`QaLobbyPresets.tsx`):**
   - Clean collapsible or sidebar panel on the Lobby page enabling a human reviewer to test M2 in 1 click:
     - **Seed Open Lobby Pool** -> calls `seedLobbyPreset()` and switches to the *Lobby Pool* tab so 3 open rooms appear live via `/ws/lobby`.
     - **Launch 2P Invite Room (1/2)** -> creates a shareable 2P room and opens `/g/:gameId` ready to copy/open in an incognito tab.
     - **Launch Active Projected Match** -> calls `createActiveMatchPreset(2)` and navigates to `/g/:gameId` as Seat 0 to verify live `PlayerGameView` play.
     - **Launch Spectator Zero-Leak View** -> calls `createSpectatorMatchPreset()` and navigates to `/g/:gameId` as a non-seated Spectator (`hand: []`).

## Mandatory Acceptance Criteria Checklist
- [ ] **REQ-09:** `LobbyPage` renders in the dark Lichess palette (`#161512`, `#262421`, `#bababa`, `#629924`, `#c33`), uses CSS Grid/Flexbox only (zero `position: absolute`/`fixed` layout hacks), and adapts cleanly from `360px` to `1920px`.
- [ ] **REQ-09:** Guest identity badge loads via `getOrCreateSession()` and supports inline nickname editing via `updateGuestName()`.
- [ ] **REQ-09:** *Quick Pairing* tab displays `2P`, `3P`, and `4P` preset tiles that invoke `joinQuickPair` and navigate to `/g/:gameId`.
- [ ] **REQ-10:** *Lobby Pool* tab streams real-time open rooms from `/ws/lobby` (updating immediately on `LobbySnapshot` / `LobbyUpdated`) and provides a 1-click Join action navigating to `/g/:gameId`.
- [ ] **REQ-10:** *Create Invite Link* tab allows configuring `2/3/4` players, `Redirect ON/OFF`, turn clock (`15s`/`30s`/`60s`), and `Public`/`Private` visibility, creates the room, and routes to `/g/:gameId`.
- [ ] **REQ-10:** `QaLobbyPresets` exposes 1-click buttons for seeding the live Lobby Pool, launching a shareable invite room, launching an active projected match, and launching a Spectator Zero-Leak match.
- [ ] Vitest tests in `LobbyPage.test.tsx` verify tab switching, Quick Pairing click flow, live `/ws/lobby` snapshot updates & Join navigation, Create Invite form submission, guest rename, and QA preset triggers.
- [ ] All frontend tests pass cleanly via `cd frontend && npm test -- --run`.

## Verification Commands
```bash
cd frontend && npm test -- --run
```

