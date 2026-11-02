<!-- WAVE:1 -->
# Ticket 2: HeaderBar Ping Bar Colors & Volume Slider Sound on Mouse Release

## Summary
Update the `HeaderBar` connection indicator and sound submenu:
1. Color the active ping bars **yellow** when there are 2 bars (`tier === 2`), **red** when there is 1 bar (`tier === 1`), and **green** only when there are 3 or 4 bars (`tier === 3` or `tier === 4`).
2. In the Sound submenu, adjusting the volume slider must only play one sample sound when the mouse/pointer is released from the selector, instead of playing a sound on every slider movement.

## Files to Modify
- `frontend/src/components/HeaderBar.tsx`
- `frontend/src/app.css`
- `frontend/src/__tests__/HeaderBar.test.tsx`

*(Do NOT modify `GamePage.tsx`, `GameTable.tsx`, `table.css`, `README.md`, or `ARCHITECTURE.md` in this ticket.)*

## Requirements

### 1. Ping Indicator Bar Colors (`HeaderBar.tsx` & `app.css`)
- Keep the existing latency tier thresholds in `connectionLevel(pingMs)`:
  - `4` bars: `pingMs <= 60`
  - `3` bars: `60 < pingMs <= 150`
  - `2` bars: `150 < pingMs <= 300`
  - `1` bar: `pingMs > 300`
- Color the active bars based on the number of active bars (`level`):
  - **3 or 4 bars (`level === 3` or `level === 4`):** Active bars are colored **green** (e.g., `#2dc653`, `data-bar-color="green"`).
  - **2 bars (`level === 2`):** Active bars are colored **yellow** (e.g., `#eab308`, `data-bar-color="yellow"`).
  - **1 bar (`level === 1`):** The active bar is colored **red** (e.g., `#ef4444`, `data-bar-color="red"`).
- Expose clear attributes/classes (such as `data-level={level}` and `data-bar-color={barColor}` on `.connection-bars` and/or `.connection-bar.active`, plus corresponding CSS rules in `app.css` and inline/class styling) so both visual rendering and unit tests can verify the exact bar color for each tier.

### 2. Volume Slider Single Sample Sound on Release (`HeaderBar.tsx`)
- In the Sound submenu volume `<input type="range">`:
  - Moving the slider (`onInput`) must immediately update the volume setting and UI percentage readout (`setSettings({ volume: nextVolume })` / `soundEngine.setVolume(nextVolume)`), **without** calling `soundEngine.playSampleSound(...)`.
  - `soundEngine.playSampleSound(...)` must **only** be called once when the user releases the slider selector (handle `onMouseUp` / `onPointerUp` / `onTouchEnd`, deduplicated within the same event turn so a single pointer/mouse release triggers `playSampleSound` once at the selected volume).

## Acceptance Criteria & Testing
1. Update/add tests in `frontend/src/__tests__/HeaderBar.test.tsx` verifying:
   - 4 bars (`<= 60 ms`) and 3 bars (`<= 150 ms`) color active bars green (`data-bar-color="green"`).
   - 2 bars (`<= 300 ms`) colors the 2 active bars yellow (`data-bar-color="yellow"`).
   - 1 bar (`> 300 ms`) colors the 1 active bar red (`data-bar-color="red"`).
   - Firing multiple `input` events on the volume slider updates the volume state and percentage label while calling `playSampleSound` `0` times, and firing `mouseUp` / `pointerUp` on the volume slider calls `playSampleSound` exactly once with the updated volume.
2. Run `cd frontend && npm test -- --run` and ensure all frontend tests pass.
