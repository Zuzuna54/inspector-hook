# Phase 6: Production Hardening

**Duration**: 2 weeks
**Goal**: Prepare for production release with quality, security, and distribution

---

## Objectives

1. Security hardening and audit
2. Performance optimization
3. Error handling and resilience
4. Packaging and distribution
5. Documentation completion

---

## Security Hardening

### 1. Input Validation

**All external inputs must be validated**

```typescript
// src/validation/validators.ts
import { z } from 'zod';

export const LogEntrySchema = z.object({
  timestamp: z.string().datetime(),
  hook: z.string().max(100),
  event: z.string().max(100).optional(),
  level: z.enum(['info', 'warn', 'error', 'blocked']),
  message: z.string().max(10000),
  sessionId: z.string().uuid().optional(),
  tool: z.string().max(100).optional(),
  file: z.string().max(1000).optional(),
  details: z.record(z.unknown()).optional()
});

export const FilePathSchema = z.string()
  .max(1000)
  .refine(path => !path.includes('..'), 'Path traversal not allowed')
  .refine(path => path.startsWith('/') || path.match(/^[A-Z]:\\/), 'Must be absolute path');

export function validateLogEntry(data: unknown): LogEntry {
  return LogEntrySchema.parse(data);
}

export function validateFilePath(path: unknown): string {
  return FilePathSchema.parse(path);
}
```

### 2. Rate Limiting

```typescript
// src/security/rate-limiter.ts
export class RateLimiter {
  private requests = new Map<string, number[]>();
  private limit: number;
  private windowMs: number;

  constructor(limit: number = 100, windowMs: number = 60000) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  isAllowed(key: string): boolean {
    const now = Date.now();
    const timestamps = this.requests.get(key) || [];

    // Remove old timestamps
    const recent = timestamps.filter(t => now - t < this.windowMs);

    if (recent.length >= this.limit) {
      return false;
    }

    recent.push(now);
    this.requests.set(key, recent);
    return true;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, timestamps] of this.requests) {
      const recent = timestamps.filter(t => now - t < this.windowMs);
      if (recent.length === 0) {
        this.requests.delete(key);
      } else {
        this.requests.set(key, recent);
      }
    }
  }
}
```

### 3. Secure File Operations

```typescript
// src/security/file-security.ts
import * as path from 'path';

export function isPathSafe(filePath: string, allowedRoots: string[]): boolean {
  const normalized = path.normalize(filePath);

  // Check for path traversal
  if (normalized.includes('..')) {
    return false;
  }

  // Check if under allowed roots
  return allowedRoots.some(root => normalized.startsWith(root));
}

export function sanitizePath(filePath: string): string {
  return path.normalize(filePath).replace(/\.\./g, '');
}
```

---

## Performance Optimization

### 1. Memory Management

```typescript
// src/optimization/memory-manager.ts
export class MemoryManager {
  private maxLogs: number;
  private maxSessions: number;

  constructor(maxLogs = 10000, maxSessions = 100) {
    this.maxLogs = maxLogs;
    this.maxSessions = maxSessions;
  }

  trimLogs(logs: LogEntry[]): LogEntry[] {
    if (logs.length > this.maxLogs) {
      return logs.slice(-this.maxLogs);
    }
    return logs;
  }

  trimSessions(sessions: Session[]): Session[] {
    if (sessions.length > this.maxSessions) {
      // Keep active sessions and most recent completed
      const active = sessions.filter(s => s.status === 'active');
      const completed = sessions
        .filter(s => s.status !== 'active')
        .sort((a, b) => b.startTime.localeCompare(a.startTime))
        .slice(0, this.maxSessions - active.length);
      return [...active, ...completed];
    }
    return sessions;
  }
}
```

### 2. Lazy Loading

```typescript
// src/optimization/lazy-loader.ts
export class LazyLoader<T> {
  private data: T | null = null;
  private loading = false;
  private loader: () => Promise<T>;

  constructor(loader: () => Promise<T>) {
    this.loader = loader;
  }

  async get(): Promise<T> {
    if (this.data !== null) {
      return this.data;
    }

    if (!this.loading) {
      this.loading = true;
      this.data = await this.loader();
      this.loading = false;
    }

    return this.data!;
  }

  invalidate(): void {
    this.data = null;
  }
}
```

### 3. Caching

```typescript
// src/optimization/cache.ts
export class Cache<T> {
  private cache = new Map<string, { value: T; expires: number }>();

  set(key: string, value: T, ttlMs: number): void {
    this.cache.set(key, {
      value,
      expires: Date.now() + ttlMs
    });
  }

  get(key: string): T | undefined {
    const item = this.cache.get(key);
    if (!item) return undefined;

    if (Date.now() > item.expires) {
      this.cache.delete(key);
      return undefined;
    }

    return item.value;
  }

  clear(): void {
    this.cache.clear();
  }
}
```

---

## Error Handling

### 1. Global Error Handler

```typescript
// src/error/error-handler.ts
export class ErrorHandler {
  private listeners: ((error: Error) => void)[] = [];

  register(): void {
    process.on('uncaughtException', (error) => {
      this.handle(error);
    });

    process.on('unhandledRejection', (reason) => {
      this.handle(reason instanceof Error ? reason : new Error(String(reason)));
    });
  }

  onError(listener: (error: Error) => void): void {
    this.listeners.push(listener);
  }

  private handle(error: Error): void {
    console.error('[Inspector Hook] Unhandled error:', error);

    for (const listener of this.listeners) {
      try {
        listener(error);
      } catch {}
    }
  }
}
```

### 2. Graceful Shutdown

```typescript
// src/lifecycle/shutdown.ts
export class GracefulShutdown {
  private handlers: (() => Promise<void>)[] = [];
  private shuttingDown = false;

  register(): void {
    const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGHUP'];

    for (const signal of signals) {
      process.on(signal, () => this.shutdown(signal));
    }
  }

  onShutdown(handler: () => Promise<void>): void {
    this.handlers.push(handler);
  }

  private async shutdown(signal: string): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    console.log(`[Inspector Hook] Received ${signal}, shutting down...`);

    for (const handler of this.handlers) {
      try {
        await handler();
      } catch (error) {
        console.error('[Inspector Hook] Shutdown error:', error);
      }
    }

    process.exit(0);
  }
}
```

---

## Packaging & Distribution

### 1. VS Code Extension Package

**package.json** additions
```json
{
  "scripts": {
    "package": "vsce package --no-dependencies -o dist/inspector-hook.vsix",
    "publish": "vsce publish"
  },
  "files": [
    "dist/**",
    "media/**",
    "hooks/**",
    "README.md",
    "LICENSE"
  ]
}
```

### 2. Build Script

**scripts/build.sh**
```bash
#!/bin/bash
set -euo pipefail

echo "Building Inspector Hook..."

# Clean
rm -rf dist

# Build packages
pnpm -r build

# Copy core to vscode
mkdir -p packages/vscode/node_modules/@inspector-hook
cp -r packages/core/dist packages/vscode/node_modules/@inspector-hook/core
cp -r packages/protocol/dist packages/vscode/node_modules/@inspector-hook/protocol

# Copy hooks
cp -r packages/hooks packages/vscode/hooks

# Package extension
cd packages/vscode
pnpm package

echo "Build complete: packages/vscode/dist/inspector-hook.vsix"
```

### 3. Release Checklist

```markdown
## Release Checklist

### Pre-Release
- [ ] All tests passing
- [ ] Version bumped in all package.json files
- [ ] CHANGELOG.md updated
- [ ] README.md reviewed
- [ ] Security audit completed
- [ ] Performance benchmarks met

### Build
- [ ] Clean build succeeds
- [ ] VSIX package created
- [ ] Package size acceptable (< 5MB)

### Testing
- [ ] Fresh install works
- [ ] Upgrade from previous version works
- [ ] All features functional
- [ ] No console errors

### Distribution
- [ ] VS Code Marketplace (if publishing)
- [ ] Open VSX Registry (if publishing)
- [ ] GitHub Release with VSIX
- [ ] Documentation updated
```

---

## Documentation

### 1. User Documentation

**Required Docs**
- README.md - Overview and quick start
- docs/INSTALLATION.md - Detailed installation
- docs/USAGE.md - Feature guide
- docs/CONFIGURATION.md - Configuration options
- docs/TROUBLESHOOTING.md - Common issues

### 2. Developer Documentation

**Required Docs**
- docs/ARCHITECTURE.md - System design
- docs/CONTRIBUTING.md - Contribution guide
- docs/API.md - IPC protocol reference
- docs/HOOKS.md - Hook development guide

---

## Tasks

### Task 6.1: Security Hardening
- [ ] Add input validation
- [ ] Implement rate limiting
- [ ] Add path sanitization
- [ ] Security audit

### Task 6.2: Performance Optimization
- [ ] Implement memory management
- [ ] Add caching layer
- [ ] Optimize hot paths
- [ ] Profile and fix bottlenecks

### Task 6.3: Error Handling
- [ ] Add global error handler
- [ ] Implement graceful shutdown
- [ ] Add error recovery
- [ ] Improve error messages

### Task 6.4: Packaging
- [ ] Configure package.json
- [ ] Create build script
- [ ] Test packaging
- [ ] Verify VSIX contents

### Task 6.5: Documentation
- [ ] Write user documentation
- [ ] Write developer documentation
- [ ] Add inline code comments
- [ ] Create examples

### Task 6.6: Final Testing
- [ ] Full regression test
- [ ] Performance testing
- [ ] Security testing
- [ ] Cross-platform testing

---

## Acceptance Criteria

1. **Security**
   - All inputs validated
   - Rate limiting active
   - No path traversal possible
   - Security audit passed

2. **Performance**
   - Memory < 200MB under load
   - Response time < 100ms
   - No memory leaks
   - Handles 10K+ logs

3. **Stability**
   - Graceful error handling
   - Clean shutdown
   - Auto-recovery from errors
   - No crashes

4. **Distribution**
   - VSIX builds correctly
   - Installs cleanly
   - Works without dependencies
   - Under 5MB package size

5. **Documentation**
   - Installation documented
   - Features documented
   - API documented
   - Troubleshooting guide

---

## Success Metrics

- [ ] Zero critical security issues
- [ ] < 200MB memory usage
- [ ] < 100ms average response
- [ ] < 5MB package size
- [ ] 100% documented features
- [ ] Clean install on 3+ platforms
