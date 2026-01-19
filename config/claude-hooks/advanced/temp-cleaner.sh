#!/bin/bash
# SessionEnd hook for cleaning temporary files
# Cleans: *.tmp, *.bak, scratch.*, .DS_Store
# Respects .gitignore patterns

set -e

# Read input
INPUT=$(cat)

# Extract CWD
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)

if [[ -z "$CWD" ]] || [[ ! -d "$CWD" ]]; then
    exit 0
fi

cd "$CWD"

# Track what we cleaned
CLEANED=0

# Clean .DS_Store files (macOS)
find . -name ".DS_Store" -type f -delete 2>/dev/null && CLEANED=$((CLEANED + 1)) || true

# Clean common temp files (only in project, not subdirs with node_modules)
for pattern in "*.tmp" "*.bak" "scratch.*" "*.swp" "*~"; do
    # Only clean in current directory and immediate subdirs
    find . -maxdepth 2 -name "$pattern" -type f \
        ! -path "*/node_modules/*" \
        ! -path "*/.git/*" \
        ! -path "*/venv/*" \
        ! -path "*/.venv/*" \
        ! -path "*/target/*" \
        -delete 2>/dev/null && CLEANED=$((CLEANED + 1)) || true
done

# Clean empty __pycache__ directories
find . -type d -name "__pycache__" -empty -delete 2>/dev/null || true

# Clean empty .pytest_cache directories
find . -type d -name ".pytest_cache" -empty -delete 2>/dev/null || true

# Log if we cleaned something
if [[ $CLEANED -gt 0 ]]; then
    LOG_FILE="$HOME/.claude/logs/cleaner.jsonl"
    mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null
    echo "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"cwd\":\"$CWD\",\"cleaned\":$CLEANED}" >> "$LOG_FILE"
fi

exit 0
