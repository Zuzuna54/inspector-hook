# Phase 4: Hooks Integration & Management

**Duration**: 3 weeks
**Goal**: Complete hooks integration with all Claude Code events, installation system, and hook management UI

---

## Objectives

1. Support all 10 Claude Code hook events
2. Create automatic hook installation system
3. Build hook management UI (create, edit, delete, enable/disable)
4. Provide built-in hook templates
5. Enable custom hook creation
6. Implement hook testing/validation

---

## Claude Code Hook Events (Complete Reference)

Inspector Hook supports **all 10 Claude Code hook events**:

### Hook Events Overview

| Event | When Fired | Use Cases |
|-------|------------|-----------|
| **PreToolUse** | Before any tool executes | Security gates, logging, validation |
| **PostToolUse** | After any tool completes | Logging, formatting, quality checks |
| **SessionStart** | When Claude session begins | Context loading, initialization |
| **SessionEnd** | When Claude session ends | Cleanup, state saving, reporting |
| **UserPromptSubmit** | When user submits prompt | Context injection, prompt enhancement |
| **PermissionRequest** | When permission needed | Auto-approval, policy enforcement |
| **Notification** | When Claude sends notification | Desktop alerts, logging |
| **Stop** | When Claude stops (complete/error) | Completion alerts, cleanup |
| **SubagentStop** | When subagent completes | Subagent tracking, coordination |
| **PreCompact** | Before context compaction | State backup, checkpoint creation |

### Event Input Schemas

Each hook receives JSON input via stdin:

#### PreToolUse / PostToolUse
```json
{
  "hook_event_name": "PreToolUse",
  "session_id": "abc-123-def",
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "/path/to/file.ts",
    "old_string": "const x = 1",
    "new_string": "const x = 2"
  },
  "tool_response": null,
  "cwd": "/path/to/project",
  "transcript_path": "/Users/user/.claude/projects/.../transcript.jsonl"
}
```

#### SessionStart / SessionEnd
```json
{
  "hook_event_name": "SessionStart",
  "session_id": "abc-123-def",
  "cwd": "/path/to/project",
  "transcript_path": "/Users/user/.claude/projects/.../transcript.jsonl"
}
```

#### UserPromptSubmit
```json
{
  "hook_event_name": "UserPromptSubmit",
  "session_id": "abc-123-def",
  "prompt": "Help me refactor this function",
  "cwd": "/path/to/project"
}
```

#### PermissionRequest
```json
{
  "hook_event_name": "PermissionRequest",
  "session_id": "abc-123-def",
  "permission_type": "bash_command",
  "tool_name": "Bash",
  "tool_input": {
    "command": "npm install"
  }
}
```

#### Notification
```json
{
  "hook_event_name": "Notification",
  "session_id": "abc-123-def",
  "notification_type": "waiting_for_user",
  "message": "Waiting for user input"
}
```

#### Stop
```json
{
  "hook_event_name": "Stop",
  "session_id": "abc-123-def",
  "stop_reason": "complete",
  "message": "Task completed successfully"
}
```

#### SubagentStop
```json
{
  "hook_event_name": "SubagentStop",
  "session_id": "abc-123-def",
  "subagent_id": "task-123",
  "subagent_type": "Explore",
  "result": "success"
}
```

#### PreCompact
```json
{
  "hook_event_name": "PreCompact",
  "session_id": "abc-123-def",
  "transcript_path": "/Users/user/.claude/projects/.../transcript.jsonl",
  "context_size": 180000
}
```

### Hook Output Protocol

Hooks communicate results via:
- **Exit code 0**: Success, continue execution
- **Exit code 2**: Block/reject the operation (PreToolUse, PermissionRequest)
- **stdout JSON**: Modify behavior or inject content

**Blocking Example (exit code 2):**
```json
{
  "blocked": true,
  "reason": "Dangerous command detected: rm -rf"
}
```

**Content Injection Example (UserPromptSubmit):**
```json
{
  "inject": "Additional context: This project uses TypeScript 5.0"
}
```

**Auto-Approve Example (PermissionRequest):**
```json
{
  "approve": true
}
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          HOOKS INTEGRATION SYSTEM                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                         HOOK MANAGER (Core)                              │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │   │
│  │  │ Hook        │  │ Hook        │  │ Hook        │  │ Hook        │    │   │
│  │  │ Registry    │  │ Installer   │  │ Validator   │  │ Templates   │    │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                     │                                           │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                    HOOK EXECUTION RUNTIME                                │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │   │
│  │  │ Bash        │  │ Python      │  │ Node.js     │  │ HTTP        │    │   │
│  │  │ Executor    │  │ Executor    │  │ Executor    │  │ Logger      │    │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                     │                                           │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                         BUILT-IN HOOKS                                   │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │   │
│  │  │ inspector   │  │ security    │  │ quality     │  │ notification│    │   │
│  │  │ -logger     │  │ -gate       │  │ -formatters │  │ -sender     │    │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         CLAUDE CODE SETTINGS                                     │
│                         ~/.claude/settings.json                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  "hooks": {                                                              │   │
│  │    "PreToolUse": [...],                                                  │   │
│  │    "PostToolUse": [...],                                                 │   │
│  │    "SessionStart": [...],                                                │   │
│  │    "SessionEnd": [...],                                                  │   │
│  │    "UserPromptSubmit": [...],                                            │   │
│  │    "PermissionRequest": [...],                                           │   │
│  │    "Notification": [...],                                                │   │
│  │    "Stop": [...],                                                        │   │
│  │    "SubagentStop": [...],                                                │   │
│  │    "PreCompact": [...]                                                   │   │
│  │  }                                                                       │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Deliverables

### 1. Hook Manager (Core)

**packages/core/src/hooks/hook-manager.ts**
```typescript
import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  HookConfig,
  HookDefinition,
  HookEvent,
  InstalledHook,
  ValidationResult,
  TestResult,
  VALID_HOOK_EVENTS
} from '@inspector-hook/protocol';

export class HookManager extends EventEmitter {
  private hooks: Map<string, HookDefinition> = new Map();
  private claudeSettingsPath: string;
  private hooksStoragePath: string;

  constructor(private storagePath: string) {
    super();
    this.claudeSettingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    this.hooksStoragePath = path.join(os.homedir(), '.claude', 'hooks');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Initialization
  // ═══════════════════════════════════════════════════════════════════════════

  async initialize(): Promise<void> {
    // Load existing hooks from storage
    await this.loadHooksFromStorage();

    // Ensure hooks directory exists
    await this.ensureDirectoryStructure();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CRUD Operations
  // ═══════════════════════════════════════════════════════════════════════════

  async createHook(definition: HookDefinition): Promise<InstalledHook> {
    // Validate hook definition
    const validation = await this.validateHook(definition);
    if (!validation.valid) {
      throw new Error(`Invalid hook: ${validation.errors.join(', ')}`);
    }

    // Generate hook ID if not provided
    const hookId = definition.id || this.generateHookId(definition);
    definition.id = hookId;

    // Save hook script to storage
    const scriptPath = await this.saveHookScript(hookId, definition);

    // Register in Claude settings
    await this.registerInClaudeSettings(definition, scriptPath);

    // Store hook metadata
    this.hooks.set(hookId, {
      ...definition,
      installedAt: new Date().toISOString(),
      enabled: definition.enabled ?? true
    });
    await this.persistHookMetadata();

    this.emit('hook:created', { hookId, definition });

    return this.getInstalledHook(hookId)!;
  }

  async updateHook(hookId: string, updates: Partial<HookDefinition>): Promise<InstalledHook> {
    const existing = this.hooks.get(hookId);
    if (!existing) {
      throw new Error(`Hook not found: ${hookId}`);
    }

    const updated: HookDefinition = { ...existing, ...updates };

    // Validate updated hook
    const validation = await this.validateHook(updated);
    if (!validation.valid) {
      throw new Error(`Invalid hook: ${validation.errors.join(', ')}`);
    }

    // Update script if content changed
    if (updates.script) {
      await this.updateHookScript(hookId, updated);
    }

    // Update Claude settings if event/matcher changed
    if (updates.event || updates.matcher) {
      await this.unregisterFromClaudeSettings(hookId, existing);
      await this.registerInClaudeSettings(updated, this.getScriptPath(hookId));
    }

    this.hooks.set(hookId, updated);
    await this.persistHookMetadata();

    this.emit('hook:updated', { hookId, definition: updated });

    return this.getInstalledHook(hookId)!;
  }

  async deleteHook(hookId: string): Promise<void> {
    const hook = this.hooks.get(hookId);
    if (!hook) {
      throw new Error(`Hook not found: ${hookId}`);
    }

    // Prevent deletion of built-in hooks
    if (hook.builtIn) {
      throw new Error('Cannot delete built-in hooks. Disable them instead.');
    }

    // Remove from Claude settings
    await this.unregisterFromClaudeSettings(hookId, hook);

    // Delete script file
    await this.deleteHookScript(hookId);

    // Remove from registry
    this.hooks.delete(hookId);
    await this.persistHookMetadata();

    this.emit('hook:deleted', { hookId });
  }

  async enableHook(hookId: string): Promise<void> {
    const hook = this.hooks.get(hookId);
    if (!hook) throw new Error(`Hook not found: ${hookId}`);

    hook.enabled = true;
    this.hooks.set(hookId, hook);

    // Re-register in Claude settings
    await this.registerInClaudeSettings(hook, this.getScriptPath(hookId));
    await this.persistHookMetadata();

    this.emit('hook:enabled', { hookId });
  }

  async disableHook(hookId: string): Promise<void> {
    const hook = this.hooks.get(hookId);
    if (!hook) throw new Error(`Hook not found: ${hookId}`);

    hook.enabled = false;
    this.hooks.set(hookId, hook);

    // Remove from Claude settings
    await this.unregisterFromClaudeSettings(hookId, hook);
    await this.persistHookMetadata();

    this.emit('hook:disabled', { hookId });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Query Operations
  // ═══════════════════════════════════════════════════════════════════════════

  getHook(hookId: string): HookDefinition | undefined {
    return this.hooks.get(hookId);
  }

  getInstalledHook(hookId: string): InstalledHook | undefined {
    const hook = this.hooks.get(hookId);
    if (!hook) return undefined;

    return {
      ...hook,
      id: hookId,
      scriptPath: this.getScriptPath(hookId),
      installedAt: hook.installedAt || new Date().toISOString(),
      enabled: hook.enabled ?? true
    };
  }

  getAllHooks(): InstalledHook[] {
    return Array.from(this.hooks.entries()).map(([id, def]) => ({
      id,
      ...def,
      scriptPath: this.getScriptPath(id),
      installedAt: def.installedAt || new Date().toISOString(),
      enabled: def.enabled ?? true
    }));
  }

  getHooksByEvent(event: HookEvent): InstalledHook[] {
    return this.getAllHooks().filter(h => h.event === event);
  }

  getHooksByCategory(category: string): InstalledHook[] {
    return this.getAllHooks().filter(h => h.category === category);
  }

  getEnabledHooks(): InstalledHook[] {
    return this.getAllHooks().filter(h => h.enabled);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Validation & Testing
  // ═══════════════════════════════════════════════════════════════════════════

  async validateHook(definition: HookDefinition): Promise<ValidationResult> {
    const errors: string[] = [];

    // Validate required fields
    if (!definition.name || definition.name.trim() === '') {
      errors.push('Hook name is required');
    }

    // Validate event type
    if (!VALID_HOOK_EVENTS.includes(definition.event)) {
      errors.push(`Invalid event type: ${definition.event}. Valid events: ${VALID_HOOK_EVENTS.join(', ')}`);
    }

    // Validate script type
    if (!['bash', 'python', 'node'].includes(definition.scriptType)) {
      errors.push(`Invalid script type: ${definition.scriptType}. Valid types: bash, python, node`);
    }

    // Validate script content
    if (!definition.script || definition.script.trim() === '') {
      errors.push('Hook script content is required');
    }

    // Validate script syntax
    if (definition.script) {
      const syntaxResult = await this.validateScriptSyntax(definition);
      if (!syntaxResult.valid) {
        errors.push(...syntaxResult.errors);
      }
    }

    // Validate timeout
    if (definition.timeout !== undefined) {
      if (definition.timeout < 100 || definition.timeout > 300000) {
        errors.push('Timeout must be between 100ms and 300000ms (5 minutes)');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  async validateScriptSyntax(definition: HookDefinition): Promise<ValidationResult> {
    const errors: string[] = [];

    try {
      switch (definition.scriptType) {
        case 'bash':
          // Check bash syntax
          const { execSync } = await import('child_process');
          const tempBash = path.join(os.tmpdir(), `hook-validate-${Date.now()}.sh`);
          await fs.writeFile(tempBash, definition.script);
          try {
            execSync(`bash -n "${tempBash}"`, { encoding: 'utf-8' });
          } catch (e: any) {
            errors.push(`Bash syntax error: ${e.message}`);
          } finally {
            await fs.unlink(tempBash).catch(() => {});
          }
          break;

        case 'python':
          // Check python syntax
          const tempPy = path.join(os.tmpdir(), `hook-validate-${Date.now()}.py`);
          await fs.writeFile(tempPy, definition.script);
          try {
            const { execSync: execPy } = await import('child_process');
            execPy(`python3 -m py_compile "${tempPy}"`, { encoding: 'utf-8' });
          } catch (e: any) {
            errors.push(`Python syntax error: ${e.message}`);
          } finally {
            await fs.unlink(tempPy).catch(() => {});
          }
          break;

        case 'node':
          // Check node syntax using esprima or similar
          try {
            new Function(definition.script);
          } catch (e: any) {
            errors.push(`JavaScript syntax error: ${e.message}`);
          }
          break;
      }
    } catch (e: any) {
      errors.push(`Validation error: ${e.message}`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  async testHook(hookId: string, testInput: unknown): Promise<TestResult> {
    const hook = this.hooks.get(hookId);
    if (!hook) throw new Error(`Hook not found: ${hookId}`);

    const scriptPath = this.getScriptPath(hookId);
    const startTime = Date.now();

    try {
      const { spawn } = await import('child_process');

      return new Promise((resolve) => {
        const child = spawn(this.getInterpreter(hook.scriptType), [scriptPath], {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: hook.timeout || 5000
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => { stdout += data.toString(); });
        child.stderr.on('data', (data) => { stderr += data.toString(); });

        // Send test input
        child.stdin.write(JSON.stringify(testInput));
        child.stdin.end();

        child.on('close', (exitCode) => {
          resolve({
            success: exitCode === 0,
            exitCode: exitCode || 0,
            stdout,
            stderr,
            duration: Date.now() - startTime
          });
        });

        child.on('error', (error) => {
          resolve({
            success: false,
            exitCode: -1,
            stdout,
            stderr,
            error: error.message,
            duration: Date.now() - startTime
          });
        });
      });
    } catch (error: any) {
      return {
        success: false,
        exitCode: -1,
        stdout: '',
        stderr: '',
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Claude Settings Management
  // ═══════════════════════════════════════════════════════════════════════════

  private async readClaudeSettings(): Promise<any> {
    try {
      const content = await fs.readFile(this.claudeSettingsPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return { hooks: {} };
    }
  }

  private async writeClaudeSettings(settings: any): Promise<void> {
    // Ensure directory exists
    await fs.mkdir(path.dirname(this.claudeSettingsPath), { recursive: true });

    // Backup existing settings
    try {
      const backup = `${this.claudeSettingsPath}.backup`;
      await fs.copyFile(this.claudeSettingsPath, backup);
    } catch {
      // No existing file to backup
    }

    // Write new settings with pretty formatting
    await fs.writeFile(
      this.claudeSettingsPath,
      JSON.stringify(settings, null, 2)
    );
  }

  private async registerInClaudeSettings(
    definition: HookDefinition,
    scriptPath: string
  ): Promise<void> {
    const settings = await this.readClaudeSettings();

    if (!settings.hooks) {
      settings.hooks = {};
    }

    if (!settings.hooks[definition.event]) {
      settings.hooks[definition.event] = [];
    }

    // Find or create matcher entry
    const matcher = definition.matcher || '';
    let matcherEntry = settings.hooks[definition.event].find(
      (e: any) => e.matcher === matcher
    );

    if (!matcherEntry) {
      matcherEntry = { matcher, hooks: [] };
      settings.hooks[definition.event].push(matcherEntry);
    }

    // Check if hook already registered
    const existingIdx = matcherEntry.hooks.findIndex(
      (h: any) => h.command === scriptPath
    );

    if (existingIdx === -1) {
      matcherEntry.hooks.push({
        type: 'command',
        command: scriptPath,
        timeout: definition.timeout || 5000
      });
    }

    await this.writeClaudeSettings(settings);
  }

  private async unregisterFromClaudeSettings(
    hookId: string,
    definition: HookDefinition
  ): Promise<void> {
    const settings = await this.readClaudeSettings();
    const scriptPath = this.getScriptPath(hookId);

    if (settings.hooks?.[definition.event]) {
      for (const matcherEntry of settings.hooks[definition.event]) {
        matcherEntry.hooks = matcherEntry.hooks.filter(
          (h: any) => h.command !== scriptPath
        );
      }

      // Remove empty matcher entries
      settings.hooks[definition.event] = settings.hooks[definition.event].filter(
        (e: any) => e.hooks.length > 0
      );

      // Remove empty event entries
      if (settings.hooks[definition.event].length === 0) {
        delete settings.hooks[definition.event];
      }
    }

    await this.writeClaudeSettings(settings);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // File System Operations
  // ═══════════════════════════════════════════════════════════════════════════

  private async ensureDirectoryStructure(): Promise<void> {
    const dirs = [
      this.hooksStoragePath,
      path.join(this.hooksStoragePath, 'lib'),
      path.join(this.hooksStoragePath, 'logging'),
      path.join(this.hooksStoragePath, 'security'),
      path.join(this.hooksStoragePath, 'quality'),
      path.join(this.hooksStoragePath, 'notifications'),
      path.join(this.hooksStoragePath, 'advanced'),
      path.join(this.hooksStoragePath, 'custom')
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  private async saveHookScript(hookId: string, definition: HookDefinition): Promise<string> {
    const scriptPath = this.getScriptPath(hookId);
    const dir = path.dirname(scriptPath);

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(scriptPath, definition.script);
    await fs.chmod(scriptPath, 0o755);

    return scriptPath;
  }

  private async updateHookScript(hookId: string, definition: HookDefinition): Promise<void> {
    const scriptPath = this.getScriptPath(hookId);
    await fs.writeFile(scriptPath, definition.script);
  }

  private async deleteHookScript(hookId: string): Promise<void> {
    const scriptPath = this.getScriptPath(hookId);
    try {
      await fs.unlink(scriptPath);
    } catch {
      // File may not exist
    }
  }

  private getScriptPath(hookId: string): string {
    const hook = this.hooks.get(hookId);
    const category = hook?.category || 'custom';
    const ext = this.getScriptExtension(hook?.scriptType || 'bash');
    return path.join(this.hooksStoragePath, category, `${hookId}${ext}`);
  }

  private getScriptExtension(scriptType: string): string {
    switch (scriptType) {
      case 'python': return '.py';
      case 'node': return '.js';
      default: return '.sh';
    }
  }

  private getInterpreter(scriptType: string): string {
    switch (scriptType) {
      case 'python': return 'python3';
      case 'node': return 'node';
      default: return 'bash';
    }
  }

  private generateHookId(definition: HookDefinition): string {
    const timestamp = Date.now().toString(36);
    const name = definition.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    return `${name}-${timestamp}`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Persistence
  // ═══════════════════════════════════════════════════════════════════════════

  private async loadHooksFromStorage(): Promise<void> {
    const metadataPath = path.join(this.storagePath, 'hooks-metadata.json');
    try {
      const content = await fs.readFile(metadataPath, 'utf-8');
      const data = JSON.parse(content);
      this.hooks = new Map(Object.entries(data.hooks || {}));
    } catch {
      this.hooks = new Map();
    }
  }

  private async persistHookMetadata(): Promise<void> {
    const metadataPath = path.join(this.storagePath, 'hooks-metadata.json');
    const data = {
      version: '1.0.0',
      updatedAt: new Date().toISOString(),
      hooks: Object.fromEntries(this.hooks)
    };

    await fs.mkdir(path.dirname(metadataPath), { recursive: true });
    await fs.writeFile(metadataPath, JSON.stringify(data, null, 2));
  }
}
```

### 2. Hook Installer

**packages/core/src/hooks/hook-installer.ts**
```typescript
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { HookManager } from './hook-manager';
import { builtInHooks } from './built-in-hooks';
import { BASH_LIBRARY_CONTENT, PYTHON_LIBRARY_CONTENT } from './shared-libraries';

export interface InstallResult {
  success: boolean;
  installedHooks: string[];
  errors: Array<{ hook: string; error: string }>;
}

export interface RepairResult {
  fixed: string[];
  failed: Array<{ id: string; error: string }>;
}

export class HookInstaller {
  private hooksDir: string;

  constructor(
    private hookManager: HookManager,
    private storagePath: string
  ) {
    this.hooksDir = path.join(os.homedir(), '.claude', 'hooks');
  }

  /**
   * Full installation of Inspector Hook system
   */
  async install(): Promise<InstallResult> {
    const results: InstallResult = {
      success: true,
      installedHooks: [],
      errors: []
    };

    try {
      // 1. Create hooks directory structure
      await this.createDirectoryStructure();

      // 2. Install shared libraries
      await this.installSharedLibraries();

      // 3. Install built-in hooks
      for (const hook of builtInHooks) {
        try {
          await this.hookManager.createHook(hook);
          results.installedHooks.push(hook.id!);
        } catch (error: any) {
          // Hook may already exist
          if (!error.message?.includes('already exists')) {
            results.errors.push({
              hook: hook.name,
              error: error.message
            });
          }
        }
      }

      // 4. Verify installation
      const verified = await this.verifyInstallation();
      if (!verified.success) {
        results.errors.push(...verified.errors);
      }

      results.success = results.errors.length === 0;

    } catch (error: any) {
      results.success = false;
      results.errors.push({ hook: 'system', error: error.message });
    }

    return results;
  }

  /**
   * Uninstall all Inspector Hook components
   */
  async uninstall(): Promise<void> {
    // Get all hooks
    const hooks = this.hookManager.getAllHooks();

    // Delete each hook
    for (const hook of hooks) {
      try {
        if (hook.builtIn) {
          // Disable built-in hooks instead of deleting
          await this.hookManager.disableHook(hook.id);
        } else {
          await this.hookManager.deleteHook(hook.id);
        }
      } catch {
        // Continue with other hooks
      }
    }
  }

  /**
   * Repair/reinstall broken hooks
   */
  async repair(): Promise<RepairResult> {
    const results: RepairResult = { fixed: [], failed: [] };

    // Check shared libraries
    await this.installSharedLibraries();

    // Check each hook
    for (const hook of this.hookManager.getAllHooks()) {
      const valid = await this.verifyHook(hook.id);
      if (!valid) {
        try {
          // Re-save the hook script
          const def = this.hookManager.getHook(hook.id);
          if (def) {
            await this.hookManager.updateHook(hook.id, { script: def.script });
            results.fixed.push(hook.id);
          }
        } catch (error: any) {
          results.failed.push({ id: hook.id, error: error.message });
        }
      }
    }

    return results;
  }

  /**
   * Check if hooks are properly installed
   */
  async checkInstallation(): Promise<{
    installed: boolean;
    hookCount: number;
    issues: string[];
  }> {
    const issues: string[] = [];

    // Check directory exists
    try {
      await fs.access(this.hooksDir);
    } catch {
      issues.push('Hooks directory does not exist');
    }

    // Check shared libraries
    try {
      await fs.access(path.join(this.hooksDir, 'lib', 'inspector-hook.sh'));
    } catch {
      issues.push('Bash library not installed');
    }

    try {
      await fs.access(path.join(this.hooksDir, 'lib', 'inspector_hook.py'));
    } catch {
      issues.push('Python library not installed');
    }

    // Check hook count
    const hooks = this.hookManager.getAllHooks();
    const enabledHooks = hooks.filter(h => h.enabled);

    return {
      installed: issues.length === 0 && hooks.length > 0,
      hookCount: enabledHooks.length,
      issues
    };
  }

  private async createDirectoryStructure(): Promise<void> {
    const dirs = [
      this.hooksDir,
      path.join(this.hooksDir, 'lib'),
      path.join(this.hooksDir, 'logging'),
      path.join(this.hooksDir, 'security'),
      path.join(this.hooksDir, 'quality'),
      path.join(this.hooksDir, 'notifications'),
      path.join(this.hooksDir, 'advanced'),
      path.join(this.hooksDir, 'custom')
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  private async installSharedLibraries(): Promise<void> {
    // Install bash library
    const bashLibPath = path.join(this.hooksDir, 'lib', 'inspector-hook.sh');
    await fs.writeFile(bashLibPath, BASH_LIBRARY_CONTENT);
    await fs.chmod(bashLibPath, 0o755);

    // Install Python library
    const pythonLibPath = path.join(this.hooksDir, 'lib', 'inspector_hook.py');
    await fs.writeFile(pythonLibPath, PYTHON_LIBRARY_CONTENT);
    await fs.chmod(pythonLibPath, 0o755);
  }

  private async verifyInstallation(): Promise<{ success: boolean; errors: Array<{ hook: string; error: string }> }> {
    const errors: Array<{ hook: string; error: string }> = [];

    // Verify each installed hook
    for (const hook of this.hookManager.getEnabledHooks()) {
      const valid = await this.verifyHook(hook.id);
      if (!valid) {
        errors.push({ hook: hook.name, error: 'Hook script not found or not executable' });
      }
    }

    return { success: errors.length === 0, errors };
  }

  private async verifyHook(hookId: string): Promise<boolean> {
    const hook = this.hookManager.getInstalledHook(hookId);
    if (!hook) return false;

    try {
      const stats = await fs.stat(hook.scriptPath);
      // Check if file exists and is executable
      return stats.isFile() && (stats.mode & 0o111) !== 0;
    } catch {
      return false;
    }
  }
}
```

### 3. Built-In Hooks Definition

**packages/core/src/hooks/built-in-hooks.ts**
```typescript
import { HookDefinition, HookEvent } from '@inspector-hook/protocol';

export const builtInHooks: HookDefinition[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // LOGGING HOOKS - Send events to Inspector Hook (All 10 events)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'inspector-logger-pre-tool',
    name: 'Inspector Logger (PreToolUse)',
    description: 'Logs all tool executions before they run',
    category: 'logging',
    event: 'PreToolUse',
    matcher: '*',
    scriptType: 'bash',
    timeout: 1000,
    script: `#!/bin/bash
source "$(dirname "$0")/../lib/inspector-hook.sh"
inspector_log
`,
    builtIn: true,
    enabled: true
  },
  {
    id: 'inspector-logger-post-tool',
    name: 'Inspector Logger (PostToolUse)',
    description: 'Logs all tool executions after they complete',
    category: 'logging',
    event: 'PostToolUse',
    matcher: '*',
    scriptType: 'bash',
    timeout: 1000,
    script: `#!/bin/bash
source "$(dirname "$0")/../lib/inspector-hook.sh"
inspector_log
`,
    builtIn: true,
    enabled: true
  },
  {
    id: 'inspector-logger-session-start',
    name: 'Inspector Logger (SessionStart)',
    description: 'Logs when Claude sessions begin',
    category: 'logging',
    event: 'SessionStart',
    matcher: '.*',
    scriptType: 'bash',
    timeout: 1000,
    script: `#!/bin/bash
source "$(dirname "$0")/../lib/inspector-hook.sh"
inspector_log
`,
    builtIn: true,
    enabled: true
  },
  {
    id: 'inspector-logger-session-end',
    name: 'Inspector Logger (SessionEnd)',
    description: 'Logs when Claude sessions end',
    category: 'logging',
    event: 'SessionEnd',
    matcher: '.*',
    scriptType: 'bash',
    timeout: 1000,
    script: `#!/bin/bash
source "$(dirname "$0")/../lib/inspector-hook.sh"
inspector_log
`,
    builtIn: true,
    enabled: true
  },
  {
    id: 'inspector-logger-prompt',
    name: 'Inspector Logger (UserPromptSubmit)',
    description: 'Logs when user submits prompts',
    category: 'logging',
    event: 'UserPromptSubmit',
    matcher: '',
    scriptType: 'bash',
    timeout: 1000,
    script: `#!/bin/bash
source "$(dirname "$0")/../lib/inspector-hook.sh"
inspector_log
`,
    builtIn: true,
    enabled: true
  },
  {
    id: 'inspector-logger-permission',
    name: 'Inspector Logger (PermissionRequest)',
    description: 'Logs permission requests',
    category: 'logging',
    event: 'PermissionRequest',
    matcher: '',
    scriptType: 'bash',
    timeout: 1000,
    script: `#!/bin/bash
source "$(dirname "$0")/../lib/inspector-hook.sh"
inspector_log
`,
    builtIn: true,
    enabled: true
  },
  {
    id: 'inspector-logger-notification',
    name: 'Inspector Logger (Notification)',
    description: 'Logs Claude notifications',
    category: 'logging',
    event: 'Notification',
    matcher: '',
    scriptType: 'bash',
    timeout: 1000,
    script: `#!/bin/bash
source "$(dirname "$0")/../lib/inspector-hook.sh"
inspector_log
`,
    builtIn: true,
    enabled: true
  },
  {
    id: 'inspector-logger-stop',
    name: 'Inspector Logger (Stop)',
    description: 'Logs when Claude stops',
    category: 'logging',
    event: 'Stop',
    matcher: '',
    scriptType: 'bash',
    timeout: 1000,
    script: `#!/bin/bash
source "$(dirname "$0")/../lib/inspector-hook.sh"
inspector_log
`,
    builtIn: true,
    enabled: true
  },
  {
    id: 'inspector-logger-subagent',
    name: 'Inspector Logger (SubagentStop)',
    description: 'Logs when subagents complete',
    category: 'logging',
    event: 'SubagentStop',
    matcher: '',
    scriptType: 'bash',
    timeout: 1000,
    script: `#!/bin/bash
source "$(dirname "$0")/../lib/inspector-hook.sh"
inspector_log
`,
    builtIn: true,
    enabled: true
  },
  {
    id: 'inspector-logger-compact',
    name: 'Inspector Logger (PreCompact)',
    description: 'Logs before context compaction',
    category: 'logging',
    event: 'PreCompact',
    matcher: '',
    scriptType: 'bash',
    timeout: 1000,
    script: `#!/bin/bash
source "$(dirname "$0")/../lib/inspector-hook.sh"
inspector_log
`,
    builtIn: true,
    enabled: true
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SECURITY HOOKS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'security-gate',
    name: 'Security Gate',
    description: 'Blocks dangerous bash commands (rm -rf /, sudo, chmod 777, etc.)',
    category: 'security',
    event: 'PreToolUse',
    matcher: 'Bash',
    scriptType: 'python',
    timeout: 5000,
    script: `#!/usr/bin/env python3
"""Security gate - blocks dangerous commands"""
import sys
import json
import re

DANGEROUS_PATTERNS = [
    r'rm\\s+-rf\\s+/',
    r'sudo\\s+rm',
    r'chmod\\s+777',
    r':(){ :|:& };:',
    r'dd\\s+if=/dev/zero',
    r'mkfs\\.',
    r'> /dev/sda',
    r'curl.*\\|.*sh',
    r'wget.*\\|.*sh',
]

def main():
    try:
        input_data = json.load(sys.stdin)
        command = input_data.get('tool_input', {}).get('command', '')

        for pattern in DANGEROUS_PATTERNS:
            if re.search(pattern, command, re.IGNORECASE):
                print(json.dumps({
                    'blocked': True,
                    'reason': f'Dangerous command pattern detected'
                }))
                sys.exit(2)

        sys.exit(0)
    except Exception as e:
        sys.exit(0)

if __name__ == '__main__':
    main()
`,
    builtIn: true,
    enabled: true
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // QUALITY HOOKS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'biome-format',
    name: 'Biome Formatter',
    description: 'Auto-formats JS/TS/JSON files with Biome after edits',
    category: 'quality',
    event: 'PostToolUse',
    matcher: 'Write|Edit',
    scriptType: 'bash',
    timeout: 10000,
    script: `#!/bin/bash
source "$(dirname "$0")/../lib/inspector-hook.sh"

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // ""')

[[ -z "$FILE_PATH" ]] && exit 0
[[ ! "$FILE_PATH" =~ \\.(js|jsx|ts|tsx|json)$ ]] && exit 0
[[ ! -f "$FILE_PATH" ]] && exit 0

command -v biome &> /dev/null || exit 0

if biome format --write "$FILE_PATH" 2>/dev/null; then
    inspector_info "Formatted: $FILE_PATH"
fi

exit 0
`,
    builtIn: true,
    enabled: true
  },
  {
    id: 'ruff-format',
    name: 'Ruff Formatter',
    description: 'Auto-formats Python files with Ruff after edits',
    category: 'quality',
    event: 'PostToolUse',
    matcher: 'Write|Edit',
    scriptType: 'bash',
    timeout: 10000,
    script: `#!/bin/bash
source "$(dirname "$0")/../lib/inspector-hook.sh"

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // ""')

[[ -z "$FILE_PATH" ]] && exit 0
[[ ! "$FILE_PATH" =~ \\.py$ ]] && exit 0
[[ ! -f "$FILE_PATH" ]] && exit 0

command -v ruff &> /dev/null || exit 0

if ruff format "$FILE_PATH" 2>/dev/null; then
    inspector_info "Formatted: $FILE_PATH"
fi

exit 0
`,
    builtIn: true,
    enabled: true
  },
  {
    id: 'type-check',
    name: 'TypeScript Type Check',
    description: 'Runs tsc type check after TypeScript file changes',
    category: 'quality',
    event: 'PostToolUse',
    matcher: 'Write|Edit',
    scriptType: 'bash',
    timeout: 30000,
    script: `#!/bin/bash
source "$(dirname "$0")/../lib/inspector-hook.sh"

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // ""')
CWD=$(echo "$INPUT" | jq -r '.cwd // ""')

[[ ! "$FILE_PATH" =~ \\.tsx?$ ]] && exit 0

PROJ_ROOT="$CWD"
while [[ "$PROJ_ROOT" != "/" ]]; do
    [[ -f "$PROJ_ROOT/tsconfig.json" ]] && break
    PROJ_ROOT=$(dirname "$PROJ_ROOT")
done

[[ ! -f "$PROJ_ROOT/tsconfig.json" ]] && exit 0

cd "$PROJ_ROOT"
if ! npx tsc --noEmit 2>&1 | head -20; then
    inspector_warn "Type check found issues"
fi

exit 0
`,
    builtIn: true,
    enabled: false  // Disabled by default
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // NOTIFICATION HOOKS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'notify-stop',
    name: 'Desktop Notification (Stop)',
    description: 'Shows desktop notification when Claude stops',
    category: 'notifications',
    event: 'Stop',
    matcher: '',
    scriptType: 'bash',
    timeout: 3000,
    script: `#!/bin/bash
INPUT=$(cat)
REASON=$(echo "$INPUT" | jq -r '.stop_reason // "completed"')
MSG=$(echo "$INPUT" | jq -r '.message // "Claude has stopped"')

if command -v osascript &> /dev/null; then
    osascript -e "display notification \\"$MSG\\" with title \\"Claude Code\\" subtitle \\"$REASON\\""
elif command -v notify-send &> /dev/null; then
    notify-send "Claude Code - $REASON" "$MSG"
fi

exit 0
`,
    builtIn: true,
    enabled: true
  },
  {
    id: 'notify-question',
    name: 'Desktop Notification (Question)',
    description: 'Shows desktop notification when Claude asks a question',
    category: 'notifications',
    event: 'PreToolUse',
    matcher: 'AskUserQuestion',
    scriptType: 'bash',
    timeout: 3000,
    script: `#!/bin/bash
if command -v osascript &> /dev/null; then
    osascript -e 'display notification "Claude is waiting for your response" with title "Claude Code" sound name "Ping"'
elif command -v notify-send &> /dev/null; then
    notify-send -u critical "Claude Code" "Claude is waiting for your response"
fi

exit 0
`,
    builtIn: true,
    enabled: true
  },
  {
    id: 'notify-waiting',
    name: 'Desktop Notification (Waiting)',
    description: 'Shows notification when Claude is waiting for input',
    category: 'notifications',
    event: 'Notification',
    matcher: '',
    scriptType: 'bash',
    timeout: 3000,
    script: `#!/bin/bash
INPUT=$(cat)
TYPE=$(echo "$INPUT" | jq -r '.notification_type // ""')

[[ "$TYPE" != "waiting_for_user" ]] && exit 0

if command -v osascript &> /dev/null; then
    osascript -e 'display notification "Claude needs your attention" with title "Claude Code" sound name "Ping"'
elif command -v notify-send &> /dev/null; then
    notify-send -u critical "Claude Code" "Claude needs your attention"
fi

exit 0
`,
    builtIn: true,
    enabled: true
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ADVANCED HOOKS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'context-loader',
    name: 'Context Loader',
    description: 'Loads project context files (CLAUDE.md, .claude/context.md) on session start',
    category: 'advanced',
    event: 'SessionStart',
    matcher: '.*',
    scriptType: 'bash',
    timeout: 5000,
    script: `#!/bin/bash
INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // ""')

CONTEXT=""
for file in "$CWD/CLAUDE.md" "$CWD/.claude/context.md" "$CWD/AI_CONTEXT.md"; do
    if [[ -f "$file" ]]; then
        CONTEXT="$CONTEXT\\n$(cat "$file")"
    fi
done

if [[ -n "$CONTEXT" ]]; then
    echo "{\"inject\": $(echo "$CONTEXT" | jq -Rs .)}"
fi

exit 0
`,
    builtIn: true,
    enabled: true
  },
  {
    id: 'state-backup',
    name: 'State Backup',
    description: 'Backs up conversation transcript before context compaction',
    category: 'advanced',
    event: 'PreCompact',
    matcher: '',
    scriptType: 'bash',
    timeout: 10000,
    script: `#!/bin/bash
source "$(dirname "$0")/../lib/inspector-hook.sh"

INPUT=$(cat)
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // ""')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // ""')

if [[ -n "$TRANSCRIPT" && -f "$TRANSCRIPT" ]]; then
    BACKUP_DIR="$HOME/.inspector-hook/backups"
    mkdir -p "$BACKUP_DIR"

    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    BACKUP_FILE="$BACKUP_DIR/session_\${SESSION_ID:0:8}_$TIMESTAMP.jsonl"

    cp "$TRANSCRIPT" "$BACKUP_FILE"
    inspector_info "Backed up transcript to $BACKUP_FILE"
fi

exit 0
`,
    builtIn: true,
    enabled: true
  },
  {
    id: 'subagent-coordinator',
    name: 'Subagent Coordinator',
    description: 'Tracks and coordinates subagent execution',
    category: 'advanced',
    event: 'SubagentStop',
    matcher: '',
    scriptType: 'bash',
    timeout: 5000,
    script: `#!/bin/bash
source "$(dirname "$0")/../lib/inspector-hook.sh"

INPUT=$(cat)
SUBAGENT_TYPE=$(echo "$INPUT" | jq -r '.subagent_type // ""')
RESULT=$(echo "$INPUT" | jq -r '.result // "unknown"')

inspector_info "Subagent completed: $SUBAGENT_TYPE ($RESULT)"

exit 0
`,
    builtIn: true,
    enabled: true
  }
];

// Hook categories for UI organization
export const hookCategories = [
  { id: 'logging', name: 'Logging', description: 'Send events to Inspector Hook', icon: '📝' },
  { id: 'security', name: 'Security', description: 'Block dangerous operations', icon: '🔒' },
  { id: 'quality', name: 'Quality', description: 'Code formatting and validation', icon: '✨' },
  { id: 'notifications', name: 'Notifications', description: 'Desktop alerts and sounds', icon: '🔔' },
  { id: 'advanced', name: 'Advanced', description: 'Context loading and state management', icon: '⚙️' },
  { id: 'custom', name: 'Custom', description: 'User-created hooks', icon: '🛠️' }
];

// Valid hook events (all 10)
export const VALID_HOOK_EVENTS: HookEvent[] = [
  'PreToolUse',
  'PostToolUse',
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PermissionRequest',
  'Notification',
  'Stop',
  'SubagentStop',
  'PreCompact'
];
```

### 4. Shared Libraries

**packages/core/src/hooks/shared-libraries.ts**
```typescript
export const BASH_LIBRARY_CONTENT = `#!/bin/bash
# Inspector Hook - Shared Bash Library v1.0.0
# Source this in your hooks: source "$(dirname "$0")/../lib/inspector-hook.sh"

INSPECTOR_PORT_FILE="\${INSPECTOR_PORT_FILE:-/tmp/inspector-hook.port}"

_inspector_get_port() {
    [[ -f "$INSPECTOR_PORT_FILE" ]] && cat "$INSPECTOR_PORT_FILE" 2>/dev/null
}

inspector_log() {
    local port=$(_inspector_get_port)
    [[ -z "$port" ]] && return 0

    local input=$(cat)
    local hook_name=$(echo "$input" | jq -r '.hook_event_name // "unknown"')
    local session_id=$(echo "$input" | jq -r '.session_id // ""')
    local tool_name=$(echo "$input" | jq -r '.tool_name // ""')
    local file_path=$(echo "$input" | jq -r '.tool_input.file_path // .tool_input.path // ""')
    local cwd=$(echo "$input" | jq -r '.cwd // ""')
    local timestamp=$(date -u '+%Y-%m-%dT%H:%M:%S.000Z')

    local message="$hook_name"
    [[ -n "$tool_name" ]] && message="$hook_name: $tool_name"
    [[ -n "$file_path" ]] && message="$message - $file_path"

    local payload=$(echo "$input" | jq \\
        --arg ts "$timestamp" \\
        --arg hook "$hook_name" \\
        --arg level "info" \\
        --arg session "$session_id" \\
        --arg tool "$tool_name" \\
        --arg file "$file_path" \\
        --arg msg "$message" \\
        --arg cwd "$cwd" \\
        '{
            timestamp: $ts,
            hook: $hook,
            event: $hook,
            level: $level,
            sessionId: $session,
            tool: $tool,
            file: $file,
            message: $msg,
            cwd: $cwd,
            details: {
                toolInput: .tool_input,
                toolResponse: .tool_response
            }
        }')

    curl -s -X POST "http://127.0.0.1:$port/api/log" \\
        -H "Content-Type: application/json" \\
        -d "$payload" \\
        --connect-timeout 0.5 \\
        --max-time 1 \\
        2>/dev/null &

    disown 2>/dev/null || true
}

inspector_log_msg() {
    local level="\${1:-info}"
    local message="\${2:-}"
    local tool="\${3:-}"
    local file="\${4:-}"

    local port=$(_inspector_get_port)
    [[ -z "$port" ]] && return 0

    local hook_name="\${HOOK_NAME:-$(basename "\${BASH_SOURCE[1]:-$0}" .sh)}"
    local timestamp=$(date -u '+%Y-%m-%dT%H:%M:%S.000Z')

    local payload=$(jq -n \\
        --arg ts "$timestamp" \\
        --arg hook "$hook_name" \\
        --arg level "$level" \\
        --arg msg "$message" \\
        --arg tool "$tool" \\
        --arg file "$file" \\
        '{timestamp: $ts, hook: $hook, event: $hook, level: $level, message: $msg, tool: $tool, file: $file}')

    curl -s -X POST "http://127.0.0.1:$port/api/log" \\
        -H "Content-Type: application/json" \\
        -d "$payload" \\
        --connect-timeout 0.5 \\
        --max-time 1 \\
        2>/dev/null &

    disown 2>/dev/null || true
}

inspector_info() { inspector_log_msg "info" "$@"; }
inspector_warn() { inspector_log_msg "warn" "$@"; }
inspector_error() { inspector_log_msg "error" "$@"; }
inspector_blocked() { inspector_log_msg "blocked" "$@"; }

inspector_block() {
    local reason="\${1:-Operation blocked}"
    inspector_blocked "$reason"
    echo "{\\"blocked\\": true, \\"reason\\": $(echo "$reason" | jq -Rs .)}"
    exit 2
}

inspector_approve() {
    echo '{"approve": true}'
    exit 0
}
`;

export const PYTHON_LIBRARY_CONTENT = `#!/usr/bin/env python3
"""Inspector Hook - Shared Python Library v1.0.0"""

import json
import os
import sys
import urllib.request
from datetime import datetime, timezone
from typing import Any, Optional

INSPECTOR_PORT_FILE = os.environ.get('INSPECTOR_PORT_FILE', '/tmp/inspector-hook.port')

def _get_port() -> Optional[int]:
    try:
        with open(INSPECTOR_PORT_FILE, 'r') as f:
            return int(f.read().strip())
    except (FileNotFoundError, ValueError):
        return None

def _send_log(payload: dict) -> bool:
    port = _get_port()
    if not port:
        return False
    try:
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(
            f'http://127.0.0.1:{port}/api/log',
            data=data,
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        urllib.request.urlopen(req, timeout=1)
        return True
    except Exception:
        return False

def inspector_log(input_data: Optional[dict] = None) -> None:
    if input_data is None:
        try:
            input_data = json.load(sys.stdin)
        except json.JSONDecodeError:
            return

    hook_name = input_data.get('hook_event_name', 'unknown')
    session_id = input_data.get('session_id', '')
    tool_name = input_data.get('tool_name', '')
    tool_input = input_data.get('tool_input', {})
    file_path = tool_input.get('file_path') or tool_input.get('path', '')
    cwd = input_data.get('cwd', '')

    message = hook_name
    if tool_name:
        message = f"{hook_name}: {tool_name}"
        if file_path:
            message = f"{message} - {file_path}"

    payload = {
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'hook': hook_name,
        'event': hook_name,
        'level': 'info',
        'sessionId': session_id,
        'tool': tool_name,
        'file': file_path,
        'message': message,
        'cwd': cwd,
        'details': {
            'toolInput': tool_input,
            'toolResponse': input_data.get('tool_response')
        }
    }
    _send_log(payload)

def inspector_log_msg(level: str = 'info', message: str = '', tool: str = '', file: str = '', hook: Optional[str] = None) -> None:
    payload = {
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'hook': hook or os.path.basename(sys.argv[0]).replace('.py', ''),
        'level': level,
        'message': message,
        'tool': tool,
        'file': file
    }
    _send_log(payload)

def inspector_info(message: str, **kwargs) -> None:
    inspector_log_msg('info', message, **kwargs)

def inspector_warn(message: str, **kwargs) -> None:
    inspector_log_msg('warn', message, **kwargs)

def inspector_error(message: str, **kwargs) -> None:
    inspector_log_msg('error', message, **kwargs)

def inspector_blocked(message: str, **kwargs) -> None:
    inspector_log_msg('blocked', message, **kwargs)

def block(reason: str) -> None:
    inspector_blocked(reason)
    print(json.dumps({'blocked': True, 'reason': reason}))
    sys.exit(2)

def approve() -> None:
    print(json.dumps({'approve': True}))
    sys.exit(0)

def read_input() -> dict:
    try:
        return json.load(sys.stdin)
    except json.JSONDecodeError:
        return {}
`;
```

---

## Hook Management UI

### Hooks Tab in Inspector Hook Panel

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ┌─ Tabs ─────────────────────────────────────────────────────────────────────────┐
│ │ [Dashboard] [Logs] [Sessions] [File Changes] [Hooks ✓]                         │
│ └────────────────────────────────────────────────────────────────────────────────┘
│                                                                                   │
│ ┌─ Toolbar ──────────────────────────────────────────────────────────────────────┐
│ │ [+ New Hook] [Install All] [Repair] │ Filter: [All Categories ▼] [All Events▼] │
│ └────────────────────────────────────────────────────────────────────────────────┘
│                                                                                   │
│ ┌─ Hooks By Category ────────────────────────────────────────────────────────────┐
│ │                                                                                │
│ │ ▼ 📝 Logging (10 hooks)                                                        │
│ │   ┌────────────────────────────────────────────────────────────────────────┐  │
│ │   │ [✓] Inspector Logger (PreToolUse)      PreToolUse    *      [Edit][⋮]  │  │
│ │   │ [✓] Inspector Logger (PostToolUse)     PostToolUse   *      [Edit][⋮]  │  │
│ │   │ [✓] Inspector Logger (SessionStart)    SessionStart  .*     [Edit][⋮]  │  │
│ │   │ [✓] Inspector Logger (SessionEnd)      SessionEnd    .*     [Edit][⋮]  │  │
│ │   │ [✓] Inspector Logger (UserPrompt...)   UserPrompt... -      [Edit][⋮]  │  │
│ │   │ ... (5 more)                                                           │  │
│ │   └────────────────────────────────────────────────────────────────────────┘  │
│ │                                                                                │
│ │ ▼ 🔒 Security (1 hook)                                                         │
│ │   ┌────────────────────────────────────────────────────────────────────────┐  │
│ │   │ [✓] Security Gate                      PreToolUse    Bash   [Edit][⋮]  │  │
│ │   └────────────────────────────────────────────────────────────────────────┘  │
│ │                                                                                │
│ │ ▼ ✨ Quality (3 hooks)                                                         │
│ │   ┌────────────────────────────────────────────────────────────────────────┐  │
│ │   │ [✓] Biome Formatter                    PostToolUse   Write|E[Edit][⋮]  │  │
│ │   │ [✓] Ruff Formatter                     PostToolUse   Write|E[Edit][⋮]  │  │
│ │   │ [ ] TypeScript Check                   PostToolUse   Write|E[Edit][⋮]  │  │
│ │   └────────────────────────────────────────────────────────────────────────┘  │
│ │                                                                                │
│ │ ▶ 🔔 Notifications (3 hooks)                                                   │
│ │ ▶ ⚙️ Advanced (3 hooks)                                                        │
│ │ ▶ 🛠️ Custom (0 hooks)                                                          │
│ │                                                                                │
│ └────────────────────────────────────────────────────────────────────────────────┘
│                                                                                   │
│ ┌─ Hook Editor (appears when editing) ───────────────────────────────────────────┐
│ │ Name:     [Security Gate                                    ]                  │
│ │ Category: [Security           ▼] Event: [PreToolUse        ▼]                  │
│ │ Matcher:  [Bash                         ] Timeout: [5000   ] ms                │
│ │ Type:     ○ Bash  ● Python  ○ Node.js                                          │
│ │                                                                                │
│ │ Script:                                                                        │
│ │ ┌──────────────────────────────────────────────────────────────────────────┐  │
│ │ │ #!/usr/bin/env python3                                                   │  │
│ │ │ """Security gate - blocks dangerous commands"""                          │  │
│ │ │ import sys, json, re                                                     │  │
│ │ │                                                                          │  │
│ │ │ DANGEROUS_PATTERNS = [                                                   │  │
│ │ │     r'rm\\s+-rf\\s+/',                                                    │  │
│ │ │     ...                                                                  │  │
│ │ └──────────────────────────────────────────────────────────────────────────┘  │
│ │                                                                                │
│ │ [Test Hook] [Validate]                              [Cancel] [Save Changes]    │
│ └────────────────────────────────────────────────────────────────────────────────┘
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## Tasks

### Task 4.1: Hook Manager Implementation
- [ ] Implement HookManager class with full CRUD
- [ ] Implement Claude settings.json integration
- [ ] Add hook persistence to storage
- [ ] Add hook validation

### Task 4.2: Hook Installer Implementation
- [ ] Implement HookInstaller class
- [ ] Create directory structure creation
- [ ] Implement shared library installation
- [ ] Add verification and repair functionality

### Task 4.3: Built-In Hooks (All 10 Events)
- [ ] Implement 10 logging hooks (one per event)
- [ ] Implement security gate hook
- [ ] Implement quality hooks (biome, ruff, type-check)
- [ ] Implement notification hooks (stop, question, waiting)
- [ ] Implement advanced hooks (context, backup, subagent)

### Task 4.4: Shared Libraries
- [ ] Implement Bash library (inspector-hook.sh)
- [ ] Implement Python library (inspector_hook.py)
- [ ] Test with all hook types

### Task 4.5: Hook Management IPC
- [ ] Add hooks.* IPC methods
- [ ] Wire up to VS Code extension
- [ ] Add webview message handlers

### Task 4.6: Hook Management UI
- [ ] Create hooks list view by category
- [ ] Create hook editor component
- [ ] Add hook testing functionality
- [ ] Add enable/disable toggles

### Task 4.7: Testing & Validation
- [ ] Test hook installation on fresh system
- [ ] Test all CRUD operations
- [ ] Test all 10 built-in logging hooks
- [ ] Test security/quality/notification hooks
- [ ] Performance testing (< 50ms overhead)

---

## Acceptance Criteria

1. **Hook Installation**
   - All built-in hooks install correctly on first run
   - Claude settings.json updated properly with all hooks
   - Hooks directory structure created with shared libraries
   - Installation works on macOS and Linux

2. **Hook Management**
   - Create, update, delete hooks works correctly
   - Enable/disable toggles work and update Claude settings
   - Hook validation prevents invalid configurations
   - Hook testing provides accurate feedback

3. **All 10 Hook Events**
   - Logging hooks capture all Claude Code events
   - Events properly sent to Inspector Hook core
   - No events missed or duplicated

4. **Built-In Hooks**
   - Security gate blocks dangerous commands
   - Quality hooks format code correctly
   - Notifications work on macOS and Linux
   - Context loader injects project context

5. **UI**
   - Hooks organized by category
   - Editor allows full customization
   - Test and validate functionality works
   - Clear status indicators

---

## Success Metrics

- [ ] All 10 Claude Code events supported and logged
- [ ] < 50ms hook execution overhead per hook
- [ ] 100% of built-in hooks functional on clean install
- [ ] Hook management UI fully operational
- [ ] Works on macOS and Linux
