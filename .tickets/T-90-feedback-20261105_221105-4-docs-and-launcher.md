<!-- WAVE:3 -->
# T-90-feedback-20261105_221105-4 — Documentation (`README.md`, `ARCHITECTURE.md`) & Local Launcher (`./play-local.sh`) Sync

## Summary
Synchronize `./README.md`, `./ARCHITECTURE.md`, and `./play-local.sh` with all changes implemented in Waves 1 and 2, and run both backend and frontend test suites to ensure a 100% green repository.

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-8 (Documentation & Launcher Synchronization):**
  - Update `./README.md` (preserving the `<!-- USER_SECTION_START -->` ... `<!-- USER_SECTION_END -->` block untouched!) to document:
    - Throwing in single or multiple cards by dragging to the additional-card outline or click-selecting multiple legal cards and double-clicking to deploy them all at once (with the `"Throw In"` button removed).
    - The additional-card outline appearing only for players who can legally throw in cards.
    - The compact, theme-matched non-verbal SVG icon buttons for **Surrender** (cards with downward arrow into two raised hands) and **Pass** in the bottom-right corner of the table.
    - The responsive `20%–80%` hand overlap and tightly wrapped non-rectangular hand highlight contour.
  - Update `./ARCHITECTURE.md` to accurately describe:
    - Full `100px × 140px` desktop card sizing (`48px × 68px` mobile) matching battlefield target, redirect, and throw-in outlines.
    - `handLayout.ts` `20%` minimum to `80%` maximum overlap calculation (plus full-deck pickup protection keeping the left-side rank & suit index visible) and the dynamic SVG non-rectangular hand highlight contour (`[data-testid="hand-highlight-contour"]`).
    - Multi-card throw-in selection & double-click deployment, role-gated throw-in outline visibility, and compact theme-matched SVG icon buttons for Surrender and Pass.
  - Verify `./play-local.sh` remains executable (`chmod +x play-local.sh`) and cleanly launches both backend (`:8080`) and frontend (`:5173`).

## Verification & Test Commands
Run both full test suites before completing:
```bash
cd backend && sbt -batch test
cd frontend && npm test -- --run
```
