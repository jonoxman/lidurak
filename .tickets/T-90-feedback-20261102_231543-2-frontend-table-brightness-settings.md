<!-- WAVE:1 -->
# Ticket T-90-2: Frontend Table Texture Default Absolute Brightness Adjustment (Light & Dark Modes)

## Scope & Files to Touch
- **Touch ONLY these files:**
  - `frontend/src/styles/tableTextures.ts`
  - `frontend/src/__tests__/tableTextures.test.ts`
- **DO NOT touch any other frontend or backend files in this ticket.**

---

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-PB-4 (Default Absolute Table Brightness in Light Mode and Dark Mode):**
  > "4. The texture looks correct. However, modify the default table brightness slightly - it should be a little darker in light mode, and a little lighter in dark mode (the dark mode version of the table should still be darker than the light mode version, however). Note that the sliders visible to the user should stay at their current default position - it is the absolute brightness that should be modified."
  1. **Keep Slider Default at `100`:**
     - `DEFAULT_TABLE_BRIGHTNESS` (and `DEFAULT_SETTINGS.tableBrightness` in `settings.ts`) MUST remain at `100` so the Brightness slider visible to the user in the HeaderBar `Table` submenu stays at its default `100%` position.
  2. **Theme-Aware Absolute Brightness Calibration in `frontend/src/styles/tableTextures.ts`:**
     - Introduce explicit theme brightness calibration constants in `tableTextures.ts`, e.g.:
       - `DARK_MODE_BRIGHTNESS_FACTOR` (e.g. `1.10` — makes the dark mode table slightly lighter than before at slider `100`)
       - `LIGHT_MODE_BRIGHTNESS_FACTOR` (e.g. `0.90` — makes the light mode table slightly darker than before at slider `100`)
     - Also tune the `TABLE_TEXTURES` dark `base` hex colors (slightly lighter than before, e.g. `#24332b` for Emerald Felt) and light `lightBase` hex colors (slightly darker than before, e.g. `#c7dfd0` for Emerald Felt) AND/OR apply the theme factor in `getTableFilterCss` / `textureFilter` and `tableTextureStyle` / `getTableTextureStyle` so that:
       - At the default slider position (`brightness = 100`), the absolute brightness of the table in **light mode** is slightly darker than `1.0` (`brightness(0.9)` / darker light palette),
       - At the default slider position (`brightness = 100`), the absolute brightness of the table in **dark mode** is slightly lighter than `1.0` (`brightness(1.1)` / lighter dark palette),
       - For every texture preset in `TABLE_TEXTURES`, the **dark mode version of the table is still distinctly darker than the light mode version** (verify relative luminance of dark mode vs light mode for all 6 presets!).
     - Ensure `getTableFilterCss(brightness, contrast, hue, theme?)` and `textureFilter` work cleanly with both explicit `theme` (`'light' | 'dark' | 'device'`) and document theme resolution (`resolveTableTheme`), while still scaling proportionally when the user moves the Brightness slider between `50` and `150`.
  3. **Unit Tests (`frontend/src/__tests__/tableTextures.test.ts`):**
     - Add/update tests verifying:
       - Default slider value remains `100`.
       - At default slider `100`, dark mode absolute brightness is slightly lighter than the unadjusted baseline and light mode absolute brightness is slightly darker than the unadjusted baseline.
       - For all 6 presets, the effective dark-mode table surface remains darker (lower luminance) than the effective light-mode table surface.

---

## Verification Commands
```bash
cd frontend && npm test -- --run src/__tests__/tableTextures.test.ts
```
