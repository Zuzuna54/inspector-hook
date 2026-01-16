# @inspector-hook/hooks

Hook scripts for integrating Claude Code with Inspector Hook.

## Overview

This package provides hook scripts that intercept Claude Code events and send them to the Inspector Hook server for logging, monitoring, and orchestration.

## Installation

### Automatic Installation

Run the installation script to automatically configure Claude Code:

```bash
./scripts/install.sh
```

This will:
1. Back up your existing Claude Code settings
2. Add Inspector Hook to your hook configuration
3. Configure all supported hook events

### Manual Installation

Add the following to your `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "command": "/path/to/inspector-hook/packages/hooks/claude/pre-tool-use.sh",
        "timeout": 5000
      }
    ],
    "PostToolUse": [
      {
        "command": "/path/to/inspector-hook/packages/hooks/claude/post-tool-use.sh",
        "timeout": 5000
      }
    ]
  }
}
```

## Hook Scripts

### Bash Hooks (claude/)

| Script | Event | Description |
|--------|-------|-------------|
| `pre-tool-use.sh` | PreToolUse | Called before tool execution |
| `post-tool-use.sh` | PostToolUse | Called after tool execution |

### Unified Hook (scripts/)

| Script | Description |
|--------|-------------|
| `inspector-hook.sh` | Universal hook that handles all events |

## Library Files

### Bash Library (claude/lib/http-logger.sh)

Provides shell functions for sending logs to the Inspector Hook server:

```bash
source /path/to/lib/http-logger.sh

# Send a log entry (non-blocking)
ih_send_log "hook-name" "event.type" '{"key": "value"}'

# Send a log entry (blocking, waits for response)
ih_send_log_sync "hook-name" "event.type" '{"key": "value"}'

# Check if server is running
ih_check_server && echo "Server is running"

# Get server statistics
ih_get_stats
```

### Python Library (claude/lib/http_logger.py)

Provides Python functions for sending logs:

```python
from http_logger import send_log, send_log_sync, check_server, get_stats

# Send a log entry (non-blocking)
send_log("hook-name", "event.type", {"key": "value"})

# Send a log entry (blocking)
send_log_sync("hook-name", "event.type", {"key": "value"})

# Check if server is running
if check_server():
    print("Server is running")

# Get server statistics
stats = get_stats()
```

## Configuration

The hooks can be configured using environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `INSPECTOR_HOOK_PORT` | 52376 | HTTP server port |
| `INSPECTOR_HOOK_HOST` | localhost | Server hostname |
| `INSPECTOR_HOOK_TIMEOUT` | 5 | Request timeout in seconds |
| `INSPECTOR_HOOK_DISABLED` | 0 | Set to 1 to disable logging |
| `INSPECTOR_HOOK_DEBUG` | 0 | Set to 1 for verbose output |

## Uninstallation

To remove Inspector Hook from Claude Code:

```bash
./scripts/uninstall.sh
```

Or manually remove the hook entries from `~/.claude/settings.json`.

## Troubleshooting

### Hooks not firing

1. Verify Claude Code settings are correct:
   ```bash
   cat ~/.claude/settings.json | jq '.hooks'
   ```

2. Check that hook scripts are executable:
   ```bash
   chmod +x claude/*.sh claude/lib/*.sh
   ```

3. Test the server connection:
   ```bash
   curl http://localhost:52376/api/health
   ```

### Debug mode

Enable debug output to see what the hooks are doing:

```bash
export INSPECTOR_HOOK_DEBUG=1
```

### Server not responding

1. Make sure the Inspector Hook VS Code extension is running
2. Check the server port matches your configuration
3. Verify no firewall is blocking localhost connections
