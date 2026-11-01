#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

MODE="${1:-status}"

case "$MODE" in
  push)
    echo "☁️  Saving project, ticket, and orchestration state to GitHub..."
    git checkout main 2>/dev/null || true
    git rm -rf --cached .reviews .tickets/STATUS agent-orchestration/.env agent-orchestration/.runtime 2>/dev/null || true
    git add -A
    if ! git diff --cached --quiet; then
      git commit -m "chore(sync): save pipeline state from $(hostname) at $(date +%Y-%m-%d_%H:%M:%S)"
    fi
    git push origin main
    echo "✅ Pushed to GitHub! (Remember: agent-orchestration/.env is local-only for OpSec)."
    ;;
  pull)
    echo "⬇️  Pulling latest project and orchestration state from GitHub..."
    git checkout main 2>/dev/null || true
    git fetch origin
    git pull --rebase origin main
    ./agent-orchestration/start-workspace.sh 3
    echo "✅ Local PC synced and worker worktrees updated!"
    ;;
  *)
    echo "Usage: ./agent-orchestration/sync-pc.sh [push|pull]"
    git status -s
    ;;
esac
