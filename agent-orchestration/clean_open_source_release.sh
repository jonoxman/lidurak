#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

MODE="${1:-audit}"
PUBLIC_REMOTE_URL="${2:-}"

case "$MODE" in
  audit)
    echo "🔒 Auditing git repository for tracked secrets or credential files..."
    echo "------------------------------------------------------------------"
    if git ls-files | grep -iE "(^|/)\.env$|auth\.json|credentials\.json|id_rsa|\.pem|\.runtime"; then
      echo "⚠️  WARNING: Potential credential file found in git index above!"
      exit 1
    else
      echo "   ✅ Zero credential or .env files tracked in Git."
    fi

    if git grep -I -E "(sk-ant-|AIzaSy|ghp_[A-Za-z0-9]{30,}|github_pat_|FREEBUFF_AUTH_B64=\"[A-Za-z0-9+/=]{20,})" -- . ':(exclude)agent-orchestration/clean_open_source_release.sh' 2>/dev/null; then
      echo "⚠️  WARNING: Potential secret string found in tracked file contents!"
      exit 1
    else
      echo "   ✅ Zero API keys or auth payloads found in tracked file contents."
    fi

    echo "3. Summary of tracked root entries:"
    git ls-files | cut -d/ -f1 | sort | uniq -c
    echo "------------------------------------------------------------------"
    echo "✅ Security audit PASSED!"
    ;;

  export-clean)
    echo "🚀 Exporting history-free public release branch ('public-release')..."
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
    EXPORT_DIR="/tmp/lidurak-public-export-$$"
    rm -rf "$EXPORT_DIR"
    git worktree add --detach "$EXPORT_DIR" main >/dev/null

    (
      cd "$EXPORT_DIR"
      git checkout --orphan public-release >/dev/null 2>&1

      # Remove orchestration scaffolding while keeping backend/, frontend/, and play-local.sh
      git rm -rf --cached \
        agent-orchestration \
        .tickets \
        .reviews \
        SPEC.md \
        AGENTS.md \
        FEEDBACK.md \
        FEEDBACK.backup.md \
        .codebuffignore 2>/dev/null || true

      rm -rf \
        agent-orchestration \
        .tickets \
        .reviews \
        SPEC.md \
        AGENTS.md \
        FEEDBACK.md \
        FEEDBACK.backup.md \
        .codebuffignore

      cat << 'GITIGNORE_EOF' > .gitignore
target/
project/target/
project/project/
node_modules/
dist/
*.log
.DS_Store
GITIGNORE_EOF

      git add -A
      git commit -m "Initial public release of Lidurak" >/dev/null

      echo "✅ Created clean orphan branch 'public-release' containing ONLY:"
      git ls-files | cut -d/ -f1 | sort | uniq -c

      if [ -n "$PUBLIC_REMOTE_URL" ]; then
        git push -f "$PUBLIC_REMOTE_URL" public-release:main
        echo "🎉 Public repository updated with zero agentic scaffolding!"
      fi
    )

    git worktree remove --force "$EXPORT_DIR" 2>/dev/null || rm -rf "$EXPORT_DIR"
    git checkout "$CURRENT_BRANCH" >/dev/null 2>&1 || true
    ;;

  *)
    echo "Usage: ./agent-orchestration/clean_open_source_release.sh [audit|export-clean <remote-url>]"
    ;;
esac
