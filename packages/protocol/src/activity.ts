/**
 * The session activity feed: one item per thing that happened.
 *
 * Split out of the former single index.ts; index.ts re-exports every
 * name here, so imports from @inspector-hook/protocol are unchanged.
 */

import type { LogLevel } from "./log.js";
import type { Session, SessionSummary } from "./session.js";

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
	/**
	 * Groups every item belonging to one user turn. Supplied by the CLI on every
	 * hook event except SessionStart, which fires before the first user input.
	 * Absent on items recorded before the field was captured; consumers must
	 * treat missing as "ungrouped" rather than inventing a grouping.
	 */
	promptId?: string;
	id: string;
	type: ActivityType;
	timestamp: string;
	/**
	 * When this item last CHANGED, as opposed to when it began.
	 *
	 * For most items it equals `timestamp`. It differs for a tool call, which is
	 * created by PreToolUse and later updated in place by PostToolUse — the item
	 * keeps its start timestamp while its status, result and duration arrive
	 * later.
	 *
	 * This is what makes incremental fetching correct. A client polling with
	 * `since` must merge by `id` and keep the version with the greater
	 * `updatedAt`; without it, a backfill page could overwrite a completed tool
	 * call with the "running" version it had when that page's window ended.
	 */
	updatedAt?: string;
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
	/**
	 * @deprecated No Claude Code event carries a stop reason. Failure reasons
	 * arrive on StopFailure and are surfaced through MessageActivityData's
	 * stopError instead. Retained so existing readers still compile.
	 */
	stopReason?: StopReason;
	/**
	 * Claude's actual reply text, from Stop's last_assistant_message. Without it
	 * this item can only show a placeholder. NEVER populated from StopFailure:
	 * that event reuses the same field for the API error string.
	 */
	assistantMessage?: string;
	/** True when the turn ended while a stop hook was already continuing it. */
	stopHookActive?: boolean;
	/**
	 * Count of background tasks still outstanding. Non-zero means the turn is
	 * paused waiting on work, not finished.
	 */
	backgroundTasks?: number;
}


/**
 * Tool call activity data
 */
export interface ToolCallActivityData {
	/**
	 * Permission mode in force for this call. Changes what the call means: an
	 * edit under `bypassPermissions` was never offered for approval.
	 */
	permissionMode?: string;
	/** Reasoning effort in force, which explains long turns. */
	effort?: string;
	tool: string;
	executionId?: string;
	input?: Record<string, unknown>;
	result?: unknown;
	file?: string;
	status: "running" | "completed" | "failed" | "blocked";
	startTime: string;
	endTime?: string;
	/**
	 * Measured duration reported by the hook. Prefer this over subtracting
	 * timestamps: hook timestamps were second-resolution until recently, so a
	 * derived duration is a multiple of 1000ms or 0.
	 */
	durationMs?: number;
	/** Error text when status is "failed". */
	error?: string;
	/** Subagent that issued this call; absent on the main session's own calls. */
	agentId?: string;
	/** Subagent type, e.g. a named agent. Basis for per-agent attribution. */
	agentType?: string;
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
	/**
	 * Set when this item represents a StopFailure - a turn that ended on an API
	 * error rather than completing. Values are the documented StopFailure error
	 * codes (rate_limit, overloaded, max_output_tokens, server_error, and
	 * others). Its presence is what distinguishes a failed turn from an
	 * ordinary hook message, so it must not render as something Claude said.
	 */
	stopError?: string;
	/** Human-readable detail accompanying stopError. */
	errorDetails?: string;
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
	/**
	 * @deprecated Use `sessionSummary`. Retained only while clients migrate;
	 * it is the single largest contributor to this response's size.
	 */
	session: Session | null;
	/** Slim session header — prefer this over `session`. */
	sessionSummary: SessionSummary | null;
	activity: ActivityItem[];
	totalItems: number;
	/** True when older logs exist beyond the fetched window. */
	truncated?: boolean;
	/**
	 * Pass back as `since` on the next poll to receive only what has changed.
	 *
	 * It is the newest `updatedAt` across every item in the assembled window —
	 * not only the returned ones — so it still advances when a filtered poll
	 * returns nothing, and a client cannot get stuck re-requesting the same
	 * window forever.
	 */
	nextSince?: string;
	/** Echo of the requested `since`, so a response is self-describing. */
	since?: string;
	/** True when items older than this page exist and can be fetched with `before`. */
	hasMore?: boolean;
	/**
	 * How many logs the core currently retains for this session. A FLOOR, not a
	 * lifetime total: LogManager serves reads from memory only, so entries
	 * evicted past maxLogsInMemory are not counted. Label it accordingly.
	 */
	availableLogs?: number;
}
