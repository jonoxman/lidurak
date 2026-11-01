#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

ENV_FILE="$PROJECT_ROOT/agent-orchestration/.env"
RUNTIME_HOME="$PROJECT_ROOT/agent-orchestration/.runtime/freebuff-home"
mkdir -p "$RUNTIME_HOME/.config/manicode" "$RUNTIME_HOME/.local"
touch "$ENV_FILE"

MODE="${1:-capture}"

if [ "$MODE" = "--login" ]; then
  ./agent-orchestration/start-workspace.sh 1
  echo "=================================================================="
  echo "🔐 Launching interactive FreeBuff in freebuff_worker_1..."
  echo "   1. Complete the browser login link shown below."
  echo "   2. Once you see the FreeBuff chat box ready, press Ctrl+C to exit."
  echo "=================================================================="
  docker exec -it freebuff_worker_1 freebuff || true
fi

# Copy only the lightweight auth/config JSON files from freebuff_worker_1 (never the 138MB binary!)
if docker inspect freebuff_worker_1 >/dev/null 2>&1; then
  for f in credentials.json device-key.json analytics-id.json freebuff-metadata.json settings.json; do
    docker cp "freebuff_worker_1:/home/node/.config/manicode/${f}" "$RUNTIME_HOME/.config/manicode/${f}" 2>/dev/null || true
  done
  docker cp "freebuff_worker_1:/home/node/.config/project-id" "$RUNTIME_HOME/.config/project-id" 2>/dev/null || true
fi

if [ ! -f "$RUNTIME_HOME/.config/manicode/credentials.json" ]; then
  echo "⚠️  No credentials.json found in $RUNTIME_HOME/.config/manicode/."
  echo "👉 Run: ./agent-orchestration/save-auth.sh --login"
  exit 1
fi

# Package ONLY the tiny JSON/ID files (<1KB total), excluding binaries and logs
B64_PAYLOAD=$(tar -czf - -C "$RUNTIME_HOME" \
  --exclude='freebuff' \
  --exclude='rg' \
  --exclude='*.wasm' \
  --exclude='projects' \
  --exclude='*.jsonl' \
  .config | base64 -w 0)

grep -v '^FREEBUFF_AUTH_B64=' "$ENV_FILE" > "${ENV_FILE}.tmp" || true
printf 'FREEBUFF_AUTH_B64="%s"\n' "$B64_PAYLOAD" >> "${ENV_FILE}.tmp"
mv "${ENV_FILE}.tmp" "$ENV_FILE"
chmod 600 "$ENV_FILE"

echo "✅ Captured FreeBuff auth JSONs into gitignored agent-orchestration/.env (Payload size: ${#B64_PAYLOAD} bytes)!"
