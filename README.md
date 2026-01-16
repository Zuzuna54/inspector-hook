# Inspector Hook

**Universal AI Agent Monitoring & Orchestration Platform**

Inspector Hook is a cross-IDE monitoring and orchestration tool for AI coding assistants. It provides real-time visibility into AI agent operations, file changes, session management, and workflow orchestration.

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

## Project Structure

```
inspector-hook/
├── docs/
│   ├── phases/                    # Development phase documents
│   │   ├── PHASE-0-FOUNDATION.md
│   │   ├── PHASE-1-WALKING-SKELETON.md
│   │   ├── PHASE-2-CORE-FEATURES.md
│   │   ├── PHASE-3-UI-DEVELOPMENT.md
│   │   ├── PHASE-4-HOOKS-INTEGRATION.md
│   │   ├── PHASE-5-ADVANCED-FEATURES.md
│   │   └── PHASE-6-PRODUCTION.md
│   └── design/                    # Technical design documents
│       ├── ARCHITECTURE.md
│       ├── DATA_MODELS.md
│       └── API_CONTRACTS.md
├── packages/
│   ├── core/                      # Shared core logic (Node.js)
│   ├── protocol/                  # Shared types and protocols
│   ├── vscode/                    # VS Code extension wrapper
│   └── hooks/                     # Hook scripts for AI agents
├── package.json                   # Root workspace config
├── pnpm-workspace.yaml           # pnpm workspace definition
└── tsconfig.base.json            # Shared TypeScript config
```

## Quick Start

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run in development mode
pnpm dev

# Package VS Code extension
pnpm --filter @inspector-hook/vscode package
```

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

- **Core**: Node.js, TypeScript
- **IPC**: JSON-RPC 2.0 over stdio
- **HTTP**: Native Node.js HTTP server (no dependencies)
- **UI**: Vanilla HTML/CSS/JS (no framework - maximum portability)
- **Build**: esbuild, TypeScript
- **Monorepo**: pnpm workspaces

## Supported Platforms

### Current
- VS Code / Cursor / VS Codium

### Planned
- JetBrains IDEs (IntelliJ, WebStorm, PyCharm)
- Eclipse Theia
- Neovim

### AI Agents Supported
- Claude Code (via hooks)
- OpenCode (via plugins) - planned

## License

MIT
