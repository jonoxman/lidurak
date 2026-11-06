#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🎮 Starting Lidurak Local Server..."
echo "   -> Backend API / WS : http://localhost:8080"
echo "   -> Frontend UI      : http://localhost:5173"
echo "Press Ctrl+C to stop both servers."

# Runs both servers in this shell and forwards SIGINT/SIGTERM to them, so one
# Ctrl+C always shuts down the whole stack without orphaned `sbt`/`vite` JVMs.
run_stack() {
  local root="$1"
  local backend_pid="" frontend_pid=""

  stop_stack() {
    trap - INT TERM EXIT
    for pid in "$frontend_pid" "$backend_pid"; do
      if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
      fi
    done
    wait 2>/dev/null || true
  }
  trap stop_stack INT TERM EXIT

  (cd "$root/backend" && exec sbt run) &
  backend_pid=$!
  # `npm run dev` already pins `--host 0.0.0.0 --port 5173`, so repeating the
  # flags here only duplicated them in the Vite banner.
  (cd "$root/frontend" && exec npm run dev) &
  frontend_pid=$!

  # If either server dies (for example a port collision), stop the other one
  # instead of leaving the terminal waiting on a half-running stack.
  while kill -0 "$backend_pid" 2>/dev/null && kill -0 "$frontend_pid" 2>/dev/null; do
    sleep 1
  done
  stop_stack
}

if docker inspect -f '{{.State.Running}}' freebuff_worker >/dev/null 2>&1; then
  # `-t` needs a real terminal, so only request it when one is attached.
  docker_flags=(-i)
  if [ -t 0 ]; then docker_flags+=(-t); fi
  exec docker exec "${docker_flags[@]}" freebuff_worker bash -c '
    set -euo pipefail
    stop_stack() {
      trap - INT TERM EXIT
      kill 0
      wait 2>/dev/null || true
    }
    trap stop_stack INT TERM EXIT
    (cd /workspace/backend && exec sbt run) &
    (cd /workspace/frontend && exec npm run dev) &
    wait
  '
else
  run_stack "$PROJECT_ROOT"
fi
