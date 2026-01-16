#!/usr/bin/env bash
#
# Inspector Hook - Pre Tool Use Hook
# Called by Claude Code before a tool is executed
#
# This hook captures the tool name, input parameters, and sends
# them to the Inspector Hook server for logging and potential interception.
#
# Environment Variables (set by Claude Code):
#   CLAUDE_SESSION_ID - Current session ID
#   CLAUDE_TOOL_NAME - Name of the tool being executed
#
# Exit Codes:
#   0 - Allow tool execution to proceed
#   1 - Block tool execution (with error message on stdout)
#

set -euo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source the HTTP logger library
source "$SCRIPT_DIR/lib/http-logger.sh"

# Read tool input from stdin
TOOL_INPUT=$(cat)

# Get tool name from environment or try to extract from input
TOOL_NAME="${CLAUDE_TOOL_NAME:-unknown}"

# Try to extract tool name from input JSON if not set
if [[ "$TOOL_NAME" == "unknown" && -n "$TOOL_INPUT" ]]; then
  TOOL_NAME=$(echo "$TOOL_INPUT" | jq -r '.tool_name // .name // "unknown"' 2>/dev/null || echo "unknown")
fi

_ih_debug "Pre-tool-use hook triggered for tool: $TOOL_NAME"

# Prepare the event data
EVENT_DATA=$(jq -n \
  --arg toolName "$TOOL_NAME" \
  --argjson input "$TOOL_INPUT" \
  '{
    tool: $toolName,
    input: $input,
    phase: "pre"
  }')

# Send log entry (non-blocking to avoid slowing down Claude Code)
ih_send_log "pre-tool-use" "tool.start" "$EVENT_DATA"

# Always allow execution to proceed
# To block, you would exit 1 and output an error message
exit 0
