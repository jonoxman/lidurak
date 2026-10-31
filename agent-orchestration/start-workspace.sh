#!/usr/bin/env bash
set -euo pipefail
cd ~/agent-project

NUM_WORKERS="${1:-1}"
IMAGE_NAME="lidurak-sandbox:latest"

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
  EXISTING_IMG=$(docker inspect -f '{{.Config.Image}}' freebuff_worker 2>/dev/null || true)
  if [ -n "$EXISTING_IMG" ] && docker image inspect "$EXISTING_IMG" >/dev/null 2>&1; then
    docker tag "$EXISTING_IMG" "$IMAGE_NAME"
  else
    docker build -t "$IMAGE_NAME" -f agent-orchestration/Dockerfile.sandbox .
  fi
fi

# Seed freebuff_auth_1 from existing freebuff_auth so Worker 1 keeps your current login
docker volume create freebuff_auth >/dev/null 2>&1 || true
docker volume create freebuff_auth_1 >/dev/null 2>&1 || true
docker run --rm -v "freebuff_auth:/from:ro" -v "freebuff_auth_1:/to" "$IMAGE_NAME" \
  bash -c 'cp -rn /from/. /to/ 2>/dev/null || true' >/dev/null 2>&1 || true

# Base container for play-local.sh (:8080 and :5173)
if [ "$(docker inspect -f '{{.State.Running}}' freebuff_worker 2>/dev/null || true)" != "true" ]; then
  docker start freebuff_worker 2>/dev/null || \
  docker run -d --name freebuff_worker \
    --cap-drop=ALL --cap-add=CHOWN --cap-add=SETUID --cap-add=SETGID --cap-add=DAC_OVERRIDE \
    --security-opt no-new-privileges:true \
    -e NODE_OPTIONS="--dns-result-order=ipv4first" \
    -p 8080:8080 -p 5173:5173 \
    -v "$(pwd):/workspace" \
    -v freebuff_auth_1:/root/.config \
    --mount type=tmpfs,destination=/workspace/agent-orchestration,ro \
    -w /workspace "$IMAGE_NAME" tail -f /dev/null >/dev/null
fi

mkdir -p .worktrees
git worktree prune 2>/dev/null || true

for w in $(seq 1 "$NUM_WORKERS"); do
  WT_DIR="$(pwd)/.worktrees/worker-${w}"
  C_NAME="freebuff_worker_${w}"
  AUTH_VOL="freebuff_auth_${w}"
  SBT_VOL="sbt_cache_worker_${w}"

  if [ ! -d "$WT_DIR/.git" ] && [ ! -f "$WT_DIR/.git" ]; then
    rm -rf "$WT_DIR"
    git worktree add --detach "$WT_DIR" HEAD >/dev/null
  fi

  mkdir -p "$WT_DIR/.tickets" "$WT_DIR/.reviews" "$WT_DIR/agent-orchestration"
  docker volume create "$AUTH_VOL" >/dev/null 2>&1 || true
  docker volume create "$SBT_VOL" >/dev/null 2>&1 || true

  if ! docker inspect "$C_NAME" >/dev/null 2>&1; then
    echo "🐳 Creating container $C_NAME (isolated auth volume: $AUTH_VOL, IPv4-first enabled)..."
    docker run -d --name "$C_NAME" \
      --cap-drop=ALL --cap-add=CHOWN --cap-add=SETUID --cap-add=SETGID --cap-add=DAC_OVERRIDE \
      --security-opt no-new-privileges:true \
      -e NODE_OPTIONS="--dns-result-order=ipv4first" \
      -v "${WT_DIR}:/workspace" \
      -v "${AUTH_VOL}:/root/.config" \
      -v "${SBT_VOL}:/root/.cache" \
      --mount type=tmpfs,destination=/workspace/agent-orchestration,ro \
      -w /workspace "$IMAGE_NAME" tail -f /dev/null >/dev/null
  elif [ "$(docker inspect -f '{{.State.Running}}' "$C_NAME" 2>/dev/null || true)" != "true" ]; then
    docker start "$C_NAME" >/dev/null
  fi

  # Persist any dot-directories created in /root inside this worker's own dedicated auth volume
  docker exec "$C_NAME" bash -c '
    grep -q "precedence ::ffff:0:0/96  100" /etc/gai.conf 2>/dev/null || echo "precedence ::ffff:0:0/96  100" >> /etc/gai.conf
    for dir in .local .codebuff .freebuff .manicode; do
      mkdir -p "/root/.config/_isolated_${dir}"
      if [ -d "/root/${dir}" ] && [ ! -L "/root/${dir}" ]; then
        cp -rn "/root/${dir}/." "/root/.config/_isolated_${dir}/" 2>/dev/null || true
        rm -rf "/root/${dir}"
      fi
      ln -sfn "/root/.config/_isolated_${dir}" "/root/${dir}"
    done
  ' 2>/dev/null || true
done

echo "✅ Workspace ready (${NUM_WORKERS} isolated worker container(s) active)."
