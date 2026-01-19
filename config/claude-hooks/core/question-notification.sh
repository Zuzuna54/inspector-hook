#!/bin/bash
# PreToolUse hook for AskUserQuestion
# Notifies user when Claude is asking a question

# Read input
INPUT=$(cat)

# Extract question info
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)

# Only handle AskUserQuestion
if [[ "$TOOL_NAME" != "AskUserQuestion" ]]; then
    exit 0
fi

# Try to get the question text
QUESTION=$(echo "$INPUT" | jq -r '.tool_input.questions[0].question // "Claude has a question"' 2>/dev/null)

# Get project name
PROJECT_NAME=""
if [[ -n "$CWD" ]]; then
    PROJECT_NAME=$(basename "$CWD" 2>/dev/null)
fi

# Truncate question if too long
QUESTION="${QUESTION:0:80}"

# Show notification
TITLE="Claude Code"
SUBTITLE="$PROJECT_NAME: Question"
BODY="$QUESTION"

osascript <<EOF
display notification "$BODY" with title "$TITLE" subtitle "$SUBTITLE" sound name "Purr"
EOF

# Log
LOG_FILE="$HOME/.claude/logs/notifications.jsonl"
mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null
echo "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"type\":\"question\",\"project\":\"$PROJECT_NAME\",\"question\":\"$QUESTION\"}" >> "$LOG_FILE"

exit 0
