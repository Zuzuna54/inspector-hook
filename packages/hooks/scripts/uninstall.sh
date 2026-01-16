#!/usr/bin/env bash
#
# Inspector Hook - Uninstallation Script
# Removes Inspector Hook configuration from Claude Code settings
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/install.sh" --uninstall "$@"
