/**
 * Rules, analytics and staging.
 *
 * Split out of the former single index.ts; index.ts re-exports every
 * name here, so imports from @inspector-hook/protocol are unchanged.
 */

import type { FileChange } from "./file-change.js";
import type { ArchivedChange, FileVersion } from "./history.js";

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
