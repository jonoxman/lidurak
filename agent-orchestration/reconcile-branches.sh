#!/usr/bin/env bash
set -euo pipefail
cd ~/agent-project

echo "=== 1. Detaching Worker Worktrees So Branches Are Not Locked ==="
for w in 1 2 3 4 5; do
  WT=".worktrees/worker-${w}"
  if [ -d "$WT" ]; then
    (
      cd "$WT"
      rm -f .tickets/STATUS
      git add -A
      git reset -- .reviews/ .tickets/ 2>/dev/null || true
      if ! git diff --cached --quiet; then
        git commit -m "chore(salvage): save uncommitted work in worker-${w}" || true
      fi
      git checkout --detach HEAD >/dev/null 2>&1 || true
    )
  fi
done

echo "=== 2. Cleaning Root Working Tree & Syncing with origin/main ==="
git checkout main
git add agent-orchestration/ FEEDBACK.md FEEDBACK.backup.md .tickets/ 2>/dev/null || true
if ! git diff --cached --quiet; then
  git commit -m "chore: save local orchestration state before branch reconciliation"
fi

git fetch --all --prune
# Merge remote origin/main if it has PR commits merged via GitHub UI
git merge --no-edit origin/main || true

echo "=== 3. Merging All Active Wave Branches into main ==="
# Find all local and remote feat/T-90-feedback-20261031_015942* branches in numerical order
BRANCHES=$(git for-each-ref --format='%(refname:short)' refs/heads/feat/ refs/remotes/origin/feat/ \
  | sed 's|^origin/||' | sort -u)

for BR in $BRANCHES; do
  # Skip obsolete branches from earlier aborted runs (010137, T-14 duplicate, etc.)
  if [[ "$BR" == *"010137"* ]] || [[ "$BR" == *"T-14"* ]]; then
    echo "🧹 Removing obsolete branch from earlier aborted run: $BR"
    git branch -D "$BR" 2>/dev/null || true
    git push origin --delete "$BR" 2>/dev/null || true
    continue
  fi

  # Determine the latest ref (prefer local branch if ahead, otherwise origin/$BR)
  TARGET_REF="$BR"
  if ! git show-ref --verify --quiet "refs/heads/$BR"; then
    TARGET_REF="origin/$BR"
  fi

  # Check if branch has commits not yet in main
  UNMERGED_COMMITS=$(git rev-list --count "main..${TARGET_REF}" 2>/dev/null || echo "0")
  if [ "$UNMERGED_COMMITS" -gt 0 ]; then
    echo "🔀 Merging $TARGET_REF ($UNMERGED_COMMITS commit(s)) into main..."
    if ! git merge --no-ff "$TARGET_REF" -m "Merge $BR into main"; then
      echo "⚠️  Merge conflict detected while merging $BR! Resolving in freebuff_worker_1..."
      # Copy conflicted repo state into worker-1 worktree to let FreeBuff resolve it
      git merge --abort
      WT1=".worktrees/worker-1"
      (
        cd "$WT1"
        git checkout -B "$BR" "$TARGET_REF"
        git merge --no-edit main || true
        rm -f .tickets/STATUS
      )
      PROMPT="🚨 GIT MERGE CONFLICT: Resolve all <<<<<<< HEAD conflict markers in the repository so both features work together cleanly, run 'sbt -batch test' in backend/ and 'npm test -- --run' in frontend/ until green, and run: echo DONE > .tickets/STATUS"
      docker exec freebuff_worker_1 tmux kill-session -t buff 2>/dev/null || true
      docker exec freebuff_worker_1 tmux new-session -d -s buff "NODE_OPTIONS='--dns-result-order=ipv4first' freebuff"
      sleep 8
      docker exec freebuff_worker_1 tmux send-keys -t buff -l -- "$PROMPT"
      sleep 1
      docker exec freebuff_worker_1 tmux send-keys -t buff Enter
      while [ ! -f "$WT1/.tickets/STATUS" ]; do sleep 5; done
      (
        cd "$WT1"
        rm -f .tickets/STATUS
        git add -A
        git reset -- .reviews/ .tickets/ 2>/dev/null || true
        git commit -m "chore($BR): resolve merge conflicts with main" || true
        git checkout --detach HEAD
      )
      git merge --no-ff "$BR" -m "Merge $BR into main (conflicts resolved)"
    fi
  else
    echo "✅ $BR is already merged into main."
  fi

  # Clean up the merged feature branch locally and on GitHub
  git push origin main 2>/dev/null || true
  git push origin --delete "$BR" 2>/dev/null || true
  git branch -D "$BR" 2>/dev/null || true
done

echo "=== 4. Pushing Unified main Branch to GitHub ==="
git push origin main

echo "=== 5. Remaining Branches on GitHub ==="
git ls-remote --heads origin
echo "✅ All branches reconciled and merged into 'main'! You can now test the complete build with ./agent-orchestration/play-local.sh"
