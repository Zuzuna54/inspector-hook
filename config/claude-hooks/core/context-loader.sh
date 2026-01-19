#!/bin/bash
# Context loader for SessionStart hook
# User preference: Load TODO.md and SPRINT.md only (no git status)

SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/../lib/common.sh" 2>/dev/null || true

# Read input
INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)

# Use current directory if not provided
if [[ -z "$CWD" || "$CWD" == "null" ]]; then
    CWD=$(pwd)
fi

# Change to working directory
cd "$CWD" 2>/dev/null || exit 0

# Build context string
CONTEXT=""

# Load SPRINT.md if it exists
if [[ -f "SPRINT.md" ]]; then
    SPRINT_CONTENT=$(head -20 SPRINT.md 2>/dev/null)
    if [[ -n "$SPRINT_CONTENT" ]]; then
        CONTEXT+="## Current Sprint\n"
        CONTEXT+="\`\`\`\n$SPRINT_CONTENT\n\`\`\`\n"
        CONTEXT+="\n"
    fi
fi

# Load TODO.md if it exists
if [[ -f "TODO.md" ]]; then
    # Get incomplete items (checkbox items marked with [ ])
    TODO_CONTENT=$(grep -E "^\s*[-*]\s*\[ \]" TODO.md 2>/dev/null | head -10)
    if [[ -n "$TODO_CONTENT" ]]; then
        CONTEXT+="## Open TODOs\n"
        CONTEXT+="\`\`\`\n$TODO_CONTENT\n\`\`\`\n"
        CONTEXT+="\n"
    fi
fi

# Check for README.md existence (user wants doc check)
if [[ ! -f "README.md" ]] && [[ -f "package.json" || -f "Cargo.toml" || -f "pyproject.toml" ]]; then
    CONTEXT+="**Note**: README.md is missing for this project.\n"
    CONTEXT+="\n"
fi

# Check for missing dependencies (prompt to install)
if [[ -f "package.json" ]] && [[ ! -d "node_modules" ]]; then
    if [[ -f "package-lock.json" ]] || [[ -f "yarn.lock" ]] || [[ -f "pnpm-lock.yaml" ]]; then
        CONTEXT+="**Note**: node_modules missing. Run `npm install` to install dependencies.\n"
        CONTEXT+="\n"
    fi
fi

if [[ -f "requirements.txt" ]] && [[ ! -d "venv" ]] && [[ ! -d ".venv" ]]; then
    CONTEXT+="**Note**: Virtual environment not found. Consider running `python -m venv venv && pip install -r requirements.txt`.\n"
    CONTEXT+="\n"
fi

# Output context if we have any
if [[ -n "$CONTEXT" ]]; then
    # Use jq if available for proper JSON escaping
    if command -v jq &> /dev/null; then
        echo -e "$CONTEXT" | jq -Rs '{additionalContext: .}'
    else
        # Fallback: output as plain text
        echo -e "$CONTEXT"
    fi
fi

exit 0
