#!/bin/bash
# PreToolUse hook for AI-powered code review on commit
# Triggers: Before git commit (after commit-gate)
# Behavior: Reviews staged changes for intent, security, style
# Exit: Always 0 (non-blocking, provides feedback as context)

set -e

# Read input
INPUT=$(cat)

# Check turbo mode - skip if enabled
TURBO_FILE="$HOME/.claude/hooks/config/.turbo-enabled"
if [[ -f "$TURBO_FILE" ]]; then
    exit 0
fi

# Extract command
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)

# Only run for git commit commands
if [[ "$COMMAND" != git\ commit* ]]; then
    exit 0
fi

# Change to project directory
if [[ -n "$CWD" ]]; then
    cd "$CWD" 2>/dev/null || exit 0
fi

# Check if we have staged changes
STAGED=$(git diff --cached --name-only 2>/dev/null)
if [[ -z "$STAGED" ]]; then
    exit 0
fi

# Get the diff for review
DIFF=$(git diff --cached --no-color 2>/dev/null | head -500)
if [[ -z "$DIFF" ]]; then
    exit 0
fi

# Perform lightweight static analysis (not AI, just pattern matching for now)
# Real AI review would require calling Claude API which would be recursive
ISSUES=()

# Check for potential security issues
if echo "$DIFF" | grep -qE "(password|secret|api.?key|token)\s*[:=]"; then
    ISSUES+=("Potential hardcoded secret detected")
fi

# Check for common anti-patterns
if echo "$DIFF" | grep -qE "eval\(|dangerouslySetInnerHTML|innerHTML\s*="; then
    ISSUES+=("Potentially unsafe code pattern detected")
fi

# Check for TODO/FIXME in new code (just warn)
if echo "$DIFF" | grep -qE "^\+.*TODO|^\+.*FIXME|^\+.*XXX"; then
    ISSUES+=("New TODO/FIXME comments added")
fi

# Check for large functions (crude heuristic)
LARGE_ADDITIONS=$(echo "$DIFF" | grep -c "^\+" 2>/dev/null || echo "0")
if [[ "$LARGE_ADDITIONS" -gt 200 ]]; then
    ISSUES+=("Large commit ($LARGE_ADDITIONS lines added) - consider breaking up")
fi

# Output issues as context
if [[ ${#ISSUES[@]} -gt 0 ]]; then
    ISSUE_TEXT=$(printf "%s\n" "${ISSUES[@]}")
    ESCAPED=$(echo "$ISSUE_TEXT" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo '""')
    echo "{\"additionalContext\": \"Code Review Notes:\\n$ESCAPED\"}"
fi

exit 0
