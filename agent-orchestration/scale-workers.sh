#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

if [ $# -lt 1 ]; then
  CURRENT=$(cat .reviews/target_workers 2>/dev/null || echo "3")
  echo "Current target workers: ${CURRENT}"
  echo "Usage: ./agent-orchestration/scale-workers.sh <N> [--now]"
  exit 0
fi

NEW_COUNT="$1"
MODE="${2:-graceful}"
OLD_COUNT=$(cat .reviews/target_workers 2>/dev/null || echo "3")
mkdir -p .reviews
echo "$NEW_COUNT" > .reviews/target_workers

if [ "$NEW_COUNT" -gt "$OLD_COUNT" ]; then
  echo "📈 Scaling UP from ${OLD_COUNT} to ${NEW_COUNT} FreeBuff workers..."
  ./agent-orchestration/start-workspace.sh "$NEW_COUNT"
  if tmux has-session -t worker_viewer 2>/dev/null; then
    for w in $(seq $((OLD_COUNT + 1)) "$NEW_COUNT"); do
      CMD="echo '⏳ Waiting for FreeBuff task on freebuff_worker_${w}...'; while true; do if docker exec freebuff_worker_${w} tmux has-session -t buff 2>/dev/null; then docker exec -it freebuff_worker_${w} tmux attach -t buff || true; fi; sleep 2; done"
      tmux new-window -t "worker_viewer:${w}" -n "Worker-${w}" "$CMD" 2>/dev/null || true
    done
    tmux set-option -t worker_viewer status-left "#[fg=#629924,bold] [Ctrl+A then 1..${NEW_COUNT} to switch workers] " 2>/dev/null || true
  fi
  echo "✅ Workers 1..${NEW_COUNT} are live!"
elif [ "$NEW_COUNT" -lt "$OLD_COUNT" ]; then
  if [ "$MODE" = "--now" ]; then
    for w in $(seq $((NEW_COUNT + 1)) "$OLD_COUNT"); do
      if [ -f ".reviews/worker_${w}.pid" ]; then
        WPID=$(cat ".reviews/worker_${w}.pid" 2>/dev/null || true)
        [ -n "$WPID" ] && kill -TERM "$WPID" 2>/dev/null || true
        rm -f ".reviews/worker_${w}.pid" ".reviews/worker_${w}.ticket"
      fi
      docker exec "freebuff_worker_${w}" tmux kill-session -t buff 2>/dev/null || true
      echo "🛑 Stopped (Scaled down)" > ".reviews/worker_${w}.status"
      tmux kill-window -t "worker_viewer:${w}" 2>/dev/null || true
    done
    tmux set-option -t worker_viewer status-left "#[fg=#629924,bold] [Ctrl+A then 1..${NEW_COUNT} to switch workers] " 2>/dev/null || true
    echo "✅ Scaled down to ${NEW_COUNT} active worker(s) immediately."
  else
    echo "📉 Scaling DOWN from ${OLD_COUNT} to ${NEW_COUNT} workers after current tasks finish..."
  fi
fi
