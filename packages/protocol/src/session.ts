/**
 * Sessions, their metadata, and the tool executions inside them.
 *
 * Split out of the former single index.ts; index.ts re-exports every
 * name here, so imports from @inspector-hook/protocol are unchanged.
 */

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
	/**
	 * Absolute path to Claude Code's transcript for this session.
	 *
	 * Its parent directory is the project's entry under `~/.claude/projects/`,
	 * which is where native auto memory lives. That makes this the authoritative
	 * way to locate a session's memory directory: the slug in that path is lossy
	 * (both `/` and `_` become `-`, so two real paths can collide) so computing
	 * it from the working directory can silently target the wrong project.
	 */
	transcriptPath?: string;
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


/**
 * Everything a session list row or detail header needs, without the
 * toolExecutions array.
 *
 * The activity response used to carry the full Session so the client could keep
 * the sidebar live without a second request. But a long session's
 * toolExecutions array dominates the payload — 4.2 MB of a 7.6 MB response was
 * measured — and the client renders the activity feed from `activity` anyway,
 * never from that array. This carries the same information in a few hundred
 * bytes.
 */
export interface SessionSummary {
	id: string;
	name?: string;
	status: SessionStatus;
	startTime: string;
	endTime?: string;
	lastActivityTime?: string;
	/** Number of tool executions recorded, without the executions themselves. */
	toolExecutionCount: number;
	/** Number of file changes attributed to this session. */
	fileChangeCount: number;
	/** Tool executions that ended in failure. */
	errorCount: number;
	gitBranch?: string;
	projectName?: string;
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
