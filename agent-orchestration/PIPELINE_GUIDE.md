# Lidurak Autonomous Multi-Agent Development Pipeline Guide

## 1. Overview & Directory Structure
The project lives in `~/lidurak-agent-project` inside WSL 2 Ubuntu and separates application code from orchestration scaffolding:

```text
~/lidurak-agent-project/
├── backend/                     # Scala 3 / Http4s game server & test suites
├── frontend/                    # Preact / TypeScript / Vite UI & Vitest suites
├── play-local.sh                # Project-maintained local dev server launcher (:8080 & :5173)
├── SPEC.md                      # Full multi-milestone specification (auto-advances on 'accept')
├── AGENTS.md                    # Strict coding, testing, Lichess layout & play-local.sh rules
├── FEEDBACK.md                  # Human feedback queue (processed before milestone sign-off)
└── agent-orchestration/         # Quarantined pipeline scripts (masked inside worker containers)
    ├── .env                     # GITIGNORED secrets (FreeBuff auth payload, bot Git identity)
    ├── .env.example             # Tracked template for .env
    ├── Dockerfile.sandbox       # Sandbox image definition
    ├── orchestrate.sh           # Main autonomous loop (3-Pool routing, PRs, auto-milestone)
    ├── start-workspace.sh       # Boots Docker containers, worktrees, and injects .env auth
    ├── save-auth.sh             # Captures FreeBuff login from Worker 1 into .env
    ├── scale-workers.sh         # Live worker scaling (add/remove workers on the fly)
    ├── watch-workers.sh         # Tabbed tmux viewer for Workers 1..N (Ctrl+A then 1..N)
    ├── watch-reviews.sh         # Live status monitor for workers, test gates & PR reviews
    ├── reconcile-branches.sh    # Automated branch combiner & AI conflict resolver
    ├── sync-pc.sh               # Multi-PC Git sync helper (push / pull)
    ├── clean_open_source_release.sh # Strips all orchestration history for public release
    ├── bootstrap_windows.ps1    # Windows 10/11 WSL 2 + mission-control.ps1 installer
    └── install-wsl-deps.sh      # Ubuntu WSL Docker, gh, tmux, Node & agy installer
```

## 1. Quick Start
- **Launch from Windows PowerShell:**
  ```powershell
  powershell -ExecutionPolicy Bypass -File ".\mission_control.ps1" -Workers 3
  ```
- **One-Time FreeBuff Login Capture (Stored in Gitignored agent-orchestration/.env):
  ```bash
  ./agent-orchestration/save-auth.sh --login
  ```
- ** Test the Game Locally:
  ```bash
  ./play-local.sh
  # Open http://localhost:5173
  ```
## 2. Real-Time Worker Scaling
  ```bash
  ./agent-orchestration/scale-workers.sh 5        # Scale up to 5 concurrent workers
  ./agent-orchestration/scale-workers.sh 2        # Gracefully drain down to 2 workers
  ./agent-orchestration/scale-workers.sh 1 --now  # Immediately stop workers > 1
  ```

## 3. Human Acceptance Gate & Automatic Milestone Progression
- Write UI/bug requests in `FEEDBACK.md` and press `[ENTER]` in Window 1 to generate and run fix waves.
- Type `accept` at the prompt in Window 1 to automatically archive current tickets and advance `SPEC.md` to the next milestone (`M1` -> `M2` -> `M3` -> `M4` -> `M5`)

## 4. Troubleshooting & Diagnostics
- Run `./agent-orchestration/diagnose.sh` to generate a full, secret-redacted diagnostic report at `~/lidurak-agent-project/diagnostics.txt`
- Run `./agent-orchestration/reconcile-branches.sh` to auto-merge any pending feature branches.
- Run `./agent-orchestration/clean_open_source_release.sh audit` to verify zero secrets are tracked in Git.
