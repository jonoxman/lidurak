<!-- WAVE:2 -->
# Ticket T-90-feedback-20261031_180708-4-header-preferences: Top Header Bar, Navigation Menus, and Preferences Dropdown System (Sound, Theme, Table, Card Back)

## Wave: 2 (Runs in parallel with Table Arena Controls & Drag Polish; builds on Wave 1 Audio and CardBack catalog)

## Overview & Scope
Implement the persistent global Header Bar across all pages with interactive navigation dropdowns, seamless gradient shading, and an extensible User Profile Preferences menu containing submenus for Sound, Theme, Table Textures, and Card Back patterns, plus a live Connection Tracker.

This addresses items **6**, **7 (UI)**, **8**, **9**, and **10 (UI)**:
- **Requirement 6:**
  - Header bar at the top of every page.
  - Left: "LIDURAK" logo linking to `#` (home), hover color change, floating left margin.
  - 4 mouseover dropdown menus next to logo: "PLAY", "PUZZLES", "LEARN", "WATCH", containing placeholder links.
  - Right: Floating right margin. Placeholder username (e.g. "Guest") and SVG profile icon (person in circle), highlighting on hover.
  - Clicking profile opens a dropdown: Profile, Inbox, Preferences, Sign out, Language, Sound, Theme, Table, Card Back (with left icons for each).
  - Bottom of profile dropdown: Connection tracker with Ping (ms), Server Delay (ms), and an animated 4-bar signal strength indicator.
  - Header styling: slightly different shade from page, with a seamless vertical gradient transition into the page background.
- **Requirement 7 (UI):** Sound submenu opened from Sound item (with green chevron): interactive volume slider (local user) and clickable sound pack selector (5 packs, pale green hover highlight).
- **Requirement 8:** Theme submenu opened from Theme item (with green chevron): Device theme, Light, Dark options, plus a Roundness slider (0px to 16px, default 8px) setting `--border-radius` across the site.
- **Requirement 9:** Table submenu opened from Table item (with green chevron): Grid of at least 6 selectable table textures with previews, plus Brightness, Contrast, and Hue sliders applied in real time to the table arena.
- **Requirement 10 (UI):** Card Back submenu opened from Card Back item: Grid view of the 6 card back patterns from Ticket 3.

## Affected Files
- `frontend/src/components/HeaderBar.tsx` (new)
- `frontend/src/components/PreferencesModal.tsx` or dropdown submenu components
- `frontend/src/app.tsx`
- `frontend/src/app.css`
- `frontend/src/styles/table.css`
- `frontend/src/__tests__/HeaderBar.test.tsx` (new)
- `frontend/src/__tests__/app.test.tsx`

## Strict Autonomous Agent Rules Compliance
1. **Scope:** Only implement the header bar, dropdown menus, and preferences controls.
2. **Resuming Partial Work:** Run `git status` and `git diff` first.
3. **Mandatory Testing:** Run `npm test -- --run` and ensure all tests pass.
4. **Spatial Rules:** The header sits at the top of the flex/grid viewport layout. Do not disrupt the Lichess 3-column game layout.
5. **Completion Sentinel:** Run `echo "DONE" > .tickets/STATUS` after completion.

## Detailed Technical Specifications

### 1. Header Bar Layout & Gradient Shading (`frontend/src/components/HeaderBar.tsx`, `frontend/src/app.css`)
- Render `<header class="site-header" role="banner">` at the top of `App` in `frontend/src/app.tsx`.
- CSS styling:
  - Header background: `#161f1a` (slightly darker/tinted felt shade).
  - Page gradient transition: `.app` background gradient blending smoothly from `#161f1a` into `#1e2923` felt background.
  - Left container: Margin-left `1.5rem`. Logo `<a href="#" class="header-logo">LIDURAK</a>` with interactive color hover (`#4ade80`).
  - Navigation menus: "PLAY", "PUZZLES", "LEARN", "WATCH". Open on `:hover` / focus, displaying styled placeholder links.
  - Right container: Margin-right `1.5rem`. Profile button `<button class="header-profile-btn">` containing an SVG user icon (circle with person silhouette) and username "Guest".

### 2. Profile Dropdown & Submenus
Clicking the profile button toggles the dropdown containing:
- Items: Profile, Inbox, Preferences, Sign out, Language (with SVG icons on left; non-functional items act as clean placeholders).
- **Sound Item:** Green right-facing chevron (`›`). Clicking or hovering opens the Sound secondary panel:
  - Interactive volume slider (`<input type="range" min="0" max="100">`).
  - List of 5 sound packs: "Classic Felt", "Wood & Brass", "Arcade 8-Bit", "Minimal Crisp", "Synthwave".
  - Hover highlights with pale green (`rgba(74, 222, 128, 0.15)`). Selecting a pack calls `soundEngine.setPack(...)`.
- **Theme Item:** Green right-facing chevron (`›`). Opens Theme secondary panel:
  - Options: "Device theme", "Light", "Dark".
  - Roundness slider: `<input type="range" min="0" max="16" defaultValue="8">` updating `--border-radius: ${val}px;` on `:root`.
  - Light theme CSS class (`.theme-light`) applying an elegant chess-style light palette.
- **Table Item:** Green right-facing chevron (`›`). Opens Table secondary panel:
  - 6 selectable textures: Classic Green Felt, Emerald Velvet, Royal Navy, Walnut Wood, Obsidian Slate, Crimson Velvet.
  - Three live sliders: Brightness (50% to 150%), Contrast (50% to 150%), and Hue (-180deg to +180deg), applying CSS `filter` directly to `[data-zone="table-arena"]`.
- **Card Back Item:** Opens Card Back secondary panel displaying small grid previews of the 6 card back patterns. Selecting one updates the active card back pattern in state and `localStorage`.
- **Connection Tracker:** Fixed at the bottom of the dropdown:
  - Left: Two rows: "Ping: 24 ms" and "Server delay: 12 ms".
  - Right: Animated 4-bar SVG signal indicator reflecting connection strength.

## Step-by-Step Implementation Instructions
1. Create `frontend/src/components/HeaderBar.tsx` implementing the top navigation bar, logo with left margin, hover menus, and right profile button.
2. Build the dropdown menu with submenus for Sound, Theme, Table, and Card Back.
3. Wire Sound settings to `soundEngine` methods (`setVolume`, `setPack`).
4. Wire Theme settings to root CSS variables (`--border-radius`, `--theme-mode`).
5. Wire Table texture and CSS filter variables to `[data-zone="table-arena"]`.
6. Add the connection tracker with the animated 4-bar indicator at the bottom of the dropdown.
7. Include `HeaderBar` at the top of `frontend/src/app.tsx`.
8. Write unit tests in `frontend/src/__tests__/HeaderBar.test.tsx` verifying menu toggling, theme slider updates, sound pack selection, and table filter applications.

## Verification Commands
```bash
cd /home/shade_of_ox/agent-project/frontend
npm test -- --run src/__tests__/HeaderBar.test.tsx
npm test -- --run
```
