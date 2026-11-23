<!-- WAVE:1 -->
# Ticket T-90-3: Remove Lag-Switch Feature & Fix Lobby Server-Startup Spinner Animation

## Context & Motivation
1. **Lobby Loading Wheel Animation (Req 2):** When the backend server is first starting, the loading wheel on the Lobby page (`Starting game server, please wait…`) appears frozen. It needs a smooth, continuous spinning animation.
2. **Remove Lag-Switch Feature (Req 5):** Now that the connection bar and ping measurement work properly, the development lag-switch slider under the connection metrics in the profile dropdown must be removed completely from the project.

## Scope & Files to Touch
- **Allowed files:**
  - `frontend/src/state/settings.ts`
  - `frontend/src/components/HeaderBar.tsx`
  - `frontend/src/pages/LobbyPage.tsx`
  - `frontend/src/app.css`
  - `frontend/src/__tests__/HeaderBar.test.tsx`
  - `frontend/src/__tests__/LobbyPage.test.tsx`
- **Do NOT touch:** `GameTable.tsx`, `GamePage.tsx`, `Card.tsx`, `table.css`, `tableTextures.ts`, `README.md`, `ARCHITECTURE.md`, or backend files.

## Detailed Requirements

### 1. Fix the Lobby Loading Wheel Spinning Animation (`LobbyPage.tsx`, `app.css`)
- Inspect the server-startup loading state in `frontend/src/pages/LobbyPage.tsx` (`data-testid="server-loading"` / `.lobby-loading-spinner` or equivalent spinner element) and its styles in `frontend/src/app.css`.
- Ensure the spinner element:
  - Has a distinct circular ring with a high-contrast accent top/right border (e.g., `border: 3px solid var(--border-subtle, rgba(255, 255, 255, 0.2)); border-top-color: var(--accent-primary, #3893e8); border-radius: 50%;`).
  - Has an active, non-frozen CSS `@keyframes` rotation animation (`animation: lidurak-spin 0.85s linear infinite;`) defined in `frontend/src/app.css`:
    ```css
    @keyframes lidurak-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    ```
  - Is NOT disabled or overridden by any rule in `app.css` (ensure no global rule strips its `animation` or `transform`).

### 2. Remove the Lag-Switch Feature Entirely (`HeaderBar.tsx`, `settings.ts`, `app.css`, `HeaderBar.test.tsx`)
- In `frontend/src/components/HeaderBar.tsx`:
  - Remove the lag-switch slider UI (`data-testid="lag-switch-slider"`, `.lag-switch-control`, labels, and state handlers) from the profile menu connection section.
  - Keep the connection tracker (`PING`, `SERVER DELAY`, `ms` values, and the 4-bar signal indicator with tier colors and pop animation on tier change) working using the live measured ping (`pingMs`).
- In `frontend/src/state/settings.ts` (if any lag-switch state/setting exists there):
  - Remove any lag-switch setting fields or helpers.
- In `frontend/src/app.css`:
  - Remove unused `.lag-switch-*` CSS rules.
- In `frontend/src/__tests__/HeaderBar.test.tsx`:
  - Remove obsolete tests that specifically interacted with the lag-switch slider, and add/update tests to verify:
    1. The connection bar (`PING`, `SERVER DELAY`, and signal bars) still renders and updates properly with `pingMs` prop / live ping.
    2. No lag-switch slider (`[data-testid="lag-switch-slider"]` or `"Lag-Switch"`) is rendered anywhere in the header or profile dropdown.

## Acceptance Criteria & Verification
1. Run `cd frontend && npm test -- --run` and ensure all test suites pass.
2. Verify in `LobbyPage.test.tsx` that when the server health check is pending/unavailable, the loading spinner element renders with the spinning animation class (`lobby-loading-spinner`).
3. Verify in `HeaderBar.test.tsx` that the lag-switch slider is completely gone while the connection tracker and 4-bar indicator remain intact.
4. Write your implementation summary to `.reviews/agent_notes.md` and run `echo "DONE" > .tickets/STATUS`.
