#!/usr/bin/env bash
cd ~/agent-project
NUM_WORKERS="${1:-3}"

tmux kill-session -t worker_viewer 2>/dev/null || true
tmux new-session -d -s worker_viewer -n "Worker-1"

# Use Ctrl+A for switching worker tabs so Ctrl+B passes cleanly into FreeBuff
tmux set-option -t worker_viewer prefix C-a
tmux set-option -t worker_viewer status on
tmux set-option -t worker_viewer status-style "bg=#262421,fg=#bababa"
tmux set-option -t worker_viewer status-left "#[fg=#629924,bold] [Ctrl+A then 1..${NUM_WORKERS} to switch workers] "

for w in $(seq 1 "$NUM_WORKERS"); do
  CMD="echo '⏳ Waiting for FreeBuff on freebuff_worker_${w}...'; while true; do if docker exec freebuff_worker_${w} tmux has-session -t buff 2>/dev/null; then docker exec -it freebuff_worker_${w} tmux attach -t buff || true; fi; sleep 2; done"
  if [ "$w" -eq 1 ]; then
    tmux respawn-pane -t "worker_viewer:1" -k "$CMD"
  else
    tmux new-window -t worker_viewer -n "Worker-${w}" "$CMD"
  fi
done

tmux select-window -t "worker_viewer:1"
tmux attach-session -t worker_viewer
