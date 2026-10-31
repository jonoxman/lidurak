#!/usr/bin/env bash
set -e
echo "🎮 Starting Lidurak Local Test Server inside Docker..."
echo "   -> Backend API / WS : http://localhost:8080"
echo "   -> Frontend UI      : http://localhost:5173"
echo "Press Ctrl+C to stop both servers."

docker exec -it freebuff_worker bash -c '
  trap "kill 0" EXIT
  (cd /workspace/backend && sbt run) &
  (cd /workspace/frontend && npm run dev -- --host 0.0.0.0 --port 5173) &
  wait
'
