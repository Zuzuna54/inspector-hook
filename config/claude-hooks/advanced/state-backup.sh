#!/bin/bash
# State backup for PreCompact hook
# Saves conversation state before context compaction

SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/../lib/common.sh" 2>/dev/null || true

BACKUP_DIR="$HOME/.claude/backups"
MAX_BACKUPS=20

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

# Read input
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"' 2>/dev/null)
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // ""' 2>/dev/null)

# Generate timestamp-based filename
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
BACKUP_FILE="$BACKUP_DIR/backup_${SESSION_ID:0:8}_${TIMESTAMP}.md"

# Create backup content
cat > "$BACKUP_FILE" << EOF
# Session Backup
- **Session ID**: $SESSION_ID
- **Timestamp**: $(date -u '+%Y-%m-%dT%H:%M:%SZ')
- **Backup Reason**: PreCompact (context compaction)

## Working Directory
$(pwd)

## Git Status
$(git status --short 2>/dev/null || echo "Not a git repository")

## Recent Changes
$(git diff --stat HEAD~3..HEAD 2>/dev/null | head -20 || echo "No recent commits")

---

## Transcript Reference
Transcript path: $TRANSCRIPT_PATH

## Notes
This backup was created automatically before context compaction.
Use this to recover context if needed after session ends.

EOF

# Copy transcript if it exists and is accessible
if [[ -f "$TRANSCRIPT_PATH" ]]; then
    echo "" >> "$BACKUP_FILE"
    echo "## Recent Transcript (last 100 lines)" >> "$BACKUP_FILE"
    echo '```json' >> "$BACKUP_FILE"
    tail -100 "$TRANSCRIPT_PATH" >> "$BACKUP_FILE" 2>/dev/null
    echo '```' >> "$BACKUP_FILE"
fi

# Rotate old backups
BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/backup_*.md 2>/dev/null | wc -l | tr -d ' ')
if [[ $BACKUP_COUNT -gt $MAX_BACKUPS ]]; then
    # Remove oldest backups
    ls -1t "$BACKUP_DIR"/backup_*.md | tail -n +$((MAX_BACKUPS + 1)) | xargs rm -f 2>/dev/null
fi

# Output confirmation
echo "{\"additionalContext\": \"State backed up to $BACKUP_FILE before compaction.\"}"

exit 0
