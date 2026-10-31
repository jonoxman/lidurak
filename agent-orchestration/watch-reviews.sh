#!/usr/bin/env bash
cd ~/agent-project
watch -n 2 -t -c '
  echo -e "\033[1;32m⚡ PARALLEL WORKER STATUS\033[0m"
  echo "=================================================================="
  for f in .reviews/worker_*.status; do
    [ -e "$f" ] && echo "  $(basename "$f" .status): $(cat "$f")"
  done
  echo ""
  LATEST=$(ls -1t .reviews/*-review-*.md .worktrees/worker-*/.reviews/*-review-*.md .worktrees/worker-*/.reviews/test_failure_report.md .reviews/raw_tickets.txt .reviews/raw_feedback_tickets.txt 2>/dev/null | head -n 1)
  if [ -n "$LATEST" ]; then
    echo -e "\033[1;36m🔍 LATEST ARTIFACT: $LATEST ($(wc -c < "$LATEST") bytes)\033[0m"
    echo "=================================================================="
    tail -n 32 "$LATEST"
  else
    echo "⏳ Waiting for Architect, Test Gate, or PR Review output..."
  fi
'
