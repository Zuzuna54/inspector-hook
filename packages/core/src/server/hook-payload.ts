/**
 * Turning a native Claude Code hook payload into the core's own shape (M2).
 *
 * ## Why this exists
 *
 * Hooks can be `{"type": "http", "url": "…"}` — Claude Code POSTs the raw
 * event straight to a URL. That means the core's own HTTP server can BE the
 * hook handler, and the entire shell + jq + curl + port-file layer becomes
 * optional. M2's stated goal.
 *
 * Until now the reshaping lived in 150 lines of jq inside
 * `packages/hooks/claude/inspector-hook.sh`, which is the only thing that
 * knew how to turn `hook_event_name` into an event, derive a level, and build
 * a human-readable message. This is that logic, ported, so both transports
 * produce byte-identical records. A drift test pins them together.
 *
 * ## What the measurement said about making HTTP primary
 *
 * Open Risk 1 asked whether an HTTP hook stalls when nothing is listening —
 * the documented timeout is 600s, which would be far worse than the shell
 * hook's fail-fast. **Measured against a dead port on 2026-09-09: it does
 * not.** One `claude -p` turn with a `PreToolUse` HTTP hook pointed at a
 * closed port took 17.1s, against a 19.6s baseline with no hook at all and
 * 15.9s with a live listener — all inside normal model latency. Connection
 * refused is not the 600s response timeout. The hook was proven to fire by
 * pointing it at a listener that recorded the request.
 *
 * So that risk is retired. A DIFFERENT one takes its place and is why the
 * shell hook stays the registered default: **an HTTP hook URL is static and
 * the core's port is not.** The core tries 52376 and scans upward on
 * conflict, and the shell hook reads the resulting port file every time. A
 * registered URL cannot. HTTP is therefore offered, not imposed — see
 * `install.sh --http`.
 */

/** Fields the native payload may carry. All optional; hooks vary by event. */
export interface NativeHookPayload {
	hook_event_name?: string;
	session_id?: string;
	transcript_path?: string;
	cwd?: string;
	permission_mode?: string;
	effort?: { level?: string } | string;
	model?: string;
	prompt_id?: string;
	tool_use_id?: string;
	tool_name?: string;
	tool_input?: Record<string, unknown>;
	tool_response?: unknown;
	tool_error?: string;
	error?: string;
	error_details?: unknown;
	duration_ms?: number;
	agent_id?: string;
	agent_type?: string;
	prompt?: string;
	last_assistant_message?: string;
	stop_hook_active?: boolean;
	background_tasks?: unknown[];
	notification_type?: string;
	level?: string;
	message?: string;
	start_reason?: string;
	reason?: string;
	trigger?: string;
	change_type?: string;
	filename?: string;
	file_path?: string;
	load_reason?: string;
	source?: string;
	from_model?: string;
	to_model?: string;
	[key: string]: unknown;
}

/** Caps, matching the shell hook's `clip` exactly. */
const CLIP_MESSAGE = 100;
const CLIP_TEXT = 4000;
const CLIP_RESULT = 20_000;

/** Words that make a tool error a permission block rather than a failure. */
const BLOCKED = /block|denied|not allowed|permission/i;

function clip(value: unknown, max: number): string | null {
	if (typeof value !== "string" || value.length === 0) return null;
	return value.length > max ? `${value.slice(0, max)}…` : value;
}

function str(value: unknown): string {
	return typeof value === "string" ? value : "";
}

/**
 * An ISO timestamp with milliseconds.
 *
 * The shell hook goes to this trouble because two events inside the same
 * second are otherwise indistinguishable, and every sort in the read path is a
 * plain timestamp comparison — ordering would depend on sort stability rather
 * than on the data. `toISOString` already includes milliseconds, so here it is
 * free; the comment is kept so the reason survives.
 */
function nowIso(): string {
	return new Date().toISOString();
}

/**
 * `level`, derived rather than hardcoded.
 *
 * This was `"info"` in an earlier hook, so the Errors / Warnings / Blocked
 * counters could never populate from real traffic no matter what happened.
 */
export function levelFor(payload: NativeHookPayload): string {
	const hook = str(payload.hook_event_name);
	if (hook === "PostToolUseFailure" || hook === "StopFailure") return "error";
	if (hook === "PermissionDenied") return "blocked";

	const response = payload.tool_response;
	if (response && typeof response === "object" && !Array.isArray(response)) {
		const error = str((response as Record<string, unknown>).error);
		if (error) return BLOCKED.test(error) ? "blocked" : "error";
	}
	const toolError = str(payload.tool_error);
	if (toolError) return BLOCKED.test(toolError) ? "blocked" : "error";

	if (hook === "Notification") {
		const level = str(payload.level);
		if (level === "error") return "error";
		if (level.startsWith("warn")) return "warn";
	}
	return "info";
}

/** Event names the core keys on. Everything else passes through unchanged. */
const EVENT_BY_HOOK: Record<string, string> = {
	UserPromptSubmit: "user.prompt",
	Stop: "ai.response",
	StopFailure: "ai.error",
	SubagentStop: "subagent.stop",
	SubagentStart: "subagent.start",
	Notification: "notification",
	SessionStart: "session.start",
	SessionEnd: "session.end",
};

export function eventFor(hook: string): string {
	return EVENT_BY_HOOK[hook] ?? hook;
}

/** A human-readable one-liner per event and tool shape. */
export function messageFor(payload: NativeHookPayload): string {
	const hook = str(payload.hook_event_name) || "unknown";
	const tool = str(payload.tool_name);
	const input = (payload.tool_input ?? {}) as Record<string, unknown>;
	const error = str(payload.error);

	switch (hook) {
		case "UserPromptSubmit":
			return "User prompt submitted";
		case "Stop":
			return "Claude finished responding";
		case "StopFailure":
			return `Turn failed: ${error || "unknown"}`;
		case "SubagentStart":
			return `Subagent started: ${str(payload.agent_type) || "unknown"}`;
		case "SubagentStop":
			return `Subagent completed: ${str(payload.agent_type) || "unknown"}`;
		case "Notification":
			return str(payload.message) || "Notification";
		case "PermissionRequest":
			return `Permission requested: ${tool}`;
		case "PermissionDenied":
			return `Permission denied: ${tool}`;
		case "PreCompact":
		case "PostCompact":
			return `${hook}: ${str(payload.trigger)}`;
		case "SessionStart":
			return `Session started: ${str(payload.cwd).split("/").pop() ?? ""}`;
		case "SessionEnd":
			return `Session ended: ${str(payload.reason)}`;
		case "FileChanged":
			return `File ${str(payload.change_type) || "changed"}: ${str(payload.filename)}`;
		case "CwdChanged":
			return `Directory changed: ${str(payload.cwd)}`;
		case "PreModelSwitch":
		case "PostModelSwitch":
			return `Model: ${str(payload.from_model) || "?"} -> ${str(payload.to_model) || "?"}`;
		case "TaskCreated":
		case "TaskCompleted":
			return hook;
		case "InstructionsLoaded":
			return `Instructions loaded: ${str(payload.file_path)}`;
		case "ConfigChange":
			return `Config changed: ${str(payload.source)}`;
		default:
			break;
	}

	if (!tool) return hook;
	switch (tool) {
		case "Bash":
			return `Bash: ${clip(input.command, CLIP_MESSAGE) ?? ""}`;
		case "Read":
		case "Write":
		case "Edit":
			return `${tool}: ${str(input.file_path) || str(input.path)}`;
		case "Glob":
			return `Glob: ${str(input.pattern)}`;
		case "Grep":
			return `Grep: ${str(input.pattern)}`;
		case "Task":
			return `Task (${str(input.subagent_type)}): ${str(input.description)}`;
		case "WebFetch":
		case "WebSearch":
			return `${tool}: ${str(input.url) || str(input.query)}`;
		default:
			return `${hook}: ${tool}`;
	}
}

/** The record shape the core's `/log` endpoint already accepts. */
export interface NormalisedHookLog {
	timestamp: string;
	hook: string;
	event: string;
	level: string;
	sessionId: string;
	tool: string;
	file: string;
	message: string;
	tool_use_id?: string;
	prompt_id?: string;
	details: Record<string, unknown>;
}

/**
 * Reshape one native payload.
 *
 * Returns null for input that is not a hook payload at all, so a stray POST
 * cannot land in the store as an `unknown` event.
 */
export function normaliseHookPayload(
	payload: unknown,
): NormalisedHookLog | null {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return null;
	}
	const p = payload as NativeHookPayload;
	const hook = str(p.hook_event_name);
	// The shell hook defaults this to "unknown"; here a missing event name
	// means the body is not a hook payload, and guessing would put junk in the
	// store under a name that looks real.
	if (!hook) return null;

	const tool = str(p.tool_name);
	const input = (p.tool_input ?? {}) as Record<string, unknown>;
	const effort =
		typeof p.effort === "object" && p.effort
			? str((p.effort as { level?: string }).level)
			: str(p.effort);
	const toolError = clip(p.tool_error, CLIP_TEXT);
	const stopError = clip(p.error, CLIP_TEXT);

	return {
		timestamp: nowIso(),
		hook,
		event: eventFor(hook),
		level: levelFor(p),
		sessionId: str(p.session_id) || "unknown",
		tool,
		file: str(input.file_path) || str(input.path) || str(p.filename),
		message: messageFor(p),
		// Correlation ids, promoted to the top level because the core treats
		// them as first-class rather than as incidental metadata.
		...(p.tool_use_id ? { tool_use_id: p.tool_use_id } : {}),
		...(p.prompt_id ? { prompt_id: p.prompt_id } : {}),
		details: {
			cwd: p.cwd ?? null,
			transcriptPath: p.transcript_path ?? null,
			permissionMode: p.permission_mode ?? null,
			effort: effort || null,
			model: p.model ?? null,
			// Subagent attribution. Present on events fired inside a subagent,
			// and what makes an agent tree buildable from tool events alone.
			agentId: p.agent_id ?? null,
			agentType: p.agent_type ?? null,
			tool_input: p.tool_input ?? null,
			tool_result:
				typeof p.tool_response === "string"
					? clip(p.tool_response, CLIP_RESULT)
					: (p.tool_response ?? null),
			toolError,
			// Real measured duration. Anything derived from our own timestamps
			// would be a multiple of 1000ms or 0.
			durationMs: p.duration_ms ?? null,
			prompt: clip(p.prompt, CLIP_TEXT),
			// Stop carries the finished reply; StopFailure reuses the same field
			// for the error string, which is why the two must never share an
			// event type.
			lastAssistantMessage: clip(p.last_assistant_message, CLIP_TEXT),
			stopHookActive: p.stop_hook_active ?? null,
			backgroundTasks: Array.isArray(p.background_tasks)
				? p.background_tasks.length
				: 0,
			stopError,
			errorDetails: p.error_details ?? null,
			notificationType: p.notification_type ?? null,
			startReason: p.start_reason ?? null,
			endReason: p.reason ?? null,
			trigger: p.trigger ?? null,
			changeType: p.change_type ?? null,
			loadReason: p.load_reason ?? null,
			source: p.source ?? null,
			fromModel: p.from_model ?? null,
			toModel: p.to_model ?? null,
		},
	};
}
