#!/bin/bash
# Common utilities for Claude Code hooks
# Source this file in other hooks: source "$(dirname "$0")/../lib/common.sh"

# Colors for logging (if terminal supports it)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Log to stderr (visible in debug mode)
log_debug() {
    echo "[DEBUG] $*" >&2
}

log_info() {
    echo "[INFO] $*" >&2
}

log_warn() {
    echo "[WARN] $*" >&2
}

log_error() {
    echo "[ERROR] $*" >&2
}

# Read JSON from stdin and store it
read_input() {
    INPUT=$(cat)
    echo "$INPUT"
}

# Extract field from JSON using jq (if available) or python
json_get() {
    local json="$1"
    local field="$2"

    if command -v jq &> /dev/null; then
        echo "$json" | jq -r "$field // empty"
    elif command -v python3 &> /dev/null; then
        echo "$json" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('${field#.}', ''))"
    else
        echo ""
    fi
}

# Output JSON decision for PreToolUse/PermissionRequest hooks
output_decision() {
    local decision="$1"
    local reason="$2"

    if command -v jq &> /dev/null; then
        jq -n --arg d "$decision" --arg r "$reason" '{decision: $d, reason: $r}'
    else
        echo "{\"decision\": \"$decision\", \"reason\": \"$reason\"}"
    fi
}

# Output with additional context
output_with_context() {
    local context="$1"

    if command -v jq &> /dev/null; then
        jq -n --arg c "$context" '{additionalContext: $c}'
    else
        echo "{\"additionalContext\": \"$context\"}"
    fi
}

# Check if a command exists
command_exists() {
    command -v "$1" &> /dev/null
}

# Get current timestamp
timestamp() {
    date '+%Y-%m-%d %H:%M:%S'
}

# Get ISO timestamp
iso_timestamp() {
    date -u '+%Y-%m-%dT%H:%M:%SZ'
}

# Sanitize a string for JSON
json_escape() {
    local string="$1"
    echo "$string" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\n/\\n/g; s/\r/\\r/g; s/\t/\\t/g'
}

# Log to a file with rotation
log_to_file() {
    local logfile="$1"
    local message="$2"
    local max_lines="${3:-10000}"

    # Create directory if needed
    mkdir -p "$(dirname "$logfile")"

    # Append message
    echo "[$(timestamp)] $message" >> "$logfile"

    # Rotate if too large
    if [ -f "$logfile" ]; then
        local lines=$(wc -l < "$logfile" | tr -d ' ')
        if [ "$lines" -gt "$max_lines" ]; then
            tail -n "$((max_lines / 2))" "$logfile" > "$logfile.tmp"
            mv "$logfile.tmp" "$logfile"
        fi
    fi
}

# Check if running in a git repository
is_git_repo() {
    git rev-parse --git-dir &> /dev/null
}

# Get git branch name
git_branch() {
    git branch --show-current 2>/dev/null || echo "unknown"
}

# Get count of uncommitted changes
git_changes_count() {
    git status --porcelain 2>/dev/null | wc -l | tr -d ' '
}

# ============================================
# Hook Inspector Integration
# ============================================

# Send log to Hook Inspector VSCode extension
# Usage: send_to_hook_inspector "$INPUT" "info|warn|error|blocked" "Custom message (optional)"
send_to_hook_inspector() {
    local input="$1"
    local level="${2:-info}"
    local custom_msg="$3"

    local port_file="/tmp/claude-hooks-inspector.port"
    [[ ! -f "$port_file" ]] && return 0

    local port=$(cat "$port_file")
    [[ -z "$port" ]] && return 0

    # Extract fields from hook input
    local hook_name=$(echo "$input" | jq -r '.hook_event_name // "unknown"' 2>/dev/null)
    local session_id=$(echo "$input" | jq -r '.session_id // "unknown"' 2>/dev/null)
    local tool_name=$(echo "$input" | jq -r '.tool_name // ""' 2>/dev/null)
    local file_path=$(echo "$input" | jq -r '.tool_input.file_path // .tool_input.path // ""' 2>/dev/null)
    local ts=$(iso_timestamp)

    # Build message
    local msg="${custom_msg:-$hook_name}"
    [[ -n "$tool_name" ]] && msg="$msg: $tool_name"

    # Send to Hook Inspector (async)
    local payload=$(jq -n \
        --arg ts "$ts" \
        --arg hook "$hook_name" \
        --arg event "$hook_name" \
        --arg level "$level" \
        --arg session "$session_id" \
        --arg tool "$tool_name" \
        --arg file "$file_path" \
        --arg msg "$msg" \
        '{timestamp: $ts, hook: $hook, event: $event, level: $level, sessionId: $session, tool: $tool, file: $file, message: $msg}')

    curl -s -X POST "http://127.0.0.1:$port/log" \
        -H "Content-Type: application/json" \
        -d "$payload" \
        --connect-timeout 1 \
        --max-time 2 \
        >/dev/null 2>&1 &
}

# Convenience wrappers
log_to_inspector() { send_to_hook_inspector "$@"; }
log_to_inspector_warn() { send_to_hook_inspector "$1" "warn" "$2"; }
log_to_inspector_error() { send_to_hook_inspector "$1" "error" "$2"; }
log_to_inspector_blocked() { send_to_hook_inspector "$1" "blocked" "$2"; }
