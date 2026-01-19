#!/bin/bash
# HTTP Logger Library for Claude Code Hooks
# Source this file in your bash hooks to send logs to Hook Inspector
#
# Usage:
#   source "$(dirname "$0")/../lib/http-logger.sh"
#   hook_log "info" "Processing file"
#   hook_log "warn" "File might have issues"
#   hook_log "error" "Something went wrong"
#   hook_log "blocked" "Action was blocked"

# Port file location
HOOK_INSPECTOR_PORT_FILE="/tmp/claude-hooks-inspector.port"

# Get hook name from script name if not set
if [ -z "$HOOK_NAME" ]; then
    HOOK_NAME=$(basename "${BASH_SOURCE[1]:-$0}" .sh)
fi

# Read port from file
_get_inspector_port() {
    if [ -f "$HOOK_INSPECTOR_PORT_FILE" ]; then
        cat "$HOOK_INSPECTOR_PORT_FILE" 2>/dev/null
    fi
}

# Send log to Hook Inspector
# Args: level message [event] [tool] [file] [session_id]
hook_log() {
    local level="${1:-info}"
    local message="${2:-}"
    local event="${3:-}"
    local tool="${4:-}"
    local file="${5:-}"
    local session_id="${6:-}"

    local port=$(_get_inspector_port)

    # Skip if no inspector running
    [ -z "$port" ] && return 0

    # Build JSON payload
    local json=$(cat <<EOF
{
    "hook": "$HOOK_NAME",
    "level": "$level",
    "message": $(echo "$message" | jq -Rs .),
    "event": "$event",
    "tool": "$tool",
    "file": "$file",
    "sessionId": "$session_id",
    "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
)

    # Send to inspector (non-blocking, ignore errors)
    curl -s -X POST "http://127.0.0.1:$port/log" \
        -H "Content-Type: application/json" \
        -d "$json" \
        --connect-timeout 0.2 \
        --max-time 1 \
        2>/dev/null &

    # Don't wait for curl to complete
    disown 2>/dev/null || true
}

# Convenience functions
hook_info() {
    hook_log "info" "$@"
}

hook_warn() {
    hook_log "warn" "$@"
}

hook_error() {
    hook_log "error" "$@"
}

hook_blocked() {
    hook_log "blocked" "$@"
}

# Send structured log with all details
# Args: json_data
hook_log_json() {
    local json_data="$1"
    local port=$(_get_inspector_port)

    [ -z "$port" ] && return 0

    # Add hook name and timestamp if not present
    local enriched=$(echo "$json_data" | jq \
        --arg hook "$HOOK_NAME" \
        --arg ts "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
        '. + {hook: (.hook // $hook), timestamp: (.timestamp // $ts)}')

    curl -s -X POST "http://127.0.0.1:$port/log" \
        -H "Content-Type: application/json" \
        -d "$enriched" \
        --connect-timeout 0.2 \
        --max-time 1 \
        2>/dev/null &

    disown 2>/dev/null || true
}
