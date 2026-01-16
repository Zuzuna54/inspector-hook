# Phase 1: Walking Skeleton

**Duration**: 2 weeks
**Goal**: Create minimal end-to-end implementation connecting all architectural components

---

## What is a Walking Skeleton?

A walking skeleton is a minimal, end-to-end implementation that links together all the main architectural components. It is:

- **Minimal in features** but **complete in architecture**
- **Production code** (not a prototype)
- **Executable end-to-end**
- The foundation upon which all future features are built

> "A walking skeleton is an implementation of the thinnest possible slice of real functionality that we can automatically build, deploy, and test end-to-end." - Alistair Cockburn

---

## Objectives

1. Core process can start and listen for IPC connections
2. Core HTTP server can receive hook logs
3. VS Code extension can spawn and communicate with core
4. VS Code extension can display basic webview
5. Webview can receive and display logs from core
6. Complete round-trip: Hook → Core → VS Code → Webview

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           WALKING SKELETON                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────┐     HTTP POST /log     ┌─────────────────────────┐     │
│  │  Hook       │ ───────────────────►   │    CORE PROCESS         │     │
│  │  Script     │                        │    (Node.js)            │     │
│  └─────────────┘                        │                         │     │
│                                         │  ┌───────────────────┐  │     │
│                                         │  │ HTTP Server       │  │     │
│                                         │  │ :PORT (dynamic)   │  │     │
│                                         │  └───────────────────┘  │     │
│                                         │           │             │     │
│                                         │           ▼             │     │
│                                         │  ┌───────────────────┐  │     │
│                                         │  │ Log Store         │  │     │
│                                         │  │ (in-memory array) │  │     │
│                                         │  └───────────────────┘  │     │
│                                         │           │             │     │
│                                         │           ▼             │     │
│                                         │  ┌───────────────────┐  │     │
│                                         │  │ IPC Server        │  │     │
│                                         │  │ (JSON-RPC/stdio)  │  │     │
│                                         │  └───────────────────┘  │     │
│                                         └───────────┬─────────────┘     │
│                                                     │                   │
│                                          JSON-RPC over stdio            │
│                                                     │                   │
│                                         ┌───────────▼─────────────┐     │
│                                         │   VS CODE EXTENSION     │     │
│                                         │                         │     │
│                                         │  ┌───────────────────┐  │     │
│                                         │  │ Core Bridge       │  │     │
│                                         │  │ (spawn + IPC)     │  │     │
│                                         │  └───────────────────┘  │     │
│                                         │           │             │     │
│                                         │           ▼             │     │
│                                         │  ┌───────────────────┐  │     │
│                                         │  │ Webview Panel     │  │     │
│                                         │  │                   │  │     │
│                                         │  │  ┌─────────────┐  │  │     │
│                                         │  │  │ Log List    │  │  │     │
│                                         │  │  │ (HTML/JS)   │  │  │     │
│                                         │  │  └─────────────┘  │  │     │
│                                         │  └───────────────────┘  │     │
│                                         └─────────────────────────┘     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Deliverables

### 1. Core Process (`packages/core`)

**src/index.ts** - Main entry point

```typescript
import { createHttpServer } from "./server/http-server";
import { createIpcServer } from "./ipc/ipc-server";
import { LogStore } from "./stores/log-store";

export async function startCore(): Promise<void> {
  const logStore = new LogStore();

  // Start HTTP server for receiving hooks
  const httpServer = await createHttpServer(logStore);
  const port = httpServer.port;

  // Start IPC server for communication with wrappers
  const ipcServer = createIpcServer(logStore);

  // Write port to stdout for wrapper to read
  console.log(JSON.stringify({ type: "ready", port }));

  // Keep process alive
  process.stdin.resume();
}

// CLI entry
if (require.main === module) {
  startCore();
}
```

**src/server/http-server.ts** - HTTP server for hooks

```typescript
import { createServer, IncomingMessage, ServerResponse } from "http";
import { LogStore } from "../stores/log-store";

export interface HttpServer {
  port: number;
  close: () => void;
}

export async function createHttpServer(
  logStore: LogStore
): Promise<HttpServer> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.method === "POST" && req.url === "/log") {
        handleLogRequest(req, res, logStore);
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    // Listen on random available port
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" ? addr?.port ?? 0 : 0;
      resolve({ port, close: () => server.close() });
    });
  });
}
```

**src/ipc/ipc-server.ts** - JSON-RPC over stdio

```typescript
import { LogStore } from "../stores/log-store";
import { IpcMessage, IpcResponse } from "@inspector-hook/protocol";

export function createIpcServer(logStore: LogStore): void {
  const readline = require("readline");
  const rl = readline.createInterface({ input: process.stdin });

  rl.on("line", (line: string) => {
    try {
      const message: IpcMessage = JSON.parse(line);
      const response = handleMessage(message, logStore);
      process.stdout.write(JSON.stringify(response) + "\n");
    } catch (error) {
      // Silent fail for malformed messages
    }
  });
}

function handleMessage(message: IpcMessage, logStore: LogStore): IpcResponse {
  switch (message.method) {
    case "getLogs":
      return { id: message.id, result: logStore.getLogs() };
    case "getStats":
      return { id: message.id, result: logStore.getStats() };
    default:
      return { id: message.id, error: "Unknown method" };
  }
}
```

### 2. Protocol Package (`packages/protocol`)

**src/messages.ts** - IPC message types

```typescript
// Request from wrapper to core
export interface IpcMessage {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

// Response from core to wrapper
export interface IpcResponse {
  id: number;
  result?: unknown;
  error?: string;
}

// Event from core to wrapper (no id)
export interface IpcEvent {
  type: string;
  data: unknown;
}
```

**src/models.ts** - Data models

```typescript
export interface LogEntry {
  id: string;
  timestamp: string;
  hook: string;
  event: string;
  level: "info" | "warn" | "error" | "blocked";
  message: string;
  sessionId?: string;
  tool?: string;
  file?: string;
  details?: Record<string, unknown>;
}

export interface Stats {
  totalLogs: number;
  errors: number;
  warnings: number;
  blocked: number;
}
```

### 3. VS Code Extension (`packages/vscode`)

**src/extension.ts** - Extension entry

```typescript
import * as vscode from "vscode";
import { InspectorPanel } from "./panel";

let panel: InspectorPanel | undefined;

export function activate(context: vscode.ExtensionContext) {
  const showCommand = vscode.commands.registerCommand(
    "inspectorHook.showPanel",
    () => {
      if (panel) {
        panel.reveal();
      } else {
        panel = new InspectorPanel(context.extensionUri);
        panel.onDispose(() => {
          panel = undefined;
        });
      }
    }
  );

  context.subscriptions.push(showCommand);

  // Auto-show panel on activation
  vscode.commands.executeCommand("inspectorHook.showPanel");
}

export function deactivate() {
  panel?.dispose();
}
```

**src/core-bridge.ts** - Communication with core

```typescript
import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import { IpcMessage, IpcResponse, LogEntry } from "@inspector-hook/protocol";

export class CoreBridge {
  private process: ChildProcess | null = null;
  private port: number = 0;
  private messageId = 0;
  private pendingRequests = new Map<number, (response: IpcResponse) => void>();

  async start(extensionPath: string): Promise<number> {
    const corePath = path.join(
      extensionPath,
      "node_modules",
      "@inspector-hook/core",
      "dist",
      "index.js"
    );

    this.process = spawn("node", [corePath], {
      stdio: ["pipe", "pipe", "inherit"],
    });

    return new Promise((resolve, reject) => {
      this.process!.stdout!.once("data", (data: Buffer) => {
        const { type, port } = JSON.parse(data.toString().trim());
        if (type === "ready") {
          this.port = port;
          this.setupListeners();
          resolve(port);
        }
      });

      this.process!.on("error", reject);
    });
  }

  private setupListeners() {
    const readline = require("readline");
    const rl = readline.createInterface({ input: this.process!.stdout });

    rl.on("line", (line: string) => {
      try {
        const response: IpcResponse = JSON.parse(line);
        const resolver = this.pendingRequests.get(response.id);
        if (resolver) {
          this.pendingRequests.delete(response.id);
          resolver(response);
        }
      } catch {}
    });
  }

  async send(
    method: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    const id = ++this.messageId;
    const message: IpcMessage = { id, method, params };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, (response) => {
        if (response.error) reject(new Error(response.error));
        else resolve(response.result);
      });

      this.process!.stdin!.write(JSON.stringify(message) + "\n");
    });
  }

  async getLogs(): Promise<LogEntry[]> {
    return this.send("getLogs") as Promise<LogEntry[]>;
  }

  getPort(): number {
    return this.port;
  }

  stop() {
    this.process?.kill();
    this.process = null;
  }
}
```

**src/panel.ts** - Webview panel

```typescript
import * as vscode from "vscode";
import { CoreBridge } from "./core-bridge";

export class InspectorPanel {
  private panel: vscode.WebviewPanel;
  private bridge: CoreBridge;
  private disposables: vscode.Disposable[] = [];

  constructor(private extensionUri: vscode.Uri) {
    this.bridge = new CoreBridge();

    this.panel = vscode.window.createWebviewPanel(
      "inspectorHook",
      "Inspector Hook",
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    this.initialize();
  }

  private async initialize() {
    // Start core process
    const port = await this.bridge.start(this.extensionUri.fsPath);

    // Set webview HTML
    this.panel.webview.html = this.getHtml(port);

    // Handle messages from webview
    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case "getLogs":
            const logs = await this.bridge.getLogs();
            this.panel.webview.postMessage({ type: "logs", logs });
            break;
        }
      },
      null,
      this.disposables
    );

    // Poll for new logs
    this.startPolling();
  }

  private startPolling() {
    const interval = setInterval(async () => {
      const logs = await this.bridge.getLogs();
      this.panel.webview.postMessage({ type: "logs", logs });
    }, 1000);

    this.disposables.push({ dispose: () => clearInterval(interval) });
  }

  private getHtml(port: number): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: var(--vscode-font-family); padding: 10px; }
    .log { padding: 8px; border-bottom: 1px solid var(--vscode-panel-border); }
    .log.error { color: var(--vscode-errorForeground); }
    .log.warn { color: var(--vscode-editorWarning-foreground); }
    .log.blocked { color: var(--vscode-editorError-foreground); }
    .status { padding: 10px; background: var(--vscode-editor-background); margin-bottom: 10px; }
  </style>
</head>
<body>
  <div class="status">
    Inspector Hook - Port: ${port}
  </div>
  <div id="logs"></div>
  <script>
    const vscode = acquireVsCodeApi();

    window.addEventListener('message', event => {
      const { type, logs } = event.data;
      if (type === 'logs') {
        renderLogs(logs);
      }
    });

    function renderLogs(logs) {
      const container = document.getElementById('logs');
      container.innerHTML = logs.map(log =>
        '<div class="log ' + log.level + '">' +
          '<strong>' + log.hook + '</strong>: ' + log.message +
        '</div>'
      ).join('');
    }

    // Request initial logs
    vscode.postMessage({ command: 'getLogs' });
  </script>
</body>
</html>`;
  }

  reveal() {
    this.panel.reveal();
  }

  onDispose(callback: () => void) {
    this.panel.onDidDispose(callback);
  }

  dispose() {
    this.bridge.stop();
    this.disposables.forEach((d) => d.dispose());
    this.panel.dispose();
  }
}
```

### 4. Hook Scripts (`packages/hooks`)

**claude/lib/http-logger.sh**

```bash
#!/bin/bash
# Inspector Hook - HTTP Logger Library for Claude Code

# Read port from file
get_inspector_port() {
    local port_file="/tmp/inspector-hook.port"
    if [[ -f "$port_file" ]]; then
        cat "$port_file"
    else
        echo ""
    fi
}

# Send log to Inspector Hook
hook_log() {
    local level="${1:-info}"
    local message="${2:-}"
    local port=$(get_inspector_port)

    if [[ -z "$port" ]]; then
        return 0
    fi

    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
    local hook="${HOOK_NAME:-unknown}"

    curl -s -X POST "http://localhost:$port/log" \
        -H "Content-Type: application/json" \
        -d "{\"timestamp\":\"$timestamp\",\"hook\":\"$hook\",\"level\":\"$level\",\"message\":\"$message\"}" \
        --max-time 1 \
        > /dev/null 2>&1 &
}
```

**claude/pre-tool-use.sh**

```bash
#!/bin/bash
# Pre-tool-use hook for Claude Code

HOOK_NAME="PreToolUse"
source "$(dirname "$0")/lib/http-logger.sh"

# Read tool info from stdin
read -r input
tool=$(echo "$input" | jq -r '.tool_name // "unknown"')

hook_log "info" "Tool starting: $tool"

# Always allow (exit 0)
exit 0
```

---

## Tasks

### Task 1.1: Implement Core HTTP Server

- [ ] Create http-server.ts
- [ ] Listen on dynamic port
- [ ] Handle POST /log endpoint
- [ ] Parse and store log entries
- [ ] Return port on stdout

### Task 1.2: Implement Core IPC Server

- [ ] Create ipc-server.ts
- [ ] Read JSON messages from stdin
- [ ] Implement getLogs method
- [ ] Implement getStats method
- [ ] Write responses to stdout

### Task 1.3: Implement Log Store

- [ ] Create log-store.ts
- [ ] Store logs in memory array
- [ ] Implement getLogs()
- [ ] Implement addLog()
- [ ] Implement getStats()

### Task 1.4: Implement VS Code Core Bridge

- [ ] Create core-bridge.ts
- [ ] Spawn core process
- [ ] Read port from core
- [ ] Implement request/response over stdio
- [ ] Handle process lifecycle

### Task 1.5: Implement VS Code Panel

- [ ] Create panel.ts
- [ ] Initialize core bridge
- [ ] Generate webview HTML
- [ ] Handle webview messages
- [ ] Implement log polling

### Task 1.6: Create Hook Scripts

- [ ] Create http-logger.sh library
- [ ] Create pre-tool-use.sh hook
- [ ] Create post-tool-use.sh hook
- [ ] Test hook → core → webview flow

### Task 1.7: End-to-End Verification

- [ ] Start VS Code extension
- [ ] Verify core process spawns
- [ ] Send test log via curl
- [ ] Verify log appears in webview
- [ ] Test with real Claude Code hook

---

## Acceptance Criteria

1. **Core Starts Successfully**

   - Core process starts without errors
   - HTTP server binds to available port
   - Port is communicated to parent process

2. **Hook → Core Communication**

   - POST /log accepts JSON payload
   - Log is stored in memory
   - No errors in hook script execution

3. **Core → VS Code Communication**

   - VS Code spawns core process
   - VS Code reads port from core
   - getLogs IPC call returns logs

4. **VS Code → Webview Communication**

   - Webview loads without errors
   - Logs display in webview
   - Polling updates logs automatically

5. **End-to-End Flow**
   - Hook sends log
   - Log appears in webview within 2 seconds
   - Multiple logs display correctly

---

## Test Scenarios

### Scenario 1: Manual curl test

```bash
# Write port file
echo "12345" > /tmp/inspector-hook.port

# Send test log
curl -X POST http://localhost:12345/log \
  -H "Content-Type: application/json" \
  -d '{"timestamp":"2024-01-01T00:00:00Z","hook":"test","level":"info","message":"Hello"}'
```

### Scenario 2: Hook script test

```bash
export HOOK_NAME="TestHook"
source packages/hooks/claude/lib/http-logger.sh
hook_log "info" "Test message"
```

### Scenario 3: Full integration

1. Open VS Code with extension
2. Run Claude Code with hooks installed
3. Execute a tool (e.g., Read file)
4. Verify log appears in Inspector Hook panel

---

## Success Metrics

- [ ] Core process starts in < 500ms
- [ ] Hook log delivery < 100ms
- [ ] Webview update latency < 1 second
- [ ] Zero memory leaks in 1-hour test
- [ ] Works on macOS and Linux
