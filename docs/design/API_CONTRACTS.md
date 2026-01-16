# API Contracts Design Document

**Version**: 1.0.0
**Last Updated**: January 2026

---

## Table of Contents

1. [Overview](#overview)
2. [IPC Protocol (JSON-RPC 2.0)](#ipc-protocol-json-rpc-20)
3. [HTTP API](#http-api)
4. [WebSocket Protocol](#websocket-protocol)
5. [Webview Message Protocol](#webview-message-protocol)
6. [Error Codes](#error-codes)
7. [Versioning Strategy](#versioning-strategy)

---

## Overview

Inspector Hook uses multiple communication protocols between its components:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          COMMUNICATION LAYERS                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐    HTTP POST     ┌─────────────────────────────────────┐  │
│  │   Hooks     │─────────────────▶│           CORE PROCESS              │  │
│  │  (Bash)     │   /api/log       │                                     │  │
│  └─────────────┘                  │  ┌─────────┐  ┌─────────────────┐  │  │
│                                   │  │ HTTP    │  │ IPC Server      │  │  │
│  ┌─────────────┐    JSON-RPC      │  │ Server  │  │ (JSON-RPC 2.0)  │  │  │
│  │  VS Code    │◀────────────────▶│  └─────────┘  └─────────────────┘  │  │
│  │  Wrapper    │     stdio        │                                     │  │
│  └─────────────┘                  │  ┌─────────────────────────────┐   │  │
│        │                          │  │      WebSocket Server       │   │  │
│        │ postMessage              │  │     (Real-time Events)      │   │  │
│        ▼                          │  └─────────────────────────────┘   │  │
│  ┌─────────────┐                  └─────────────────────────────────────┘  │
│  │  Webview    │                                    │                      │
│  │    UI       │◀───────────────────────────────────┘                      │
│  └─────────────┘        WebSocket                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Protocol Summary

| Protocol | Transport | Direction | Purpose |
|----------|-----------|-----------|---------|
| HTTP REST | TCP :52376 | Hooks → Core | Log ingestion |
| JSON-RPC 2.0 | stdio | Wrapper ↔ Core | Bidirectional commands |
| WebSocket | TCP :52377 | Core → UI | Real-time events |
| postMessage | VS Code IPC | Wrapper ↔ Webview | UI commands |

---

## IPC Protocol (JSON-RPC 2.0)

The core process and IDE wrappers communicate via JSON-RPC 2.0 over stdio.

### Transport

- **stdin**: Core receives requests from wrapper
- **stdout**: Core sends responses and notifications to wrapper
- **Encoding**: UTF-8
- **Framing**: Newline-delimited JSON (`\n` separator)

### Message Format

**Request**
```typescript
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;      // Unique request ID
  method: string;           // Method name
  params?: unknown;         // Method parameters
}
```

**Response (Success)**
```typescript
interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;      // Matches request ID
  result: unknown;          // Method result
}
```

**Response (Error)**
```typescript
interface JsonRpcError {
  jsonrpc: '2.0';
  id: string | number;
  error: {
    code: number;           // Error code
    message: string;        // Human-readable message
    data?: unknown;         // Additional error data
  };
}
```

**Notification (No response expected)**
```typescript
interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}
```

---

### IPC Methods

#### Core Management

##### `core.initialize`

Initialize the core process with configuration.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "core.initialize",
  "params": {
    "workspaceRoot": "/path/to/workspace",
    "storagePath": "/path/to/storage",
    "config": {
      "httpPort": 52376,
      "wsPort": 52377,
      "logRetentionDays": 7,
      "maxLogsInMemory": 10000
    }
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "success": true,
    "version": "1.0.0",
    "httpPort": 52376,
    "wsPort": 52377
  }
}
```

##### `core.shutdown`

Gracefully shutdown the core process.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "core.shutdown",
  "params": {}
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "success": true
  }
}
```

##### `core.getStatus`

Get core process status and statistics.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "core.getStatus",
  "params": {}
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "status": "running",
    "uptime": 3600,
    "httpPort": 52376,
    "wsPort": 52377,
    "stats": {
      "totalLogs": 1234,
      "activeSessions": 2,
      "pendingChanges": 5,
      "errors": 3,
      "warnings": 12,
      "blocked": 1
    }
  }
}
```

---

#### Log Operations

##### `logs.getAll`

Retrieve logs with optional filtering.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 10,
  "method": "logs.getAll",
  "params": {
    "filter": {
      "sessionId": "abc-123",
      "hook": "PreToolUse",
      "level": "error",
      "startTime": "2026-01-15T00:00:00Z",
      "endTime": "2026-01-16T00:00:00Z",
      "search": "file.ts"
    },
    "pagination": {
      "offset": 0,
      "limit": 100
    },
    "sort": {
      "field": "timestamp",
      "order": "desc"
    }
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 10,
  "result": {
    "logs": [
      {
        "id": "log-123",
        "timestamp": "2026-01-15T10:00:00.000Z",
        "hook": "PreToolUse",
        "event": "tool.start",
        "level": "info",
        "message": "Starting Edit tool",
        "sessionId": "abc-123",
        "tool": "Edit",
        "file": "/path/to/file.ts",
        "details": {}
      }
    ],
    "total": 500,
    "offset": 0,
    "limit": 100
  }
}
```

##### `logs.getById`

Get a single log entry by ID.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 11,
  "method": "logs.getById",
  "params": {
    "id": "log-123"
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 11,
  "result": {
    "id": "log-123",
    "timestamp": "2026-01-15T10:00:00.000Z",
    "hook": "PreToolUse",
    "event": "tool.start",
    "level": "info",
    "message": "Starting Edit tool",
    "sessionId": "abc-123",
    "tool": "Edit",
    "file": "/path/to/file.ts",
    "details": {
      "input": {
        "file_path": "/path/to/file.ts",
        "old_string": "const x = 1",
        "new_string": "const x = 2"
      }
    }
  }
}
```

##### `logs.clear`

Clear logs with optional filter.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 12,
  "method": "logs.clear",
  "params": {
    "filter": {
      "sessionId": "abc-123",
      "olderThan": "2026-01-14T00:00:00Z"
    }
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 12,
  "result": {
    "cleared": 150
  }
}
```

##### `logs.getStats`

Get log statistics.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 13,
  "method": "logs.getStats",
  "params": {}
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 13,
  "result": {
    "totalLogs": 1234,
    "errors": 23,
    "warnings": 56,
    "blocked": 5,
    "logsPerMinute": 12.5,
    "activeSessions": 2,
    "pendingChanges": 8
  }
}
```

---

#### Session Operations

##### `sessions.getAll`

Get all sessions.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 20,
  "method": "sessions.getAll",
  "params": {
    "status": "active",
    "limit": 50
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 20,
  "result": {
    "sessions": [
      {
        "id": "abc-123",
        "status": "active",
        "startTime": "2026-01-15T10:00:00.000Z",
        "toolExecutions": [],
        "fileChanges": ["change-1", "change-2"],
        "metadata": {
          "workingDirectory": "/path/to/project",
          "projectName": "my-project"
        }
      }
    ]
  }
}
```

##### `sessions.getById`

Get a single session by ID.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 21,
  "method": "sessions.getById",
  "params": {
    "id": "abc-123"
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 21,
  "result": {
    "id": "abc-123",
    "status": "active",
    "startTime": "2026-01-15T10:00:00.000Z",
    "toolExecutions": [
      {
        "id": "exec-1",
        "tool": "Edit",
        "input": { "file_path": "/path/to/file.ts" },
        "startTime": "2026-01-15T10:01:00.000Z",
        "endTime": "2026-01-15T10:01:05.000Z",
        "status": "completed",
        "affectedFiles": ["/path/to/file.ts"]
      }
    ],
    "fileChanges": ["change-1"],
    "metadata": {}
  }
}
```

##### `sessions.terminate`

Terminate an active session.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 22,
  "method": "sessions.terminate",
  "params": {
    "id": "abc-123",
    "reason": "User requested termination"
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 22,
  "result": {
    "success": true,
    "terminatedAt": "2026-01-15T10:30:00.000Z"
  }
}
```

##### `sessions.delete`

Delete a session and all associated data (logs, file changes, history).

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 23,
  "method": "sessions.delete",
  "params": {
    "id": "abc-123",
    "deleteAssociatedData": true
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 23,
  "result": {
    "success": true,
    "deletedLogs": 150,
    "deletedFileChanges": 12,
    "deletedAt": "2026-01-15T10:30:00.000Z"
  }
}
```

##### `sessions.clear`

Clear all sessions with optional filter.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 24,
  "method": "sessions.clear",
  "params": {
    "filter": {
      "status": "completed",
      "olderThan": "2026-01-14T00:00:00Z"
    },
    "deleteAssociatedData": true
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 24,
  "result": {
    "success": true,
    "deletedSessions": 15,
    "deletedLogs": 2500,
    "deletedFileChanges": 45,
    "clearedAt": "2026-01-15T10:30:00.000Z"
  }
}
```

##### `sessions.getStats`

Get statistics for a specific session.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 25,
  "method": "sessions.getStats",
  "params": {
    "id": "abc-123"
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 25,
  "result": {
    "sessionId": "abc-123",
    "status": "completed",
    "duration": 1800,
    "logCount": 150,
    "toolExecutions": 45,
    "fileChangesCount": 12,
    "errors": 2,
    "warnings": 5,
    "blocked": 0
  }
}
```

---

#### File Change Operations

##### `fileChanges.getPending`

Get all pending file changes.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 30,
  "method": "fileChanges.getPending",
  "params": {
    "sessionId": "abc-123",
    "groupBySession": true
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 30,
  "result": {
    "changes": [
      {
        "id": "change-1",
        "filePath": "/path/to/file.ts",
        "sessionId": "abc-123",
        "timestamp": "2026-01-15T10:05:00.000Z",
        "beforeContent": "const x = 1;",
        "afterContent": "const x = 2;",
        "status": "pending",
        "tool": "Edit"
      }
    ],
    "groupedBySession": {
      "abc-123": ["change-1", "change-2"],
      "def-456": ["change-3"]
    }
  }
}
```

##### `fileChanges.getDiff`

Get diff for a specific change.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 31,
  "method": "fileChanges.getDiff",
  "params": {
    "changeId": "change-1"
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 31,
  "result": {
    "changeId": "change-1",
    "filePath": "/path/to/file.ts",
    "beforeContent": "const x = 1;",
    "afterContent": "const x = 2;",
    "hunks": [
      {
        "id": "hunk-1",
        "oldStart": 1,
        "oldLines": 1,
        "newStart": 1,
        "newLines": 1,
        "lines": [
          { "type": "removed", "content": "const x = 1;", "lineNumber": 1 },
          { "type": "added", "content": "const x = 2;", "lineNumber": 1 }
        ],
        "additions": 1,
        "deletions": 1,
        "status": "pending"
      }
    ],
    "additions": 1,
    "deletions": 1
  }
}
```

##### `fileChanges.keep`

Keep (accept) a file change.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 32,
  "method": "fileChanges.keep",
  "params": {
    "changeId": "change-1"
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 32,
  "result": {
    "success": true,
    "archivedAt": "2026-01-15T10:10:00.000Z"
  }
}
```

##### `fileChanges.revert`

Revert a file change.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 33,
  "method": "fileChanges.revert",
  "params": {
    "changeId": "change-1"
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 33,
  "result": {
    "success": true,
    "revertedAt": "2026-01-15T10:10:00.000Z",
    "filePath": "/path/to/file.ts"
  }
}
```

##### `fileChanges.keepAll`

Keep all pending changes.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 34,
  "method": "fileChanges.keepAll",
  "params": {
    "sessionId": "abc-123"
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 34,
  "result": {
    "success": true,
    "count": 5,
    "archivedAt": "2026-01-15T10:10:00.000Z"
  }
}
```

##### `fileChanges.revertAll`

Revert all pending changes.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 35,
  "method": "fileChanges.revertAll",
  "params": {
    "sessionId": "abc-123"
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 35,
  "result": {
    "success": true,
    "count": 5,
    "revertedAt": "2026-01-15T10:10:00.000Z"
  }
}
```

##### `fileChanges.delete`

Delete a specific file change record (does not modify the file).

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 36,
  "method": "fileChanges.delete",
  "params": {
    "changeId": "change-1"
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 36,
  "result": {
    "success": true,
    "deletedAt": "2026-01-15T10:15:00.000Z"
  }
}
```

##### `fileChanges.clear`

Clear file change records with optional filter.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 37,
  "method": "fileChanges.clear",
  "params": {
    "filter": {
      "sessionId": "abc-123",
      "status": "pending",
      "olderThan": "2026-01-14T00:00:00Z"
    }
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 37,
  "result": {
    "success": true,
    "deleted": 25,
    "clearedAt": "2026-01-15T10:15:00.000Z"
  }
}
```

##### `fileChanges.getAll`

Get all file changes (pending, kept, reverted) with optional filtering.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 38,
  "method": "fileChanges.getAll",
  "params": {
    "filter": {
      "sessionId": "abc-123",
      "status": ["pending", "kept"],
      "filePath": "/path/to/file.ts"
    },
    "pagination": {
      "offset": 0,
      "limit": 100
    },
    "sort": {
      "field": "timestamp",
      "order": "desc"
    }
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 38,
  "result": {
    "changes": [
      {
        "id": "change-1",
        "filePath": "/path/to/file.ts",
        "sessionId": "abc-123",
        "timestamp": "2026-01-15T10:05:00.000Z",
        "status": "pending",
        "changeType": "modify",
        "tool": "Edit",
        "additions": 5,
        "deletions": 2
      }
    ],
    "total": 150,
    "offset": 0,
    "limit": 100
  }
}
```

##### `fileChanges.getById`

Get a specific file change by ID.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 39,
  "method": "fileChanges.getById",
  "params": {
    "id": "change-1"
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 39,
  "result": {
    "id": "change-1",
    "filePath": "/path/to/file.ts",
    "sessionId": "abc-123",
    "timestamp": "2026-01-15T10:05:00.000Z",
    "status": "pending",
    "changeType": "modify",
    "tool": "Edit",
    "beforeContent": "const x = 1;",
    "afterContent": "const x = 2;",
    "additions": 1,
    "deletions": 1
  }
}
```

---

#### Version History Operations

##### `history.getTrackedFiles`

Get list of files with version history.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 40,
  "method": "history.getTrackedFiles",
  "params": {}
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 40,
  "result": {
    "files": [
      {
        "filePath": "/path/to/file.ts",
        "versionCount": 12,
        "lastModified": "2026-01-15T10:00:00.000Z"
      }
    ]
  }
}
```

##### `history.getVersions`

Get version history for a file.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 41,
  "method": "history.getVersions",
  "params": {
    "filePath": "/path/to/file.ts",
    "limit": 50
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 41,
  "result": {
    "filePath": "/path/to/file.ts",
    "versions": [
      {
        "id": "v12",
        "versionNumber": 12,
        "timestamp": "2026-01-15T10:00:00.000Z",
        "sessionId": "abc-123",
        "hash": "abc123...",
        "size": 1024
      }
    ],
    "versionCount": 12
  }
}
```

##### `history.getVersionContent`

Get content of a specific version.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 42,
  "method": "history.getVersionContent",
  "params": {
    "filePath": "/path/to/file.ts",
    "versionNumber": 10
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 42,
  "result": {
    "filePath": "/path/to/file.ts",
    "versionNumber": 10,
    "content": "// File content here...",
    "timestamp": "2026-01-15T09:00:00.000Z"
  }
}
```

##### `history.compareVersions`

Compare two versions.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 43,
  "method": "history.compareVersions",
  "params": {
    "filePath": "/path/to/file.ts",
    "version1": 10,
    "version2": 12
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 43,
  "result": {
    "filePath": "/path/to/file.ts",
    "version1": 10,
    "version2": 12,
    "diff": {
      "hunks": [...],
      "additions": 5,
      "deletions": 2
    }
  }
}
```

##### `history.restoreVersion`

Restore a file to a previous version.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 44,
  "method": "history.restoreVersion",
  "params": {
    "filePath": "/path/to/file.ts",
    "versionNumber": 10
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 44,
  "result": {
    "success": true,
    "restoredAt": "2026-01-15T10:15:00.000Z",
    "newVersionNumber": 13
  }
}
```

##### `history.deleteVersion`

Delete a specific version from history.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 45,
  "method": "history.deleteVersion",
  "params": {
    "filePath": "/path/to/file.ts",
    "versionNumber": 5
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 45,
  "result": {
    "success": true,
    "deletedAt": "2026-01-15T10:20:00.000Z",
    "remainingVersions": 11
  }
}
```

##### `history.deleteFile`

Delete all version history for a specific file.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 46,
  "method": "history.deleteFile",
  "params": {
    "filePath": "/path/to/file.ts"
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 46,
  "result": {
    "success": true,
    "deletedVersions": 12,
    "deletedAt": "2026-01-15T10:20:00.000Z"
  }
}
```

##### `history.clear`

Clear all version history with optional filter.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 47,
  "method": "history.clear",
  "params": {
    "filter": {
      "olderThan": "2026-01-10T00:00:00Z",
      "maxVersionsPerFile": 10
    }
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 47,
  "result": {
    "success": true,
    "deletedFiles": 5,
    "deletedVersions": 150,
    "clearedAt": "2026-01-15T10:20:00.000Z"
  }
}
```

##### `history.getStats`

Get version history statistics.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 48,
  "method": "history.getStats",
  "params": {}
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 48,
  "result": {
    "trackedFiles": 25,
    "totalVersions": 450,
    "totalSize": 10485760,
    "oldestVersion": "2026-01-10T10:00:00.000Z",
    "newestVersion": "2026-01-15T10:00:00.000Z"
  }
}
```

---

#### Archive Operations

##### `archive.getAll`

Get all archived changes.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 50,
  "method": "archive.getAll",
  "params": {
    "limit": 100,
    "offset": 0
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 50,
  "result": {
    "changes": [
      {
        "id": "change-1",
        "filePath": "/path/to/file.ts",
        "sessionId": "abc-123",
        "archivedAt": "2026-01-15T10:10:00.000Z",
        "originalTimestamp": "2026-01-15T10:05:00.000Z",
        "beforeContent": "const x = 1;",
        "afterContent": "const x = 2;"
      }
    ],
    "total": 50
  }
}
```

##### `archive.restoreFromArchive`

Restore a change from archive.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 51,
  "method": "archive.restoreFromArchive",
  "params": {
    "changeId": "change-1"
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 51,
  "result": {
    "success": true,
    "restoredAt": "2026-01-15T10:20:00.000Z",
    "filePath": "/path/to/file.ts"
  }
}
```

##### `archive.getById`

Get a specific archived change by ID.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 52,
  "method": "archive.getById",
  "params": {
    "id": "change-1"
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 52,
  "result": {
    "id": "change-1",
    "filePath": "/path/to/file.ts",
    "sessionId": "abc-123",
    "archivedAt": "2026-01-15T10:10:00.000Z",
    "originalTimestamp": "2026-01-15T10:05:00.000Z",
    "changeType": "modify",
    "tool": "Edit",
    "beforeContent": "const x = 1;",
    "afterContent": "const x = 2;",
    "additions": 1,
    "deletions": 1
  }
}
```

##### `archive.delete`

Delete a specific archived change.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 53,
  "method": "archive.delete",
  "params": {
    "id": "change-1"
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 53,
  "result": {
    "success": true,
    "deletedAt": "2026-01-15T10:25:00.000Z"
  }
}
```

##### `archive.clear`

Clear archived changes with optional filter.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 54,
  "method": "archive.clear",
  "params": {
    "filter": {
      "sessionId": "abc-123",
      "olderThan": "2026-01-10T00:00:00Z"
    }
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 54,
  "result": {
    "success": true,
    "deleted": 35,
    "clearedAt": "2026-01-15T10:25:00.000Z"
  }
}
```

##### `archive.getDiff`

Get diff for an archived change.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 55,
  "method": "archive.getDiff",
  "params": {
    "id": "change-1"
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 55,
  "result": {
    "changeId": "change-1",
    "filePath": "/path/to/file.ts",
    "beforeContent": "const x = 1;",
    "afterContent": "const x = 2;",
    "hunks": [
      {
        "oldStart": 1,
        "oldLines": 1,
        "newStart": 1,
        "newLines": 1,
        "lines": [
          { "type": "removed", "content": "const x = 1;", "lineNumber": 1 },
          { "type": "added", "content": "const x = 2;", "lineNumber": 1 }
        ]
      }
    ],
    "additions": 1,
    "deletions": 1
  }
}
```

##### `archive.getStats`

Get archive statistics.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 56,
  "method": "archive.getStats",
  "params": {}
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 56,
  "result": {
    "totalArchived": 150,
    "totalSessions": 12,
    "totalFiles": 45,
    "totalSize": 2097152,
    "oldestArchive": "2026-01-10T10:00:00.000Z",
    "newestArchive": "2026-01-15T10:00:00.000Z"
  }
}
```

---

#### Rules Operations

##### `rules.getAll`

Get all rules.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 60,
  "method": "rules.getAll",
  "params": {}
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 60,
  "result": {
    "rules": [
      {
        "id": "rule-1",
        "name": "Block dangerous commands",
        "enabled": true,
        "priority": 100,
        "condition": {
          "type": "and",
          "conditions": [
            { "type": "tool_name", "value": "Bash" },
            { "type": "message_pattern", "value": "rm -rf" }
          ]
        },
        "action": {
          "type": "block",
          "params": { "message": "Dangerous command blocked" }
        },
        "stopOnMatch": true
      }
    ]
  }
}
```

##### `rules.create`

Create a new rule.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 61,
  "method": "rules.create",
  "params": {
    "name": "Auto-keep test files",
    "enabled": true,
    "priority": 50,
    "condition": {
      "type": "file_pattern",
      "value": ".*\\.test\\.ts$"
    },
    "action": {
      "type": "auto_keep"
    },
    "stopOnMatch": false
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 61,
  "result": {
    "id": "rule-2",
    "name": "Auto-keep test files",
    "enabled": true,
    "priority": 50,
    "condition": {
      "type": "file_pattern",
      "value": ".*\\.test\\.ts$"
    },
    "action": {
      "type": "auto_keep"
    },
    "stopOnMatch": false,
    "createdAt": "2026-01-15T10:00:00.000Z",
    "updatedAt": "2026-01-15T10:00:00.000Z"
  }
}
```

##### `rules.update`

Update an existing rule.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 62,
  "method": "rules.update",
  "params": {
    "id": "rule-2",
    "enabled": false
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 62,
  "result": {
    "id": "rule-2",
    "enabled": false,
    "updatedAt": "2026-01-15T10:30:00.000Z"
  }
}
```

##### `rules.delete`

Delete a rule.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 63,
  "method": "rules.delete",
  "params": {
    "id": "rule-2"
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 63,
  "result": {
    "success": true
  }
}
```

---

#### Hook Management Operations

##### `hooks.getAll`

Get all installed hooks.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 80,
  "method": "hooks.getAll",
  "params": {
    "category": "logging",
    "enabled": true
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 80,
  "result": {
    "hooks": [
      {
        "id": "pre-tool-logger",
        "name": "Pre-Tool Logger",
        "description": "Logs tool executions to Inspector Hook",
        "event": "PreToolUse",
        "command": "~/.inspector-hook/hooks/scripts/logging/pre-tool-logger.sh",
        "enabled": true,
        "timeout": 5000,
        "category": "logging",
        "priority": 100,
        "builtIn": true,
        "installStatus": "installed",
        "scriptPath": "~/.inspector-hook/hooks/scripts/logging/pre-tool-logger.sh",
        "createdAt": "2026-01-15T10:00:00.000Z",
        "updatedAt": "2026-01-15T10:00:00.000Z"
      }
    ],
    "total": 20
  }
}
```

##### `hooks.getById`

Get a single hook by ID.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 81,
  "method": "hooks.getById",
  "params": {
    "id": "security-gate"
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 81,
  "result": {
    "id": "security-gate",
    "name": "Security Gate",
    "description": "Blocks dangerous commands",
    "event": "PreToolUse",
    "command": "~/.inspector-hook/hooks/scripts/security/security-gate.py",
    "enabled": true,
    "timeout": 10000,
    "matchers": [{"tool_name": "Bash"}],
    "category": "security",
    "priority": 1000,
    "builtIn": true,
    "installStatus": "installed",
    "scriptPath": "~/.inspector-hook/hooks/scripts/security/security-gate.py",
    "executionCount": 150,
    "lastExecuted": "2026-01-15T10:30:00.000Z",
    "createdAt": "2026-01-15T10:00:00.000Z",
    "updatedAt": "2026-01-15T10:00:00.000Z"
  }
}
```

##### `hooks.create`

Create a new custom hook.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 82,
  "method": "hooks.create",
  "params": {
    "name": "My Custom Hook",
    "description": "Does something custom",
    "event": "PostToolUse",
    "command": "~/.inspector-hook/hooks/scripts/custom/my-hook.sh",
    "enabled": true,
    "timeout": 5000,
    "matchers": [{"tool_name": "Edit"}],
    "category": "custom",
    "priority": 50,
    "scriptContent": "#!/bin/bash\necho 'Custom hook executed'\nexit 0"
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 82,
  "result": {
    "id": "my-custom-hook-abc123",
    "name": "My Custom Hook",
    "description": "Does something custom",
    "event": "PostToolUse",
    "command": "~/.inspector-hook/hooks/scripts/custom/my-hook.sh",
    "enabled": true,
    "timeout": 5000,
    "matchers": [{"tool_name": "Edit"}],
    "category": "custom",
    "priority": 50,
    "builtIn": false,
    "installStatus": "installed",
    "scriptPath": "~/.inspector-hook/hooks/scripts/custom/my-hook.sh",
    "createdAt": "2026-01-15T11:00:00.000Z",
    "updatedAt": "2026-01-15T11:00:00.000Z"
  }
}
```

##### `hooks.update`

Update an existing hook.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 83,
  "method": "hooks.update",
  "params": {
    "id": "my-custom-hook-abc123",
    "name": "Updated Hook Name",
    "enabled": false,
    "timeout": 10000
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 83,
  "result": {
    "id": "my-custom-hook-abc123",
    "name": "Updated Hook Name",
    "enabled": false,
    "timeout": 10000,
    "updatedAt": "2026-01-15T11:30:00.000Z"
  }
}
```

##### `hooks.delete`

Delete a hook.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 84,
  "method": "hooks.delete",
  "params": {
    "id": "my-custom-hook-abc123"
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 84,
  "result": {
    "success": true,
    "removedFromSettings": true,
    "scriptDeleted": true
  }
}
```

##### `hooks.enable`

Enable a hook.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 85,
  "method": "hooks.enable",
  "params": {
    "id": "security-gate"
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 85,
  "result": {
    "success": true,
    "id": "security-gate",
    "enabled": true
  }
}
```

##### `hooks.disable`

Disable a hook.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 86,
  "method": "hooks.disable",
  "params": {
    "id": "security-gate"
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 86,
  "result": {
    "success": true,
    "id": "security-gate",
    "enabled": false
  }
}
```

##### `hooks.test`

Test a hook with sample input.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 87,
  "method": "hooks.test",
  "params": {
    "id": "security-gate",
    "testInput": {
      "session_id": "test-session-123",
      "tool_name": "Bash",
      "tool_input": {
        "command": "ls -la"
      }
    }
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 87,
  "result": {
    "success": true,
    "exitCode": 0,
    "stdout": "{\"allowed\": true}",
    "stderr": "",
    "executionTime": 45,
    "parsedOutput": {
      "allowed": true
    }
  }
}
```

##### `hooks.validate`

Validate a hook definition without creating it.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 88,
  "method": "hooks.validate",
  "params": {
    "name": "Test Hook",
    "event": "PreToolUse",
    "command": "/path/to/script.sh",
    "category": "custom"
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 88,
  "result": {
    "valid": true,
    "errors": [],
    "warnings": [
      {
        "field": "command",
        "message": "Script file does not exist yet",
        "suggestion": "Create the script at /path/to/script.sh"
      }
    ]
  }
}
```

##### `hooks.install`

Install (or reinstall) built-in hooks.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 89,
  "method": "hooks.install",
  "params": {
    "force": false,
    "categories": ["logging", "security"],
    "createBackup": true
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 89,
  "result": {
    "success": true,
    "installed": ["pre-tool-logger", "post-tool-logger", "session-start-logger", "security-gate"],
    "updated": [],
    "skipped": ["session-end-logger"],
    "failed": [],
    "backupPath": "~/.inspector-hook/hooks/backups/settings-2026-01-15T11-00-00.json"
  }
}
```

##### `hooks.repair`

Repair hook installation (fix missing scripts, sync settings).

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 90,
  "method": "hooks.repair",
  "params": {
    "dryRun": false
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 90,
  "result": {
    "success": true,
    "issuesFound": [
      {
        "type": "missing_script",
        "hookId": "custom-hook-1",
        "path": "~/.inspector-hook/hooks/scripts/custom/missing.sh",
        "message": "Script file not found"
      }
    ],
    "issuesFixed": [
      {
        "type": "missing_entry",
        "hookId": "pre-tool-logger",
        "message": "Added missing entry to Claude settings"
      }
    ],
    "issuesRemaining": [
      {
        "type": "missing_script",
        "hookId": "custom-hook-1",
        "path": "~/.inspector-hook/hooks/scripts/custom/missing.sh",
        "message": "Cannot recreate custom script - please recreate manually"
      }
    ]
  }
}
```

##### `hooks.export`

Export hooks configuration for backup or sharing.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 91,
  "method": "hooks.export",
  "params": {
    "includeScripts": true,
    "categories": ["custom"]
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 91,
  "result": {
    "version": "1.0.0",
    "exportedAt": "2026-01-15T12:00:00.000Z",
    "hooks": [
      {
        "id": "my-custom-hook",
        "name": "My Custom Hook",
        "event": "PostToolUse",
        "command": "my-hook.sh",
        "category": "custom",
        "scriptContent": "#!/bin/bash\necho 'Hello'\nexit 0"
      }
    ]
  }
}
```

##### `hooks.import`

Import hooks from exported configuration.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 92,
  "method": "hooks.import",
  "params": {
    "config": {
      "version": "1.0.0",
      "hooks": [
        {
          "name": "Imported Hook",
          "event": "PostToolUse",
          "command": "imported-hook.sh",
          "category": "custom",
          "scriptContent": "#!/bin/bash\nexit 0"
        }
      ]
    },
    "overwrite": false
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 92,
  "result": {
    "success": true,
    "imported": ["imported-hook-abc123"],
    "skipped": [],
    "errors": []
  }
}
```

##### `hooks.getTemplates`

Get available hook script templates.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 93,
  "method": "hooks.getTemplates",
  "params": {}
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 93,
  "result": {
    "templates": [
      {
        "name": "Bash Logger",
        "description": "Simple logging hook in Bash",
        "language": "bash",
        "extension": ".sh",
        "events": ["PreToolUse", "PostToolUse", "SessionStart", "SessionEnd"],
        "template": "#!/bin/bash\n# {{HOOK_NAME}}\n# {{DESCRIPTION}}\n\nsource ~/.inspector-hook/hooks/lib/inspector-hook.sh\n\nlog_info \"{{HOOK_NAME}} executed\"\nexit 0"
      },
      {
        "name": "Python Security Gate",
        "description": "Security validation hook in Python",
        "language": "python",
        "extension": ".py",
        "events": ["PreToolUse", "PermissionRequest"],
        "template": "#!/usr/bin/env python3\n# {{HOOK_NAME}}\n\nimport sys\nimport json\nfrom inspector_hook import read_input, block, allow\n\ndata = read_input()\n# Add validation logic\nallow()"
      }
    ]
  }
}
```

---

#### Analytics Operations

##### `analytics.get`

Get analytics data.

**Request**
```json
{
  "jsonrpc": "2.0",
  "id": 70,
  "method": "analytics.get",
  "params": {
    "timeRange": {
      "start": "2026-01-14T00:00:00Z",
      "end": "2026-01-15T23:59:59Z"
    }
  }
}
```

**Response**
```json
{
  "jsonrpc": "2.0",
  "id": 70,
  "result": {
    "summary": {
      "totalLogs": 5000,
      "totalSessions": 25,
      "activeSessions": 2,
      "pendingChanges": 8,
      "errors": 45,
      "warnings": 120,
      "blocked": 5
    },
    "timeSeries": [
      { "time": "2026-01-15T10:00:00Z", "count": 50 },
      { "time": "2026-01-15T10:01:00Z", "count": 45 }
    ],
    "topHooks": [
      { "name": "PreToolUse", "count": 2500, "percentage": 50 },
      { "name": "PostToolUse", "count": 2000, "percentage": 40 }
    ],
    "topTools": [
      { "name": "Edit", "count": 500, "percentage": 25 },
      { "name": "Read", "count": 400, "percentage": 20 }
    ],
    "topFiles": [
      { "name": "/path/to/file.ts", "count": 50, "percentage": 10 }
    ],
    "errorRate": 0.9,
    "averageSessionDuration": 1800,
    "computedAt": "2026-01-15T10:30:00.000Z"
  }
}
```

---

### IPC Notifications

Notifications are sent from core to wrapper without expecting a response.

##### `log.received`

Sent when a new log is received.

```json
{
  "jsonrpc": "2.0",
  "method": "log.received",
  "params": {
    "log": {
      "id": "log-123",
      "timestamp": "2026-01-15T10:00:00.000Z",
      "hook": "PreToolUse",
      "event": "tool.start",
      "level": "info",
      "message": "Starting Edit tool",
      "sessionId": "abc-123",
      "tool": "Edit"
    }
  }
}
```

##### `session.started`

Sent when a new session starts.

```json
{
  "jsonrpc": "2.0",
  "method": "session.started",
  "params": {
    "session": {
      "id": "abc-123",
      "status": "active",
      "startTime": "2026-01-15T10:00:00.000Z"
    }
  }
}
```

##### `session.ended`

Sent when a session ends.

```json
{
  "jsonrpc": "2.0",
  "method": "session.ended",
  "params": {
    "sessionId": "abc-123",
    "endTime": "2026-01-15T10:30:00.000Z",
    "status": "completed"
  }
}
```

##### `fileChange.detected`

Sent when a file change is detected.

```json
{
  "jsonrpc": "2.0",
  "method": "fileChange.detected",
  "params": {
    "change": {
      "id": "change-1",
      "filePath": "/path/to/file.ts",
      "sessionId": "abc-123",
      "changeType": "modify",
      "timestamp": "2026-01-15T10:05:00.000Z"
    }
  }
}
```

##### `stats.updated`

Sent when statistics are updated.

```json
{
  "jsonrpc": "2.0",
  "method": "stats.updated",
  "params": {
    "stats": {
      "totalLogs": 1234,
      "errors": 23,
      "warnings": 56,
      "blocked": 5,
      "logsPerMinute": 12.5,
      "activeSessions": 2,
      "pendingChanges": 8
    }
  }
}
```

##### `hook.installed`

Sent when hooks are installed or updated.

```json
{
  "jsonrpc": "2.0",
  "method": "hook.installed",
  "params": {
    "hooks": [
      {
        "id": "pre-tool-logger",
        "name": "Pre-Tool Logger",
        "event": "PreToolUse",
        "installStatus": "installed"
      }
    ],
    "count": 10
  }
}
```

##### `hook.executed`

Sent when a hook is executed (for tracking).

```json
{
  "jsonrpc": "2.0",
  "method": "hook.executed",
  "params": {
    "hookId": "security-gate",
    "event": "PreToolUse",
    "executionTime": 45,
    "exitCode": 0,
    "blocked": false
  }
}
```

##### `hook.error`

Sent when a hook encounters an error.

```json
{
  "jsonrpc": "2.0",
  "method": "hook.error",
  "params": {
    "hookId": "my-custom-hook",
    "event": "PostToolUse",
    "error": "Script timed out after 10000ms",
    "timestamp": "2026-01-15T10:30:00.000Z"
  }
}
```

---

## HTTP API

The HTTP API is used by hooks to send logs to the core process.

### Base URL

```
http://localhost:52376
```

### Endpoints

#### `POST /api/log`

Receive a log entry from hooks.

**Request**
```http
POST /api/log HTTP/1.1
Host: localhost:52376
Content-Type: application/json

{
  "timestamp": "2026-01-15T10:00:00.000Z",
  "hook": "PreToolUse",
  "event": "tool.start",
  "level": "info",
  "message": "Starting Edit tool",
  "sessionId": "abc-123",
  "tool": "Edit",
  "file": "/path/to/file.ts",
  "details": {
    "input": {
      "file_path": "/path/to/file.ts",
      "old_string": "const x = 1",
      "new_string": "const x = 2"
    }
  }
}
```

**Response (Success)**
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "success": true,
  "id": "log-123"
}
```

**Response (Error)**
```http
HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "success": false,
  "error": "Invalid log entry",
  "details": "Missing required field: hook"
}
```

#### `GET /api/health`

Health check endpoint.

**Request**
```http
GET /api/health HTTP/1.1
Host: localhost:52376
```

**Response**
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 3600
}
```

#### `GET /api/stats`

Get current statistics.

**Request**
```http
GET /api/stats HTTP/1.1
Host: localhost:52376
```

**Response**
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "totalLogs": 1234,
  "errors": 23,
  "warnings": 56,
  "blocked": 5,
  "logsPerMinute": 12.5,
  "activeSessions": 2,
  "pendingChanges": 8
}
```

---

## WebSocket Protocol

WebSocket is used for real-time event streaming from core to UI.

### Connection

```
ws://localhost:52377
```

### Event Format

All WebSocket messages follow this format:

```typescript
interface WebSocketEvent {
  type: string;
  payload: unknown;
  timestamp: string;
}
```

### Events

#### `connected`

Sent immediately after connection.

```json
{
  "type": "connected",
  "payload": {
    "clientId": "ws-client-123",
    "serverVersion": "1.0.0"
  },
  "timestamp": "2026-01-15T10:00:00.000Z"
}
```

#### `log`

New log received.

```json
{
  "type": "log",
  "payload": {
    "id": "log-123",
    "timestamp": "2026-01-15T10:00:00.000Z",
    "hook": "PreToolUse",
    "event": "tool.start",
    "level": "info",
    "message": "Starting Edit tool",
    "sessionId": "abc-123",
    "tool": "Edit"
  },
  "timestamp": "2026-01-15T10:00:00.000Z"
}
```

#### `stats`

Statistics updated.

```json
{
  "type": "stats",
  "payload": {
    "totalLogs": 1234,
    "errors": 23,
    "warnings": 56,
    "blocked": 5,
    "logsPerMinute": 12.5,
    "activeSessions": 2,
    "pendingChanges": 8
  },
  "timestamp": "2026-01-15T10:00:00.000Z"
}
```

#### `session`

Session state changed.

```json
{
  "type": "session",
  "payload": {
    "action": "started",
    "session": {
      "id": "abc-123",
      "status": "active",
      "startTime": "2026-01-15T10:00:00.000Z"
    }
  },
  "timestamp": "2026-01-15T10:00:00.000Z"
}
```

#### `fileChange`

File change detected.

```json
{
  "type": "fileChange",
  "payload": {
    "action": "detected",
    "change": {
      "id": "change-1",
      "filePath": "/path/to/file.ts",
      "sessionId": "abc-123",
      "changeType": "modify"
    }
  },
  "timestamp": "2026-01-15T10:00:00.000Z"
}
```

#### `rule`

Rule action triggered.

```json
{
  "type": "rule",
  "payload": {
    "ruleId": "rule-1",
    "ruleName": "Block dangerous commands",
    "action": "block",
    "triggerLog": "log-123"
  },
  "timestamp": "2026-01-15T10:00:00.000Z"
}
```

#### `hook`

Hook-related events (installed, executed, error).

```json
{
  "type": "hook",
  "payload": {
    "action": "executed",
    "hookId": "security-gate",
    "hookName": "Security Gate",
    "event": "PreToolUse",
    "executionTime": 45,
    "exitCode": 0,
    "blocked": false
  },
  "timestamp": "2026-01-15T10:00:00.000Z"
}
```

```json
{
  "type": "hook",
  "payload": {
    "action": "installed",
    "hooks": [
      {"id": "pre-tool-logger", "name": "Pre-Tool Logger", "event": "PreToolUse"}
    ],
    "count": 10
  },
  "timestamp": "2026-01-15T10:00:00.000Z"
}
```

```json
{
  "type": "hook",
  "payload": {
    "action": "error",
    "hookId": "my-custom-hook",
    "hookName": "My Custom Hook",
    "event": "PostToolUse",
    "error": "Script timed out after 10000ms"
  },
  "timestamp": "2026-01-15T10:30:00.000Z"
}
```

### Client Commands

Clients can send commands to the WebSocket server.

#### `subscribe`

Subscribe to specific event types.

```json
{
  "command": "subscribe",
  "events": ["log", "session", "fileChange"]
}
```

#### `unsubscribe`

Unsubscribe from event types.

```json
{
  "command": "unsubscribe",
  "events": ["log"]
}
```

#### `ping`

Keep-alive ping.

```json
{
  "command": "ping"
}
```

Response:
```json
{
  "type": "pong",
  "payload": {},
  "timestamp": "2026-01-15T10:00:00.000Z"
}
```

---

## Webview Message Protocol

Communication between VS Code wrapper and webview UI.

### Message Format

**Wrapper → Webview**
```typescript
interface WebviewMessage {
  type: string;
  payload?: unknown;
}
```

**Webview → Wrapper**
```typescript
interface WebviewCommand {
  command: string;
  params?: unknown;
}
```

### Messages (Wrapper → Webview)

#### `init`

Initialize webview with current state.

```json
{
  "type": "init",
  "payload": {
    "stats": { "totalLogs": 1234, "errors": 23, "warnings": 56 },
    "logs": [...],
    "sessions": [...],
    "fileChanges": [...],
    "config": { "autoScroll": true }
  }
}
```

#### `log`

New log received.

```json
{
  "type": "log",
  "payload": {
    "id": "log-123",
    "timestamp": "2026-01-15T10:00:00.000Z",
    "hook": "PreToolUse",
    "level": "info",
    "message": "Starting Edit tool"
  }
}
```

#### `stats`

Statistics updated.

```json
{
  "type": "stats",
  "payload": {
    "totalLogs": 1234,
    "errors": 23,
    "warnings": 56,
    "blocked": 5
  }
}
```

#### `sessions`

Sessions list updated.

```json
{
  "type": "sessions",
  "payload": {
    "sessions": [...]
  }
}
```

#### `file-changes`

File changes updated.

```json
{
  "type": "file-changes",
  "payload": {
    "changes": [...],
    "groupedBySession": {...}
  }
}
```

#### `diff-result`

Diff computation result.

```json
{
  "type": "diff-result",
  "payload": {
    "changeId": "change-1",
    "filePath": "/path/to/file.ts",
    "beforeContent": "...",
    "afterContent": "...",
    "hunks": [...]
  }
}
```

#### `version-history`

Version history for a file.

```json
{
  "type": "version-history",
  "payload": {
    "filePath": "/path/to/file.ts",
    "versions": [...]
  }
}
```

#### `archived-changes`

Archived changes list.

```json
{
  "type": "archived-changes",
  "payload": {
    "changes": [...]
  }
}
```

#### `error`

Error message.

```json
{
  "type": "error",
  "payload": {
    "message": "Failed to revert change",
    "details": "File has been modified externally"
  }
}
```

#### `hooks-list`

List of installed hooks.

```json
{
  "type": "hooks-list",
  "payload": {
    "hooks": [
      {
        "id": "security-gate",
        "name": "Security Gate",
        "event": "PreToolUse",
        "enabled": true,
        "category": "security",
        "builtIn": true
      }
    ],
    "total": 20
  }
}
```

#### `hook-detail`

Detailed hook information.

```json
{
  "type": "hook-detail",
  "payload": {
    "id": "security-gate",
    "name": "Security Gate",
    "description": "Blocks dangerous commands",
    "event": "PreToolUse",
    "command": "~/.inspector-hook/hooks/scripts/security/security-gate.py",
    "enabled": true,
    "timeout": 10000,
    "matchers": [{"tool_name": "Bash"}],
    "category": "security",
    "priority": 1000,
    "builtIn": true,
    "executionCount": 150,
    "lastExecuted": "2026-01-15T10:30:00.000Z"
  }
}
```

#### `hook-templates`

Available hook templates.

```json
{
  "type": "hook-templates",
  "payload": {
    "templates": [
      {
        "name": "Bash Logger",
        "description": "Simple logging hook in Bash",
        "language": "bash",
        "events": ["PreToolUse", "PostToolUse"]
      }
    ]
  }
}
```

#### `hook-test-result`

Result of testing a hook.

```json
{
  "type": "hook-test-result",
  "payload": {
    "hookId": "security-gate",
    "success": true,
    "exitCode": 0,
    "stdout": "{\"allowed\": true}",
    "stderr": "",
    "executionTime": 45
  }
}
```

#### `hook-install-result`

Result of hook installation.

```json
{
  "type": "hook-install-result",
  "payload": {
    "success": true,
    "installed": ["pre-tool-logger", "security-gate"],
    "updated": [],
    "failed": []
  }
}
```

### Commands (Webview → Wrapper)

#### `get-logs`

Request logs with filter.

```json
{
  "command": "get-logs",
  "params": {
    "filter": { "level": "error" },
    "limit": 100
  }
}
```

#### `get-diff`

Request diff for a change.

```json
{
  "command": "get-diff",
  "params": {
    "changeId": "change-1"
  }
}
```

#### `keep-change`

Keep a file change.

```json
{
  "command": "keep-change",
  "params": {
    "changeId": "change-1"
  }
}
```

#### `revert-change`

Revert a file change.

```json
{
  "command": "revert-change",
  "params": {
    "changeId": "change-1"
  }
}
```

#### `keep-all-changes`

Keep all pending changes.

```json
{
  "command": "keep-all-changes",
  "params": {
    "sessionId": "abc-123"
  }
}
```

#### `revert-all-changes`

Revert all pending changes.

```json
{
  "command": "revert-all-changes",
  "params": {
    "sessionId": "abc-123"
  }
}
```

#### `get-version-history`

Get version history for a file.

```json
{
  "command": "get-version-history",
  "params": {
    "filePath": "/path/to/file.ts"
  }
}
```

#### `restore-version`

Restore a previous version.

```json
{
  "command": "restore-version",
  "params": {
    "filePath": "/path/to/file.ts",
    "versionNumber": 10
  }
}
```

#### `get-archived-changes`

Get archived changes.

```json
{
  "command": "get-archived-changes",
  "params": {}
}
```

#### `restore-from-archive`

Restore from archive.

```json
{
  "command": "restore-from-archive",
  "params": {
    "changeId": "change-1"
  }
}
```

#### `delete-session`

Delete a session and associated data.

```json
{
  "command": "delete-session",
  "params": {
    "sessionId": "abc-123",
    "deleteAssociatedData": true
  }
}
```

#### `clear-sessions`

Clear sessions with optional filter.

```json
{
  "command": "clear-sessions",
  "params": {
    "filter": {
      "status": "completed",
      "olderThan": "2026-01-14T00:00:00Z"
    }
  }
}
```

#### `delete-file-change`

Delete a file change record.

```json
{
  "command": "delete-file-change",
  "params": {
    "changeId": "change-1"
  }
}
```

#### `clear-file-changes`

Clear file change records with optional filter.

```json
{
  "command": "clear-file-changes",
  "params": {
    "filter": {
      "sessionId": "abc-123",
      "status": "pending"
    }
  }
}
```

#### `delete-history-version`

Delete a specific version from history.

```json
{
  "command": "delete-history-version",
  "params": {
    "filePath": "/path/to/file.ts",
    "versionNumber": 5
  }
}
```

#### `delete-history-file`

Delete all version history for a file.

```json
{
  "command": "delete-history-file",
  "params": {
    "filePath": "/path/to/file.ts"
  }
}
```

#### `clear-history`

Clear version history with optional filter.

```json
{
  "command": "clear-history",
  "params": {
    "filter": {
      "olderThan": "2026-01-10T00:00:00Z"
    }
  }
}
```

#### `delete-archived-change`

Delete an archived change.

```json
{
  "command": "delete-archived-change",
  "params": {
    "changeId": "change-1"
  }
}
```

#### `clear-archive`

Clear archived changes with optional filter.

```json
{
  "command": "clear-archive",
  "params": {
    "filter": {
      "sessionId": "abc-123",
      "olderThan": "2026-01-10T00:00:00Z"
    }
  }
}
```

#### `clear-logs`

Clear logs.

```json
{
  "command": "clear-logs",
  "params": {
    "filter": { "sessionId": "abc-123" }
  }
}
```

#### `open-file`

Open file in editor.

```json
{
  "command": "open-file",
  "params": {
    "filePath": "/path/to/file.ts",
    "line": 45
  }
}
```

#### `export-logs`

Export logs to file.

```json
{
  "command": "export-logs",
  "params": {
    "format": "json",
    "filter": { "sessionId": "abc-123" }
  }
}
```

#### `get-hooks`

Get list of installed hooks.

```json
{
  "command": "get-hooks",
  "params": {
    "category": "security",
    "enabled": true
  }
}
```

#### `get-hook-detail`

Get detailed information about a hook.

```json
{
  "command": "get-hook-detail",
  "params": {
    "hookId": "security-gate"
  }
}
```

#### `create-hook`

Create a new custom hook.

```json
{
  "command": "create-hook",
  "params": {
    "name": "My Hook",
    "event": "PostToolUse",
    "command": "~/.inspector-hook/hooks/scripts/custom/my-hook.sh",
    "category": "custom",
    "scriptContent": "#!/bin/bash\nexit 0"
  }
}
```

#### `update-hook`

Update an existing hook.

```json
{
  "command": "update-hook",
  "params": {
    "hookId": "my-hook-abc123",
    "enabled": false,
    "timeout": 10000
  }
}
```

#### `delete-hook`

Delete a hook.

```json
{
  "command": "delete-hook",
  "params": {
    "hookId": "my-hook-abc123"
  }
}
```

#### `enable-hook`

Enable a hook.

```json
{
  "command": "enable-hook",
  "params": {
    "hookId": "security-gate"
  }
}
```

#### `disable-hook`

Disable a hook.

```json
{
  "command": "disable-hook",
  "params": {
    "hookId": "security-gate"
  }
}
```

#### `test-hook`

Test a hook with sample input.

```json
{
  "command": "test-hook",
  "params": {
    "hookId": "security-gate",
    "testInput": {
      "tool_name": "Bash",
      "tool_input": { "command": "ls -la" }
    }
  }
}
```

#### `install-hooks`

Install built-in hooks.

```json
{
  "command": "install-hooks",
  "params": {
    "categories": ["logging", "security"],
    "force": false
  }
}
```

#### `repair-hooks`

Repair hook installation.

```json
{
  "command": "repair-hooks",
  "params": {
    "dryRun": false
  }
}
```

#### `get-hook-templates`

Get available hook templates.

```json
{
  "command": "get-hook-templates",
  "params": {}
}
```

#### `export-hooks`

Export hooks configuration.

```json
{
  "command": "export-hooks",
  "params": {
    "includeScripts": true,
    "categories": ["custom"]
  }
}
```

#### `import-hooks`

Import hooks from exported configuration.

```json
{
  "command": "import-hooks",
  "params": {
    "config": {...},
    "overwrite": false
  }
}
```

---

## Error Codes

### JSON-RPC Error Codes

| Code | Name | Description |
|------|------|-------------|
| -32700 | Parse error | Invalid JSON |
| -32600 | Invalid Request | Invalid JSON-RPC request |
| -32601 | Method not found | Method does not exist |
| -32602 | Invalid params | Invalid method parameters |
| -32603 | Internal error | Internal server error |
| -32000 | Server error | Generic server error |

### Application Error Codes

| Code | Name | Description |
|------|------|-------------|
| 1000 | NOT_FOUND | Resource not found |
| 1001 | ALREADY_EXISTS | Resource already exists |
| 1002 | VALIDATION_ERROR | Input validation failed |
| 1003 | FILE_ERROR | File operation failed |
| 1004 | PERMISSION_DENIED | Operation not permitted |
| 1005 | SESSION_NOT_ACTIVE | Session is not active |
| 1006 | CONFLICT | Resource conflict (e.g., concurrent modification) |
| 1007 | RATE_LIMITED | Too many requests |
| 1100 | HOOK_NOT_FOUND | Hook not found |
| 1101 | HOOK_VALIDATION_ERROR | Hook validation failed |
| 1102 | HOOK_EXECUTION_ERROR | Hook execution failed |
| 1103 | HOOK_TIMEOUT | Hook execution timed out |
| 1104 | HOOK_INSTALL_ERROR | Hook installation failed |
| 1105 | HOOK_SCRIPT_ERROR | Hook script error (syntax, permissions) |
| 1106 | HOOK_BUILTIN_READONLY | Cannot modify built-in hook |
| 1107 | CLAUDE_SETTINGS_ERROR | Error reading/writing Claude settings.json |

### HTTP Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 400 | Bad Request - Invalid input |
| 404 | Not Found - Resource not found |
| 429 | Too Many Requests - Rate limited |
| 500 | Internal Server Error |

---

## Versioning Strategy

### API Version

The API uses semantic versioning (MAJOR.MINOR.PATCH).

- **MAJOR**: Breaking changes
- **MINOR**: New features, backward compatible
- **PATCH**: Bug fixes, backward compatible

### Version Header

All IPC responses include version information:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "version": "1.0.0",
    ...
  }
}
```

### Backward Compatibility

- Minor and patch versions maintain backward compatibility
- Deprecated methods remain functional for one major version
- Deprecation warnings included in responses

### Version Negotiation

On initialization, wrapper and core negotiate compatible version:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "core.initialize",
  "params": {
    "clientVersion": "1.0.0",
    "minServerVersion": "1.0.0"
  }
}
```

Response includes server version:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "success": true,
    "serverVersion": "1.2.0",
    "compatible": true
  }
}
```

---

## Rate Limiting

### HTTP API

- **Default**: 100 requests/minute per IP
- **Headers**: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

### WebSocket

- **Connection limit**: 10 concurrent connections
- **Message limit**: 50 messages/second per connection

### IPC

- No rate limiting (trusted local communication)

---

## Security Considerations

### HTTP API

- Binds to localhost only (127.0.0.1)
- No authentication required (local only)
- Input validation on all endpoints

### WebSocket

- Binds to localhost only
- Origin header validation
- Message size limits (1MB max)

### IPC

- Process isolation (child process)
- No external network access
- Validated JSON-RPC messages

---

## Type Exports

All message types are exported from the protocol package:

```typescript
// packages/protocol/src/index.ts

// IPC Types
export * from './ipc/request';
export * from './ipc/response';
export * from './ipc/notification';
export * from './ipc/methods';

// HTTP Types
export * from './http/log-request';
export * from './http/responses';

// WebSocket Types
export * from './ws/events';
export * from './ws/commands';

// Webview Types
export * from './webview/messages';
export * from './webview/commands';

// Error Types
export * from './errors';
```
