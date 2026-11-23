<!-- WAVE:1 -->
# Ticket T-90-3: Frontend Header, Profile Submenus, Lag-Switch, Audio Previews, Colorful Card Backs, Table Texture Filters, & Light Theme CSS

## Summary
Implement the header bar, profile dropdown, audio, card back, table texture, and global theme CSS improvements:
1. Replace the profile menu completely when opening any submenu (instead of popping out to the right side), with a header at the top of each submenu showing a left-facing chevron on the left and the submenu name that closes the submenu when clicked (Feedback #3).
2. Make the chevrons in the profile menu slightly larger (Feedback #4).
3. Render `PING` and `SERVER DELAY` in all caps with lowercase `ms`, and only animate the connection bar icon when the connection worsens or improves (number of bars changes) rather than pulsing constantly (Feedback #5).
4. Add a "lag-switch" development feature in the profile menu to manually set the ping and test the connection bar animation (Feedback #6).
5. Support real-time brightness, contrast, and hue slider adjustments on both the texture previews in the Table submenu and the shared table texture settings (`Emerald Felt` default) (Feedback #11).
6. Add more colorful card back options to the Card Back section of the profile submenu and `CardBack.tsx` (Feedback #12).
7. Play a random sample sound from the clicked sound pack when selecting a sound pack in the Sound submenu, and play a random sample sound at the new volume when adjusting the volume slider (Feedback #13).
8. Create an SVG logo for the site and place it to the left of `LIDURAK` inside the header brand link, shifting header items (except the right-aligned profile menu) to the right while keeping left/right header margins intact and highlighting the logo in the same hover color as `LIDURAK` (Feedback #15).
9. Ensure global theme CSS variables in `app.css` provide complete Light Theme styling for all pages, forms, inputs, buttons, and panels (Feedback #2).

---

## Strict File Boundaries (Wave 1 Parallel Execution)
- **ONLY modify these exact files:**
  - `frontend/src/state/settings.ts`
  - `frontend/src/styles/tableTextures.ts`
  - `frontend/src/__tests__/tableTextures.test.ts`
  - `frontend/src/components/CardBack.tsx`
  - `frontend/src/audio/SoundEngine.ts`
  - `frontend/src/__tests__/SoundEngine.test.ts`
  - `frontend/src/components/HeaderBar.tsx`
  - `frontend/src/__tests__/HeaderBar.test.tsx`
  - `frontend/src/app.css`
- **DO NOT touch any other files** (do not touch `Card.tsx`, `app.tsx`, `LobbyPage.tsx`, `GamePage.tsx`, `GameTable.tsx`, `table.css`, `client.ts`, `websocket.ts`, `types.ts`, or `backend/`).

---

## Detailed Requirements

### 1. In-Place Profile Submenus & Larger Chevrons (`HeaderBar.tsx`, `app.css`)
- When a user clicks any submenu row in the profile dropdown (e.g., `Theme` / `Background`, `Table`, `Card Back`, `Sound`), **do not** render a side flyout that pops out to the right of the dropdown.
- Instead, render the active submenu **in place of** the main profile menu items inside the same dropdown panel.
- At the top of every submenu, render a clickable submenu header element (`class="submenu-header"` / `data-testid="submenu-back"`) containing:
  - On the left side: a left-facing chevron (`‹` or SVG chevron)
  - The name of the submenu
  - Clicking this header/chevron closes the submenu and returns to the main profile menu.
- Make all chevrons in the profile menu (both the right-facing item chevrons and the left-facing submenu back chevron) slightly larger (`font-size: 1.25rem` / `18px–20px` SVG or text chevron with clear weight).

### 2. Uppercase `PING` & `SERVER DELAY`, Change-Only Connection Bar Animation, & Lag-Switch (`HeaderBar.tsx`, `app.css`)
- Format the labels in all caps: `PING` and `SERVER DELAY`, while keeping the unit in lowercase `ms` (e.g., `24 ms`).
- **Connection Bars Animation:**
  - Remove any infinite/constant pulsing CSS animation on the connection bars.
  - Only trigger a short bar-update animation class (e.g. `connection-bars-updating` or CSS transition on bar change) when the connection quality tier (number of active bars, 1..4) actually changes (worsens or improves), updating the number of active bars visually with no other special visual effect.
- **Lag-Switch Development Control:**
  - Inside the profile menu (in the connection/ping section), add a "Lag-Switch" control (`data-testid="lag-switch"`, e.g. a range slider or input + toggle/presets from `0 ms` to `500 ms`) that lets the user manually set/override the ping in `ms`.
  - When the manual ping value is changed across connection thresholds, the displayed `PING` (`XX ms`), the active bar count (`1` to `4` bars), and the single-shot bar transition animation update immediately.

### 3. Table Textures & Real-Time Brightness/Contrast/Hue Filters (`tableTextures.ts`, `settings.ts`, `HeaderBar.tsx`, `app.css`)
- Ensure `emerald-felt` (`Emerald Felt`) is the default table texture in `settings.ts` and `tableTextures.ts`.
- Provide a helper in `tableTextures.ts` / `settings.ts` (e.g. `getTableFilterCss(settings)` returning `brightness(${brightness}%) contrast(${contrast}%) hue-rotate(${hue}deg)` and `getTableTextureStyle(settings)`) and sync CSS custom properties on `document.documentElement` (`--table-texture-bg`, `--table-filter`, etc.).
- In the `Table` submenu of `HeaderBar.tsx`, apply the current `brightness`, `contrast`, and `hue` filter values directly to the inline style of every texture preview swatch in real time as the sliders are adjusted.

### 4. More Colorful Card Back Options (`CardBack.tsx`, `settings.ts`, `HeaderBar.tsx`)
- Expand the available card backs in `settings.ts`, `CardBack.tsx`, and the `Card Back` submenu in `HeaderBar.tsx` with vibrant, colorful designs (for example: Classic Crimson, Royal Sapphire, Emerald Gold, Sunset Prism, Amethyst Nebula, Cyber Neon, Coral Wave, etc.), ensuring each option has rich multi-color SVG/gradient artwork in `CardBack.tsx` and a matching preview in the submenu.

### 5. Sound Pack & Volume Sample Playback (`SoundEngine.ts`, `HeaderBar.tsx`)
- Add `playSampleSound(pack?: SoundPack, volume?: number): void` on `SoundEngine` that plays a randomly chosen sample sound from the sound effects repertoire using the specified (or active) sound pack and volume.
- In `HeaderBar.tsx` (`Sound` submenu):
  - Clicking a sound pack option updates the selected sound pack and immediately calls `soundEngine.playSampleSound(...)` for that pack.
  - Adjusting the volume slider updates the volume setting and immediately calls `soundEngine.playSampleSound(...)` at the new volume.

### 6. Header Bar SVG Logo (`HeaderBar.tsx`, `app.css`)
- Create a clean SVG logo (`data-testid="header-logo"`, `class="header-logo"`) and place it immediately to the left of the `LIDURAK` text inside the same `<a href="#/" class="header-brand">` link.
- Keep the left and right outer margins/padding of the header bar unchanged; all elements on the left side of the header bar move slightly to the right to accommodate the logo, while the profile menu stays anchored on the right.
- Style `.header-brand` and `.header-logo` (using `currentColor` or shared hover rules) so hovering over the link highlights both the SVG logo and the `LIDURAK` text in the exact same accent color.

### 7. Global Light Theme CSS Variables (`app.css`)
- Ensure `html[data-theme="light"]` (and light OS preference when theme is `system`/`device`) defines clean light-mode surface, card, input, select, border, and text variables in `app.css`, and style `.lobby-page`, `.lobby-form`, `.field input`, `.field select`, `.checkbox-field`, `.created-room`, and `.server-loading-page` so all pages adapt seamlessly to the chosen theme.

---

## Verification & Testing
1. Update and add unit tests in:
   - `frontend/src/__tests__/HeaderBar.test.tsx`:
     - Verify submenu replaces the main profile menu in-place and has a top header with submenu title and left chevron that closes the submenu when clicked.
     - Verify `PING` and `SERVER DELAY` are uppercase with lowercase `ms`.
     - Verify the lag-switch manually sets ping and triggers connection bar updates without constant pulsing.
     - Verify clicking a sound pack or changing the volume slider triggers a sample sound.
     - Verify the SVG logo is rendered inside the `LIDURAK` link to the left of the text.
   - `frontend/src/__tests__/SoundEngine.test.ts` and `frontend/src/__tests__/tableTextures.test.ts`:
     - Verify `playSampleSound` and real-time texture filter helpers.
2. Run:
   ```bash
   cd frontend && npm test -- --run src/__tests__/HeaderBar.test.tsx src/__tests__/SoundEngine.test.ts src/__tests__/tableTextures.test.ts
   ```
3. Write a concise summary of your changes in `.reviews/agent_notes.md` and run `echo "DONE" > .tickets/STATUS`.
