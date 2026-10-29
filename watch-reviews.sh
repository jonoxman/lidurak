#!/usr/bin/env bash
watch -n 1 -t -c '
  LATEST=$(ls -1t .reviews/*-review-*.md 2>/dev/null | head -n 1)
  if [ -n "$LATEST" ]; then
    echo -e "\033[1;36m🔍 WATCHING LATEST REVIEW: $LATEST\033[0m"
    echo "=================================================================="
    tail -n 40 "$LATEST"
  else
    echo "⏳ Waiting for Antigravity to begin the first review..."
  fi
'
