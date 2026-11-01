#!/usr/bin/env bash
set -u
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

QUESTION="${*:-}"
if [ -z "$QUESTION" ]; then
  echo "Usage: ./agent-orchestration/ask-architect.sh \"Your question about the app or pipeline\""
  exit 1
fi

mkdir -p .reviews
cat << PROMPT_EOF > .reviews/qa_prompt.txt
You are the Lead Architect of Lidurak. Do NOT modify any files or run any bash commands.
Answer the human product owner's question clearly and practically based on the current codebase below.

<project_file_tree>
$(find backend/src frontend/src play-local.sh -type f 2>/dev/null | sort)
</project_file_tree>

<frontend_pages_and_components>
$(head -n 200 play-local.sh frontend/src/app.tsx frontend/src/pages/*.tsx frontend/src/components/*.tsx 2>/dev/null)
</frontend_pages_and_components>

<human_question>
${QUESTION}
</human_question>
PROMPT_EOF

timeout 120 agy -p "$(cat .reviews/qa_prompt.txt)" --model "gemini-3.8-flash-high" --dangerously-skip-permissions < /dev/null || \
timeout 120 agy -p "$(cat .reviews/qa_prompt.txt)" --model "gemini-4-argon-low" --dangerously-skip-permissions < /dev/null
