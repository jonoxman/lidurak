#!/usr/bin/env bash
set -euo pipefail
cd ~/agent-project

MODE="${1:-audit}"
PUBLIC_REMOTE_URL="${2:-}"

case "$MODE" in
  audit)
    echo "🔒 Auditing git repository for tracked orchestration files and potential secrets..."
    echo "------------------------------------------------------------------"
    echo "1. Checking if any auth/token files exist in git index:"
    if git ls-files | grep -iE "(\.env|auth\.json|credentials|token|id_rsa|\.pem)"; then
      echo "⚠️  WARNING: Potential credential file found in git index above!"
      exit 1
    else
      echo "   ✅ Zero credential or token files tracked in Git."
    fi

    echo "2. Scanning tracked file contents for API key patterns:"
    if git grep -I -E "(sk-ant-|AIzaSy|ghp_[A-Za-z0-9]{30,}|github_pat_)" -- . ':(exclude)agent-orchestration/export-public-release.sh' 2>/dev/null; then
      echo "⚠️  WARNING: Potential API key string found above!"
      exit 1
    else
      echo "   ✅ Zero API keys or tokens found in tracked file contents."
    fi

    echo "3. Summary of tracked directories:"
    git ls-files | cut -d/ -f1 | sort | uniq -c
    echo "------------------------------------------------------------------"
    echo "✅ Security audit PASSED! Safe to push to GitHub."
    ;;

  export-clean)
    echo "🚀 Exporting a 100% clean, history-free public release branch ('public-release')..."
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

    # Create a temporary worktree so we don't disturb your working directory
    EXPORT_DIR="/tmp/lidurak-public-export-$$"
    rm -rf "$EXPORT_DIR"
    git worktree add --detach "$EXPORT_DIR" main >/dev/null

    (
      cd "$EXPORT_DIR"
      # Create an orphan branch with ZERO prior commit history
      git checkout --orphan public-release >/dev/null 2>&1

      # Remove all agentic scaffolding, tickets, specs, and orchestration scripts
      git rm -rf --cached \
        agent-orchestration \
        .tickets \
        .reviews \
        SPEC.md \
        AGENTS.md \
        FEEDBACK.md \
        FEEDBACK.backup.md \
        Dockerfile.sandbox \
        docker-compose.yml \
        .codebuffignore 2>/dev/null || true

      rm -rf \
        agent-orchestration \
        .tickets \
        .reviews \
        SPEC.md \
        AGENTS.md \
        FEEDBACK.md \
        FEEDBACK.backup.md \
        Dockerfile.sandbox \
        docker-compose.yml \
        .codebuffignore

      # Write a clean .gitignore containing only application build artifacts
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
        echo "☁️  Pushing clean code to public repository: $PUBLIC_REMOTE_URL"
        git push -f "$PUBLIC_REMOTE_URL" public-release:main
        echo "🎉 Public repository updated with zero agentic scaffolding or history!"
      else
        echo ""
        echo "👉 To push this clean release to a separate public GitHub repo later, run:"
        echo "   ./agent-orchestration/export-public-release.sh export-clean https://github.com/<your-username>/lidurak-public.git"
      fi
    )

    git worktree remove --force "$EXPORT_DIR" 2>/dev/null || rm -rf "$EXPORT_DIR"
    git checkout "$CURRENT_BRANCH" >/dev/null 2>&1 || true
    ;;

  *)
    echo "Usage:"
    echo "  ./agent-orchestration/export-public-release.sh audit"
    echo "  ./agent-orchestration/export-public-release.sh export-clean [optional-public-repo-url]"
    ;;
esac
