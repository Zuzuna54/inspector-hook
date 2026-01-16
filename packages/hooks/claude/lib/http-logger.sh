#!/usr/bin/env bash
#
# Inspector Hook - HTTP Logger Library
# Shared functions for sending logs to the Inspector Hook server
#

# Configuration defaults
INSPECTOR_HOOK_PORT="${INSPECTOR_HOOK_PORT:-52376}"
INSPECTOR_HOOK_HOST="${INSPECTOR_HOOK_HOST:-localhost}"
INSPECTOR_HOOK_TIMEOUT="${INSPECTOR_HOOK_TIMEOUT:-5}"
INSPECTOR_HOOK_DEBUG="${INSPECTOR_HOOK_DEBUG:-0}"

# Debug logging
_ih_debug() {
  if [[ "$INSPECTOR_HOOK_DEBUG" == "1" ]]; then
    echo "[inspector-hook] $*" >&2
  fi
}

# Check if Inspector Hook is disabled
_ih_is_disabled() {
  [[ "${INSPECTOR_HOOK_DISABLED:-0}" == "1" ]]
}

# Send a log entry to the Inspector Hook server
# Usage: ih_send_log <hook_name> <event_type> <json_data>
ih_send_log() {
  local hook_name="$1"
  local event_type="$2"
  local json_data="$3"
  local session_id="${CLAUDE_SESSION_ID:-}"

  if _ih_is_disabled; then
    _ih_debug "Hook disabled, skipping"
    return 0
  fi

  # Build the payload
  local payload
  payload=$(jq -n \
    --arg hook "$hook_name" \
    --arg event "$event_type" \
    --arg sessionId "$session_id" \
    --arg timestamp "$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ" 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    --argjson data "$json_data" \
    '{
      hook: $hook,
      event: $event,
      sessionId: $sessionId,
      timestamp: $timestamp,
      data: $data
    }')

  _ih_debug "Sending to http://$INSPECTOR_HOOK_HOST:$INSPECTOR_HOOK_PORT/api/log"
  _ih_debug "Payload: $payload"

  # Send to server (non-blocking, ignore errors)
  curl -s -X POST \
    -H "Content-Type: application/json" \
    -d "$payload" \
    --connect-timeout "$INSPECTOR_HOOK_TIMEOUT" \
    --max-time "$INSPECTOR_HOOK_TIMEOUT" \
    "http://$INSPECTOR_HOOK_HOST:$INSPECTOR_HOOK_PORT/api/log" \
    >/dev/null 2>&1 &

  return 0
}

# Send a log entry and wait for response (blocking)
# Usage: ih_send_log_sync <hook_name> <event_type> <json_data>
ih_send_log_sync() {
  local hook_name="$1"
  local event_type="$2"
  local json_data="$3"
  local session_id="${CLAUDE_SESSION_ID:-}"

  if _ih_is_disabled; then
    _ih_debug "Hook disabled, skipping"
    return 0
  fi

  # Build the payload
  local payload
  payload=$(jq -n \
    --arg hook "$hook_name" \
    --arg event "$event_type" \
    --arg sessionId "$session_id" \
    --arg timestamp "$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ" 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    --argjson data "$json_data" \
    '{
      hook: $hook,
      event: $event,
      sessionId: $sessionId,
      timestamp: $timestamp,
      data: $data
    }')

  _ih_debug "Sending (sync) to http://$INSPECTOR_HOOK_HOST:$INSPECTOR_HOOK_PORT/api/log"

  # Send to server (blocking)
  local response
  response=$(curl -s -X POST \
    -H "Content-Type: application/json" \
    -d "$payload" \
    --connect-timeout "$INSPECTOR_HOOK_TIMEOUT" \
    --max-time "$INSPECTOR_HOOK_TIMEOUT" \
    "http://$INSPECTOR_HOOK_HOST:$INSPECTOR_HOOK_PORT/api/log" 2>/dev/null || echo '{"error": "connection failed"}')

  _ih_debug "Response: $response"

  # Check for error in response
  if echo "$response" | jq -e '.error' >/dev/null 2>&1; then
    return 1
  fi

  return 0
}

# Check if the Inspector Hook server is running
# Usage: ih_check_server
ih_check_server() {
  curl -s --connect-timeout 2 --max-time 2 \
    "http://$INSPECTOR_HOOK_HOST:$INSPECTOR_HOOK_PORT/api/health" \
    >/dev/null 2>&1
}

# Get current server stats
# Usage: ih_get_stats
ih_get_stats() {
  curl -s --connect-timeout 2 --max-time 2 \
    "http://$INSPECTOR_HOOK_HOST:$INSPECTOR_HOOK_PORT/api/stats" 2>/dev/null
}
