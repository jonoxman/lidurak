#!/usr/bin/env bash
set -uo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

if [ -f "$PROJECT_ROOT/agent-orchestration/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source <(grep -v "^FREEBUFF_AUTH_B64=" "$PROJECT_ROOT/agent-orchestration/.env") 2>/dev/null || true
  set +a
fi

AGENT_GIT_NAME="${AGENT_GIT_NAME:-Lidurak Agent Bot}"
AGENT_GIT_EMAIL="${AGENT_GIT_EMAIL:-agent-bot@lidurak.local}"

agent_git() {
  GIT_AUTHOR_NAME="$AGENT_GIT_NAME" \
  GIT_AUTHOR_EMAIL="$AGENT_GIT_EMAIL" \
  GIT_COMMITTER_NAME="$AGENT_GIT_NAME" \
  GIT_COMMITTER_EMAIL="$AGENT_GIT_EMAIL" \
  git "$@"
}

RESOLVER_MODELS=("claude-opus-5-5-high" "gemini-4-argon-high" "claude-sonnet-5-5-high" "gemini-3.8-flash-high")

run_agy_resolver() {
  local PROMPT_FILE=$1
  local OUT_FILE=$2

  for MODEL in "${RESOLVER_MODELS[@]}"; do
    echo "🤖 Calling Antigravity [${MODEL}] to auto-resolve code conflicts..."
    rm -f "$OUT_FILE"
    timeout 300 agy -p "$(cat "$PROMPT_FILE")" --model "$MODEL" --dangerously-skip-permissions < /dev/null > "$OUT_FILE" 2>/dev/null || true
    if grep -q "===END_OF_FILES===" "$OUT_FILE" 2>/dev/null; then
      echo "✅ ${MODEL} resolved conflicts cleanly!"
      return 0
    fi
    echo "🔀 Advancing to next resolver model..."
  done
  return 1
}

apply_resolved_files() {
  local RAW_FILE=$1
  awk '
    /^===FILE:.*===$/ {
      line=$0;
      gsub(/^===FILE:/, "", line);
      gsub(/===$/, "", line);
      gsub(/[ \t\r]/, "", line);
      out=line;
      printf "" > out;
      next
    }
    /^```/ { next }
    /^===END_OF_FILES===/ { out=""; next }
    out != "" { print >> out }
  ' "$RAW_FILE"
}

echo "=== 1. Detaching Worktrees & Cleaning Staging Files ==="
for w in 1 2 3 4 5; do
  WT=".worktrees/worker-${w}"
  if [ -d "$WT" ]; then
    (
      cd "$WT"
      git merge --abort 2>/dev/null || true
      git reset --hard HEAD >/dev/null 2>&1 || true
      git clean -fd >/dev/null 2>&1 || true
      git checkout --detach HEAD >/dev/null 2>&1 || true
    )
  fi
done

git merge --abort 2>/dev/null || true
git checkout main
git rm -rf --cached .reviews .tickets/STATUS FEEDBACK.in_progress.md .freebuff agent-orchestration/.env agent-orchestration/.runtime 2>/dev/null || true
git add -A
if ! git diff --cached --quiet; then
  agent_git commit -m "chore(pipeline): clean staging files and update orchestration suite"
fi

git fetch --all --prune 2>/dev/null || true

echo "=== 2. Reconciling Any Unmerged Feature Branches into main ==="
BRANCHES=$(git for-each-ref --format='%(refname:short)' refs/heads/feat/ refs/remotes/origin/feat/ \
  | sed 's|^origin/||' | sort -u)

for BR in $BRANCHES; do
  if [[ "$BR" == *"010137"* ]] || [[ "$BR" == *"180708"* ]] || [[ "$BR" == *"T-14"* ]]; then
    git branch -D "$BR" 2>/dev/null || true
    git push origin --delete "$BR" 2>/dev/null || true
    continue
  fi

  TARGET_REF="$BR"
  if ! git show-ref --verify --quiet "refs/heads/$BR"; then
    TARGET_REF="origin/$BR"
  fi

  UNMERGED_COMMITS=$(git rev-list --count "main..${TARGET_REF}" 2>/dev/null || echo "0")
  if [ "$UNMERGED_COMMITS" -gt 0 ]; then
    echo "🔀 Merging $TARGET_REF ($UNMERGED_COMMITS commit(s)) into main..."
    if ! agent_git merge --no-ff --no-commit "$TARGET_REF" >/dev/null 2>&1; then
      git checkout --ours -- .reviews/ .tickets/ FEEDBACK.md 2>/dev/null || true
      git rm -rf --cached .reviews/ .tickets/STATUS 2>/dev/null || true

      mapfile -t CONFLICT_FILES < <(git diff --name-only --diff-filter=U)
      if [ ${#CONFLICT_FILES[@]} -gt 0 ]; then
        echo "🔧 Auto-resolving ${#CONFLICT_FILES[@]} conflicted file(s): ${CONFLICT_FILES[*]}"
        PROMPT_FILE=".reviews/conflict_resolve_prompt.txt"
        OUT_FILE=".reviews/conflict_resolve_out.txt"
        mkdir -p .reviews

        {
          echo "You are a Principal Scala 3 & TypeScript Systems Architect. DO NOT use tools or bash commands."
          echo "Resolve all Git conflict markers (<<<<<<< HEAD, =======, >>>>>>>) in the files below so BOTH branches' features work together."
          echo ""
          echo "<related_project_files>"
          head -n 120 backend/src/main/scala/durak/engine/*.scala backend/src/main/scala/durak/server/*.scala frontend/src/types.ts 2>/dev/null
          echo "</related_project_files>"
          echo ""
          for cf in "${CONFLICT_FILES[@]}"; do
            echo "===CONFLICTED_FILE:${cf}==="
            cat "$cf"
          done
          echo ""
          echo "Output the complete resolved code for each file using ===FILE:path=== (no markdown code fences) and end with ===END_OF_FILES===:"
        } > "$PROMPT_FILE"

        if run_agy_resolver "$PROMPT_FILE" "$OUT_FILE"; then
          apply_resolved_files "$OUT_FILE"
          for cf in "${CONFLICT_FILES[@]}"; do git add "$cf"; done
        else
          echo "❌ Conflict resolution failed on $BR."
          exit 1
        fi
      fi
    fi
    git rm -rf --cached .reviews/ .tickets/STATUS 2>/dev/null || true
    git add -A
    agent_git commit -m "Merge $BR into main" || true
  fi

  git push origin main 2>/dev/null || true
  git push origin --delete "$BR" 2>/dev/null || true
  git branch -D "$BR" 2>/dev/null || true
done

git push origin main 2>/dev/null || true
echo "✅ All branches reconciled into main!"
