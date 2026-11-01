# Autonomous Agent Rules (STRICT)

## Core Workflow Rules
1. **Scope:** Only implement the requirements specified in the assigned `.tickets/T-XX.md` file. Never touch `agent-orchestration/` or host scripts.
2. **Resuming Partial Work:** Always start by running `git status` and `git diff` to see existing progress. Do not duplicate or overwrite working code.
3. **Mandatory Testing:** You MUST run the project test suite in the terminal (`sbt -batch test` and/or `npm test -- --run`) and fix all errors before finishing.
4. **No Git Commits:** Never run `git commit`, `git checkout`, or `git branch`.
5. **Reviewer Communication Channel (`.reviews/agent_notes.md`):** Before signaling completion, write a concise summary of what you implemented and any review rebuttals into `.reviews/agent_notes.md`.
6. **Completion Sentinel (CRITICAL):** As your final step—and ONLY after all tests pass and `.reviews/agent_notes.md` is written—run:
   `echo "DONE" > .tickets/STATUS`

## UI & CSS Grid Spatial Rules (Zero-Overlap Lichess Architecture)
1. **No Overlapping Freeform Positioning:** Never use `position: absolute` or `position: fixed` to place seats, hands, bouts, or sidebars. Use CSS Grid and Flexbox with explicit `gap` spacing and `min-width: 0; box-sizing: border-box;`.
2. **Lichess 3-Column Desktop Shell (`GamePage`):**
   - `[data-zone="sidebar-left"]`: How to Play panel & hotseat player-switcher tabs.
   - `[data-zone="table-arena"]`: 3x3 CSS Grid felt table (`#1e2923`):
     - Row 1: Opponent seats (`data-seat="top-left"`, `data-seat="top-center"`, `data-seat="top-right"`).
     - Row 2: Active bout cards, defender-anchored target outlines (`data-testid="target-outline-<id>"`), and the single-card arrow reflection outline (`data-testid="redirect-outline"`).
     - Row 3: Col 1 = Talon Deck & Trump Card (`data-zone="table-deck"`), Col 2 = Active Player's Hand (`data-zone="player-hand"`), Col 3 = `SortBar` + contextual `Surrender` / `Pass` button.
   - `[data-zone="sidebar-right"]`: Large digital `00:XX` turn clock (`00:15` default) & game winner/durak results.
3. **Zero Table Text Clutter:** Never render text banners like "Waiting for first attack...", "Your turn to defend", or invalid-move error strings on the table or below the hand.

## Real-Time Documentation & Launcher Maintenance (MANDATORY)
The repository root contains three living project files that MUST be kept synchronized with the codebase as features evolve:
1. **`./README.md` (Installation, Startup & User Interface Guide):**
   - Must always provide accurate instructions on how to install dependencies, launch the application locally (`./play-local.sh`), run backend/frontend test suites, and use every current UI feature in the browser (Lobby settings, player views, card dragging/snapping, double-clicking, hand sorting, reflection outlines, contextual buttons, and turn clock).
2. **`./ARCHITECTURE.md` (Technical Structure & System Reference):**
   - Must always document the current directory layout, backend Scala 3 engine/state machine (`durak.engine`), server actors & WebSocket/REST protocol (`durak.server`), frontend Preact components, CSS Grid zones, and audio/interaction subsystems.
3. **`./play-local.sh` (Local Server Launcher):**
   - Whenever a ticket modifies server ports, environment variables, build targets, or startup commands in `backend/` or `frontend/`, you MUST update `./play-local.sh` (and `./README.md`) so `./play-local.sh` starts the full stack cleanly.