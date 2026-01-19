#!/bin/bash
# PostToolUse hook for Rust quality checks
# Triggers: After Write/Edit on *.rs files
# Behavior: Run rustfmt and clippy
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

# Only process Rust files
case "$FILE_PATH" in
    *.rs)
        ;;
    *)
        exit 0
        ;;
esac

# Skip target directory
if [[ "$FILE_PATH" == *"/target/"* ]]; then
    exit 0
fi

# Change to project directory if provided
if [[ -n "$CWD" ]]; then
    cd "$CWD" 2>/dev/null || true
fi

# Find Cargo.toml to locate project root
CARGO_DIR="$CWD"
while [[ -n "$CARGO_DIR" ]] && [[ ! -f "$CARGO_DIR/Cargo.toml" ]]; do
    CARGO_DIR=$(dirname "$CARGO_DIR")
    if [[ "$CARGO_DIR" == "/" ]]; then
        CARGO_DIR=""
        break
    fi
done

# If no Cargo.toml found, just format the file
if [[ -z "$CARGO_DIR" ]]; then
    # Check if rustfmt is available
    if command -v rustfmt &>/dev/null; then
        rustfmt "$FILE_PATH" 2>/dev/null || true
    fi
    exit 0
fi

cd "$CARGO_DIR"

OUTPUT=""

# Run rustfmt
if command -v cargo &>/dev/null; then
    cargo fmt 2>&1 || true
fi

# Run clippy with auto-fix (if available)
if command -v cargo &>/dev/null; then
    CLIPPY_OUTPUT=$(cargo clippy --fix --allow-dirty --allow-staged 2>&1) || true

    # Filter clippy warnings
    WARNINGS=$(echo "$CLIPPY_OUTPUT" | grep -E "^warning:" | head -10)
    if [[ -n "$WARNINGS" ]]; then
        OUTPUT="$WARNINGS"
    fi
fi

# Run cargo check for type errors
if command -v cargo &>/dev/null; then
    CHECK_OUTPUT=$(cargo check 2>&1) || true

    # Filter errors
    ERRORS=$(echo "$CHECK_OUTPUT" | grep -E "^error" | head -10)
    if [[ -n "$ERRORS" ]]; then
        OUTPUT="$OUTPUT\n$ERRORS"
    fi
fi

# If there are issues, provide as context
if [[ -n "$OUTPUT" ]]; then
    # Escape for JSON
    ESCAPED=$(echo -e "$OUTPUT" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo '""')
    echo "{\"additionalContext\": \"Rust: $ESCAPED\"}"
fi

exit 0
