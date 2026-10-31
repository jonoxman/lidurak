#!/usr/bin/env bash
set -e

NEXT_M="${1:-}"
if [[ ! "$NEXT_M" =~ ^M[2-5]$ ]]; then
  echo "Usage: ./next-milestone.sh {M2|M3|M4|M5}"
  exit 1
fi

ARCHIVE_DIR=".tickets/archive_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$ARCHIVE_DIR"

echo "📦 Archiving completed tickets and reviews to ${ARCHIVE_DIR}..."
mv .tickets/T-*.md "$ARCHIVE_DIR"/ 2>/dev/null || true
mv .tickets/.completed_* "$ARCHIVE_DIR"/ 2>/dev/null || true
rm -f .reviews/raw_tickets.txt .tickets/STATUS

# Update the active milestone directive in SPEC.md
sed -i "s/CURRENT ACTIVE MILESTONE: M[1-5]/CURRENT ACTIVE MILESTONE: ${NEXT_M}/g" SPEC.md
sed -i "s/generate atomic tickets ONLY for \*\*Milestone M[1-5]\*\*/generate atomic tickets ONLY for **Milestone ${NEXT_M}**/g" SPEC.md

echo "✅ SPEC.md updated to target Milestone ${NEXT_M}!"
echo "👉 Run './autopilot.sh' (or './autopilot.sh --batch 2') to begin ${NEXT_M}."
