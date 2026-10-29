cat << 'EOF' > ~/agent-project/orchestrate.sh
#!/usr/bin/env bash
set -e

COMMAND=$1
ARG=$2

case "$COMMAND" in
  plan)
    # Usage: ./orchestrate.sh plan "Add a priority queue module with unit tests"
    TICKET_ID="T-$(date +%s)"
    TICKET_FILE=".tickets/${TICKET_ID}.md"
    echo "🧠 Asking Antigravity CLI (Gemini Pro) to architect ticket ${TICKET_ID}..."
    
    agy -p "You are a Staff Software Architect. Do NOT modify any code files and do NOT spawn subagents.
    Read the current workspace structure and output a strict, self-contained implementation ticket for a junior coding agent.
    Feature request: ${ARG}
    Include:
    1. Exact file paths to create or modify.
    2. Function signatures, data structures, and edge cases.
    3. Exact test cases to implement and the command to run them.
    Output ONLY the Markdown content for the ticket." > "$TICKET_FILE"

    echo "✅ Ticket created at ${TICKET_FILE}"
    ;;

  work)
    # Usage: ./orchestrate.sh work .tickets/T-12345.md
    TICKET_FILE=$ARG
    BRANCH_NAME="feat/$(basename "$TICKET_FILE" .md)"
    git checkout -b "$BRANCH_NAME" 2>/dev/null || git checkout "$BRANCH_NAME"
    rm -f .tickets/STATUS

    echo "🔒 Launching FreeBuff inside hardened Docker sandbox on branch ${BRANCH_NAME}..."
    echo "👉 Inside FreeBuff, run: Implement everything in @${TICKET_FILE} and follow @AGENTS.md"
    
    docker exec -it freebuff_worker freebuff
    ;;

  review)
    # Usage: ./orchestrate.sh review .tickets/T-12345.md
    TICKET_FILE=$ARG
    REVIEW_FILE=".reviews/$(basename "$TICKET_FILE" .md)-review.md"
    
    git add -N .
    DIFF_FILE=".reviews/current.diff"
    git diff > "$DIFF_FILE"

    if [ ! -s "$DIFF_FILE" ]; then
      echo "⚠️ No code changes detected to review."
      rm -f "$DIFF_FILE"
      exit 1
    fi

    echo "🔍 Sending git diff to Antigravity CLI (Gemini Pro) for adversarial code review..."
    agy -p "You are a Principal Code Reviewer. Do NOT edit any files.
    Review the git diff in @${DIFF_FILE} against the requirements in @${TICKET_FILE}.
    Check for:
    1. Unintended file modifications or security flaws.
    2. Logic bugs, race conditions, or missed edge cases.
    3. Missing test coverage.
    End your review with either VERDICT: APPROVED or VERDICT: CHANGES_REQUESTED followed by exact remediation instructions." > "$REVIEW_FILE"

    rm -f "$DIFF_FILE"
    cat "$REVIEW_FILE"
    echo "📄 Full review saved to ${REVIEW_FILE}"
    ;;

  fix)
    # Usage: ./orchestrate.sh fix .reviews/T-12345-review.md
    REVIEW_FILE=$ARG
    echo "🔧 Re-opening FreeBuff sandbox to apply review fixes from @${REVIEW_FILE}..."
    docker exec -it freebuff_worker freebuff --continue
    ;;

  quota)
    # Check remaining Google AI Pro model quota in Antigravity
    echo "📊 Tip: Run 'agy' and type '/usage' to inspect your exact Google AI Pro quota."
    ;;

  *)
    echo "Usage: ./orchestrate.sh {plan|work|review|fix} [argument]"
    ;;
esac
EOF
chmod +x ~/agent-project/orchestrate.sh
