#!/bin/bash
# Tool usage logger for PostToolUse hook
# Logs all tool invocations for analytics

SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/../lib/common.sh" 2>/dev/null || true

LOG_FILE="$HOME/.claude/logs/tools.jsonl"

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")"

# Read input
INPUT=$(cat)

# Extract fields
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // "unknown"' 2>/dev/null)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"' 2>/dev/null)
TOOL_RESPONSE=$(echo "$INPUT" | jq -r '.tool_response // ""' 2>/dev/null | head -c 500)

# Get timestamp
TIMESTAMP=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

# Create log entry
ENTRY=$(jq -n \
    --arg ts "$TIMESTAMP" \
    --arg tool "$TOOL_NAME" \
    --arg session "$SESSION_ID" \
    --arg response "${TOOL_RESPONSE:0:500}" \
    '{
        timestamp: $ts,
        tool: $tool,
        session_id: $session,
        response_preview: $response
    }')

# Append to log
echo "$ENTRY" >> "$LOG_FILE"

# Send to Hook Inspector if running
PORT_FILE="/tmp/claude-hooks-inspector.port"
if [[ -f "$PORT_FILE" ]]; then
    PORT=$(cat "$PORT_FILE")
    if [[ -n "$PORT" ]]; then
        # Build Hook Inspector payload
        HOOK_NAME=$(echo "$INPUT" | jq -r '.hook_event_name // "PostToolUse"' 2>/dev/null)
        FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // ""' 2>/dev/null)

        HI_PAYLOAD=$(jq -n \
            --arg ts "$TIMESTAMP" \
            --arg hook "$HOOK_NAME" \
            --arg event "$HOOK_NAME" \
            --arg level "info" \
            --arg session "$SESSION_ID" \
            --arg tool "$TOOL_NAME" \
            --arg file "$FILE_PATH" \
            --arg msg "$HOOK_NAME: $TOOL_NAME" \
            '{
                timestamp: $ts,
                hook: $hook,
                event: $event,
                level: $level,
                sessionId: $session,
                tool: $tool,
                file: $file,
                message: $msg
            }')

        curl -s -X POST "http://127.0.0.1:$PORT/log" \
            -H "Content-Type: application/json" \
            -d "$HI_PAYLOAD" \
            --connect-timeout 1 \
            --max-time 2 \
            >/dev/null 2>&1 &
    fi
fi

# Rotate if too large (> 50MB)
if [[ -f "$LOG_FILE" ]]; then
    SIZE=$(stat -f%z "$LOG_FILE" 2>/dev/null || stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)
    if [[ $SIZE -gt 52428800 ]]; then
        tail -n 10000 "$LOG_FILE" > "$LOG_FILE.tmp"
        mv "$LOG_FILE.tmp" "$LOG_FILE"
    fi
fi

exit 0
