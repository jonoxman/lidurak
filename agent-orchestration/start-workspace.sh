#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

NUM_WORKERS="${1:-3}"
IMAGE_NAME="lidurak-sandbox:latest"
ENV_FILE="$PROJECT_ROOT/agent-orchestration/.env"
RUNTIME_HOME="$PROJECT_ROOT/agent-orchestration/.runtime/freebuff-home"
CONTAINER_ENV_FILE="$PROJECT_ROOT/agent-orchestration/.runtime/container.env"

mkdir -p "$RUNTIME_HOME/.config/manicode" "$RUNTIME_HOME/.local"
if [ ! -f "$ENV_FILE" ] && [ -f "$PROJECT_ROOT/agent-orchestration/.env.example" ]; then
  cp "$PROJECT_ROOT/agent-orchestration/.env.example" "$ENV_FILE"
fi
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

AUTH_B64=$(grep '^FREEBUFF_AUTH_B64=' "$ENV_FILE" 2>/dev/null | head -n 1 | cut -d= -f2- | tr -d '"' || true)
if [ -n "$AUTH_B64" ]; then
  printf '%s' "$AUTH_B64" | base64 -d | tar -xzf - -C "$RUNTIME_HOME" 2>/dev/null || true
fi
unset AUTH_B64

grep -v '^FREEBUFF_AUTH_B64=' "$ENV_FILE" > "$CONTAINER_ENV_FILE" 2>/dev/null || true
chmod 600 "$CONTAINER_ENV_FILE"

if ! docker info >/dev/null 2>&1; then
  echo "🔧 Starting Docker daemon..."
  sudo service docker start >/dev/null 2>&1 </dev/null || sudo dockerd >/dev/null 2>&1 </dev/null &
  for _ in {1..15}; do
    if docker info >/dev/null 2>&1; then break; fi
    sleep 1
  done
fi

if ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
  echo "🐳 Building $IMAGE_NAME from agent-orchestration/Dockerfile.sandbox..."
  docker build -t "$IMAGE_NAME" -f agent-orchestration/Dockerfile.sandbox .
fi

docker run --rm --user root -v "${RUNTIME_HOME}:/mnt/fbhome" "$IMAGE_NAME" \
  chown -R 1000:1000 /mnt/fbhome 2>/dev/null || true

# Memory-constraining flags for JVM/sbt and Node so containers stay lean inside the 8GB WSL cap
JVM_MEM_OPTS="-Xms128m -Xmx768m -XX:MaxMetaspaceSize=256m -XX:+UseSerialGC -Dsbt.server.autostart=false"
NODE_MEM_OPTS="--dns-result-order=ipv4first --max-old-space-size=512"

# Boot base container for ./play-local.sh and Visual QA (capped at 2.2 GB RAM)
if [ "$(docker inspect -f '{{.State.Running}}' freebuff_worker 2>/dev/null || true)" != "true" ]; then
  docker rm -f freebuff_worker 2>/dev/null || true
  docker run -d --name freebuff_worker \
    --memory="2200m" --memory-swap="3g" --shm-size="256m" \
    --cap-drop=ALL --cap-add=CHOWN --cap-add=SETUID --cap-add=SETGID --cap-add=DAC_OVERRIDE \
    --security-opt no-new-privileges:true \
    --env-file "$CONTAINER_ENV_FILE" \
    -e HOME=/home/node \
    -e SBT_OPTS="$JVM_MEM_OPTS" \
    -e JAVA_TOOL_OPTIONS="$JVM_MEM_OPTS" \
    -e NODE_OPTIONS="$NODE_MEM_OPTS" \
    -p 8080:8080 -p 5173:5173 \
    -v "${PROJECT_ROOT}:/workspace" \
    -v "${RUNTIME_HOME}/.config:/home/node/.config" \
    -v "${RUNTIME_HOME}/.local:/home/node/.local" \
    --mount type=tmpfs,destination=/workspace/agent-orchestration,ro \
    -w /workspace "$IMAGE_NAME" tail -f /dev/null >/dev/null
else
  docker update --memory="2200m" --memory-swap="3g" freebuff_worker >/dev/null 2>&1 || true
fi

mkdir -p .worktrees
git worktree prune 2>/dev/null || true

for w in $(seq 1 "$NUM_WORKERS"); do
  WT_DIR="${PROJECT_ROOT}/.worktrees/worker-${w}"
  C_NAME="freebuff_worker_${w}"
  SBT_VOL="sbt_cache_worker_${w}"

  if [ ! -d "$WT_DIR/.git" ] && [ ! -f "$WT_DIR/.git" ]; then
    rm -rf "$WT_DIR"
    git worktree add --detach "$WT_DIR" HEAD >/dev/null
  fi

  mkdir -p "$WT_DIR/.tickets" "$WT_DIR/.reviews" "$WT_DIR/agent-orchestration"
  docker volume create "$SBT_VOL" >/dev/null 2>&1 || true

  if ! docker inspect "$C_NAME" >/dev/null 2>&1; then
    docker run --rm --user root -v "${SBT_VOL}:/mnt/sbt" "$IMAGE_NAME" chown -R 1000:1000 /mnt/sbt 2>/dev/null || true
    echo "🐳 Creating $C_NAME (RAM cap: 1600MB, JVM heap cap: 768MB)..."
    docker run -d --name "$C_NAME" \
      --memory="1600m" --memory-swap="2400m" \
      --cap-drop=ALL --cap-add=CHOWN --cap-add=SETUID --cap-add=SETGID --cap-add=DAC_OVERRIDE \
      --security-opt no-new-privileges:true \
      --env-file "$CONTAINER_ENV_FILE" \
      -e HOME=/home/node \
      -e SBT_OPTS="$JVM_MEM_OPTS" \
      -e JAVA_TOOL_OPTIONS="$JVM_MEM_OPTS" \
      -e NODE_OPTIONS="$NODE_MEM_OPTS" \
      -v "${WT_DIR}:/workspace" \
      -v "${RUNTIME_HOME}/.config:/home/node/.config" \
      -v "${RUNTIME_HOME}/.local:/home/node/.local" \
      -v "${SBT_VOL}:/home/node/.cache" \
      --mount type=tmpfs,destination=/workspace/agent-orchestration,ro \
      -w /workspace "$IMAGE_NAME" tail -f /dev/null >/dev/null
  elif [ "$(docker inspect -f '{{.State.Running}}' "$C_NAME" 2>/dev/null || true)" != "true" ]; then
    docker start "$C_NAME" >/dev/null
    docker update --memory="1600m" --memory-swap="2400m" "$C_NAME" >/dev/null 2>&1 || true
  else
    docker update --memory="1600m" --memory-swap="2400m" "$C_NAME" >/dev/null 2>&1 || true
  fi
done

echo "✅ Workspace ready (${NUM_WORKERS} workers active with strict RAM & JVM heap caps)."
