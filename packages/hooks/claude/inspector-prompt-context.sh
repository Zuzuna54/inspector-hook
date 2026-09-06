#!/usr/bin/env bash
#
# Inspector Hook — UserPromptSubmit context injection.
#
# Delivers context into a session that is ALREADY RUNNING. Its sibling,
# inspector-context.sh, seeds a session at SessionStart; this one reaches a
# session mid-flight, on the next prompt the user submits.
#
# ## The shape matters, and it was measured rather than assumed
#
# Claude Code reads:
#
#   {"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"..."}}
#
# A top-level "additionalContext" is parsed and IGNORED. That is not read off
# the docs: both shapes were emitted in one object from a probe hook and only
# the nested one reached the model. Eleven hooks under config/claude-hooks/ emit
# the top-level form and have therefore been injecting nothing.
#
# ## Why this filters on session_id
#
# A hook registered for a project fires for EVERY session in that project. The
# probe proved it: a single staged string arrived in two unrelated sessions at
# once. So targeting cannot be done by registration -- this script reads
# session_id from its own stdin payload and delivers only what was armed for
# that session. Without the filter, "inject into this session" would silently
# mean "inject into all of them".
#
# ## Two tiers, one rule apart
#
#   now     read -> rm -> print     one-shot, like the SessionStart path
#   pinned  read -> print           persists until unpinned or it expires
#
# The delete-before-print ordering is deliberate and matches
# inspector-context.sh: a crash after the delete loses one injection, whereas
# printing first and crashing would leave the file to fire again in every
# future prompt. The recoverable failure is the right one.
#
# Never fails a prompt. Every path exits 0.

set -uo pipefail

[ "${INSPECTOR_HOOK_DISABLED:-0}" = "1" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0

STORAGE="${INSPECTOR_HOOK_STORAGE:-$HOME/.inspector-hook}"

# Read the payload once. Without stdin there is no session to target.
PAYLOAD="$(cat 2>/dev/null || true)"
[ -n "$PAYLOAD" ] || exit 0

SESSION_ID="$(printf '%s' "$PAYLOAD" | jq -r '.session_id // empty' 2>/dev/null || true)"
[ -n "$SESSION_ID" ] || exit 0

# The id builds a path, and it arrives from outside. Validate rather than
# escape: a real session id is a UUID and has no reason to hold anything else.
case "$SESSION_ID" in
  *[!A-Za-z0-9_-]*) exit 0 ;;
esac

NOW_FILE="$STORAGE/context/now/$SESSION_ID.json"
PINNED_FILE="$STORAGE/context/pinned/$SESSION_ID.json"

# jq expression shared by both tiers. fromdateiso8601 rejects the fractional
# seconds JavaScript's toISOString() always emits, so they are stripped first --
# a bug that already shipped once in the SessionStart hook and silently made it
# inert while its delete still worked.
UNEXPIRED='
  (.expiresAt // "") as $e
  | (($e | sub("\\.[0-9]+"; "")) | strptime("%Y-%m-%dT%H:%M:%SZ") | mktime) as $t
  | if ($t > now) then (.text // "") else "" end
'

emit_section() {
  # $1: file contents
  printf '%s' "$1" | jq -r "$UNEXPIRED" 2>/dev/null || true
}

NOW_TEXT=""
PINNED_TEXT=""

# One-shot: read, delete, then print. If this crashes between the two, one
# injection is lost -- which is recoverable, unlike a payload that repeats.
if [ -r "$NOW_FILE" ]; then
  NOW_PAYLOAD="$(cat "$NOW_FILE" 2>/dev/null || true)"
  rm -f "$NOW_FILE" 2>/dev/null || true
  NOW_TEXT="$(emit_section "$NOW_PAYLOAD")"
fi

# Pinned: read and print. Never deleted here -- it persists until the panel
# unpins it or its expiry passes, and the expiry is mandatory for that reason.
if [ -r "$PINNED_FILE" ]; then
  PINNED_PAYLOAD="$(cat "$PINNED_FILE" 2>/dev/null || true)"
  PINNED_TEXT="$(emit_section "$PINNED_PAYLOAD")"
fi

[ -z "$NOW_TEXT" ] && [ -z "$PINNED_TEXT" ] && exit 0

# Framing is added HERE, not stored, so what the panel previews is the body it
# previewed. Says plainly that this is a record of work already done, because
# injected text arrives as context rather than as content and has nothing to be
# checked against.
BODY=""
[ -n "$PINNED_TEXT" ] && BODY="## Pinned context (Inspector Hook)

$PINNED_TEXT"
if [ -n "$NOW_TEXT" ]; then
  [ -n "$BODY" ] && BODY="$BODY

"
  BODY="$BODY## Context sent to this session (Inspector Hook)

$NOW_TEXT"
fi

BODY="$BODY

This was chosen explicitly by the user for this session. It describes work that
already happened; it is not a request."

jq -n --arg ctx "$BODY" \
  '{hookSpecificOutput: {hookEventName: "UserPromptSubmit", additionalContext: $ctx}}' \
  2>/dev/null || true

exit 0
