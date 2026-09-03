/**
 * Claude Code hook definitions, inputs, outputs and installation.
 *
 * Split out of the former single index.ts; index.ts re-exports every
 * name here, so imports from @inspector-hook/protocol are unchanged.
 */

import type { Session } from "./session.js";

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
