#!/usr/bin/env bash
set -uo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

ENV_FILE="$PROJECT_ROOT/agent-orchestration/.env"
LATCH_FILE="$PROJECT_ROOT/.reviews/alert_sent.latch"
LOCK_FILE="$PROJECT_ROOT/.reviews/notify.lock"
mkdir -p "$PROJECT_ROOT/.reviews"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source <(grep -v "^FREEBUFF_AUTH_B64=" "$ENV_FILE") 2>/dev/null || true
  set +a
fi

MODE="${1:-}"

if [ "$MODE" = "--reset" ]; then
  rm -f "$LATCH_FILE"
  echo "🔔 Notification latch cleared (.reviews/alert_sent.latch removed). Alerts are armed."
  exit 0
fi

if [ "$MODE" = "--test" ]; then
  rm -f "$LATCH_FILE"
  SUBJECT="Test Alert — Lidurak Pipeline Notification Check"
  BODY="This is a test notification from your Lidurak autonomous pipeline on $(hostname). Email alerts are configured and working!"
else
  SUBJECT="${1:-Action Required}"
  BODY="${2:-Human intervention is required in the Lidurak development pipeline.}"
fi

if [ -z "${ALERT_EMAIL_TO:-}" ] || [ -z "${ALERT_SMTP_PASS:-}" ]; then
  echo "ℹ️  [Notify] Email alerts not configured in agent-orchestration/.env (skipping email for: ${SUBJECT})."
  exit 0
fi

(
  flock -x 202

  # Enforce Single-Email Latch: never send a second email until human resets/interacts
  if [ -f "$LATCH_FILE" ] && [ "$MODE" != "--test" ]; then
    echo "🔕 [Notify] Alert latch already active ($(cat "$LATCH_FILE" 2>/dev/null)); suppressing duplicate email."
    exit 0
  fi

  export NOTIFY_SUBJECT="[Lidurak Pipeline] ${SUBJECT}"
  export NOTIFY_BODY="${BODY}

Host: $(hostname)
Project: ${PROJECT_ROOT}
Time: $(date '+%Y-%m-%d %H:%M:%S %Z')
(Note: Further email alerts are automatically muted until you interact with the pipeline.)"

  if python3 - << 'PYEOF'
import os, smtplib
from email.message import EmailMessage

smtp_host = os.environ.get("ALERT_SMTP_HOST", "smtp.gmail.com")
smtp_port = int(os.environ.get("ALERT_SMTP_PORT", "587"))
smtp_user = os.environ.get("ALERT_SMTP_USER") or os.environ.get("ALERT_EMAIL_TO")
smtp_pass = os.environ.get("ALERT_SMTP_PASS", "").replace(" ", "")
email_to  = os.environ.get("ALERT_EMAIL_TO")
email_from = os.environ.get("ALERT_EMAIL_FROM") or smtp_user

msg = EmailMessage()
msg["Subject"] = os.environ["NOTIFY_SUBJECT"]
msg["From"] = email_from
msg["To"] = email_to
msg.set_content(os.environ["NOTIFY_BODY"])

with smtplib.SMTP(smtp_host, smtp_port, timeout=20) as server:
    server.starttls()
    server.login(smtp_user, smtp_pass)
    server.send_message(msg)
PYEOF
  then
    if [ "$MODE" = "--test" ]; then
      echo "✅ Test email sent successfully to ${ALERT_EMAIL_TO}!"
    else
      echo "$(date '+%Y-%m-%d %H:%M:%S') - ${SUBJECT}" > "$LATCH_FILE"
      echo "📧 [Notify] Sent single-latch email alert to ${ALERT_EMAIL_TO}: ${SUBJECT}"
    fi
  else
    echo "⚠️  [Notify] Failed to send email via SMTP. Check ALERT_EMAIL_TO and ALERT_SMTP_PASS in agent-orchestration/.env."
  fi
) 202>"$LOCK_FILE"