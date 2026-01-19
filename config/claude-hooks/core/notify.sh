#!/bin/bash
# Smart contextual notification hook for Stop event
# Shows project name + modified file

# Read input
INPUT=$(cat)

# Extract session info
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"' 2>/dev/null)
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
STOP_REASON=$(echo "$INPUT" | jq -r '.stop_reason // empty' 2>/dev/null)

# Sound files (macOS)
SOUND_SUCCESS="/System/Library/Sounds/Glass.aiff"
SOUND_BLOCKED="/System/Library/Sounds/Basso.aiff"
SOUND_QUALITY_FAIL="/System/Library/Sounds/Sosumi.aiff"

# Initialize
TITLE="Claude Code"
SUBTITLE=""
MESSAGE=""

# Get project name from cwd
PROJECT_NAME=""
if [[ -n "$CWD" ]]; then
    PROJECT_NAME=$(basename "$CWD" 2>/dev/null)
fi

# Check if blocked
if [[ -n "$STOP_REASON" && "$STOP_REASON" != "null" ]]; then
    SOUND="$SOUND_BLOCKED"
    TITLE="Claude Code"
    SUBTITLE="$PROJECT_NAME - Blocked"
    MESSAGE="$STOP_REASON"
else
    SOUND="$SOUND_SUCCESS"

    # Get last modified file from transcript
    LAST_FILE=""
    if [[ -n "$TRANSCRIPT_PATH" && -f "$TRANSCRIPT_PATH" ]]; then
        # Get the last file that was modified (Write or Edit)
        LAST_FILE=$(grep -oE '"file_path":"[^"]+' "$TRANSCRIPT_PATH" 2>/dev/null | \
            tail -1 | \
            sed 's/"file_path":"//g' | \
            xargs basename 2>/dev/null)
    fi

    # Build subtitle: project + file
    if [[ -n "$PROJECT_NAME" ]]; then
        SUBTITLE="$PROJECT_NAME"
        if [[ -n "$LAST_FILE" ]]; then
            SUBTITLE="$PROJECT_NAME: $LAST_FILE"
        fi
    else
        SUBTITLE="Session complete"
    fi

    # Message with checkmark
    MESSAGE="Task completed ✓"
fi

# Play sound
if [[ -f "$SOUND" ]]; then
    afplay "$SOUND" &
fi

# Show notification
osascript <<EOF
display notification "$MESSAGE" with title "$TITLE" subtitle "$SUBTITLE" sound name "Glass"
EOF

# Log notification
LOG_FILE="$HOME/.claude/logs/notifications.jsonl"
mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null
echo "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"project\":\"$PROJECT_NAME\",\"file\":\"$LAST_FILE\",\"subtitle\":\"$SUBTITLE\",\"message\":\"$MESSAGE\"}" >> "$LOG_FILE"

exit 0
