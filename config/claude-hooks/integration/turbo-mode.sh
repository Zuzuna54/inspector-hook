#!/bin/bash
# Turbo mode toggle for Claude Code hooks
# Usage: turbo-mode.sh enable | disable | status
# When enabled, heavy checks are skipped for rapid iteration

TURBO_FILE="$HOME/.claude/hooks/config/.turbo-enabled"
CONFIG_DIR="$HOME/.claude/hooks/config"

# Ensure config directory exists
mkdir -p "$CONFIG_DIR" 2>/dev/null

# Check command argument
ACTION="${1:-status}"

case "$ACTION" in
    enable|on|1)
        touch "$TURBO_FILE"
        echo "Turbo mode ENABLED"
        echo "Skipping: Full test suite, AI review, heavy linting"
        echo "Keeping: Auto-format, type check, security gate, notifications"
        ;;
    disable|off|0)
        rm -f "$TURBO_FILE"
        echo "Turbo mode DISABLED"
        echo "All quality checks will run"
        ;;
    status|check)
        if [[ -f "$TURBO_FILE" ]]; then
            echo "Turbo mode is ENABLED"
            exit 0
        else
            echo "Turbo mode is DISABLED"
            exit 1
        fi
        ;;
    *)
        echo "Usage: turbo-mode.sh [enable|disable|status]"
        exit 1
        ;;
esac

exit 0
