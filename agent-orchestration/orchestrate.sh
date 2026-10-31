#!/usr/bin/env bash
set -u
cd ~/agent-project

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

cleanup_on_interrupt() {
  echo ""
  echo "🛑 Interrupted by user (Ctrl+C). Terminating active worker jobs safely..."
  pkill -9 -P $$ 2>/dev/null || true
  rm -f .reviews/worker_*.pid .reviews/worker_*.ticket
  if [ -f FEEDBACK.in_progress.md ]; then
    cp FEEDBACK.in_progress.md FEEDBACK.md
    rm -f FEEDBACK.in_progress.md
    echo "♻️  Restored in-progress feedback back to FEEDBACK.md."
  fi
  exit 130
}
trap cleanup_on_interrupt INT TERM

./agent-orchestration/start-workspace.sh "$INITIAL_WORKERS"

PRIMARY_ARCHITECT_MODEL="claude-opus-4-6-thinking"
PRIMARY_REVIEWER_MODEL="claude-sonnet-4-6"
FALLBACK_MODEL="gemini-3.8-flash-high"

AGY_TIMEOUT_SEC=600
SESSION_TIMEOUT_SEC=3300
POLL_INTERVAL_SEC=10
MAX_REVIEW_ROUNDS=4

USE_GITHUB_PRS=0
if git remote get-url origin >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  USE_GITHUB_PRS=1
  echo "🌐 GitHub Integration : ENABLED ($(git remote get-url origin))"
else
  echo "⚠️  GitHub Integration : LOCAL-ONLY"
fi

echo "=================================================================="
echo "⚙️  Dynamic Workers    : ${INITIAL_WORKERS} (Scale live: ./agent-orchestration/scale-workers.sh <N>)"
echo "⚙️  Architect Routing  : ${PRIMARY_ARCHITECT_MODEL} -> Fallback: ${FALLBACK_MODEL}"
echo "⚙️  Reviewer Routing   : ${PRIMARY_REVIEWER_MODEL} -> Fallback: ${FALLBACK_MODEL}"
echo "=================================================================="

# Commit any local state changes cleanly before syncing with origin/main
git checkout main 2>/dev/null || true
if [ "$USE_GITHUB_PRS" -eq 1 ]; then
  git fetch origin main 2>/dev/null || true
fi

# Non-blocking Antigravity caller: uses SIGKILL (-9) on child tree and never hangs on wait!
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
  local END_SENTINEL=${5:-"VERDICT: (APPROVED|CHANGES_REQUESTED)|===END_OF_TICKETS==="}
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
    ELAPSED=$((ELAPSED + 5))
    local BYTES
    BYTES=$(wc -c < "$OUT_FILE" 2>/dev/null || echo 0)

    # 1. Immediate completion when sentinel is written
    if [ "$BYTES" -gt 0 ] && grep -qE "$END_SENTINEL" "$OUT_FILE" 2>/dev/null; then
      sleep 1
      kill_agy_tree "$AGY_PID"
      echo "✅ ${MODEL} completed output in ${ELAPSED}s (${BYTES} bytes)."
      return 0
    fi

    # 2. Idle stream completion if CLI hangs after writing valid output
    if [ "$BYTES" -gt 500 ] && [ "$BYTES" -eq "$LAST_BYTES" ]; then
      STAGNANT_SEC=$((STAGNANT_SEC + 5))
      if [ $STAGNANT_SEC -ge 25 ] && grep -qE "$EXPECT_PATTERN" "$OUT_FILE" 2>/dev/null; then
        echo "✅ ${MODEL} stream idle for 25s with valid output (${BYTES} bytes). Force-closing CLI..."
        kill_agy_tree "$AGY_PID"
        return 0
      fi
    else
      STAGNANT_SEC=0
    fi
    LAST_BYTES=$BYTES

    if [ $((ELAPSED % 15)) -eq 0 ]; then
      echo "   ⏳ ${MODEL} streaming... (${ELAPSED}s / ${AGY_TIMEOUT_SEC}s | ${BYTES} bytes)"
    fi

    if [ $ELAPSED -ge $AGY_TIMEOUT_SEC ]; then
      kill_agy_tree "$AGY_PID"
      if [ -s "$OUT_FILE" ] && grep -qE "$EXPECT_PATTERN" "$OUT_FILE"; then
        echo "♻️  Salvaged valid output written before timeout!"
        return 0
      fi
      return 1
    fi
  done

  if [ -s "$OUT_FILE" ] && grep -qE "$EXPECT_PATTERN" "$OUT_FILE"; then
    echo "✅ ${MODEL} succeeded in ${ELAPSED}s."
    return 0
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
    echo "💤 Both models failed or hit quota limits. Sleeping 10 minutes..."
    sleep 600
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
\`\`\`text
$(grep -E '(\[error\]|==> X|FAILED|Exception|Error:)' "$CLEAN_LOG" | tail -n 60 || echo "See tail output below.")
\`\`\`

## Last 90 Lines of Output
\`\`\`text
$(tail -n 90 "$CLEAN_LOG")
\`\`\`
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
\`\`\`text
$(grep -E '(FAIL|AssertionError|Error:|TS[0-9]+:|✕|×)' "$CLEAN_LOG" | tail -n 60 || echo "See tail output below.")
\`\`\`

## Last 90 Lines of Output
\`\`\`text
$(tail -n 90 "$CLEAN_LOG")
\`\`\`
REPORT_EOF
      echo "[Worker ${WORKER_ID}] ❌ Frontend 'npm test' FAILED!"
      return 1
    fi
  fi

  echo "[Worker ${WORKER_ID}] ✅ Local test gate PASSED!"
  return 0
}

run_worker_freebuff() {
  local WORKER_ID=$1
  local PROMPT=$2
  local WT_DIR=".worktrees/worker-${WORKER_ID}"
  local CONTAINER="freebuff_worker_${WORKER_ID}"
  local STATUS_FILE=".reviews/worker_${WORKER_ID}.status"
  local PREV_STATUS
  PREV_STATUS=$(cat "$STATUS_FILE" 2>/dev/null || echo "🔨 Working...")

  rm -f "${WT_DIR}/.tickets/STATUS"

  while true; do
    if ! docker exec "$CONTAINER" tmux has-session -t buff 2>/dev/null; then
      echo "[Worker ${WORKER_ID}] 🚀 Launching FreeBuff session inside ${CONTAINER}..."
      docker exec "$CONTAINER" tmux new-session -d -s buff "freebuff"
      sleep 6
    fi

    while true; do
      local INIT_SCREEN
      INIT_SCREEN=$(docker exec "$CONTAINER" tmux capture-pane -t buff -p 2>/dev/null || true)
      if [ -z "$(echo "$INIT_SCREEN" | tr -d '[:space:]')" ]; then
        sleep 2
        continue
      fi

      if echo "$INIT_SCREEN" | grep -qiE "Log in|Sign in|visit https://|Press Enter to login|Waiting for login|authenticate"; then
        echo "🔐 Action Required: Log in inside Worker-${WORKER_ID} tab (Ctrl+A then ${WORKER_ID})" > "$STATUS_FILE"
        echo "[Worker ${WORKER_ID}] 🔐 FreeBuff is displaying the login screen. Complete login in Worker-${WORKER_ID} tab..."
        sleep 4
        continue
      fi

      if echo "$INIT_SCREEN" | grep -qiE "waiting room|queued|position in queue"; then
        echo "⏳ In FreeBuff waiting room queue (Worker-${WORKER_ID})..." > "$STATUS_FILE"
        sleep 5
        continue
      fi

      echo "$PREV_STATUS" > "$STATUS_FILE"
      sleep 2
      break
    done

    echo "[Worker ${WORKER_ID}] 📨 Sending ticket prompt to FreeBuff TUI..."
    docker exec "$CONTAINER" tmux send-keys -t buff $'\e[200~'"${PROMPT}"$'\e[201~'
    sleep 1
    docker exec "$CONTAINER" tmux send-keys -t buff Enter

    local ELAPSED=0
    local RESENT_COUNT=0
    while [ $ELAPSED -lt $SESSION_TIMEOUT_SEC ]; do
      sleep $POLL_INTERVAL_SEC
      ELAPSED=$((ELAPSED + POLL_INTERVAL_SEC))

      if [ -f "${WT_DIR}/.tickets/STATUS" ] && grep -q "DONE" "${WT_DIR}/.tickets/STATUS" 2>/dev/null; then
        echo "[Worker ${WORKER_ID}] ✅ FreeBuff signaled DONE after ${ELAPSED}s!"
        return 0
      fi

      if ! docker exec "$CONTAINER" tmux has-session -t buff 2>/dev/null; then
        echo "[Worker ${WORKER_ID}] ⚠️  FreeBuff tmux exited early. Respawning in 10s..."
        sleep 10
        break
      fi

      SCREEN=$(docker exec "$CONTAINER" tmux capture-pane -t buff -p 2>/dev/null || true)

      if echo "$SCREEN" | grep -qiE "Log in to continue|Press Enter to login|Waiting for login"; then
        break
      fi

      if echo "$SCREEN" | grep -qiE "Failed to start agent run|AI_APICallError|Message not sent|Session ended|superseded"; then
        echo "[Worker ${WORKER_ID}] ⚠️  FreeBuff session interrupted/dropped. Respawning in 10s..."
        docker exec "$CONTAINER" tmux kill-session -t buff 2>/dev/null || true
        sleep 10
        break
      fi

      if [ $ELAPSED -ge 20 ] && [ $RESENT_COUNT -lt 3 ]; then
        if ! echo "$SCREEN" | grep -qiE "STATUS|AGENTS\.md|Thinking|Read |Edit |Write |Bash"; then
          echo "[Worker ${WORKER_ID}] 🔁 Re-sending prompt to FreeBuff input box..."
          docker exec "$CONTAINER" tmux send-keys -t buff $'\e[200~'"${PROMPT}"$'\e[201~'
          sleep 1
          docker exec "$CONTAINER" tmux send-keys -t buff Enter
          RESENT_COUNT=$((RESENT_COUNT + 1))
        fi
      fi
    done

    if [ $ELAPSED -ge $SESSION_TIMEOUT_SEC ]; then
      echo "[Worker ${WORKER_ID}] 🔄 1-Hour limit reached. Restarting session with continuation prompt..."
      docker exec "$CONTAINER" tmux kill-session -t buff 2>/dev/null || true
      PROMPT="Your previous 1-hour session timed out. Run 'git status' and 'git diff' to inspect existing progress, finish remaining work, verify all tests pass, write .reviews/agent_notes.md, and run: echo DONE > .tickets/STATUS"
      sleep 8
    fi
  done
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
    rm -f .tickets/STATUS .reviews/agent_notes.md
  )

  local WORK_PROMPT="Implement @.tickets/${TICKET_NAME}.md following all rules in @AGENTS.md and @SPEC.md. Write a concise summary of your implementation into .reviews/agent_notes.md, verify all unit tests pass, and then run: echo DONE > .tickets/STATUS"
  run_worker_freebuff "$WORKER_ID" "$WORK_PROMPT"

  local PR_NUMBER=""
  local ROUND=1
  local TEST_RETRIES=0

  while true; do
    echo "🧪 Testing ${TICKET_NAME} (Round ${ROUND})" > "$STATUS_FILE"

    if ! run_worker_test_gate "$WORKER_ID" "$TICKET_FILE"; then
      TEST_RETRIES=$((TEST_RETRIES + 1))
      if [ $TEST_RETRIES -gt $MAX_REVIEW_ROUNDS ]; then
        echo "❌ Failed test gate on ${TICKET_NAME}" > "$STATUS_FILE"
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
        git commit -m "feat(${TICKET_NAME}): round ${ROUND} implementation" >/dev/null
      fi
    )

    if [ "$USE_GITHUB_PRS" -eq 1 ]; then
      echo "☁️  Pushing PR for ${TICKET_NAME}" > "$STATUS_FILE"
      (
        cd "$WT_DIR"
        git push -u origin "$BRANCH_NAME" --force-with-lease >/dev/null 2>&1 || git push -u origin "$BRANCH_NAME" -f >/dev/null 2>&1
      )
      PR_NUMBER=$(gh pr list --head "$BRANCH_NAME" --json number --jq '.[0].number // empty' 2>/dev/null || true)
      if [ -z "$PR_NUMBER" ]; then
        local NOTES_BODY="Automated PR for \`${TICKET_NAME}\` by Worker ${WORKER_ID}."
        [ -f "${WT_DIR}/.reviews/agent_notes.md" ] && NOTES_BODY=$(cat "${WT_DIR}/.reviews/agent_notes.md")
        gh pr create \
          --base main \
          --head "$BRANCH_NAME" \
          --title "feat: ${TICKET_NAME}" \
          --body "## Ticket Specification
$(cat "$TICKET_FILE")

---
## Implementer Notes (Worker ${WORKER_ID})
${NOTES_BODY}" >/dev/null 2>&1 || true
        PR_NUMBER=$(gh pr list --head "$BRANCH_NAME" --json number --jq '.[0].number // empty' 2>/dev/null || true)
        echo "[Worker ${WORKER_ID}] 📬 Opened GitHub Pull Request #${PR_NUMBER} for ${TICKET_NAME}!"
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
        ':(exclude)Dockerfile.sandbox' \
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
2. Only request changes (VERDICT: CHANGES_REQUESTED) for genuine High/Medium severity logic bugs, security flaws, missing core requirements, or UI layout violations.
3. Do NOT block approval over Low-severity nitpicks or valid scope rebuttals.

End your response with EXACTLY one of:
VERDICT: APPROVED
or
VERDICT: CHANGES_REQUESTED
PROMPT_EOF

    ACTIVE_MODEL_USED=""
    run_agy_with_fallback \
      "$PRIMARY_REVIEWER_MODEL" \
      "$FALLBACK_MODEL" \
      "$PROMPT_FILE" "$REVIEW_FILE" "VERDICT: (APPROVED|CHANGES_REQUESTED)"
    cp "$REVIEW_FILE" "${WT_DIR}/.reviews/${TICKET_NAME}-review-${ROUND}.md"

    if [ "$USE_GITHUB_PRS" -eq 1 ] && [ -n "$PR_NUMBER" ]; then
      gh pr comment "$PR_NUMBER" --body "### 🤖 Automated Code Review (Round ${ROUND} by \`${ACTIVE_MODEL_USED}\`)

$(cat "$REVIEW_FILE")" >/dev/null 2>&1 || true
    fi

    if grep -q "VERDICT: APPROVED" "$REVIEW_FILE"; then
      echo "[Worker ${WORKER_ID}] 🎉 ${TICKET_NAME} APPROVED by ${ACTIVE_MODEL_USED}!"
      break
    fi

    if [ $ROUND -ge $MAX_REVIEW_ROUNDS ]; then
      echo "🛑 Max review rounds exceeded on ${TICKET_NAME}" > "$STATUS_FILE"
      return 1
    fi

    echo "🔧 Fixing review feedback on ${TICKET_NAME} (Round ${ROUND})" > "$STATUS_FILE"
    local FIX_PROMPT="🚨 PR CODE REVIEW FEEDBACK (Round ${ROUND}): Read the reviewer feedback in @.reviews/${TICKET_NAME}-review-${ROUND}.md and the ticket @.tickets/${TICKET_NAME}.md. Fix valid issues in your scope, or write a clear technical rebuttal in .reviews/agent_notes.md. Re-run tests until green, and run: echo DONE > .tickets/STATUS"
    run_worker_freebuff "$WORKER_ID" "$FIX_PROMPT"
    ROUND=$((ROUND + 1))
  done

  echo "🔒 Acquiring merge lock for ${TICKET_NAME}..." > "$STATUS_FILE"
  (
    flock -x 200
    echo "[Worker ${WORKER_ID}] 🔀 Merging latest main into ${BRANCH_NAME}..."

    if [ "$USE_GITHUB_PRS" -eq 1 ]; then
      git fetch origin main >/dev/null 2>&1 || true
      git branch -f main origin/main 2>/dev/null || true
    fi

    cd "$WT_DIR"
    if ! git merge --no-edit main >/dev/null 2>&1; then
      echo "[Worker ${WORKER_ID}] ⚠️  Merge conflict detected with main! Dispatching FreeBuff to resolve..."
      cd ~/agent-project
      local CONFLICT_PROMPT="🚨 GIT MERGE CONFLICT WITH MAIN: Another parallel worker merged changes to 'main' that conflict with your branch. Run 'git status' and 'git diff' to find all <<<<<<< HEAD conflict markers, resolve them cleanly so both features work together, run the test suite ('sbt -batch test' and 'npm test -- --run') until 100% green, and run: echo DONE > .tickets/STATUS"
      run_worker_freebuff "$WORKER_ID" "$CONFLICT_PROMPT"
      run_worker_test_gate "$WORKER_ID" "$TICKET_FILE"
      cd "$WT_DIR"
      rm -f .tickets/STATUS
      git add -A
      git reset -- .reviews/ .tickets/ 2>/dev/null || true
      git commit -m "chore(${TICKET_NAME}): resolve merge conflicts with main" >/dev/null 2>&1 || true
    else
      cd ~/agent-project
      run_worker_test_gate "$WORKER_ID" "$TICKET_FILE"
      cd "$WT_DIR"
    fi

    cd ~/agent-project
    if [ "$USE_GITHUB_PRS" -eq 1 ] && [ -n "$PR_NUMBER" ]; then
      (cd "$WT_DIR" && git push origin "$BRANCH_NAME" >/dev/null 2>&1)
      echo "[Worker ${WORKER_ID}] 🚀 Merging GitHub PR #${PR_NUMBER} into main..."
      gh pr merge "$PR_NUMBER" --merge --delete-branch >/dev/null 2>&1 || true
      git checkout main >/dev/null 2>&1
      git pull --rebase origin main >/dev/null 2>&1 || true
    else
      git checkout main >/dev/null 2>&1
      git merge --no-ff "$BRANCH_NAME" -m "Merge ${TICKET_NAME}" >/dev/null 2>&1
    fi

    touch "$DONE_MARKER"
    git add "$DONE_MARKER" "$TICKET_FILE" 2>/dev/null || true
    git commit -m "chore(tickets): mark ${TICKET_NAME} completed" >/dev/null 2>&1 || true
    if [ "$USE_GITHUB_PRS" -eq 1 ]; then
      git push origin main >/dev/null 2>&1 || true
    fi
    echo "[Worker ${WORKER_ID}] ✅ ${TICKET_NAME} merged to main and synced to GitHub!"
  ) 200>.reviews/merge.lock

  echo "💤 Idle (Last completed: ${TICKET_NAME})" > "$STATUS_FILE"
  return 0
}

extract_tickets_with_waves() {
  local RAW_FILE=$1
  sed '/===END_OF_TICKETS===/d' "$RAW_FILE" | awk '
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

check_and_compile_human_feedback() {
  if [ ! -f FEEDBACK.md ]; then return 0; fi
  local ACTIVE_FEEDBACK
  ACTIVE_FEEDBACK=$(sed '/<!--.*-->/d' FEEDBACK.md | tr -d '[:space:]')
  if [ -z "$ACTIVE_FEEDBACK" ]; then return 0; fi

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

Decompose ALL requirements in <human_feedback> into 5 to 7 atomic implementation tickets grouped into PARALLEL EXECUTION WAVES (WAVE:1, WAVE:2, WAVE:3).
Tickets in the same wave run concurrently on parallel FreeBuff workers:
- Assign independent subsystems (e.g., Backend Scala rules/clock vs. Frontend Web Audio synthesizer + SortBar vs. Frontend CSS Grid / Lobby settings) to the SAME wave so they run simultaneously!
- Assign tickets that build directly on earlier tickets to the next wave number.

<agents_rules>
$(cat AGENTS.md)
</agents_rules>

<human_feedback>
$(cat FEEDBACK.md)
</human_feedback>

<existing_project_files>
$(find backend/src frontend/src -type f 2>/dev/null | sort)
</existing_project_files>

<current_code_context>
$(head -n 120 backend/src/main/scala/**/*.scala frontend/src/app.tsx frontend/src/pages/*.tsx frontend/src/components/*.tsx 2>/dev/null | head -c 28000)
</current_code_context>

Output each ticket using this EXACT delimiter format on its own line (including |WAVE:N), and end your entire response with ===END_OF_TICKETS===:
===TICKET:T-90-feedback-${TIMESTAMP}-1-backend.md|WAVE:1===
[Full Markdown content of ticket 1]
===TICKET:T-90-feedback-${TIMESTAMP}-2-audio.md|WAVE:1===
[Full Markdown content of ticket 2]
===END_OF_TICKETS===

Do NOT output any text before the first ===TICKET:...=== marker.
PROMPT_EOF

  run_agy_with_fallback "$PRIMARY_ARCHITECT_MODEL" "$FALLBACK_MODEL" ".reviews/feedback_prompt.txt" ".reviews/raw_feedback_tickets.txt" "===TICKET:"
  extract_tickets_with_waves ".reviews/raw_feedback_tickets.txt"

  cat << 'RESET_EOF' > FEEDBACK.md
<!-- Write your plain-English UI/UX feedback, bugs, or usability requests below this line. -->
<!-- Note: Your previous feedback is always backed up in FEEDBACK.backup.md and .reviews/feedback_archive/ -->

RESET_EOF

  git checkout main 2>/dev/null || true
  git add .tickets/ FEEDBACK.md FEEDBACK.backup.md 2>/dev/null || true
  git commit -m "chore(tickets): add feedback wave tickets ${TIMESTAMP}" >/dev/null 2>&1 || true
  [ "$USE_GITHUB_PRS" -eq 1 ] && (git push origin main >/dev/null 2>&1 || true)
}

# === PHASE 2: DYNAMIC REAL-TIME WORKER POOL SCHEDULER ===
while true; do
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
      echo "🌊 EXECUTING PARALLEL WAVE ${WAVE_NUM} (Dynamic Worker Pool Active)"
      echo "   Tip: Run './agent-orchestration/scale-workers.sh <N>' in Window 4 to add/remove workers live!"
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
            ACTIVE_COUNT=$((ACTIVE_COUNT + 1))
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
              REMAINING_IN_WAVE=$((REMAINING_IN_WAVE + 1))
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
              ACTIVE_COUNT=$((ACTIVE_COUNT + 1))
              DISPATCHED=1
              sleep 5
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

  echo "=================================================================="
  echo "🏆 ALL CURRENT WAVES COMPLETED, PRs MERGED, AND SYNCED TO GITHUB!"
  echo "=================================================================="
  echo "👉 How to test & review your build right now:"
  echo "   1. Run './agent-orchestration/play-local.sh' and open http://localhost:5173"
  echo "   2. View PR history on GitHub: gh pr list --state all"
  echo "   3. To request UI/UX or functional fixes, write them in 'FEEDBACK.md'"
  echo "------------------------------------------------------------------"
  read -r -p "Press [ENTER] after saving FEEDBACK.md to run fixes, or type 'approve' to sign off on this milestone: " USER_CHOICE

  if [ "$USER_CHOICE" = "approve" ]; then
    echo "✅ Milestone signed off! Run './agent-orchestration/next-milestone.sh M2' when ready."
    break
  fi
done
