#!/usr/bin/env bash
set -e

echo "🚀 Initializing Agentic Workspace..."

# 1. Ensure Docker is running natively in WSL
if ! docker info >/dev/null 2>&1; then
  echo "⚠️ Docker daemon is not running. Starting Docker..."
  sudo systemctl start docker
  sleep 2
fi

# 2. Prepare workspace structure and Git
mkdir -p .tickets .reviews src
if [ ! -d ".git" ]; then
  git init
  echo "✅ Git repository initialized."
fi

# 3. Seed required specification files if they don't exist
if [ ! -f "SPEC.md" ]; then
  echo "📝 Creating placeholder SPEC.md..."
  echo "# Project Specification" > SPEC.md
fi

if [ ! -f "AGENTS.md" ]; then
  echo "📝 Creating placeholder AGENTS.md..."
  cat << 'RULES' > AGENTS.md
# Autonomous Agent Rules (STRICT)
1. **Scope:** Only implement the requirements specified in the assigned `.tickets/T-XX.md` file.
2. **Resuming Partial Work:** Always start by running `git status` and `git diff`. Do not duplicate or overwrite working code.
3. **Mandatory Testing:** You MUST run the project test suite in the terminal and fix all errors before finishing.
4. **No Git Commits:** Never run `git commit`, `git checkout`, or `git branch`. The host orchestrator manages Git.
5. **Completion Sentinel (CRITICAL):** As your final step—and ONLY after all tests pass—run this exact shell command:
   `echo "DONE" > .tickets/STATUS`
RULES
fi

# 4. Build and start the hardened container
echo "🐳 Bringing up FreeBuff sandbox container..."
docker compose up -d --build

echo "======================================================"
echo "✅ Workspace is live and secured!"
echo "Container status: $(docker ps --format '{{.Status}}' -f name=freebuff_worker)"
echo ""
echo "Next steps:"
echo "1. Fill out SPEC.md with your project architecture."
echo "2. Run ./autopilot.sh to kick off the zero-touch pipeline."
echo "======================================================"
