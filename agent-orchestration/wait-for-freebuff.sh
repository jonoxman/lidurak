#!/usr/bin/env bash
cd ~/agent-project
echo "⏳ Waiting for Docker container & FreeBuff tmux session..."
while true; do
  if [ "$(docker inspect -f '{{.State.Running}}' freebuff_worker 2>/dev/null || true)" = "true" ]; then
    if docker exec freebuff_worker tmux has-session -t buff 2>/dev/null; then
      echo "🔗 Attaching to FreeBuff..."
      docker exec -it freebuff_worker tmux attach -t buff || true
      echo "🔄 FreeBuff session cycled or detached. Reconnecting in 3s..."
    fi
  fi
  sleep 3
done
