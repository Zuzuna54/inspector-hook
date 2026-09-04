#!/usr/bin/env bash
#
# Inspector Hook — installer.
#
# Registers the single canonical hook script against every Claude Code event
# Inspector Hook can make use of, in ~/.claude/settings.json.
#
# WHAT THIS REPLACES, AND WHY IT MATTERS
# --------------------------------------
# The previous installers were broken in three independent ways:
#
#  1. They wrote the LEGACY FLAT SCHEMA — `{"command": "...", "timeout": N}` —
#     while Claude Code requires the nested form
#     `{"matcher": "...", "hooks": [{"type": "command", "command": "..."}]}`.
#     Installed hooks would simply never fire.
#
#  2. They did `jq '.hooks = $hooks'` — a DESTRUCTIVE FULL REPLACE of the
#     entire hooks key. Any co-installed tool's hooks were silently deleted.
#     That is not hypothetical: Forge registers a commit gate and a stop gate,
#     and a reinstall here would have removed both with no warning.
#
#  3. The script they registered read `CLAUDE_HOOK_NAME` / `CLAUDE_SESSION_ID`
#     from the environment, which Claude Code does not set — it passes
#     everything as JSON on stdin. Every event arrived as hook "unknown" with
#     no session, tool or file attribution.
#
# This installer merges per-event and per-command: it adds only what is missing,
# leaves every other tool's hooks untouched, and is safe to run repeatedly.
#
# Usage:
#   ./install.sh              install or update
#   ./install.sh --dry-run    show the resulting settings without writing
#   ./install.sh --uninstall  remove only Inspector Hook's entries
#   ./install.sh --settings <path>   target a different settings file

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[info]${NC} $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC} $*"; }
fail()  { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_SCRIPT="$(cd "$SCRIPT_DIR/../claude" && pwd)/inspector-hook.sh"

# The context picker, registered on SessionStart ONLY.
#
# It is separate because inspector-hook.sh is silent by contract on all 30 of
# its events, and emitting context from it would trade that guarantee away
# everywhere at once. This one writes to stdout, which Claude Code adds straight
# into the session context -- and it emits nothing at all unless the user has
# explicitly staged something in the panel, so installing it is inert until used.
CONTEXT_SCRIPT="$(cd "$SCRIPT_DIR/../claude" && pwd)/inspector-context.sh"
SETTINGS="${HOME}/.claude/settings.json"
DRY_RUN=0
UNINSTALL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --uninstall|-u) UNINSTALL=1; shift ;;
    --settings) SETTINGS="$2"; shift 2 ;;
    -h|--help) sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fail "unknown option: $1" ;;
  esac
done

command -v jq >/dev/null 2>&1 || fail "jq is required but not installed"

# Events Inspector Hook consumes.
#
# NOT all 33, and the exclusions below are load-bearing. A previous change added
# MessageDisplay and the Elicitation pair to this array without reading the
# reasoning three lines down; the comment predicted a flood and the array won
# silently. Measured before the revert: 163 MessageDisplay events, every one
# with tool "", file "" and every detail null except cwd and transcriptPath --
# contentless rows that still passed the generic filter and rendered as feed
# items -- their only payload is `backgroundTasks: 0`, an identical literal zero
# in all 313 of them. A test now pins the excluded set, so the comment and the
# array cannot disagree silently again.
#
# Deliberately not all 33: MessageDisplay fires per streamed text chunk and
# would flood the store, and the Elicitation pair adds nothing a dashboard
# shows. Everything else the core can attribute is registered — including
# PostToolUseFailure and StopFailure, which the core already handles but which
# no installer had ever registered, leaving that handling dead in production.
EVENTS=(
  SessionStart SessionEnd
  UserPromptSubmit UserPromptExpansion
  PreToolUse PostToolUse PostToolUseFailure PostToolBatch
  PermissionRequest PermissionDenied
  SubagentStart SubagentStop
  TaskCreated TaskCompleted TeammateIdle
  Stop StopFailure
  Notification
  PreCompact PostCompact
  InstructionsLoaded ConfigChange CwdChanged DirectoryAdded FileChanged
  WorktreeCreate WorktreeRemove
  PreModelSwitch PostModelSwitch
  Setup
)

# Events that accept a matcher. For the tool events we want everything, so "*".
# Events with no matcher support must omit the key entirely rather than send an
# empty one.
matcher_for() {
  case "$1" in
    PreToolUse|PostToolUse|PostToolUseFailure|PermissionRequest|PermissionDenied) echo '"*"' ;;
    *) echo 'null' ;;
  esac
}

ensure_settings() {
  mkdir -p "$(dirname "$SETTINGS")"
  [[ -f "$SETTINGS" ]] || echo '{}' > "$SETTINGS"
  jq empty "$SETTINGS" 2>/dev/null || fail "$SETTINGS is not valid JSON — refusing to touch it"
}

backup() {
  local b="${SETTINGS}.backup.$(date +%Y%m%d-%H%M%S)"
  cp -p "$SETTINGS" "$b"
  info "backup: $b"
}

# Build the new settings by MERGING, never replacing.
#
# For each event: if a hook entry with our command already exists, leave it
# alone. Otherwise append a group carrying only our command. Other tools'
# groups and commands in the same event are preserved untouched.
# Remove registrations of EARLIER Inspector Hook scripts.
#
# The project shipped three implementations under two filenames
# (hook-inspector.sh and inspector-hook.sh, in several locations). Anyone
# upgrading has one of the old paths registered, and since the installer only
# recognises its own exact command, the stale entry would survive and both
# scripts would fire — double-capturing every overlapping event.
#
# Matched on filename rather than full path, because the old copies were
# installed to whatever location the user happened to use.
strip_legacy() {
  jq --arg cmd "$HOOK_SCRIPT" '
    if .hooks == null then .
    else
      .hooks |= with_entries(
        .value |= (
          map(.hooks |= (map(select(
            # keep anything that is not one of our historical scripts,
            # and keep our current one
            (.command == $cmd)
            or ((.command | test("(hook-inspector|inspector-hook)\\.sh$")) | not)
          ))))
          | map(select((.hooks // []) | length > 0))
        )
      )
      | .hooks |= with_entries(select((.value | length) > 0))
    end
  '
}

# Register one command for one event, additively and idempotently.
#
# Extracted so the context hook can be registered for a single event without
# duplicating the merge, which is the part that must never regress: it appends
# to .hooks[event] rather than replacing it, so a co-installed tool keeps its
# own entries.
register_one() {
  local json="$1" event="$2" cmd="$3"
  local m; m="$(matcher_for "$event")"
  printf '%s' "$json" | jq \
    --arg ev "$event" \
    --arg cmd "$cmd" \
    --argjson matcher "$m" '
      # Our command already registered for this event? Then nothing to do.
      if ((.hooks[$ev] // []) | map(.hooks // [] | map(.command)) | flatten | any(. == $cmd))
      then .
      else
        .hooks //= {}
        | .hooks[$ev] //= []
        | .hooks[$ev] += [
            ( { hooks: [ { type: "command", command: $cmd } ] }
              + (if $matcher == null then {} else { matcher: $matcher } end) )
          ]
      end
    '
}

build_install() {
  local json; json="$(cat "$SETTINGS" | strip_legacy)"
  for event in "${EVENTS[@]}"; do
    json="$(register_one "$json" "$event" "$HOOK_SCRIPT")"
  done
  # SessionStart only, and last, so it runs after the observer is registered.
  json="$(register_one "$json" "SessionStart" "$CONTEXT_SCRIPT")"
  printf '%s' "$json"
}

# Remove only entries whose command is ours, then drop any group or event that
# is left empty. Everything belonging to another tool survives.
build_uninstall() {
  jq --argjson cmds "[\"$HOOK_SCRIPT\", \"$CONTEXT_SCRIPT\"]" '
    if .hooks == null then .
    else
      .hooks |= with_entries(
        .value |= (
          # Exact equality, via index. `inside`/`contains` do SUBSTRING matching on
          # strings, so ["/h/a.sh"] | inside(["/h/a.sh.disabled"]) is true -- which
          # would delete another tool’s hook for merely containing our path.
          map(.hooks |= (map(select(.command as $c | ($cmds | index($c)) == null))))
          | map(select((.hooks // []) | length > 0))
        )
      )
      | .hooks |= with_entries(select((.value | length) > 0))
      | if (.hooks | length) == 0 then del(.hooks) else . end
    end
  ' "$SETTINGS"
}

report() {
  local json="$1"
  local n; n="$(printf '%s' "$json" | jq --arg cmd "$HOOK_SCRIPT" '
    [.hooks // {} | to_entries[] | select(
      (.value | map(.hooks // [] | map(.command)) | flatten | any(. == $cmd))
    )] | length')"
  local others; others="$(printf '%s' "$json" | jq --arg cmd "$HOOK_SCRIPT" '
    [.hooks // {} | to_entries[] | .value[] | .hooks // [] | .[] | select(.command != $cmd)] | length')"
  echo "  Inspector Hook registered on : $n events"
  echo "  other tools' hooks preserved : $others"
}

[[ -f "$HOOK_SCRIPT" ]] || fail "hook script not found at $HOOK_SCRIPT"
chmod +x "$HOOK_SCRIPT"
ensure_settings

if [[ "$UNINSTALL" == "1" ]]; then
  RESULT="$(build_uninstall)"
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '%s\n' "$RESULT" | jq .
    exit 0
  fi
  backup
  printf '%s\n' "$RESULT" | jq . > "$SETTINGS"
  info "uninstalled"
  report "$RESULT"
  exit 0
fi

LEGACY=$(jq -r --arg cmd "$HOOK_SCRIPT" '
  [.hooks // {} | to_entries[] | .value[] | .hooks // [] | .[]
   | select((.command != $cmd) and (.command | test("(hook-inspector|inspector-hook)\\.sh$")))
   | .command] | unique | .[]' "$SETTINGS" 2>/dev/null || true)
if [[ -n "$LEGACY" ]]; then
  warn "removing registrations of earlier Inspector Hook scripts:"
  printf '  %s\n' $LEGACY
fi

RESULT="$(build_install)"
if [[ "$DRY_RUN" == "1" ]]; then
  printf '%s\n' "$RESULT" | jq .
  exit 0
fi

backup
printf '%s\n' "$RESULT" | jq . > "$SETTINGS"
info "installed: $HOOK_SCRIPT"
report "$RESULT"
echo ""
info "Restart Claude Code for settings changes to take effect."
