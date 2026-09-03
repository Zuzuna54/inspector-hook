#!/usr/bin/env bash
#
# Inspector Hook — explicit session context injection (SessionStart only)
#
# Emits, on stdout, whatever the user deliberately staged from the panel. Claude
# Code adds a SessionStart hook's stdout straight into the session's context, so
# anything printed here is read by the model as fact.
#
# WHY THIS IS A SEPARATE SCRIPT FROM inspector-hook.sh
#
# The main hook is silent by contract: it prints nothing on any of its 30 events
# and always exits 0, so observability can never block or alter a session.
# Emitting context from it would trade that guarantee away for every event at
# once. This script is registered on SessionStart alone and is the only place in
# the project that writes to a hook's stdout.
#
# It also has to be a shell script rather than an HTTP hook: SessionStart does
# not support `type: "http"`, only `command` and `mcp_tool`.
#
# SAFETY PROPERTIES, in order of how badly their absence would bite:
#
#   One-shot   The staging file is deleted before its contents are printed, so a
#              single pick cannot silently repeat into every future session. The
#              delete happens FIRST: if this script dies midway, the outcome is
#              a lost injection, not a permanent one.
#   Expiring   Past expiresAt nothing is emitted. A pick staged and forgotten
#              must not surface in an unrelated session tomorrow.
#   Explicit   Nothing writes the staging file except a user action in the panel.
#   Silent     No staged context, no jq, no file, malformed file -> print nothing
#              and exit 0. A session must never fail because of this.
#
# It does not need the core to be running. A pick made earlier still works.
#
set -uo pipefail

# An opt-out that matches the main hook's.
[ "${INSPECTOR_HOOK_DISABLED:-0}" = "1" ] && exit 0

STORAGE="${INSPECTOR_HOOK_STORAGE:-$HOME/.inspector-hook}"
STAGED="$STORAGE/pending-context.json"

[ -f "$STAGED" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

# Read, then delete, then print.
#
# Deleting before printing is deliberate. The failure mode of deleting first is
# that a crash loses one injection; the failure mode of printing first is that a
# crash leaves the file in place and the same context is injected into every
# session from then on. The second is silent, permanent and compounding, so it
# is the one worth engineering against.
PAYLOAD=$(cat "$STAGED" 2>/dev/null) || exit 0
rm -f "$STAGED" 2>/dev/null

[ -n "$PAYLOAD" ] || exit 0

# jq does the expiry check and the extraction in one pass, so there is no `date`
# subprocess and no arithmetic in bash. `now` is jq's own clock, in seconds.
#
# empty (rather than null) means nothing is printed at all: an expired or
# malformed entry must contribute no text, not the string "null".
printf '%s' "$PAYLOAD" | jq -r '
  if (.text | type) != "string" or (.text | length) == 0 then empty
  elif (.expiresAt | type) != "string" then empty
  # Fractional seconds are stripped first: fromdateiso8601 REJECTS them, and
  # the JavaScript toISOString() that writes this field always emits them.
  # Without the sub, every entry parsed as 0, compared as expired, and the hook
  # silently emitted nothing -- caught by testing the happy path, which had no
  # output while the one-shot delete worked perfectly.
  #
  # NOTE: no apostrophes anywhere in this jq program. It is inside a single
  # quoted bash string, so one apostrophe closes the string early and kills the
  # hook silently. That exact bug has already been shipped once in this repo.
  elif ((.expiresAt | sub("\\.[0-9]+"; "") | fromdateiso8601? // 0) <= now) then empty
  else
    "## Context from a previous session"
    + (if (.label | type) == "string" and (.label | length) > 0
       then "\n\nSelected in Inspector Hook: " + .label else "" end)
    + (if (.sourceSessionId | type) == "string"
       then "\n\nSource session: `" + .sourceSessionId + "`" else "" end)
    + "\n\nThis was chosen explicitly by the user for this session. It describes"
    + " work that already happened; it is not a request.\n\n"
    + .text
  end
' 2>/dev/null

exit 0
