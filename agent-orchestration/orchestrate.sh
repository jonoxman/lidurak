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
ARCHITECT_CHAIN=("gemini-4-argon-high" "claude-opus-5-5-high" "claude-sonnet-5-5-high" "gemini-3.8-flash-high")
REVIEWER_R1_CHAIN=("gemini-4-argon-high" "claude-sonnet-5-5-high" "gemini-4-argon-medium" "gemini-3.8-flash-high")
REVIEWER_ESCALATED_CHAIN=("gemini-4-argon-high" "claude-opus-5-5-high" "claude-sonnet-5-5-high" "gemini-3.8-flash-high")

AGY_TIMEOUT_SEC=600
SESSION_TIMEOUT_SEC=3300
POLL_INTERVAL_SEC=10
MAX_REVIEW_ROUNDS=4
MAX_HOLISTIC_AUDIT_PASSES=2

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
  disown "$PID" 2>/dev/null || true
  pkill -9 -P "$PID" 2>/dev/null || true
  kill -9 "$PID" 2>/dev/null || true
}

try_agy_call() {
  local MODEL=$1
  local PROMPT_FILE=$2
  local OUT_FILE=$3
  local EXPECT_PATTERN=$4
  local END_SENTINEL=${5:-"VERDICT: (APPROVED|CHANGES_REQUESTED)|===END_OF_TICKETS===|===END_OF_FILES===|===NO_TICKETS_NEEDED===|===AUDIT_PASSED===|===VISUAL_QA_PASSED===|===END_OF_QUESTIONS===|===NO_QUESTIONS==="}
  local ERR_LOG="${OUT_FILE}.err"

  rm -f "$OUT_FILE" "$ERR_LOG"
  touch "$OUT_FILE"

  # Guard against Linux MAX_ARG_STRLEN (131072 bytes) overflow on -p "$(cat ...)"
  local P_BYTES
  P_BYTES=$(wc -c < "$PROMPT_FILE" 2>/dev/null || echo 0)
  if [ "$P_BYTES" -gt 115000 ]; then
    echo "   ⚠️  Prompt $(basename "$PROMPT_FILE") is ${P_BYTES} bytes (>115KB limit); compacting to fit Linux argv limit..."
    head -c 110000 "$PROMPT_FILE" > "${PROMPT_FILE}.compact"
    printf "\n\n[... context truncated to fit 115KB CLI limit ...]\n" >> "${PROMPT_FILE}.compact"
    tail -n 35 "$PROMPT_FILE" >> "${PROMPT_FILE}.compact"
    mv "${PROMPT_FILE}.compact" "$PROMPT_FILE"
    P_BYTES=$(wc -c < "$PROMPT_FILE" 2>/dev/null || echo 0)
  fi

  echo "🤖 Calling Antigravity [Model: ${MODEL}] (Prompt: ${P_BYTES} bytes) -> $(basename "$OUT_FILE")..."

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

  if [ -s "$ERR_LOG" ]; then
    echo "   ⚠️  [${MODEL} stderr]: $(tr '\n' ' ' < "$ERR_LOG" | head -c 300)"
  elif [ -s "$OUT_FILE" ]; then
    echo "   ⚠️  [${MODEL} unexpected output]: $(tail -n 5 "$OUT_FILE" | tr '\n' ' ' | head -c 300)"
  fi

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

# Helper to dump full current source files (up to ~150KB) so Architect & Auditor never miss lines > 160
dump_full_codebase_context() {
  for f in README.md ARCHITECTURE.md play-local.sh \
           backend/src/main/scala/durak/Main.scala \
           backend/src/main/scala/durak/engine/*.scala \
           backend/src/main/scala/durak/server/*.scala \
           frontend/src/types.ts \
           frontend/src/app.tsx \
           frontend/src/api/*.ts \
           frontend/src/audio/*.ts \
           frontend/src/pages/*.tsx \
           frontend/src/components/*.tsx \
           frontend/src/styles/*.css; do
    [ -f "$f" ] || continue
    echo "===SOURCE_FILE:${f}==="
    cat "$f"
    echo ""
  done | grep -v '^[[:space:]]*$' | head -c 65000
}

# Serialized FreeBuff admission & prompt submission (handles "This session was released" / "Enter: retry" automatically)
admit_and_send_prompt() {
  local WORKER_ID=$1
  local PROMPT=$2
  local CONTAINER="freebuff_worker_${WORKER_ID}"
  local STATUS_FILE=".reviews/worker_${WORKER_ID}.status"
  local PREV_STATUS
  PREV_STATUS=$(cat "$STATUS_FILE" 2>/dev/null || echo "🔨 Working...")

  (
    flock -x 201

    while true; do
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

        if echo "$SCREEN" | grep -qiE "session was released|Choose a model to start a new session|Enter: retry|admission_attempt_closed|session POST failed|This session start was cancelled|operation timed out"; then
          READY_CHECKS=0
          echo "[Worker ${WORKER_ID}] 🔄 Resetting released/expired FreeBuff session before prompt submission..."
          docker exec "$CONTAINER" tmux kill-session -t buff 2>/dev/null || true
          sleep 3
          docker exec "$CONTAINER" tmux new-session -d -s buff "NODE_OPTIONS='--dns-result-order=ipv4first' freebuff"
          sleep 6
          continue
        fi

        if echo "$SCREEN" | grep -qiE "Log in|Sign in|visit https://|Press Enter to login|Waiting for login|authenticate|Open this link|not authenticated"; then
          READY_CHECKS=0
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
      local RELEASE_RETRIES=0
      local NEED_FULL_RESTART=0

      while [ "$ADMIT_WAIT" -lt 60 ]; do
        sleep 3
        ADMIT_WAIT=$(expr "$ADMIT_WAIT" + 3)
        local S_AFTER
        S_AFTER=$(docker exec "$CONTAINER" tmux capture-pane -t buff -p 2>/dev/null || true)

        if echo "$S_AFTER" | grep -qiE "session was released|Choose a model to start a new session|Enter: retry"; then
          RELEASE_RETRIES=$(expr "$RELEASE_RETRIES" + 1)
          if [ "$RELEASE_RETRIES" -le 3 ]; then
            echo "[Worker ${WORKER_ID}] 🔄 Session was released upon submit; sending Enter (attempt ${RELEASE_RETRIES}/3) to start a new session..."
            docker exec "$CONTAINER" tmux send-keys -t buff Enter
            sleep 3
            continue
          else
            echo "[Worker ${WORKER_ID}] 🔄 Session release banner persisted after 3 retries; restarting clean FreeBuff TUI..."
            docker exec "$CONTAINER" tmux kill-session -t buff 2>/dev/null || true
            sleep 3
            NEED_FULL_RESTART=1
            break
          fi
        fi

        if echo "$S_AFTER" | grep -qiE "admission_attempt_closed|session POST failed|This session start was cancelled|operation timed out"; then
          echo "[Worker ${WORKER_ID}] 🔄 Admission error detected after submit; restarting clean FreeBuff TUI..."
          docker exec "$CONTAINER" tmux kill-session -t buff 2>/dev/null || true
          sleep 3
          NEED_FULL_RESTART=1
          break
        fi

        if echo "$S_AFTER" | grep -qiE "Starting your model session|waiting room|queued|position in queue|Connecting to"; then
          continue
        fi

        break
      done

      if [ "$NEED_FULL_RESTART" -eq 1 ]; then
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
    local MID_RUN_RELEASE_RETRIES=0

    while [ "$ELAPSED" -lt "$SESSION_TIMEOUT_SEC" ]; do
      sleep "$POLL_INTERVAL_SEC"
      ELAPSED=$(expr "$ELAPSED" + "$POLL_INTERVAL_SEC")

      if [ -f "${WT_DIR}/.tickets/STATUS" ] && grep -q "DONE" "${WT_DIR}/.tickets/STATUS" 2>/dev/null; then
        echo "[Worker ${WORKER_ID}] ✅ FreeBuff signaled DONE after ${ELAPSED}s!"
        return 0
      fi

      if ! docker exec "$CONTAINER" tmux has-session -t buff 2>/dev/null; then
        echo "[Worker ${WORKER_ID}] ⚠️  FreeBuff tmux exited early. Respawning in 6s..."
        PROMPT="Your previous FreeBuff session exited before signaling DONE. Run 'git status' and 'git diff' to inspect existing progress, finish remaining work, verify all tests pass, write .reviews/agent_notes.md, and run: echo DONE > .tickets/STATUS"
        sleep 6
        break
      fi

      SCREEN=$(docker exec "$CONTAINER" tmux capture-pane -t buff -p 2>/dev/null || true)

      if echo "$SCREEN" | grep -qiE "Starting your model session|waiting room|queued|position in queue"; then
        continue
      fi

      if echo "$SCREEN" | grep -qiE "session was released|Choose a model to start a new session|Enter: retry"; then
        MID_RUN_RELEASE_RETRIES=$(expr "$MID_RUN_RELEASE_RETRIES" + 1)
        if [ "$MID_RUN_RELEASE_RETRIES" -le 2 ]; then
          echo "[Worker ${WORKER_ID}] 🔄 Session was released mid-task; acquiring admission lock and sending Enter: retry (${MID_RUN_RELEASE_RETRIES}/2)..."
          (
            flock -x 201
            docker exec "$CONTAINER" tmux send-keys -t buff Enter
            sleep 4
            local S_RETRY
            S_RETRY=$(docker exec "$CONTAINER" tmux capture-pane -t buff -p 2>/dev/null || true)
            if echo "$S_RETRY" | grep -qiE "Choose a model|Enter: retry"; then
              docker exec "$CONTAINER" tmux send-keys -t buff Enter
              sleep 4
            fi
            local W_RETRY=0
            while [ "$W_RETRY" -lt 45 ]; do
              S_RETRY=$(docker exec "$CONTAINER" tmux capture-pane -t buff -p 2>/dev/null || true)
              if echo "$S_RETRY" | grep -qiE "Starting your model session|waiting room|queued"; then
                sleep 3
                W_RETRY=$(expr "$W_RETRY" + 3)
                continue
              fi
              break
            done
          ) 201>.reviews/admission.lock
          continue
        else
          echo "[Worker ${WORKER_ID}] 🔄 Session release banner persisted after in-place retries; restarting fresh FreeBuff session with continuation prompt..."
          docker exec "$CONTAINER" tmux kill-session -t buff 2>/dev/null || true
          PROMPT="Your previous FreeBuff session was released mid-task. Run 'git status' and 'git diff' to inspect existing progress, finish remaining work, verify all tests pass, write .reviews/agent_notes.md, and run: echo DONE > .tickets/STATUS"
          sleep 6
          break
        fi
      fi

      if echo "$SCREEN" | grep -qiE "admission_attempt_closed|session POST failed|This session start was cancelled|operation timed out|not authenticated|Failed to start agent run|AI_APICallError|Message not sent|Session ended|superseded|Log in to continue"; then
        echo "[Worker ${WORKER_ID}] 🔄 Session interrupted or timed out. Re-admitting cleanly in 6s..."
        docker exec "$CONTAINER" tmux kill-session -t buff 2>/dev/null || true
        PROMPT="Your previous FreeBuff session was interrupted. Run 'git status' and 'git diff' to inspect existing progress, finish remaining work, verify all tests pass, write .reviews/agent_notes.md, and run: echo DONE > .tickets/STATUS"
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

  docker exec "$CONTAINER" bash -c "pkill -9 -f 'sbt|java|vitest' 2>/dev/null || true" 2>/dev/null || true
  echo "[Worker ${WORKER_ID}] ✅ Local test gate PASSED (freed test runner RAM)!"
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
  local CONTAINER="freebuff_worker_${WORKER_ID}"

  echo "🔨 Implementing ${TICKET_NAME}" > "$STATUS_FILE"
  echo "[Worker ${WORKER_ID}] 🎬 Starting ${TICKET_NAME} on branch ${BRANCH_NAME}..."

  docker exec "$CONTAINER" tmux kill-session -t buff 2>/dev/null || true

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

  local WORK_PROMPT="Implement EVERY single requirement and checklist item in @.tickets/${TICKET_NAME}.md following all rules in @AGENTS.md and @SPEC.md (including end-to-end UI wiring, QA Scenario presets if specified, and keeping ./play-local.sh updated if startup changes; do NOT touch README.md or ARCHITECTURE.md). Do NOT skip or stub any bullet point. In .reviews/agent_notes.md, write a checklist confirming how each requirement in the ticket was implemented and wired into the live UI, verify all unit tests pass, and then run: echo DONE > .tickets/STATUS"
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
      local FIX_TESTS_PROMPT="🚨 AUTOMATED TEST GATE REJECTION: You marked @.tickets/${TICKET_NAME}.md as DONE, but the test suite FAILED. Read @.reviews/test_failure_report.md, fix the broken code/tests without removing any required ticket features, update .reviews/agent_notes.md, and run: echo DONE > .tickets/STATUS"
      run_worker_freebuff "$WORKER_ID" "$FIX_TESTS_PROMPT"
      continue
    fi

    (
      cd "$WT_DIR"
      rm -f .tickets/STATUS
      git checkout HEAD -- README.md ARCHITECTURE.md 2>/dev/null || true
      git add -A
      git reset -- .reviews/ .tickets/ README.md ARCHITECTURE.md 2>/dev/null || true
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
    local CHANGED_FILES_LIST="${WT_DIR}/.reviews/changed_files.txt"
    (
      cd "$WT_DIR"
      git diff --name-status main...HEAD -- . \
        ':(exclude)*package-lock.json' \
        ':(exclude)*yarn.lock' \
        ':(exclude)*pnpm-lock.yaml' \
        ':(exclude)*/target/*' \
        ':(exclude)*/node_modules/*' \
        ':(exclude).reviews/*' \
        ':(exclude).tickets/*' \
        ':(exclude)agent-orchestration/*' \
        ':(exclude)FEEDBACK*.md' > .reviews/changed_files.txt
      git diff main...HEAD -- . \
        ':(exclude)*package-lock.json' \
        ':(exclude)*yarn.lock' \
        ':(exclude)*pnpm-lock.yaml' \
        ':(exclude)*/target/*' \
        ':(exclude)*/node_modules/*' \
        ':(exclude).reviews/*' \
        ':(exclude).tickets/*' \
        ':(exclude)agent-orchestration/*' \
        ':(exclude)FEEDBACK*.md' | head -c 75000 > .reviews/current.diff
    )

    local NOTES_CONTENT="No implementer notes provided."
    [ -f "${WT_DIR}/.reviews/agent_notes.md" ] && NOTES_CONTENT=$(cat "${WT_DIR}/.reviews/agent_notes.md")

    local REVIEW_FILE=".reviews/${TICKET_NAME}-review-${ROUND}.md"
    local PROMPT_FILE="${WT_DIR}/.reviews/review_prompt.txt"

    cat << PROMPT_EOF > "$PROMPT_FILE"
You are a Principal Code Reviewer conducting strict PR Review Round ${ROUND} of ${MAX_REVIEW_ROUNDS} for ticket ${TICKET_NAME}.
CRITICAL INSTRUCTION: Do NOT use any tools, do NOT run bash commands, and do NOT read external files. The local unit test suite ('sbt test' / 'npm test') has ALREADY passed.

<ticket_specification>
$(cat "$TICKET_FILE")
</ticket_specification>

<implementer_notes_and_rebuttals>
${NOTES_CONTENT}
</implementer_notes_and_rebuttals>

<changed_files_summary>
$(cat "$CHANGED_FILES_LIST")
</changed_files_summary>

<git_diff>
$(cat "$DIFF_FILE")
</git_diff>

STRICT COMPLETENESS & WIRING REVIEW GUIDELINES:
1. **Mandatory Item-by-Item Audit:** You MUST begin your review with a "## Requirement Verification Checklist" section that lists EVERY single requirement, acceptance criterion, UI detail, QA preset, and sub-bullet from <ticket_specification>.
2. For each requirement, explicitly mark it as:
   - \`[IMPLEMENTED & WIRED]\` — and cite the exact file, function, and UI component render path in <git_diff> that implements AND displays it.
   - \`[MISSING]\`, \`[PARTIAL]\`, or \`[UNWIRED DEAD CODE]\` — if the requirement is absent, incomplete, or implemented in a helper/model without actually being wired into the active UI/server routes.
3. **Zero Tolerance for Partial Implementations:** Verify against <git_diff>, not <implementer_notes_and_rebuttals>. If ANY requirement in <ticket_specification> is marked \`[MISSING]\`, \`[PARTIAL]\`, or \`[UNWIRED DEAD CODE]\`, you MUST output \`VERDICT: CHANGES_REQUESTED\`.
4. Only output \`VERDICT: APPROVED\` when 100% of requirements in <ticket_specification> are verified \`[IMPLEMENTED & WIRED]\` in <git_diff>.

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
    local FIX_PROMPT="🚨 PR CODE REVIEW REJECTION (Round ${ROUND}): Read the reviewer's Requirement Verification Checklist in @.reviews/${TICKET_NAME}-review-${ROUND}.md and the ticket @.tickets/${TICKET_NAME}.md. Implement and wire every item marked [MISSING], [PARTIAL], or [UNWIRED DEAD CODE] and fix all bugs identified. Update .reviews/agent_notes.md, re-run tests until green, and run: echo DONE > .tickets/STATUS"
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
      local CONFLICT_PROMPT="🚨 GIT MERGE CONFLICT WITH MAIN: Another parallel worker merged changes to 'main' that conflict with your branch. Run 'git status' and 'git diff' to find all <<<<<<< HEAD conflict markers, resolve them cleanly so BOTH branches' features are preserved (never delete another ticket's feature when resolving a conflict!), run the test suite ('sbt -batch test' and 'npm test -- --run') until 100% green, and run: echo DONE > .tickets/STATUS"
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

  docker exec "$CONTAINER" tmux kill-session -t buff 2>/dev/null || true

  echo "💤 Idle (Last completed: ${TICKET_NAME})" > "$STATUS_FILE"
  return 0
}

extract_tickets_with_waves() {
  local RAW_FILE=$1
  sed '/===END_OF_TICKETS===/d; /===NO_TICKETS_NEEDED===/d; /===AUDIT_PASSED===/d' "$RAW_FILE" | awk '
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
  echo "🏗️  Phase 1: Decomposing SPEC.md (${ACTIVE_M}) with Requirement Traceability..."
  echo "=================================================================="

  cat << PROMPT_EOF > .reviews/phase1_prompt.txt
You are a Principal Systems Architect. DO NOT use any internal tools, DO NOT run bash commands, and DO NOT read external files.

Break the CURRENT ACTIVE MILESTONE (${ACTIVE_M}) in <spec> down into atomic implementation tickets grouped into PARALLEL EXECUTION WAVES (WAVE:1, WAVE:2, etc.).

CRITICAL COMPLETENESS, TESTABILITY & TRACEABILITY RULES:
1. First, output a \`===TRACEABILITY_MATRIX===\` block listing EVERY single requirement and sub-feature of ${ACTIVE_M} as \`REQ-01\`, \`REQ-02\`, ... and mapping each \`REQ-XX\` to the exact ticket filename that will implement it. ZERO requirements may be omitted.
2. Inside each ticket, include a \`## Mandatory Acceptance Criteria Checklist\` containing the exact, unabridged technical details for every \`REQ-XX\` assigned to that ticket.
3. Include QA Scenario Presets (e.g., Lobby or Left Sidebar quick-state loaders) for any complex or late-game features so the human can test them in 1 click.
4. Put tickets that touch independent files/subsystems into the SAME wave, and put tickets that edit the exact same files into sequential waves.
5. Do NOT create tickets to update ./README.md or ./ARCHITECTURE.md (the Orchestrator updates documentation automatically after all waves and audits pass). Only update ./play-local.sh if server startup commands change.

<spec>
$(cat SPEC.md)
</spec>

<agents>
$(cat AGENTS.md)
</agents>

Output your traceability matrix first, followed by each ticket using this EXACT delimiter format on its own line (including |WAVE:N), and end your entire response with ===END_OF_TICKETS===:
===TRACEABILITY_MATRIX===
- REQ-01: [Description] -> T-01-example.md
===TICKET:T-01-example.md|WAVE:1===
[Full Markdown content of ticket 1 including ## Mandatory Acceptance Criteria Checklist]
===END_OF_TICKETS===
PROMPT_EOF

  run_agy_pool "ARCHITECT" ".reviews/phase1_prompt.txt" ".reviews/raw_tickets.txt" "===TICKET:"
  extract_tickets_with_waves ".reviews/raw_tickets.txt"

  git checkout main 2>/dev/null || true
  git add .tickets/ 2>/dev/null || true
  agent_git commit -m "chore(tickets): generate wave tickets for ${ACTIVE_M}" >/dev/null 2>&1 || true
  [ "$USE_GITHUB_PRS" -eq 1 ] && (retry_git_push origin main >/dev/null 2>&1 || true)
}

# === PHASE 1.5: HUMAN FEEDBACK AMBIGUITY TRIAGE + TRACEABLE WAVE GENERATION ===
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

  # If FEEDBACK.md ONLY contains unanswered deferred items from the last triage (where [YOUR DECISION]: is still blank), do not auto-trigger until edited
  if grep -q "# Deferred Items from Previous Round" FEEDBACK.md 2>/dev/null; then
    local NON_EMPTY_DECISIONS
    NON_EMPTY_DECISIONS=$(grep -E "\[YOUR DECISION\]:[[:space:]]*[^[:space:]]+" FEEDBACK.md 2>/dev/null || true)
    local OTHER_LINES
    OTHER_LINES=$(sed '/<!--.*-->/d; /^# Deferred Items/d; /^[0-9]\+\./d; /\[ORCHESTRATOR QUESTION/d; /\[SUGGESTED OPTIONS/d; /\[YOUR DECISION\]:/d' FEEDBACK.md | tr -d '[:space:]')
    if [ -z "$NON_EMPTY_DECISIONS" ] && [ -z "$OTHER_LINES" ]; then
      return 0
    fi
  fi

  local TIMESTAMP
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
  git rev-parse HEAD > .reviews/feedback_base_commit
  echo "0" > .reviews/feedback_audit_passes
  echo "0" > .reviews/visual_qa_passes

  # Preserve the PREVIOUS round's feedback before overwriting FEEDBACK.backup.md!
  if [ -f FEEDBACK.backup.md ]; then
    cp FEEDBACK.backup.md .reviews/previous_round_feedback.md
  else
    echo "No previous feedback round recorded." > .reviews/previous_round_feedback.md
  fi
  if [ -f .reviews/QA_PLAYBOOK.md ]; then
    cp .reviews/QA_PLAYBOOK.md .reviews/previous_round_qa_playbook.md
  else
    echo "No previous QA_PLAYBOOK.md recorded." > .reviews/previous_round_qa_playbook.md
  fi

  cp FEEDBACK.md FEEDBACK.backup.md
  cp FEEDBACK.md ".reviews/feedback_archive/FEEDBACK_${TIMESTAMP}.md"
  cp FEEDBACK.md FEEDBACK.in_progress.md
  rm -f .reviews/deferred_feedback_items.md .reviews/ambiguity_questions_raw.txt

  # --- STAGE 1.5A: PRE-FLIGHT AMBIGUITY DETECTION & INTERACTIVE HUMAN Q&A ---
  echo "=================================================================="
  echo "🔎 Stage 1.5A: Scanning FEEDBACK.md for potential ambiguities..."
  echo "=================================================================="

  cat << PROMPT_EOF > .reviews/ambiguity_check_prompt.txt
You are a Principal Product & Systems Architect reviewing the human's numbered feature/bug list in <human_feedback>.
CRITICAL: DO NOT use any tools, DO NOT run bash commands, and DO NOT read external files.

Carefully inspect each numbered item in <human_feedback> against <current_codebase>.
- If an item is clear, or only requires standard engineering judgment (including building a QA Scenario Preset to test it), do NOT ask a question about it.
- ONLY ask a question if a numbered item is genuinely ambiguous, contradicts an existing rule, or has 2+ distinct gameplay/UI interpretations where guessing wrong would frustrate the user.

<previous_round_human_feedback>
$(cat .reviews/previous_round_feedback.md 2>/dev/null || echo "None")
</previous_round_human_feedback>

<previous_round_qa_playbook>
$(cat .reviews/previous_round_qa_playbook.md 2>/dev/null || echo "None")
</previous_round_qa_playbook>

<human_feedback>
$(cat FEEDBACK.md)
</human_feedback>

<current_codebase>
$(dump_full_codebase_context)
</current_codebase>

If NO items are genuinely ambiguous, output ONLY:
===NO_QUESTIONS===

If 1 or more items have genuine ambiguities, output each question using this EXACT format and end with ===END_OF_QUESTIONS===:
===QUESTION:Q1|ITEM:1===
ORIGINAL_REQUEST: [Exact quote of the numbered item from FEEDBACK.md]
AMBIGUITY: [Concise 1-2 sentence explanation of what is ambiguous]
OPTIONS: [Option A vs. Option B, or what needs to be decided]
===END_OF_QUESTIONS===
PROMPT_EOF

  run_agy_pool "ARCHITECT" ".reviews/ambiguity_check_prompt.txt" ".reviews/ambiguity_questions_raw.txt" "===NO_QUESTIONS===|===QUESTION:"

  python3 "$PROJECT_ROOT/agent-orchestration/qa-assistant.py"

  # Check if all items were deferred during interactive triage
  for old_fb in .tickets/T-9*-feedback-*.md .tickets/T-95-audit-gap-*.md; do
    [ -e "$old_fb" ] || continue
    local bname
    bname=$(basename "$old_fb" .md)
    [ ! -f ".tickets/.completed_${bname}" ] && rm -f "$old_fb"
  done

  echo "=================================================================="
  echo "🗣️  Stage 1.5B: Generating Parallel Waves + Implicit QA Scenario Presets..."
  echo "=================================================================="

  cat << PROMPT_EOF > .reviews/feedback_prompt.txt
You are a Principal Systems Architect. DO NOT use any internal tools, DO NOT run bash commands, and DO NOT read external files.

Decompose ALL non-deferred requirements in <resolved_human_feedback> into atomic implementation tickets grouped into PARALLEL EXECUTION WAVES (WAVE:1, WAVE:2, WAVE:3).

CRITICAL ANTI-OMISSION, TESTABILITY & TRACEABILITY RULES:
1. **Step 1 — Requirement Traceability Matrix (\`===TRACEABILITY_MATRIX===\`):** List EVERY discrete numbered item and sub-point from <resolved_human_feedback> (excluding any section marked DEFERRED ITEMS) as \`ITEM-1a\`, \`ITEM-1b\`, \`ITEM-2\`, ... and map each one to the exact \`T-90-feedback-${TIMESTAMP}-...\` ticket filename that implements it. ZERO non-deferred items may be omitted!
2. **Step 2 — Implicit Testability & QA Scenario Presets (MANDATORY):**
   For each numbered item in <resolved_human_feedback>, ask: *"Can the human user observe and test this change in under 15 seconds after opening http://localhost:5173?"*
   - If the item involves a hard-to-reach or late-game state (e.g., endgame when talon deck is empty and players have 1–2 cards left, Durak elimination in 3P/4P, forced surrender edge cases, reflection chains, or timeout behaviors), you MUST include an explicit requirement in the backend/frontend tickets to add or update a **1-Click QA Scenario Preset** (e.g., a "⚡ QA Scenarios" selector in the Lobby or Left Sidebar that creates/loads a match pre-populated in that exact state) so the human can test it immediately!
3. **Step 3 — Verbatim Acceptance Checklists & End-to-End Wiring:**
   Inside every ticket, include a \`## Mandatory Acceptance Criteria Checklist\` copying the FULL, UNABRIDGED details of each item assigned to that ticket, and explicitly specify the exact frontend component (\`GamePage.tsx\`, \`GameTable.tsx\`, \`LobbyPage.tsx\`) and backend route/engine method where it must be wired into the live UI.
4. **Wave Scheduling & Real-Time Docs:**
   - Assign independent subsystems to the SAME wave, and tickets touching the same files to sequential waves.
   - Ensure the final wave updates \`./README.md\`, \`./ARCHITECTURE.md\`, and \`./play-local.sh\` (in a single ticket).

<agents_rules>
$(cat AGENTS.md)
</agents_rules>

<previous_round_human_feedback>
$(cat .reviews/previous_round_feedback.md 2>/dev/null || echo "None")
</previous_round_human_feedback>

<previous_round_qa_playbook>
$(cat .reviews/previous_round_qa_playbook.md 2>/dev/null || echo "None")
</previous_round_qa_playbook>

<resolved_human_feedback>
(Note: If the human references an "Item #X" or playbook step from the previous round without redefining it, resolve the reference using <previous_round_human_feedback> and <previous_round_qa_playbook> above!)
$(cat .reviews/active_feedback_resolved.md)
</resolved_human_feedback>

<existing_project_files>
$(find backend/src frontend/src play-local.sh README.md ARCHITECTURE.md -type f 2>/dev/null | sort)
</existing_project_files>

<current_code_context>
$(dump_full_codebase_context)
</current_code_context>

Output your ===TRACEABILITY_MATRIX=== first, followed by each ticket using this EXACT delimiter format on its own line (including |WAVE:N), and end your entire response with ===END_OF_TICKETS===:
===TRACEABILITY_MATRIX===
- ITEM-1: [Exact requirement] -> T-90-feedback-${TIMESTAMP}-1-backend.md
===TICKET:T-90-feedback-${TIMESTAMP}-1-backend.md|WAVE:1===
[Full Markdown content of ticket 1 including ## Mandatory Acceptance Criteria Checklist]
===END_OF_TICKETS===
PROMPT_EOF

  run_agy_pool "ARCHITECT" ".reviews/feedback_prompt.txt" ".reviews/raw_feedback_tickets.txt" "===TICKET:|===NO_TICKETS_NEEDED==="
  extract_tickets_with_waves ".reviews/raw_feedback_tickets.txt"

  # Restore FEEDBACK.md: either write back any deferred items (with questions) or reset to clean template
  if [ -f .reviews/deferred_feedback_items.md ]; then
    cp .reviews/deferred_feedback_items.md FEEDBACK.md
    echo "📌 Wrote deferred items (with orchestrator questions) back to FEEDBACK.md for future review!"
  else
    cat << 'RESET_EOF' > FEEDBACK.md
<!-- Write your plain-English UI/UX feedback, bugs, or usability requests below this line. -->
<!-- Note: Your previous feedback is always backed up in FEEDBACK.backup.md and .reviews/feedback_archive/ -->

RESET_EOF
  fi

  git checkout main 2>/dev/null || true
  git add .tickets/ FEEDBACK.md FEEDBACK.backup.md 2>/dev/null || true
  agent_git commit -m "chore(tickets): add feedback wave tickets ${TIMESTAMP}" >/dev/null 2>&1 || true
  [ "$USE_GITHUB_PRS" -eq 1 ] && (retry_git_push origin main >/dev/null 2>&1 || true)
}

# === LAYER 3: FULL-FILE HOLISTIC SPEC AUDIT & INTERACTIVE QA PLAYBOOK GENERATOR ===
run_holistic_feedback_audit() {
  if [ ! -f .reviews/feedback_base_commit ] || [ ! -f .reviews/active_feedback_resolved.md ]; then
    return 0
  fi

  local PASS_COUNT
  PASS_COUNT=$(cat .reviews/feedback_audit_passes 2>/dev/null || echo "0")
  if [ "$PASS_COUNT" -ge "$MAX_HOLISTIC_AUDIT_PASSES" ]; then
    echo "ℹ️  Reached max holistic audit passes (${MAX_HOLISTIC_AUDIT_PASSES}); generating QA Playbook."
    generate_qa_playbook
    rm -f .reviews/feedback_base_commit .reviews/feedback_audit_passes
    return 0
  fi

  PASS_COUNT=$(expr "$PASS_COUNT" + 1)
  echo "$PASS_COUNT" > .reviews/feedback_audit_passes

  local BASE_COMMIT
  BASE_COMMIT=$(cat .reviews/feedback_base_commit 2>/dev/null || git rev-parse HEAD~1)
  local TIMESTAMP
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)

  echo "=================================================================="
  echo "🕵️  Holistic Spec Audit (Pass ${PASS_COUNT}/${MAX_HOLISTIC_AUDIT_PASSES}): Verifying full codebase against FEEDBACK.md..."
  echo "=================================================================="

  git diff "${BASE_COMMIT}...HEAD" -- . \
    ':(exclude)*package-lock.json' \
    ':(exclude)*/target/*' \
    ':(exclude)*/node_modules/*' \
    ':(exclude).reviews/*' \
    ':(exclude).tickets/*' \
    ':(exclude)agent-orchestration/*' \
    ':(exclude)FEEDBACK*.md' | head -c 35000 > .reviews/holistic_cumulative.diff

  cat << PROMPT_EOF > .reviews/holistic_audit_prompt.txt
You are a Principal QA & Systems Auditor conducting a final pre-release audit on the integrated 'main' branch.
CRITICAL: DO NOT use any tools, DO NOT run bash commands, and DO NOT read external files.

Compare EVERY single non-deferred numbered item, sub-bullet, UI detail, and QA Scenario Preset in <resolved_human_feedback> against <cumulative_git_diff_on_main> and the FULL source files in <current_main_source_files>.

<previous_round_human_feedback>
$(cat .reviews/previous_round_feedback.md 2>/dev/null || echo "None")
</previous_round_human_feedback>

<previous_round_qa_playbook>
$(cat .reviews/previous_round_qa_playbook.md 2>/dev/null || echo "None")
</previous_round_qa_playbook>

<resolved_human_feedback>
(Note: If the human references an "Item #X" or playbook step from the previous round without redefining it, resolve the reference using <previous_round_human_feedback> and <previous_round_qa_playbook> above!)
$(cat .reviews/active_feedback_resolved.md)
</resolved_human_feedback>

<cumulative_git_diff_on_main>
$(cat .reviews/holistic_cumulative.diff)
</cumulative_git_diff_on_main>

<current_main_source_files>
$(dump_full_codebase_context)
</current_main_source_files>

AUDIT INSTRUCTIONS:
1. Output an \`===AUDIT_CHECKLIST===\` checking every numbered item and sub-point in <resolved_human_feedback> (ignoring items under DEFERRED ITEMS):
   - Mark it \`[VERIFIED LIVE IN UI]\` ONLY if it is both implemented in the engine/logic AND actively rendered/wired in the frontend pages (\`LobbyPage.tsx\`, \`GamePage.tsx\`, \`GameTable.tsx\`, \`table.css\`).
   - Mark it \`[MISSING / UNWIRED]\` if any part of the item was skipped, overwritten during a merge, or left unwired in the UI.
2. If 100% of non-deferred items are \`[VERIFIED LIVE IN UI]\`, end your response with \`===AUDIT_PASSED===\`.
3. If ANY non-deferred item is \`[MISSING / UNWIRED]\`, output 1 to 3 atomic remediation tickets using this EXACT format and end with \`===END_OF_TICKETS===\`:
===TICKET:T-95-audit-gap-${TIMESTAMP}-1.md|WAVE:1===
[Full Markdown ticket specifying the exact missing requirements/wiring to implement, files to touch, and unit tests to run]
===END_OF_TICKETS===
PROMPT_EOF

  run_agy_pool "ARCHITECT" ".reviews/holistic_audit_prompt.txt" ".reviews/holistic_audit_out.txt" "===AUDIT_PASSED===|===TICKET:"

  if grep -q "===TICKET:" .reviews/holistic_audit_out.txt 2>/dev/null; then
    echo "⚠️  Holistic Audit detected missing or unwired items from FEEDBACK.md! Generating remediation wave..."
    extract_tickets_with_waves ".reviews/holistic_audit_out.txt"
    git checkout main 2>/dev/null || true
    git add .tickets/ 2>/dev/null || true
    agent_git commit -m "chore(audit): add remediation tickets for missing feedback items ${TIMESTAMP}" >/dev/null 2>&1 || true
    [ "$USE_GITHUB_PRS" -eq 1 ] && (retry_git_push origin main >/dev/null 2>&1 || true)
    return 1
  fi

  echo "✅ Holistic Spec Audit PASSED! 100% of non-deferred FEEDBACK.md items verified live on main."
  if ! run_visual_ui_qa_gate; then
    return 1
  fi
  update_docs_by_orchestrator
  generate_qa_playbook
  rm -f .reviews/feedback_base_commit .reviews/feedback_audit_passes
  return 0
}

# === GENERATE NUMBERED HUMAN QA PLAYBOOK (HOW TO SEE EVERY CHANGE IN <15 SECONDS) ===

# === STAGE 3.5: AUTOMATED HEADLESS BROWSER VISUAL & INTERACTIVE QA GATE ===
run_visual_ui_qa_gate() {
  local SOURCE_SPEC=".reviews/active_feedback_resolved.md"
  [ ! -f "$SOURCE_SPEC" ] && SOURCE_SPEC="FEEDBACK.backup.md"
  [ ! -f "$SOURCE_SPEC" ] && return 0

  local V_PASS
  V_PASS=$(cat .reviews/visual_qa_passes 2>/dev/null || echo "0")
  if [ "$V_PASS" -ge 2 ]; then
    echo "ℹ️  Reached max visual QA remediation passes (2); proceeding to human review."
    rm -f .reviews/visual_qa_passes
    return 0
  fi
  V_PASS=$(expr "$V_PASS" + 1)
  echo "$V_PASS" > .reviews/visual_qa_passes

  local TIMESTAMP
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)

  echo "=================================================================="
  echo "👁️  Stage 3.5A (Pass ${V_PASS}/2): Generating Playwright Interactive Walkthrough..."
  echo "=================================================================="

  cat << PROMPT_EOF > .reviews/gen_playwright_steps_prompt.txt
You are a Senior Frontend QA Automation Engineer. DO NOT use tools or run bash commands.
Write an ES module exporting \`export async function runCustomSteps(page, captureStep)\` that tests each numbered item in <implemented_feedback> on \`http://localhost:5173\` using Playwright.
- Call \`await captureStep('item_1_description', 2)\`, \`await captureStep('item_2_description', 3)\`, etc., after triggering each UI state (e.g., clicking presets, opening dropdowns, dragging sliders, hovering/clicking cards) so the geometry scanner and screenshotter inspect that exact visual state.
- Use defensive locators (\`if (await loc.count() > 0) await loc.first().click({ timeout: 3000 }).catch(() => {})\`) so one missing selector never aborts the whole script.

<implemented_feedback>
$(cat "$SOURCE_SPEC")
</implemented_feedback>

<frontend_components>
$(head -n 180 frontend/src/app.tsx frontend/src/pages/*.tsx frontend/src/components/*.tsx frontend/src/styles/*.css 2>/dev/null | head -c 45000)
</frontend_components>

Output ONLY valid JavaScript ES module code (no markdown fences) and end with \`// ===END_OF_FILES===\`:
export async function runCustomSteps(page, captureStep) {
  // steps here
}
// ===END_OF_FILES===
PROMPT_EOF

  try_agy_call "gemini-3.8-flash-high" ".reviews/gen_playwright_steps_prompt.txt" ".reviews/custom_qa_steps.raw.mjs" "runCustomSteps" "// ===END_OF_FILES===" || true
  sed '/^```/d; /===END_OF_FILES===/d' .reviews/custom_qa_steps.raw.mjs > .reviews/custom_qa_steps.mjs 2>/dev/null || true

  # Run Headless Chromium inside freebuff_worker
  ./agent-orchestration/run-visual-qa.sh

  echo "=================================================================="
  echo "👁️  Stage 3.5B: Auditing Real Browser Geometry, Borders & Screenshots..."
  echo "=================================================================="

  cat << PROMPT_EOF > .reviews/visual_audit_prompt.txt
You are a Principal UI/UX & Visual QA Auditor. DO NOT use bash commands to modify files.
Inspect the real Chromium browser telemetry report in <browser_visual_telemetry> (which includes computed bounding boxes, border-radius/box-shadow conformity checks, row alignment checks, overlap checks, and console/page errors) against <implemented_feedback> and <frontend_styles_and_components>.
(If your environment supports reading image files, you may also inspect the screenshots listed in <browser_visual_telemetry> under \`.reviews/screenshots/\`.)

<implemented_feedback>
$(cat "$SOURCE_SPEC")
</implemented_feedback>

<browser_visual_telemetry>
$(head -c 45000 .reviews/visual_qa_telemetry.json 2>/dev/null || echo "No telemetry JSON generated.")
</browser_visual_telemetry>

<frontend_styles_and_components>
$(head -n 160 frontend/src/styles/*.css frontend/src/pages/*.tsx frontend/src/components/*.tsx 2>/dev/null | head -c 40000)
</frontend_styles_and_components>

VISUAL AUDIT RULES:
1. **Objective UI / Layout / Interaction Bugs:**
   Check for:
   - Highlight borders or glows (\`box-shadow\`, \`border\`, \`outline\`) that do NOT conform to the shape/radius/size of the inner card, seat box, or button (e.g., \`HIGHLIGHT_SIZE_MISMATCH\`, \`HIGHLIGHT_RADIUS_MISMATCH\`, or inline SVG descender gaps).
   - Misaligned elements in rows/columns (\`ROW_VERTICAL_MISALIGNMENT\`), unintended element overlaps (\`ELEMENT_OVERLAP\`), or clipped text (\`TEXT_CLIPPED_HORIZONTALLY\`).
   - Console/runtime errors or interactions from <implemented_feedback> that failed to render on screen.
2. **Subjective Design Questions:**
   If the implementation works and has clean geometry, but involves a subjective aesthetic choice for the human product owner, record it under \`===SUBJECTIVE_DESIGN_NOTES===\`.
3. **Verdict Output:**
   - If ZERO objective visual or interaction bugs exist, output any optional \`===SUBJECTIVE_DESIGN_NOTES===\` and end with \`===VISUAL_QA_PASSED===\`.
   - If 1 or more objective visual/interaction bugs exist, output 1 to 2 remediation tickets using this EXACT format and end with \`===END_OF_TICKETS===\`:
===TICKET:T-96-visual-qa-${TIMESTAMP}-1.md|WAVE:1===
[Full Markdown ticket specifying the exact CSS/DOM alignment, border conformity, or interaction fix required, exact file paths, and tests]
===END_OF_TICKETS===
PROMPT_EOF

  run_agy_pool "REVIEWER_R1" ".reviews/visual_audit_prompt.txt" ".reviews/visual_audit_out.txt" "===VISUAL_QA_PASSED===|===TICKET:"

  if grep -q "===TICKET:" .reviews/visual_audit_out.txt 2>/dev/null; then
    echo "⚠️  Visual QA Gate caught objective UI/layout/border issues in the live browser! Dispatching remediation wave..."
    extract_tickets_with_waves ".reviews/visual_audit_out.txt"
    git checkout main 2>/dev/null || true
    git add .tickets/ 2>/dev/null || true
    agent_git commit -m "chore(visual-qa): add remediation tickets for live browser UI issues ${TIMESTAMP}" >/dev/null 2>&1 || true
    [ "$USE_GITHUB_PRS" -eq 1 ] && (retry_git_push origin main >/dev/null 2>&1 || true)
    return 1
  fi

  echo "✅ Headless Browser Visual & Interactive QA PASSED!"
  rm -f .reviews/visual_qa_passes
  return 0
}


# === STAGE 3.6: ORCHESTRATOR-ONLY PUBLIC DOCUMENTATION UPDATER ===
update_docs_by_orchestrator() {
  echo "=================================================================="
  echo "📝 Stage 3.6: Orchestrator updating public README.md & ARCHITECTURE.md..."
  echo "=================================================================="

  local USER_SECTION=""
  if [ -f README.md ]; then
    USER_SECTION=$(sed -n '/<!-- USER_SECTION_START -->/,/<!-- USER_SECTION_END -->/p' README.md 2>/dev/null || true)
  fi
  if [ -z "$USER_SECTION" ]; then
    USER_SECTION="<!-- USER_SECTION_START -->\n# Lidurak\n\nWrite your protected human-authored introduction here. The AI will never modify text between these tags.\n<!-- USER_SECTION_END -->"
  fi
  echo -e "$USER_SECTION" > .reviews/readme_user_section.txt

  cat << PROMPT_EOF > .reviews/orchestrator_docs_prompt.txt
You are the Principal Release Architect for Lidurak. DO NOT use tools or run bash commands.
All implementation waves, holistic audits, and visual QA checks have passed. Now update the public-facing \`README.md\` and technical \`ARCHITECTURE.md\` to accurately reflect the current application state in <current_codebase>.

STRICT PUBLIC DOCUMENTATION RULES:
1. \`README.md\` is the high-level front page for human players and developers:
   - DO NOT write microscopic, granular technical details (e.g., exact ping millisecond thresholds, SVG hover states, exact CSS animations, or chevron dropdown behaviors). Keep it concise, high-level, and easy to read.
   - Include ONLY: Prerequisites, how to launch via \`./play-local.sh\`, how to run tests, and a BASIC overview of the UI and gameplay.
   - NEVER mention internal tickets (\`T-01\`, \`T-90\`, etc.), execution waves, FreeBuff, Antigravity, \`FEEDBACK.md\`, QA Playbooks, or agent orchestration.
   - CRITICAL: The human's protected introduction is handled externally. DO NOT output a main title or introduction. Start your \`README.md\` output directly with \`## 1. Quick Start & Installation\`.
2. \`ARCHITECTURE.md\` is the clean technical engineering reference for the repository:
   - Document the directory tree, Scala 3 engine state machine (\`durak.engine\`), server actors & WebSocket/REST protocol (\`durak.server\`), and Preact/CSS Grid frontend architecture (\`frontend/src\`).
   - Keep it 100% free of internal ticket IDs or agent workflow notes.

<current_codebase>
$(dump_full_codebase_context)
</current_codebase>

Output both complete files using this EXACT delimiter format (with NO markdown code fences wrapping the whole file) and end with \`===END_OF_FILES===\`:
===FILE:README.md===
[Full clean Markdown content of README.md starting at ## 1. Quick Start]
===FILE:ARCHITECTURE.md===
[Full clean Markdown content of ARCHITECTURE.md]
===END_OF_FILES===
PROMPT_EOF

  if run_agy_pool "ARCHITECT" ".reviews/orchestrator_docs_prompt.txt" ".reviews/orchestrator_docs_out.txt" "===FILE:README.md==="; then
    awk '
      /^===FILE:.*===$/ {
        line=$0;
        gsub(/^===FILE:/, "", line);
        gsub(/===$/, "", line);
        gsub(/[ \t\r]/, "", line);
        out=line;
        if (out == "README.md") { out=".reviews/README_generated.md" }
        printf "" > out;
        next
      }
      /^===END_OF_FILES===/ { out=""; next }
      out != "" { print >> out }
    ' .reviews/orchestrator_docs_out.txt

    cat .reviews/readme_user_section.txt > README.md
    echo "" >> README.md
    cat .reviews/README_generated.md >> README.md

    git checkout main 2>/dev/null || true
    git add README.md ARCHITECTURE.md 2>/dev/null || true
    if ! git diff --cached --quiet; then
      agent_git commit -m "docs(release): update clean public README.md (preserving user header) and ARCHITECTURE.md" >/dev/null 2>&1 || true
      [ "$USE_GITHUB_PRS" -eq 1 ] && (retry_git_push origin main >/dev/null 2>&1 || true)
      echo "✅ Orchestrator updated and pushed clean README.md and ARCHITECTURE.md!"
    else
      echo "ℹ️  README.md and ARCHITECTURE.md are already up to date."
    fi
  fi
}
generate_qa_playbook() {
  local SOURCE_SPEC=".reviews/active_feedback_resolved.md"
  [ ! -f "$SOURCE_SPEC" ] && SOURCE_SPEC="FEEDBACK.backup.md"
  [ ! -f "$SOURCE_SPEC" ] && return 0

  echo "=================================================================="
  echo "📋 Generating Step-by-Step Human QA Playbook (.reviews/QA_PLAYBOOK.md)..."
  echo "=================================================================="

  cat << PROMPT_EOF > .reviews/qa_playbook_prompt.txt
You are the Lead QA Engineer preparing a concise, step-by-step verification guide for the Human Product Owner.
CRITICAL: DO NOT use any tools, DO NOT run bash commands, and DO NOT read external files.

For EVERY numbered item in <implemented_feedback>, write a clear entry showing the human **exact, concrete instructions on how to see and test that specific change in the browser** after running \`./play-local.sh\` (at \`http://localhost:5173\`).
- Reference the exact buttons, Lobby options, QA Scenario Presets, player switcher tabs, or visual elements in <current_codebase>.
- If any items were deferred or if you spotted any subtle follow-up questions during implementation, list them at the bottom under \`## Optional Follow-Up Questions / Deferred Items\`.

<implemented_feedback>
$(cat "$SOURCE_SPEC")
</implemented_feedback>

<current_codebase>
$(dump_full_codebase_context)
</current_codebase>

Format your response in clean Markdown (with NO preamble) and end with \`===END_OF_FILES===\`:
# 🧪 Interactive QA Playbook — How to Verify Recent Changes
1. **Start the server:** Run \`./play-local.sh\` in Window 4 and open \`http://localhost:5173\`.

## Item-by-Item Verification Steps
### Item #1: [Short Title from Feedback]
- **What Changed:** [1-sentence summary]
- **How to See It Immediately:**
  1. [Exact step 1 — e.g., click QA Preset X or select 3 players + Chaos Mode]
  2. [Exact step 2 — what to click/drag and what visual/audio result to observe]
===END_OF_FILES===
PROMPT_EOF

  run_agy_pool "REVIEWER_R1" ".reviews/qa_playbook_prompt.txt" ".reviews/QA_PLAYBOOK.raw.md" "===END_OF_FILES==="
  rm -f QA_PLAYBOOK.md
  python3 "$PROJECT_ROOT/agent-orchestration/qa-assistant.py" --render-playbook >/dev/null 2>&1 || sed '/===END_OF_FILES===/d' .reviews/QA_PLAYBOOK.raw.md > .reviews/QA_PLAYBOOK.md
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
  rm -f .reviews/raw_tickets.txt .tickets/STATUS .reviews/feedback_base_commit .reviews/feedback_audit_passes

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
      echo "🌊 EXECUTING WAVE ${WAVE_NUM} (3-Pool Router + Strict Checklist Review)"
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

  # Layer 3 Enforcement: Run Full-File Holistic Audit & generate QA_PLAYBOOK.md before pausing for human review!
  if ! run_holistic_feedback_audit; then
    continue
  fi

  rm -f FEEDBACK.in_progress.md

  ACTIVE_M=$(grep -oE "CURRENT ACTIVE MILESTONE: M[0-9]+" SPEC.md 2>/dev/null | head -n 1 | awk '{print $NF}' || echo "M1")
  PLAYBOOK_PREVIEW=""
  if [ -f .reviews/QA_PLAYBOOK.md ]; then
    PLAYBOOK_PREVIEW=$(head -n 45 .reviews/QA_PLAYBOOK.md)
  fi
  send_alert "Ready for Human Review (${ACTIVE_M}) — QA Playbook Ready" "All current waves and the Holistic Spec Audit for ${ACTIVE_M} have passed. See QA_PLAYBOOK.md (or Window 1) for step-by-step instructions to view each numbered change:

${PLAYBOOK_PREVIEW}"

  echo "=================================================================="
  echo "🏆 ALL WAVES & HOLISTIC SPEC AUDIT COMPLETED, MERGED & SYNCED!"
  echo "=================================================================="
  if [ -f .reviews/QA_PLAYBOOK.raw.md ] || [ -f .reviews/QA_PLAYBOOK.md ]; then
    python3 "$PROJECT_ROOT/agent-orchestration/qa-assistant.py" --show-playbook
  fi
  echo "👉 Next Actions:"
  echo "   1. Run './play-local.sh' in Window 4 and follow the QA Playbook above at http://localhost:5173"
  echo "   2. Type 'show' and press [ENTER] to re-print the QA Playbook to the terminal at any time"
  echo "   3. To request further tweaks (or answer any deferred items), edit 'FEEDBACK.md' and press [ENTER]"
  echo "   4. To sign off on this milestone and auto-start the next milestone, type 'accept'"
  echo "------------------------------------------------------------------"
  while true; do
    read -r -p "Press [ENTER] after saving FEEDBACK.md, type 'show' to re-print playbook, or type 'accept': " USER_CHOICE
    if [ "$USER_CHOICE" = "show" ] || [ "$USER_CHOICE" = "playbook" ]; then
      python3 "$PROJECT_ROOT/agent-orchestration/qa-assistant.py" --show-playbook
      continue
    fi
    break
  done

  reset_alert_latch

  if [ "$USER_CHOICE" = "accept" ] || [ "$USER_CHOICE" = "approve" ]; then
    if ! advance_to_next_milestone; then
      break
    fi
  fi
done