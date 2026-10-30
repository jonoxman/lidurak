#!/usr/bin/env bash
set -u

# === CONFIGURATION ===
PRIMARY_ARCHITECT_MODEL="claude-opus-4-6-thinking"
PRIMARY_REVIEWER_MODEL="claude-sonnet-4-6"
FALLBACK_MODEL="gemini-3.8-flash-high"

REVIEW_EVERY_N_TICKETS="${REVIEW_EVERY_N_TICKETS:-1}"
if [ "${1:-}" = "--batch" ] && [ -n "${2:-}" ]; then
  REVIEW_EVERY_N_TICKETS="$2"
fi

SESSION_TIMEOUT_SEC=3300   # 55 minutes
POLL_INTERVAL_SEC=10
MAX_REVIEW_ROUNDS=4        # Max back-and-forth rounds between Reviewer and Implementer

mkdir -p .tickets .reviews

echo "=================================================================="
echo "⚙️  Architect Routing : ${PRIMARY_ARCHITECT_MODEL} -> Fallback: ${FALLBACK_MODEL}"
echo "⚙️  Reviewer Routing  : ${PRIMARY_REVIEWER_MODEL} -> Fallback: ${FALLBACK_MODEL}"
echo "⚙️  Max Debate Rounds : ${MAX_REVIEW_ROUNDS} rounds per ticket (via .reviews/agent_notes.md)"
echo "=================================================================="

try_agy_call() {
  local MODEL=$1
  local PROMPT_FILE=$2
  local OUT_FILE=$3
  local EXPECT_PATTERN=$4

  rm -f "$OUT_FILE" .reviews/agy_err.log
  echo "🤖 Calling Antigravity [Model: ${MODEL}]..."

  if agy -p "$(cat "$PROMPT_FILE")" --model "$MODEL" --dangerously-skip-permissions < /dev/null > "$OUT_FILE" 2>.reviews/agy_err.log; then
    if [ -s "$OUT_FILE" ] && grep -qE "$EXPECT_PATTERN" "$OUT_FILE"; then
      echo "✅ ${MODEL} succeeded."
      return 0
    fi
  fi

  echo "⚠️  ${MODEL} did not return a valid response."
  if [ -s .reviews/agy_err.log ]; then
    echo "   Error details: $(tr '\n' ' ' < .reviews/agy_err.log | head -c 240)"
  fi
  return 1
}

run_agy_with_fallback() {
  local PRIMARY_MODEL=$1
  local FB_MODEL=$2
  local PROMPT_FILE=$3
  local OUT_FILE=$4
  local EXPECT_PATTERN=$5

  while true; do
    if try_agy_call "$PRIMARY_MODEL" "$PROMPT_FILE" "$OUT_FILE" "$EXPECT_PATTERN"; then
      ACTIVE_MODEL_USED="$PRIMARY_MODEL"
      return 0
    fi

    echo "🔀 Falling back from ${PRIMARY_MODEL} to ${FB_MODEL}..."
    if try_agy_call "$FB_MODEL" "$PROMPT_FILE" "$OUT_FILE" "$EXPECT_PATTERN"; then
      ACTIVE_MODEL_USED="$FB_MODEL"
      return 0
    fi

    if grep -qiE "unknown model|invalid model|model not found" .reviews/agy_err.log 2>/dev/null; then
      echo "🛑 Fatal error: Model slug rejected by Antigravity."
      cat .reviews/agy_err.log
      exit 1
    fi

    echo "💤 Both models failed or hit quota limits. Sleeping 15 minutes..."
    sleep 900
  done
}

run_local_test_gate() {
  local CURRENT_TICKET=$1
  echo "🧪 Running deterministic local test gate inside Docker container..."
  local RAW_LOG=".reviews/local_test_raw.log"
  local CLEAN_LOG=".reviews/local_test_clean.log"
  local REPORT_FILE=".reviews/test_failure_report.md"
  rm -f "$RAW_LOG" "$CLEAN_LOG" "$REPORT_FILE"

  if [ -f "backend/build.sbt" ]; then
    echo "   -> Executing 'sbt -batch test' in backend/..."
    if ! docker exec freebuff_worker bash -c "cd /workspace/backend && sbt -batch test" > "$RAW_LOG" 2>&1; then
      sed -r 's/\x1B\[[0-9;]*[a-zA-Z]//g' "$RAW_LOG" > "$CLEAN_LOG"
      cat << REPORT_EOF > "$REPORT_FILE"
# 🚨 Automated Local Test Gate Failure Report
- **Ticket Being Verified:** \`${CURRENT_TICKET}\`
- **Failed Stage:** Backend Scala Test Suite (\`cd /workspace/backend && sbt -batch test\`)
- **Action Required:** Fix the exact failing tests or compilation errors below without rewriting unrelated working code.

## 1. Extracted Failing Tests & Compiler Errors
\`\`\`text
$(grep -E '(\[error\]|==> X|FAILED|Exception|Error:)' "$CLEAN_LOG" | tail -n 60 || echo "See full tail output below.")
\`\`\`

## 2. Last 90 Lines of \`sbt test\` Output
\`\`\`text
$(tail -n 90 "$CLEAN_LOG")
\`\`\`
REPORT_EOF
      echo "❌ Backend 'sbt test' FAILED! Structured report written to ${REPORT_FILE} (0 AI quota used)."
      return 1
    fi
  fi

  if [ -f "frontend/package.json" ]; then
    echo "   -> Executing 'npm test -- --run' in frontend/..."
    if ! docker exec freebuff_worker bash -c "cd /workspace/frontend && npm test -- --run" > "$RAW_LOG" 2>&1; then
      sed -r 's/\x1B\[[0-9;]*[a-zA-Z]//g' "$RAW_LOG" > "$CLEAN_LOG"
      cat << REPORT_EOF > "$REPORT_FILE"
# 🚨 Automated Local Test Gate Failure Report
- **Ticket Being Verified:** \`${CURRENT_TICKET}\`
- **Failed Stage:** Frontend Test Suite (\`cd /workspace/frontend && npm test -- --run\`)
- **Action Required:** Fix the exact failing tests or TypeScript errors below without rewriting unrelated working code.

## 1. Extracted Failing Suites & Assertions
\`\`\`text
$(grep -E '(FAIL|AssertionError|Error:|TS[0-9]+:|✕|×)' "$CLEAN_LOG" | tail -n 60 || echo "See full tail output below.")
\`\`\`

## 2. Last 90 Lines of \`npm test\` Output
\`\`\`text
$(tail -n 90 "$CLEAN_LOG")
\`\`\`
REPORT_EOF
      echo "❌ Frontend 'npm test' FAILED! Structured report written to ${REPORT_FILE} (0 AI quota used)."
      return 1
    fi
  fi

  echo "✅ Local deterministic test gate PASSED!"
  return 0
}

run_freebuff_until_done() {
  local PROMPT=$1
  rm -f .tickets/STATUS

  while true; do
    if ! docker exec freebuff_worker tmux has-session -t buff 2>/dev/null; then
      echo "🚀 Launching fresh FreeBuff session inside Docker tmux..."
      docker exec freebuff_worker tmux new-session -d -s buff "freebuff"
      sleep 15
    else
      echo "♻️  Reusing active FreeBuff session to preserve session hours..."
      sleep 2
    fi

    docker exec freebuff_worker tmux send-keys -t buff $'\e[200~'"${PROMPT}"$'\e[201~'
    sleep 1
    docker exec freebuff_worker tmux send-keys -t buff Enter

    local ELAPSED=0
    while [ $ELAPSED -lt $SESSION_TIMEOUT_SEC ]; do
      sleep $POLL_INTERVAL_SEC
      ELAPSED=$((ELAPSED + POLL_INTERVAL_SEC))

      if [ -f .tickets/STATUS ] && grep -q "DONE" .tickets/STATUS; then
        echo "✅ FreeBuff signaled DONE after ${ELAPSED}s!"
        return 0
      fi

      if ! docker exec freebuff_worker tmux has-session -t buff 2>/dev/null; then
        echo "⚠️  FreeBuff tmux session exited before DONE. Respawning in 15s..."
        sleep 15
        break
      fi

      if [ $((ELAPSED % 60)) -eq 0 ]; then
        echo "⏱️  Still working... (${ELAPSED}s / ${SESSION_TIMEOUT_SEC}s)"
      fi
    done

    if [ $ELAPSED -ge $SESSION_TIMEOUT_SEC ]; then
      echo "🔄 1-Hour session limit reached. Restarting FreeBuff with continuation context..."
      docker exec freebuff_worker tmux kill-session -t buff 2>/dev/null || true
      PROMPT="Your previous 1-hour FreeBuff session timed out while working. Run 'git status' and 'git diff' to see what is already implemented, finish any remaining work, verify tests pass, write your summary/rebuttal to .reviews/agent_notes.md, and run: echo DONE > .tickets/STATUS"
      sleep 10
    fi
  done
}

# === PHASE 1: DECOMPOSE SPEC ===
if [ -z "$(ls -A .tickets/T-*.md 2>/dev/null)" ]; then
  echo "🏗️  Phase 1: Decomposing SPEC.md into atomic tickets..."
  
  if grep -q "===TICKET:" .reviews/raw_tickets.txt 2>/dev/null; then
    echo "♻️  Found existing tickets in .reviews/raw_tickets.txt! Salvaging to save quota..."
  else
    cat << PROMPT_EOF > .reviews/phase1_prompt.txt
You are a Principal Systems Architect. DO NOT use any internal tools, DO NOT run bash commands, and DO NOT read external files.

Read the specification and agent rules provided inline below, and break the CURRENT ACTIVE MILESTONE down into sequential, atomic implementation tickets.

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

Do NOT output any text or preamble before the first ===TICKET:...=== marker.
PROMPT_EOF

    run_agy_with_fallback \
      "$PRIMARY_ARCHITECT_MODEL" \
      "$FALLBACK_MODEL" \
      ".reviews/phase1_prompt.txt" ".reviews/raw_tickets.txt" "===TICKET:"
  fi

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

# === PHASE 2: AUTONOMOUS TICKET EXECUTION & BIDIRECTIONAL REVIEW LOOP ===
mapfile -t ALL_TICKETS < <(ls -1 .tickets/T-*.md | sort)
TOTAL_TICKETS=${#ALL_TICKETS[@]}
UNCOMPLETED_COUNT=0
BATCH_BASE_COMMIT=$(git rev-parse HEAD)
BATCH_TICKET_DOCS=""

for (( i=0; i<TOTAL_TICKETS; i++ )); do
  TICKET_FILE="${ALL_TICKETS[$i]}"
  TICKET_NUM=$((i + 1))
  TICKET_NAME=$(basename "$TICKET_FILE" .md)
  DONE_MARKER=".tickets/.completed_${TICKET_NAME}"

  if [ -f "$DONE_MARKER" ]; then
    echo "⏭️  Skipping ${TICKET_NAME} (${TICKET_NUM}/${TOTAL_TICKETS} - already merged)."
    BATCH_BASE_COMMIT=$(git rev-parse HEAD)
    continue
  fi

  UNCOMPLETED_COUNT=$((UNCOMPLETED_COUNT + 1))
  BATCH_TICKET_DOCS="${BATCH_TICKET_DOCS}"$'\n\n'"--- TICKET: ${TICKET_FILE} ---"$'\n'"$(cat "$TICKET_FILE")"

  echo "=================================================================="
  echo "🎬 Starting Ticket ${TICKET_NUM}/${TOTAL_TICKETS}: ${TICKET_NAME}"
  echo "=================================================================="

  BRANCH_NAME="feat/${TICKET_NAME}"
  git checkout -b "$BRANCH_NAME" 2>/dev/null || git checkout "$BRANCH_NAME"

  # If FreeBuff already finished work on this branch (e.g. .tickets/STATUS == DONE), verify it first without redoing work!
  if [ -f .tickets/STATUS ] && grep -q "DONE" .tickets/STATUS; then
    echo "♻️  Found existing completed work (.tickets/STATUS == DONE) on ${BRANCH_NAME}. Proceeding straight to verification..."
  else
    rm -f .reviews/agent_notes.md
    WORK_PROMPT="Implement @${TICKET_FILE} following all rules in @AGENTS.md and @SPEC.md. Write a brief summary of your implementation into .reviews/agent_notes.md, verify all unit tests pass, and then run: echo DONE > .tickets/STATUS"
    run_freebuff_until_done "$WORK_PROMPT"
  fi

  DO_AI_REVIEW=0
  if [ $((UNCOMPLETED_COUNT % REVIEW_EVERY_N_TICKETS)) -eq 0 ] || [ "$TICKET_NUM" -eq "$TOTAL_TICKETS" ]; then
    DO_AI_REVIEW=1
  fi

  # Verification & Bidirectional Debate Loop
  ROUND=1
  TEST_RETRIES=0
  while true; do
    
    # STAGE 1: Deterministic Local Test Gate
    if ! run_local_test_gate "$TICKET_FILE"; then
      TEST_RETRIES=$((TEST_RETRIES + 1))
      if [ $TEST_RETRIES -gt $MAX_REVIEW_ROUNDS ]; then
        echo "🛑 ${TICKET_NAME} failed local test gate ${TEST_RETRIES} times. Pausing pipeline."
        exit 1
      fi
      FIX_TESTS_PROMPT="🚨 AUTOMATED TEST GATE REJECTION: You marked @${TICKET_FILE} as DONE, but the host test suite FAILED. Read @.reviews/test_failure_report.md, fix the broken code/tests, update .reviews/agent_notes.md, and run: echo DONE > .tickets/STATUS"
      run_freebuff_until_done "$FIX_TESTS_PROMPT"
      continue
    fi

    if [ "$DO_AI_REVIEW" -eq 0 ]; then
      echo "⚡ Local test gate passed! Merging intermediate batch ticket ${TICKET_NAME}..."
      git add -A
      git commit -m "Complete ${TICKET_NAME} (verified by local test gate)"
      git checkout main 2>/dev/null || git checkout master
      git merge --no-ff "$BRANCH_NAME" -m "Merge ${TICKET_NAME}"
      touch "$DONE_MARKER"
      break
    fi

    # STAGE 2: Bidirectional AI Code Review
    git add -N .
    DIFF_FILE=".reviews/current.diff"
    git diff "$BATCH_BASE_COMMIT" -- . \
      ':(exclude)*package-lock.json' \
      ':(exclude)*yarn.lock' \
      ':(exclude)*pnpm-lock.yaml' \
      ':(exclude)*/target/*' \
      ':(exclude)*/node_modules/*' \
      ':(exclude).reviews/*' \
      ':(exclude).tickets/*' \
      ':(exclude)autopilot.sh' \
      ':(exclude)start-workspace.sh' \
      ':(exclude)oversee-freebuff.sh' \
      ':(exclude)watch-reviews.sh' \
      ':(exclude)next-milestone.sh' | head -c 65000 > "$DIFF_FILE"

    NOTES_CONTENT="No implementer notes provided."
    if [ -f .reviews/agent_notes.md ]; then
      NOTES_CONTENT=$(cat .reviews/agent_notes.md)
    fi

    REVIEW_FILE=".reviews/${TICKET_NAME}-review-${ROUND}.md"
    echo "🔍 Auditing ${TICKET_NAME} (Review Round ${ROUND}/${MAX_REVIEW_ROUNDS})..."

    cat << PROMPT_EOF > .reviews/review_prompt.txt
You are a Principal Code Reviewer conducting Review Round ${ROUND} of ${MAX_REVIEW_ROUNDS}.
CRITICAL INSTRUCTION: Do NOT use any tools, do NOT run bash commands, and do NOT read any external files. All required context is provided inline below. Note that the local unit test suite ('sbt test' / 'npm test') has ALREADY passed.

<tickets_in_scope>
${BATCH_TICKET_DOCS}
</tickets_in_scope>

<implementer_notes_and_rebuttals>
${NOTES_CONTENT}
</implementer_notes_and_rebuttals>

<git_diff>
$(cat "$DIFF_FILE")
</git_diff>

REVIEW GUIDELINES:
1. Carefully read <implementer_notes_and_rebuttals> to see how the implementer addressed previous review feedback and why certain choices or scope boundaries were maintained.
2. Only request changes (VERDICT: CHANGES_REQUESTED) if there is a genuine High/Medium severity logic bug, security flaw, or missing core requirement from the ticket.
3. Do NOT block approval over Low-severity nitpicks, hypothetical edge cases outside standard Durak rules, or valid scope rebuttals explained in <implementer_notes_and_rebuttals>.

End your response with EXACTLY one of:
VERDICT: APPROVED
or
VERDICT: CHANGES_REQUESTED
PROMPT_EOF

    ACTIVE_MODEL_USED=""
    run_agy_with_fallback \
      "$PRIMARY_REVIEWER_MODEL" \
      "$FALLBACK_MODEL" \
      ".reviews/review_prompt.txt" "$REVIEW_FILE" "VERDICT: (APPROVED|CHANGES_REQUESTED)"
    rm -f "$DIFF_FILE"

    if grep -q "VERDICT: APPROVED" "$REVIEW_FILE"; then
      echo "🎉 ${TICKET_NAME} APPROVED by ${ACTIVE_MODEL_USED} on Round ${ROUND}!"
      rm -f .tickets/STATUS
      git add -A
      git commit -m "Complete ${TICKET_NAME} (reviewed by ${ACTIVE_MODEL_USED})"
      git checkout main 2>/dev/null || git checkout master
      git merge --no-ff "$BRANCH_NAME" -m "Merge ${TICKET_NAME}"
      touch "$DONE_MARKER"
      BATCH_BASE_COMMIT=$(git rev-parse HEAD)
      BATCH_TICKET_DOCS=""
      break
    fi

    # Check if we hit max debate rounds AFTER reviewing the latest fix
    if [ $ROUND -ge $MAX_REVIEW_ROUNDS ]; then
      echo "🛑 Disagreement unresolved after ${MAX_REVIEW_ROUNDS} review rounds on ${TICKET_NAME}. Pausing for human inspection."
      exit 1
    fi

    echo "🔧 Changes requested by ${ACTIVE_MODEL_USED} (Round ${ROUND}). Sending review to FreeBuff for fix or rebuttal..."
    FIX_PROMPT="🚨 CODE REVIEW FEEDBACK (Round ${ROUND}): Read the reviewer feedback in @${REVIEW_FILE} and the original ticket @${TICKET_FILE}. For each point raised: (1) If it is a valid bug or missing test in your scope, fix it in the code/tests. (2) If you disagree with a point or it is outside your ticket scope, write a clear technical rebuttal in .reviews/agent_notes.md explaining what you fixed and why any remaining point was not changed. Re-run the test suite until green, save .reviews/agent_notes.md, and run: echo DONE > .tickets/STATUS"
    run_freebuff_until_done "$FIX_PROMPT"
    ROUND=$((ROUND + 1))
  done
done

echo "🏆 ALL TICKETS IN CURRENT MILESTONE COMPLETED AND MERGED TO MAIN!"
