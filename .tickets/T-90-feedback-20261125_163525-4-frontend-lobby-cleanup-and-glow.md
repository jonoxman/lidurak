<!-- WAVE:3 -->
# Ticket T-90-4: Remove Lobby Explanation Texts, Remove Second Lobby Header Bar & Enforce Hover-Only Glow Across Lobby UI

## Scope & File Ownership (WAVE 3 — Final Lobby Polish & Verification, Depends on T-90-3)
Tickets T-90-1, T-90-2, and T-90-3 are complete. Do **NOT** touch `backend/**`, `README.md`, `ARCHITECTURE.md`, `agent-orchestration/`, or host scripts.

### Primary Files to Inspect & Update
- `frontend/src/pages/LobbyPage.tsx`
- `frontend/src/components/lobby/LobbyPoolTab.tsx`
- `frontend/src/components/lobby/QuickPairingTab.tsx`
- `frontend/src/components/lobby/CreateInviteTab.tsx`
- `frontend/src/components/lobby/QaLobbyPresets.tsx`
- `frontend/src/styles/lobby.css`
- `frontend/src/pages/LobbyPage.test.tsx`
- `frontend/src/__tests__/LobbyPage.test.tsx`

## Technical Implementation Requirements

### 1. Remove ALL Explanation Texts Under Headers (`ITEM-1`)
1. Audit every component rendered on `LobbyPage.tsx` (`LobbyPage.tsx`, `QuickPairingTab.tsx`, `LobbyPoolTab.tsx`, `CreateInviteTab.tsx`, `QaLobbyPresets.tsx`):
   - Remove `"Open public rooms, updated live. Join any table with a free seat."` under `"Lobby Pool"` in `LobbyPoolTab.tsx`.
   - Remove `"Choose whether this is a private invite link or a public pool table, then set the rest of the table options."` under `"Create a Game"` in `CreateInviteTab.tsx` (if still present).
   - Remove any small-font header subtitle/explanation/hint paragraphs (`.m2-panel-hint`, `.lobby-subtitle`, `.create-invite-note`, or any descriptive helper sentences under section/panel headers in Quick Pairing, Lobby Pool, Create a Game, or QA Presets).
   - Keep essential interactive status UI (such as active quick-pair searching status + cancel button, empty-table placeholder if zero public rooms exist or keep it minimal/non-header-hint, and error alerts if a network call fails), while ensuring **zero `.m2-panel-hint` or header explanation subtitles** exist anywhere in the lobby DOM.

### 2. Remove the Second Header Bar from `LobbyPage` (`ITEM-2`)
1. Inspect `frontend/src/pages/LobbyPage.tsx` (and `frontend/src/app.tsx` read-only to confirm `<HeaderBar />` is already rendered globally at the top of the app).
2. Remove the lobby-specific second `<header>` bar from `LobbyPage.tsx` — specifically the bar starting with `"♠"` / `"LIDURAK"` / `"Play Durak with friends"` (and any redundant guest badge inside that removed bar, since `HeaderBar` now displays the guest name in the top-right profile menu from T-90-2).
3. Ensure `LobbyPage.tsx` still initializes/reads the shared guest session from `sessionClient.ts` as needed for API calls and passes `guestName` to `CreateInviteTab` if used for the creator's seat label.
4. Clean up dead CSS rules for the removed second header bar in `frontend/src/styles/lobby.css`.

### 3. Enforce Hover-Only Glow on the Lobby Page (`ITEM-5`)
1. Audit **every rule** in `frontend/src/styles/lobby.css` (and any styles applied to elements inside `LobbyPage.tsx`, `QuickPairingTab.tsx`, `LobbyPoolTab.tsx`, `CreateInviteTab.tsx`, and `QaLobbyPresets.tsx`) for `box-shadow`, `text-shadow`, and `filter: drop-shadow(...)`:
   - **Zero Default / Resting Glow:** Remove all `box-shadow` glow effects (`var(--ui-select-glow)`, colored `rgba(...)` glows, neon halos, or ambient shadows) from resting/default states of:
     - Panels (`section.m2-panel`), cards, and containers
     - Quick-pairing tiles (`.quick-pair-tile`) at rest
     - Segmented control options, **including** active/selected options (`button.segmented-option[aria-pressed="true"]`) at rest — style active/selected states using crisp flat border and background tokens (`--ui-select-border`, `--ui-select-bg`, `--ui-select-accent`) with `box-shadow: none` when not hovered!
     - Primary & secondary buttons (`button.m2-button`, `button.m2-button.primary`) at rest (`box-shadow: none`)
     - Seat-selector cards/buttons in `CreateInviteTab.tsx` at rest (`box-shadow: none`)
     - Lobby tabs, pool rows, and checkboxes/toggles at rest (`box-shadow: none`)
   - **Hover-Only Interactive Highlight:** Apply the subtle glow highlight (`box-shadow: 0 0 0 1px var(--ui-select-border), 0 0 12px var(--ui-select-glow)` or equivalent `--ui-select-glow` highlight) **ONLY on `:hover:not(:disabled)`** of interactive elements (buttons, `.quick-pair-tile:hover:not(:disabled)`, `button.segmented-option:hover:not(:disabled)`, interactive seat controls on `:hover:not(:disabled)`), in both Dark and Light (`html[data-theme="light"]`) themes!

## Mandatory Acceptance Criteria Checklist
- [ ] **ITEM-1 (Verbatim Requirement — 'Remove all explanation texts (the small-font texts under the headers - for example, under "Lobby Pool", we have "Open public rooms, updated live. Join any table with a free seat." The UI is intuitive enough not to require these.'):**
  - Wired across `LobbyPage.tsx`, `QuickPairingTab.tsx`, `LobbyPoolTab.tsx`, `CreateInviteTab.tsx`, and `QaLobbyPresets.tsx`: zero `.m2-panel-hint` elements or small-font explanation texts appear under any header on `http://localhost:5173/` (observable in < 2 seconds).
- [ ] **ITEM-2 (Verbatim Requirement — 'Remove the second header bar from the lobby page (the one starting with "♠LIDURAKPlay Durak with friends").'):**
  - Wired in `LobbyPage.tsx` and `styles/lobby.css`: only the single top `HeaderBar` exists when viewing `http://localhost:5173/`; the second header bar containing `"LIDURAK"` / `"Play Durak with friends"` is completely absent from the DOM (observable in < 2 seconds).
- [ ] **ITEM-5 (Verbatim Requirement — "The glow effect is overused on the lobby page. It should only appear as a highlight when an interactive element, such as a button, is moused over - never should it just be on the page by default."):**
  - Wired in `frontend/src/styles/lobby.css`: at rest (no pointer hover), panels (`section.m2-panel`), quick-pairing tiles (`.quick-pair-tile`), active segmented buttons (`button.segmented-option[aria-pressed="true"]`), primary buttons (`button.m2-button.primary`), and seat-selector buttons all have `box-shadow: none` (zero glow by default), and hovering over interactive buttons/tiles applies the `:hover` highlight glow cleanly in both Dark and Light themes (observable in < 5 seconds).
- [ ] **Mandatory Testing & Completion Protocol:**
  - Run `git status` and `git diff` first.
  - Update `frontend/src/pages/LobbyPage.test.tsx` and `frontend/src/__tests__/LobbyPage.test.tsx` to remove any stale assertions expecting the old second header or `.m2-panel-hint` explanation texts, and add explicit unit tests asserting:
    1. Absence of `"Play Durak with friends"` / second `<header>` inside `LobbyPage`,
    2. Absence of `"Open public rooms, updated live"` / `"Choose whether this is a private invite link"` / `.m2-panel-hint` across all lobby sections,
    3. CSS rule / style verification that resting lobby panels, tiles, `aria-pressed="true"` segmented buttons, and `.m2-button.primary` have `box-shadow: none` while `:hover` rules define the glow highlight,
    4. All Wave 2 features (12 tiles, 52-card setting, visual right-half seat selector, mosaic background, bot instant start, and dev all-bot spectator start) continue to pass 100%.
  - Run `cd frontend && npm test -- --run` and ensure **100% of frontend tests pass**.
  - Write implementation summary to `.reviews/agent_notes.md` and run `echo "DONE" > .tickets/STATUS`.
