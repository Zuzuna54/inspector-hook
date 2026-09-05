# Architecture Design Document

**Version**: 1.0.0
**Last Updated**: January 2026

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture Principles](#architecture-principles)
3. [System Architecture](#system-architecture)
4. [Component Design](#component-design)
5. [Communication Protocols](#communication-protocols)
6. [Data Flow](#data-flow)
7. [Deployment Architecture](#deployment-architecture)
8. [Security Architecture](#security-architecture)
9. [Scalability Considerations](#scalability-considerations)

---

## Overview

Inspector Hook is a universal AI agent monitoring and orchestration platform built using a **Shared Core + Thin Wrappers** architecture. This design enables:

- **Cross-IDE Support**: Same core logic across VS Code, JetBrains, Theia, etc.
- **Code Reuse**: 80%+ shared code between implementations
- **Consistent Behavior**: Identical features across all platforms
- **Easy Maintenance**: Single codebase for business logic

---

## Architecture Principles

### 1. Separation of Concerns

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        SEPARATION OF CONCERNS                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────┐                                                    │
│  │    CORE         │  Business logic, data management, computations     │
│  │    (Node.js)    │  - Platform agnostic                               │
│  │                 │  - No UI code                                      │
│  │                 │  - No IDE-specific APIs                            │
│  └─────────────────┘                                                    │
│           ▲                                                             │
│           │ IPC (JSON-RPC)                                              │
│           ▼                                                             │
│  ┌─────────────────┐                                                    │
│  │    WRAPPER      │  IDE integration, UI hosting                       │
│  │    (TS/Kotlin)  │  - IDE-specific APIs                               │
│  │                 │  - Webview management                              │
│  │                 │  - Command registration                            │
│  └─────────────────┘                                                    │
│           ▲                                                             │
│           │ postMessage                                                 │
│           ▼                                                             │
│  ┌─────────────────┐                                                    │
│  │    UI           │  User interface                                    │
│  │    (HTML/JS)    │  - Rendering                                       │
│  │                 │  - User interactions                               │
│  │                 │  - State management                                │
│  └─────────────────┘                                                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2. Single Responsibility

Each component has one clear responsibility:

| Component | Responsibility |
|-----------|---------------|
| HTTP Server | Receive hook logs |
| IPC Server | Communicate with wrappers |
| Session Manager | Track AI sessions |
| File Tracker | Monitor file changes |
| Version History | Maintain file versions |
| Archive Manager | Store kept changes |
| ~~Rules Engine~~ | **Not implemented.** Specified in Milestone 5, never built; `automation.ts` declares the types and nothing consumes them |
| ~~Staging Manager~~ | **Not implemented.** Same as above — `StagedChange` and `ApplyResult` are declared and unreferenced |

### 3. Event-Driven Architecture

All components communicate via events:

```typescript
// Example: File change flow
fileTracker.on('change:detected', (change) => {
  sessionManager.addFileChange(change.sessionId, change);
  versionHistory.addVersion(change.filePath, change.afterContent);
  rulesEngine.evaluate({ type: 'file.changed', ...change });
  ipcServer.broadcast({ type: 'file-change', change });
});
```

### 4. Protocol-First Design

All communication uses predefined protocols:

- **IPC Protocol**: JSON-RPC 2.0 over stdio
- **HTTP Protocol**: REST-like endpoints
- **UI Protocol**: Typed message passing

---

## System Architecture

### High-Level Architecture

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                           INSPECTOR HOOK SYSTEM                                │
├────────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                              AI AGENTS                                  │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │   │
│  │  │ Claude Code │  │  OpenCode   │  │   Cursor    │  │   Future    │     │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘     │   │
│  │         │                │                │                │            │   │
│  │         └────────────────┴────────────────┴────────────────┘            │   │
│  │                                   │                                     │   │
│  │                          Hook Scripts / Plugins                         │   │
│  │                                   │                                     │   │
│  └───────────────────────────────────┼─────────────────────────────────────┘   │
│                                      │                                         │
│                              HTTP POST /log                                    │
│                                      │                                         │
│  ┌───────────────────────────────────▼─────────────────────────────────────┐   │
│  │                           CORE PROCESS                                  │   │
│  │                           (Node.js)                                     │   │
│  │                                                                         │   │
│  │  ┌─────────────────────────────────────────────────────────────────┐    │   │
│  │  │                      INBOUND LAYER                              │    │   │
│  │  │  ┌─────────────┐  ┌─────────────────────────────────────────┐  │    │   │
│  │  │  │ HTTP Server │  │ IPC Server                              │  │    │   │
│  │  │  │ (Hooks)     │  │ (Wrappers; also pushes notifications)   │  │    │   │
│  │  │  └─────────────┘  └─────────────────────────────────────────┘  │    │   │
│  │  └─────────────────────────────────────────────────────────────────┘    │   │
│  │                                   │                                     │   │
│  │  ┌─────────────────────────────────────────────────────────────────┐    │   │
│  │  │                      BUSINESS LAYER                             │    │   │
│  │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │    │   │
│  │  │  │ Session     │  │ File        │  │ Version History         │  │    │   │
│  │  │  │ Manager     │  │ Tracker     │  │ Manager                 │  │    │   │
│  │  │  └─────────────┘  └─────────────┘  └─────────────────────────┘  │    │   │
│  │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │    │   │
│  │  │  │ Archive     │  │ Rules       │  │ Staging                 │  │    │   │
│  │  │  │ Manager     │  │ Engine      │  │ Manager                 │  │    │   │
│  │  │  └─────────────┘  └─────────────┘  └─────────────────────────┘  │    │   │
│  │  │  ┌─────────────┐  ┌─────────────┐                               │    │   │
│  │  │  │ Diff        │  │ Analytics   │                               │    │   │
│  │  │  │ Engine      │  │ Engine      │                               │    │   │
│  │  │  └─────────────┘  └─────────────┘                               │    │   │
│  │  └─────────────────────────────────────────────────────────────────┘    │   │
│  │                                   │                                     │   │
│  │  ┌─────────────────────────────────────────────────────────────────┐    │   │
│  │  │                      PERSISTENCE LAYER                          │    │   │
│  │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │    │   │
│  │  │  │ JSON Store  │  │ JSONL Logs  │  │ File Snapshots          │  │    │   │
│  │  │  └─────────────┘  └─────────────┘  └─────────────────────────┘  │    │   │
│  │  └─────────────────────────────────────────────────────────────────┘    │   │
│  │                                                                         │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                      │                                         │
│                          JSON-RPC over stdio                                   │
│                                      │                                         │
│  ┌───────────────────────────────────▼─────────────────────────────────────┐   │
│  │                           IDE WRAPPERS                                  │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │   │
│  │  │ VS Code     │  │ JetBrains   │  │ Theia       │  │ Neovim      │     │   │
│  │  │ (TypeScript)│  │ (Kotlin)    │  │ (TypeScript)│  │ (Lua)       │     │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘     │   │
│  │         │                │                │                │            │   │
│  │         └────────────────┴────────────────┴────────────────┘            │   │
│  │                                   │                                     │   │
│  │                            postMessage                                  │   │
│  │                                   │                                     │   │
│  │  ┌────────────────────────────────▼────────────────────────────────┐    │   │
│  │  │                         WEBVIEW UI                              │    │   │
│  │  │                    (HTML / CSS / JavaScript)                    │    │   │
│  │  │                                                                 │    │   │
│  │  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐    │    │   │
│  │  │  │Dashboard│ │  Logs   │ │Sessions │ │ Changes │ │ History │    │    │   │
│  │  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘    │    │   │
│  │  └─────────────────────────────────────────────────────────────────┘    │   │
│  │                                                                         │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                │
└────────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Design

### Core Process Components

#### 1. HTTP Server

**Responsibility**: Receive logs from AI agent hooks

```
Input:  HTTP POST /log (JSON payload)
Output: 200 OK / 4xx Error

Endpoints:
  POST /log          - Receive log entry
  POST /log - Notify file modification
  GET  /health       - Health check
```

#### 2. IPC Server

**Responsibility**: Handle requests from IDE wrappers

```
Protocol: JSON-RPC 2.0 over stdio
Direction: Bidirectional

Request:  { id, method, params }
Response: { id, result } or { id, error }
Event:    { type, data }
```

#### 3. Session Manager

**Responsibility**: Track AI agent sessions

```
State:
  - Active sessions
  - Completed sessions
  - Tool executions per session
  - File changes per session

Events:
  - session:created
  - session:ended
  - tool:started
  - tool:completed
```

#### 4. File Tracker

**Responsibility**: Monitor file modifications

```
State:
  - File snapshots (before state)
  - Pending changes
  - Change status (pending/kept/reverted)

Events:
  - change:detected
  - change:kept
  - change:reverted
```

#### 5. Version History Manager

**Responsibility**: Maintain file version history

```
State:
  - Version history per file
  - Content snapshots
  - Metadata (timestamp, session, hash)

Operations:
  - Add version
  - Get history
  - Compare versions
```

#### 6. Archive Manager

**Responsibility**: Store kept changes

```
State:
  - Archived changes
  - Original timestamps
  - Before/after content

Operations:
  - Archive change
  - Restore from archive
  - List archived
```

---

## Communication Protocols

### 1. Hook → Core (HTTP)

```
POST /log HTTP/1.1
Content-Type: application/json

{
  "timestamp": "2026-01-15T10:30:00.000Z",
  "hook": "PreToolUse",
  "event": "tool.start",
  "level": "info",
  "message": "Tool starting: Read",
  "sessionId": "abc-123",
  "tool": "Read",
  "file": "/path/to/file.ts",
  "details": {}
}

Response: 200 OK
```

### 2. Core ↔ Wrapper (IPC)

```
// Request (Wrapper → Core)
{"id": 1, "method": "getLogs", "params": {"limit": 100}}

// Response (Core → Wrapper)
{"id": 1, "result": [...logs]}

// Event (Core → Wrapper)
{"type": "log", "data": {...logEntry}}
```

### 3. Wrapper ↔ UI (postMessage)

```javascript
// Wrapper → UI
panel.webview.postMessage({
  type: 'logs',
  logs: [...]
});

// UI → Wrapper
vscode.postMessage({
  command: 'getDiff',
  changeId: 'abc-123'
});
```

---

## Data Flow

### Log Reception Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│    Hook     │────►│ HTTP Server │────►│  Log Store  │────►│ IPC Broadcast│
│   Script    │     │             │     │             │     │             │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                           │                   │
                           │                   ▼
                           │            ┌─────────────┐
                           │            │  Session    │
                           │            │  Manager    │
                           │            └─────────────┘
                           │                   │
                           │                   ▼
                           │            ┌─────────────┐
                           └───────────►│  Rules      │
                                        │  Engine     │
                                        └─────────────┘
```

### File Change Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  PostTool   │────►│    Core     │────►│   File      │
│   Hook      │     │  /file-chg  │     │  Tracker    │
└─────────────┘     └─────────────┘     └─────────────┘
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    │                         │                         │
                    ▼                         ▼                         ▼
             ┌─────────────┐          ┌─────────────┐          ┌─────────────┐
             │   Session   │          │   Version   │          │    IPC      │
             │   Manager   │          │   History   │          │  Broadcast  │
             └─────────────┘          └─────────────┘          └─────────────┘
```

---

## Deployment Architecture

### Package Structure

```
inspector-hook.vsix
├── extension/
│   ├── dist/
│   │   ├── extension.js       # VS Code wrapper
│   │   └── core/
│   │       └── index.js       # Bundled core
│   ├── media/
│   │   ├── index.html
│   │   ├── styles/
│   │   └── scripts/
│   └── hooks/
│       ├── install.sh
│       └── claude/
│           ├── lib/
│           ├── pre-tool-use.sh
│           └── post-tool-use.sh
└── package.json
```

### Runtime Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     VS Code Process                              │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                  Extension Host                            │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │              Inspector Hook Extension               │  │  │
│  │  │                                                     │  │  │
│  │  │  ┌─────────────┐      ┌────────────────────────┐   │  │  │
│  │  │  │  Core       │◄────►│  Core Process          │   │  │  │
│  │  │  │  Bridge     │ IPC  │  (child_process)       │   │  │  │
│  │  │  └─────────────┘      └────────────────────────┘   │  │  │
│  │  │         │                                          │  │  │
│  │  │         │ postMessage                              │  │  │
│  │  │         ▼                                          │  │  │
│  │  │  ┌─────────────────────────────────────────────┐   │  │  │
│  │  │  │              Webview Panel                  │   │  │  │
│  │  │  │              (iframe)                       │   │  │  │
│  │  │  └─────────────────────────────────────────────┘   │  │  │
│  │  │                                                     │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │                                                            │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

---

## Security Architecture

### Threat Model

| Threat | Mitigation |
|--------|------------|
| Malicious hook input | Input validation, sanitization |
| Path traversal | Path normalization, allowed roots |
| DoS via flooding | Rate limiting |
| Code injection | No eval, parameterized queries |
| Sensitive data leak | No secrets in logs |

### Security Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                      SECURITY LAYERS                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Layer 1: Transport Security                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ - localhost only (no network exposure)                   │   │
│  │ - No authentication (trusted local environment)          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Layer 2: Input Validation                                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ - Schema validation (Zod)                                │   │
│  │ - Path sanitization                                      │   │
│  │ - Size limits                                            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Layer 3: Rate Limiting                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ - Per-endpoint limits                                    │   │
│  │ - Sliding window                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Layer 4: Resource Protection                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ - Memory limits                                          │   │
│  │ - Log rotation                                           │   │
│  │ - Graceful degradation                                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Scalability Considerations

### Current Limits (Walking Skeleton)

| Resource | Limit | Rationale |
|----------|-------|-----------|
| Logs in memory | 10,000 | Reasonable for single session |
| Sessions | 100 | More than typical usage |
| File changes | 1,000 | Reasonable for project |
| Version history | **50** per file | Balance history vs memory. `file-tracker.ts:103` — the documented 100 was never the default |

### Future Scalability

For enterprise scale, consider:

1. **SQLite Backend**: Replace in-memory stores
2. **Worker Threads**: Offload heavy computation
3. **Streaming**: Process logs as streams
4. **Compression**: Compress stored content

---

## Diagrams

### C4 Context Diagram

```
┌───────────────────────────────────────────────────────────────────────────┐
│                              CONTEXT                                       │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│                         ┌─────────────┐                                   │
│                         │  Developer  │                                   │
│                         └──────┬──────┘                                   │
│                                │                                          │
│                         Uses   │                                          │
│                                ▼                                          │
│  ┌─────────────┐      ┌───────────────┐      ┌─────────────────────────┐ │
│  │ Claude Code │─────►│   Inspector   │◄────►│        IDE              │ │
│  │  (AI Agent) │ Logs │     Hook      │      │   (VS Code, etc)        │ │
│  └─────────────┘      └───────────────┘      └─────────────────────────┘ │
│                              │                                            │
│                              │ Reads/Writes                               │
│                              ▼                                            │
│                       ┌─────────────┐                                     │
│                       │ File System │                                     │
│                       └─────────────┘                                     │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

### C4 Container Diagram

```
┌───────────────────────────────────────────────────────────────────────────┐
│                            CONTAINERS                                      │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │                    Inspector Hook                                    │ │
│  │                                                                      │ │
│  │  ┌────────────────┐  ┌────────────────┐  ┌────────────────────────┐ │ │
│  │  │  Core Process  │  │  VS Code Ext   │  │     Webview UI         │ │ │
│  │  │  [Node.js]     │  │  [TypeScript]  │  │     [HTML/JS]          │ │ │
│  │  │                │  │                │  │                        │ │ │
│  │  │  - HTTP Server │◄─┤  - Core Bridge │◄─┤  - Dashboard           │ │ │
│  │  │  - IPC Server  │  │  - Panel Mgmt  │  │  - Logs View           │ │ │
│  │  │  - Managers    │  │  - Commands    │  │  - Sessions View       │ │ │
│  │  │  - Persistence │  │                │  │  - Changes View        │ │ │
│  │  │                │  │                │  │                        │ │ │
│  │  └────────────────┘  └────────────────┘  └────────────────────────┘ │ │
│  │         ▲                                                            │ │
│  │         │ HTTP                                                       │ │
│  │         │                                                            │ │
│  └─────────┼────────────────────────────────────────────────────────────┘ │
│            │                                                              │
│  ┌─────────┴────────┐                                                     │
│  │   Hook Scripts   │                                                     │
│  │   [Bash/Python]  │                                                     │
│  └──────────────────┘                                                     │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Core Runtime | Node.js | Ubiquitous, npm ecosystem |
| Core Language | TypeScript | Type safety, IDE support |
| IPC Protocol | JSON-RPC over stdio | Simple, standard, debuggable |
| HTTP Server | Native Node.js | No dependencies, minimal |
| UI Technology | Vanilla HTML/CSS/JS | Maximum portability |
| Build Tool | esbuild | Fast, simple |
| Monorepo Tool | pnpm workspaces | Native, efficient |
| Persistence | JSON/JSONL files | Simple, human-readable |

---

## References

- [Language Server Protocol](https://microsoft.github.io/language-server-protocol/)
- [VS Code Extension API](https://code.visualstudio.com/api)
- [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification)
- [C4 Model](https://c4model.com/)
