<!-- WAVE:3 -->
# T-90-4: Synchronize `README.md`, `ARCHITECTURE.md`, and `play-local.sh` with Pre-Surrender Red Hand Glow, Centered Card Pips, and Light-Mode Glows

## Summary
Per the Mandatory Real-Time Documentation & Launcher Maintenance rules in `AGENTS.md`, synchronize `./README.md`, `./ARCHITECTURE.md`, and `./play-local.sh` with all changes implemented in Waves 1 and 2 (`ITEM-PREV-4`, `ITEM-3a`, `ITEM-3b`, `ITEM-1a`, `ITEM-1b`), and run the full backend and frontend test suites to verify everything is green.

## Scope & Files to Touch
- `README.md`
- `ARCHITECTURE.md`
- `play-local.sh` (verify executable and in sync)

## Technical Implementation Details

### 1. Update `README.md`
- **Bottom Row / Hand Highlight & `Surrender Half-Off` / `Defenseless Auto-Surrender` Presets (`ITEM-PREV-4`):**
  - Update the hand highlight description and the `Surrender Half-Off` and `Defenseless Auto-Surrender` rows in the **`⚡ QA Scenario Presets`** table so they accurately document that:
    - The **red glow around the defending player's hand DOES appear before the decision to surrender is made** (throughout `BoutPhase.Defense` when facing uncovered cards, including when the defender has no legal moves and the `Surrender 3 → 2 → 1` countdown is running).
    - Once the `Surrender` button is pressed manually or "presses itself" automatically after 3 seconds (transitioning into `BoutPhase.SurrenderThrowIn`), the red glow around the surrendering player's hand immediately disappears (`data-highlighted="false"`, `data-surrendering="true"`).
- **Card Faces (`ITEM-3a` & `ITEM-3b`):**
  - Update the **Card Faces** section to document that numbered-card face pips (`2`–`10`), court card center letters (`J`, `Q`, `K`) and their decoration pips, and the Ace's large single center pip (`A`) are centered at `(x = 35, y = 50)` on the `70 × 100` SVG canvas with identical horizontal margins (`leftMargin === rightMargin`) and identical vertical margins (`topMargin === bottomMargin`) on both sides.
- **Appearance & Light Mode Emphasis Glows (`ITEM-1a` & `ITEM-1b`):**
  - Document that in the `Light` theme, all emphasis and highlighting glows across the game area (hand turn-prompt glows, trump cards, uncovered attacking cards, target/reflection outlines, action buttons), sidebars (`PLAYERS` attacker/defender glows, active clock half, `POV` tabs, `HAND SORTING`), and menus/swatches use darker, high-contrast colors for clear visibility, while `Dark` mode retains its original glows.

### 2. Update `ARCHITECTURE.md`
- Update Section 2.2 (QA preset notes) and Section 3 (`GamePage.tsx`, `GameTable.tsx`, `Card.tsx`, `app.css`, `table.css`) to reflect:
  - Pre-surrender defender red hand glow (`data-highlighted="true"`, `data-highlight-variant="defender"`) before `Surrender` is pressed or auto-fires, and removal (`data-highlighted="false"`, `data-surrendering="true"`) once `Surrender` is pressed or enters `BoutPhase.SurrenderThrowIn`.
  - Symmetric `(35, 50)` card face centering with equal horizontal and vertical margins for numbered pips (`2`–`10`), court letters (`J`/`Q`/`K`), and the Ace single pip (`A`).
  - Darker, higher-contrast light-mode emphasis glow tokens/rules under `html[data-theme='light']` across `app.css` and `table.css`.

### 3. Verify Full Test Suites
- Run both `cd backend && sbt -batch test` and `cd frontend && npm test -- --run` to ensure 100% of backend and frontend tests pass.

## Mandatory Acceptance Criteria Checklist
- [ ] **`README.md` Synchronized:** Accurately documents `ITEM-PREV-4` (red hand glow shown before surrender decision, removed once Surrender is pressed or auto-fires), `ITEM-3a`/`ITEM-3b` (centered pips, court letters, and Ace pip with equal vertical and horizontal margins), and `ITEM-1a`/`ITEM-1b` (darker, more visible emphasis glows in light mode across the game area, sidebars, and menus).
- [ ] **`ARCHITECTURE.md` Synchronized:** Accurately documents the updated component contracts, SVG coordinates, and light-mode CSS glow architecture.
- [ ] **All Backend & Frontend Tests Pass:** `cd backend && sbt -batch test` and `cd frontend && npm test -- --run` both exit with code `0`.
