#!/usr/bin/env bash
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"
NUM_WORKERS=$(cat .reviews/target_workers 2>/dev/null || echo "${1:-3}")

while ! docker inspect freebuff_worker_1 >/dev/null 2>&1; do
  echo "⏳ Waiting for orchestrator to boot worker containers..."
  sleep 2
done

tmux kill-session -t worker_viewer 2>/dev/null || true

CMD1="echo '⏳ Waiting for FreeBuff task on freebuff_worker_1...'; while true; do if docker exec freebuff_worker_1 tmux has-session -t buff 2>/dev/null; then docker exec -it freebuff_worker_1 tmux attach -t buff || true; fi; sleep 2; done"
tmux new-session -d -s worker_viewer -n "Worker-1" "$CMD1"

tmux set-option -t worker_viewer prefix C-a
tmux set-option -t worker_viewer base-index 1
tmux set-window-option -t worker_viewer pane-base-index 1
tmux move-window -s worker_viewer:0 -t worker_viewer:1 2>/dev/null || true

tmux set-option -t worker_viewer status on
tmux set-option -t worker_viewer status-style "bg=#262421,fg=#bababa"
tmux set-option -t worker_viewer status-left-length 60
tmux set-option -t worker_viewer status-left "#[fg=#629924,bold] [Ctrl+A then 1..${NUM_WORKERS} to switch workers] "

if [ "$NUM_WORKERS" -ge 2 ]; then
  for w in $(seq 2 "$NUM_WORKERS"); do
    CMD="echo '⏳ Waiting for FreeBuff task on freebuff_worker_${w}...'; while true; do if docker exec freebuff_worker_${w} tmux has-session -t buff 2>/dev/null; then docker exec -it freebuff_worker_${w} tmux attach -t buff || true; fi; sleep 2; done"
    tmux new-window -t "worker_viewer:${w}" -n "Worker-${w}" "$CMD"
  done
fi

tmux select-window -t "worker_viewer:1"
tmux attach-session -t worker_viewer
