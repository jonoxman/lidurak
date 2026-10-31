#!/usr/bin/env bash
set -euo pipefail
cd ~/agent-project

NUM_WORKERS="${1:-3}"
IMAGE_NAME="lidurak-sandbox:latest"

if [ -f agent-orchestration/Dockerfile.sandbox ] && [ ! -f Dockerfile.sandbox ]; then
  cp agent-orchestration/Dockerfile.sandbox Dockerfile.sandbox
fi

# 1. Ensure Docker daemon is running
if ! docker info >/dev/null 2>&1; then
  echo "🔧 Starting Docker daemon..."
  sudo service docker start >/dev/null 2>&1 </dev/null || sudo dockerd >/dev/null 2>&1 </dev/null &
  for _ in {1..15}; do
    if docker info >/dev/null 2>&1; then break; fi
    sleep 1
  done
fi

# 2. Build sandbox image if missing (or tag existing freebuff_worker image)
if ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
  EXISTING_IMG=$(docker inspect -f '{{.Config.Image}}' freebuff_worker 2>/dev/null || true)
  if [ -n "$EXISTING_IMG" ] && docker image inspect "$EXISTING_IMG" >/dev/null 2>&1; then
    echo "🏷️  Tagging existing sandbox image ($EXISTING_IMG) as $IMAGE_NAME..."
    docker tag "$EXISTING_IMG" "$IMAGE_NAME"
  else
    echo "🐳 Building $IMAGE_NAME from agent-orchestration/Dockerfile.sandbox..."
    docker build -t "$IMAGE_NAME" -f agent-orchestration/Dockerfile.sandbox .
  fi
fi

# Ensure shared FreeBuff auth volume exists
docker volume create freebuff_auth >/dev/null 2>&1 || true

# Ensure legacy single-worker container name still works for play-local.sh (points to main repo)
if [ "$(docker inspect -f '{{.State.Running}}' freebuff_worker 2>/dev/null || true)" != "true" ]; then
  docker start freebuff_worker 2>/dev/null || \
  docker run -d --name freebuff_worker \
    --cap-drop=ALL --cap-add=CHOWN --cap-add=SETUID --cap-add=SETGID --cap-add=DAC_OVERRIDE \
    --security-opt no-new-privileges:true \
    -p 8080:8080 -p 5173:5173 \
    -v "$(pwd):/workspace" \
    -v freebuff_auth:/root/.config \
    --mount type=tmpfs,destination=/workspace/agent-orchestration,ro \
    -w /workspace "$IMAGE_NAME" tail -f /dev/null >/dev/null
fi

# 3. Provision isolated Git Worktrees and Containers for Workers 1..N
mkdir -p .worktrees
git worktree prune 2>/dev/null || true

for w in $(seq 1 "$NUM_WORKERS"); do
  WT_DIR="$(pwd)/.worktrees/worker-${w}"
  C_NAME="freebuff_worker_${w}"
  SBT_VOL="sbt_cache_worker_${w}"

  if [ ! -d "$WT_DIR/.git" ] && [ ! -f "$WT_DIR/.git" ]; then
    echo "🌿 Creating isolated git worktree for Worker ${w} at .worktrees/worker-${w}..."
    rm -rf "$WT_DIR"
    git worktree add --detach "$WT_DIR" HEAD >/dev/null
  fi

  mkdir -p "$WT_DIR/.tickets" "$WT_DIR/.reviews" "$WT_DIR/agent-orchestration"
  docker volume create "$SBT_VOL" >/dev/null 2>&1 || true

  if ! docker inspect "$C_NAME" >/dev/null 2>&1; then
    echo "🐳 Creating isolated container $C_NAME (agent-orchestration masked via ro tmpfs)..."
    docker run -d --name "$C_NAME" \
      --cap-drop=ALL --cap-add=CHOWN --cap-add=SETUID --cap-add=SETGID --cap-add=DAC_OVERRIDE \
      --security-opt no-new-privileges:true \
      -v "${WT_DIR}:/workspace" \
      -v freebuff_auth:/root/.config \
      -v "${SBT_VOL}:/root/.cache" \
      --mount type=tmpfs,destination=/workspace/agent-orchestration,ro \
      -w /workspace "$IMAGE_NAME" tail -f /dev/null >/dev/null
  elif [ "$(docker inspect -f '{{.State.Running}}' "$C_NAME" 2>/dev/null || true)" != "true" ]; then
    docker start "$C_NAME" >/dev/null
  fi
done

echo "✅ Docker workspace ready with ${NUM_WORKERS} isolated parallel worker containers!"
