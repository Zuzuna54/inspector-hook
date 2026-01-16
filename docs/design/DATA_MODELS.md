# Data Models Design Document

**Version**: 1.0.0
**Last Updated**: January 2026

---

## Table of Contents

1. [Overview](#overview)
2. [Core Data Models](#core-data-models)
3. [Session Models](#session-models)
4. [File Change Models](#file-change-models)
5. [Version History Models](#version-history-models)
6. [Archive Models](#archive-models)
7. [Rules Models](#rules-models)
8. [Analytics Models](#analytics-models)
9. [Filter and Query Types](#filter-and-query-types)
10. [Hook Models](#hook-models)
11. [Database Schema](#database-schema)

---

## Overview

All data models are defined in the `@inspector-hook/protocol` package and shared between core, wrappers, and UI. Models use TypeScript interfaces for type safety.

---

## Core Data Models

### LogEntry

The fundamental unit of data - a single log entry from hooks.

```typescript
/**
 * A single log entry received from AI agent hooks
 */
export interface LogEntry {
  /** Unique identifier (UUID) */
  id: string;

  /** ISO 8601 timestamp */
  timestamp: string;

  /** Name of the hook that generated this log */
  hook: string;

  /** Event type (e.g., 'tool.start', 'tool.end', 'session.start') */
  event: string;

  /** Log level */
  level: LogLevel;

  /** Human-readable message */
  message: string;

  /** Associated session ID (if any) */
  sessionId?: string;

  /** Tool name (if applicable) */
  tool?: string;

  /** File path (if applicable) */
  file?: string;

  /** Additional structured data */
  details?: Record<string, unknown>;
}

export type LogLevel = 'info' | 'warn' | 'error' | 'blocked';
```

### Stats

Aggregated statistics for the dashboard.

```typescript
/**
 * Aggregated log statistics
 */
export interface Stats {
  /** Total number of logs */
  totalLogs: number;

  /** Number of error-level logs */
  errors: number;

  /** Number of warning-level logs */
  warnings: number;

  /** Number of blocked operations */
  blocked: number;

  /** Logs per minute (current rate) */
  logsPerMinute: number;

  /** Active session count */
  activeSessions: number;

  /** Pending file changes count */
  pendingChanges: number;
}
```

---

## Session Models

### Session

Represents an AI agent session.

```typescript
/**
 * An AI agent session (e.g., a Claude Code conversation)
 */
export interface Session {
  /** Unique session identifier */
  id: string;

  /** Session status */
  status: SessionStatus;

  /** ISO 8601 start time */
  startTime: string;

  /** ISO 8601 end time (if completed) */
  endTime?: string;

  /** Tool executions within this session */
  toolExecutions: ToolExecution[];

  /** File changes made during this session */
  fileChanges: string[]; // Change IDs

  /** Session metadata */
  metadata?: SessionMetadata;
}

export type SessionStatus = 'active' | 'completed' | 'error' | 'terminated';

export interface SessionMetadata {
  /** Working directory */
  workingDirectory?: string;

  /** Project name */
  projectName?: string;

  /** User identifier */
  userId?: string;

  /** Additional custom metadata */
  [key: string]: unknown;
}
```

### ToolExecution

A single tool invocation within a session.

```typescript
/**
 * A tool execution within a session
 */
export interface ToolExecution {
  /** Unique execution identifier */
  id: string;

  /** Tool name (e.g., 'Read', 'Write', 'Edit', 'Bash') */
  tool: string;

  /** Tool input/arguments */
  input: Record<string, unknown>;

  /** ISO 8601 start time */
  startTime: string;

  /** ISO 8601 end time */
  endTime?: string;

  /** Execution result (if completed) */
  result?: unknown;

  /** Error message (if failed) */
  error?: string;

  /** Execution status */
  status: ExecutionStatus;

  /** Files affected by this execution */
  affectedFiles?: string[];
}

export type ExecutionStatus = 'running' | 'completed' | 'failed' | 'blocked';
```

---

## File Change Models

### FileChange

A tracked file modification.

```typescript
/**
 * A tracked file change
 */
export interface FileChange {
  /** Unique change identifier */
  id: string;

  /** Absolute file path */
  filePath: string;

  /** Session that made this change */
  sessionId: string;

  /** ISO 8601 timestamp of change detection */
  timestamp: string;

  /** File content before the change */
  beforeContent: string;

  /** File content after the change */
  afterContent: string;

  /** Change status */
  status: ChangeStatus;

  /** Tool that made the change (if known) */
  tool?: string;

  /** Hash of before content */
  beforeHash?: string;

  /** Hash of after content */
  afterHash?: string;
}

export type ChangeStatus = 'pending' | 'kept' | 'reverted' | 'staged';
```

### FileSnapshot

A point-in-time capture of a file.

```typescript
/**
 * A snapshot of a file at a specific point in time
 */
export interface FileSnapshot {
  /** Absolute file path */
  path: string;

  /** File content */
  content: string;

  /** MD5 hash of content */
  hash: string;

  /** ISO 8601 timestamp */
  timestamp: string;

  /** File size in bytes */
  size: number;

  /** Whether the file exists (false for deleted files) */
  exists?: boolean;
}
```

### DiffResult

Computed difference between two file versions.

```typescript
/**
 * Diff computation result
 */
export interface DiffResult {
  /** Original content */
  beforeContent: string;

  /** Modified content */
  afterContent: string;

  /** Diff hunks */
  hunks: DiffHunk[];

  /** Total lines added */
  additions: number;

  /** Total lines removed */
  deletions: number;

  /** Unified diff string (optional) */
  unifiedDiff?: string;
}

/**
 * A single diff hunk (continuous block of changes)
 */
export interface DiffHunk {
  /** Unique hunk identifier */
  id: string;

  /** Starting line in original file */
  oldStart: number;

  /** Number of lines in original */
  oldLines: number;

  /** Starting line in modified file */
  newStart: number;

  /** Number of lines in modified */
  newLines: number;

  /** Individual line changes */
  lines: DiffLine[];

  /** Lines added in this hunk */
  additions: number;

  /** Lines removed in this hunk */
  deletions: number;

  /** Hunk operation status */
  status: HunkStatus;
}

export interface DiffLine {
  /** Line change type */
  type: 'added' | 'removed' | 'context';

  /** Line content (without +/- prefix) */
  content: string;

  /** Line number in respective file */
  lineNumber: number;
}

export type HunkStatus = 'pending' | 'kept' | 'reverted';
```

---

## Version History Models

### VersionHistory

Complete version history for a file.

```typescript
/**
 * Version history for a single file
 */
export interface VersionHistory {
  /** Absolute file path */
  filePath: string;

  /** All versions, oldest first */
  versions: FileVersion[];

  /** Total version count */
  versionCount: number;

  /** First tracked timestamp */
  firstTracked: string;

  /** Last modified timestamp */
  lastModified: string;
}
```

### FileVersion

A single version in the history.

```typescript
/**
 * A single file version
 */
export interface FileVersion {
  /** Version identifier (e.g., 'v1', 'v2') */
  id: string;

  /** Numeric version number */
  versionNumber: number;

  /** File content at this version */
  content: string;

  /** ISO 8601 timestamp */
  timestamp: string;

  /** Session that created this version */
  sessionId: string;

  /** MD5 hash of content */
  hash: string;

  /** Size in bytes */
  size?: number;

  /** Optional label/description */
  label?: string;
}
```

---

## Archive Models

### ArchivedChange

A kept change stored in the archive.

```typescript
/**
 * An archived (kept) file change
 */
export interface ArchivedChange {
  /** Original change ID */
  id: string;

  /** Absolute file path */
  filePath: string;

  /** Session that made the original change */
  sessionId: string;

  /** ISO 8601 archive timestamp */
  archivedAt: string;

  /** Original change timestamp */
  originalTimestamp: string;

  /** Content before the change */
  beforeContent: string;

  /** Content after the change (the kept version) */
  afterContent: string;

  /** Optional archive notes */
  notes?: string;

  /** Tags for organization */
  tags?: string[];
}
```

---

## Rules Models

### Rule

An automation rule.

```typescript
/**
 * An automation rule
 */
export interface Rule {
  /** Unique rule identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Rule description */
  description?: string;

  /** Whether the rule is active */
  enabled: boolean;

  /** Evaluation priority (higher = earlier) */
  priority: number;

  /** Condition to match */
  condition: RuleCondition;

  /** Action to take when matched */
  action: RuleAction;

  /** Stop evaluating further rules if matched */
  stopOnMatch: boolean;

  /** ISO 8601 creation timestamp */
  createdAt: string;

  /** ISO 8601 last modified timestamp */
  updatedAt: string;
}
```

### RuleCondition

A condition for rule matching.

```typescript
/**
 * Rule condition (can be nested)
 */
export interface RuleCondition {
  /** Condition type */
  type: ConditionType;

  /** Value to match against (for simple conditions) */
  value?: string;

  /** Nested conditions (for compound conditions) */
  conditions?: RuleCondition[];

  /** Field to match on (for field conditions) */
  field?: string;

  /** Comparison operator */
  operator?: ComparisonOperator;
}

export type ConditionType =
  | 'event_type'    // Match event type
  | 'tool_name'     // Match tool name
  | 'level'         // Match log level
  | 'file_pattern'  // Match file path pattern
  | 'message_pattern' // Match message content
  | 'and'           // All conditions must match
  | 'or'            // Any condition must match
  | 'not';          // Negate condition

export type ComparisonOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'matches'       // Regex match
  | 'starts_with'
  | 'ends_with';
```

### RuleAction

An action to take when a rule matches.

```typescript
/**
 * Action to execute when rule matches
 */
export interface RuleAction {
  /** Action type */
  type: ActionType;

  /** Action parameters */
  params?: ActionParams;
}

export type ActionType =
  | 'notify'        // Show notification
  | 'block'         // Block the operation
  | 'log'           // Log to special category
  | 'auto_keep'     // Automatically keep file change
  | 'auto_revert'   // Automatically revert file change
  | 'webhook'       // Call external webhook
  | 'tag';          // Add tag to log/change

export interface ActionParams {
  /** Notification/block message */
  message?: string;

  /** Notification level */
  notificationLevel?: 'info' | 'warning' | 'error';

  /** Webhook URL */
  webhookUrl?: string;

  /** Tags to add */
  tags?: string[];

  /** Custom parameters */
  [key: string]: unknown;
}
```

---

## Analytics Models

### Analytics

Computed analytics data.

```typescript
/**
 * Analytics computation result
 */
export interface Analytics {
  /** Summary statistics */
  summary: AnalyticsSummary;

  /** Time series data for charts */
  timeSeries: TimeSeriesData[];

  /** Top hooks by usage */
  topHooks: TopItem[];

  /** Top tools by usage */
  topTools: TopItem[];

  /** Most frequently changed files */
  topFiles: TopItem[];

  /** Error rate percentage */
  errorRate: number;

  /** Average session duration (seconds) */
  averageSessionDuration: number;

  /** Computation timestamp */
  computedAt: string;
}

export interface AnalyticsSummary {
  totalLogs: number;
  totalSessions: number;
  activeSessions: number;
  pendingChanges: number;
  errors: number;
  warnings: number;
  blocked: number;
}

export interface TimeSeriesData {
  /** ISO 8601 timestamp (minute granularity) */
  time: string;

  /** Count for this time bucket */
  count: number;

  /** Optional breakdown by level */
  byLevel?: {
    info: number;
    warn: number;
    error: number;
    blocked: number;
  };
}

export interface TopItem {
  /** Item name (hook name, tool name, file path) */
  name: string;

  /** Usage count */
  count: number;

  /** Percentage of total */
  percentage?: number;
}
```

---

## Staging Models

### StagedChange

A change staged for application.

```typescript
/**
 * A change staged for application
 */
export interface StagedChange {
  /** Original change ID */
  id: string;

  /** Staging operation type */
  type: StagingType;

  /** Target file path */
  filePath: string;

  /** Content to write */
  content: string;

  /** ISO 8601 staging timestamp */
  stagedAt: string;

  /** Original change reference */
  originalChange: FileChange | ArchivedChange | FileVersion;

  /** Staging notes */
  notes?: string;
}

export type StagingType = 'keep' | 'revert' | 'restore_archive' | 'restore_version';

/**
 * Result of applying a staged change
 */
export interface ApplyResult {
  /** Whether the apply succeeded */
  success: boolean;

  /** Applied change (if successful) */
  change?: StagedChange;

  /** Error message (if failed) */
  error?: string;
}
```

---

## Filter and Query Types

Types used for filtering, querying, and bulk operations.

### Session Filter

```typescript
/**
 * Filter options for session queries
 */
export interface SessionFilter {
  /** Filter by status */
  status?: SessionStatus | SessionStatus[];

  /** Filter by start time (sessions starting after this time) */
  startAfter?: string;

  /** Filter by start time (sessions starting before this time) */
  startBefore?: string;

  /** Filter sessions older than this timestamp */
  olderThan?: string;
}

/**
 * Options for session deletion
 */
export interface SessionDeleteOptions {
  /** Also delete associated logs */
  deleteAssociatedData?: boolean;
}

/**
 * Result of session deletion/clear operation
 */
export interface SessionDeleteResult {
  success: boolean;
  deletedSessions?: number;
  deletedLogs?: number;
  deletedFileChanges?: number;
  deletedAt?: string;
  clearedAt?: string;
}

/**
 * Statistics for a specific session
 */
export interface SessionStats {
  sessionId: string;
  status: SessionStatus;
  duration: number;
  logCount: number;
  toolExecutions: number;
  fileChangesCount: number;
  errors: number;
  warnings: number;
  blocked: number;
}
```

### File Change Filter

```typescript
/**
 * Filter options for file change queries
 */
export interface FileChangeFilter {
  /** Filter by session */
  sessionId?: string;

  /** Filter by status */
  status?: FileChangeStatus | FileChangeStatus[];

  /** Filter by file path (exact match) */
  filePath?: string;

  /** Filter by file path pattern (glob) */
  filePattern?: string;

  /** Filter by change type */
  changeType?: FileChangeType | FileChangeType[];

  /** Filter by tool name */
  tool?: string;

  /** Filter changes older than this timestamp */
  olderThan?: string;
}

export type FileChangeStatus = 'pending' | 'kept' | 'reverted';
export type FileChangeType = 'create' | 'modify' | 'delete';

/**
 * Result of file change deletion/clear operation
 */
export interface FileChangeDeleteResult {
  success: boolean;
  deleted?: number;
  deletedAt?: string;
  clearedAt?: string;
}
```

### History Filter

```typescript
/**
 * Filter options for history queries
 */
export interface HistoryFilter {
  /** Filter versions older than this timestamp */
  olderThan?: string;

  /** Keep at most this many versions per file */
  maxVersionsPerFile?: number;
}

/**
 * Result of history deletion/clear operation
 */
export interface HistoryDeleteResult {
  success: boolean;
  deletedVersions?: number;
  deletedFiles?: number;
  remainingVersions?: number;
  deletedAt?: string;
  clearedAt?: string;
}

/**
 * Statistics for version history
 */
export interface HistoryStats {
  trackedFiles: number;
  totalVersions: number;
  totalSize: number;
  oldestVersion: string;
  newestVersion: string;
}
```

### Archive Filter

```typescript
/**
 * Filter options for archive queries
 */
export interface ArchiveFilter {
  /** Filter by session */
  sessionId?: string;

  /** Filter by file path */
  filePath?: string;

  /** Filter archives older than this timestamp */
  olderThan?: string;
}

/**
 * Result of archive deletion/clear operation
 */
export interface ArchiveDeleteResult {
  success: boolean;
  deleted?: number;
  deletedAt?: string;
  clearedAt?: string;
}

/**
 * Statistics for archive
 */
export interface ArchiveStats {
  totalArchived: number;
  totalSessions: number;
  totalFiles: number;
  totalSize: number;
  oldestArchive: string;
  newestArchive: string;
}
```

### Log Filter

```typescript
/**
 * Filter options for log queries
 */
export interface LogFilter {
  /** Filter by session */
  sessionId?: string;

  /** Filter by hook name */
  hook?: string;

  /** Filter by event type */
  event?: string;

  /** Filter by log level */
  level?: LogLevel | LogLevel[];

  /** Filter by tool name */
  tool?: string;

  /** Filter by file path */
  file?: string;

  /** Text search in message */
  search?: string;

  /** Filter logs after this timestamp */
  startTime?: string;

  /** Filter logs before this timestamp */
  endTime?: string;

  /** Filter logs older than this timestamp */
  olderThan?: string;
}

/**
 * Result of log clear operation
 */
export interface LogClearResult {
  success: boolean;
  cleared: number;
  clearedAt: string;
}
```

### Pagination and Sorting

```typescript
/**
 * Pagination options
 */
export interface PaginationOptions {
  offset?: number;
  limit?: number;
}

/**
 * Sort options
 */
export interface SortOptions {
  field: string;
  order: 'asc' | 'desc';
}

/**
 * Generic paginated result
 */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}
```

---

## Hook Models

Models for Claude Code hook management and configuration.

### HookEvent

All supported Claude Code hook event types.

```typescript
/**
 * All Claude Code hook event types
 */
export type HookEvent =
  | 'PreToolUse'        // Before any tool execution
  | 'PostToolUse'       // After any tool execution
  | 'SessionStart'      // When a session begins
  | 'SessionEnd'        // When a session ends (normal completion)
  | 'UserPromptSubmit'  // When user submits a prompt
  | 'PermissionRequest' // When Claude requests a permission
  | 'Notification'      // When Claude sends a notification
  | 'Stop'              // When session stops (user abort, error, etc.)
  | 'SubagentStop'      // When a subagent completes
  | 'PreCompact'        // Before context compaction

/**
 * Human-readable descriptions for each hook event
 */
export const HOOK_EVENT_DESCRIPTIONS: Record<HookEvent, string> = {
  PreToolUse: 'Runs before any tool execution - can block or modify tool calls',
  PostToolUse: 'Runs after any tool execution - for logging, validation, formatting',
  SessionStart: 'Runs when a new Claude Code session begins',
  SessionEnd: 'Runs when a session ends normally',
  UserPromptSubmit: 'Runs when the user submits a prompt - can inject context',
  PermissionRequest: 'Runs when Claude requests a permission - can auto-approve/deny',
  Notification: 'Runs when Claude sends a notification message',
  Stop: 'Runs when session stops (abort, error, completion)',
  SubagentStop: 'Runs when a subagent (Task tool) completes',
  PreCompact: 'Runs before context compaction - can preserve important context'
};
```

### HookMatcher

Pattern matching configuration for hooks.

```typescript
/**
 * Matcher for filtering when a hook should run
 */
export interface HookMatcher {
  /** Tool name to match (for PreToolUse/PostToolUse) */
  tool_name?: string;

  /** File pattern to match (glob) */
  file_pattern?: string;

  /** Working directory pattern (glob) */
  working_directory?: string;

  /** Session ID pattern (regex) */
  session_id?: string;

  /** Custom matcher function (serialized) */
  custom?: string;
}
```

### HookDefinition

Definition of a single hook command.

```typescript
/**
 * A single hook command definition
 */
export interface HookDefinition {
  /** Unique identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Description of what the hook does */
  description?: string;

  /** Hook event type */
  event: HookEvent;

  /** Command to execute */
  command: string;

  /** Whether hook is enabled */
  enabled: boolean;

  /** Execution timeout in milliseconds (default: 60000) */
  timeout?: number;

  /** Matchers for filtering when hook should run */
  matchers?: HookMatcher[];

  /** Hook category for organization */
  category: HookCategory;

  /** Hook priority (higher = runs first) */
  priority?: number;

  /** Whether this is a built-in Inspector Hook hook */
  builtIn?: boolean;

  /** ISO 8601 creation timestamp */
  createdAt: string;

  /** ISO 8601 last modified timestamp */
  updatedAt: string;
}

/**
 * Hook category for organization
 */
export type HookCategory =
  | 'logging'       // Hooks that log/track activity
  | 'security'      // Security gates and validators
  | 'quality'       // Code quality (formatters, linters)
  | 'notification'  // User notifications
  | 'advanced'      // Advanced automation
  | 'custom';       // User-created hooks
```

### InstalledHook

A hook that has been installed to Claude Code settings.

```typescript
/**
 * A hook installed in Claude Code settings.json
 */
export interface InstalledHook extends HookDefinition {
  /** Installation status */
  installStatus: InstallStatus;

  /** Path to the hook script file */
  scriptPath: string;

  /** Last execution timestamp (if tracked) */
  lastExecuted?: string;

  /** Execution count (if tracked) */
  executionCount?: number;

  /** Last error (if any) */
  lastError?: string;
}

export type InstallStatus = 'installed' | 'pending' | 'error' | 'disabled';
```

### HookInput

Input provided to hooks by Claude Code.

```typescript
/**
 * Base input provided to all hooks
 */
export interface HookInputBase {
  /** Session identifier */
  session_id: string;

  /** Transcript path for context */
  transcript_path?: string;

  /** Working directory */
  cwd?: string;
}

/**
 * Input for PreToolUse and PostToolUse hooks
 */
export interface ToolHookInput extends HookInputBase {
  /** Tool name being executed */
  tool_name: string;

  /** Tool input parameters */
  tool_input: Record<string, unknown>;

  /** Tool result (PostToolUse only) */
  tool_result?: unknown;
}

/**
 * Input for UserPromptSubmit hooks
 */
export interface UserPromptInput extends HookInputBase {
  /** User's prompt text */
  prompt: string;

  /** Conversation context */
  context?: string;
}

/**
 * Input for PermissionRequest hooks
 */
export interface PermissionRequestInput extends HookInputBase {
  /** Type of permission requested */
  permission_type: string;

  /** Resource being accessed */
  resource?: string;

  /** Details about the permission */
  details?: Record<string, unknown>;
}

/**
 * Input for Notification hooks
 */
export interface NotificationInput extends HookInputBase {
  /** Notification message */
  message: string;

  /** Notification level */
  level?: 'info' | 'warning' | 'error';
}

/**
 * Input for Stop hooks
 */
export interface StopInput extends HookInputBase {
  /** Stop reason */
  reason: 'user_abort' | 'error' | 'complete' | 'timeout';

  /** Error message if applicable */
  error?: string;
}

/**
 * Input for SubagentStop hooks
 */
export interface SubagentStopInput extends HookInputBase {
  /** Subagent type */
  subagent_type: string;

  /** Subagent result */
  result?: unknown;

  /** Whether subagent succeeded */
  success: boolean;
}

/**
 * Input for PreCompact hooks
 */
export interface PreCompactInput extends HookInputBase {
  /** Current context size */
  context_size: number;

  /** Items to be compacted */
  items_to_compact: number;
}

/**
 * Union of all hook input types
 */
export type HookInput =
  | ToolHookInput
  | UserPromptInput
  | PermissionRequestInput
  | NotificationInput
  | StopInput
  | SubagentStopInput
  | PreCompactInput;
```

### HookOutput

Output that hooks can return to Claude Code.

```typescript
/**
 * Hook output for controlling Claude Code behavior
 */
export interface HookOutput {
  /**
   * Exit behavior:
   * - exit 0: Success, continue normally
   * - exit 2: Block the operation
   * - stdout JSON: Modify behavior based on content
   */
  exitCode: 0 | 2;

  /**
   * Optional JSON output for behavior modification
   */
  output?: HookOutputPayload;
}

/**
 * JSON payload that hooks can output
 */
export interface HookOutputPayload {
  /** Block reason (if blocking) */
  reason?: string;

  /** Approval decision (for PermissionRequest) */
  decision?: 'approve' | 'deny' | 'ask';

  /** Content to inject (for UserPromptSubmit) */
  content?: string;

  /** Modified tool input (for PreToolUse) */
  tool_input?: Record<string, unknown>;

  /** Whether to suppress default behavior */
  suppress?: boolean;

  /** Custom data for logging */
  metadata?: Record<string, unknown>;
}
```

### HookConfig

Full hook configuration structure (mirrors Claude settings.json).

```typescript
/**
 * Claude Code hooks configuration (settings.json structure)
 */
export interface HookConfig {
  hooks: {
    [K in HookEvent]?: HookEntry[];
  };
}

/**
 * A single hook entry in Claude settings.json
 */
export interface HookEntry {
  /** Matchers for filtering (optional) */
  matcher?: HookMatcher[];

  /** Commands to run (array for chaining) */
  hooks: HookCommand[];
}

/**
 * A single hook command in the chain
 */
export interface HookCommand {
  /** Command type */
  type: 'command';

  /** Command to execute (path to script or inline) */
  command: string;

  /** Timeout in milliseconds */
  timeout?: number;
}
```

### Hook Management Results

Result types for hook management operations.

```typescript
/**
 * Result of validating a hook
 */
export interface HookValidationResult {
  /** Whether validation passed */
  valid: boolean;

  /** Validation errors */
  errors: ValidationError[];

  /** Validation warnings */
  warnings: ValidationWarning[];

  /** Validated hook (if valid) */
  hook?: HookDefinition;
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  field: string;
  message: string;
  suggestion?: string;
}

/**
 * Result of testing a hook
 */
export interface HookTestResult {
  /** Whether test passed */
  success: boolean;

  /** Exit code from hook */
  exitCode: number;

  /** Standard output */
  stdout: string;

  /** Standard error */
  stderr: string;

  /** Execution time in milliseconds */
  executionTime: number;

  /** Parsed output (if JSON) */
  parsedOutput?: HookOutputPayload;

  /** Error message if failed */
  error?: string;
}

/**
 * Result of installing hooks
 */
export interface HookInstallResult {
  /** Whether installation succeeded */
  success: boolean;

  /** Hooks that were installed */
  installed: string[];

  /** Hooks that were updated */
  updated: string[];

  /** Hooks that were skipped */
  skipped: string[];

  /** Hooks that failed */
  failed: HookInstallError[];

  /** Backup path (if backup was created) */
  backupPath?: string;
}

export interface HookInstallError {
  hookId: string;
  hookName: string;
  error: string;
}

/**
 * Result of repairing hook installation
 */
export interface HookRepairResult {
  /** Whether repair succeeded */
  success: boolean;

  /** Issues found */
  issuesFound: RepairIssue[];

  /** Issues fixed */
  issuesFixed: RepairIssue[];

  /** Issues that couldn't be fixed */
  issuesRemaining: RepairIssue[];
}

export interface RepairIssue {
  type: 'missing_script' | 'missing_entry' | 'corrupted' | 'permission' | 'orphaned';
  hookId?: string;
  path?: string;
  message: string;
}
```

### Hook Script Templates

Templates for generating hook scripts.

```typescript
/**
 * Template for generating a hook script
 */
export interface HookScriptTemplate {
  /** Template name */
  name: string;

  /** Template description */
  description: string;

  /** Script language */
  language: 'bash' | 'python' | 'node';

  /** File extension */
  extension: string;

  /** Template content with placeholders */
  template: string;

  /** Available placeholders */
  placeholders: TemplatePlaceholder[];
}

export interface TemplatePlaceholder {
  /** Placeholder name (e.g., {{HOOK_NAME}}) */
  name: string;

  /** Description */
  description: string;

  /** Default value */
  defaultValue?: string;

  /** Whether required */
  required: boolean;
}
```

---

## Database Schema

For persistence, data is stored in JSON/JSONL files:

### Directory Structure

```
~/.inspector-hook/
├── sessions/
│   ├── {session-id}.json          # Session data
│   └── ...
├── logs/
│   ├── logs-{date}.jsonl          # Daily log files
│   └── ...
├── versions/
│   ├── {file-path-hash}/
│   │   ├── history.json           # Version history index
│   │   └── v{n}.snapshot          # Version snapshots
│   └── ...
├── archives/
│   ├── {archive-id}.json          # Archived changes
│   └── ...
├── rules/
│   └── rules.json                 # Rule definitions
├── hooks/
│   ├── installed-hooks.json       # Registry of installed hooks
│   ├── scripts/                   # Hook script files
│   │   ├── logging/
│   │   │   ├── pre-tool-logger.sh
│   │   │   ├── post-tool-logger.sh
│   │   │   └── ...
│   │   ├── security/
│   │   │   └── security-gate.py
│   │   ├── quality/
│   │   │   ├── biome-format.sh
│   │   │   └── ...
│   │   └── custom/
│   │       └── ...
│   ├── lib/                       # Shared hook libraries
│   │   ├── inspector-hook.sh      # Bash library
│   │   └── inspector_hook.py      # Python library
│   └── backups/                   # Backup of Claude settings before install
│       └── settings-{timestamp}.json
└── config/
    └── settings.json              # User settings
```

### Claude Code Integration

Inspector Hook integrates with Claude Code by modifying `~/.claude/settings.json`:

```
~/.claude/
├── settings.json                  # Claude Code settings (hooks configured here)
├── hooks/                         # Symlink to ~/.inspector-hook/hooks/scripts/
└── logs/
    └── ...
```

### JSON File Schemas

**sessions/{id}.json**
```json
{
  "id": "abc-123",
  "status": "completed",
  "startTime": "2026-01-15T10:00:00.000Z",
  "endTime": "2026-01-15T10:30:00.000Z",
  "toolExecutions": [...],
  "fileChanges": ["change-1", "change-2"],
  "metadata": {}
}
```

**logs/logs-2026-01-15.jsonl**
```jsonl
{"id":"log-1","timestamp":"2026-01-15T10:00:00.000Z","hook":"PreToolUse",...}
{"id":"log-2","timestamp":"2026-01-15T10:00:01.000Z","hook":"PostToolUse",...}
```

**versions/{hash}/history.json**
```json
{
  "filePath": "/path/to/file.ts",
  "versions": [
    {"id": "v1", "versionNumber": 1, "timestamp": "...", "hash": "..."},
    {"id": "v2", "versionNumber": 2, "timestamp": "...", "hash": "..."}
  ],
  "versionCount": 2,
  "firstTracked": "2026-01-15T10:00:00.000Z",
  "lastModified": "2026-01-15T10:30:00.000Z"
}
```

**hooks/installed-hooks.json**
```json
{
  "version": "1.0.0",
  "installedAt": "2026-01-15T10:00:00.000Z",
  "lastUpdated": "2026-01-16T14:30:00.000Z",
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
    },
    {
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
      "createdAt": "2026-01-15T10:00:00.000Z",
      "updatedAt": "2026-01-15T10:00:00.000Z"
    }
  ],
  "backupPath": "~/.inspector-hook/hooks/backups/settings-2026-01-15T10-00-00.json"
}
```

**Claude ~/.claude/settings.json (hooks section)**
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": [{"tool_name": "Bash"}],
        "hooks": [
          {
            "type": "command",
            "command": "~/.inspector-hook/hooks/scripts/security/security-gate.py",
            "timeout": 10000
          }
        ]
      },
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.inspector-hook/hooks/scripts/logging/pre-tool-logger.sh",
            "timeout": 5000
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.inspector-hook/hooks/scripts/logging/post-tool-logger.sh",
            "timeout": 5000
          }
        ]
      }
    ],
    "SessionStart": [...],
    "SessionEnd": [...],
    "UserPromptSubmit": [...],
    "PermissionRequest": [...],
    "Notification": [...],
    "Stop": [...],
    "SubagentStop": [...],
    "PreCompact": [...]
  }
}
```

---

## Type Exports

All types are exported from the protocol package:

```typescript
// packages/protocol/src/index.ts

// Core
export * from './log-entry';
export * from './stats';

// Sessions
export * from './session';
export * from './tool-execution';

// File Changes
export * from './file-change';
export * from './file-snapshot';
export * from './diff';

// Version History
export * from './version-history';
export * from './file-version';

// Archive
export * from './archived-change';

// Rules
export * from './rule';
export * from './rule-condition';
export * from './rule-action';

// Analytics
export * from './analytics';

// Staging
export * from './staged-change';
export * from './apply-result';

// Filters and Query Types
export * from './filters/session-filter';
export * from './filters/file-change-filter';
export * from './filters/history-filter';
export * from './filters/archive-filter';
export * from './filters/log-filter';
export * from './pagination';

// Hooks
export * from './hook-event';
export * from './hook-definition';
export * from './hook-matcher';
export * from './hook-input';
export * from './hook-output';
export * from './hook-config';
export * from './hook-results';
export * from './hook-templates';

// IPC
export * from './ipc-message';
export * from './ipc-response';
export * from './ipc-event';
```

---

## Validation

All models should be validated using Zod schemas:

```typescript
// packages/protocol/src/validation/log-entry.ts
import { z } from 'zod';

export const LogEntrySchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime(),
  hook: z.string().min(1).max(100),
  event: z.string().max(100),
  level: z.enum(['info', 'warn', 'error', 'blocked']),
  message: z.string().max(10000),
  sessionId: z.string().uuid().optional(),
  tool: z.string().max(100).optional(),
  file: z.string().max(1000).optional(),
  details: z.record(z.unknown()).optional()
});

export type LogEntry = z.infer<typeof LogEntrySchema>;
```
