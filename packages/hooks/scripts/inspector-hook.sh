#!/usr/bin/env bash
#
# Inspector Hook - Claude Code Hook Script
# Intercepts Claude Code events and sends them to the Inspector Hook server
#
# This script is designed to be called as a Claude Code hook.
# It reads hook data from stdin and forwards it to the Inspector Hook HTTP server.
#
# Environment Variables:
#   INSPECTOR_HOOK_PORT - HTTP server port (default: 52376)
#   INSPECTOR_HOOK_DISABLED - Set to "1" to disable logging
#   INSPECTOR_HOOK_DEBUG - Set to "1" for verbose output
#
# Usage in Claude Code settings (~/.claude/settings.json):
#   {
#     "hooks": {
#       "PreToolUse": [{ "command": "/path/to/inspector-hook.sh" }],
#       "PostToolUse": [{ "command": "/path/to/inspector-hook.sh" }],
#       "Notification": [{ "command": "/path/to/inspector-hook.sh" }]
#     }
#   }
#

set -euo pipefail

# Configuration
HOOK_PORT="${INSPECTOR_HOOK_PORT:-52376}"
HOOK_HOST="${INSPECTOR_HOOK_HOST:-localhost}"
HOOK_DISABLED="${INSPECTOR_HOOK_DISABLED:-0}"
HOOK_DEBUG="${INSPECTOR_HOOK_DEBUG:-0}"
HOOK_TIMEOUT="${INSPECTOR_HOOK_TIMEOUT:-5}"

# Debug logging
debug() {
  if [[ "$HOOK_DEBUG" == "1" ]]; then
    echo "[inspector-hook] $*" >&2
  fi
}

# Check if hook is disabled
if [[ "$HOOK_DISABLED" == "1" ]]; then
  debug "Hook disabled, exiting"
  exit 0
fi

# Read hook event from stdin
HOOK_DATA=$(cat)

if [[ -z "$HOOK_DATA" ]]; then
  debug "No hook data received"
  exit 0
fi

debug "Received hook data: $HOOK_DATA"

# Extract hook name from environment or data
HOOK_NAME="${CLAUDE_HOOK_NAME:-unknown}"
HOOK_EVENT="${CLAUDE_HOOK_EVENT:-unknown}"
SESSION_ID="${CLAUDE_SESSION_ID:-}"

# Build the log entry payload
# The hook data from Claude Code is already JSON, we wrap it with metadata
PAYLOAD=$(jq -n \
  --arg hook "$HOOK_NAME" \
  --arg event "$HOOK_EVENT" \
  --arg sessionId "$SESSION_ID" \
  --arg timestamp "$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")" \
  --argjson data "$HOOK_DATA" \
  '{
    hook: $hook,
    event: $event,
    sessionId: $sessionId,
    timestamp: $timestamp,
    data: $data
  }'
)

debug "Sending payload to http://$HOOK_HOST:$HOOK_PORT/api/log"

# Send to Inspector Hook server
# Use curl with timeout and ignore errors (don't block Claude Code if server is down)
response=$(curl -s -X POST \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  --connect-timeout "$HOOK_TIMEOUT" \
  --max-time "$HOOK_TIMEOUT" \
  "http://$HOOK_HOST:$HOOK_PORT/api/log" 2>/dev/null || echo '{"error": "connection failed"}')

debug "Server response: $response"

# Exit successfully even if server is unreachable
# We don't want to block Claude Code operations
exit 0
