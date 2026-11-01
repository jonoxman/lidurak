#!/usr/bin/env bash
set -euo pipefail
cd ~/agent-project

NUM_WORKERS="${1:-3}"
IMAGE_NAME="lidurak-sandbox:latest"
SHARED_AUTH_DIR="$(pwd)/agent-orchestration/.freebuff-home"
ENV_FILE="$(pwd)/agent-orchestration/.env"

mkdir -p "$SHARED_AUTH_DIR/.config" "$SHARED_AUTH_DIR/.local"
touch "$ENV_FILE"

if [ -f agent-orchestration/Dockerfile.sandbox ] && [ ! -f Dockerfile.sandbox ]; then
  cp agent-orchestration/Dockerfile.sandbox Dockerfile.sandbox
fi

if ! docker info >/dev/null 2>&1; then
  sudo service docker start >/dev/null 2>&1 </dev/null || sudo dockerd >/dev/null 2>&1 </dev/null &
  for _ in {1..15}; do
    if docker info >/dev/null 2>&1; then break; fi
    sleep 1
  done
fi

if ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
  docker build -t "$IMAGE_NAME" -f agent-orchestration/Dockerfile.sandbox .
fi

# Base container for play-local.sh (:8080 and :5173)
if [ "$(docker inspect -f '{{.State.Running}}' freebuff_worker 2>/dev/null || true)" != "true" ]; then
  docker rm -f freebuff_worker 2>/dev/null || true
  docker run -d --name freebuff_worker \
    --cap-drop=ALL --cap-add=CHOWN --cap-add=SETUID --cap-add=SETGID --cap-add=DAC_OVERRIDE \
    --security-opt no-new-privileges:true \
    --env-file "$ENV_FILE" \
    -e NODE_OPTIONS="--dns-result-order=ipv4first" \
    -p 8080:8080 -p 5173:5173 \
    -v "$(pwd):/workspace" \
    -v "${SHARED_AUTH_DIR}:/freebuff-home" \
    --mount type=tmpfs,destination=/workspace/agent-orchestration,ro \
    -w /workspace "$IMAGE_NAME" tail -f /dev/null >/dev/null
fi

mkdir -p .worktrees
git worktree prune 2>/dev/null || true

for w in $(seq 1 "$NUM_WORKERS"); do
  WT_DIR="$(pwd)/.worktrees/worker-${w}"
  C_NAME="freebuff_worker_${w}"
  SBT_VOL="sbt_cache_worker_${w}"

  if [ ! -d "$WT_DIR/.git" ] && [ ! -f "$WT_DIR/.git" ]; then
    rm -rf "$WT_DIR"
    git worktree add --detach "$WT_DIR" HEAD >/dev/null
  fi

  mkdir -p "$WT_DIR/.tickets" "$WT_DIR/.reviews" "$WT_DIR/agent-orchestration"
  docker volume create "$SBT_VOL" >/dev/null 2>&1 || true

  if ! docker inspect "$C_NAME" >/dev/null 2>&1; then
    echo "🐳 Creating $C_NAME (mounted to shared repo vault: agent-orchestration/.freebuff-home)..."
    docker run -d --name "$C_NAME" \
      --cap-drop=ALL --cap-add=CHOWN --cap-add=SETUID --cap-add=SETGID --cap-add=DAC_OVERRIDE \
      --security-opt no-new-privileges:true \
      --env-file "$ENV_FILE" \
      -e NODE_OPTIONS="--dns-result-order=ipv4first" \
      -v "${WT_DIR}:/workspace" \
      -v "${SHARED_AUTH_DIR}:/freebuff-home" \
      -v "${SBT_VOL}:/root/.cache" \
      --mount type=tmpfs,destination=/workspace/agent-orchestration,ro \
      -w /workspace "$IMAGE_NAME" tail -f /dev/null >/dev/null
  elif [ "$(docker inspect -f '{{.State.Running}}' "$C_NAME" 2>/dev/null || true)" != "true" ]; then
    docker start "$C_NAME" >/dev/null
  fi

  docker exec "$C_NAME" bash -c '
    grep -q "precedence ::ffff:0:0/96  100" /etc/gai.conf 2>/dev/null || echo "precedence ::ffff:0:0/96  100" >> /etc/gai.conf
  ' 2>/dev/null || true
done

echo "✅ Workspace ready (${NUM_WORKERS} worker containers sharing repo-backed /freebuff-home)."
