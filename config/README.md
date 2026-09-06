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

> **Do not copy `claude-settings.json` over `~/.claude/settings.json`.**
>
> An earlier version of this page told you to. That command **replaces** the
> file, destroying every hook you already have — on the machine this was
> written on, 30 registered events and 52 commands, including hooks belonging
> to entirely unrelated tools. It is the same full-replace behaviour
> `packages/hooks/scripts/install.sh` was rewritten to stop doing.
>
> It was also broken on its own terms: `claude-settings.json` hardcodes
> `/Users/gio/...` in 28 places — a different machine's home directory — and
> the `sed` that repaired those paths came *after* the copy, so following the
> steps in order left you with no settings of your own and a set of hook paths
> that do not exist.
>
> `claude-settings.json` is kept as a **reference sample** of the shape a
> settings file takes. It is not something to install.

### 1. Install the Inspector Hook hooks

Use the installer. It merges per event, is idempotent, and leaves every other
tool's hooks alone:

```bash
./packages/hooks/scripts/install.sh
```

Undo it the same way:

```bash
./packages/hooks/scripts/install.sh --uninstall
```

### 2. Copy the optional hook collection

These are standalone scripts; copying them registers nothing on its own.

```bash
mkdir -p ~/.claude/hooks
cp -r config/claude-hooks/* ~/.claude/hooks/
chmod +x ~/.claude/hooks/**/*.sh ~/.claude/hooks/**/*.py
```

To register any of them, add the entry by hand or with `jq`, merging into the
event you want rather than assigning to `.hooks`:

```bash
# Back it up first, always.
cp ~/.claude/settings.json ~/.claude/settings.json.bak
```

### 3. Copy Agents (Optional)

```bash
mkdir -p ~/.claude/agents
cp -r config/claude-agents/* ~/.claude/agents/
```

### 4. Copy Skills (Optional)

```bash
mkdir -p ~/.claude/skills
cp -r config/claude-skills/* ~/.claude/skills/
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
