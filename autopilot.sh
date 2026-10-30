#!/usr/bin/env bash
set -u

# === CONFIGURATION ===
PRIMARY_ARCHITECT_MODEL="claude-opus-4-6-thinking"
PRIMARY_ARCHITECT_EFFORT="" # Claude models do not accept the effort flag

PRIMARY_REVIEWER_MODEL="claude-sonnet-4-6-thinking"
PRIMARY_REVIEWER_EFFORT="" # Claude models do not accept the effort flag

# Auto-detect exact Gemini 3.8 Flash slug from 'agy models' for fallback
DETECTED_FLASH=$(agy models 2>/dev/null | grep -oE 'gemini-3[.-]8-flash[a-z0-9-]*' | head -n 1 || true)
FALLBACK_MODEL="${DETECTED_FLASH:-gemini-3.8-flash}"

# If the detected Gemini slug already has the effort baked in (e.g. -high), don't pass the flag
if [[ "$FALLBACK_MODEL" =~ -(high|medium|low)$ ]]; then
  FALLBACK_ARCHITECT_EFFORT=""
  FALLBACK_REVIEWER_EFFORT=""
else
  FALLBACK_ARCHITECT_EFFORT="high"
  FALLBACK_REVIEWER_EFFORT="medium"
fi

# Batching toggle
REVIEW_EVERY_N_TICKETS="${REVIEW_EVERY_N_TICKETS:-1}"
if [ "${1:-}" = "--batch" ] && [ -n "${2:-}" ]; then
  REVIEW_EVERY_N_TICKETS="$2"
fi

SESSION_TIMEOUT_SEC=3300   # 55 minutes
POLL_INTERVAL_SEC=10
MAX_REVIEW_RETRIES=3

mkdir -p .tickets .reviews

echo "=================================================================="
echo "⚙️  Architect Routing : ${PRIMARY_ARCHITECT_MODEL} -> Fallback: ${FALLBACK_MODEL}"
echo "⚙️  Reviewer Routing  : ${PRIMARY_REVIEWER_MODEL} -> Fallback: ${FALLBACK_MODEL}"
echo "⚙️  LLM Review Cadence: Every ${REVIEW_EVERY_N_TICKETS} ticket(s) (Local test gate runs on ALL tickets)"
echo "=================================================================="

# Helper: Run a single Antigravity call dynamically omitting invalid flags
try_agy_call() {
  local MODEL=$1
  local EFFORT=$2
  local PROMPT_FILE=$3
  local OUT_FILE=$4
  local EXPECT_PATTERN=$5

  rm -f "$OUT_FILE" .reviews/agy_err.log

  # Safely construct the arguments array
  local AGY_ARGS=( -p "$(cat "$PROMPT_FILE")" --model "$MODEL" --dangerously-skip-permissions )
  
  if [ -n "$EFFORT" ]; then
    echo "🤖 Calling Antigravity [Model: ${MODEL} | Effort: ${EFFORT}]..."
    AGY_ARGS+=( --effort "$EFFORT" )
  else
    echo "🤖 Calling Antigravity [Model: ${MODEL}]..."
  fi

  if agy "${AGY_ARGS[@]}" < /dev/null > "$OUT_FILE" 2>.reviews/agy_err.log; then
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

# Helper: Try Primary (Claude) first; automatically fall back to Gemini 3.8 Flash
run_agy_with_fallback() {
  local PRIMARY_MODEL=$1
  local PRIMARY_EFFORT=$2
  local FB_MODEL=$3
  local FB_EFFORT=$4
  local PROMPT_FILE=$5
  local OUT_FILE=$6
  local EXPECT_PATTERN=$7

  while true; do
    if try_agy_call "$PRIMARY_MODEL" "$PRIMARY_EFFORT" "$PROMPT_FILE" "$OUT_FILE" "$EXPECT_PATTERN"; then
      ACTIVE_MODEL_USED="$PRIMARY_MODEL"
      return 0
    fi

    echo "🔀 Falling back from ${PRIMARY_MODEL} to ${FB_MODEL}..."
    if try_agy_call "$FB_MODEL" "$FB_EFFORT" "$PROMPT_FILE" "$OUT_FILE" "$EXPECT_PATTERN"; then
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

# Helper: Deterministic Local Test Gate
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
- **Action Required:** You marked this ticket as \`DONE\`, but \`sbt test\` failed with compilation or test assertion errors. Fix the exact errors below without rewriting unrelated working code.

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
- **Action Required:** You marked this ticket as \`DONE\`, but \`npm test\` failed. Fix the exact failing tests or TypeScript errors below without rewriting unrelated working code.

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

# Helper: Send prompt to FreeBuff inside Docker tmux
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
      PROMPT="Your previous 1-hour FreeBuff session timed out while working. Run 'git status' and 'git diff' to see what is already implemented, finish any remaining work, verify tests pass, and run: echo DONE > .tickets/STATUS"
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
      "$PRIMARY_ARCHITECT_MODEL" "$PRIMARY_ARCHITECT_EFFORT" \
      "$FALLBACK_MODEL" "$FALLBACK_ARCHITECT_EFFORT" \
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

# === PHASE 2: AUTONOMOUS TICKET EXECUTION & HYBRID REVIEW LOOP ===
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

  WORK_PROMPT="Implement @${TICKET_FILE} following all rules in @AGENTS.md and @SPEC.md. When all unit tests pass, run: echo DONE > .tickets/STATUS"
  run_freebuff_until_done "$WORK_PROMPT"

  DO_AI_REVIEW=0
  if [ $((UNCOMPLETED_COUNT % REVIEW_EVERY_N_TICKETS)) -eq 0 ] || [ "$TICKET_NUM" -eq "$TOTAL_TICKETS" ]; then
    DO_AI_REVIEW=1
  fi

  ATTEMPT=1
  while [ $ATTEMPT -le $MAX_REVIEW_RETRIES ]; do
    
    if ! run_local_test_gate "$TICKET_FILE"; then
      FIX_TESTS_PROMPT="🚨 AUTOMATED TEST GATE REJECTION: You marked @${TICKET_FILE} as DONE, but when the host ran the test suite, tests or compilation FAILED. Do NOT re-implement the whole ticket from scratch. Read @.reviews/test_failure_report.md to see the exact failing test names and compiler errors, fix ONLY the broken code/tests, verify the test command passes in the terminal, and then run: echo DONE > .tickets/STATUS"
      run_freebuff_until_done "$FIX_TESTS_PROMPT"
      ATTEMPT=$((ATTEMPT + 1))
      continue
    fi

    if [ "$DO_AI_REVIEW" -eq 0 ]; then
      echo "⚡ Local test gate passed! Merging intermediate batch ticket ${TICKET_NAME} (AI review scheduled in $((REVIEW_EVERY_N_TICKETS - (UNCOMPLETED_COUNT % REVIEW_EVERY_N_TICKETS))) ticket(s))..."
      git add -A
      git commit -m "Complete ${TICKET_NAME} (verified by local test gate)"
      git checkout main 2>/dev/null || git checkout master
      git merge --no-ff "$BRANCH_NAME" -m "Merge ${TICKET_NAME}"
      touch "$DONE_MARKER"
      break
    fi

    git add -N .
    DIFF_FILE=".reviews/current.diff"
    git diff "$BATCH_BASE_COMMIT" -- . \
      ':(exclude)*package-lock.json' \
      ':(exclude)*yarn.lock' \
      ':(exclude)*pnpm-lock.yaml' \
      ':(exclude)*/target/*' \
      ':(exclude)*/node_modules/*' \
      ':(exclude).reviews/*' \
      ':(exclude).tickets/*' | head -c 65000 > "$DIFF_FILE"

    REVIEW_FILE=".reviews/${TICKET_NAME}-review-${ATTEMPT}.md"
    echo "🔍 Auditing ${TICKET_NAME} (Attempt ${ATTEMPT}/${MAX_REVIEW_RETRIES})..."

    cat << PROMPT_EOF > .reviews/review_prompt.txt
You are a Principal Code Reviewer.
CRITICAL INSTRUCTION: Do NOT use any tools, do NOT run bash commands, and do NOT read any external files. All required context is provided inline below. Note that the local unit test suite ('sbt test' / 'npm test') has ALREADY passed.

<tickets_in_scope>
${BATCH_TICKET_DOCS}
</tickets_in_scope>

<git_diff>
$(cat "$DIFF_FILE")
</git_diff>

Audit the diff against the ticket requirements for logic bugs, security flaws, or missing edge-case tests. Be concise and specific.
End your response with EXACTLY one of:
VERDICT: APPROVED
or
VERDICT: CHANGES_REQUESTED
PROMPT_EOF

    ACTIVE_MODEL_USED=""
    run_agy_with_fallback \
      "$PRIMARY_REVIEWER_MODEL" "$PRIMARY_REVIEWER_EFFORT" \
      "$FALLBACK_MODEL" "$FALLBACK_REVIEWER_EFFORT" \
      ".reviews/review_prompt.txt" "$REVIEW_FILE" "VERDICT: (APPROVED|CHANGES_REQUESTED)"
    rm -f "$DIFF_FILE"

    if grep -q "VERDICT: APPROVED" "$REVIEW_FILE"; then
      echo "🎉 ${TICKET_NAME} APPROVED by ${ACTIVE_MODEL_USED}!"
      git add -A
      git commit -m "Complete ${TICKET_NAME} (reviewed by ${ACTIVE_MODEL_USED})"
      git checkout main 2>/dev/null || git checkout master
      git merge --no-ff "$BRANCH_NAME" -m "Merge ${TICKET_NAME}"
      touch "$DONE_MARKER"
      BATCH_BASE_COMMIT=$(git rev-parse HEAD)
      BATCH_TICKET_DOCS=""
      break
    else
      echo "🔧 Changes requested by ${ACTIVE_MODEL_USED} on ${TICKET_NAME}. Sending review to FreeBuff..."
      FIX_PROMPT="🚨 CODE REVIEW REJECTION: Your code for @${TICKET_FILE} passed local tests, but the Principal Reviewer (${ACTIVE_MODEL_USED}) requested changes. Read the specific issues listed in @${REVIEW_FILE}, fix each issue without breaking existing tests, re-run the test suite, and run: echo DONE > .tickets/STATUS"
      run_freebuff_until_done "$FIX_PROMPT"
      ATTEMPT=$((ATTEMPT + 1))
    fi
  done

  if [ ! -f "$DONE_MARKER" ]; then
    echo "🛑 ${TICKET_NAME} failed verification after ${MAX_REVIEW_RETRIES} attempts. Pausing pipeline for human inspection."
    exit 1
  fi
done

echo "🏆 ALL TICKETS IN CURRENT MILESTONE COMPLETED AND MERGED TO MAIN!"
