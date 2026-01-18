#!/bin/bash
# Session start hook for Claude Code
# Captures session metadata including project name, git branch, and working directory

HOOK_NAME="SessionStart"
SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/lib/http-logger.sh"

# Read the full hook input from stdin
input=$(cat)

# Extract fields using jq
session=$(echo "$input" | jq -r '.session_id // "unknown"')
cwd=$(echo "$input" | jq -r '.cwd // ""')

# Extract project name from directory or package.json
projectName=""
gitBranch=""
gitRemote=""

if [ -n "$cwd" ] && [ -d "$cwd" ]; then
  # Try to get project name from package.json
  if [ -f "$cwd/package.json" ]; then
    projectName=$(cat "$cwd/package.json" 2>/dev/null | jq -r '.name // ""' 2>/dev/null)
  fi

  # Try to get git branch and remote
  if [ -d "$cwd/.git" ] || git -C "$cwd" rev-parse --git-dir > /dev/null 2>&1; then
    gitBranch=$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
    gitRemote=$(git -C "$cwd" config --get remote.origin.url 2>/dev/null | sed 's/.*[\/\\]//' | sed 's/\.git$//' || echo "")
  fi

  # Fallback: use directory name as project name
  if [ -z "$projectName" ]; then
    projectName=$(basename "$cwd")
  fi
fi

# Build the payload with session metadata
payload=$(jq -n \
  --arg hook "SessionStart" \
  --arg event "session.start" \
  --arg sessionId "$session" \
  --arg cwd "$cwd" \
  --arg projectName "$projectName" \
  --arg gitBranch "$gitBranch" \
  --arg gitRemote "$gitRemote" \
  --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg level "info" \
  --arg message "Session started: $projectName" \
  '{
    hook: $hook,
    event: $event,
    sessionId: $sessionId,
    timestamp: $timestamp,
    level: $level,
    message: $message,
    details: {
      cwd: $cwd,
      projectName: $projectName,
      gitBranch: $gitBranch,
      gitRemote: $gitRemote
    }
  }')

# Send to Inspector Hook server
port=$(get_inspector_port)
if [ -n "$port" ]; then
  curl -s -X POST "http://localhost:$port/log" \
    -H "Content-Type: application/json" \
    -d "$payload" \
    --max-time 1 > /dev/null 2>&1 &
fi

exit 0
