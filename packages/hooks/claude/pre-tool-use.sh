#!/bin/bash
# Pre-tool-use hook for Claude Code
# Captures tool name, full tool input, cwd, and sends to Inspector Hook

HOOK_NAME="PreToolUse"
SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/lib/http-logger.sh"

# Read the full hook input from stdin
input=$(cat)

# Extract fields using jq
tool=$(echo "$input" | jq -r '.tool_name // "unknown"')
session=$(echo "$input" | jq -r '.session_id // "unknown"')
cwd=$(echo "$input" | jq -r '.cwd // ""')
file=$(echo "$input" | jq -r '.tool_input.file_path // .tool_input.path // .tool_input.command // ""')

# Extract the full tool_input object as a string
tool_input=$(echo "$input" | jq -c '.tool_input // {}')

# Generate deterministic execution ID (same algorithm in post-tool-use.sh)
# Cross-platform: macOS uses md5, Linux uses md5sum
if command -v md5sum &>/dev/null; then
    tool_input_hash=$(echo "$tool_input" | md5sum | cut -d' ' -f1 | head -c 12)
elif command -v md5 &>/dev/null; then
    tool_input_hash=$(echo "$tool_input" | md5 -r | cut -d' ' -f1 | head -c 12)
else
    # Fallback: use first 12 chars of base64-encoded input
    tool_input_hash=$(echo "$tool_input" | base64 | tr -d '\n' | head -c 12)
fi
execution_id="${session}-${tool}-${tool_input_hash}"

# Build the payload with full tool input in details
payload=$(jq -n \
  --arg hook "PreToolUse" \
  --arg event "tool.start" \
  --arg tool "$tool" \
  --arg file "$file" \
  --arg sessionId "$session" \
  --arg executionId "$execution_id" \
  --arg cwd "$cwd" \
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
    executionId: $executionId,
    timestamp: $timestamp,
    level: $level,
    message: $message,
    details: {
      cwd: $cwd,
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
