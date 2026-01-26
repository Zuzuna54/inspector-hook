#!/bin/bash
# Stop hook for Claude Code
# Captures when Claude finishes responding (AI response completion)
# This enables the ai_response activity type in the Activity tab

HOOK_NAME="Stop"
SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/lib/http-logger.sh"

# Read the full hook input from stdin
input=$(cat)

# Extract fields using jq
session=$(echo "$input" | jq -r '.session_id // "unknown"')
reason=$(echo "$input" | jq -r '.reason // "complete"')
cwd=$(echo "$input" | jq -r '.cwd // ""')

# Extract error if present (for error/abort cases)
error_msg=$(echo "$input" | jq -r '.error // ""')

# Determine log level based on reason
level="info"
if [ "$reason" = "error" ]; then
  level="error"
fi

# Build human-readable message based on reason
case "$reason" in
  "complete")
    message="Claude finished responding"
    ;;
  "user_abort")
    message="Session stopped by user"
    ;;
  "error")
    message="Session stopped due to error"
    ;;
  "timeout")
    message="Session timed out"
    ;;
  *)
    message="Session stopped: $reason"
    ;;
esac

# Build the payload
payload=$(jq -n \
  --arg hook "Stop" \
  --arg event "ai.response" \
  --arg sessionId "$session" \
  --arg cwd "$cwd" \
  --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg level "$level" \
  --arg message "$message" \
  --arg reason "$reason" \
  --arg error "$error_msg" \
  '{
    hook: $hook,
    event: $event,
    sessionId: $sessionId,
    timestamp: $timestamp,
    level: $level,
    message: $message,
    details: {
      cwd: $cwd,
      stopReason: $reason,
      error: $error
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
