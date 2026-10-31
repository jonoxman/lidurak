#!/usr/bin/env bash
set -e

echo "🚀 Launching Mission Control Dashboard..."

# Kill existing dashboard session if it exists to start fresh
tmux kill-session -t mission_control 2>/dev/null || true

# 1. Create new session (Left Half: Autopilot Orchestrator)
tmux new-session -d -s mission_control 'cd ~/agent-project && ./autopilot.sh; exec bash'

# 2. Safely bypass the nested Tmux trap: Change host prefix to Ctrl+A
tmux set-option -t mission_control prefix C-a

# 3. Split screen right (Top Right: FreeBuff)
tmux split-window -h -t mission_control 'cd ~/agent-project && docker exec -it freebuff_worker tmux attach -t buff; exec bash'

# 4. Split the right screen bottom (Bottom Right: Antigravity Review Watcher)
tmux split-window -v -t mission_control 'cd ~/agent-project && ./watch-reviews.sh; exec bash'

# 5. Attach to the unified dashboard!
tmux attach-session -t mission_control
