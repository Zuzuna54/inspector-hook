#!/bin/bash
# TypeScript type checker for PostToolUse hook
# Runs on TS/TSX file edits
# Non-blocking - provides feedback as context

SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/../lib/common.sh" 2>/dev/null || true

# Read input
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

# Only run for TypeScript files
if [[ "$FILE_PATH" != *.ts && "$FILE_PATH" != *.tsx ]]; then
    exit 0
fi

# Get project directory
CWD=$(dirname "$FILE_PATH" 2>/dev/null)
while [[ "$CWD" != "/" && ! -f "$CWD/tsconfig.json" ]]; do
    CWD=$(dirname "$CWD")
done

if [[ ! -f "$CWD/tsconfig.json" ]]; then
    exit 0
fi

cd "$CWD" 2>/dev/null || exit 0

# Check if tsc is available
if ! command -v tsc &> /dev/null; then
    # Try npx
    if ! command -v npx &> /dev/null; then
        exit 0
    fi
    TSC="npx tsc"
else
    TSC="tsc"
fi

# Run type check with timeout
RESULT=$($TSC --noEmit 2>&1 | head -30)
EXIT_CODE=$?

if [[ $EXIT_CODE -ne 0 ]]; then
    # Type errors found - provide as context (non-blocking)
    ESCAPED=$(echo "$RESULT" | jq -Rs '.')
    echo "{\"additionalContext\": \"TypeScript errors found:\n$RESULT\"}"
fi

# Always exit 0 (non-blocking)
exit 0
