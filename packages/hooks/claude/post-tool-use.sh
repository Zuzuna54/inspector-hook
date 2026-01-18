#!/bin/bash
# Post-tool-use hook for Claude Code
# Captures tool name, full tool input, tool result, cwd, and sends to Inspector Hook

HOOK_NAME="PostToolUse"
SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/lib/http-logger.sh"

# Read the full hook input from stdin
input=$(cat)

# Extract fields using jq
tool=$(echo "$input" | jq -r '.tool_name // "unknown"')
session=$(echo "$input" | jq -r '.session_id // "unknown"')
cwd=$(echo "$input" | jq -r '.cwd // ""')
file=$(echo "$input" | jq -r '.tool_input.file_path // .tool_input.path // .tool_input.command // ""')

# Extract the full tool_input object
tool_input=$(echo "$input" | jq -c '.tool_input // {}')

# Extract the tool_result - this contains the output from the tool
# tool_result can be a string, object, or null
tool_result=$(echo "$input" | jq -c '.tool_result // null')

# Check if there was an error (tool_result might contain error info)
# Handle case where tool_result is a string vs object
has_error=$(echo "$input" | jq -r 'if (.tool_result | type) == "object" and .tool_result.error then "true" else "false" end')
level="info"
if [ "$has_error" = "true" ]; then
  level="error"
fi

# Build the payload with full tool input and result in details
payload=$(jq -n \
  --arg hook "PostToolUse" \
  --arg event "tool.end" \
  --arg tool "$tool" \
  --arg file "$file" \
  --arg sessionId "$session" \
  --arg cwd "$cwd" \
  --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg level "$level" \
  --arg message "Tool completed: $tool" \
  --argjson toolInput "$tool_input" \
  --argjson toolResult "$tool_result" \
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
      cwd: $cwd,
      tool_input: $toolInput,
      tool_result: $toolResult
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
