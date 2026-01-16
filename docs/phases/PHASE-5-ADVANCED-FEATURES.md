# Phase 5: Advanced Features

**Duration**: 3 weeks
**Goal**: Implement orchestration, rules engine, and advanced monitoring features

---

## Objectives

1. Implement Rules Engine for automated workflows
2. Add Staging system for change management
3. Implement real-time event streaming
4. Add analytics and insights
5. Prepare foundation for multi-agent orchestration

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      ADVANCED FEATURES                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      RULES ENGINE                                │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │   │
│  │  │ Rule        │  │ Condition   │  │ Action                  │ │   │
│  │  │ Parser      │  │ Evaluator   │  │ Executor                │ │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      STAGING SYSTEM                              │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │   │
│  │  │ Staged      │  │ Apply       │  │ Batch                   │ │   │
│  │  │ Changes     │  │ Engine      │  │ Operations              │ │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      EVENT STREAMING                             │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │   │
│  │  │ Event       │  │ WebSocket   │  │ Subscriber              │ │   │
│  │  │ Emitter     │  │ Server      │  │ Manager                 │ │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      ANALYTICS ENGINE                            │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │   │
│  │  │ Metrics     │  │ Aggregator  │  │ Insights                │ │   │
│  │  │ Collector   │  │             │  │ Generator               │ │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Deliverables

### 1. Rules Engine

**Purpose**: Define automated responses to events

**src/managers/rules-engine.ts**
```typescript
import { Rule, RuleCondition, RuleAction, Event } from '@inspector-hook/protocol';
import { EventEmitter } from 'events';

export class RulesEngine extends EventEmitter {
  private rules: Rule[] = [];

  addRule(rule: Rule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => b.priority - a.priority);
    this.emit('rule:added', rule);
  }

  removeRule(ruleId: string): void {
    this.rules = this.rules.filter(r => r.id !== ruleId);
    this.emit('rule:removed', ruleId);
  }

  getRules(): Rule[] {
    return [...this.rules];
  }

  async evaluate(event: Event): Promise<RuleAction[]> {
    const actions: RuleAction[] = [];

    for (const rule of this.rules) {
      if (!rule.enabled) continue;

      if (this.matchesCondition(event, rule.condition)) {
        this.emit('rule:matched', { rule, event });
        actions.push(rule.action);

        // Stop if rule is terminal
        if (rule.stopOnMatch) break;
      }
    }

    return actions;
  }

  private matchesCondition(event: Event, condition: RuleCondition): boolean {
    switch (condition.type) {
      case 'event_type':
        return event.type === condition.value;

      case 'tool_name':
        return event.tool === condition.value;

      case 'level':
        return event.level === condition.value;

      case 'pattern':
        return new RegExp(condition.value).test(event.message);

      case 'and':
        return condition.conditions!.every(c => this.matchesCondition(event, c));

      case 'or':
        return condition.conditions!.some(c => this.matchesCondition(event, c));

      case 'not':
        return !this.matchesCondition(event, condition.conditions![0]);

      default:
        return false;
    }
  }
}
```

**Rule Types**
```typescript
// protocol/src/rules.ts
export interface Rule {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  priority: number;
  condition: RuleCondition;
  action: RuleAction;
  stopOnMatch: boolean;
}

export interface RuleCondition {
  type: 'event_type' | 'tool_name' | 'level' | 'pattern' | 'and' | 'or' | 'not';
  value?: string;
  conditions?: RuleCondition[];
}

export interface RuleAction {
  type: 'notify' | 'block' | 'log' | 'auto_keep' | 'auto_revert' | 'webhook';
  params?: Record<string, unknown>;
}
```

**Example Rules**
```json
[
  {
    "id": "auto-keep-tests",
    "name": "Auto-keep test file changes",
    "enabled": true,
    "priority": 100,
    "condition": {
      "type": "pattern",
      "value": "\\.(test|spec)\\.(ts|js)$"
    },
    "action": {
      "type": "auto_keep"
    },
    "stopOnMatch": false
  },
  {
    "id": "block-dangerous",
    "name": "Block dangerous commands",
    "enabled": true,
    "priority": 1000,
    "condition": {
      "type": "and",
      "conditions": [
        { "type": "tool_name", "value": "Bash" },
        { "type": "pattern", "value": "rm -rf /|sudo|chmod 777" }
      ]
    },
    "action": {
      "type": "block",
      "params": { "reason": "Dangerous command detected" }
    },
    "stopOnMatch": true
  }
]
```

### 2. Staging System

**Purpose**: Stage and batch apply changes

**src/managers/staging-manager.ts**
```typescript
import { StagedChange, FileChange, ApplyResult } from '@inspector-hook/protocol';
import { writeFile } from 'fs/promises';
import { EventEmitter } from 'events';

export class StagingManager extends EventEmitter {
  private staged = new Map<string, StagedChange>();

  stageChange(change: FileChange, type: 'keep' | 'revert' | 'restore'): StagedChange {
    const staged: StagedChange = {
      id: change.id,
      type,
      filePath: change.filePath,
      content: type === 'revert' ? change.beforeContent : change.afterContent,
      stagedAt: new Date().toISOString(),
      originalChange: change
    };

    this.staged.set(staged.id, staged);
    this.emit('change:staged', staged);
    return staged;
  }

  unstageChange(id: string): void {
    const staged = this.staged.get(id);
    if (staged) {
      this.staged.delete(id);
      this.emit('change:unstaged', staged);
    }
  }

  getStagedChanges(): StagedChange[] {
    return Array.from(this.staged.values());
  }

  async applyStaged(id: string): Promise<ApplyResult> {
    const staged = this.staged.get(id);
    if (!staged) {
      return { success: false, error: 'Change not found' };
    }

    try {
      await writeFile(staged.filePath, staged.content);
      this.staged.delete(id);
      this.emit('change:applied', staged);
      return { success: true, change: staged };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async applyAll(): Promise<ApplyResult[]> {
    const results: ApplyResult[] = [];
    for (const [id] of this.staged) {
      results.push(await this.applyStaged(id));
    }
    return results;
  }

  async applyByFile(filePath: string): Promise<ApplyResult[]> {
    const results: ApplyResult[] = [];
    for (const [id, staged] of this.staged) {
      if (staged.filePath === filePath) {
        results.push(await this.applyStaged(id));
      }
    }
    return results;
  }

  discardAll(): void {
    this.staged.clear();
    this.emit('staging:cleared');
  }
}
```

### 3. Event Streaming (WebSocket)

**Purpose**: Real-time event delivery to UI

**src/server/websocket-server.ts**
```typescript
import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'events';

export class EventStreamServer extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();

  start(port: number): void {
    this.wss = new WebSocketServer({ port });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      this.emit('client:connected', ws);

      ws.on('close', () => {
        this.clients.delete(ws);
        this.emit('client:disconnected', ws);
      });

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.emit('message', { ws, message });
        } catch {}
      });
    });
  }

  broadcast(event: unknown): void {
    const data = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  send(ws: WebSocket, event: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }

  stop(): void {
    this.wss?.close();
    this.clients.clear();
  }
}
```

### 4. Analytics Engine

**Purpose**: Generate insights from collected data

**src/managers/analytics-engine.ts**
```typescript
import { Analytics, TimeSeriesData, TopItem } from '@inspector-hook/protocol';

export class AnalyticsEngine {
  computeAnalytics(
    logs: LogEntry[],
    sessions: Session[],
    fileChanges: FileChange[]
  ): Analytics {
    return {
      summary: this.computeSummary(logs, sessions, fileChanges),
      timeSeries: this.computeTimeSeries(logs),
      topHooks: this.computeTopHooks(logs),
      topTools: this.computeTopTools(sessions),
      topFiles: this.computeTopFiles(fileChanges),
      errorRate: this.computeErrorRate(logs),
      averageSessionDuration: this.computeAvgSessionDuration(sessions)
    };
  }

  private computeSummary(logs: LogEntry[], sessions: Session[], changes: FileChange[]) {
    return {
      totalLogs: logs.length,
      totalSessions: sessions.length,
      activeSessions: sessions.filter(s => s.status === 'active').length,
      pendingChanges: changes.filter(c => c.status === 'pending').length,
      errors: logs.filter(l => l.level === 'error').length,
      warnings: logs.filter(l => l.level === 'warn').length,
      blocked: logs.filter(l => l.level === 'blocked').length
    };
  }

  private computeTimeSeries(logs: LogEntry[]): TimeSeriesData[] {
    // Group logs by minute
    const byMinute = new Map<string, number>();

    logs.forEach(log => {
      const minute = log.timestamp.substring(0, 16); // YYYY-MM-DDTHH:MM
      byMinute.set(minute, (byMinute.get(minute) || 0) + 1);
    });

    return Array.from(byMinute.entries())
      .map(([time, count]) => ({ time, count }))
      .sort((a, b) => a.time.localeCompare(b.time));
  }

  private computeTopHooks(logs: LogEntry[]): TopItem[] {
    const counts = new Map<string, number>();
    logs.forEach(log => {
      counts.set(log.hook, (counts.get(log.hook) || 0) + 1);
    });

    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  private computeTopTools(sessions: Session[]): TopItem[] {
    const counts = new Map<string, number>();
    sessions.forEach(session => {
      session.toolExecutions.forEach(exec => {
        counts.set(exec.tool, (counts.get(exec.tool) || 0) + 1);
      });
    });

    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  private computeTopFiles(changes: FileChange[]): TopItem[] {
    const counts = new Map<string, number>();
    changes.forEach(change => {
      counts.set(change.filePath, (counts.get(change.filePath) || 0) + 1);
    });

    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  private computeErrorRate(logs: LogEntry[]): number {
    if (logs.length === 0) return 0;
    const errors = logs.filter(l => l.level === 'error').length;
    return (errors / logs.length) * 100;
  }

  private computeAvgSessionDuration(sessions: Session[]): number {
    const completed = sessions.filter(s => s.endTime);
    if (completed.length === 0) return 0;

    const totalMs = completed.reduce((sum, s) => {
      const start = new Date(s.startTime).getTime();
      const end = new Date(s.endTime!).getTime();
      return sum + (end - start);
    }, 0);

    return totalMs / completed.length / 1000; // seconds
  }
}
```

---

## Tasks

### Task 5.1: Implement Rules Engine
- [ ] Create Rule types in protocol
- [ ] Implement condition evaluator
- [ ] Implement action executor
- [ ] Add rule persistence
- [ ] Add rule management API

### Task 5.2: Implement Staging System
- [ ] Create StagedChange types
- [ ] Implement staging logic
- [ ] Implement apply logic
- [ ] Add batch operations
- [ ] Add staging UI

### Task 5.3: Implement Event Streaming
- [ ] Add WebSocket server
- [ ] Implement broadcast
- [ ] Connect to managers
- [ ] Add UI WebSocket client

### Task 5.4: Implement Analytics Engine
- [ ] Create Analytics types
- [ ] Implement aggregations
- [ ] Add time series
- [ ] Add insights generation

### Task 5.5: Add Rules UI
- [ ] Create rules list view
- [ ] Add rule editor
- [ ] Add rule testing
- [ ] Show rule execution logs

### Task 5.6: Add Analytics Dashboard
- [ ] Create charts (time series)
- [ ] Add top lists
- [ ] Add summary cards
- [ ] Add export functionality

### Task 5.7: Integration Testing
- [ ] Test rules with real events
- [ ] Test staging workflow
- [ ] Test real-time updates
- [ ] Performance testing

---

## Acceptance Criteria

1. **Rules Engine**
   - Rules evaluate correctly
   - Actions execute properly
   - Rules persist across restarts

2. **Staging System**
   - Changes stage correctly
   - Apply works for single and batch
   - Conflicts handled properly

3. **Event Streaming**
   - Real-time updates work
   - Multiple clients supported
   - No memory leaks

4. **Analytics**
   - Metrics accurate
   - Time series generated
   - Insights valuable

---

## Success Metrics

- [ ] < 10ms rule evaluation
- [ ] Real-time latency < 100ms
- [ ] Analytics compute < 1 second
- [ ] Zero data loss in streaming
