#!/usr/bin/env bash
set -u

# === CONFIGURATION ===
# Run `agy models` to verify exact model slugs on your account
ARCHITECT_MODEL="claude-opus-4.6-thinking"
REVIEWER_MODEL="claude-sonnet-4.6-thinking"
SESSION_TIMEOUT_SEC=3300   # 55 minutes (catches FreeBuff's 1-hr cutoff cleanly)
POLL_INTERVAL_SEC=10       # Check .tickets/STATUS every 10 seconds
MAX_REVIEW_RETRIES=3       # Max times FreeBuff can attempt fixes per ticket

mkdir -p .tickets .reviews

# Helper: Run Antigravity with automatic 5-hour quota sleep/retry
run_agy_safe() {
  local MODEL=$1
  local PROMPT=$2
  local OUT_FILE=$3

  while true; do
    echo "🤖 Calling Antigravity (${MODEL})..."
    if agy -p "$PROMPT" --model "$MODEL" --effort high > "$OUT_FILE" 2>.reviews/agy_err.log; then
      if [ -s "$OUT_FILE" ]; then
        return 0
      fi
    fi
    echo "⏳ Antigravity call failed or hit 5-hour Pro quota limit. Error log:"
    cat .reviews/agy_err.log
    echo "💤 Sleeping 15 minutes before retrying..."
    sleep 900
  done
}

# Helper: Send prompt to FreeBuff inside Docker tmux and wait for .tickets/STATUS == DONE
run_freebuff_until_done() {
  local PROMPT=$1
  rm -f .tickets/STATUS

  while true; do
    echo "🚀 Launching fresh FreeBuff session inside Docker tmux..."
    docker exec freebuff_worker tmux kill-session -t buff 2>/dev/null || true
    docker exec freebuff_worker tmux new-session -d -s buff "freebuff"
    
    # Wait 6 seconds for FreeBuff TUI to initialize
    sleep 6

    # Inject prompt using bracketed paste so OpenTUI receives it cleanly
    docker exec freebuff_worker tmux send-keys -t buff $'\e[200~'"${PROMPT}"$'\e[201~'
    sleep 1
    docker exec freebuff_worker tmux send-keys -t buff Enter

    local ELAPSED=0
    while [ $ELAPSED -lt $SESSION_TIMEOUT_SEC ]; do
      sleep $POLL_INTERVAL_SEC
      ELAPSED=$((ELAPSED + POLL_INTERVAL_SEC))

      # 1. Check if FreeBuff wrote DONE to .tickets/STATUS
      if [ -f .tickets/STATUS ] && grep -q "DONE" .tickets/STATUS; then
        echo "✅ FreeBuff signaled DONE after ${ELAPSED}s!"
        docker exec freebuff_worker tmux kill-session -t buff 2>/dev/null || true
        return 0
      fi

      # 2. Check if the FreeBuff tmux session crashed or exited early
      if ! docker exec freebuff_worker tmux has-session -t buff 2>/dev/null; then
        echo "⚠️ FreeBuff tmux session exited before DONE. Respawning in 15s..."
        sleep 15
        break
      fi

      # Print a heartbeat every 60 seconds
      if [ $((ELAPSED % 60)) -eq 0 ]; then
        echo "⏱️  Still working... (${ELAPSED}s / ${SESSION_TIMEOUT_SEC}s)"
      fi
    done

    # If we reach here, the 1-hour session cut off or exited before finishing
    echo "🔄 1-Hour session limit reached or interrupted. Restarting FreeBuff with continuation context..."
    PROMPT="A previous session cut off before completing the task. Run 'git status' and 'git diff' to inspect existing progress, complete all remaining requirements in the ticket/review, run all tests, and run: echo DONE > .tickets/STATUS"
    sleep 10
  done
}

# === PHASE 1: DECOMPOSE SPEC WITH CLAUDE OPUS 4.6 ===
if [ -z "$(ls -A .tickets/T-*.md 2>/dev/null)" ]; then
  echo "🏗️ Phase 1: Decomposing @SPEC.md into atomic tickets using ${ARCHITECT_MODEL}..."
  
  SPEC_PROMPT="You are a Principal Systems Architect. Read @SPEC.md and @AGENTS.md.
Break this project down into sequential, atomic implementation tickets.
Output each ticket using this EXACT delimiter format on its own line:
===TICKET:T-01-setup.md===
[Full Markdown content of ticket 1 including exact file paths, types, and test commands]
===TICKET:T-02-models.md===
[Full Markdown content of ticket 2]
Do NOT output any text before the first ===TICKET:...=== marker."

  run_agy_safe "$ARCHITECT_MODEL" "$SPEC_PROMPT" ".reviews/raw_tickets.txt"

  # Split the single Opus output into individual .tickets/T-XX.md files
  awk '
    /^===TICKET:.*===$/ {
      sub(/^===TICKET:/, "", $0);
      sub(/===$/, "", $0);
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

    REVIEW_PROMPT="You are a Principal Code Reviewer. Do NOT modify any files.
Review the git diff in @${DIFF_FILE} against @${TICKET_FILE} and @SPEC.md.
Verify all requirements and unit tests are present and bug-free.
End your response with EXACTLY one of:
VERDICT: APPROVED
or
VERDICT: CHANGES_REQUESTED"

    run_agy_safe "$REVIEWER_MODEL" "$REVIEW_PROMPT" "$REVIEW_FILE"
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
EOF
chmod +x ~/agent-project/autopilot.sh

