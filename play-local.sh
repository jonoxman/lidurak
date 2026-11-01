#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "🎮 Starting Lidurak Local Server..."
echo "   -> Backend API / WS : http://localhost:8080"
echo "   -> Frontend UI      : http://localhost:5173"
echo "Press Ctrl+C to stop both servers."

if docker inspect -f '{{.State.Running}}' freebuff_worker >/dev/null 2>&1; then
  docker exec -it freebuff_worker bash -c '
    trap "kill 0" EXIT
    (cd /workspace/backend && sbt run) &
    (cd /workspace/frontend && npm run dev -- --host 0.0.0.0 --port 5173) &
    wait
  '
else
  trap "kill 0" EXIT
  (cd "$PROJECT_ROOT/backend" && sbt run) &
  (cd "$PROJECT_ROOT/frontend" && npm run dev -- --host 0.0.0.0 --port 5173) &
  wait
fi
