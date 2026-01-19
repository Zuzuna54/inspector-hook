#!/bin/bash
# Enhanced commit gate for PreToolUse hook (git commit)
# Features:
#   - Biome check for JS/TS
#   - Ruff check for Python
#   - TypeScript type check
#   - Jest test run
#   - Debug pattern detection (console.log/console.debug only)
#   - Merge conflict check
#   - Auto-fix attempt before blocking

SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/../lib/common.sh" 2>/dev/null || true

# Read input
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

# Only run for git commit commands
if [[ "$COMMAND" != *"git commit"* ]]; then
    echo '{"decision": "approve"}'
    exit 0
fi

CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
if [[ -z "$CWD" || "$CWD" == "null" ]]; then
    CWD=$(pwd)
fi

cd "$CWD" 2>/dev/null || {
    echo '{"decision": "approve"}'
    exit 0
}

ERRORS=""
WARNINGS=""

# Helper: Send notification on failure
notify_failure() {
    local msg="$1"
    osascript -e "display notification \"$msg\" with title \"Claude Code\" subtitle \"Commit Blocked\" sound name \"Sosumi\"" 2>/dev/null &
}

# Get staged files
STAGED_FILES=$(git diff --cached --name-only 2>/dev/null)
if [[ -z "$STAGED_FILES" ]]; then
    echo '{"decision": "approve"}'
    exit 0
fi

# Categorize files
JS_TS_FILES=$(echo "$STAGED_FILES" | grep -E '\.(ts|tsx|js|jsx)$' | grep -v '\.test\.' | grep -v '\.spec\.' || true)
PY_FILES=$(echo "$STAGED_FILES" | grep -E '\.py$' || true)
TEST_FILES=$(echo "$STAGED_FILES" | grep -E '\.(test|spec)\.(ts|tsx|js|jsx)$' || true)

# Check 1: Merge conflict markers
if git diff --cached | grep -qE '^(<<<<<<<|=======|>>>>>>>)'; then
    ERRORS+="Merge conflict markers found in staged files. Resolve conflicts before committing.\n"
fi

# Check 2: Debug patterns (console.log/console.debug only, not in test files)
if [[ -n "$JS_TS_FILES" ]]; then
    for file in $JS_TS_FILES; do
        # Check for console.log or console.debug in non-test files
        if git diff --cached -- "$file" | grep -qE '^\+.*console\.(log|debug)'; then
            ERRORS+="Found console.log/console.debug in $file. Remove before committing.\n"
        fi
    done
fi

# Check 3: Biome check for JS/TS (with auto-fix attempt)
if [[ -n "$JS_TS_FILES" ]]; then
    if command -v biome &>/dev/null; then
        # Try auto-fix first
        for file in $JS_TS_FILES; do
            biome check --write "$file" 2>/dev/null || true
        done

        # Re-stage fixed files
        for file in $JS_TS_FILES; do
            git add "$file" 2>/dev/null || true
        done

        # Check for remaining errors
        BIOME_ERRORS=""
        for file in $JS_TS_FILES; do
            RESULT=$(biome check "$file" 2>&1) || BIOME_ERRORS+="$RESULT\n"
        done

        if [[ -n "$BIOME_ERRORS" ]]; then
            ERRORS+="Biome errors (couldn't auto-fix):\n$BIOME_ERRORS\n"
        fi
    fi
fi

# Check 4: Ruff check for Python (with auto-fix attempt)
RUFF_CMD=""
if [[ -x "$HOME/Library/Python/3.9/bin/ruff" ]]; then
    RUFF_CMD="$HOME/Library/Python/3.9/bin/ruff"
elif command -v ruff &>/dev/null; then
    RUFF_CMD="ruff"
fi

if [[ -n "$PY_FILES" ]] && [[ -n "$RUFF_CMD" ]]; then
    # Try auto-fix first
    for file in $PY_FILES; do
        $RUFF_CMD check --fix "$file" 2>/dev/null || true
        $RUFF_CMD format "$file" 2>/dev/null || true
    done

    # Re-stage fixed files
    for file in $PY_FILES; do
        git add "$file" 2>/dev/null || true
    done

    # Check for remaining errors
    RUFF_ERRORS=""
    for file in $PY_FILES; do
        RESULT=$($RUFF_CMD check "$file" 2>&1) || RUFF_ERRORS+="$RESULT\n"
    done

    if [[ -n "$RUFF_ERRORS" ]] && [[ "$RUFF_ERRORS" != *"All checks passed"* ]]; then
        ERRORS+="Ruff errors (couldn't auto-fix):\n$RUFF_ERRORS\n"
    fi
fi

# Check 5: TypeScript type check
if [[ -f "tsconfig.json" ]]; then
    TSC_CMD=""
    if command -v tsc &>/dev/null; then
        TSC_CMD="tsc"
    elif [[ -f "node_modules/.bin/tsc" ]]; then
        TSC_CMD="./node_modules/.bin/tsc"
    fi

    if [[ -n "$TSC_CMD" ]]; then
        TSC_RESULT=$(timeout 30 $TSC_CMD --noEmit 2>&1)
        TSC_EXIT=$?
        if [[ $TSC_EXIT -ne 0 ]]; then
            # Extract first few errors
            TSC_ERRORS=$(echo "$TSC_RESULT" | grep -E "error TS" | head -5)
            ERRORS+="TypeScript errors:\n$TSC_ERRORS\n"
        fi
    fi
fi

# Check 6: Run Jest tests (user preference: run on commit)
if [[ -f "package.json" ]] && grep -q '"test"' package.json 2>/dev/null; then
    # Only run if there are test files or source files changed
    if [[ -n "$JS_TS_FILES" ]] || [[ -n "$TEST_FILES" ]]; then
        TEST_RESULT=$(timeout 60 npm test -- --passWithNoTests 2>&1)
        TEST_EXIT=$?
        if [[ $TEST_EXIT -ne 0 ]]; then
            # Extract failure summary
            TEST_ERRORS=$(echo "$TEST_RESULT" | grep -E "(FAIL|Error:|✕)" | head -10)
            ERRORS+="Jest tests failed:\n$TEST_ERRORS\n"
        fi
    fi
fi

# Decision
if [[ -n "$ERRORS" ]]; then
    # Send notification
    notify_failure "Quality checks failed"

    # Block the commit
    ESCAPED_ERRORS=$(echo -e "$ERRORS" | head -30 | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))' 2>/dev/null | sed 's/^"//;s/"$//')
    echo "{\"decision\": \"block\", \"reason\": \"Commit blocked:\\n$ESCAPED_ERRORS\"}"
    exit 2
else
    echo '{"decision": "approve"}'
    exit 0
fi
