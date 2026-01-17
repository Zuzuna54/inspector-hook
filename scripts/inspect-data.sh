#!/bin/bash
# INSPECTOR HOOK DATA VIEWER
# Run: ./scripts/inspect-data.sh

PORT=$(cat /tmp/inspector-hook.port 2>/dev/null)

if [ -z "$PORT" ]; then
  echo "❌ ERROR: Inspector Hook not running (no /tmp/inspector-hook.port file)"
  exit 1
fi

echo "========================================"
echo "INSPECTOR HOOK DATA (port $PORT)"
echo "========================================"
echo ""

echo "--- STATS ---"
curl -s "http://localhost:$PORT/api/debug?limit=5" | jq '.stats'

echo ""
echo "--- SUMMARY ---"
curl -s "http://localhost:$PORT/api/debug?limit=5" | jq '.summary'

echo ""
echo "--- LAST 5 LOGS ---"
curl -s "http://localhost:$PORT/api/logs?limit=5" | jq '.logs[] | "\(.timestamp[11:19]) [\(.hook)] \(.tool // "n/a"): \(.message[0:60])"'

echo ""
echo "--- SESSIONS ---"
curl -s "http://localhost:$PORT/api/sessions" | jq '.sessions[] | {id: .id[0:8], status: .status, tools: .toolCount}'

echo ""
echo "--- PENDING CHANGES ---"
curl -s "http://localhost:$PORT/api/changes" | jq '.changes | length' | xargs echo "Count:"

echo ""
echo "========================================"
