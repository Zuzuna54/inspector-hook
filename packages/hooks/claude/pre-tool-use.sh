#!/bin/bash
# Pre-tool-use hook for Claude Code
# Captures tool name, full tool input, and sends to Inspector Hook

HOOK_NAME="PreToolUse"
SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/lib/http-logger.sh"

# Read the full hook input from stdin
input=$(cat)

# Extract fields using jq
tool=$(echo "$input" | jq -r '.tool_name // "unknown"')
session=$(echo "$input" | jq -r '.session_id // "unknown"')
file=$(echo "$input" | jq -r '.tool_input.file_path // .tool_input.path // .tool_input.command // ""')

# Extract the full tool_input object as a string
tool_input=$(echo "$input" | jq -c '.tool_input // {}')

# Build the payload with full tool input in details
payload=$(jq -n \
  --arg hook "PreToolUse" \
  --arg event "tool.start" \
  --arg tool "$tool" \
  --arg file "$file" \
  --arg sessionId "$session" \
  --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg level "info" \
  --arg message "Tool started: $tool" \
  --argjson toolInput "$tool_input" \
  '{
    hook: $hook,
    event: $event,
    tool: $tool,
    file: $file,
    sessionId: $sessionId,
    timestamp: $timestamp,
    level: $level,
    message: $message,
    details: {
      tool_input: $toolInput
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
