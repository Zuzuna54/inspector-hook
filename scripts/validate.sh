#!/bin/bash
# Inspector Hook Validation Script
# Tests that the core process is running and responding

set -e

echo "🔍 Inspector Hook Validation"
echo "=============================="

# Port file location per Phase 1 spec
PORT_FILE="/tmp/inspector-hook.port"

echo -e "\n📁 Checking port file: $PORT_FILE"

if [ ! -f "$PORT_FILE" ]; then
    echo "❌ Port file not found"
    echo ""
    echo "The core process is not running. Please:"
    echo "1. Open VS Code with the inspector-hook extension"
    echo "2. Run Command Palette (Cmd+Shift+P) → 'Inspector Hook: Show Status'"
    echo "3. Check Output panel → 'Inspector Hook' for errors"
    exit 1
fi

PORT=$(cat "$PORT_FILE")
echo "✅ Core process running on port $PORT"

# Test 1: Health check
echo -e "\n📋 Test 1: Health Check"
HEALTH=$(curl -s "http://127.0.0.1:$PORT/api/health" 2>/dev/null || echo "FAILED")
if echo "$HEALTH" | grep -q "healthy"; then
    echo "✅ Health check passed"
    echo "   Response: $HEALTH"
else
    echo "❌ Health check failed: $HEALTH"
    exit 1
fi

# Test 2: Stats endpoint
echo -e "\n📋 Test 2: Stats Endpoint"
STATS=$(curl -s "http://127.0.0.1:$PORT/api/stats" 2>/dev/null || echo "FAILED")
if echo "$STATS" | grep -q "totalLogs"; then
    echo "✅ Stats endpoint working"
    echo "   Response: $STATS"
else
    echo "❌ Stats endpoint failed: $STATS"
fi

# Test 3: Send a test log
echo -e "\n📋 Test 3: Log Ingestion"
TEST_LOG='{"hook":"Test","event":"validation.test","level":"info","message":"Validation test log","sessionId":"test-session-'$(date +%s)'"}'
RESULT=$(curl -s -X POST "http://127.0.0.1:$PORT/api/log" \
    -H "Content-Type: application/json" \
    -d "$TEST_LOG" 2>/dev/null || echo "FAILED")

if echo "$RESULT" | grep -q '"success":true'; then
    echo "✅ Log ingestion working"
    echo "   Response: $RESULT"
else
    echo "❌ Log ingestion failed: $RESULT"
fi

# Test 4: Check storage directory
echo -e "\n📋 Test 4: Storage Directory"
STORAGE_PATH="$HOME/.inspector-hook"
if [ -d "$STORAGE_PATH" ]; then
    echo "✅ Storage directory exists: $STORAGE_PATH"
    echo "   Contents:"
    ls -la "$STORAGE_PATH" 2>/dev/null | head -10
else
    echo "⚠️  Storage directory not yet created (will be created on first use)"
fi

echo -e "\n=============================="
echo "✅ Validation Complete!"
echo ""
echo "Next steps to fully test Phase 2 features:"
echo "1. Use Claude Code with hooks enabled to generate file changes"
echo "2. Check VS Code 'Inspector Hook' output for events"
echo "3. The extension should track sessions, file changes, and versions"
