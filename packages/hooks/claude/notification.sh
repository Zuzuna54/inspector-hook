#!/bin/bash
# Notification hook for Claude Code
# Captures Claude notifications (permission prompts, idle waiting, etc.)
# This enables the notification activity type in the Activity tab

HOOK_NAME="Notification"
SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/lib/http-logger.sh"

# Read the full hook input from stdin
input=$(cat)

# Extract fields using jq
session=$(echo "$input" | jq -r '.session_id // "unknown"')
message=$(echo "$input" | jq -r '.message // ""')
notification_level=$(echo "$input" | jq -r '.level // "info"')
cwd=$(echo "$input" | jq -r '.cwd // ""')

# Skip if no message
if [ -z "$message" ]; then
  exit 0
fi

# Determine notification type from message content
notif_type="info"
if echo "$message" | grep -qi "permission"; then
  notif_type="permission_prompt"
elif echo "$message" | grep -qi "waiting\|idle"; then
  notif_type="idle_prompt"
elif echo "$message" | grep -qi "error"; then
  notif_type="error"
elif echo "$message" | grep -qi "warning"; then
  notif_type="warning"
fi

# Map notification level to log level
level="info"
case "$notification_level" in
  "error")
    level="error"
    ;;
  "warning"|"warn")
    level="warn"
    ;;
  *)
    level="info"
    ;;
esac

# Build the payload
payload=$(jq -n \
  --arg hook "Notification" \
  --arg event "notification" \
  --arg sessionId "$session" \
  --arg cwd "$cwd" \
  --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg level "$level" \
  --arg message "$message" \
  --arg notifType "$notif_type" \
  --arg notifLevel "$notification_level" \
  '{
    hook: $hook,
    event: $event,
    sessionId: $sessionId,
    timestamp: $timestamp,
    level: $level,
    message: $message,
    details: {
      cwd: $cwd,
      notificationType: $notifType,
      notificationLevel: $notifLevel,
      message: $message
    }
  }')

# Send to Inspector Hook server
port=$(get_inspector_port)
if [ -n "$port" ]; then
  curl -s -X POST "http://localhost:$port/log" \
    -H "Content-Type: application/json" \
    -d "$payload" \
    --max-time 1 > /dev/null 2>&1 &
fi

exit 0
