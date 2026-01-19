#!/bin/bash
# Test guard for Stop hook
# Ensures tests pass before Claude considers task complete
# Non-blocking by default (provides feedback but doesn't stop)

SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/../lib/common.sh" 2>/dev/null || true

# Read input
INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)

# Use CLAUDE_PROJECT_DIR if available, otherwise cwd
if [[ -n "$CLAUDE_PROJECT_DIR" ]]; then
    CWD="$CLAUDE_PROJECT_DIR"
elif [[ -z "$CWD" || "$CWD" == "null" ]]; then
    CWD=$(pwd)
fi

cd "$CWD" 2>/dev/null || exit 0

# Detect test framework and run tests
run_tests() {
    local result=""
    local exit_code=0

    # Node.js projects
    if [[ -f "package.json" ]]; then
        if grep -q '"test"' package.json 2>/dev/null; then
            # Check for common test runners
            if [[ -f "vitest.config.ts" ]] || [[ -f "vitest.config.js" ]]; then
                result=$(npm run test -- --run 2>&1 | tail -20)
                exit_code=${PIPESTATUS[0]}
            elif grep -q '"jest"' package.json 2>/dev/null || [[ -f "jest.config.js" ]]; then
                result=$(npm test -- --passWithNoTests 2>&1 | tail -20)
                exit_code=${PIPESTATUS[0]}
            else
                # Generic npm test
                result=$(timeout 30 npm test 2>&1 | tail -20)
                exit_code=${PIPESTATUS[0]}
            fi

            if [[ $exit_code -eq 0 ]]; then
                echo "approve"
                return 0
            else
                echo "$result"
                return 1
            fi
        fi
    fi

    # Python projects
    if [[ -f "pytest.ini" ]] || [[ -f "setup.py" ]] || [[ -f "pyproject.toml" ]]; then
        if command -v pytest &> /dev/null; then
            result=$(timeout 30 pytest --tb=short 2>&1 | tail -20)
            exit_code=$?
            if [[ $exit_code -eq 0 ]]; then
                echo "approve"
                return 0
            else
                echo "$result"
                return 1
            fi
        fi
    fi

    # Go projects
    if [[ -f "go.mod" ]]; then
        result=$(timeout 30 go test ./... 2>&1 | tail -20)
        exit_code=$?
        if [[ $exit_code -eq 0 ]]; then
            echo "approve"
            return 0
        else
            echo "$result"
            return 1
        fi
    fi

    # Rust projects
    if [[ -f "Cargo.toml" ]]; then
        result=$(timeout 60 cargo test 2>&1 | tail -20)
        exit_code=$?
        if [[ $exit_code -eq 0 ]]; then
            echo "approve"
            return 0
        else
            echo "$result"
            return 1
        fi
    fi

    # No test framework detected
    echo "approve"
    return 0
}

# Run tests and capture output
TEST_OUTPUT=$(run_tests)
TEST_EXIT=$?

if [[ $TEST_EXIT -eq 0 ]]; then
    # Tests passed or no tests found
    echo '{"decision": "approve"}'
    exit 0
else
    # Tests failed - provide feedback but don't block (change to exit 2 to block)
    # Escape the output for JSON
    ESCAPED_OUTPUT=$(echo "$TEST_OUTPUT" | head -10 | jq -Rs '.' | sed 's/^"//;s/"$//')
    echo "{\"decision\": \"approve\", \"reason\": \"Tests failed (non-blocking):\n$ESCAPED_OUTPUT\"}"
    exit 0  # Change to exit 2 to make this blocking
fi
