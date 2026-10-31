#!/usr/bin/env bash
set -euo pipefail
cd ~/agent-project

MODE="${1:-status}"

case "$MODE" in
  push)
    echo "☁️  Saving all project, ticket, and orchestration state to GitHub..."
    git checkout main 2>/dev/null || git checkout master
    git add -A
    if ! git diff --cached --quiet; then
      git commit -m "chore(sync): save pipeline state from $(hostname) at $(date +%Y-%m-%d_%H:%M:%S)"
    fi
    git push origin main
    echo "✅ Everything is pushed to GitHub! You can safely switch PCs."
    ;;
  pull)
    echo "⬇️  Pulling latest project, ticket, and orchestration state from GitHub..."
    git checkout main 2>/dev/null || git checkout master
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
