#!/bin/bash
# PostToolUse hook for Python auto-formatting with Ruff
# Triggers: After Write/Edit on *.py files
# Behavior: Auto-fix safe issues, format code, sort imports
# Exit: Always 0 (non-blocking feedback)

set -e

# Read input
INPUT=$(cat)

# Extract file path from tool input
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)

# Exit if no file path
if [[ -z "$FILE_PATH" ]]; then
    exit 0
fi

# Only process Python files
case "$FILE_PATH" in
    *.py)
        ;;
    *)
        exit 0
        ;;
esac

# Skip virtual environments, __pycache__, etc.
if [[ "$FILE_PATH" == *"venv"* ]] || \
   [[ "$FILE_PATH" == *".venv"* ]] || \
   [[ "$FILE_PATH" == *"__pycache__"* ]] || \
   [[ "$FILE_PATH" == *"site-packages"* ]] || \
   [[ "$FILE_PATH" == *".generated."* ]]; then
    exit 0
fi

# Change to project directory if provided
if [[ -n "$CWD" ]]; then
    cd "$CWD" 2>/dev/null || true
fi

# Ruff path (pip user install location)
RUFF_PATH="$HOME/Library/Python/3.9/bin/ruff"

# Check if ruff is available
if [[ -x "$RUFF_PATH" ]]; then
    RUFF_CMD="$RUFF_PATH"
elif command -v ruff &>/dev/null; then
    RUFF_CMD="ruff"
elif command -v python3 &>/dev/null; then
    RUFF_CMD="python3 -m ruff"
else
    exit 0  # Silently skip if no ruff available
fi

# Run ruff check with auto-fix (safe fixes only)
CHECK_OUTPUT=$($RUFF_CMD check --fix "$FILE_PATH" 2>&1) || true

# Run ruff format
FORMAT_OUTPUT=$($RUFF_CMD format "$FILE_PATH" 2>&1) || true

# Combine outputs
OUTPUT="$CHECK_OUTPUT$FORMAT_OUTPUT"

# If there are remaining issues, provide as context
if [[ -n "$OUTPUT" ]] && [[ "$OUTPUT" != *"All checks passed"* ]] && [[ "$OUTPUT" != *"0 errors"* ]]; then
    # Filter out noise, keep only relevant messages
    FILTERED=$(echo "$OUTPUT" | grep -E "(error|warning|E[0-9]+|W[0-9]+)" | head -20)
    if [[ -n "$FILTERED" ]]; then
        # Escape for JSON
        ESCAPED=$(echo "$FILTERED" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo '""')
        echo "{\"additionalContext\": \"Ruff: $ESCAPED\"}"
    fi
fi

exit 0
