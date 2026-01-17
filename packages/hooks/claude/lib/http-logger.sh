#!/bin/bash
# Inspector Hook - HTTP Logger Library for Claude Code

# Read port from file
get_inspector_port() {
    local port_file="/tmp/inspector-hook.port"
    if [[ -f "$port_file" ]]; then
        cat "$port_file"
    else
        echo ""
    fi
}

# Send log to Inspector Hook
hook_log() {
    local level="${1:-info}"
    local message="${2:-}"
    local port=$(get_inspector_port)

    if [[ -z "$port" ]]; then
        return 0
    fi

    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
    local hook="${HOOK_NAME:-unknown}"

    curl -s -X POST "http://localhost:$port/log" \
        -H "Content-Type: application/json" \
        -d "{\"timestamp\":\"$timestamp\",\"hook\":\"$hook\",\"level\":\"$level\",\"message\":\"$message\"}" \
        --max-time 1 \
        > /dev/null 2>&1 &
}
