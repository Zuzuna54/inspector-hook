/**
 * Log entries and aggregate statistics.
 *
 * Split out of the former single index.ts; index.ts re-exports every
 * name here, so imports from @inspector-hook/protocol are unchanged.
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
	/**
	 * Groups every event belonging to one user turn. Claude Code supplies
	 * `prompt_id` on every hook event except SessionStart, which makes turn
	 * grouping exact rather than inferred from prompt boundaries.
	 */
	promptId?: string;
	/**
	 * The permission mode the session was in when this event fired
	 * (`default`, `acceptEdits`, `bypassPermissions`, `plan`).
	 *
	 * M2 lists this among the fields to persist. The hook has forwarded it from
	 * the start — it is present on 2087 of 3868 captured events — and until now
	 * it was declared nowhere and read by nothing. It matters because the same
	 * tool call means different things under different modes: an edit in
	 * `bypassPermissions` was never offered for approval, and a reader that
	 * cannot see the mode cannot tell that from an approved one.
	 */
	permissionMode?: string;
	/**
	 * The reasoning effort level in force when this event fired.
	 *
	 * Also forwarded from the start and read by nothing. Useful for explaining
	 * why one turn took far longer than another.
	 */
	effort?: string;
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
