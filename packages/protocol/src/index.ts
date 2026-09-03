/**
 * @inspector-hook/protocol
 * Shared protocol definitions for Inspector Hook
 */

// =============================================================================
// Core Data Models
// =============================================================================

/**
 * Log level types
 */
export type LogLevel = "info" | "warn" | "error" | "blocked";

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
	/** Execution ID for correlating PreToolUse/PostToolUse events */
	executionId?: string;
	/** Additional structured data */
	details?: Record<string, unknown>;
}

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

// =============================================================================
// Session Models
// =============================================================================

export type SessionStatus =
	| "active"
	| "idle"
	| "completed"
	| "error"
	| "terminated";

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

/**
 * An AI agent session (e.g., a Claude Code conversation)
 */
export interface Session {
	/** Unique session identifier */
	id: string;
	/** Human-readable session name (derived from project or directory) */
	name?: string;
	/** Session status */
	status: SessionStatus;
	/** ISO 8601 start time */
	startTime: string;
	/** ISO 8601 end time (if completed) */
	endTime?: string;
	/** ISO 8601 timestamp of last activity (for idle detection) */
	lastActivityTime?: string;
	/** Tool executions within this session */
	toolExecutions: ToolExecution[];
	/** File changes made during this session */
	fileChanges: string[]; // Change IDs
	/** Session metadata */
	metadata?: SessionMetadata;
}

export type ExecutionStatus = "running" | "completed" | "failed" | "blocked";

// =============================================================================
// Activity Types (for Session Activity Feed)
// =============================================================================

/**
 * Activity type enumeration
 */
export type ActivityType =
	| "user_prompt"
	| "ai_response"
	| "tool_call"
	| "session_start"
	| "notification"
	| "subagent_complete"
	| "message";

/**
 * Stop reason for AI responses
 */
export type StopReason = "complete" | "user_abort" | "error" | "timeout";

/**
 * Base activity item structure
 */
export interface ActivityItemBase {
	id: string;
	type: ActivityType;
	timestamp: string;
}

/**
 * User prompt activity data
 */
export interface UserPromptActivityData {
	prompt: string;
}

/**
 * AI response activity data
 */
export interface AiResponseActivityData {
	message: string;
	stopReason?: StopReason;
}

/**
 * Tool call activity data
 */
export interface ToolCallActivityData {
	tool: string;
	executionId?: string;
	input?: Record<string, unknown>;
	result?: unknown;
	file?: string;
	status: "running" | "completed" | "failed" | "blocked";
	startTime: string;
	endTime?: string;
}

/**
 * Session start activity data
 */
export interface SessionStartActivityData {
	event: "start";
	projectName?: string;
	gitBranch?: string;
	workingDirectory?: string;
}

/**
 * Notification activity data
 */
export interface NotificationActivityData {
	message: string;
	notificationType?: string;
}

/**
 * Subagent complete activity data
 */
export interface SubagentCompleteActivityData {
	subagentType?: string;
	success: boolean;
	result?: unknown;
	message?: string;
}

/**
 * Generic message activity data
 */
export interface MessageActivityData {
	hook?: string;
	event?: string;
	level?: LogLevel;
	message: string;
	details?: Record<string, unknown>;
}

/**
 * Activity item with typed data
 */
export interface ActivityItem<T = unknown> extends ActivityItemBase {
	data: T;
}

/**
 * Session activity response from API
 */
export interface SessionActivityResponse {
	sessionId: string;
	session: Session | null;
	activity: ActivityItem[];
	totalItems: number;
}

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

// =============================================================================
// File Change Models
// =============================================================================

export type ChangeStatus = "pending" | "kept" | "reverted" | "staged";

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

export type HunkStatus = "pending" | "kept" | "reverted";

export interface DiffLine {
	/** Line change type */
	type: "added" | "removed" | "context" | "moved-from" | "moved-to";
	/** Line content (without +/- prefix) */
	content: string;
	/** Line number in respective file */
	lineNumber: number;
	/** Line number in original file (for context and removed lines) */
	oldLineNumber?: number;
	/** Line number in modified file (for context and added lines) */
	newLineNumber?: number;
	/** Move ID linking moved-from to moved-to blocks */
	moveId?: string;
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

// =============================================================================
// Version History Models
// =============================================================================

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

/**
 * Version history for a single file
 */
export interface VersionHistory {
	/** Absolute file path */
	filePath: string;
	/** All versions, oldest first */
	versions: FileVersion[];
	/** How many versions are currently retained (matches versions.length) */
	versionCount: number;
	/**
	 * Highest version number ever assigned for this file. Monotonic: it keeps
	 * climbing as versions are trimmed or deleted, so version numbers are never
	 * reused. Optional because histories written before this field existed fall
	 * back to versionCount.
	 */
	lastVersionNumber?: number;
	/** First tracked timestamp */
	firstTracked: string;
	/** Last modified timestamp */
	lastModified: string;
}

// =============================================================================
// Archive Models
// =============================================================================

/**
 * How a pending change was resolved before being archived
 */
export type ArchiveResolution = "kept" | "reverted";

/**
 * An archived (resolved) file change — either kept or reverted
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
	/** Content after the change (as the AI wrote it) */
	afterContent: string;
	/**
	 * Whether the change was kept or reverted. Optional so archives written
	 * before this field existed still load; treat a missing value as "kept",
	 * since only kept changes were archived at all back then.
	 */
	resolution?: ArchiveResolution;
	/** Optional archive notes */
	notes?: string;
	/** Tags for organization */
	tags?: string[];
}

// =============================================================================
// Rules Models
// =============================================================================

export type ConditionType =
	| "event_type" // Match event type
	| "tool_name" // Match tool name
	| "level" // Match log level
	| "file_pattern" // Match file path pattern
	| "message_pattern" // Match message content
	| "and" // All conditions must match
	| "or" // Any condition must match
	| "not"; // Negate condition

export type ComparisonOperator =
	| "equals"
	| "not_equals"
	| "contains"
	| "not_contains"
	| "matches" // Regex match
	| "starts_with"
	| "ends_with";

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

export type ActionType =
	| "notify" // Show notification
	| "block" // Block the operation
	| "log" // Log to special category
	| "auto_keep" // Automatically keep file change
	| "auto_revert" // Automatically revert file change
	| "webhook" // Call external webhook
	| "tag"; // Add tag to log/change

export interface ActionParams {
	/** Notification/block message */
	message?: string;
	/** Notification level */
	notificationLevel?: "info" | "warning" | "error";
	/** Webhook URL */
	webhookUrl?: string;
	/** Tags to add */
	tags?: string[];
	/** Custom parameters */
	[key: string]: unknown;
}

/**
 * Action to execute when rule matches
 */
export interface RuleAction {
	/** Action type */
	type: ActionType;
	/** Action parameters */
	params?: ActionParams;
}

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

// =============================================================================
// Analytics Models
// =============================================================================

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

// =============================================================================
// Staging Models
// =============================================================================

export type StagingType =
	| "keep"
	| "revert"
	| "restore_archive"
	| "restore_version";

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

// =============================================================================
// Filter and Query Types
// =============================================================================

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

export type FileChangeStatus = "pending" | "kept" | "reverted";
export type FileChangeType = "create" | "modify" | "delete";

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

/**
 * Result of file change deletion/clear operation
 */
export interface FileChangeDeleteResult {
	success: boolean;
	deleted?: number;
	deletedAt?: string;
	clearedAt?: string;
}

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
	/** Filter by how the change was resolved (kept vs reverted) */
	resolution?: ArchiveResolution;
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
	order: "asc" | "desc";
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

// =============================================================================
// Hook Models
// =============================================================================

/**
 * All Claude Code hook event types
 */
export type HookEvent =
	| "PreToolUse" // Before any tool execution
	| "PostToolUse" // After any tool execution
	| "SessionStart" // When a session begins
	| "SessionEnd" // When a session ends (normal completion)
	| "UserPromptSubmit" // When user submits a prompt
	| "PermissionRequest" // When Claude requests a permission
	| "Notification" // When Claude sends a notification
	| "Stop" // When session stops (user abort, error, etc.)
	| "SubagentStop" // When a subagent completes
	| "PreCompact"; // Before context compaction

/**
 * Human-readable descriptions for each hook event
 */
export const HOOK_EVENT_DESCRIPTIONS: Record<HookEvent, string> = {
	PreToolUse: "Runs before any tool execution - can block or modify tool calls",
	PostToolUse:
		"Runs after any tool execution - for logging, validation, formatting",
	SessionStart: "Runs when a new Claude Code session begins",
	SessionEnd: "Runs when a session ends normally",
	UserPromptSubmit: "Runs when the user submits a prompt - can inject context",
	PermissionRequest:
		"Runs when Claude requests a permission - can auto-approve/deny",
	Notification: "Runs when Claude sends a notification message",
	Stop: "Runs when session stops (abort, error, completion)",
	SubagentStop: "Runs when a subagent (Task tool) completes",
	PreCompact: "Runs before context compaction - can preserve important context",
};

/**
 * Hook category for organization
 */
export type HookCategory =
	| "logging" // Hooks that log/track activity
	| "security" // Security gates and validators
	| "quality" // Code quality (formatters, linters)
	| "notification" // User notifications
	| "advanced" // Advanced automation
	| "custom"; // User-created hooks

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

export type InstallStatus = "installed" | "pending" | "error" | "disabled";

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

// =============================================================================
// Hook Input/Output Types
// =============================================================================

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
	level?: "info" | "warning" | "error";
}

/**
 * Input for Stop hooks
 */
export interface StopInput extends HookInputBase {
	/** Stop reason */
	reason: "user_abort" | "error" | "complete" | "timeout";
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

/**
 * JSON payload that hooks can output
 */
export interface HookOutputPayload {
	/** Block reason (if blocking) */
	reason?: string;
	/** Approval decision (for PermissionRequest) */
	decision?: "approve" | "deny" | "ask";
	/** Content to inject (for UserPromptSubmit) */
	content?: string;
	/** Modified tool input (for PreToolUse) */
	tool_input?: Record<string, unknown>;
	/** Whether to suppress default behavior */
	suppress?: boolean;
	/** Custom data for logging */
	metadata?: Record<string, unknown>;
}

/**
 * Hook output for controlling Claude Code behavior
 */
export interface HookOutput {
	exitCode: 0 | 2;
	output?: HookOutputPayload;
}

// =============================================================================
// Hook Configuration Types
// =============================================================================

/**
 * A single hook command in the chain
 */
export interface HookCommand {
	/** Command type */
	type: "command";
	/** Command to execute (path to script or inline) */
	command: string;
	/** Timeout in milliseconds */
	timeout?: number;
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
 * Claude Code hooks configuration (settings.json structure)
 */
export interface HookConfig {
	hooks: {
		[K in HookEvent]?: HookEntry[];
	};
}

// =============================================================================
// Hook Management Result Types
// =============================================================================

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
 * Result of validating a hook
 */
export interface HookValidationResult {
	valid: boolean;
	errors: ValidationError[];
	warnings: ValidationWarning[];
	hook?: HookDefinition;
}

/**
 * Result of testing a hook
 */
export interface HookTestResult {
	success: boolean;
	exitCode: number;
	stdout: string;
	stderr: string;
	executionTime: number;
	parsedOutput?: HookOutputPayload;
	error?: string;
}

export interface HookInstallError {
	hookId: string;
	hookName: string;
	error: string;
}

/**
 * Result of installing hooks
 */
export interface HookInstallResult {
	success: boolean;
	installed: string[];
	updated: string[];
	skipped: string[];
	failed: HookInstallError[];
	backupPath?: string;
}

export interface RepairIssue {
	type:
		| "missing_script"
		| "missing_entry"
		| "corrupted"
		| "permission"
		| "orphaned";
	hookId?: string;
	path?: string;
	message: string;
}

/**
 * Result of repairing hook installation
 */
export interface HookRepairResult {
	success: boolean;
	issuesFound: RepairIssue[];
	issuesFixed: RepairIssue[];
	issuesRemaining: RepairIssue[];
}

export interface TemplatePlaceholder {
	name: string;
	description: string;
	defaultValue?: string;
	required: boolean;
}

/**
 * Template for generating a hook script
 */
export interface HookScriptTemplate {
	name: string;
	description: string;
	language: "bash" | "python" | "node";
	extension: string;
	template: string;
	placeholders: TemplatePlaceholder[];
}

// =============================================================================
// IPC Message Types (JSON-RPC 2.0)
// =============================================================================

/**
 * JSON-RPC 2.0 Request
 */
export interface JsonRpcRequest {
	jsonrpc: "2.0";
	id: string | number;
	method: string;
	params?: unknown;
}

/**
 * JSON-RPC 2.0 Success Response
 */
export interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: string | number;
	result: unknown;
}

/**
 * JSON-RPC 2.0 Error
 */
export interface JsonRpcErrorDetail {
	code: number;
	message: string;
	data?: unknown;
}

/**
 * JSON-RPC 2.0 Error Response
 */
export interface JsonRpcError {
	jsonrpc: "2.0";
	id: string | number;
	error: JsonRpcErrorDetail;
}

/**
 * JSON-RPC 2.0 Notification (no response expected)
 */
export interface JsonRpcNotification {
	jsonrpc: "2.0";
	method: string;
	params?: unknown;
}

// =============================================================================
// WebSocket Event Types
// =============================================================================

/**
 * WebSocket event format
 */
export interface WebSocketEvent<T = unknown> {
	type: string;
	payload: T;
	timestamp: string;
}

// =============================================================================
// Webview Message Types
// =============================================================================

/**
 * Message from wrapper to webview
 */
export interface WebviewMessage<T = unknown> {
	type: string;
	payload?: T;
}

/**
 * Command from webview to wrapper
 */
export interface WebviewCommand<T = unknown> {
	command: string;
	params?: T;
}

// =============================================================================
// Error Codes
// =============================================================================

export const ErrorCodes = {
	// JSON-RPC standard errors
	PARSE_ERROR: -32700,
	INVALID_REQUEST: -32600,
	METHOD_NOT_FOUND: -32601,
	INVALID_PARAMS: -32602,
	INTERNAL_ERROR: -32603,
	SERVER_ERROR: -32000,

	// Application errors
	NOT_FOUND: 1000,
	ALREADY_EXISTS: 1001,
	VALIDATION_ERROR: 1002,
	FILE_ERROR: 1003,
	PERMISSION_DENIED: 1004,
	SESSION_NOT_ACTIVE: 1005,
	CONFLICT: 1006,
	RATE_LIMITED: 1007,

	// Hook errors
	HOOK_NOT_FOUND: 1100,
	HOOK_VALIDATION_ERROR: 1101,
	HOOK_EXECUTION_ERROR: 1102,
	HOOK_TIMEOUT: 1103,
	HOOK_INSTALL_ERROR: 1104,
	HOOK_SCRIPT_ERROR: 1105,
	HOOK_BUILTIN_READONLY: 1106,
	CLAUDE_SETTINGS_ERROR: 1107,
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// =============================================================================
// Core Configuration
// =============================================================================

/**
 * Core process configuration
 */
export interface CoreConfig {
	/** HTTP server port */
	httpPort: number;
	/** WebSocket server port */
	wsPort: number;
	/** Log retention in days */
	logRetentionDays: number;
	/** Maximum logs to keep in memory */
	maxLogsInMemory: number;
}

/**
 * Core initialization parameters
 */
export interface CoreInitParams {
	workspaceRoot: string;
	storagePath: string;
	config: CoreConfig;
}

/**
 * Core status response
 */
export interface CoreStatus {
	status: "running" | "starting" | "stopping" | "error";
	uptime: number;
	httpPort: number;
	wsPort: number;
	stats: Stats;
	version: string;
}
