#!/bin/bash
# Notification hook for when Claude is waiting for user input
# Fires on idle_prompt, permission_prompt, etc.

# Read input
INPUT=$(cat)

# Extract notification type
NOTIFICATION_TYPE=$(echo "$INPUT" | jq -r '.notification_type // "unknown"' 2>/dev/null)
MESSAGE=$(echo "$INPUT" | jq -r '.message // ""' 2>/dev/null)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)

# Get project name
PROJECT_NAME=""
if [[ -n "$CWD" ]]; then
    PROJECT_NAME=$(basename "$CWD" 2>/dev/null)
fi

# Set notification based on type
TITLE="Claude Code"
SUBTITLE=""
BODY=""
SOUND="Purr"

case "$NOTIFICATION_TYPE" in
    "idle_prompt")
        SUBTITLE="$PROJECT_NAME: Waiting"
        BODY="Claude is waiting for your response"
        SOUND="Purr"
        ;;
    "permission_prompt")
        SUBTITLE="$PROJECT_NAME: Permission"
        BODY="Claude needs permission to continue"
        SOUND="Blow"
        ;;
    "elicitation_dialog")
        SUBTITLE="$PROJECT_NAME: Input Needed"
        BODY="Claude needs additional information"
        SOUND="Purr"
        ;;
    *)
        SUBTITLE="$PROJECT_NAME: Attention"
        BODY="${MESSAGE:-Claude needs your attention}"
        ;;
esac

# Show notification
osascript <<EOF
display notification "$BODY" with title "$TITLE" subtitle "$SUBTITLE" sound name "$SOUND"
EOF

# Log
LOG_FILE="$HOME/.claude/logs/notifications.jsonl"
mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null
echo "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"type\":\"$NOTIFICATION_TYPE\",\"subtitle\":\"$SUBTITLE\",\"body\":\"$BODY\"}" >> "$LOG_FILE"

exit 0
