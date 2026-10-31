#!/usr/bin/env bash
cd ~/agent-project
watch -n 2 -t -c '
  TARGET_W=$(cat .reviews/target_workers 2>/dev/null || echo "3")
  printf "\033[1;32m⚡ PARALLEL WORKER POOL (Target Workers: %s | Scale: ./agent-orchestration/scale-workers.sh <N>)\033[0m\n" "$TARGET_W"
  echo "=================================================================="
  for f in $(ls -1v .reviews/worker_*.status 2>/dev/null); do
    [ -e "$f" ] && echo "  $(basename "$f" .status): $(cat "$f")"
  done
  echo ""
  LATEST=$(ls -1t .reviews/*-review-*.md .worktrees/worker-*/.reviews/*-review-*.md .worktrees/worker-*/.reviews/test_failure_report.md .reviews/raw_tickets.txt .reviews/raw_feedback_tickets.txt 2>/dev/null | head -n 1)
  if [ -n "$LATEST" ]; then
    printf "\033[1;36m🔍 LATEST ARTIFACT: %s (%s bytes)\033[0m\n" "$LATEST" "$(wc -c < "$LATEST")"
    echo "=================================================================="
    tail -n 30 "$LATEST"
  else
    echo "⏳ Waiting for Architect, Test Gate, or PR Review output..."
  fi
'
