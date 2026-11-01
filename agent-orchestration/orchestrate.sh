#!/usr/bin/env bash
set -u
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

INITIAL_WORKERS=3
while [ $# -gt 0 ]; do
  case "$1" in
    --workers|-w)
      INITIAL_WORKERS="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

mkdir -p .tickets .reviews .reviews/feedback_archive
echo "$INITIAL_WORKERS" > .reviews/target_workers

# Re-arm the single-email notification latch on fresh orchestrator startup
rm -f .reviews/alert_sent.latch

if [ -f "$PROJECT_ROOT/agent-orchestration/.env" ]; then
  set -a
  # shellcheck disable=SC1090
  source <(grep -v "^FREEBUFF_AUTH_B64=" "$PROJECT_ROOT/agent-orchestration/.env") 2>/dev/null || true
  set +a
fi

AGENT_GIT_NAME="${AGENT_GIT_NAME:-Lidurak Agent Bot}"
AGENT_GIT_EMAIL="${AGENT_GIT_EMAIL:-agent-bot@lidurak.local}"

agent_git() {
  GIT_AUTHOR_NAME="$AGENT_GIT_NAME" \
  GIT_AUTHOR_EMAIL="$AGENT_GIT_EMAIL" \
  GIT_COMMITTER_NAME="$AGENT_GIT_NAME" \
  GIT_COMMITTER_EMAIL="$AGENT_GIT_EMAIL" \
  git "$@"
}

agent_gh() {
  if [ -n "${AGENT_GH_TOKEN:-}" ]; then
    GH_TOKEN="$AGENT_GH_TOKEN" gh "$@"
  else
    gh "$@"
  fi
}

send_alert() {
  local SUBJECT=$1
  local BODY=$2
  if [ -x "$PROJECT_ROOT/agent-orchestration/notify.sh" ]; then
    "$PROJECT_ROOT/agent-orchestration/notify.sh" "$SUBJECT" "$BODY" || true
  fi
}

reset_alert_latch() {
  rm -f "$PROJECT_ROOT/.reviews/alert_sent.latch"
}

retry_git_push() {
  local attempt=1
  while [ "$attempt" -le 4 ]; do
    if git push "$@"; then return 0; fi
    local wait_s
    wait_s=$(expr "$attempt" \* 4)
    echo "⚠️  git push failed (attempt ${attempt}/4). Retrying in ${wait_s}s..."
    sleep "$wait_s"
    attempt=$(expr "$attempt" + 1)
  done
  return 1
}

cleanup_on_interrupt() {
  echo ""
  echo "🛑 Interrupted by user (Ctrl+C). Terminating active worker jobs safely..."
  pkill -9 -P $$ 2>/dev/null || true
  rm -f .reviews/worker_*.pid .reviews/worker_*.ticket .reviews/admission.lock
  if [ -f FEEDBACK.in_progress.md ]; then
    cp FEEDBACK.in_progress.md FEEDBACK.md
    rm -f FEEDBACK.in_progress.md
  fi
  exit 130
}
trap cleanup_on_interrupt INT TERM

./agent-orchestration/start-workspace.sh "$INITIAL_WORKERS"

# === THREE-POOL ANTIGRAVITY MODEL ROUTING ===
ARCHITECT_CHAIN=("claude-opus-5-5-high" "gemini-4-argon-high" "claude-sonnet-5-5-high" "gemini-3.8-flash-high")
REVIEWER_R1_CHAIN=("gemini-4-argon-high" "claude-sonnet-5-5-high" "gemini-4-argon-medium" "gemini-3.8-flash-high")
REVIEWER_ESCALATED_CHAIN=("claude-opus-5-5-high" "gemini-4-argon-high" "claude-sonnet-5-5-high" "gemini-3.8-flash-high")

AGY_TIMEOUT_SEC=600
SESSION_TIMEOUT_SEC=3300
POLL_INTERVAL_SEC=10
MAX_REVIEW_ROUNDS=4

USE_GITHUB_PRS=0
if git remote get-url origin >/dev/null 2>&1 && agent_gh auth status >/dev/null 2>&1; then
  USE_GITHUB_PRS=1
  echo "🌐 GitHub Integration : ENABLED ($(git remote get-url origin))"
else
  echo "⚠️  GitHub Integration : LOCAL-ONLY"
fi

echo "=================================================================="
echo "⚙️  Project Root       : ${PROJECT_ROOT}"
echo "⚙️  Dynamic Workers    : ${INITIAL_WORKERS} (Scale live: ./agent-orchestration/scale-workers.sh <N>)"
echo "⚙️  Bot Git Identity   : ${AGENT_GIT_NAME} <${AGENT_GIT_EMAIL}>"
echo "⚙️  Architect Pool     : ${ARCHITECT_CHAIN[*]}"
echo "⚙️  Reviewer R1 Pool   : ${REVIEWER_R1_CHAIN[*]}"
echo "⚙️  Escalation Pool    : ${REVIEWER_ESCALATED_CHAIN[*]}"
echo "=================================================================="

git checkout main 2>/dev/null || true
if [ "$USE_GITHUB_PRS" -eq 1 ]; then
  git fetch origin main 2>/dev/null || true
fi

kill_agy_tree() {
  local PID=$1
  pkill -9 -P "$PID" 2>/dev/null || true
  kill -9 "$PID" 2>/dev/null || true
}

try_agy_call() {
  local MODEL=$1
  local PROMPT_FILE=$2
  local OUT_FILE=$3
  local EXPECT_PATTERN=$4
  local END_SENTINEL=${5:-"VERDICT: (APPROVED|CHANGES_REQUESTED)|===END_OF_TICKETS===|===END_OF_FILES===|===NO_TICKETS_NEEDED==="}
  local ERR_LOG="${OUT_FILE}.err"

  rm -f "$OUT_FILE" "$ERR_LOG"
  touch "$OUT_FILE"
  echo "🤖 Calling Antigravity [Model: ${MODEL}] -> $(basename "$OUT_FILE")..."

  agy -p "$(cat "$PROMPT_FILE")" --model "$MODEL" --dangerously-skip-permissions < /dev/null > "$OUT_FILE" 2>"$ERR_LOG" &
  local AGY_PID=$!
  local ELAPSED=0
  local LAST_BYTES=0
  local STAGNANT_SEC=0

  while kill -0 "$AGY_PID" 2>/dev/null; do
    sleep 5
    ELAPSED=$(expr "$ELAPSED" + 5)
    local BYTES
    BYTES=$(wc -c < "$OUT_FILE" 2>/dev/null || echo 0)

    if [ "$BYTES" -gt 0 ] && grep -qE "$END_SENTINEL" "$OUT_FILE" 2>/dev/null; then
      sleep 1
      kill_agy_tree "$AGY_PID"
      echo "✅ ${MODEL} completed output in ${ELAPSED}s (${BYTES} bytes)."
      return 0
    fi

    if [ "$BYTES" -gt 500 ] && [ "$BYTES" -eq "$LAST_BYTES" ]; then
      STAGNANT_SEC=$(expr "$STAGNANT_SEC" + 5)
      if [ "$STAGNANT_SEC" -ge 25 ] && grep -qE "$EXPECT_PATTERN" "$OUT_FILE" 2>/dev/null; then
        kill_agy_tree "$AGY_PID"
        echo "✅ ${MODEL} stream idle for 25s with valid output (${BYTES} bytes)."
        return 0
      fi
    else
      STAGNANT_SEC=0
    fi
    LAST_BYTES=$BYTES

    local MOD15
    MOD15=$(expr "$ELAPSED" % 15 || true)
    if [ "$MOD15" -eq 0 ]; then
      echo "   ⏳ ${MODEL} streaming... (${ELAPSED}s / ${AGY_TIMEOUT_SEC}s | ${BYTES} bytes)"
    fi

    if [ "$ELAPSED" -ge "$AGY_TIMEOUT_SEC" ]; then
      kill_agy_tree "$AGY_PID"
      if [ -s "$OUT_FILE" ] && grep -qE "$EXPECT_PATTERN" "$OUT_FILE"; then
        echo "♻️  Salvaged valid output written before timeout!"
        return 0
      fi
      return 1
    fi
  done

  if [ -s "$OUT_FILE" ] && grep -qE "$EXPECT_PATTERN" "$OUT_FILE"; then
    return 0
  fi

  # Check if Antigravity CLI explicitly reported an authentication / login failure
  if grep -qiE "not logged in|unauthenticated|auth login|Please login|invalid_grant|401 Unauthorized" "$ERR_LOG" "$OUT_FILE" 2>/dev/null; then
    send_alert "Antigravity Login Required" "Antigravity CLI (agy) reported an authentication error while calling ${MODEL}. Please run 'agy auth login' in WSL."
  fi

  return 1
}

run_agy_pool() {
  local ROLE=$1
  local PROMPT_FILE=$2
  local OUT_FILE=$3
  local EXPECT_PATTERN=$4
  local -a CHAIN

  case "$ROLE" in
    ARCHITECT)
      CHAIN=("${ARCHITECT_CHAIN[@]}")
      ;;
    REVIEWER_R1)
      CHAIN=("${REVIEWER_R1_CHAIN[@]}")
      ;;
    *)
      CHAIN=("${REVIEWER_ESCALATED_CHAIN[@]}")
      ;;
  esac

  while true; do
    for MODEL in "${CHAIN[@]}"; do
      if try_agy_call "$MODEL" "$PROMPT_FILE" "$OUT_FILE" "$EXPECT_PATTERN"; then
        ACTIVE_MODEL_USED="$MODEL"
        return 0
      fi
      echo "🔀 [${ROLE}] Model ${MODEL} unavailable or rate-limited; advancing to next pool model..."
    done
    echo "💤 All 3 model pools exhausted or offline. Sending single notification (if not already sent) and sleeping 5 minutes..."
    send_alert "Antigravity Quota Exhausted or Offline (${ROLE})" "All models across all 3 Antigravity pools (${CHAIN[*]}) failed or hit quota limits during role ${ROLE}. The orchestrator is sleeping and retrying every 5 minutes. Please check 'agy' login or quota status."
    sleep 300
  done
}

admit_and_send_prompt() {
  local WORKER_ID=$1
  local PROMPT=$2
  local CONTAINER="freebuff_worker_${WORKER_ID}"
  local STATUS_FILE=".reviews/worker_${WORKER_ID}.status"
  local PREV_STATUS
  PREV_STATUS=$(cat "$STATUS_FILE" 2>/dev/null || echo "🔨 Working...")

  (
    flock -x 201

    if ! docker exec "$CONTAINER" tmux has-session -t buff 2>/dev/null; then
      echo "[Worker ${WORKER_ID}] 🚀 Launching FreeBuff TUI inside ${CONTAINER}..."
      docker exec "$CONTAINER" tmux new-session -d -s buff "NODE_OPTIONS='--dns-result-order=ipv4first' freebuff"
      sleep 6
    fi

    local READY_CHECKS=0
    local LOGGED_IN_NOW=0
    local AUTO_RESTORE_ATTEMPTED=0

    while true; do
      if ! docker exec "$CONTAINER" tmux has-session -t buff 2>/dev/null; then
        docker exec "$CONTAINER" tmux new-session -d -s buff "NODE_OPTIONS='--dns-result-order=ipv4first' freebuff"
        sleep 6
        continue
      fi

      local SCREEN
      SCREEN=$(docker exec "$CONTAINER" tmux capture-pane -t buff -p 2>/dev/null || true)
      if [ -z "$(echo "$SCREEN" | tr -d '[:space:]')" ]; then
        READY_CHECKS=0
        sleep 2
        continue
      fi

      if echo "$SCREEN" | grep -qiE "admission_attempt_closed|session POST failed|This session start was cancelled|operation timed out"; then
        READY_CHECKS=0
        echo "[Worker ${WORKER_ID}] 🔄 Resetting closed admission attempt..."
        docker exec "$CONTAINER" tmux kill-session -t buff 2>/dev/null || true
        sleep 4
        docker exec "$CONTAINER" tmux new-session -d -s buff "NODE_OPTIONS='--dns-result-order=ipv4first' freebuff"
        sleep 6
        continue
      fi

      if echo "$SCREEN" | grep -qiE "Log in|Sign in|visit https://|Press Enter to login|Waiting for login|authenticate|Open this link|not authenticated"; then
        READY_CHECKS=0
        # First attempt: try restoring credentials from .env and restarting TUI once before bothering the human
        if [ "$AUTO_RESTORE_ATTEMPTED" -eq 0 ]; then
          AUTO_RESTORE_ATTEMPTED=1
          echo "[Worker ${WORKER_ID}] 🔄 Login screen detected; attempting automatic credential restore from .env first..."
          AUTH_B64=$(grep '^FREEBUFF_AUTH_B64=' "$PROJECT_ROOT/agent-orchestration/.env" 2>/dev/null | head -n 1 | cut -d= -f2- | tr -d '"' || true)
          if [ -n "$AUTH_B64" ]; then
            printf '%s' "$AUTH_B64" | base64 -d | tar -xzf - -C "$PROJECT_ROOT/agent-orchestration/.runtime/freebuff-home" 2>/dev/null || true
            docker exec "$CONTAINER" tmux kill-session -t buff 2>/dev/null || true
            sleep 3
            docker exec "$CONTAINER" tmux new-session -d -s buff "NODE_OPTIONS='--dns-result-order=ipv4first' freebuff"
            sleep 6
            continue
          fi
        fi

        # If auto-restore didn't clear the login screen, notify human once (latch-protected)
        LOGGED_IN_NOW=1
        echo "🔐 Log in once in Worker-${WORKER_ID} (Tab ${WORKER_ID}) — auto-saves to .env for all workers!" > "$STATUS_FILE"
        echo "[Worker ${WORKER_ID}] 🔐 Waiting for one-time login in Tab ${WORKER_ID}..."
        send_alert "FreeBuff Login Required (Worker ${WORKER_ID})" "FreeBuff's authentication token has expired and requires a manual login in Window 2 (Worker-${WORKER_ID}, Tab ${WORKER_ID}). Once you log in once, the new token will be saved to .env for all workers automatically."
        sleep 4
        continue
      fi

      if echo "$SCREEN" | grep -qiE "waiting room|queued|position in queue|Starting your model session|Connecting to|Initializing"; then
        READY_CHECKS=0
        echo "⏳ Admitting FreeBuff session (Worker-${WORKER_ID})..." > "$STATUS_FILE"
        sleep 4
        continue
      fi

      READY_CHECKS=$(expr "$READY_CHECKS" + 1)
      if [ "$READY_CHECKS" -ge 2 ]; then
        break
      fi
      sleep 2
    done

    # If the user completed a manual login, persist the new token and re-arm the notification latch!
    if [ "$LOGGED_IN_NOW" -eq 1 ]; then
      ./agent-orchestration/save-auth.sh >/dev/null 2>&1 || true
      reset_alert_latch
    fi

    echo "$PREV_STATUS" > "$STATUS_FILE"
    echo "[Worker ${WORKER_ID}] 📨 Submitting prompt to FreeBuff..."
    docker exec "$CONTAINER" tmux send-keys -t buff -l -- "${PROMPT}"
    sleep 1
    docker exec "$CONTAINER" tmux send-keys -t buff Enter

    local ADMIT_WAIT=0
    while [ "$ADMIT_WAIT" -lt 45 ]; do
      sleep 3
      ADMIT_WAIT=$(expr "$ADMIT_WAIT" + 3)
      local S_AFTER
      S_AFTER=$(docker exec "$CONTAINER" tmux capture-pane -t buff -p 2>/dev/null || true)
      if echo "$S_AFTER" | grep -qiE "Starting your model session"; then
        continue
      fi
      break
    done
  ) 201>.reviews/admission.lock
}

run_worker_freebuff() {
  local WORKER_ID=$1
  local PROMPT=$2
  local WT_DIR=".worktrees/worker-${WORKER_ID}"
  local CONTAINER="freebuff_worker_${WORKER_ID}"

  rm -f "${WT_DIR}/.tickets/STATUS"

  while true; do
    admit_and_send_prompt "$WORKER_ID" "$PROMPT"

    local ELAPSED=0
    while [ "$ELAPSED" -lt "$SESSION_TIMEOUT_SEC" ]; do
      sleep "$POLL_INTERVAL_SEC"
      ELAPSED=$(expr "$ELAPSED" + "$POLL_INTERVAL_SEC")

      if [ -f "${WT_DIR}/.tickets/STATUS" ] && grep -q "DONE" "${WT_DIR}/.tickets/STATUS" 2>/dev/null; then
        echo "[Worker ${WORKER_ID}] ✅ FreeBuff signaled DONE after ${ELAPSED}s!"
        return 0
      fi

      if ! docker exec "$CONTAINER" tmux has-session -t buff 2>/dev/null; then
        echo "[Worker ${WORKER_ID}] ⚠️  FreeBuff tmux exited early. Respawning in 6s..."
        sleep 6
        break
      fi

      SCREEN=$(docker exec "$CONTAINER" tmux capture-pane -t buff -p 2>/dev/null || true)

      if echo "$SCREEN" | grep -qiE "Starting your model session"; then
        continue
      fi

      if echo "$SCREEN" | grep -qiE "admission_attempt_closed|session POST failed|This session start was cancelled|operation timed out|not authenticated|Failed to start agent run|AI_APICallError|Message not sent|Session ended|superseded|Log in to continue"; then
        echo "[Worker ${WORKER_ID}] 🔄 Session interrupted or timed out. Re-admitting cleanly in 6s..."
        docker exec "$CONTAINER" tmux kill-session -t buff 2>/dev/null || true
        sleep 6
        break
      fi
    done

    if [ "$ELAPSED" -ge "$SESSION_TIMEOUT_SEC" ]; then
      echo "[Worker ${WORKER_ID}] 🔄 1-Hour limit reached. Restarting session with continuation prompt..."
      docker exec "$CONTAINER" tmux kill-session -t buff 2>/dev/null || true
      PROMPT="Your previous 1-hour session timed out. Run 'git status' and 'git diff' to inspect existing progress, finish remaining work, verify all tests pass, write .reviews/agent_notes.md, and run: echo DONE > .tickets/STATUS"
      sleep 6
    fi
  done
}

run_worker_test_gate() {
  local WORKER_ID=$1
  local CURRENT_TICKET=$2
  local WT_DIR=".worktrees/worker-${WORKER_ID}"
  local CONTAINER="freebuff_worker_${WORKER_ID}"
  local RAW_LOG="${WT_DIR}/.reviews/local_test_raw.log"
  local CLEAN_LOG="${WT_DIR}/.reviews/local_test_clean.log"
  local REPORT_FILE="${WT_DIR}/.reviews/test_failure_report.md"
  local CODE_FENCE
  CODE_FENCE=$(printf '\x60\x60\x60')

  echo "[Worker ${WORKER_ID}] 🧪 Running deterministic local test gate..."
  rm -f "$RAW_LOG" "$CLEAN_LOG" "$REPORT_FILE"

  if [ -f "${WT_DIR}/backend/build.sbt" ]; then
    if ! docker exec "$CONTAINER" bash -c "cd /workspace/backend && sbt -batch test" > "$RAW_LOG" 2>&1; then
      sed -r 's/\x1B\[[0-9;]*[a-zA-Z]//g' "$RAW_LOG" > "$CLEAN_LOG"
      cat << REPORT_EOF > "$REPORT_FILE"
# 🚨 Automated Local Test Gate Failure Report (Worker ${WORKER_ID})
- **Ticket:** \`${CURRENT_TICKET}\`
- **Failed Stage:** Backend Scala Test Suite (\`cd /workspace/backend && sbt -batch test\`)

## Extracted Failing Tests & Compiler Errors
${CODE_FENCE}text
$(grep -E '(\[error\]|==> X|FAILED|Exception|Error:)' "$CLEAN_LOG" | tail -n 60 || echo "See tail output below.")
${CODE_FENCE}

## Last 90 Lines of Output
${CODE_FENCE}text
$(tail -n 90 "$CLEAN_LOG")
${CODE_FENCE}
REPORT_EOF
      echo "[Worker ${WORKER_ID}] ❌ Backend 'sbt test' FAILED!"
      return 1
    fi
  fi

  if [ -f "${WT_DIR}/frontend/package.json" ]; then
    if ! docker exec "$CONTAINER" bash -c "cd /workspace/frontend && npm test -- --run" > "$RAW_LOG" 2>&1; then
      sed -r 's/\x1B\[[0-9;]*[a-zA-Z]//g' "$RAW_LOG" > "$CLEAN_LOG"
      cat << REPORT_EOF > "$REPORT_FILE"
# 🚨 Automated Local Test Gate Failure Report (Worker ${WORKER_ID})
- **Ticket:** \`${CURRENT_TICKET}\`
- **Failed Stage:** Frontend Test Suite (\`cd /workspace/frontend && npm test -- --run\`)

## Extracted Failing Suites & Assertions
${CODE_FENCE}text
$(grep -E '(FAIL|AssertionError|Error:|TS[0-9]+:|✕|×)' "$CLEAN_LOG" | tail -n 60 || echo "See tail output below.")
${CODE_FENCE}

## Last 90 Lines of Output
${CODE_FENCE}text
$(tail -n 90 "$CLEAN_LOG")
${CODE_FENCE}
REPORT_EOF
      echo "[Worker ${WORKER_ID}] ❌ Frontend 'npm test' FAILED!"
      return 1
    fi
  fi

  echo "[Worker ${WORKER_ID}] ✅ Local test gate PASSED!"
  return 0
}

process_ticket_on_worker() {
  local WORKER_ID=$1
  local TICKET_FILE=$2
  local TICKET_NAME
  TICKET_NAME=$(basename "$TICKET_FILE" .md)
  local DONE_MARKER=".tickets/.completed_${TICKET_NAME}"
  local WT_DIR=".worktrees/worker-${WORKER_ID}"
  local BRANCH_NAME="feat/${TICKET_NAME}"
  local STATUS_FILE=".reviews/worker_${WORKER_ID}.status"

  echo "🔨 Implementing ${TICKET_NAME}" > "$STATUS_FILE"
  echo "[Worker ${WORKER_ID}] 🎬 Starting ${TICKET_NAME} on branch ${BRANCH_NAME}..."

  (
    cd "$WT_DIR"
    git checkout -f -B "$BRANCH_NAME" main >/dev/null 2>&1
    mkdir -p .tickets .reviews
    cp "../../${TICKET_FILE}" ".tickets/${TICKET_NAME}.md"
    cp ../../AGENTS.md ./AGENTS.md 2>/dev/null || true
    cp ../../SPEC.md ./SPEC.md 2>/dev/null || true
    cp ../../README.md ./README.md 2>/dev/null || true
    cp ../../ARCHITECTURE.md ./ARCHITECTURE.md 2>/dev/null || true
    cp ../../play-local.sh ./play-local.sh 2>/dev/null || true
    rm -f .tickets/STATUS .reviews/agent_notes.md
  )

  local WORK_PROMPT="Implement @.tickets/${TICKET_NAME}.md following all rules in @AGENTS.md and @SPEC.md (including keeping ./README.md, ./ARCHITECTURE.md, and ./play-local.sh updated as specified). Write a concise summary of your implementation into .reviews/agent_notes.md, verify all unit tests pass, and then run: echo DONE > .tickets/STATUS"
  run_worker_freebuff "$WORKER_ID" "$WORK_PROMPT"

  local PR_NUMBER=""
  local ROUND=1
  local TEST_RETRIES=0

  while true; do
    echo "🧪 Testing ${TICKET_NAME} (Round ${ROUND})" > "$STATUS_FILE"

    if ! run_worker_test_gate "$WORKER_ID" "$TICKET_FILE"; then
      TEST_RETRIES=$(expr "$TEST_RETRIES" + 1)
      if [ "$TEST_RETRIES" -gt "$MAX_REVIEW_ROUNDS" ]; then
        echo "❌ Failed test gate on ${TICKET_NAME}" > "$STATUS_FILE"
        send_alert "Worker ${WORKER_ID} Halted — Test Gate Failed on ${TICKET_NAME}" "Ticket ${TICKET_NAME} failed the automated local unit test gate ${TEST_RETRIES} consecutive times on Worker ${WORKER_ID}. Please inspect ${WT_DIR}/.reviews/test_failure_report.md."
        return 1
      fi
      local FIX_TESTS_PROMPT="🚨 AUTOMATED TEST GATE REJECTION: You marked @.tickets/${TICKET_NAME}.md as DONE, but the test suite FAILED. Read @.reviews/test_failure_report.md, fix the broken code/tests, update .reviews/agent_notes.md, and run: echo DONE > .tickets/STATUS"
      run_worker_freebuff "$WORKER_ID" "$FIX_TESTS_PROMPT"
      continue
    fi

    (
      cd "$WT_DIR"
      rm -f .tickets/STATUS
      git add -A
      git reset -- .reviews/ .tickets/ 2>/dev/null || true
      if ! git diff --cached --quiet; then
        agent_git commit -m "feat(${TICKET_NAME}): round ${ROUND} implementation" >/dev/null
      fi
    )

    if [ "$USE_GITHUB_PRS" -eq 1 ]; then
      echo "☁️  Pushing PR for ${TICKET_NAME}" > "$STATUS_FILE"
      (
        cd "$WT_DIR"
        retry_git_push -u origin "$BRANCH_NAME" --force-with-lease >/dev/null 2>&1 || retry_git_push -u origin "$BRANCH_NAME" -f >/dev/null 2>&1
      )
      PR_NUMBER=$(agent_gh pr list --head "$BRANCH_NAME" --json number --jq '.[0].number // empty' 2>/dev/null || true)
      if [ -z "$PR_NUMBER" ]; then
        local NOTES_BODY="Automated PR for \`${TICKET_NAME}\` by Worker ${WORKER_ID}."
        [ -f "${WT_DIR}/.reviews/agent_notes.md" ] && NOTES_BODY=$(cat "${WT_DIR}/.reviews/agent_notes.md")
        agent_gh pr create \
          --base main \
          --head "$BRANCH_NAME" \
          --title "feat: ${TICKET_NAME}" \
          --body "## Ticket Specification
$(cat "$TICKET_FILE")

## Implementer Notes (Worker ${WORKER_ID})
${NOTES_BODY}" >/dev/null 2>&1 || true
        PR_NUMBER=$(agent_gh pr list --head "$BRANCH_NAME" --json number --jq '.[0].number // empty' 2>/dev/null || true)
      fi
    fi

    echo "🔍 Reviewing ${TICKET_NAME} (PR #${PR_NUMBER:-local}, Round ${ROUND})" > "$STATUS_FILE"
    local DIFF_FILE="${WT_DIR}/.reviews/current.diff"
    (
      cd "$WT_DIR"
      git diff main...HEAD -- . \
        ':(exclude)*package-lock.json' \
        ':(exclude)*yarn.lock' \
        ':(exclude)*pnpm-lock.yaml' \
        ':(exclude)*/target/*' \
        ':(exclude)*/node_modules/*' \
        ':(exclude).reviews/*' \
        ':(exclude).tickets/*' \
        ':(exclude)agent-orchestration/*' \
        ':(exclude)FEEDBACK*.md' | head -c 65000 > .reviews/current.diff
    )

    local NOTES_CONTENT="No implementer notes provided."
    [ -f "${WT_DIR}/.reviews/agent_notes.md" ] && NOTES_CONTENT=$(cat "${WT_DIR}/.reviews/agent_notes.md")

    local REVIEW_FILE=".reviews/${TICKET_NAME}-review-${ROUND}.md"
    local PROMPT_FILE="${WT_DIR}/.reviews/review_prompt.txt"

    cat << PROMPT_EOF > "$PROMPT_FILE"
You are a Principal Code Reviewer conducting PR Review Round ${ROUND} of ${MAX_REVIEW_ROUNDS} for ticket ${TICKET_NAME}.
CRITICAL INSTRUCTION: Do NOT use any tools, do NOT run bash commands, and do NOT read external files. The local unit test suite ('sbt test' / 'npm test') has ALREADY passed.

<ticket_specification>
$(cat "$TICKET_FILE")
</ticket_specification>

<implementer_notes_and_rebuttals>
${NOTES_CONTENT}
</implementer_notes_and_rebuttals>

<git_diff>
$(cat "$DIFF_FILE")
</git_diff>

REVIEW GUIDELINES:
1. Carefully read <implementer_notes_and_rebuttals> to see how the implementer addressed previous feedback.
2. Only request changes (VERDICT: CHANGES_REQUESTED) for genuine High/Medium severity logic bugs, security flaws, missing core requirements (including required updates to README.md or ARCHITECTURE.md if specified in the ticket), or UI layout violations.
3. Do NOT block approval over Low-severity nitpicks or valid scope rebuttals.

End your response with EXACTLY one of:
VERDICT: APPROVED
or
VERDICT: CHANGES_REQUESTED
PROMPT_EOF

    ACTIVE_MODEL_USED=""
    local REVIEW_ROLE="REVIEWER_R1"
    [ "$ROUND" -gt 1 ] && REVIEW_ROLE="REVIEWER_ESCALATED"

    run_agy_pool "$REVIEW_ROLE" "$PROMPT_FILE" "$REVIEW_FILE" "VERDICT: (APPROVED|CHANGES_REQUESTED)"
    cp "$REVIEW_FILE" "${WT_DIR}/.reviews/${TICKET_NAME}-review-${ROUND}.md"

    if [ "$USE_GITHUB_PRS" -eq 1 ] && [ -n "$PR_NUMBER" ]; then
      agent_gh pr comment "$PR_NUMBER" --body "### 🤖 Automated Code Review (Round ${ROUND} by ${ACTIVE_MODEL_USED})

$(cat "$REVIEW_FILE")" >/dev/null 2>&1 || true
    fi

    if grep -q "VERDICT: APPROVED" "$REVIEW_FILE"; then
      echo "[Worker ${WORKER_ID}] 🎉 ${TICKET_NAME} APPROVED by ${ACTIVE_MODEL_USED}!"
      break
    fi

    if [ "$ROUND" -ge "$MAX_REVIEW_ROUNDS" ]; then
      echo "🛑 Max review rounds exceeded on ${TICKET_NAME}" > "$STATUS_FILE"
      send_alert "Worker ${WORKER_ID} Halted — Max Review Rounds Exceeded on ${TICKET_NAME}" "Ticket ${TICKET_NAME} was not approved after ${MAX_REVIEW_ROUNDS} code review rounds on Worker ${WORKER_ID}. Please inspect .reviews/${TICKET_NAME}-review-${ROUND}.md."
      return 1
    fi

    echo "🔧 Fixing review feedback on ${TICKET_NAME} (Round ${ROUND})" > "$STATUS_FILE"
    local FIX_PROMPT="🚨 PR CODE REVIEW FEEDBACK (Round ${ROUND}): Read the reviewer feedback in @.reviews/${TICKET_NAME}-review-${ROUND}.md and the ticket @.tickets/${TICKET_NAME}.md. Fix valid issues in your scope, or write a clear technical rebuttal in .reviews/agent_notes.md. Re-run tests until green, and run: echo DONE > .tickets/STATUS"
    run_worker_freebuff "$WORKER_ID" "$FIX_PROMPT"
    ROUND=$(expr "$ROUND" + 1)
  done

  echo "🔒 Acquiring merge lock for ${TICKET_NAME}..." > "$STATUS_FILE"
  (
    flock -x 200
    echo "[Worker ${WORKER_ID}] 🔀 Reconciling ${BRANCH_NAME} with latest main..."

    cd "$PROJECT_ROOT"
    git checkout main >/dev/null 2>&1
    if [ "$USE_GITHUB_PRS" -eq 1 ]; then
      git fetch origin main >/dev/null 2>&1 || true
      git merge --ff-only origin/main >/dev/null 2>&1 || true
    fi

    cd "$WT_DIR"
    if ! agent_git merge --no-edit main >/dev/null 2>&1; then
      echo "[Worker ${WORKER_ID}] ⚠️  Merge conflict detected with main! Dispatching FreeBuff to resolve..."
      cd "$PROJECT_ROOT"
      local CONFLICT_PROMPT="🚨 GIT MERGE CONFLICT WITH MAIN: Another parallel worker merged changes to 'main' that conflict with your branch. Run 'git status' and 'git diff' to find all <<<<<<< HEAD conflict markers, resolve them cleanly so both features work together, run the test suite ('sbt -batch test' and 'npm test -- --run') until 100% green, and run: echo DONE > .tickets/STATUS"
      run_worker_freebuff "$WORKER_ID" "$CONFLICT_PROMPT"
      run_worker_test_gate "$WORKER_ID" "$TICKET_FILE" || exit 1
      cd "$WT_DIR"
      rm -f .tickets/STATUS
      git add -A
      git reset -- .reviews/ .tickets/ 2>/dev/null || true
      agent_git commit -m "chore(${TICKET_NAME}): resolve merge conflicts with main" >/dev/null 2>&1 || true
    else
      cd "$PROJECT_ROOT"
      run_worker_test_gate "$WORKER_ID" "$TICKET_FILE" || exit 1
      cd "$WT_DIR"
    fi

    git checkout --detach HEAD >/dev/null 2>&1

    cd "$PROJECT_ROOT"
    git checkout main >/dev/null 2>&1
    agent_git merge --no-ff "$BRANCH_NAME" -m "Merge ${TICKET_NAME} (PR #${PR_NUMBER:-local})" >/dev/null 2>&1
    touch "$DONE_MARKER"
    git add "$DONE_MARKER" "$TICKET_FILE" 2>/dev/null || true
    agent_git commit -m "chore(tickets): mark ${TICKET_NAME} completed" >/dev/null 2>&1 || true

    if [ "$USE_GITHUB_PRS" -eq 1 ]; then
      retry_git_push origin "$BRANCH_NAME" >/dev/null 2>&1 || true
      retry_git_push origin main >/dev/null 2>&1 || true
      git push origin --delete "$BRANCH_NAME" >/dev/null 2>&1 || true
    fi

    git branch -D "$BRANCH_NAME" >/dev/null 2>&1 || true
    echo "[Worker ${WORKER_ID}] ✅ ${TICKET_NAME} merged into main and feature branch deleted!"
  ) 200>.reviews/merge.lock

  echo "💤 Idle (Last completed: ${TICKET_NAME})" > "$STATUS_FILE"
  return 0
}

extract_tickets_with_waves() {
  local RAW_FILE=$1
  sed '/===END_OF_TICKETS===/d; /===NO_TICKETS_NEEDED===/d' "$RAW_FILE" | awk '
    /===TICKET:.*===/ {
      line=$0;
      gsub(/.*===TICKET:/, "", line);
      gsub(/===.*/, "", line);
      gsub(/[ \t\r]/, "", line);
      split(line, parts, "|");
      fname=parts[1];
      wave="1";
      if (length(parts) > 1 && parts[2] ~ /WAVE:[0-9]+/) {
        wave=parts[2];
        gsub(/WAVE:/, "", wave);
      }
      out=".tickets/" fname;
      print "<!-- WAVE:" wave " -->" > out;
      next
    }
    out != "" { print >> out }
  '
}

# === PHASE 1: DECOMPOSE CURRENT ACTIVE MILESTONE IN SPEC.md ===
ensure_milestone_tickets_exist() {
  if [ -n "$(ls -A .tickets/T-*.md 2>/dev/null)" ]; then
    return 0
  fi

  local ACTIVE_M
  ACTIVE_M=$(grep -oE "CURRENT ACTIVE MILESTONE: M[0-9]+" SPEC.md 2>/dev/null | head -n 1 | awk '{print $NF}' || echo "M1")
  echo "=================================================================="
  echo "🏗️  Phase 1: Decomposing SPEC.md (${ACTIVE_M}) into wave-scheduled tickets..."
  echo "=================================================================="

  cat << PROMPT_EOF > .reviews/phase1_prompt.txt
You are a Principal Systems Architect. DO NOT use any internal tools, DO NOT run bash commands, and DO NOT read external files.

Break the CURRENT ACTIVE MILESTONE (${ACTIVE_M}) in <spec> down into atomic implementation tickets grouped into PARALLEL EXECUTION WAVES (WAVE:1, WAVE:2, etc.).
- Put tickets that touch independent files/subsystems into the SAME wave so they run in parallel!
- Put tickets that depend on earlier tickets or edit the exact same files into sequential waves.
- REAL-TIME DOCUMENTATION REQUIREMENT: Ensure the final wave of this milestone includes updating ./README.md (installation, startup, and user interface instructions for all new features), ./ARCHITECTURE.md (technical structure, state machine, and protocol documentation), and ./play-local.sh (if startup commands or ports changed). To prevent Git merge conflicts between parallel workers, only ONE ticket in any given wave should modify README.md and ARCHITECTURE.md.

<spec>
$(cat SPEC.md)
</spec>

<agents>
$(cat AGENTS.md)
</agents>

Output each ticket using this EXACT delimiter format on its own line (including |WAVE:N), and end your entire response with ===END_OF_TICKETS===:
===TICKET:T-01-example.md|WAVE:1===
[Full Markdown content of ticket 1]
===END_OF_TICKETS===

Do NOT output any text before the first ===TICKET:...=== marker.
PROMPT_EOF

  run_agy_pool "ARCHITECT" ".reviews/phase1_prompt.txt" ".reviews/raw_tickets.txt" "===TICKET:"
  extract_tickets_with_waves ".reviews/raw_tickets.txt"

  git checkout main 2>/dev/null || true
  git add .tickets/ 2>/dev/null || true
  agent_git commit -m "chore(tickets): generate wave tickets for ${ACTIVE_M}" >/dev/null 2>&1 || true
  [ "$USE_GITHUB_PRS" -eq 1 ] && (retry_git_push origin main >/dev/null 2>&1 || true)
}

# === PHASE 1.5: HUMAN FEEDBACK PRIORITY QUEUE ===
check_and_compile_human_feedback() {
  if [ ! -f FEEDBACK.md ]; then return 0; fi
  local ACTIVE_FEEDBACK
  ACTIVE_FEEDBACK=$(sed '/<!--.*-->/d' FEEDBACK.md | tr -d '[:space:]')
  if [ -z "$ACTIVE_FEEDBACK" ]; then return 0; fi

  if grep -qiE "placeholder feedback document|without spawning any agents" FEEDBACK.md 2>/dev/null; then
    echo "ℹ️  Placeholder note detected in FEEDBACK.md; skipping agent spawn and proceeding to human review."
    cat << 'RESET_EOF' > FEEDBACK.md
<!-- Write your plain-English UI/UX feedback, bugs, or usability requests below this line. -->
<!-- Note: Your previous feedback is always backed up in FEEDBACK.backup.md and .reviews/feedback_archive/ -->

RESET_EOF
    return 0
  fi

  local TIMESTAMP
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
  cp FEEDBACK.md FEEDBACK.backup.md
  cp FEEDBACK.md ".reviews/feedback_archive/FEEDBACK_${TIMESTAMP}.md"
  cp FEEDBACK.md FEEDBACK.in_progress.md

  for old_fb in .tickets/T-9*-feedback-*.md; do
    [ -e "$old_fb" ] || continue
    local bname
    bname=$(basename "$old_fb" .md)
    [ ! -f ".tickets/.completed_${bname}" ] && rm -f "$old_fb"
  done

  echo "=================================================================="
  echo "🗣️  HUMAN FEEDBACK DETECTED IN FEEDBACK.md! Generating parallel waves..."
  echo "=================================================================="

  cat << PROMPT_EOF > .reviews/feedback_prompt.txt
You are a Principal Systems Architect. DO NOT use any internal tools, DO NOT run bash commands, and DO NOT read external files.

Decompose ALL requirements in <human_feedback> into atomic implementation tickets grouped into PARALLEL EXECUTION WAVES (WAVE:1, WAVE:2, WAVE:3).
Tickets in the same wave run concurrently on parallel FreeBuff workers:
- Assign independent subsystems to the SAME wave so they run simultaneously!
- Assign tickets that modify the exact same files or build on earlier tickets to sequential wave numbers so they never cause Git merge conflicts.
- REAL-TIME DOCUMENTATION REQUIREMENT: Ensure that the final wave of tickets updates ./README.md (installation, startup, and user interface instructions), ./ARCHITECTURE.md (technical structure and component/protocol reference), and ./play-local.sh (if server startup or ports change) to reflect all changes made in this feedback batch. Only ONE ticket in any given wave may edit README.md and ARCHITECTURE.md so parallel workers never conflict on documentation files.

<agents_rules>
$(cat AGENTS.md)
</agents_rules>

<human_feedback>
$(cat FEEDBACK.md)
</human_feedback>

<existing_project_files>
$(find backend/src frontend/src play-local.sh README.md ARCHITECTURE.md -type f 2>/dev/null | sort)
</existing_project_files>

<current_code_context>
$(head -n 120 README.md ARCHITECTURE.md play-local.sh backend/src/main/scala/**/*.scala frontend/src/app.tsx frontend/src/pages/*.tsx frontend/src/components/*.tsx 2>/dev/null | head -c 28000)
</current_code_context>

Output each ticket using this EXACT delimiter format on its own line (including |WAVE:N), and end your entire response with ===END_OF_TICKETS===:
===TICKET:T-90-feedback-${TIMESTAMP}-1-backend.md|WAVE:1===
[Full Markdown content of ticket 1]
===END_OF_TICKETS===

Do NOT output any text before the first ===TICKET:...=== marker.
PROMPT_EOF

  run_agy_pool "ARCHITECT" ".reviews/feedback_prompt.txt" ".reviews/raw_feedback_tickets.txt" "===TICKET:|===NO_TICKETS_NEEDED==="
  extract_tickets_with_waves ".reviews/raw_feedback_tickets.txt"

  cat << 'RESET_EOF' > FEEDBACK.md
<!-- Write your plain-English UI/UX feedback, bugs, or usability requests below this line. -->
<!-- Note: Your previous feedback is always backed up in FEEDBACK.backup.md and .reviews/feedback_archive/ -->

RESET_EOF

  git checkout main 2>/dev/null || true
  git add .tickets/ FEEDBACK.md FEEDBACK.backup.md 2>/dev/null || true
  agent_git commit -m "chore(tickets): add feedback wave tickets ${TIMESTAMP}" >/dev/null 2>&1 || true
  [ "$USE_GITHUB_PRS" -eq 1 ] && (retry_git_push origin main >/dev/null 2>&1 || true)
}

advance_to_next_milestone() {
  local CURRENT_M
  CURRENT_M=$(grep -oE "CURRENT ACTIVE MILESTONE: M[0-9]+" SPEC.md 2>/dev/null | head -n 1 | awk '{print $NF}' || true)
  if [ -z "$CURRENT_M" ]; then
    CURRENT_M=$(grep -oE "Milestone M[0-9]+" SPEC.md 2>/dev/null | head -n 1 | awk '{print $NF}' || echo "M1")
  fi

  local CUR_NUM="${CURRENT_M#M}"
  local NEXT_NUM
  NEXT_NUM=$(expr "$CUR_NUM" + 1)
  local NEXT_M="M${NEXT_NUM}"

  if ! grep -qiE "Milestone ${NEXT_M}|${NEXT_M}:" SPEC.md 2>/dev/null && [ "$NEXT_NUM" -gt 5 ]; then
    echo "🏆 All Milestones in SPEC.md (up through ${CURRENT_M}) are complete!"
    return 1
  fi

  local ARCHIVE_DIR=".tickets/archive_${CURRENT_M}_$(date +%Y%m%d_%H%M%S)"
  mkdir -p "$ARCHIVE_DIR"
  mv .tickets/T-*.md "$ARCHIVE_DIR"/ 2>/dev/null || true
  mv .tickets/.completed_* "$ARCHIVE_DIR"/ 2>/dev/null || true
  rm -f .reviews/raw_tickets.txt .tickets/STATUS

  if grep -q "CURRENT ACTIVE MILESTONE:" SPEC.md 2>/dev/null; then
    sed -i "s/CURRENT ACTIVE MILESTONE: M[0-9]\+/CURRENT ACTIVE MILESTONE: ${NEXT_M}/g" SPEC.md
  else
    sed -i "1i <!-- CURRENT ACTIVE MILESTONE: ${NEXT_M} -->" SPEC.md
  fi
  sed -i "s/generate atomic tickets ONLY for \*\*Milestone M[0-9]\+\*\*/generate atomic tickets ONLY for **Milestone ${NEXT_M}**/g" SPEC.md 2>/dev/null || true

  git checkout main 2>/dev/null || true
  git add SPEC.md .tickets/ 2>/dev/null || true
  agent_git commit -m "chore(milestone): sign off ${CURRENT_M} and advance active milestone to ${NEXT_M}" >/dev/null 2>&1 || true
  [ "$USE_GITHUB_PRS" -eq 1 ] && (retry_git_push origin main >/dev/null 2>&1 || true)

  echo "=================================================================="
  echo "🚀 Milestone ${CURRENT_M} archived to ${ARCHIVE_DIR}!"
  echo "🎯 SPEC.md automatically updated to target Milestone ${NEXT_M}!"
  echo "=================================================================="
  return 0
}

# === MAIN EXECUTION LOOP ===
while true; do
  ensure_milestone_tickets_exist
  check_and_compile_human_feedback

  mapfile -t ALL_TICKETS < <(ls -1 .tickets/T-*.md 2>/dev/null | sort)
  PENDING_WAVES=()

  for tf in "${ALL_TICKETS[@]}"; do
    tname=$(basename "$tf" .md)
    if [ ! -f ".tickets/.completed_${tname}" ]; then
      w=$(grep -oE "WAVE:[0-9]+" "$tf" 2>/dev/null | head -n 1 | cut -d: -f2 || true)
      [ -z "$w" ] && w="1"
      PENDING_WAVES+=("$w")
    fi
  done

  if [ ${#PENDING_WAVES[@]} -gt 0 ]; then
    mapfile -t UNIQUE_WAVES < <(printf "%s\n" "${PENDING_WAVES[@]}" | sort -n -u)

    for WAVE_NUM in "${UNIQUE_WAVES[@]}"; do
      echo "=================================================================="
      echo "🌊 EXECUTING WAVE ${WAVE_NUM} (3-Pool Router + Shared Auth)"
      echo "=================================================================="

      rm -f .reviews/worker_*.pid .reviews/worker_*.ticket

      while true; do
        TARGET_WORKERS=$(cat .reviews/target_workers 2>/dev/null || echo "$INITIAL_WORKERS")

        ACTIVE_COUNT=0
        for pid_file in .reviews/worker_*.pid; do
          [ -e "$pid_file" ] || continue
          w_id=$(basename "$pid_file" .pid | cut -d_ -f2)
          w_pid=$(cat "$pid_file" 2>/dev/null || true)
          if [ -n "$w_pid" ] && kill -0 "$w_pid" 2>/dev/null; then
            ACTIVE_COUNT=$(expr "$ACTIVE_COUNT" + 1)
          else
            rm -f "$pid_file" ".reviews/worker_${w_id}.ticket"
          fi
        done

        UNASSIGNED_TICKETS=()
        REMAINING_IN_WAVE=0
        for tf in "${ALL_TICKETS[@]}"; do
          tname=$(basename "$tf" .md)
          if [ ! -f ".tickets/.completed_${tname}" ]; then
            w=$(grep -oE "WAVE:[0-9]+" "$tf" 2>/dev/null | head -n 1 | cut -d: -f2 || true)
            [ -z "$w" ] && w="1"
            if [ "$w" = "$WAVE_NUM" ]; then
              REMAINING_IN_WAVE=$(expr "$REMAINING_IN_WAVE" + 1)
              ALREADY_ASSIGNED=0
              for tk_file in .reviews/worker_*.ticket; do
                [ -e "$tk_file" ] || continue
                if [ "$(cat "$tk_file" 2>/dev/null)" = "$tf" ]; then
                  ALREADY_ASSIGNED=1
                  break
                fi
              done
              [ "$ALREADY_ASSIGNED" -eq 0 ] && UNASSIGNED_TICKETS+=("$tf")
            fi
          fi
        done

        if [ "$REMAINING_IN_WAVE" -eq 0 ] && [ "$ACTIVE_COUNT" -eq 0 ]; then
          echo "✅ Wave ${WAVE_NUM} completely merged!"
          break
        fi

        for next_tf in "${UNASSIGNED_TICKETS[@]}"; do
          DISPATCHED=0
          for w_id in $(seq 1 "$TARGET_WORKERS"); do
            if [ ! -f ".reviews/worker_${w_id}.pid" ]; then
              if ! docker inspect "freebuff_worker_${w_id}" >/dev/null 2>&1; then
                ./agent-orchestration/start-workspace.sh "$TARGET_WORKERS"
              fi
              echo "$next_tf" > ".reviews/worker_${w_id}.ticket"
              process_ticket_on_worker "$w_id" "$next_tf" &
              echo "$!" > ".reviews/worker_${w_id}.pid"
              ACTIVE_COUNT=$(expr "$ACTIVE_COUNT" + 1)
              DISPATCHED=1
              sleep 3
              break
            fi
          done
          [ "$DISPATCHED" -eq 0 ] && break
        done

        sleep 3
      done
    done
  fi

  rm -f FEEDBACK.in_progress.md

  ACTIVE_M=$(grep -oE "CURRENT ACTIVE MILESTONE: M[0-9]+" SPEC.md 2>/dev/null | head -n 1 | awk '{print $NF}' || echo "M1")
  send_alert "Ready for Human Review (${ACTIVE_M})" "All current waves and pull requests for ${ACTIVE_M} have passed tests, passed AI code review, and merged into main. Test the build with ./play-local.sh, add notes to FEEDBACK.md, or type 'accept' in Window 1 to advance to the next milestone."

  echo "=================================================================="
  echo "🏆 ALL CURRENT WAVES COMPLETED, PRs MERGED, AND SYNCED TO GITHUB!"
  echo "=================================================================="
  echo "👉 How to test & review your build right now:"
  echo "   1. Run './play-local.sh' in Window 4 and open http://localhost:5173"
  echo "   2. Read live docs: ./README.md (User Guide) & ./ARCHITECTURE.md (Technical Docs)"
  echo "   3. Ask codebase questions: ./agent-orchestration/ask-architect.sh \"Your question\""
  echo "   4. To request UI/UX or bug fixes, write them in 'FEEDBACK.md' and press [ENTER]"
  echo "   5. To sign off on this milestone and auto-start the next milestone, type 'accept'"
  echo "------------------------------------------------------------------"
  read -r -p "Press [ENTER] after saving FEEDBACK.md, or type 'accept' to advance to the next milestone: " USER_CHOICE

  # Human responded! Re-arm the single-email notification latch for the next run
  reset_alert_latch

  if [ "$USER_CHOICE" = "accept" ] || [ "$USER_CHOICE" = "approve" ]; then
    if ! advance_to_next_milestone; then
      break
    fi
  fi
done