#!/bin/bash
# User prompt submit hook for Claude Code
# Captures user prompts and sends them to Inspector Hook for activity tracking

HOOK_NAME="UserPromptSubmit"
SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/lib/http-logger.sh"

# Read the full hook input from stdin
input=$(cat)

# Extract fields using jq
session=$(echo "$input" | jq -r '.session_id // "unknown"')
prompt=$(echo "$input" | jq -r '.prompt // ""')
cwd=$(echo "$input" | jq -r '.cwd // ""')

# Skip if no prompt
if [ -z "$prompt" ]; then
  exit 0
fi

# Truncate very long prompts for logging (keep first 500 chars)
truncated_prompt="$prompt"
if [ ${#prompt} -gt 500 ]; then
  truncated_prompt="${prompt:0:500}..."
fi

# Build the payload
payload=$(jq -n \
  --arg hook "UserPromptSubmit" \
  --arg event "user.prompt" \
  --arg sessionId "$session" \
  --arg cwd "$cwd" \
  --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg level "info" \
  --arg message "User submitted prompt" \
  --arg prompt "$prompt" \
  '{
    hook: $hook,
    event: $event,
    sessionId: $sessionId,
    timestamp: $timestamp,
    level: $level,
    message: $message,
    details: {
      cwd: $cwd,
      prompt: $prompt
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
