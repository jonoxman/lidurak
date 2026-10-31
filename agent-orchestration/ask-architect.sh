#!/usr/bin/env bash
set -u

QUESTION="${*:-}"
if [ -z "$QUESTION" ]; then
  echo "Usage: ./ask-architect.sh \"Your question about how to use or understand the app\""
  echo "Example: ./ask-architect.sh \"How do I start a game and play cards in the current UI?\""
  exit 1
fi

echo "🧠 Gathering current frontend/backend source context and asking gemini-3.8-flash-high..."

cat << PROMPT_EOF > .reviews/qa_prompt.txt
You are the Lead Architect of Lidurak. Do NOT modify any files or run any bash commands.
Answer the human product owner's question clearly and practically based on the current codebase below.
If they are asking how to interact with the UI, give exact step-by-step instructions (what buttons to click, how player tabs work, etc.).

<project_file_tree>
$(find backend/src frontend/src -type f 2>/dev/null | sort)
</project_file_tree>

<frontend_pages_and_components>
$(head -n 200 frontend/src/app.tsx frontend/src/pages/*.tsx frontend/src/components/*.tsx 2>/dev/null)
</frontend_pages_and_components>

<human_question>
${QUESTION}
</human_question>
PROMPT_EOF

agy -p "$(cat .reviews/qa_prompt.txt)" --model "gemini-3.8-flash-high" --dangerously-skip-permissions < /dev/null
