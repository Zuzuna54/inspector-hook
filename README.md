# Inspector Hook

**Universal AI Agent Monitoring & Orchestration Platform**

Inspector Hook is a cross-IDE monitoring and orchestration tool for AI coding assistants. It provides real-time visibility into AI agent operations, file changes, session management, and workflow orchestration.

## Table of Contents

- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Development Setup](#development-setup)
- [VS Code Extension Development](#vs-code-extension-development)
- [Hooks Configuration](#hooks-configuration)
- [Core Package Details](#core-package-details)
- [IPC Protocol](#ipc-protocol)
- [Configuration](#configuration)
- [Documentation](#documentation)
- [Supported Platforms](#supported-platforms)
- [License](#license)

## Architecture

Inspector Hook uses a **Shared Core + Thin Wrappers** architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                    Inspector Hook Core                       │
│                    (Node.js Process)                         │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐   │
│  │ HTTP Server │ │ File Tracker│ │ Session Manager     │   │
│  │ (Hook Recv) │ │             │ │                     │   │
│  └─────────────┘ └─────────────┘ └─────────────────────┘   │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐   │
│  │ Version     │ │ Archive     │ │ Orchestration       │   │
│  │ History     │ │ Manager     │ │ Engine              │   │
│  └─────────────┘ └─────────────┘ └─────────────────────┘   │
└───────────────────────────┬─────────────────────────────────┘
                            │ JSON-RPC over stdio
        ┌───────────────────┼───────────────────┐
        │                   │                   │
   ┌────▼────┐        ┌─────▼─────┐      ┌──────▼──────┐
   │ VS Code │        │ JetBrains │      │   Theia     │
   │ Wrapper │        │  Wrapper  │      │   Wrapper   │
   │  (TS)   │        │ (Kotlin)  │      │    (TS)     │
   └─────────┘        └───────────┘      └─────────────┘
```

### Communication Flow

1. **Hook Scripts → HTTP**: Claude Code hooks send logs to `localhost:52376/log`
2. **HTTP Server**: Ingests logs, broadcasts to session/file managers
3. **IPC Server**: Communicates bidirectionally with VS Code extension via JSON-RPC
4. **WebView**: Real-time UI updates via postMessage

## Project Structure

```
inspector-hook/
├── packages/
│   ├── core/                      # Shared core logic (Node.js)
│   │   ├── src/
│   │   │   ├── cli.ts            # Entry point (starts core process)
│   │   │   ├── core.ts           # Main orchestrator
│   │   │   ├── ipc/              # JSON-RPC server
│   │   │   ├── server/           # HTTP server
│   │   │   ├── managers/         # Business logic modules
│   │   │   │   ├── session-manager.ts
│   │   │   │   ├── file-tracker.ts
│   │   │   │   ├── log-manager.ts
│   │   │   │   └── diff-engine.ts
│   │   │   └── persistence/      # Storage layer
│   │   └── package.json
│   │
│   ├── protocol/                  # Shared types and protocols
│   │   ├── src/index.ts          # Barrel over the modules below
│   │   ├── src/{log,session,activity,file-change,history,…}.ts
│   │   └── package.json
│   │
│   ├── vscode/                    # VS Code extension wrapper
│   │   ├── src/
│   │   │   ├── extension.ts      # Activation/deactivation
│   │   │   ├── core-bridge.ts    # JSON-RPC client
│   │   │   ├── panel.ts          # Webview panel management
│   │   │   └── commands.ts       # Command registration
│   │   ├── media/                # UI assets (HTML/CSS/JS)
│   │   │   ├── scripts/          # JavaScript for webview
│   │   │   └── styles/           # CSS styles
│   │   └── package.json
│   │
│   └── hooks/                     # Hook integration for Claude Code
│       ├── scripts/
│       │   ├── install.sh        # Merging installer (also --uninstall)
│       │   └── uninstall.sh      # Thin delegate to install.sh --uninstall
│       └── claude/
│           └── inspector-hook.sh # The single hook script, all events
│
├── docs/
│   ├── AUDIT-MATRIX.md            # What actually works, with evidence
│   ├── phases/                    # Development phase documents
│   └── design/                    # Technical design documents
│
├── .vscode/
│   ├── launch.json               # F5 extension debugging
│   └── tasks.json                # Build tasks
│
├── package.json                   # Root workspace config
├── pnpm-workspace.yaml           # pnpm workspace definition
└── tsconfig.base.json            # Shared TypeScript config
```

## Prerequisites

- **Node.js**: >= 18.0.0
- **pnpm**: >= 8.0.0
- **VS Code**: >= 1.85.0 (for extension development)

```bash
# Verify prerequisites
node --version   # Should be >= 18.0.0
pnpm --version   # Should be >= 8.0.0
```

## Quick Start

```bash
# Clone the repository
git clone https://github.com/Zuzuna54/inspector-hook.git
cd inspector-hook

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run in development mode (watch mode)
pnpm dev
```

## Development Setup

### Build Commands

All commands run recursively across all packages:

```bash
# Build all packages
pnpm build

# Watch mode for all packages (parallel)
pnpm dev

# Clean dist directories
pnpm clean

# Type checking only
pnpm typecheck
```

### Package-Specific Commands

```bash
# Core package
pnpm --filter @inspector-hook/core build
pnpm --filter @inspector-hook/core dev

# VS Code extension
pnpm --filter @inspector-hook/vscode build
pnpm --filter @inspector-hook/vscode package   # Create .vsix file

# Protocol package
pnpm --filter @inspector-hook/protocol build
```

## VS Code Extension Development

### Running in Debug Mode (F5)

1. Open the `inspector-hook` folder in VS Code
2. Press `F5` or go to **Run → Start Debugging**
3. This will:
   - Build all packages
   - Launch a new VS Code window (Extension Development Host)
   - Attach the debugger

### Debug Configurations

The `.vscode/launch.json` provides two configurations:

- **Run Extension**: Full build + debug (default)
- **Run Extension (No Build)**: Quick restart without rebuild

### Build Tasks

Press `Ctrl+Shift+B` to run the default build task, or use:

- **npm: build**: Builds all packages
- **Watch Extension**: Continuous watch for the VS Code extension

### Testing the Extension

1. Start the extension in debug mode (F5)
2. Open the Command Palette (`Ctrl+Shift+P`)
3. Run `Inspector Hook: Show Panel`
4. The monitoring panel should appear

## Hooks Configuration

### Installing

```bash
./packages/hooks/scripts/install.sh            # install or update
./packages/hooks/scripts/install.sh --dry-run  # preview without writing
./packages/hooks/scripts/uninstall.sh          # remove only our entries
```

Then restart Claude Code so it re-reads `~/.claude/settings.json`.

The installer **merges** — it adds only what is missing and leaves every other
tool's hooks untouched, so it is safe to run repeatedly and safe to run
alongside other hook-based tooling. It backs up `settings.json` before writing,
and refuses to touch the file if it is not valid JSON.

### What gets registered

One script, `packages/hooks/claude/inspector-hook.sh`, is registered against
every event Inspector Hook consumes — 30 of Claude Code's 33. `MessageDisplay`
is skipped because it fires per streamed text chunk and would flood the store;
the `Elicitation` pair is skipped because nothing renders it.

Each entry uses the nested schema Claude Code requires:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "/abs/path/to/packages/hooks/claude/inspector-hook.sh" }
        ]
      }
    ]
  }
}
```

A flat `{"command": ..., "timeout": ...}` entry — which earlier versions of this
project wrote — is **not** recognised by current Claude Code, and hooks
installed that way never fire.

### What the hook captures

Beyond the event name and session id: `tool_use_id` (which is what lets the core
pair a tool call with its completion, even when several calls to the same tool
run in parallel), `prompt_id` (turn grouping), `duration_ms` (the real measured
duration — anything derived from hook timestamps would be a multiple of 1000 ms),
`agent_id`/`agent_type` (subagent attribution), `permission_mode`, `effort`,
`model`, and `last_assistant_message`.

### Environment

| Variable | Default | Purpose |
|---|---|---|
| `INSPECTOR_HOOK_PORT_FILE` | `/tmp/inspector-hook.port` | Where to read the core's port |
| `INSPECTOR_HOOK_DEBUG_LOG` | `/dev/null` | Append payloads for debugging. Off by default — it records prompts and tool I/O. |
| `INSPECTOR_HOOK_DISABLED` | `0` | Set to `1` to disable capture entirely |
| `INSPECTOR_HOOK_TIMEOUT` | `2` | curl max-time, seconds |

### Performance

The hook runs on every tool call, twice, so its cost is user-visible latency in
Claude Code. It makes exactly one `jq` invocation and one backgrounded `curl`:
**~37 ms per invocation**, against a project budget of 50 ms. An earlier version
invoked `jq` 26 times and `date` 10 times and measured 337 ms.

If the core is not running the hook exits before doing any work, and it always
exits 0 — observability must never block or slow the agent.

### How Hooks Work

1. Claude Code triggers hook with JSON input via stdin
2. Hook script extracts relevant data
3. Sends HTTP POST to `localhost:52376/log`
4. Core process ingests and broadcasts to UI

## Core Package Details

### Starting the Core Process

The core process is automatically started by the VS Code extension, but can be run manually:

```bash
# Run directly
pnpm --filter @inspector-hook/core dev

# Or via the built CLI
node packages/core/dist/cli.js
```

### Core Process Output

When started, the core outputs:

```json
{"type": "ready", "port": 52376}
```

It also writes the port to `/tmp/inspector-hook.port` for hook scripts to discover.

### Environment Variables

```bash
INSPECTOR_HOOK_HTTP_PORT=52376        # HTTP server port (0 = auto-assign)
INSPECTOR_HOOK_MAX_LOGS=10000         # Maximum logs in memory
INSPECTOR_HOOK_RETENTION_DAYS=7       # Log retention period
INSPECTOR_HOOK_WORKSPACE=/path        # Working directory
```

### Core Components

| Component | Purpose |
|-----------|---------|
| `HttpServer` | Receives logs from hooks via HTTP POST |
| `IpcServer` | JSON-RPC communication with VS Code |
| `SessionManager` | Tracks AI agent sessions |
| `FileTracker` | Detects and tracks file changes |
| `LogManager` | Stores and manages logs |
| `DiffEngine` | Computes file diffs |
| `PersistenceStore` | Saves data to disk |

## IPC Protocol

Inspector Hook uses **JSON-RPC 2.0** for communication between the VS Code extension and core process.

### Request Format

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "logs.getAll",
  "params": {
    "filter": {"level": "error"},
    "pagination": {"limit": 100}
  }
}
```

### Response Format

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "logs": [...],
    "total": 500,
    "offset": 0,
    "limit": 100
  }
}
```

### Available Methods

**Logs**:
- `logs.getAll` - Get all logs with optional filtering
- `logs.getStats` - Get log statistics

**Sessions**:
- `sessions.getAll` - Get all sessions
- `sessions.get` - Get single session by ID
- `sessions.getLogs` - Get logs for a session
- `sessions.delete` - Delete a session

**File Changes**:
- `fileChanges.getPending` - Get pending file changes
- `fileChanges.getDiff` - Get diff for a change
- `fileChanges.keep` - Keep (approve) a change
- `fileChanges.revert` - Revert a change
- `fileChanges.updateContent` - Update edited content

**History**:
- `history.getTrackedFiles` - Get all tracked files
- `history.getVersions` - Get version history for a file
- `history.getVersionContent` - Get content at specific version
- `history.compareVersions` - Compare two versions
- `history.restoreVersion` - Restore to a specific version
- `history.deleteVersion` - Delete a version

## Configuration

### VS Code Settings

Configure in VS Code settings (`settings.json`):

```json
{
  "inspectorHook.httpPort": 52376,
  "inspectorHook.autoStart": true,
  "inspectorHook.logRetentionDays": 7
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `httpPort` | 52376 | HTTP server port for receiving logs |
| `autoStart` | true | Auto-start core on extension activation |
| `logRetentionDays` | 7 | Days to retain logs |

### Storage Locations

- **macOS/Linux**: `~/.inspector-hook/`
- **Logs**: `~/.inspector-hook/logs/`
- **Sessions**: `~/.inspector-hook/sessions/`
- **Changes**: `~/.inspector-hook/changes/`
- **Port file**: `/tmp/inspector-hook.port`

## Documentation

### Phase Documents

| Phase | Document | Description |
|-------|----------|-------------|
| 0 | [Foundation](docs/phases/PHASE-0-FOUNDATION.md) | Project setup, tooling, monorepo structure |
| 1 | [Walking Skeleton](docs/phases/PHASE-1-WALKING-SKELETON.md) | Minimal E2E implementation |
| 2 | [Core Features](docs/phases/PHASE-2-CORE-FEATURES.md) | Session, file tracking, history |
| 3 | [UI Development](docs/phases/PHASE-3-UI-DEVELOPMENT.md) | Webview UI implementation |
| 4 | [Hooks Integration](docs/phases/PHASE-4-HOOKS-INTEGRATION.md) | Claude Code, OpenCode hooks |
| 5 | [Advanced Features](docs/phases/PHASE-5-ADVANCED-FEATURES.md) | Orchestration, rules engine |
| 6 | [Production](docs/phases/PHASE-6-PRODUCTION.md) | Hardening, packaging, release |

### Design Documents

| Document | Description |
|----------|-------------|
| [Architecture](docs/design/ARCHITECTURE.md) | System architecture, components, diagrams |
| [Data Models](docs/design/DATA_MODELS.md) | TypeScript interfaces, schemas |
| [API Contracts](docs/design/API_CONTRACTS.md) | IPC protocol, HTTP endpoints, message formats |

## Technology Stack

- **Core**: Node.js, TypeScript (strict mode)
- **IPC**: JSON-RPC 2.0 over stdio
- **HTTP**: Native Node.js HTTP server (zero dependencies)
- **UI**: Vanilla HTML/CSS/JS (no framework - maximum portability)
- **Build**: esbuild, TypeScript compiler
- **Monorepo**: pnpm workspaces

## Supported Platforms

### Current

- VS Code
- Cursor
- VS Codium

### Planned

- JetBrains IDEs (IntelliJ, WebStorm, PyCharm)
- Eclipse Theia
- Neovim

### AI Agents Supported

- Claude Code (via hooks)
- OpenCode (via plugins) - planned

## Troubleshooting

### Port Already in Use

If port 52376 is in use, the core **scans upward for the next free port** and writes the one it bound to the port file, so hooks still find it. It does not fail to start. If you want a specific port:

1. Change the port in VS Code settings
2. Kill the process using the port: `lsof -i :52376 | awk 'NR>1 {print $2}' | xargs kill`
3. Set `INSPECTOR_HOOK_HTTP_PORT=0` for auto-assignment

### Hooks Not Working

1. Verify hooks are installed: `jq '.hooks | keys' ~/.claude/settings.json`
   (the installer registers commands in `settings.json`; it copies no scripts into `~/.claude/`)
2. Check Claude Code settings: `cat ~/.claude/settings.json`
3. Verify hook permissions: `ls -l packages/hooks/claude/*.sh`
   (the hooks run from the repo; the installer registers their absolute paths
   rather than copying them into `~/.claude/`)
4. Check port file exists: `cat /tmp/inspector-hook.port`

### Extension Not Starting

1. Check VS Code Output panel (select "Inspector Hook")
2. Verify all packages are built: `pnpm build`
3. Check for TypeScript errors: `pnpm typecheck`

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run tests and linting: `pnpm test && pnpm lint`
5. Commit with conventional commits: `git commit -m "feat: add new feature"`
6. Push and create a pull request

## License

MIT
