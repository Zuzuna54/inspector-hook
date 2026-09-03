#!/usr/bin/env bash
#
# Seed a running core with realistic traffic, so the UI has something
# meaningful to exercise during a manual walkthrough.
#
# Drives events through the real hook script rather than hand-rolling payloads,
# so what lands in the store is shaped exactly like production data.
#
# Usage:
#   ./scripts/seed-data.sh                 # seed the running core
#   ./scripts/seed-data.sh --isolated      # start a throwaway core, seed, print its port
#
# --isolated never touches ~/.inspector-hook or /tmp/inspector-hook.port, so it
# cannot disturb a real instance or redirect the machine's hooks.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK="$REPO_ROOT/config/claude-hooks/logging/hook-inspector.sh"
ISOLATED=0
CORE_PID=""
STORE=""

[[ "${1:-}" == "--isolated" ]] && ISOLATED=1

cleanup() {
  if [[ -n "$CORE_PID" ]]; then
    echo ""
    echo "Throwaway core still running as pid $CORE_PID on port $(cat "$PORT_FILE")"
    echo "Storage: $STORE"
    echo "Stop it with: kill $CORE_PID && rm -rf $STORE"
  fi
}
trap cleanup EXIT

if [[ "$ISOLATED" == "1" ]]; then
  command -v node >/dev/null || { echo "node not found"; exit 1; }
  [[ -f "$REPO_ROOT/packages/core/dist/cli.js" ]] || { echo "Run 'pnpm build' first"; exit 1; }
  STORE="$(mktemp -d)"
  PORT_FILE="$STORE/port"
  INSPECTOR_HOOK_STORAGE="$STORE" \
  INSPECTOR_HOOK_PORT_FILE="$PORT_FILE" \
  INSPECTOR_HOOK_HTTP_PORT=0 \
    nohup node "$REPO_ROOT/packages/core/dist/cli.js" < /dev/null > "$STORE/core.log" 2>&1 &
  CORE_PID=$!
  sleep 2
else
  PORT_FILE="${INSPECTOR_HOOK_PORT_FILE:-/tmp/inspector-hook.port}"
fi

if [[ ! -f "$PORT_FILE" ]]; then
  echo "No port file at $PORT_FILE — is the core running? (try --isolated)"
  exit 1
fi
PORT="$(cat "$PORT_FILE")"
curl -sf -m 2 "http://127.0.0.1:$PORT/api/health" >/dev/null || {
  echo "Core not responding on port $PORT"; exit 1; }

echo "Seeding core on port $PORT"

# Send one hook event, shaped the way Claude Code shapes it.
emit() { echo "$1" | INSPECTOR_HOOK_PORT_FILE="$PORT_FILE" bash "$HOOK"; }

SCRATCH="$(mktemp -d)"

seed_session() {
  local sid="$1" project="$2" branch="$3"

  emit "$(jq -nc --arg s "$sid" --arg cwd "/Users/dev/$project" --arg b "$branch" \
    '{hook_event_name:"SessionStart",session_id:$s,start_reason:"startup",cwd:$cwd,
      projectName:($cwd|split("/")|last),gitBranch:$b,permission_mode:"default",
      effort:{level:"medium"}}')"

  emit "$(jq -nc --arg s "$sid" --arg p "prompt-$sid-1" \
    '{hook_event_name:"UserPromptSubmit",session_id:$s,prompt_id:$p,
      prompt:"Refactor the auth module and add tests for the token refresh path"}')"

  # Three parallel Bash calls completing out of order — the case that used to
  # leave executions stuck "running".
  for i in 1 2 3; do
    emit "$(jq -nc --arg s "$sid" --arg t "toolu-$sid-b$i" --arg c "npm test -- shard$i" \
      '{hook_event_name:"PreToolUse",session_id:$s,tool_name:"Bash",tool_use_id:$t,
        tool_input:{command:$c},permission_mode:"default"}')"
  done
  for i in 3 1 2; do
    emit "$(jq -nc --arg s "$sid" --arg t "toolu-$sid-b$i" --argjson d $((i * 137)) \
      '{hook_event_name:"PostToolUse",session_id:$s,tool_name:"Bash",tool_use_id:$t,
        duration_ms:$d,tool_input:{command:"npm test"},tool_response:"3 passing"}')"
  done

  # A subagent-attributed tool call, so the agent tree has data.
  emit "$(jq -nc --arg s "$sid" --arg t "toolu-$sid-sub" \
    '{hook_event_name:"PreToolUse",session_id:$s,tool_name:"Grep",tool_use_id:$t,
      agent_id:"agent-1",agent_type:"Explore",tool_input:{pattern:"refreshToken"}}')"
  emit "$(jq -nc --arg s "$sid" --arg t "toolu-$sid-sub" \
    '{hook_event_name:"PostToolUse",session_id:$s,tool_name:"Grep",tool_use_id:$t,
      agent_id:"agent-1",agent_type:"Explore",duration_ms:64,tool_response:"4 matches"}')"

  # A blocked call, so the Blocked stat card and blocked styling have data.
  emit "$(jq -nc --arg s "$sid" --arg t "toolu-$sid-blk" \
    '{hook_event_name:"PreToolUse",session_id:$s,tool_name:"Bash",tool_use_id:$t,
      tool_input:{command:"rm -rf /"}}')"
  emit "$(jq -nc --arg s "$sid" --arg t "toolu-$sid-blk" \
    '{hook_event_name:"PostToolUse",session_id:$s,tool_name:"Bash",tool_use_id:$t,
      tool_response:{error:"blocked by security gate"}}')"

  # A failed call, so the Errors card has data.
  emit "$(jq -nc --arg s "$sid" --arg t "toolu-$sid-err" \
    '{hook_event_name:"PreToolUse",session_id:$s,tool_name:"Read",tool_use_id:$t,
      tool_input:{file_path:"/missing.ts"}}')"
  emit "$(jq -nc --arg s "$sid" --arg t "toolu-$sid-err" \
    '{hook_event_name:"PostToolUseFailure",session_id:$s,tool_name:"Read",
      tool_use_id:$t,tool_error:"ENOENT: no such file"}')"

  emit "$(jq -nc --arg s "$sid" \
    '{hook_event_name:"Notification",session_id:$s,
      notification_type:"permission_prompt",message:"Claude needs permission to run npm"}')"

  emit "$(jq -nc --arg s "$sid" \
    '{hook_event_name:"Stop",session_id:$s,reason:"complete",
      last_assistant_message:"Refactored the auth module; all tests pass."}')"
}

# Real file edits, so File Changes / History / diffs have content.
seed_edits() {
  local sid="$1" n="$2"
  for i in $(seq 1 "$n"); do
    local f="$SCRATCH/module$i.ts"
    printf 'export function f%s() {\n  return %s;\n}\n' "$i" "$i" > "$f"
    emit "$(jq -nc --arg s "$sid" --arg f "$f" --arg t "toolu-$sid-e$i" \
      '{hook_event_name:"PreToolUse",session_id:$s,tool_name:"Edit",tool_use_id:$t,
        tool_input:{file_path:$f}}')"
    sleep 0.2
    printf 'export function f%s(scale = 1) {\n  if (scale < 0) throw new Error("bad");\n  return %s * scale;\n}\n' "$i" "$i" > "$f"
    emit "$(jq -nc --arg s "$sid" --arg f "$f" --arg t "toolu-$sid-e$i" --argjson d $((i * 90)) \
      '{hook_event_name:"PostToolUse",session_id:$s,tool_name:"Edit",tool_use_id:$t,
        duration_ms:$d,tool_input:{file_path:$f},tool_response:"applied"}')"
    sleep 0.2
    # A second edit to the same file, so version history has more than one entry.
    printf 'export function f%s(scale = 1) {\n  if (!Number.isFinite(scale)) throw new Error("bad");\n  return %s * scale;\n}\n' "$i" "$i" > "$f"
    emit "$(jq -nc --arg s "$sid" --arg f "$f" --arg t "toolu-$sid-e$i-b" \
      '{hook_event_name:"PreToolUse",session_id:$s,tool_name:"Edit",tool_use_id:$t,
        tool_input:{file_path:$f}}')"
    emit "$(jq -nc --arg s "$sid" --arg f "$f" --arg t "toolu-$sid-e$i-b" \
      '{hook_event_name:"PostToolUse",session_id:$s,tool_name:"Edit",tool_use_id:$t,
        duration_ms:110,tool_input:{file_path:$f},tool_response:"applied"}')"
  done
}

TS="$(date +%s)"
seed_session "seed-$TS-a" "checkout-service" "main"
seed_session "seed-$TS-b" "billing-api" "feat/invoices"
seed_edits   "seed-$TS-a" 3

# One session that genuinely ended, so the Sessions list shows a completed row.
emit "$(jq -nc --arg s "seed-$TS-c" \
  '{hook_event_name:"SessionStart",session_id:$s,start_reason:"startup",cwd:"/Users/dev/old-project"}')"
emit "$(jq -nc --arg s "seed-$TS-c" '{hook_event_name:"SessionEnd",session_id:$s,reason:"exit"}')"

sleep 2

echo ""
echo "=== Result ==="
curl -s "http://127.0.0.1:$PORT/api/stats" | jq '{totalLogs,errors,warnings,blocked}'
curl -s "http://127.0.0.1:$PORT/api/sessions" \
  | jq --arg p "seed-$TS" '[.sessions[]|select(.id|startswith($p))
      |{id:.id[0:14],status,tools:(.toolExecutions|length),
        stuck:([.toolExecutions[]|select(.status=="running")]|length)}]'
curl -s "http://127.0.0.1:$PORT/api/changes" | jq '{pendingChanges:(.changes|length)}'
echo ""
echo "Scratch files (edited to create the diffs): $SCRATCH"
echo "Open the panel and walk the views — every card and list should now have data."
