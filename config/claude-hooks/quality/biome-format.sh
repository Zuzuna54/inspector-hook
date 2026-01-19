#!/bin/bash
# PostToolUse hook for JS/TS/JSON auto-formatting with Biome
# Triggers: After Write/Edit on *.ts, *.tsx, *.js, *.jsx, *.json files
# Behavior: Auto-fix safe issues, format code, sort imports
# Exit: Always 0 (non-blocking feedback)

set -e

# Load HTTP logger
HOOK_NAME="biome-format"
source "$HOME/.claude/hooks/lib/http-logger.sh" 2>/dev/null || true

# Debug logging
LOG_FILE="$HOME/.claude/logs/biome-hook.log"
mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Hook called" >> "$LOG_FILE"

# Read input
INPUT=$(cat)
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Input: $INPUT" >> "$LOG_FILE"

# Extract file path from tool input
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)

# Check turbo mode - still run formatting even in turbo
TURBO_FILE="$HOME/.claude/hooks/config/.turbo-enabled"

# Exit if no file path
if [[ -z "$FILE_PATH" ]]; then
    exit 0
fi

# Only process JS/TS/JSON files
case "$FILE_PATH" in
    *.ts|*.tsx|*.js|*.jsx|*.json)
        ;;
    *)
        exit 0
        ;;
esac

# Skip node_modules, dist, build directories
if [[ "$FILE_PATH" == *"node_modules"* ]] || \
   [[ "$FILE_PATH" == *"/dist/"* ]] || \
   [[ "$FILE_PATH" == *"/build/"* ]] || \
   [[ "$FILE_PATH" == *".generated."* ]]; then
    exit 0
fi

# Find biome.json by walking up from file's directory
FILE_DIR=$(dirname "$FILE_PATH")
PROJECT_DIR=""
SEARCH_DIR="$FILE_DIR"
while [[ "$SEARCH_DIR" != "/" ]]; do
    if [[ -f "$SEARCH_DIR/biome.json" ]] || [[ -f "$SEARCH_DIR/biome.jsonc" ]]; then
        PROJECT_DIR="$SEARCH_DIR"
        break
    fi
    SEARCH_DIR=$(dirname "$SEARCH_DIR")
done

# If no biome.json found, skip
if [[ -z "$PROJECT_DIR" ]]; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] No biome.json found for $FILE_PATH" >> "$LOG_FILE"
    exit 0
fi

# Change to project directory
cd "$PROJECT_DIR" 2>/dev/null || exit 0
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Running biome in $PROJECT_DIR for $FILE_PATH" >> "$LOG_FILE"

# Check if biome is available
if ! command -v biome &>/dev/null; then
    # Try npx as fallback
    if command -v npx &>/dev/null && [[ -f "package.json" ]]; then
        BIOME_CMD="npx biome"
    else
        exit 0  # Silently skip if no biome available
    fi
else
    BIOME_CMD="biome"
fi

# Run biome check with auto-fix on the specific file
# --write: Apply safe fixes
# --unsafe: Skip unsafe fixes (user preference: safe fixes only)
OUTPUT=$($BIOME_CMD check --write "$FILE_PATH" 2>&1) || true

# Log to Hook Inspector
hook_log "info" "Formatted $FILE_PATH" "PostToolUse" "Write" "$FILE_PATH"

# If there are remaining issues, provide as context
if [[ -n "$OUTPUT" ]] && [[ "$OUTPUT" != *"No fixes needed"* ]] && [[ "$OUTPUT" != *"Checked"* ]]; then
    # Filter out noise, keep only relevant messages
    FILTERED=$(echo "$OUTPUT" | grep -v "^$" | head -20)
    if [[ -n "$FILTERED" ]]; then
        # Log warning
        hook_log "warn" "Biome issues in $FILE_PATH" "PostToolUse" "Write" "$FILE_PATH"
        # Escape for JSON
        ESCAPED=$(echo "$FILTERED" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo '""')
        echo "{\"additionalContext\": \"Biome: $ESCAPED\"}"
    fi
fi

exit 0
