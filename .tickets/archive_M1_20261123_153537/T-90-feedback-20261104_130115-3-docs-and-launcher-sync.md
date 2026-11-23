<!-- WAVE:3 -->
# T-90-feedback-20261104_130115-3 — Real-Time Documentation & Launcher Synchronization (`README.md`, `ARCHITECTURE.md`, `play-local.sh`)

## Summary
Synchronize `./README.md`, `./ARCHITECTURE.md`, and verify `./play-local.sh` so all project documentation accurately reflects the Wave 1 and Wave 2 implementations (`ITEM-PREV-4a`, `ITEM-PREV-4b`, `ITEM-QA-1`, `ITEM-NEW-1a`, `ITEM-NEW-1b`, `ITEM-NEW-1c`, `ITEM-NEW-1d`).

---

## Mandatory Acceptance Criteria Checklist

- [ ] **ITEM-DOCS-1 (Synchronize `README.md`, `ARCHITECTURE.md`, and `play-local.sh`):**
  - Update `./README.md`:
    1. Document the **`Highlights`** section inside **`Guest` ▸ `Theme`** (placed below `Roundness` and above `PING` / `SERVER DELAY`), listing all **6 highlight color scheme presets** (`Classic`, `Warm`, `Cool`, `Neon`, `Pastel`, `Royal`), the multi-line color highlight preview inside each preset button, and the real-time **`Intensity`** slider (`20%–200%`) that scales all table and menu highlight auras live.
    2. Document that uncovered in-play attacking cards (`.table-card-uncovered`) are highlighted **only for the defending player** (`view.myId === defenderId`) and **immediately stop being highlighted when the decision to surrender is made** (when `Surrender` is clicked, when the 3-second auto-surrender countdown fires, or during `BoutPhase.SurrenderThrowIn`).
    3. Document that **neither the Game clock nor the Turn clock is highlighted during normal play**, and only the Turn clock half highlights when the timer ticks down to its final 5 seconds (`00:05`–`00:01`).
    4. Update the **15-second QA verification flow** in `./README.md` so a human reviewer can verify all three features immediately using the one-click `⚡ QA Scenarios` (`Surrender Half-Off`, `Defenseless Auto-Surrender`, `3P Redirect (Bob POV)`, `4P Chaos Targets`) and `Guest ▸ Theme ▸ Highlights`.
  - Update `./ARCHITECTURE.md`:
    1. Document `HighlightPresetId`, `HIGHLIGHT_PRESETS`, `highlightIntensity`, and the real-time CSS custom property scaling in `frontend/src/state/settings.ts`, `HeaderBar.tsx`, `app.css`, and `table.css`.
    2. Document the defender-only and pre-surrender gating of `.table-card-uncovered` / `data-uncovered-highlighted` across `GamePage.tsx`, `GameTable.tsx`, and `TablePair.tsx`.
    3. Document the clock highlight behavior (`data-highlighted="true"` only when `data-low-time="true"` at `<= 5` seconds) in `GamePage.tsx` and `table.css`.
  - Verify `./play-local.sh` remains executable and starts both backend (`:8080`) and frontend (`:5173`) cleanly.

---

## Automated Verification
Run both test suites to ensure everything passes cleanly before writing `.reviews/agent_notes.md` and signaling completion:
```bash
cd frontend && npm test -- --run
cd backend && sbt -batch test
```
