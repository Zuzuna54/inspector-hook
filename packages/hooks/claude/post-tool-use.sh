#!/bin/bash
# Post-tool-use hook for Claude Code

HOOK_NAME="PostToolUse"
source "$(dirname "$0")/lib/http-logger.sh"

# Read tool info from stdin
read -r input
tool=$(echo "$input" | jq -r '.tool_name // "unknown"')
file=$(echo "$input" | jq -r '.tool_input.file_path // .tool_input.path // ""')
session=$(echo "$input" | jq -r '.session_id // "unknown"')

# Send log with file path (core will read file content itself)
curl -s -X POST "http://localhost:$(get_inspector_port)/log" \
    -H "Content-Type: application/json" \
    -d "{\"hook\":\"PostToolUse\",\"event\":\"PostToolUse\",\"tool\":\"$tool\",\"file\":\"$file\",\"sessionId\":\"$session\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" \
    --max-time 1 > /dev/null 2>&1

exit 0
