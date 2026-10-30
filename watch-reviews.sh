#!/usr/bin/env bash
watch -n 1 -t -c '
  LATEST=$(ls -1t .reviews/*-review-*.md .reviews/test_failure_report.md 2>/dev/null | head -n 1)
  if [ -n "$LATEST" ]; then
    echo -e "\033[1;36m🔍 LATEST VERIFICATION OUTPUT: $LATEST\033[0m"
    echo "=================================================================="
    tail -n 42 "$LATEST"
  else
    echo "⏳ Waiting for local test gate or Antigravity review output..."
  fi
'
