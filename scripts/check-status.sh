#!/bin/bash
# Inspector Hook Status Check
# Usage: ./scripts/check-status.sh

PORT=$(cat /tmp/inspector-hook.port 2>/dev/null)

if [ -z "$PORT" ]; then
  echo "❌ Inspector Hook core not running (no port file)"
  exit 1
fi

echo "✅ Inspector Hook running on port $PORT"
echo ""

# Health check
HEALTH=$(curl -s "http://localhost:$PORT/api/health" 2>/dev/null)
if [ -z "$HEALTH" ]; then
  echo "❌ Cannot connect to core"
  exit 1
fi

echo "=== System Status ==="
curl -s "http://localhost:$PORT/api/debug?limit=3" | jq '{
  uptime: .stats.logsPerMinute,
  totalLogs: .stats.totalLogs,
  errors: .stats.errors,
  sessions: .summary.sessions,
  pendingChanges: .summary.pendingChanges
}'

echo ""
echo "=== Last 5 Tool Logs ==="
curl -s "http://localhost:$PORT/api/logs?limit=5" | jq -r '.logs[] | "\(.timestamp[11:19]) [\(.hook)] \(.tool // "n/a"): \(.message[0:50])"'

echo ""
echo "=== Sample Log with Details ==="
curl -s "http://localhost:$PORT/api/logs?limit=1&hook=PostToolUse" | jq '.logs[0] | {
  id: .id,
  hook: .hook,
  tool: .tool,
  hasToolInput: (.details.tool_input != null),
  hasToolResult: (.details.tool_result != null),
  detailKeys: (.details | keys? // [])
}'
