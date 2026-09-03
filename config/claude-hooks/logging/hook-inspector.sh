#!/bin/bash
# Hook Inspector integration - sends logs to VSCode extension
# Usage: Add to any hook event in settings.json

# Debug logging
# Debug logging is opt-in: this file recorded every prompt and tool payload
# forever, with no rotation, in world-readable /tmp.
DEBUG_LOG="${INSPECTOR_HOOK_DEBUG_LOG:-/dev/null}"
echo "$(date): Hook called" >> "$DEBUG_LOG"

# Get Hook Inspector port.
# INSPECTOR_HOOK_PORT_FILE overrides the default so a scratch/test core can be
# targeted without redirecting the machine's real hooks at it.
PORT_FILE="${INSPECTOR_HOOK_PORT_FILE:-/tmp/inspector-hook.port}"
if [[ ! -f "$PORT_FILE" ]]; then
    echo "$(date): Port file not found at $PORT_FILE" >> "$DEBUG_LOG"
    exit 0  # Extension not running, skip silently
fi

PORT=$(cat "$PORT_FILE")
if [[ -z "$PORT" ]]; then
    echo "$(date): Port is empty" >> "$DEBUG_LOG"
    exit 0
fi

echo "$(date): Port is $PORT" >> "$DEBUG_LOG"

# Read input from stdin
INPUT=$(cat)
echo "$(date): Input: $INPUT" >> "$DEBUG_LOG"

# Extract fields from Claude Code hook input
HOOK_NAME=$(echo "$INPUT" | jq -r '.hook_event_name // "unknown"' 2>/dev/null)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"' 2>/dev/null)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // ""' 2>/dev/null)
# Millisecond resolution. At second resolution most events in a busy session
# share a timestamp (measured: 1024 of 1033 logs had none, with up to 11 events
# in one second), and every sort here is a plain timestamp comparison -- so
# correct feed ordering survived only because the sort happened to be stable.
# GNU date supports %3N; BSD/macOS date does not, so fall back to node.
TIMESTAMP=$(date -u '+%Y-%m-%dT%H:%M:%S.%3NZ' 2>/dev/null)
case "$TIMESTAMP" in
    ''|*%3N*|*N*) TIMESTAMP=$(node -e 'process.stdout.write(new Date().toISOString())' 2>/dev/null) ;;
esac
[ -z "$TIMESTAMP" ] && TIMESTAMP=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

# Extract full tool_input and tool_response for detailed logging
TOOL_INPUT=$(echo "$INPUT" | jq '.tool_input // null' 2>/dev/null)
TOOL_RESPONSE=$(echo "$INPUT" | jq '.tool_response // null' 2>/dev/null)

# Extract additional context fields
WORKING_DIR=$(echo "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // ""' 2>/dev/null)

echo "$(date): Parsed - Hook: $HOOK_NAME, Tool: $TOOL_NAME, Session: $SESSION_ID" >> "$DEBUG_LOG"

# Determine event type based on hook name
EVENT="$HOOK_NAME"

# Derive the level from the payload. This was hardcoded to "info", so the
# Errors / Warnings / Blocked counters could never populate from real traffic
# no matter what actually happened.
LEVEL="info"
TOOL_ERROR=$(echo "$INPUT" | jq -r '.tool_error // ""' 2>/dev/null)
RESPONSE_ERROR=$(echo "$INPUT" | jq -r '
    if (.tool_response | type) == "object" then (.tool_response.error // "") else "" end
' 2>/dev/null)

case "$HOOK_NAME" in
    PostToolUseFailure|StopFailure)
        LEVEL="error"
        ;;
    PermissionDenied)
        LEVEL="blocked"
        ;;
esac

# A tool can also report failure in its own response payload.
if [[ "$LEVEL" == "info" ]] && { [[ -n "$TOOL_ERROR" ]] || [[ -n "$RESPONSE_ERROR" ]]; }; then
    if echo "$TOOL_ERROR$RESPONSE_ERROR" | grep -qiE "blocked|denied|not allowed|permission"; then
        LEVEL="blocked"
    else
        LEVEL="error"
    fi
fi

# Notification carries its own severity.
if [[ "$HOOK_NAME" == "Notification" ]]; then
    case "$(echo "$INPUT" | jq -r '.level // ""' 2>/dev/null)" in
        error) LEVEL="error" ;;
        warn|warning) LEVEL="warn" ;;
    esac
fi

# Extract user prompt for UserPromptSubmit
USER_PROMPT=$(echo "$INPUT" | jq -r '.prompt // ""' 2>/dev/null)

# Extract stop reason for Stop/SubagentStop
STOP_REASON=$(echo "$INPUT" | jq -r '.stop_reason // ""' 2>/dev/null)

# Extract notification info
NOTIFICATION_MSG=$(echo "$INPUT" | jq -r '.message // ""' 2>/dev/null)
NOTIFICATION_TYPE=$(echo "$INPUT" | jq -r '.notification_type // ""' 2>/dev/null)

# Create detailed message based on hook/tool type
if [[ "$HOOK_NAME" == "UserPromptSubmit" ]]; then
    MSG="User prompt submitted"
    EVENT="user.prompt"
elif [[ "$HOOK_NAME" == "Stop" ]]; then
    MSG="Claude finished responding"
    EVENT="ai.response"
elif [[ "$HOOK_NAME" == "SubagentStop" ]]; then
    MSG="Subagent completed"
    EVENT="subagent.stop"
elif [[ "$HOOK_NAME" == "Notification" ]]; then
    MSG="$NOTIFICATION_MSG"
    EVENT="notification"
elif [[ -n "$TOOL_NAME" ]]; then
    case "$TOOL_NAME" in
        "Read")
            MSG="Read: $FILE_PATH"
            ;;
        "Write")
            MSG="Write: $FILE_PATH"
            ;;
        "Edit")
            MSG="Edit: $FILE_PATH"
            ;;
        "Bash")
            CMD=$(echo "$TOOL_INPUT" | jq -r '.command // ""' 2>/dev/null | head -c 100)
            MSG="Bash: $CMD"
            ;;
        "Glob")
            PATTERN=$(echo "$TOOL_INPUT" | jq -r '.pattern // ""' 2>/dev/null)
            MSG="Glob: $PATTERN"
            ;;
        "Grep")
            PATTERN=$(echo "$TOOL_INPUT" | jq -r '.pattern // ""' 2>/dev/null)
            MSG="Grep: $PATTERN"
            ;;
        "Task")
            SUBAGENT=$(echo "$TOOL_INPUT" | jq -r '.subagent_type // ""' 2>/dev/null)
            DESC=$(echo "$TOOL_INPUT" | jq -r '.description // ""' 2>/dev/null)
            MSG="Task ($SUBAGENT): $DESC"
            ;;
        "WebFetch"|"WebSearch")
            URL=$(echo "$TOOL_INPUT" | jq -r '.url // .query // ""' 2>/dev/null)
            MSG="$TOOL_NAME: $URL"
            ;;
        *)
            MSG="$HOOK_NAME: $TOOL_NAME"
            ;;
    esac
else
    MSG="$HOOK_NAME"
fi

# Build the log payload with full details
PAYLOAD=$(echo "$INPUT" | jq \
    --arg ts "$TIMESTAMP" \
    --arg hook "$HOOK_NAME" \
    --arg event "$EVENT" \
    --arg level "$LEVEL" \
    --arg session "$SESSION_ID" \
    --arg tool "$TOOL_NAME" \
    --arg file "$FILE_PATH" \
    --arg msg "$MSG" \
    --arg cwd "$WORKING_DIR" \
    --arg transcript "$TRANSCRIPT_PATH" \
    --arg userPrompt "$USER_PROMPT" \
    --arg stopReason "$STOP_REASON" \
    --arg notificationType "$NOTIFICATION_TYPE" \
    '{
        timestamp: $ts,
        hook: $hook,
        event: $event,
        level: $level,
        sessionId: $session,
        tool: $tool,
        file: $file,
        message: $msg,

        # Claude Code supplies tool_use_id on every PreToolUse/PostToolUse. It is
        # the only reliable way to pair a completion with its start when several
        # calls to the same tool run in parallel; without it the core falls back
        # to matching on tool name and leaves executions stuck "running".
        tool_use_id: .tool_use_id,

        # Groups every event belonging to one user turn.
        prompt_id: .prompt_id,

        details: {
            cwd: $cwd,
            transcriptPath: $transcript,
            prompt: (if $userPrompt != "" then $userPrompt else null end),
            stopReason: (if $stopReason != "" then $stopReason else null end),
            notificationType: (if $notificationType != "" then $notificationType else null end),
            tool_input: .tool_input,
            tool_result: .tool_response,

            # Real measured duration. Hook timestamps are second-resolution, so
            # durations derived from them are always a multiple of 1000ms or 0 --
            # i.e. fiction. This is the actual figure.
            durationMs: .duration_ms,

            # Present on tool events fired inside a subagent, and the basis for
            # an agent tree without needing SubagentStop wired up.
            agentId: .agent_id,
            agentType: .agent_type,

            # Session conditions worth recording alongside the event.
            permissionMode: .permission_mode,
            effort: .effort.level,
            model: .model,

            # Stop carries the assistant text that just finished streaming.
            lastAssistantMessage: .last_assistant_message,

            # The error string carried by PostToolUseFailure.
            toolError: .tool_error
        }
    }' 2>/dev/null)

# Fallback if jq fails with the complex payload
if [[ -z "$PAYLOAD" ]] || [[ "$PAYLOAD" == "null" ]]; then
    PAYLOAD=$(jq -n \
        --arg ts "$TIMESTAMP" \
        --arg hook "$HOOK_NAME" \
        --arg event "$EVENT" \
        --arg level "$LEVEL" \
        --arg session "$SESSION_ID" \
        --arg tool "$TOOL_NAME" \
        --arg file "$FILE_PATH" \
        --arg msg "$MSG" \
        --arg userPrompt "$USER_PROMPT" \
        '{
            timestamp: $ts,
            hook: $hook,
            event: $event,
            level: $level,
            sessionId: $session,
            tool: $tool,
            file: $file,
            message: $msg,
            details: {
                prompt: (if $userPrompt != "" then $userPrompt else null end)
            }
        }')
fi

echo "$(date): Payload: $PAYLOAD" >> "$DEBUG_LOG"

# Send to Hook Inspector (uses /log endpoint per Phase 1 spec)
RESULT=$(curl -s -X POST "http://127.0.0.1:$PORT/log" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" \
    --connect-timeout 1 \
    --max-time 2 2>&1)

echo "$(date): Curl result: $RESULT" >> "$DEBUG_LOG"

exit 0
