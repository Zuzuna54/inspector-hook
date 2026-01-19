# Claude Code Configuration Files

This directory contains the Claude Code configuration files needed to run Inspector Hook.

## Directory Structure

```
config/
├── claude-settings.json     # Main Claude Code settings with hooks configuration
├── claude-hooks/            # Hook scripts that integrate with Claude Code
│   ├── advanced/            # Advanced automation hooks
│   ├── config/              # Hook configuration files (rules, sounds, etc.)
│   ├── core/                # Core functionality hooks
│   ├── integration/         # Integration hooks (project detection, etc.)
│   ├── lib/                 # Shared libraries for hooks
│   ├── logging/             # Logging hooks (including hook-inspector.sh)
│   └── quality/             # Code quality hooks (formatting, linting, etc.)
├── claude-agents/           # Custom agent definitions for Claude Code
└── claude-skills/           # Custom skills for Claude Code
```

## Installation

### 1. Copy Settings

Copy the settings file to your Claude Code configuration directory:

```bash
cp config/claude-settings.json ~/.claude/settings.json
```

### 2. Copy Hooks

Copy the hooks directory:

```bash
cp -r config/claude-hooks/* ~/.claude/hooks/
chmod +x ~/.claude/hooks/**/*.sh ~/.claude/hooks/**/*.py
```

### 3. Copy Agents (Optional)

```bash
cp -r config/claude-agents/* ~/.claude/agents/
```

### 4. Copy Skills (Optional)

```bash
cp -r config/claude-skills/* ~/.claude/skills/
```

### 5. Update Paths

The hooks in `claude-settings.json` reference absolute paths like `/Users/gio/.claude/hooks/...`.
You'll need to update these paths to match your system:

```bash
# Replace with your username
sed -i '' 's|/Users/gio|/Users/YOUR_USERNAME|g' ~/.claude/settings.json
```

## Key Hooks for Inspector Hook

The following hooks are essential for Inspector Hook functionality:

### `logging/hook-inspector.sh`
The main hook that sends events to the Inspector Hook core process. It's registered for:
- `UserPromptSubmit` - Captures user prompts
- `PreToolUse` / `PostToolUse` - Tracks tool executions
- `SessionStart` / `SessionEnd` - Manages sessions
- `Stop` - Session completion
- `Notification` - System notifications

### Other Useful Hooks

| Hook | Purpose |
|------|---------|
| `core/security-gate.py` | Validates bash commands before execution |
| `core/notify.sh` | macOS notifications when Claude stops |
| `quality/biome-format.sh` | Auto-formats JS/TS files after write |
| `quality/type-check.sh` | Runs TypeScript type checking |
| `advanced/auto-approve.py` | Auto-approves safe operations |
| `advanced/state-backup.sh` | Backs up state before compaction |

## Hook Events Reference

| Event | Trigger | Use Case |
|-------|---------|----------|
| `UserPromptSubmit` | User sends a prompt | Log user messages |
| `PreToolUse` | Before tool execution | Validation, security gates |
| `PostToolUse` | After tool execution | Formatting, logging |
| `Stop` | Claude stops processing | Notifications, cleanup |
| `Notification` | System notifications | Waiting indicators |
| `SessionStart` | Session begins | Initialize tracking |
| `SessionEnd` | Session ends | Cleanup, finalization |
| `PreCompact` | Before context compaction | State backup |
| `SubagentStop` | Subagent completes | Coordination |

## Troubleshooting

### Hooks not executing

1. Check permissions: `chmod +x ~/.claude/hooks/**/*.sh`
2. Check paths in settings.json match your system
3. Restart Claude Code after changing settings (hooks are cached)

### Inspector Hook not receiving events

1. Verify the core process is running
2. Check the port file exists: `cat /tmp/inspector-hook.port`
3. Check hook logs: `tail -f /tmp/hook-inspector-debug.log`
