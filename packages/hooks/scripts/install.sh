#!/usr/bin/env bash
#
# Inspector Hook - Installation Script
# Configures Claude Code to use Inspector Hook for event logging
#
# This script:
# 1. Locates the Claude Code settings file
# 2. Backs up existing settings
# 3. Adds/updates hook configuration
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
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_SCRIPT="$SCRIPT_DIR/inspector-hook.sh"

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

# Check prerequisites
check_prerequisites() {
  if ! command -v jq &> /dev/null; then
    error "jq is required but not installed. Please install jq first."
  fi

  if [[ ! -f "$HOOK_SCRIPT" ]]; then
    error "Hook script not found at $HOOK_SCRIPT"
  fi

  # Make sure hook script is executable
  chmod +x "$HOOK_SCRIPT"
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
    info "Created Claude settings directory"
  fi

  if [[ ! -f "$CLAUDE_SETTINGS_FILE" ]]; then
    echo '{}' > "$CLAUDE_SETTINGS_FILE"
    info "Created Claude settings file"
  fi
}

# Check if hooks are already installed
check_existing_hooks() {
  if [[ -f "$CLAUDE_SETTINGS_FILE" ]]; then
    local existing_hooks=$(jq -r '.hooks // empty' "$CLAUDE_SETTINGS_FILE" 2>/dev/null || echo "")
    if [[ -n "$existing_hooks" && "$existing_hooks" != "null" ]]; then
      if [[ "$FORCE" != "1" ]]; then
        warn "Existing hooks found in settings. Use --force to overwrite."
        echo ""
        echo "Current hooks configuration:"
        jq '.hooks' "$CLAUDE_SETTINGS_FILE"
        echo ""
        read -p "Do you want to merge with existing hooks? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
          info "Installation cancelled."
          exit 0
        fi
      fi
    fi
  fi
}

# Install hooks
install_hooks() {
  info "Installing Inspector Hook..."

  check_prerequisites
  ensure_settings_file
  check_existing_hooks
  backup_settings

  # Read current settings
  local current_settings=$(cat "$CLAUDE_SETTINGS_FILE")

  # Create hook configuration
  local hook_config=$(cat <<EOF
{
  "PreToolUse": [
    {
      "command": "$HOOK_SCRIPT",
      "timeout": 5000
    }
  ],
  "PostToolUse": [
    {
      "command": "$HOOK_SCRIPT",
      "timeout": 5000
    }
  ],
  "Notification": [
    {
      "command": "$HOOK_SCRIPT",
      "timeout": 5000
    }
  ],
  "Stop": [
    {
      "command": "$HOOK_SCRIPT",
      "timeout": 5000
    }
  ]
}
EOF
)

  # Merge hooks into settings
  local new_settings=$(echo "$current_settings" | jq --argjson hooks "$hook_config" '.hooks = (.hooks // {}) * $hooks')

  # Write updated settings
  echo "$new_settings" | jq '.' > "$CLAUDE_SETTINGS_FILE"

  info "Inspector Hook installed successfully!"
  echo ""
  echo "Hook script location: $HOOK_SCRIPT"
  echo "Settings file: $CLAUDE_SETTINGS_FILE"
  echo ""
  echo "Configuration added for events:"
  echo "  - PreToolUse"
  echo "  - PostToolUse"
  echo "  - Notification"
  echo "  - Stop"
  echo ""
  info "Restart Claude Code for changes to take effect."
}

# Uninstall hooks
uninstall_hooks() {
  info "Uninstalling Inspector Hook..."

  if [[ ! -f "$CLAUDE_SETTINGS_FILE" ]]; then
    info "No settings file found. Nothing to uninstall."
    exit 0
  fi

  backup_settings

  # Remove hook entries that reference inspector-hook.sh
  local current_settings=$(cat "$CLAUDE_SETTINGS_FILE")

  # Remove our hooks while preserving others
  local new_settings=$(echo "$current_settings" | jq '
    .hooks |= (
      if . then
        with_entries(
          .value |= map(select(.command | contains("inspector-hook.sh") | not))
        ) |
        with_entries(select(.value | length > 0))
      else
        .
      end
    ) |
    if .hooks == {} then del(.hooks) else . end
  ')

  echo "$new_settings" | jq '.' > "$CLAUDE_SETTINGS_FILE"

  info "Inspector Hook uninstalled successfully!"
}

# Main
if [[ "$UNINSTALL" == "1" ]]; then
  uninstall_hooks
else
  install_hooks
fi
