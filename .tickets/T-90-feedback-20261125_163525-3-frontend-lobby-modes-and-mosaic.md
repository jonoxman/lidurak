<!-- WAVE:2 -->
# Ticket T-90-3: Homepage 12-Tile Quick Pairing Grid (52-Card & Instant Bot Tiles), Faded Mosaic Logo Background & Visual Seat/52-Card Create a Game UI

## Scope & File Ownership (WAVE 2 — Depends on T-90-1 & T-90-2)
Ticket T-90-1 (backend endpoints) and Ticket T-90-2 (`BrandLogo.tsx`, `sessionClient.ts`, `types/multiplayer.ts`, `lobbyClient.ts`, 4P spectator table) are complete. Do **NOT** touch `backend/**`, `README.md`, `ARCHITECTURE.md`, `agent-orchestration/`, or host scripts.

### Primary Files to Inspect & Update
- `frontend/src/components/lobby/QuickPairingTab.tsx`
- `frontend/src/components/lobby/CreateInviteTab.tsx`
- `frontend/src/components/lobby/QaLobbyPresets.tsx`
- `frontend/src/pages/LobbyPage.tsx`
- `frontend/src/styles/lobby.css`
- `frontend/src/pages/LobbyPage.test.tsx`
- `frontend/src/__tests__/LobbyPage.test.tsx`

## Technical Implementation Requirements

### 1. 12 Homepage Quick Pairing Tiles: 3 New 52-Card Tiles (`ITEM-6b`) + 3 New Instant-Start Bot Tiles (`ITEM-7c`)
1. Inspect `frontend/src/components/lobby/QuickPairingTab.tsx` and keep the existing **6** standard Quick Pairing tiles intact.
2. **Add 3 Additional 52-Card Mode Tiles (`ITEM-6b`):**
   - Add **exactly 3** additional tiles playing the 52-card setting (`deckSize: 52`) across `< 4` player counts (`2P` and `3P` — do NOT generate all variations):
     - `2P` · `15s` · `52 cards` (`playerCount: 2, turnTimeoutSeconds: 15, deckSize: 52`)
     - `2P` · `30s` · `52 cards` (`playerCount: 2, turnTimeoutSeconds: 30, deckSize: 52`)
     - `3P` · `30s` · `52 cards` (`playerCount: 3, turnTimeoutSeconds: 30, deckSize: 52`)
   - Clicking any of these 3 tiles calls `joinQuickPair` with `deckSize: 52` (remaining in the lobby searching state until matched by another player or by the QA quick-pair opponent preset button in `QaLobbyPresets.tsx`).
3. **Add 3 Instant-Start Bot Tiles (`ITEM-7c`) — Total of 12 Homepage Tiles:**
   - Add **exactly 3** bot tiles bringing the Quick Pairing homepage grid to **12 tiles total** (arranged cleanly in a 3-column × 4-row CSS Grid on desktop at `1280x800`, preserving `min-height: 96px` double-height tile proportions with zero overlap and zero text clipping):
     1. **2P vs RandomBot** (`playerCount: 2, botOpponent: 'randomBot'`, e.g., `15s` or `30s` turn clock)
     2. **2P vs BasicBot** (`playerCount: 2, botOpponent: 'basicBot'`, e.g., `15s` or `30s` turn clock)
     3. **4P vs BasicBot** (`playerCount: 4, botOpponent: 'basicBot'` — 1 human player + 3 `BasicBot` opponents)
   - Wire `LobbyPage.tsx` + `QuickPairingTab.tsx` so clicking any of these 3 bot tiles sends `POST /api/quick-pair` with `botOpponent`, receives the immediate `matched` response (`{ status: "matched", gameId, seatIndex: 0 }`), and **immediately navigates to `/g/<gameId>`** without entering a waiting/searching queue state!

### 2. Large Faded Mosaic Background Logo Split Across Quick Pairing Tiles (`ITEM-8b`)
1. Import `getBrandLogoMosaicDataUri` (from `frontend/src/components/BrandLogo.tsx` created in T-90-2) into `QuickPairingTab.tsx`.
2. Render a **faded** large version of the top-left logo in **mosaic fashion** across the Quick Pairing tiles:
   - The single large logo spans the full bounding box of `.quick-pair-grid` and is **split across the individual tiles** so each `.quick-pair-tile` renders ONLY its spatial slice of that unified logo inside its clipped background (`background-repeat: no-repeat`, clipped to the tile's `border-radius`, completely invisible in the CSS Grid `gap` spaces between tiles!).
   - Use exact grid coordinate math (`ResizeObserver` on `.quick-pair-grid` measuring `gridRect` and each tile's `tileRect` to set `backgroundSize: "${gridWidth}px ${gridHeight}px"` and `backgroundPosition: "${-(tileLeft - gridLeft)}px ${-(tileTop - gridTop)}px"`, with pure-CSS percentage/calc fallback when `gridWidth === 0` in JSDOM tests: `backgroundSize: calc(var(--mosaic-cols) * 100% + (var(--mosaic-cols) - 1) * var(--quick-grid-gap)) calc(var(--mosaic-rows) * 100% + (var(--mosaic-rows) - 1) * var(--quick-grid-gap))` and `backgroundPosition: ${(col / (cols - 1)) * 100}% ${(row / (rows - 1)) * 100}%`, plus `data-mosaic-col={col}` and `data-mosaic-row={row}` attributes on each tile).
   - Observe `document.documentElement` `data-theme` attribute changes (`MutationObserver`) so switching between Dark and Light themes in `HeaderBar` updates `getBrandLogoMosaicDataUri(theme)` immediately while keeping the mosaic subtle/faded so foreground tile text has crisp contrast.

### 3. `Create a Game` 52-Card Setting (`ITEM-6b`) & Right-Half Visual Seat Selector + Dev All-Bot Spectator Start (`ITEM-7d`)
1. **2-Column Desktop Layout Using Right Half (`CreateInviteTab.tsx`, `styles/lobby.css`):**
   - On desktop viewports (e.g., `1280x800`), structure `form.create-invite-form` inside `section.m2-panel.create-invite[aria-label="Create a Game"]` as a 2-column CSS Grid (`gap`, `min-width: 0; box-sizing: border-box;`, stacking to 1 column on narrow mobile viewports) so the game settings sit in the left column and the visual seat-selection table uses the previously unused space on the **right half** without extending the vertical height of `Create a Game`!
   - Do **NOT** use `position: absolute` or `position: fixed` anywhere in the seat selector or layout.
   - Do **NOT** add any instructional or explanatory text strings anywhere in `CreateInviteTab.tsx`.
2. **52-Card Deck Game Setting (`[data-testid="create-game-deck-size"]`):**
   - Keep `Visibility` (`[data-testid="create-game-visibility"]`) first in the left column, followed by `Players` (`2`, `3`, `4`), a `Deck` segmented control (`[data-testid="create-game-deck-size"]` with `36 cards` and `52 cards` `button.segmented-option` buttons), `Redirect / reflect` toggle, `Time control per turn`, and `Create room` (`button.m2-button.primary[type="submit"]`).
   - When `playerCount` is `2` or `3`, allow toggling between `36 cards` (default) and `52 cards`.
   - When `playerCount` is switched to `4`, automatically select `52 cards` and disable `36 cards` (since 4-player Durak always uses 52 cards). Remove the old `p.create-invite-note` text note.
   - Pass `deckSize` (`36` or `52`) in `POST /api/games`.
3. **Visual, Intuitive Per-Seat Selection (`[data-testid="create-game-seat-map"]`) & Dev All-Bot Spectator Launch:**
   - In the right column of `Create a Game`, render a visual mini-table diagram (`[data-testid="create-game-seat-map"]`) arranged via CSS Grid displaying `playerCount` seat cards (`[data-testid="seat-card-0"]` .. `[data-testid="seat-card-<playerCount-1>"]`, e.g., top + bottom for 2P; 2 top + 1 bottom for 3P; 3 top/sides + 1 bottom for 4P around a visual felt center).
   - Each seat card visually displays an intuitive icon (user/person icon for Human, dice icon for `RandomBot`, bot/chip icon for `BasicBot`) + concise seat occupant badge (`You` / guest name when occupied by the creator, `Human` for open human seats, `RandomBot`, `BasicBot`) and compact interactive seat-type buttons/cycle controls (`Human`, `RandomBot`, `BasicBot`) with **zero text instructions**.
   - **Production Lock vs Dev-Mode Deselection (`allowAllBots?: boolean`, defaulting to `import.meta.env.DEV`):**
     - Seat `0` (bottom seat) defaults to the game creator (`You` / guest name, type `'human'`), while Seats `1 .. playerCount - 1` default to open `'human'` seats.
     - When `allowAllBots === false` (production), Seat `0` is locked to the creator (`'human'`), while Seats `1 .. playerCount - 1` can each be freely set to `'human'`, `'randomBot'`, or `'basicBot'`.
     - When `allowAllBots === true` (dev mode — active in `./play-local.sh` / `npm run dev`), Seat `0` can ALSO be toggled from `You` (`'human'`) to `'randomBot'` or `'basicBot'` (deselecting the creator as a player). When the creator deselects themselves so all seats are bots (or Seat `0` is a bot and remaining seats are bots), clicking `Create room` submits `POST /api/games` with `seatTypes` (all bots), `creatorSeatIndex: null`, and `spectateAsCreator: true`, and `LobbyPage.tsx` navigates immediately to `/g/<gameId>` where the user watches the live all-bot match in **spectator mode**!
   - Do not add any resting `box-shadow` glow to new tiles or seat controls (hover-only highlight).

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-6b (Verbatim Requirement — "Implement as a game setting the option to play with all 52 cards even if there are less than 4 players. Add tiles on the homepage to play this mode with different player counts with this new setting. Do not include all variations - only three additional tiles should be created."):**
  - `CreateInviteTab.tsx` exposes the `36 cards` / `52 cards` deck setting for `< 4` players (`2P` and `3P`, locked to `52 cards` for `4P`) and sends `deckSize` to `POST /api/games`.
  - `QuickPairingTab.tsx` renders **3** additional 52-card tiles covering `2P` and `3P` (`2P 15s 52c`, `2P 30s 52c`, `3P 30s 52c`), wired to `POST /api/quick-pair` with `deckSize: 52` and testable in < 15s via `QaLobbyPresets.tsx`.
- [ ] **ITEM-7c (Verbatim Requirement — "Three tiles should be added to the homepage tiles (for a total of 12, with Step 6 above): 2-player matches with BasicBot and RandomBot, and a 4-player match with all other players being BasicBot. Clicking these tiles should start the game immediately without waiting for additional players - the intuition is that the bot players are always counted as queued up for these types of games (but not for the normal game queue)."):**
  - `QuickPairingTab.tsx` renders 12 tiles total (6 standard + 3 52-card + 3 bot tiles: `2P` vs `RandomBot`, `2P` vs `BasicBot`, `4P` vs 3× `BasicBot`), and clicking any bot tile starts the game and navigates to `/g/<gameId>` in 1 click without queueing.
- [ ] **ITEM-7d (Verbatim Requirement — "Additionally include the option to add bot players into the Create a Game menu - the menu should have a section in which each seat at the table is selected to be either a human or a bot player. When possible, do not extend the height of the Create a Game element - instead, make use of the unused space on the right half of the element. Implement the player-seat selection in a visual and intuitive way that will be obvious to the user without explanation - do not add any text instructions. In production, the user creating the game will be locked in as one of the seats. However, for dev testing only, the user should also be able to start the game with all players being bots (i.e. deselect themselves as a player), in which case starting the game should send the user directly to the spectator mode in which they can watch the game freely but cannot interact with gameplay."):**
  - `CreateInviteTab.tsx` places the visual CSS-Grid seat selector in the right half on desktop without extending panel height and with zero instructional text.
  - Each seat is selectable between Human, `RandomBot`, and `BasicBot`; Seat `0` is locked to Human when `allowAllBots={false}` and selectable to bots in dev mode (`allowAllBots={true}`), sending the creator directly to `/g/<gameId>` in spectator mode when all seats are bots.
- [ ] **ITEM-8b (Verbatim Requirement — "Create a large version of the logo currently used in the top-left of the page. A faded version of this logo should appear in the background tiles on the lobby in a mosaic fashion, split between the (currently six) tiles."):**
  - `QuickPairingTab.tsx` renders the faded large `BrandLogo` split in a mosaic across the 12 Quick Pairing tiles (clipped inside each tile, hidden in grid gaps, theme-reactive between dark and light palettes).
- [ ] **Mandatory Testing & Completion Protocol:**
  - Run `git status` and `git diff` first.
  - Update and expand `frontend/src/pages/LobbyPage.test.tsx` and/or `frontend/src/__tests__/LobbyPage.test.tsx` to test all 12 homepage tiles, instant bot tile navigation, mosaic background styling/attributes across tiles, 52-card setting for 2P/3P/4P, right-half visual seat selector, `allowAllBots={false}` production lock, and `allowAllBots={true}` all-bot spectator creation.
  - Run `cd frontend && npm test -- --run` and ensure **100% of frontend tests pass**.
  - Write implementation summary to `.reviews/agent_notes.md` and run `echo "DONE" > .tickets/STATUS`.
