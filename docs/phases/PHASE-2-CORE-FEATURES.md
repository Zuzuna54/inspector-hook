# Phase 2: Core Features Implementation

**Duration**: 3 weeks
**Goal**: Implement all core business logic managers and persistence layer

---

## Objectives

1. Implement Session Manager with full lifecycle tracking
2. Implement File Tracker with change detection
3. Implement Version History Manager
4. Implement Archive Manager for kept changes
5. Add persistence layer for all data
6. Enhance IPC protocol with all required methods

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CORE PROCESS                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                        MANAGERS                                  │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │   │
│  │  │ Session     │  │ File        │  │ Version History         │ │   │
│  │  │ Manager     │  │ Tracker     │  │ Manager                 │ │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────────────┘ │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │   │
│  │  │ Archive     │  │ Diff        │  │ Stats                   │ │   │
│  │  │ Manager     │  │ Engine      │  │ Aggregator              │ │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                    │
│                                    ▼                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      PERSISTENCE LAYER                           │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │   │
│  │  │ JSON File   │  │ Log Files   │  │ Version                 │ │   │
│  │  │ Store       │  │ (JSONL)     │  │ Snapshots               │ │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Deliverables

### 1. Session Manager

**Purpose**: Track AI agent sessions with tool executions and file changes

**src/managers/session-manager.ts**
```typescript
import { Session, ToolExecution, SessionStatus } from '@inspector-hook/protocol';
import { EventEmitter } from 'events';

export class SessionManager extends EventEmitter {
  private sessions = new Map<string, Session>();

  createSession(id: string, metadata?: Record<string, unknown>): Session {
    const session: Session = {
      id,
      status: 'active',
      startTime: new Date().toISOString(),
      toolExecutions: [],
      fileChanges: [],
      metadata
    };
    this.sessions.set(id, session);
    this.emit('session:created', session);
    return session;
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  getAllSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  getActiveSessions(): Session[] {
    return this.getAllSessions().filter(s => s.status === 'active');
  }

  addToolExecution(sessionId: string, execution: ToolExecution): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.toolExecutions.push(execution);
      this.emit('tool:started', { sessionId, execution });
    }
  }

  completeToolExecution(sessionId: string, toolId: string, result: unknown): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      const execution = session.toolExecutions.find(t => t.id === toolId);
      if (execution) {
        execution.endTime = new Date().toISOString();
        execution.result = result;
        this.emit('tool:completed', { sessionId, execution });
      }
    }
  }

  endSession(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.status = 'completed';
      session.endTime = new Date().toISOString();
      this.emit('session:ended', session);
    }
  }
}
```

### 2. File Tracker

**Purpose**: Track file modifications with before/after snapshots

**src/managers/file-tracker.ts**
```typescript
import { FileChange, FileSnapshot } from '@inspector-hook/protocol';
import { readFile, stat } from 'fs/promises';
import { createHash } from 'crypto';
import { EventEmitter } from 'events';

export class FileTracker extends EventEmitter {
  private trackedFiles = new Map<string, FileSnapshot>();
  private pendingChanges = new Map<string, FileChange>();

  async captureSnapshot(filePath: string): Promise<FileSnapshot> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const stats = await stat(filePath);
      const hash = createHash('md5').update(content).digest('hex');

      const snapshot: FileSnapshot = {
        path: filePath,
        content,
        hash,
        timestamp: new Date().toISOString(),
        size: stats.size
      };

      this.trackedFiles.set(filePath, snapshot);
      return snapshot;
    } catch (error) {
      // File doesn't exist - return empty snapshot
      return {
        path: filePath,
        content: '',
        hash: '',
        timestamp: new Date().toISOString(),
        size: 0,
        exists: false
      };
    }
  }

  async detectChange(filePath: string, sessionId: string): Promise<FileChange | null> {
    const beforeSnapshot = this.trackedFiles.get(filePath);
    const afterSnapshot = await this.captureSnapshot(filePath);

    if (!beforeSnapshot || beforeSnapshot.hash === afterSnapshot.hash) {
      return null; // No change
    }

    const change: FileChange = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      filePath,
      sessionId,
      timestamp: new Date().toISOString(),
      beforeContent: beforeSnapshot.content,
      afterContent: afterSnapshot.content,
      status: 'pending'
    };

    this.pendingChanges.set(change.id, change);
    this.emit('change:detected', change);
    return change;
  }

  getPendingChanges(): FileChange[] {
    return Array.from(this.pendingChanges.values())
      .filter(c => c.status === 'pending');
  }

  getChange(id: string): FileChange | undefined {
    return this.pendingChanges.get(id);
  }

  markAsKept(id: string): void {
    const change = this.pendingChanges.get(id);
    if (change) {
      change.status = 'kept';
      this.emit('change:kept', change);
    }
  }

  markAsReverted(id: string): void {
    const change = this.pendingChanges.get(id);
    if (change) {
      change.status = 'reverted';
      this.emit('change:reverted', change);
    }
  }
}
```

### 3. Version History Manager

**Purpose**: Maintain version history for tracked files

**src/managers/version-history-manager.ts**
```typescript
import { FileVersion, VersionHistory } from '@inspector-hook/protocol';
import { EventEmitter } from 'events';

export class VersionHistoryManager extends EventEmitter {
  private history = new Map<string, VersionHistory>();

  addVersion(filePath: string, content: string, sessionId: string): FileVersion {
    let fileHistory = this.history.get(filePath);
    if (!fileHistory) {
      fileHistory = { filePath, versions: [] };
      this.history.set(filePath, fileHistory);
    }

    const version: FileVersion = {
      id: `v${fileHistory.versions.length + 1}`,
      versionNumber: fileHistory.versions.length + 1,
      content,
      timestamp: new Date().toISOString(),
      sessionId,
      hash: this.computeHash(content)
    };

    fileHistory.versions.push(version);
    this.emit('version:added', { filePath, version });
    return version;
  }

  getVersionHistory(filePath: string): VersionHistory | undefined {
    return this.history.get(filePath);
  }

  getVersion(filePath: string, versionId: string): FileVersion | undefined {
    const history = this.history.get(filePath);
    return history?.versions.find(v => v.id === versionId);
  }

  getTrackedFiles(): string[] {
    return Array.from(this.history.keys());
  }

  compareVersions(filePath: string, v1Id: string, v2Id: string): { before: string; after: string } | null {
    const history = this.history.get(filePath);
    if (!history) return null;

    const v1 = history.versions.find(v => v.id === v1Id);
    const v2 = history.versions.find(v => v.id === v2Id);
    if (!v1 || !v2) return null;

    return { before: v1.content, after: v2.content };
  }

  private computeHash(content: string): string {
    const { createHash } = require('crypto');
    return createHash('md5').update(content).digest('hex');
  }
}
```

### 4. Archive Manager

**Purpose**: Store and manage "kept" changes for later reference

**src/managers/archive-manager.ts**
```typescript
import { ArchivedChange, FileChange } from '@inspector-hook/protocol';
import { EventEmitter } from 'events';

export class ArchiveManager extends EventEmitter {
  private archives = new Map<string, ArchivedChange>();

  archiveChange(change: FileChange): ArchivedChange {
    const archived: ArchivedChange = {
      id: change.id,
      filePath: change.filePath,
      sessionId: change.sessionId,
      archivedAt: new Date().toISOString(),
      originalTimestamp: change.timestamp,
      beforeContent: change.beforeContent,
      afterContent: change.afterContent
    };

    this.archives.set(archived.id, archived);
    this.emit('change:archived', archived);
    return archived;
  }

  getArchivedChange(id: string): ArchivedChange | undefined {
    return this.archives.get(id);
  }

  getAllArchived(): ArchivedChange[] {
    return Array.from(this.archives.values())
      .sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
  }

  getArchivedByFile(filePath: string): ArchivedChange[] {
    return this.getAllArchived().filter(a => a.filePath === filePath);
  }

  restoreFromArchive(id: string): ArchivedChange | undefined {
    const archived = this.archives.get(id);
    if (archived) {
      this.emit('change:restoring', archived);
    }
    return archived;
  }
}
```

### 5. Diff Engine

**Purpose**: Compute and format diffs between file versions

**src/managers/diff-engine.ts**
```typescript
import { DiffResult, DiffHunk } from '@inspector-hook/protocol';

export class DiffEngine {
  computeDiff(before: string, after: string): DiffResult {
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');

    // Simple line-by-line diff algorithm
    const hunks = this.computeHunks(beforeLines, afterLines);

    return {
      beforeContent: before,
      afterContent: after,
      hunks,
      additions: hunks.reduce((sum, h) => sum + h.additions, 0),
      deletions: hunks.reduce((sum, h) => sum + h.deletions, 0)
    };
  }

  private computeHunks(beforeLines: string[], afterLines: string[]): DiffHunk[] {
    const hunks: DiffHunk[] = [];
    // Simplified: create single hunk for entire diff
    // In production, use proper diff algorithm (Myers, etc.)

    const hunk: DiffHunk = {
      id: `hunk-${Date.now()}`,
      oldStart: 1,
      oldLines: beforeLines.length,
      newStart: 1,
      newLines: afterLines.length,
      lines: [],
      additions: 0,
      deletions: 0,
      status: 'pending'
    };

    // Mark removed lines
    beforeLines.forEach((line, i) => {
      if (!afterLines.includes(line)) {
        hunk.lines.push({ type: 'removed', content: line, lineNumber: i + 1 });
        hunk.deletions++;
      }
    });

    // Mark added lines
    afterLines.forEach((line, i) => {
      if (!beforeLines.includes(line)) {
        hunk.lines.push({ type: 'added', content: line, lineNumber: i + 1 });
        hunk.additions++;
      }
    });

    if (hunk.lines.length > 0) {
      hunks.push(hunk);
    }

    return hunks;
  }

  formatUnifiedDiff(diff: DiffResult): string {
    let output = '';
    diff.hunks.forEach(hunk => {
      output += `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n`;
      hunk.lines.forEach(line => {
        const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
        output += `${prefix}${line.content}\n`;
      });
    });
    return output;
  }
}
```

### 6. Persistence Layer

**src/persistence/store.ts**
```typescript
import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';

export class PersistenceStore {
  constructor(private basePath: string) {}

  async initialize(): Promise<void> {
    const dirs = ['sessions', 'logs', 'versions', 'archives'];
    for (const dir of dirs) {
      const fullPath = path.join(this.basePath, dir);
      if (!existsSync(fullPath)) {
        await mkdir(fullPath, { recursive: true });
      }
    }
  }

  async saveJSON<T>(category: string, id: string, data: T): Promise<void> {
    const filePath = path.join(this.basePath, category, `${id}.json`);
    await writeFile(filePath, JSON.stringify(data, null, 2));
  }

  async loadJSON<T>(category: string, id: string): Promise<T | null> {
    const filePath = path.join(this.basePath, category, `${id}.json`);
    try {
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  async appendLog(filename: string, entry: unknown): Promise<void> {
    const filePath = path.join(this.basePath, 'logs', filename);
    const line = JSON.stringify(entry) + '\n';
    const { appendFile } = await import('fs/promises');
    await appendFile(filePath, line);
  }

  async loadLogs(filename: string): Promise<unknown[]> {
    const filePath = path.join(this.basePath, 'logs', filename);
    try {
      const content = await readFile(filePath, 'utf-8');
      return content.trim().split('\n').map(line => JSON.parse(line));
    } catch {
      return [];
    }
  }
}
```

---

## Enhanced IPC Protocol

### New Methods

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `getSessions` | - | `Session[]` | Get all sessions |
| `getSession` | `{ id }` | `Session` | Get specific session |
| `getFileChanges` | `{ sessionId? }` | `FileChange[]` | Get pending changes |
| `getDiff` | `{ changeId }` | `DiffResult` | Get diff for change |
| `keepChange` | `{ changeId }` | `void` | Mark change as kept |
| `revertChange` | `{ changeId }` | `void` | Revert a change |
| `getVersionHistory` | `{ filePath }` | `VersionHistory` | Get file versions |
| `getArchivedChanges` | - | `ArchivedChange[]` | Get archived changes |
| `restoreFromArchive` | `{ id }` | `void` | Restore archived change |

---

## Tasks

### Task 2.1: Implement Session Manager
- [ ] Create session-manager.ts
- [ ] Implement CRUD operations
- [ ] Add tool execution tracking
- [ ] Add event emission
- [ ] Add persistence integration

### Task 2.2: Implement File Tracker
- [ ] Create file-tracker.ts
- [ ] Implement snapshot capture
- [ ] Implement change detection
- [ ] Add status management
- [ ] Add event emission

### Task 2.3: Implement Version History Manager
- [ ] Create version-history-manager.ts
- [ ] Implement version storage
- [ ] Implement version comparison
- [ ] Add persistence integration

### Task 2.4: Implement Archive Manager
- [ ] Create archive-manager.ts
- [ ] Implement archive storage
- [ ] Implement restore functionality
- [ ] Add persistence integration

### Task 2.5: Implement Diff Engine
- [ ] Create diff-engine.ts
- [ ] Implement basic diff algorithm
- [ ] Implement unified diff formatting
- [ ] Add hunk-level operations

### Task 2.6: Implement Persistence Layer
- [ ] Create persistence store
- [ ] Implement JSON file storage
- [ ] Implement JSONL log storage
- [ ] Add initialization logic

### Task 2.7: Enhance IPC Handler
- [ ] Add all new methods to IPC server
- [ ] Wire managers to IPC handlers
- [ ] Add proper error handling
- [ ] Add event forwarding

### Task 2.8: Integration Testing
- [ ] Test session lifecycle
- [ ] Test file change detection
- [ ] Test version history
- [ ] Test archive operations
- [ ] Test persistence reload

---

## Acceptance Criteria

1. **Session Management**
   - Sessions created and tracked correctly
   - Tool executions recorded with timing
   - Sessions persist across restarts

2. **File Tracking**
   - Changes detected accurately
   - Before/after content captured
   - Status transitions work correctly

3. **Version History**
   - Versions stored and retrievable
   - Comparison between versions works
   - History persists across restarts

4. **Archive**
   - Kept changes archived
   - Restore functionality works
   - Archives persist across restarts

5. **Performance**
   - Large files handled efficiently
   - No memory leaks
   - Persistence operations non-blocking

---

## Success Metrics

- [ ] 100+ sessions handled without issues
- [ ] 1000+ file changes tracked
- [ ] Persistence reload < 2 seconds
- [ ] Memory usage < 200MB under load
- [ ] All managers emit proper events
