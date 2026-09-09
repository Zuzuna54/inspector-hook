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
INJECTIONS="$STORAGE/context/injections.jsonl"

# Which session are we feeding?
#
# This hook injected for a long time without ever asking. It did not need to --
# the payload is global and the delivery is one-shot -- but it means nothing
# could answer "what was injected into THIS session", because the only field
# available was `sourceSessionId`, which records where the text came FROM.
#
# Read best-effort: no session id still injects, it just records nothing. The
# TTY guard matters because `cat` on a terminal blocks forever, and a hook that
# hangs at SessionStart hangs the session.
# NEVER a bare `cat`. This hook ran for its whole life without reading stdin,
# and adding an unguarded read made it hang forever whenever stdin was an open
# pipe with no data and no EOF -- which is not hypothetical: it hung this
# repo's own test suite for minutes on the first run. A `[ -t 0 ]` check does
# not save it, because an open pipe is not a terminal.
#
# `read -t` bounds the wait. -d "" reads to EOF rather than to a newline, so a
# multi-line payload arrives whole; on timeout it returns non-zero and leaves
# whatever arrived in the variable, which is why the result is used regardless
# of the exit status.
#
# The timeout is an INTEGER. macOS ships bash 3.2, which rejects a fractional
# one outright -- `read: 0.5: invalid timeout specification` -- so `-t 0.5`
# failed instantly, read nothing, and silently disabled the recording while
# looking like it worked. It is a ceiling reached only when stdin never closes;
# a writer that closes its end returns in milliseconds.
SESSION_ID=""
STDIN_PAYLOAD=""
if [ ! -t 0 ]; then
  IFS= read -r -d '' -t 1 STDIN_PAYLOAD 2>/dev/null || true
  if [ -n "$STDIN_PAYLOAD" ] && command -v jq >/dev/null 2>&1; then
    SESSION_ID="$(printf '%s' "$STDIN_PAYLOAD" | jq -r '.session_id // empty' 2>/dev/null || true)"
    # The id builds no path here, but it is written into a record that is read
    # back and matched against session ids, so it is validated the same way.
    case "$SESSION_ID" in
      *[!A-Za-z0-9_-]*) SESSION_ID="" ;;
    esac
  fi
fi

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
# Captured rather than piped straight to stdout, so the delivered size can be
# recorded. What is printed is byte-identical to what the pipe produced.
OUTPUT=$(printf '%s' "$PAYLOAD" | jq -r '
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
' 2>/dev/null)

[ -n "$OUTPUT" ] || exit 0
printf '%s\n' "$OUTPUT"

# Record the DELIVERY. Best-effort and always after the text has been printed:
# a session must never fail, or lose its context, because bookkeeping did.
if [ -n "$SESSION_ID" ] && command -v jq >/dev/null 2>&1; then
  mkdir -p "$STORAGE/context" 2>/dev/null || true
  jq -cn \
    --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg sessionId "$SESSION_ID" \
    --arg tier "next-session" \
    --argjson bytes "${#OUTPUT}" \
    --arg label "$(printf '%s' "$PAYLOAD" | jq -r '.label // ""' 2>/dev/null || true)" \
    '{at:$at, sessionId:$sessionId, tier:$tier, bytes:$bytes}
     + (if ($label | length) > 0 then {label:$label} else {} end)' \
    >> "$INJECTIONS" 2>/dev/null || true
fi

exit 0
