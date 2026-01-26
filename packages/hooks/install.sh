#!/bin/bash
#
# Inspector Hook - Installation Script
# Configures Claude Code to use Inspector Hook for event logging
#
# This script:
# 1. Detects Claude Code settings location (~/.claude/settings.json)
# 2. Backs up existing settings
# 3. Adds/updates hooks configuration to point to packages/hooks scripts
#
# Usage:
#   ./install.sh                    # Interactive installation
#   ./install.sh --force            # Overwrite existing hooks
#   ./install.sh --uninstall        # Remove hooks
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory (packages/hooks)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${SCRIPT_DIR}/claude"
PRE_HOOK="${CLAUDE_DIR}/pre-tool-use.sh"
POST_HOOK="${CLAUDE_DIR}/post-tool-use.sh"
SESSION_HOOK="${CLAUDE_DIR}/session-start.sh"
USER_PROMPT_HOOK="${CLAUDE_DIR}/user-prompt-submit.sh"
STOP_HOOK="${CLAUDE_DIR}/stop.sh"
NOTIFICATION_HOOK="${CLAUDE_DIR}/notification.sh"
SUBAGENT_STOP_HOOK="${CLAUDE_DIR}/subagent-stop.sh"

# Claude Code settings location
CLAUDE_SETTINGS_DIR="${HOME}/.claude"
CLAUDE_SETTINGS_FILE="${CLAUDE_SETTINGS_DIR}/settings.json"

# Parse arguments
FORCE=0
UNINSTALL=0

while [[ $# -gt 0 ]]; do
  case $1 in
    --force|-f)
      FORCE=1
      shift
      ;;
    --uninstall|-u)
      UNINSTALL=1
      shift
      ;;
    --help|-h)
      echo "Inspector Hook - Installation Script"
      echo ""
      echo "Usage:"
      echo "  ./install.sh            # Interactive installation"
      echo "  ./install.sh --force    # Overwrite existing hooks"
      echo "  ./install.sh --uninstall # Remove hooks"
      echo ""
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

# Helper functions
info() {
  echo -e "${GREEN}[INFO]${NC} $*"
}

warn() {
  echo -e "${YELLOW}[WARN]${NC} $*"
}

error() {
  echo -e "${RED}[ERROR]${NC} $*"
  exit 1
}

step() {
  echo -e "${BLUE}[STEP]${NC} $*"
}

# Check prerequisites
check_prerequisites() {
  if ! command -v jq &> /dev/null; then
    error "jq is required but not installed. Please install jq first."
  fi

  if [[ ! -f "$PRE_HOOK" ]]; then
    error "Pre-tool-use hook not found at $PRE_HOOK"
  fi

  if [[ ! -f "$POST_HOOK" ]]; then
    error "Post-tool-use hook not found at $POST_HOOK"
  fi

  if [[ ! -f "$SESSION_HOOK" ]]; then
    error "Session-start hook not found at $SESSION_HOOK"
  fi

  if [[ ! -f "$USER_PROMPT_HOOK" ]]; then
    error "User-prompt-submit hook not found at $USER_PROMPT_HOOK"
  fi

  if [[ ! -f "$STOP_HOOK" ]]; then
    error "Stop hook not found at $STOP_HOOK"
  fi

  if [[ ! -f "$NOTIFICATION_HOOK" ]]; then
    error "Notification hook not found at $NOTIFICATION_HOOK"
  fi

  if [[ ! -f "$SUBAGENT_STOP_HOOK" ]]; then
    error "Subagent-stop hook not found at $SUBAGENT_STOP_HOOK"
  fi

  # Make sure hook scripts are executable
  chmod +x "$PRE_HOOK"
  chmod +x "$POST_HOOK"
  chmod +x "$SESSION_HOOK"
  chmod +x "$USER_PROMPT_HOOK"
  chmod +x "$STOP_HOOK"
  chmod +x "$NOTIFICATION_HOOK"
  chmod +x "$SUBAGENT_STOP_HOOK"
  chmod +x "${CLAUDE_DIR}/lib/http-logger.sh" 2>/dev/null || true
  chmod +x "${CLAUDE_DIR}/lib/http_logger.py" 2>/dev/null || true
}

# Create backup of settings
backup_settings() {
  if [[ -f "$CLAUDE_SETTINGS_FILE" ]]; then
    local backup_file="${CLAUDE_SETTINGS_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
    cp "$CLAUDE_SETTINGS_FILE" "$backup_file"
    info "Created backup: $backup_file"
  fi
}

# Create default settings if needed
ensure_settings_file() {
  if [[ ! -d "$CLAUDE_SETTINGS_DIR" ]]; then
    mkdir -p "$CLAUDE_SETTINGS_DIR"
    info "Created Claude settings directory: $CLAUDE_SETTINGS_DIR"
  fi

  if [[ ! -f "$CLAUDE_SETTINGS_FILE" ]]; then
    echo '{}' > "$CLAUDE_SETTINGS_FILE"
    info "Created Claude settings file: $CLAUDE_SETTINGS_FILE"
  fi
}

# Check if hooks are already installed
check_existing_hooks() {
  if [[ -f "$CLAUDE_SETTINGS_FILE" ]]; then
    local existing_hooks=$(jq -r '.hooks // empty' "$CLAUDE_SETTINGS_FILE" 2>/dev/null || echo "")
    if [[ -n "$existing_hooks" && "$existing_hooks" != "null" ]]; then
      if [[ "$FORCE" != "1" ]]; then
        warn "Existing hooks found in settings."
        echo ""
        echo "Current hooks configuration:"
        jq '.hooks' "$CLAUDE_SETTINGS_FILE"
        echo ""
        read -p "Do you want to overwrite existing hooks? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
          info "Installation cancelled. Use --force to overwrite."
          exit 0
        fi
      fi
    fi
  fi
}

# Install hooks
install_hooks() {
  step "Installing Inspector Hook..."

  check_prerequisites
  ensure_settings_file
  check_existing_hooks
  backup_settings

  # Read current settings
  local current_settings=$(cat "$CLAUDE_SETTINGS_FILE")

  # Create hook configuration pointing to the claude/ scripts
  local hook_config=$(cat <<EOF
{
  "SessionStart": [
    {
      "command": "$SESSION_HOOK",
      "timeout": 5000
    }
  ],
  "UserPromptSubmit": [
    {
      "command": "$USER_PROMPT_HOOK",
      "timeout": 5000
    }
  ],
  "PreToolUse": [
    {
      "command": "$PRE_HOOK",
      "timeout": 5000
    }
  ],
  "PostToolUse": [
    {
      "command": "$POST_HOOK",
      "timeout": 5000
    }
  ],
  "Stop": [
    {
      "command": "$STOP_HOOK",
      "timeout": 5000
    }
  ],
  "Notification": [
    {
      "command": "$NOTIFICATION_HOOK",
      "timeout": 5000
    }
  ],
  "SubagentStop": [
    {
      "command": "$SUBAGENT_STOP_HOOK",
      "timeout": 5000
    }
  ]
}
EOF
)

  # Merge hooks into settings
  local new_settings=$(echo "$current_settings" | jq --argjson hooks "$hook_config" '.hooks = $hooks')

  # Write updated settings
  echo "$new_settings" | jq '.' > "$CLAUDE_SETTINGS_FILE"

  echo ""
  info "Inspector Hook installed successfully!"
  echo ""
  echo "Hook scripts location:"
  echo "  - Session-start:       $SESSION_HOOK"
  echo "  - User-prompt-submit:  $USER_PROMPT_HOOK"
  echo "  - Pre-tool-use:        $PRE_HOOK"
  echo "  - Post-tool-use:       $POST_HOOK"
  echo "  - Stop:                $STOP_HOOK"
  echo "  - Notification:        $NOTIFICATION_HOOK"
  echo "  - Subagent-stop:       $SUBAGENT_STOP_HOOK"
  echo ""
  echo "Settings file: $CLAUDE_SETTINGS_FILE"
  echo ""
  echo "Configuration added for events:"
  echo "  - SessionStart (captures project name, git branch)"
  echo "  - UserPromptSubmit (captures user prompts)"
  echo "  - PreToolUse (captures tool start)"
  echo "  - PostToolUse (captures tool completion)"
  echo "  - Stop (captures AI response completion)"
  echo "  - Notification (captures permission prompts, waiting)"
  echo "  - SubagentStop (captures Task tool completion)"
  echo ""
  info "Restart Claude Code for changes to take effect."
}

# Uninstall hooks
uninstall_hooks() {
  step "Uninstalling Inspector Hook..."

  if [[ ! -f "$CLAUDE_SETTINGS_FILE" ]]; then
    info "No settings file found. Nothing to uninstall."
    exit 0
  fi

  backup_settings

  # Remove hook entries that reference our hooks
  local current_settings=$(cat "$CLAUDE_SETTINGS_FILE")

  # Remove our hooks while preserving others
  local new_settings=$(echo "$current_settings" | jq '
    .hooks |= (
      if . then
        with_entries(
          .value |= map(select(.command | (contains("pre-tool-use.sh") or contains("post-tool-use.sh") or contains("session-start.sh") or contains("user-prompt-submit.sh") or contains("stop.sh") or contains("notification.sh") or contains("subagent-stop.sh")) | not))
        ) |
        with_entries(select(.value | length > 0))
      else
        .
      end
    ) |
    if .hooks == {} then del(.hooks) else . end
  ')

  echo "$new_settings" | jq '.' > "$CLAUDE_SETTINGS_FILE"

  echo ""
  info "Inspector Hook uninstalled successfully!"
  info "Restart Claude Code for changes to take effect."
}

# Main
echo ""
echo "=================================="
echo "  Inspector Hook Installation"
echo "=================================="
echo ""

if [[ "$UNINSTALL" == "1" ]]; then
  uninstall_hooks
else
  install_hooks
fi
