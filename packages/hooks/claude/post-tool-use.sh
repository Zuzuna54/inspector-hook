#!/usr/bin/env bash
#
# Inspector Hook - Post Tool Use Hook
# Called by Claude Code after a tool has been executed
#
# This hook captures the tool output/result and sends it to the
# Inspector Hook server for logging and analysis.
#
# Environment Variables (set by Claude Code):
#   CLAUDE_SESSION_ID - Current session ID
#   CLAUDE_TOOL_NAME - Name of the tool that was executed
#   CLAUDE_TOOL_STATUS - Execution status (success/error)
#
# Exit Codes:
#   0 - Normal completion
#   Non-zero values are logged but don't affect Claude Code
#

set -euo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source the HTTP logger library
source "$SCRIPT_DIR/lib/http-logger.sh"

# Read tool output from stdin
TOOL_OUTPUT=$(cat)

# Get tool metadata from environment
TOOL_NAME="${CLAUDE_TOOL_NAME:-unknown}"
TOOL_STATUS="${CLAUDE_TOOL_STATUS:-unknown}"

# Try to extract tool name from output JSON if not set
if [[ "$TOOL_NAME" == "unknown" && -n "$TOOL_OUTPUT" ]]; then
  TOOL_NAME=$(echo "$TOOL_OUTPUT" | jq -r '.tool_name // .name // "unknown"' 2>/dev/null || echo "unknown")
fi

_ih_debug "Post-tool-use hook triggered for tool: $TOOL_NAME (status: $TOOL_STATUS)"

# Determine log level based on status
LOG_LEVEL="info"
if [[ "$TOOL_STATUS" == "error" ]]; then
  LOG_LEVEL="error"
elif [[ "$TOOL_STATUS" == "blocked" ]]; then
  LOG_LEVEL="blocked"
fi

# Prepare the event data
EVENT_DATA=$(jq -n \
  --arg toolName "$TOOL_NAME" \
  --arg status "$TOOL_STATUS" \
  --arg level "$LOG_LEVEL" \
  --argjson output "$TOOL_OUTPUT" \
  '{
    tool: $toolName,
    status: $status,
    level: $level,
    output: $output,
    phase: "post"
  }')

# Send log entry (non-blocking)
ih_send_log "post-tool-use" "tool.end" "$EVENT_DATA"

# Always exit successfully
exit 0
