/**
 * Tool execution pairing and reconciliation.
 *
 * Pure functions over a session's executions, extracted from SessionManager so
 * the pairing rules — which caused two separate production bugs — are readable
 * and testable on their own.
 */

import type { LogEntry, ToolExecution } from "@inspector-hook/protocol";

/**
 * Events that close out a running execution.
 *
 * PostToolUseFailure is a DISTINCT event from PostToolUse: Claude Code fires it
 * when a tool errors. It was absent from this set, so every failed tool call
 * stayed "running" forever.
 */
export const TOOL_COMPLETION_EVENTS: ReadonlySet<string> = new Set([
	"tool.end",
	"PostToolUse",
	"PostToolUseFailure",
]);

/** Events that open a new execution. */
export const TOOL_START_EVENTS: ReadonlySet<string> = new Set([
	"tool.start",
	"PreToolUse",
]);

export function isToolCompletionEvent(event: string | undefined): boolean {
	return event !== undefined && TOOL_COMPLETION_EVENTS.has(event);
}

export function isToolStartEvent(event: string | undefined): boolean {
	return event !== undefined && TOOL_START_EVENTS.has(event);
}

/**
 * The terminal status a completion log implies.
 *
 * "blocked" is resolved here rather than in a later pass. It used to be handled
 * separately, after the completion branch had already written "completed" —
 * which meant the blocked branch could no longer find the execution as running,
 * and blocked tool calls were recorded as successful.
 */
export function terminalStatusFor(log: LogEntry): ToolExecution["status"] {
	if (log.level === "error" || log.event === "PostToolUseFailure") {
		return "failed";
	}
	if (log.level === "blocked") return "blocked";
	return "completed";
}

/**
 * Find the running execution a completion log belongs to.
 *
 * Matches on Claude Code's `tool_use_id` when present, which is exact even when
 * several calls to the same tool run in parallel. Falls back to "first running
 * execution with this tool name" only for logs from hooks that predate the id —
 * that fallback was the ONLY strategy for a long time, and it cross-paired
 * concurrent calls, attributing one call's result and duration to another.
 */
export function findRunningExecution(
	executions: readonly ToolExecution[],
	log: LogEntry,
): ToolExecution | undefined {
	if (log.executionId) {
		const exact = executions.find(
			(e) => e.id === log.executionId && e.status === "running",
		);
		if (exact) return exact;
	}
	return executions.find(
		(e) => e.tool === log.tool && e.status === "running",
	);
}

/** Build a new running execution from a start log. */
export function createExecution(log: LogEntry): ToolExecution {
	return {
		// Prefer Claude Code's own tool_use_id so the pair can be matched
		// exactly; only synthesise an id when the hook did not supply one.
		id:
			log.executionId ||
			`exec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
		tool: log.tool as string,
		input:
			(log.details?.input as Record<string, unknown> | undefined) ??
			log.details ??
			{},
		startTime: log.timestamp,
		status: "running",
		affectedFiles: log.file ? [log.file] : undefined,
	};
}

/** Why an execution was resolved without a completion event. */
export const ABANDONED_REASON =
	"No completion event was received for this tool call, so its outcome is unknown.";

/**
 * Executions that have been "running" longer than maxAgeMs.
 *
 * Nothing reconciled these for a long time, so they accumulated without limit.
 * Two causes remain even with correct pairing: the core restarted mid-flight,
 * or the tool legitimately emits no terminal event at all — a PreToolUse
 * denial is followed by neither PostToolUse nor PostToolUseFailure, and a
 * validation rejection fires neither.
 *
 * An execution with an unparseable startTime is treated as abandoned: it cannot
 * be aged, and leaving it running forever is the worse failure.
 */
export function findAbandonedExecutions(
	executions: readonly ToolExecution[],
	maxAgeMs: number,
	now: number = Date.now(),
): ToolExecution[] {
	return executions.filter((exec) => {
		if (exec.status !== "running") return false;
		const started = new Date(exec.startTime).getTime();
		const age = Number.isFinite(started) ? now - started : Number.POSITIVE_INFINITY;
		return age >= maxAgeMs;
	});
}

/**
 * Mark an execution abandoned.
 *
 * Marked `unknown`, not `failed`.
 *
 * This used to write "failed", reasoning that leaving it "running" was a false
 * statement so a terminal one was better. That traded one false statement for
 * another: an audit of the live store found 22 executions reaped this way and
 * NOT ONE had actually failed — among them a `Read` that succeeded, sat
 * running for 15 minutes because no completion event arrived, and was then
 * reported as a failure. The hedge lived only in the error text, which a status
 * badge does not show.
 *
 * `unknown` is what is true: the call ended, and we do not know how.
 */
export function markAbandoned(exec: ToolExecution): void {
	exec.status = "unknown";
	exec.endTime = new Date().toISOString();
	exec.error = ABANDONED_REASON;
}
