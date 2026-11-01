#!/usr/bin/env bash
set +e
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"
OUT_FILE="$PROJECT_ROOT/diagnostics.txt"

{
  echo "=== LIDURAK DIAGNOSTIC SNAPSHOT ($(date)) ==="
  echo "Project Root: $PROJECT_ROOT"
  echo ""
  echo "=== 1. ACTIVE PROCESSES ==="
  ps -ef --forest | grep -E "bash|orchestrate|watch|agy|node|tmux|docker|git|sbt|npm" | grep -v grep

  echo ""
  echo "=== 2. GIT, WORKTREES & BRANCHES ==="
  git status -s
  git worktree list
  git branch -a

  echo ""
  echo "=== 3. TICKETS & COMPLETION MARKERS ==="
  ls -la .tickets/

  echo ""
  echo "=== 4. .reviews/ STATUS & LOGS ==="
  ls -la .reviews/
  for f in .reviews/target_workers .reviews/worker_*.status .reviews/worker_*.ticket .reviews/*.err; do
    if [ -e "$f" ]; then
      echo "--- $f ---"
      cat "$f"
    fi
  done

  echo ""
  echo "=== 5. AUTH & .env VERIFICATION (REDACTED) ==="
  if [ -f agent-orchestration/.env ]; then
    echo ".env exists. Configured keys (values redacted):"
    sed 's/=.*/=<REDACTED>/' agent-orchestration/.env
  else
    echo "MISSING: agent-orchestration/.env"
  fi
  echo "Files in .runtime/freebuff-home (names & permissions only):"
  find agent-orchestration/.runtime/freebuff-home -type f -exec ls -l {} + 2>/dev/null

  echo ""
  echo "=== 6. DOCKER CONTAINERS & LIVE TMUX PANES ==="
  docker ps -a --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"
  for c in freebuff_worker freebuff_worker_1 freebuff_worker_2 freebuff_worker_3; do
    if docker inspect "$c" >/dev/null 2>&1; then
      echo "--- Container: $c ---"
      docker exec "$c" bash -c '
        echo "Container user: $(id)"
        echo "Auth files in /home/node/.config:"
        find /home/node/.config -maxdepth 3 -type f -exec ls -l {} + 2>/dev/null
        echo "Tmux sessions:"
        tmux list-sessions 2>/dev/null || echo "  none"
        echo "Last 20 lines of buff pane:"
        tmux capture-pane -t buff -p 2>/dev/null | tail -n 20 || echo "  no buff pane"
      ' 2>/dev/null
    fi
  done
} > "$OUT_FILE" 2>&1

echo "✅ Diagnostic report written to: $OUT_FILE"
echo "👉 In Windows File Explorer or browser upload dialog, open:"
echo "   \\\\wsl.localhost\\Ubuntu$(echo "$OUT_FILE" | tr '/' '\\')"
