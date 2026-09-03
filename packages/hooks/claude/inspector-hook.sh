#!/bin/bash
#
# Inspector Hook — the single canonical hook script.
#
# One script for every Claude Code hook event. It reads the event JSON on stdin,
# transforms it into an Inspector Hook log entry, and POSTs it to the local core.
#
# WHY ONE SCRIPT, AND WHY ONE jq
# ------------------------------
# This replaces three divergent implementations (a per-event script tree, a
# broken generic script that read env vars Claude Code never sets, and a
# hand-maintained copy under config/). It also replaces a version that invoked
# jq 26 times and date 10 times per event: measured at 357ms per invocation
# against a documented <50ms budget, which is ~700ms added to EVERY tool call
# once you count PreToolUse and PostToolUse. Process spawns were ~11ms each and
# dominated everything.
#
# So: exactly one jq invocation, zero date invocations (jq computes the
# timestamp), and one curl. All field extraction, level derivation and message
# formatting happen inside the single jq program below.
#
# CONTRACT
# --------
# Always exits 0. Claude Code must never be blocked or slowed by observability,
# so every failure path — no core running, malformed input, jq missing, network
# error — degrades to silence rather than an error.
#
# ENVIRONMENT
#   INSPECTOR_HOOK_PORT_FILE  where to read the core's port (default /tmp/inspector-hook.port)
#   INSPECTOR_HOOK_DEBUG_LOG  append payloads here for debugging (default /dev/null)
#   INSPECTOR_HOOK_DISABLED   set to 1 to disable entirely
#   INSPECTOR_HOOK_TIMEOUT    curl max-time in seconds (default 2)

[ "${INSPECTOR_HOOK_DISABLED:-0}" = "1" ] && exit 0

PORT_FILE="${INSPECTOR_HOOK_PORT_FILE:-/tmp/inspector-hook.port}"
DEBUG_LOG="${INSPECTOR_HOOK_DEBUG_LOG:-/dev/null}"
TIMEOUT="${INSPECTOR_HOOK_TIMEOUT:-2}"

# No core running: nothing to send to. Exit before spending anything.
[ -f "$PORT_FILE" ] || exit 0
PORT=$(cat "$PORT_FILE" 2>/dev/null)
[ -n "$PORT" ] || exit 0

INPUT=$(cat)
[ -n "$INPUT" ] || exit 0

command -v jq >/dev/null 2>&1 || exit 0

# ---------------------------------------------------------------------------
# The single jq pass.
#
# Everything that used to be a separate jq call, a `date` call, or a bash `case`
# is expressed here. Reads the raw event, emits the complete log entry.
# ---------------------------------------------------------------------------
PAYLOAD=$(printf '%s' "$INPUT" | jq -c '

# ISO-8601 with milliseconds, computed without spawning `date`.
# Second resolution is not enough: in a busy session most events share a
# timestamp, and every sort in the read path is a plain timestamp comparison,
# so ordering would depend on sort stability rather than on the data.
def now_iso:
  now as $n
  | ($n | floor) as $s
  | ((($n - $s) * 1000) | floor) as $ms
  | ($s | todate | sub("Z$"; ""))
    + "."
    + ($ms | tostring | if length == 1 then "00" + . elif length == 2 then "0" + . else . end)
    + "Z";

# Truncate long strings so one payload cannot be unbounded.
def clip($n): if type == "string" and (length > $n) then .[0:$n] + "…" else . end;

.hook_event_name // "unknown"          as $hook
| (.tool_name // "")                    as $tool
| (.tool_input // null)                 as $ti
| (.tool_response // null)              as $tr
| (.tool_error // "")                   as $terr
| (.error // "")                        as $err

# Level. This used to be hardcoded "info", so the Errors / Warnings / Blocked
# counters could never populate from real traffic no matter what happened.
| (
    if $hook == "PostToolUseFailure" or $hook == "StopFailure" then "error"
    elif $hook == "PermissionDenied" then "blocked"
    elif ($tr | type) == "object" and ($tr.error // "") != "" then
      (if ($tr.error | ascii_downcase | test("block|denied|not allowed|permission")) then "blocked" else "error" end)
    elif $terr != "" then
      (if ($terr | ascii_downcase | test("block|denied|not allowed|permission")) then "blocked" else "error" end)
    elif $hook == "Notification" then
      (if (.level // "") == "error" then "error"
       elif (.level // "") | test("^warn") then "warn"
       else "info" end)
    else "info" end
  ) as $level

# Event name. Kept stable for the events the core already keys on; everything
# else passes through under its own name.
| (
    if $hook == "UserPromptSubmit" then "user.prompt"
    elif $hook == "Stop" then "ai.response"
    elif $hook == "StopFailure" then "ai.error"
    elif $hook == "SubagentStop" then "subagent.stop"
    elif $hook == "SubagentStart" then "subagent.start"
    elif $hook == "Notification" then "notification"
    elif $hook == "SessionStart" then "session.start"
    elif $hook == "SessionEnd" then "session.end"
    else $hook end
  ) as $event

# A human-readable one-liner per event/tool shape.
| (
    if $hook == "UserPromptSubmit" then "User prompt submitted"
    elif $hook == "Stop" then "Claude finished responding"
    elif $hook == "StopFailure" then "Turn failed: " + (if $err == "" then "unknown" else $err end)
    elif $hook == "SubagentStart" then "Subagent started: " + (.agent_type // "unknown")
    elif $hook == "SubagentStop" then "Subagent completed: " + (.agent_type // "unknown")
    elif $hook == "Notification" then (.message // "Notification")
    elif $hook == "PermissionRequest" then "Permission requested: " + $tool
    elif $hook == "PermissionDenied" then "Permission denied: " + $tool
    elif $hook == "PreCompact" or $hook == "PostCompact" then $hook + ": " + (.trigger // "")
    elif $hook == "SessionStart" then "Session started: " + ((.cwd // "") | split("/") | last // "")
    elif $hook == "SessionEnd" then "Session ended: " + (.reason // "")
    elif $hook == "FileChanged" then "File " + (.change_type // "changed") + ": " + (.filename // "")
    elif $hook == "CwdChanged" then "Directory changed: " + (.cwd // "")
    elif $hook == "PreModelSwitch" or $hook == "PostModelSwitch" then
      "Model: " + (.from_model // "?") + " -> " + (.to_model // "?")
    elif $hook == "TaskCreated" or $hook == "TaskCompleted" then $hook
    elif $hook == "InstructionsLoaded" then "Instructions loaded: " + (.file_path // "")
    elif $hook == "ConfigChange" then "Config changed: " + (.source // "")
    elif $tool != "" then
      ( if $tool == "Bash" then "Bash: " + (($ti.command // "") | clip(100))
        elif $tool == "Read" or $tool == "Write" or $tool == "Edit" then $tool + ": " + ($ti.file_path // $ti.path // "")
        elif $tool == "Glob" then "Glob: " + ($ti.pattern // "")
        elif $tool == "Grep" then "Grep: " + ($ti.pattern // "")
        elif $tool == "Task" then "Task (" + ($ti.subagent_type // "") + "): " + ($ti.description // "")
        elif $tool == "WebFetch" or $tool == "WebSearch" then $tool + ": " + ($ti.url // $ti.query // "")
        else $hook + ": " + $tool end )
    else $hook end
  ) as $msg

| {
    timestamp: now_iso,
    hook: $hook,
    event: $event,
    level: $level,
    sessionId: (.session_id // "unknown"),
    tool: $tool,
    file: ($ti.file_path // $ti.path // .filename // ""),
    message: $msg,

    # Correlation ids, promoted to the top level because the core treats them
    # as first-class rather than as incidental metadata.
    tool_use_id: .tool_use_id,
    prompt_id: .prompt_id,

    details: {
      cwd: .cwd,
      transcriptPath: .transcript_path,
      permissionMode: .permission_mode,
      effort: .effort.level,
      model: .model,

      # Subagent attribution. Present on events fired inside a subagent, and
      # what makes an agent tree buildable from tool events alone.
      agentId: .agent_id,
      agentType: .agent_type,

      tool_input: $ti,
      tool_result: ($tr | clip(20000)),
      toolError: (if $terr == "" then null else $terr end),

      # Real measured duration. Anything derived from these timestamps would be
      # a multiple of 1000ms or 0.
      durationMs: .duration_ms,

      prompt: (.prompt | clip(4000)),

      # Stop carries the finished reply; StopFailure reuses the same field for
      # the error string, which is why the two must never share an event type.
      lastAssistantMessage: (.last_assistant_message | clip(4000)),
      stopHookActive: .stop_hook_active,
      backgroundTasks: ((.background_tasks // []) | length),
      stopError: (if $err == "" then null else $err end),
      errorDetails: .error_details,

      notificationType: .notification_type,
      startReason: .start_reason,
      endReason: .reason,
      trigger: .trigger,
      changeType: .change_type,
      loadReason: .load_reason,
      source: .source,
      fromModel: .from_model,
      toModel: .to_model
    }
  }
' 2>/dev/null)

# Malformed input, or a jq that choked: stay silent rather than sending garbage.
[ -n "$PAYLOAD" ] && [ "$PAYLOAD" != "null" ] || exit 0

[ "$DEBUG_LOG" != "/dev/null" ] && printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$PAYLOAD" >> "$DEBUG_LOG"

# Fire and forget. Backgrounded so the hook does not wait on the round trip;
# Claude Code should never pay network latency for observability.
curl -s -X POST "http://127.0.0.1:$PORT/log" \
  -H 'Content-Type: application/json' \
  -d "$PAYLOAD" \
  --max-time "$TIMEOUT" >/dev/null 2>&1 &

exit 0
