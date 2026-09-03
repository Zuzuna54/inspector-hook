#!/bin/bash
# End-to-end test for Phase 1 Walking Skeleton

set -e

# The core writes /tmp/inspector-hook.port (overridable via
# INSPECTOR_HOOK_PORT_FILE). This script used to look in os.tmpdir(), which on
# macOS is a private per-user dir, not /tmp -- so it could never find a
# running core and always failed at the first check.
PORT_FILE="${INSPECTOR_HOOK_PORT_FILE:-/tmp/inspector-hook.port}"

echo "=== Inspector Hook E2E Test ==="
echo ""

# Check port file
if [[ ! -f "$PORT_FILE" ]]; then
    echo "❌ Port file not found at $PORT_FILE"
    echo "   Make sure the VS Code extension is running!"
    exit 1
fi

PORT=$(cat "$PORT_FILE")
echo "✅ Core running on port: $PORT"

# Test health
echo ""
echo "Testing health endpoint..."
HEALTH=$(curl -s "http://127.0.0.1:$PORT/api/health")
echo "   Response: $HEALTH"

if echo "$HEALTH" | grep -q "healthy"; then
    echo "✅ Health check passed"
else
    echo "❌ Health check failed"
    exit 1
fi

# Send test logs
echo ""
echo "Sending test logs..."

for level in info warn error blocked; do
    curl -s -X POST "http://127.0.0.1:$PORT/api/log" \
        -H "Content-Type: application/json" \
        -d "{
            \"hook\": \"TestHook\",
            \"event\": \"test-event\",
            \"level\": \"$level\",
            \"message\": \"Test $level message from e2e script\",
            \"sessionId\": \"e2e-test-$(date +%s)\",
            \"tool\": \"TestTool\"
        }" > /dev/null
    echo "   Sent $level log"
done

echo "✅ Logs sent"

# Check stats
echo ""
echo "Checking stats..."
STATS=$(curl -s "http://127.0.0.1:$PORT/api/stats")
echo "   Stats: $STATS"

# Parse stats (basic check)
if echo "$STATS" | grep -q "totalLogs"; then
    echo "✅ Stats endpoint working"
else
    echo "❌ Stats endpoint failed"
    exit 1
fi

echo ""
echo "=== E2E Test Complete ==="
echo ""
echo "Now check the VS Code webview panel:"
echo "  1. Open Command Palette (Cmd+Shift+P)"
echo "  2. Run 'Inspector Hook: Show Panel'"
echo "  3. You should see the test logs in Dashboard and All Logs tabs"
echo ""
