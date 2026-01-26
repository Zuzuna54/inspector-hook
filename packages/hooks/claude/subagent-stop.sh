#!/bin/bash
# SubagentStop hook for Claude Code
# Captures when a subagent (Task tool) completes
# This enables tracking of Task tool completions in the Activity tab

HOOK_NAME="SubagentStop"
SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/lib/http-logger.sh"

# Read the full hook input from stdin
input=$(cat)

# Extract fields using jq
session=$(echo "$input" | jq -r '.session_id // "unknown"')
subagent_type=$(echo "$input" | jq -r '.subagent_type // "unknown"')
success=$(echo "$input" | jq -r '.success // true')
cwd=$(echo "$input" | jq -r '.cwd // ""')

# Extract result (may be large, so truncate)
result=$(echo "$input" | jq -c '.result // null')
if [ ${#result} -gt 2000 ]; then
  result="${result:0:2000}...(truncated)"
fi

# Determine log level based on success
level="info"
if [ "$success" = "false" ]; then
  level="warn"
fi

# Build message
if [ "$success" = "true" ]; then
  message="Subagent completed: $subagent_type"
else
  message="Subagent failed: $subagent_type"
fi

# Build the payload
payload=$(jq -n \
  --arg hook "SubagentStop" \
  --arg event "subagent.stop" \
  --arg sessionId "$session" \
  --arg cwd "$cwd" \
  --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg level "$level" \
  --arg message "$message" \
  --arg subagentType "$subagent_type" \
  --argjson success "$success" \
  --arg result "$result" \
  '{
    hook: $hook,
    event: $event,
    sessionId: $sessionId,
    timestamp: $timestamp,
    level: $level,
    message: $message,
    details: {
      cwd: $cwd,
      subagent_type: $subagentType,
      success: $success,
      result: $result
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
