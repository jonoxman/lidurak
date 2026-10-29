#!/usr/bin/env bash
set -u

# === CONFIGURATION ===
ARCHITECT_MODEL="claude-opus-4-6-thinking"
REVIEWER_MODEL="claude-sonnet-4-6"
SESSION_TIMEOUT_SEC=3300   # 55 minutes
POLL_INTERVAL_SEC=10
MAX_REVIEW_RETRIES=3

mkdir -p .tickets .reviews

# Helper: Run Antigravity safely with NO interactive hanging
run_agy_safe() {
  local MODEL=$1
  local PROMPT_FILE=$2
  local OUT_FILE=$3

  while true; do
    echo "🤖 Calling Antigravity (${MODEL})..."
    
    # < /dev/null prevents infinite hangs waiting for keyboard input
    if agy -p "$(cat "$PROMPT_FILE")" --model "$MODEL" --dangerously-skip-permissions < /dev/null > "$OUT_FILE" 2>.reviews/agy_err.log; then
      if [ -s "$OUT_FILE" ]; then
        return 0
      fi
    fi
    
    echo "⏳ Antigravity call failed. Error log:"
    cat .reviews/agy_err.log
    
    if grep -qi "model" .reviews/agy_err.log; then
       echo "🛑 Fatal error: Model slug not recognized. Check 'agy models'. Exiting."
       exit 1
    fi
    
    echo "💤 Quota limit likely hit or connection failed. Sleeping 15 minutes before retrying..."
    sleep 900
  done
}

# Helper: Send prompt to FreeBuff inside Docker tmux
run_freebuff_until_done() {
  local PROMPT=$1
  rm -f .tickets/STATUS

  while true; do
    echo "🚀 Launching fresh FreeBuff session inside Docker tmux..."
    docker exec freebuff_worker tmux kill-session -t buff 2>/dev/null || true
    docker exec freebuff_worker tmux new-session -d -s buff "freebuff"
    
    sleep 15

    # Inject prompt atomically
    docker exec freebuff_worker tmux send-keys -t buff $'\e[200~'"${PROMPT}"$'\e[201~'
    sleep 1
    docker exec freebuff_worker tmux send-keys -t buff Enter

    local ELAPSED=0
    while [ $ELAPSED -lt $SESSION_TIMEOUT_SEC ]; do
      sleep $POLL_INTERVAL_SEC
      ELAPSED=$((ELAPSED + POLL_INTERVAL_SEC))

      if [ -f .tickets/STATUS ] && grep -q "DONE" .tickets/STATUS; then
        echo "✅ FreeBuff signaled DONE after ${ELAPSED}s!"
        docker exec freebuff_worker tmux kill-session -t buff 2>/dev/null || true
        return 0
      fi

      if ! docker exec freebuff_worker tmux has-session -t buff 2>/dev/null; then
        echo "⚠️ FreeBuff tmux session exited before DONE. Respawning in 15s..."
        sleep 15
        break
      fi

      if [ $((ELAPSED % 60)) -eq 0 ]; then
        echo "⏱️  Still working... (${ELAPSED}s / ${SESSION_TIMEOUT_SEC}s)"
      fi
    done

    echo "🔄 1-Hour limit reached or interrupted. Restarting FreeBuff with continuation context..."
    PROMPT="A previous session cut off. Run 'git status' and 'git diff' to inspect existing progress, complete all remaining requirements, run tests, and run: echo DONE > .tickets/STATUS"
    sleep 10
  done
}

# === PHASE 1: DECOMPOSE SPEC WITH CLAUDE OPUS ===
if [ -z "$(ls -A .tickets/T-*.md 2>/dev/null)" ]; then
  echo "🏗️ Phase 1: Decomposing SPEC.md into atomic tickets..."
  
  # QUOTA SALVAGE CHECK
  if grep -q "===TICKET:" .reviews/raw_tickets.txt 2>/dev/null; then
    echo "♻️ Found existing tickets in .reviews/raw_tickets.txt! Salvaging to save quota..."
  else
    # Build prompt in a file to prevent bash argument limits
    cat << 'PROMPT_EOF' > .reviews/phase1_prompt.txt
You are a Principal Systems Architect. DO NOT use any internal tools, DO NOT run bash commands, and DO NOT check the repository state. 

Read the following specification and agent rules, and break this project down into sequential, atomic implementation tickets for Milestone 1 ONLY.

<spec>
$(cat SPEC.md)
</spec>

<agents>
$(cat AGENTS.md)
</agents>

Output each ticket using this EXACT delimiter format on its own line:
===TICKET:T-01-setup.md===
[Full Markdown content of ticket 1 including exact file paths, types, and test commands]
===TICKET:T-02-models.md===
[Full Markdown content of ticket 2]

Do NOT output any text or thinking preamble before the first ===TICKET:...=== marker.
PROMPT_EOF

    run_agy_safe "$ARCHITECT_MODEL" ".reviews/phase1_prompt.txt" ".reviews/raw_tickets.txt"
  fi

  # Split the output safely
  awk '
    /===TICKET:.*===/ {
      gsub(/.*===TICKET:/, "");
      gsub(/===.*/, "");
      gsub(/[ \t\r]/, "");
      out=".tickets/" $0;
      next
    }
    out != "" { print > out }
  ' .reviews/raw_tickets.txt

  echo "📋 Generated tickets:"
  ls -1 .tickets/T-*.md
fi

# === PHASE 2: AUTONOMOUS TICKET EXECUTION & REVIEW LOOP ===
for TICKET_FILE in $(ls -1 .tickets/T-*.md | sort); do
  TICKET_NAME=$(basename "$TICKET_FILE" .md)
  DONE_MARKER=".tickets/.completed_${TICKET_NAME}"

  if [ -f "$DONE_MARKER" ]; then
    echo "⏭️  Skipping ${TICKET_NAME} (already merged)."
    continue
  fi

  echo "=================================================================="
  echo "🎬 Starting Autonomous Loop for ${TICKET_NAME}"
  echo "=================================================================="

  BRANCH_NAME="feat/${TICKET_NAME}"
  git checkout -b "$BRANCH_NAME" 2>/dev/null || git checkout "$BRANCH_NAME"

  # Step 2A: Initial Implementation in FreeBuff
  WORK_PROMPT="Implement @${TICKET_FILE} following all rules in @AGENTS.md and @SPEC.md. When all tests pass, run: echo DONE > .tickets/STATUS"
  run_freebuff_until_done "$WORK_PROMPT"

  # Step 2B: Adversarial Review & Self-Healing Fix Loop
  ATTEMPT=1
  while [ $ATTEMPT -le $MAX_REVIEW_RETRIES ]; do
    git add -N .
    DIFF_FILE=".reviews/current.diff"
    git diff > "$DIFF_FILE"

    REVIEW_FILE=".reviews/${TICKET_NAME}-review-${ATTEMPT}.md"
    echo "🔍 Auditing ${TICKET_NAME} (Attempt ${ATTEMPT}/${MAX_REVIEW_RETRIES}) with ${REVIEWER_MODEL}..."

    cat << PROMPT_EOF > .reviews/review_prompt.txt
You are a Principal Code Reviewer. Do NOT modify any files.
Review the git diff in @${DIFF_FILE} against @${TICKET_FILE} and @SPEC.md.
Verify all requirements and unit tests are present and bug-free.
End your response with EXACTLY one of:
VERDICT: APPROVED
or
VERDICT: CHANGES_REQUESTED
PROMPT_EOF

    run_agy_safe "$REVIEWER_MODEL" ".reviews/review_prompt.txt" "$REVIEW_FILE"
    rm -f "$DIFF_FILE"

    if grep -q "VERDICT: APPROVED" "$REVIEW_FILE"; then
      echo "🎉 ${TICKET_NAME} APPROVED by ${REVIEWER_MODEL}!"
      git add -A
      git commit -m "Complete ${TICKET_NAME} (autonomous pipeline)"
      git checkout main 2>/dev/null || git checkout master
      git merge --no-ff "$BRANCH_NAME" -m "Merge ${TICKET_NAME}"
      touch "$DONE_MARKER"
      break
    else
      echo "🔧 Changes requested on ${TICKET_NAME}. Sending review back to FreeBuff..."
      FIX_PROMPT="Read the code review in @${REVIEW_FILE} and the original ticket @${TICKET_FILE}. Fix every issue raised, run the test suite until green, and run: echo DONE > .tickets/STATUS"
      run_freebuff_until_done "$FIX_PROMPT"
      ATTEMPT=$((ATTEMPT + 1))
    fi
  done

  if [ ! -f "$DONE_MARKER" ]; then
    echo "🛑 ${TICKET_NAME} failed to pass review after ${MAX_REVIEW_RETRIES} attempts. Pausing pipeline for human inspection."
    exit 1
  fi
done

echo "🏆 ALL TICKETS COMPLETED AND MERGED TO MAIN!"
