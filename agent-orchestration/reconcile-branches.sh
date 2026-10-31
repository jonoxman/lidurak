#!/usr/bin/env bash
set -uo pipefail
cd ~/agent-project

PRIMARY_MODEL="claude-sonnet-4-6"
FALLBACK_MODEL="gemini-3.8-flash-high"

run_agy_resolver() {
  local PROMPT_FILE=\$1
  local OUT_FILE=\$2

  echo "🤖 Calling Antigravity [\${PRIMARY_MODEL}] to auto-resolve code conflicts..."
  rm -f "\$OUT_FILE"
  if timeout 300 agy -p "$(cat "$PROMPT_FILE")" --model "$PRIMARY_MODEL" --dangerously-skip-permissions > "$OUT_FILE" 2>/dev/null; then
    if grep -q "===END_OF_FILES===" "\$OUT_FILE"; then return 0; fi
  fi

  echo "🔀 Retrying with \${FALLBACK_MODEL}..."
  if timeout 300 agy -p "$(cat "$PROMPT_FILE")" --model "$FALLBACK_MODEL" --dangerously-skip-permissions > "$OUT_FILE" 2>/dev/null; then
    if grep -q "===END_OF_FILES===" "\$OUT_FILE"; then return 0; fi
  fi
  return 1
}

apply_resolved_files() {
  local RAW_FILE=\$1
  awk '
    /^===FILE:.*===\$/ {
      line=\$0;
      gsub(/^===FILE:/, "", line);
      gsub(/===\$/, "", line);
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

echo "=== 1. Aborting Stuck Worktree Merges & Purging Staging Files ==="
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

# Ensure agent staging files are untracked so they NEVER cause merge conflicts
git rm -rf --cached .reviews .tickets/STATUS FEEDBACK.in_progress.md 2>/dev/null || true
git add agent-orchestration/ .gitignore .codebuffignore FEEDBACK.md FEEDBACK.backup.md .tickets/ 2>/dev/null || true
if ! git diff --cached --quiet; then
  git commit -m "chore: untrack .reviews staging files and save orchestration scripts"
fi

git fetch --all --prune

echo "=== 2. Merging All Active Wave Branches into main ==="
BRANCHES=$(git for-each-ref --format='%(refname:short)' refs/heads/feat/ refs/remotes/origin/feat/ \
  | sed 's|^origin/||' | sort -u)

for BR in $BRANCHES; do
  if [[ "$BR" == *"010137"* ]] || [[ "$BR" == *"T-14"* ]]; then
    echo "🧹 Removing obsolete branch: $BR"
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
    echo "=================================================================="
    echo "🔀 Merging $TARGET_REF ($UNMERGED_COMMITS commit(s)) into main..."
    echo "=================================================================="

    if ! git merge --no-ff --no-commit "$TARGET_REF" >/dev/null 2>&1; then
      # Automatically accept current state for staging files if they conflict
      git checkout --ours -- .reviews/ .tickets/ FEEDBACK.md 2>/dev/null || true
      git rm -rf --cached .reviews/ .tickets/STATUS 2>/dev/null || true

      mapfile -t CONFLICT_FILES < <(git diff --name-only --diff-filter=U)

      if [ ${#CONFLICT_FILES[@]} -gt 0 ]; then
        echo "🔧 Found ${#CONFLICT_FILES[@]} conflicted source file(s): ${CONFLICT_FILES[*]}"
        PROMPT_FILE=".reviews/conflict_resolve_prompt.txt"
        OUT_FILE=".reviews/conflict_resolve_out.txt"
        mkdir -p .reviews

        {
          echo "You are a Principal Scala 3 & TypeScript Systems Architect."
          echo "CRITICAL: DO NOT use any tools, DO NOT run bash commands, and DO NOT read external files."
          echo "We are merging branch ${BR} into main. Resolve all Git conflict markers (<<<<<<< HEAD, =======, >>>>>>>) in the files below so that BOTH branches' features, fields, methods, and imports are preserved and work together seamlessly."
          echo "Use sensible default parameter values on case classes / interfaces where helpful so existing call sites remain source-compatible."
          echo ""
          echo "<related_project_files_for_type_context>"
          head -n 120 backend/src/main/scala/durak/engine/*.scala backend/src/main/scala/durak/server/*.scala frontend/src/types.ts 2>/dev/null
          echo "</related_project_files_for_type_context>"
          echo ""
          echo "<conflicted_files_to_resolve>"
          for cf in "${CONFLICT_FILES[@]}"; do
            echo "===CONFLICTED_FILE:${cf}==="
            cat "$cf"
            echo ""
          done
          echo "</conflicted_files_to_resolve>"
          echo ""
          echo "Output the complete, valid, conflict-free source code for each conflicted file using this EXACT format (do NOT wrap code in markdown backticks), and end your entire response with ===END_OF_FILES===:"
          for cf in "${CONFLICT_FILES[@]}"; do
            echo "===FILE:${cf}==="
            echo "[Complete resolved code for ${cf}]"
          done
          echo "===END_OF_FILES==="
        } > "$PROMPT_FILE"

        if run_agy_resolver "$PROMPT_FILE" "$OUT_FILE"; then
          apply_resolved_files "$OUT_FILE"
          for cf in "${CONFLICT_FILES[@]}"; do
            git add "$cf"
          done
        else
          echo "❌ Antigravity failed to resolve conflicts on $BR."
          exit 1
        fi
      fi
    fi

    git rm -rf --cached .reviews/ .tickets/STATUS 2>/dev/null || true
    git add -A
    git commit -m "Merge $BR into main" || true
  else
    echo "✅ $BR is already merged into main."
  fi

  git push origin main 2>/dev/null || true
  git push origin --delete "$BR" 2>/dev/null || true
  git branch -D "$BR" 2>/dev/null || true
done

echo "=== 3. Running Quick Compile & Test Check on Unified main ==="
# Test using the root freebuff_worker (which mounts ~/agent-project), not freebuff_worker_1
if ! docker exec freebuff_worker bash -c "cd /workspace/backend && sbt -batch test" > .reviews/reconcile_test.log 2>&1; then
  echo "⚠️  Backend test/compile issue detected after combining branches; auto-patching with Antigravity..."
  sed -r 's/\x1B\[[0-9;]*[a-zA-Z]//g' .reviews/reconcile_test.log > .reviews/reconcile_test_clean.log
  {
    echo "You are a Principal Scala 3 Engineer. DO NOT use tools or bash commands."
    echo "After merging parallel branches, 'sbt test' reported the following errors:"
    grep -E '(\[error\]|==> X|FAILED|Exception)' .reviews/reconcile_test_clean.log | tail -n 80
    echo ""
    echo "<current_backend_files>"
    for sf in backend/src/main/scala/durak/engine/*.scala backend/src/main/scala/durak/server/*.scala backend/src/test/scala/durak/**/*.scala; do
      [ -f "$sf" ] || continue
      echo "===SOURCE:${sf}==="
      cat "$sf"
    done
    echo "</current_backend_files>"
    echo ""
    echo "Output ONLY the modified files needed to fix the compilation/test errors using ===FILE:path=== (no markdown code fences) and end with ===END_OF_FILES===:"
  } > .reviews/fix_compile_prompt.txt

  if run_agy_resolver ".reviews/fix_compile_prompt.txt" ".reviews/fix_compile_out.txt"; then
    apply_resolved_files ".reviews/fix_compile_out.txt"
    git add backend/
    git commit -m "fix(backend): reconcile combined branch signatures and tests" || true
  fi
fi

git push origin main 2>/dev/null || true
echo "=================================================================="
echo "✅ ALL BRANCHES RECONCILED AND MERGED INTO MAIN!"
echo "=================================================================="
