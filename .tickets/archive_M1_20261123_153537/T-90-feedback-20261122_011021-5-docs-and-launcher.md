<!-- WAVE:3 -->
# T-90-feedback-20261122_011021-5-docs-and-launcher: Update Project Documentation (`README.md`, `ARCHITECTURE.md`) & Verify Local Launcher (`play-local.sh`)

## Scope & Owned Files
Only modify/verify these root documentation and launcher files:
- `README.md`
- `ARCHITECTURE.md`
- `play-local.sh` (verify and update if any startup flags, ports, or environment details changed)

Do NOT modify source code in `backend/` or `frontend/`.

## Requirements & Architecture
1. **Update `README.md`:**
   - Document the updated interaction controls:
     - Throwing in cards via dragging onto the additional-card outline, double-clicking a single legal card, or clicking to select multiple legal cards and double-clicking to deploy them all at once (noting removal of the legacy `"Throw In"` button).
     - Compact theme-matched icon-only Surrender (two raised hands beneath cards with downward arrow) and Pass buttons in the bottom-right corner of the game table.
     - Always-visible card drag-and-drop and full-size playing cards matching the throw-in/redirect outlines.
   - Update the QA Scenario Presets table/list in `README.md` to include the two new 1-click presets (`throw-in-multi-qa` and `large-hand-stress`) and how to use them locally after running `./play-local.sh`.

2. **Update `ARCHITECTURE.md`:**
   - Document the strict throw-in outline visibility contract between `PlayerGameView.scala` (`canThrowIn`, `throwInCards`, `throwInCapacity`, `myHasPassed`, `defenderIdx`) and `GameTable.tsx`.
   - Document the unified canonical card dimension tokens (`100px × 140px` desktop / `48px × 68px` mobile) shared across `Card.tsx`, `CardBack.tsx`, `TablePair.tsx`, `[data-testid="throw-in-outline"]`, and `[data-testid="redirect-outline"]`.
   - Document the new `frontend/src/utils/handLayout.ts` geometry & SVG contour module: dynamic 20%–80% overlap clamping, full-deck (30–52 card) overflow-safe hand fitting, left-side rank+suit corner guarantee, and non-rectangular tight hand highlight SVG contour that distorts around upward-shifted playable/selected cards inside the CSS Grid `[data-zone="player-hand"]` track.
   - Document the redesigned icon-only `SurrenderIcon.tsx`, `PassIcon.tsx`, `actionIcons.css`, and multi-card `ThrowInCards` batch deployment flow.

3. **Verify `./play-local.sh`:**
   - Inspect `./play-local.sh` to ensure it cleanly launches both backend (`http://localhost:8080`) and frontend (`http://localhost:5173`) without error, updating it only if any build target, port, or command changed.
   - Run both test suites (`sbt -batch test` in `backend/` and `npm test -- --run` in `frontend/`) to confirm the entire repository passes cleanly before completion.

## Mandatory Acceptance Criteria Checklist
- [ ] `README.md` accurately documents all implemented UX changes (throw-in outline visibility rules, unified full-size cards, responsive hand overlap & tight contour, always-visible drag, drag/double-click/multi-select throw-in without a Throw In button, compact themed icon-only Surrender & Pass buttons, and the new `throw-in-multi-qa` & `large-hand-stress` QA Scenario Presets).
- [ ] `ARCHITECTURE.md` accurately documents the backend `PlayerGameView` / multi-card `ThrowInCards` contract, `frontend/src/utils/handLayout.ts` layout & SVG contour engine, unified card sizing CSS tokens, icon-only `ActionBar` architecture, and QA preset endpoints.
- [ ] `./play-local.sh` is verified (and updated if needed) so it starts backend (`:8080`) and frontend (`:5173`) cleanly.
- [ ] Full verification passes: `sbt -batch test` in `backend/` and `npm test -- --run` in `frontend/` both succeed with 0 failures.
