#!/usr/bin/env bash
#
# Inspector Hook — uninstaller.
#
# Delegates to install.sh, which owns both directions so the add and remove
# logic cannot drift apart. The previous pair had exactly that problem: the
# uninstaller filtered carefully by command while the installer replaced the
# whole hooks key.
set -euo pipefail
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/install.sh" --uninstall "$@"
