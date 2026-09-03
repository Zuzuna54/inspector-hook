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
	 * How many logs the core currently retains for this session. A FLOOR, not a
	 * lifetime total: LogManager serves reads from memory only, so entries
	 * evicted past maxLogsInMemory are not counted. Label it accordingly.
	 */
	availableLogs?: number;
}
