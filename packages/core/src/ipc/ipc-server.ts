/**
 * IPC Server for wrapper communication
 * Uses JSON-RPC 2.0 over stdio
 */

import { createInterface, type Interface } from "node:readline";
import type {
	ActivityItem,
	AiResponseActivityData,
	ErrorCode,
	LogEntry,
	MessageActivityData,
	NotificationActivityData,
	Session,
	SessionFilter,
	SessionStartActivityData,
	SessionSummary,
	SubagentCompleteActivityData,
	ToolCallActivityData,
	UserPromptActivityData,
	JsonRpcError,
	JsonRpcNotification,
	JsonRpcRequest,
	JsonRpcResponse,
} from "@inspector-hook/protocol";
import { ErrorCodes } from "@inspector-hook/protocol";
import type { InspectorCore } from "../core.js";
import {
	deleteMemoryFile,
	indexMemoryFile,
	listMemoryProjects,
	removeIndexEntry,
	readMemoryProject,
	resolveMemoryDir,
	writeMemoryFile,
	type MemoryType,
} from "../memory/native-memory.js";
import { buildSessionDigest } from "../memory/session-digest.js";
import {
	clearStagedContext,
	readStagedContext,
	stageContext,
} from "../memory/staged-context.js";
import type { FileTracker } from "../managers/file-tracker.js";
import type { LogManager } from "../managers/log-manager.js";
import type { SessionManager } from "../managers/session-manager.js";

export interface IpcServerOptions {
	logManager: LogManager;
	sessionManager: SessionManager;
	fileTracker: FileTracker;
	core: InspectorCore;
	/**
	 * Where the store lives. Needed because the context picker stages a file
	 * that the SessionStart hook reads directly, without going through the core
	 * -- so a pick still works when the core is not running.
	 */
	storagePath: string;
}

type MethodHandler = (params: unknown) => Promise<unknown>;

// Narrowing readers for `log.details`, which is Record<string, unknown> --
// i.e. hook-supplied and untrusted. Typing this producer against the protocol
// revealed it had been assigning `unknown` straight into fields the contract
// declares as string/number/boolean, so the declared shape was never actually
// guaranteed. These make the narrowing explicit and drop anything of the
// wrong type rather than passing it through mislabelled.
const asStr = (v: unknown): string | undefined =>
	typeof v === "string" ? v : undefined;
const asNum = (v: unknown): number | undefined =>
	typeof v === "number" ? v : undefined;
const asBool = (v: unknown): boolean | undefined =>
	typeof v === "boolean" ? v : undefined;
const asRec = (v: unknown): Record<string, unknown> | undefined =>
	v !== null && typeof v === "object" && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: undefined;

/** Every payload shape an activity item can carry. */
type ActivityData =
	| UserPromptActivityData
	| AiResponseActivityData
	| ToolCallActivityData
	| SessionStartActivityData
	| NotificationActivityData
	| SubagentCompleteActivityData
	| MessageActivityData;

/**
 * Fields the UI needs as first-class properties on a tool_call activity item.
 *
 * These used to be reachable only by digging into `result`, which was built as
 * `tool_result || result || details`. Because `details.tool_result` is always
 * set for a tool event, `result` collapsed to just the tool output and every
 * sibling key -- durationMs, agentType, promptId -- was silently dropped. The
 * Activity feed consequently rendered durations derived from second-resolution
 * hook timestamps, i.e. always a multiple of 1000ms or 0.
 */
function toolMetadata(log: LogEntry): {
	durationMs?: number;
	agentId?: string;
	agentType?: string;
} {
	const d = log.details ?? {};
	return {
		durationMs: typeof d.durationMs === "number" ? d.durationMs : undefined,
		agentId: typeof d.agentId === "string" ? d.agentId : undefined,
		agentType: typeof d.agentType === "string" ? d.agentType : undefined,
	};
}
// NOTE: promptId is deliberately NOT read here. The hook emits `prompt_id` at
// the payload root, not inside `details`, so a `details.promptId` read matched
// nothing -- it implied a path that does not exist. It is lifted into
// LogEntry.promptId at ingest and stamped onto every item type below.

/** Map a log's level (and event) onto a terminal execution status. */
function terminalStatus(
	log: LogEntry,
): "completed" | "failed" | "blocked" {
	if (log.level === "error" || log.event === "PostToolUseFailure") return "failed";
	if (log.level === "blocked") return "blocked";
	return "completed";
}

/**
 * Reduce a session to what a list row or detail header actually renders.
 * Deliberately omits toolExecutions, which dominates the payload on a long
 * session while the client builds its feed from `activity` instead.
 */
function summarizeSession(session: Session | null): SessionSummary | null {
	if (!session) return null;
	const metadata = (session.metadata ?? {}) as Record<string, unknown>;
	return {
		id: session.id,
		name: session.name,
		status: session.status,
		startTime: session.startTime,
		endTime: session.endTime,
		lastActivityTime: session.lastActivityTime,
		toolExecutionCount: session.toolExecutions.length,
		fileChangeCount: session.fileChanges.length,
		errorCount: session.toolExecutions.filter((e: { status: string }) => e.status === "failed")
			.length,
		gitBranch:
			typeof metadata.gitBranch === "string" ? metadata.gitBranch : undefined,
		projectName:
			typeof metadata.projectName === "string"
				? metadata.projectName
				: undefined,
	};
}

/** Does a session match a filter's status constraint? */
function matchesStatus(
	session: { status: string },
	filter: SessionFilter,
): boolean {
	if (!filter.status) return true;
	const statuses = Array.isArray(filter.status)
		? filter.status
		: [filter.status];
	return (statuses as string[]).includes(session.status);
}

export class IpcServer {
	private readline: Interface | null = null;
	private logManager: LogManager;
	private sessionManager: SessionManager;
	private fileTracker: FileTracker;
	private core: InspectorCore;
	private storagePath: string;
	private methods: Map<string, MethodHandler> = new Map();

	constructor(options: IpcServerOptions) {
		this.logManager = options.logManager;
		this.sessionManager = options.sessionManager;
		this.fileTracker = options.fileTracker;
		this.core = options.core;
		this.storagePath = options.storagePath;

		this.registerMethods();
	}

	/**
	 * Register all IPC method handlers
	 */
	private registerMethods(): void {
		// Core management
		this.methods.set("core.getStatus", async () => this.core.getStatus());
		this.methods.set("core.shutdown", async () => {
			await this.core.stop();
			return { success: true };
		});

		// Log operations
		this.methods.set("logs.getAll", async (params) =>
			this.logManager.getLogs(params as any),
		);
		this.methods.set("logs.getById", async (params) =>
			this.logManager.getLogById((params as any).id),
		);
		this.methods.set("logs.clear", async (params) =>
			this.logManager.clear((params as any).filter),
		);
		this.methods.set("logs.getStats", async () => this.logManager.getStats());

		// Session operations
		this.methods.set("sessions.getAll", async (params) =>
			this.sessionManager.getSessions(params as any),
		);
		this.methods.set("sessions.getById", async (params) =>
			this.sessionManager.getSession((params as any).id),
		);
		this.methods.set("sessions.terminate", async (params) =>
			this.sessionManager.terminate((params as any).id, (params as any).reason),
		);
		// Deleting a session's associated data is coordinated here rather than in
		// SessionManager, which holds no reference to the log or file managers.
		// It used to report `deletedFileChanges` as the session's change-count
		// while deleting nothing, and ignore the flag entirely on clear() --
		// telling the caller data was removed when it was all still on disk.
		this.methods.set("sessions.delete", async (params) => {
			const { id, deleteAssociatedData } = params as {
				id: string;
				deleteAssociatedData?: boolean;
			};
			const result = await this.sessionManager.delete(id);
			if (deleteAssociatedData) {
				Object.assign(result, await this.purgeSessionData(id));
			}
			return result;
		});
		this.methods.set("sessions.clear", async (params) => {
			const { filter, deleteAssociatedData } = params as {
				filter?: SessionFilter;
				deleteAssociatedData?: boolean;
			};
			// Capture the ids before clearing; afterwards they are unrecoverable.
			const { sessions } = await this.sessionManager.getSessions();
			const doomed = sessions
				.filter((s) => !filter?.status || matchesStatus(s, filter))
				.map((s) => s.id);

			const result = await this.sessionManager.clear(filter);

			if (deleteAssociatedData) {
				let deletedLogs = 0;
				let deletedFileChanges = 0;
				for (const id of doomed) {
					const purged = await this.purgeSessionData(id);
					deletedLogs += purged.deletedLogs;
					deletedFileChanges += purged.deletedFileChanges;
				}
				Object.assign(result, { deletedLogs, deletedFileChanges });
			}
			return result;
		});
		// logCount/warnings are counted here because SessionManager holds no
		// reference to the LogManager -- the same reason the cascade in
		// sessions.delete lives here. They were previously hardcoded to 0.
		this.methods.set("sessions.getStats", async (params) => {
			const id = (params as { id: string }).id;
			const { logs } = await this.logManager.getLogs({
				filter: { sessionId: id },
				pagination: { limit: Number.MAX_SAFE_INTEGER, offset: 0 },
			});
			return this.sessionManager.getSessionStats(id, {
				logCount: logs.length,
				warnings: logs.filter((l) => l.level === "warn").length,
			});
		});

		// Session activity - combines logs and tool executions for activity feed
		this.methods.set("sessions.getActivity", async (params) => {
			const sessionId = (params as any).id;
			if (!sessionId) {
				throw new Error("Session ID required");
			}

			// Get session data
			const session = await this.sessionManager.getSession(sessionId);

			// Get this session's logs.
			//
			// getLogs sorts BEFORE it paginates, so asking for `limit: 1000` with
			// `order: "asc"` returned the OLDEST thousand and discarded everything
			// newer. A session past the cap did not lose its tail -- its feed froze
			// at the beginning, permanently, with no indication.
			//
			// Fetch newest-first so the cap drops the oldest, then restore
			// chronological order for the feed. `limit` is caller-overridable so the
			// UI can page, and `truncated` tells it when there is more.
			const limit = Math.min(
				Math.max(Number((params as { limit?: number }).limit) || 2000, 1),
				10_000,
			);

			// Incremental fetch (`since`) and backfill (`before`).
			//
			// Both are applied to the ASSEMBLED ITEMS, not to the log query --
			// except `before`, which also narrows the log window so backfill can
			// reach past the window cap. Filtering logs by `since` would be wrong
			// twice over: a tool call whose PreToolUse fell outside the window
			// would be re-emitted under the PostToolUse's id as a duplicate, and
			// one whose PostToolUse fell outside would be reported as still
			// running forever. The window is therefore always assembled whole and
			// filtered afterwards.
			const p = params as { since?: unknown; before?: unknown };
			const since = asStr(p.since);
			const before = asStr(p.before);

			const newestFirst = await this.logManager.getLogs({
				filter: { sessionId, ...(before ? { endTime: before } : {}) },
				pagination: { limit, offset: 0 },
				sort: { field: "timestamp", order: "desc" },
			});
			const logsResult = {
				...newestFirst,
				logs: [...newestFirst.logs].reverse(),
			};
			const truncated = newestFirst.total > newestFirst.logs.length;
			// Activity items keep the log id they came from, so the turn id can be
			// applied to every item type in one pass rather than in each branch.
			const logsById = new Map(logsResult.logs.map((l) => [l.id, l]));


			// Build activity items from logs.
			//
			// Typed against the protocol's declarations rather than an inline
			// anonymous shape. The eight *ActivityData interfaces had no consumers
			// at all for a long time: the contract was asserted on the client and
			// produced untyped here, so a producer/consumer mismatch could not be
			// caught by the compiler. Importing them closes that.
			const activityItems: ActivityItem<ActivityData>[] = [];

			// When an item last CHANGED, keyed by item id. Only tool calls are
			// ever updated after creation, so this stays empty for most feeds;
			// everything else falls back to its own timestamp.
			const touched = new Map<string, string>();

			for (const log of logsResult.logs) {
				// User prompts
				if (log.hook === "UserPromptSubmit" || log.event === "user.prompt") {

					activityItems.push({
						id: log.id,
						type: "user_prompt",
						timestamp: log.timestamp,
						data: {
							prompt: asStr(log.details?.prompt) ?? log.message,
						} satisfies UserPromptActivityData,
					});
				}
				// A turn that ended on an API error. StopFailure runs INSTEAD of
				// Stop, and its last_assistant_message holds the error string rather
				// than Claude's reply -- so it must not become an ai_response, or
				// "API Error: Rate limit reached" renders as something Claude said.
				else if (log.hook === "StopFailure" || log.event === "ai.error") {
					activityItems.push({
						id: log.id,
						type: "message",
						timestamp: log.timestamp,
						data: {
							hook: log.hook,
							event: log.event,
							level: "error",
							message: log.message || "Turn failed",
							stopError: asStr(log.details?.stopError),
							errorDetails: asStr(log.details?.errorDetails),
						} satisfies MessageActivityData,
					});
				}
				// AI response completion (Stop hook) -- the clean-finish path only.
				else if (log.hook === "Stop" || log.event === "ai.response") {
					activityItems.push({
						id: log.id,
						type: "ai_response",
						timestamp: log.timestamp,
						data: {
							message: log.message || "Claude finished responding",
							// Stop carries no reason field at all. What it does carry is
							// whether background work is still outstanding, which
							// distinguishes "done" from "paused waiting on tasks".
							stopHookActive: asBool(log.details?.stopHookActive),
							backgroundTasks: asNum(log.details?.backgroundTasks),
							assistantMessage: asStr(log.details?.lastAssistantMessage),
						} satisfies AiResponseActivityData,
					});
				}
				// Notifications
				else if (log.hook === "Notification" || log.event === "notification") {
					activityItems.push({
						id: log.id,
						type: "notification",
						timestamp: log.timestamp,
						data: {
							message: log.message,
							notificationType: asStr(log.details?.notificationType),
						} satisfies NotificationActivityData,
					});
				}
				// Session start
				else if (log.hook === "SessionStart" || log.event === "session.start") {
					activityItems.push({
						id: log.id,
						type: "session_start",
						timestamp: log.timestamp,
						data: {
							event: "start",
							projectName: asStr(log.details?.projectName),
							gitBranch: asStr(log.details?.gitBranch),
							workingDirectory: asStr(log.details?.cwd),
						} satisfies SessionStartActivityData,
					});
				}
				// Subagent completion (Task tool)
				else if (log.hook === "SubagentStop" || log.event === "subagent.stop") {
					activityItems.push({
						id: log.id,
						type: "subagent_complete",
						timestamp: log.timestamp,
						data: {
							subagentType:
								asStr(log.details?.agentType) ??
								asStr(log.details?.subagent_type),
							// A subagent that reported no explicit failure is treated as
							// having succeeded; the level carries the real signal.
							success: log.level !== "error",
							result: log.details?.result,
							message: log.message,
						} satisfies SubagentCompleteActivityData,
					});
				}
				// Tool calls
				else if (
					log.tool &&
					(log.event === "PreToolUse" ||
						log.event === "PostToolUse" ||
						// A distinct event from PostToolUse, fired when a tool errors.
						// Unrecognised here, so a failed call stayed "running" forever.
						log.event === "PostToolUseFailure" ||
						log.event === "tool.start" ||
						log.event === "tool.end")
				) {
					// Find existing tool item to update using executionId for precise matching
					// Falls back to tool name + status if executionId not available
					const existingIdx = activityItems.findIndex((item) => {
						if (item.type !== "tool_call") return false;
						const data = item.data as any;
						if (data.status !== "running") return false;

						// Use executionId if available (preferred - precise matching)
						if (log.executionId && data.executionId) {
							return data.executionId === log.executionId;
						}

						// Fallback: match by tool name (legacy behavior)
						return data.tool === log.tool;
					});

					if (log.event === "PreToolUse" || log.event === "tool.start") {
						activityItems.push({
							id: log.id,
							type: "tool_call",
							timestamp: log.timestamp,
							data: {
								tool: log.tool,
								executionId: log.executionId,
								input:
									asRec(log.details?.tool_input) ??
									asRec(log.details?.input) ??
									asRec(log.details),
								file: log.file,
								status: "running",
								startTime: log.timestamp,
								...toolMetadata(log),
							},
						});
					} else if (existingIdx >= 0) {
						// Update the existing item in place. The completion event is
						// where durationMs and agent identity arrive, so its metadata is
						// merged onto the item -- previously it rode inside `result`,
						// which was built as `tool_result || result || details`. Since
						// details.tool_result is always set for a tool event, `result`
						// collapsed to the tool output and every sibling key was lost.
						const existing = activityItems[existingIdx];
						// The completion is a change to an item that already exists,
						// so an incremental caller must be told about it even though
						// the item's own timestamp is older than their cursor.
						touched.set(existing.id, log.timestamp);
						const data = existing.data as unknown as Record<string, unknown>;
						data.status = terminalStatus(log);
						data.result =
							log.details?.tool_result ?? log.details?.result ?? log.details;
						data.endTime = log.timestamp;
						if (log.details?.toolError !== undefined) {
							data.error = asStr(log.details.toolError);
						}
						for (const [key, value] of Object.entries(toolMetadata(log))) {
							if (value !== undefined) data[key] = value;
						}
					} else {
						// PostToolUse without matching PreToolUse, still add it
						activityItems.push({
							id: log.id,
							type: "tool_call",
							timestamp: log.timestamp,
							data: {
								tool: log.tool,
								executionId: log.executionId,
								input:
									asRec(log.details?.tool_input) ?? asRec(log.details?.input),
								result:
									log.details?.tool_result ??
									log.details?.result ??
									log.details,
								error: asStr(log.details?.toolError),
								file: log.file,
								status: terminalStatus(log),
								startTime: log.timestamp,
								...toolMetadata(log),
							},
						});
					}
				}
				// Other messages
				else if (log.message && log.hook !== "unknown") {
					activityItems.push({
						id: log.id,
						type: "message",
						timestamp: log.timestamp,
						data: {
							hook: log.hook,
							event: log.event,
							level: log.level,
							message: log.message,
							details: log.details,
						} satisfies MessageActivityData,
					});
				}
			}

			// Stamp the turn id onto every item, not just tool calls.
			//
			// Applied uniformly here rather than per-branch: prompt_id is on every
			// event except SessionStart, and grouping needs it on the user_prompt
			// item above all -- that is the anchor a turn is grouped against.
			// Without it a client must infer turns from prompt boundaries, which
			// collapses a whole session into one turn whenever the prompts predate
			// the field (one live session has 361 tool events and 1 logged prompt).
			for (const item of activityItems) {
				const promptId = logsById.get(item.id)?.promptId;
				if (promptId === undefined) continue;

				// Canonical location, per ActivityItemBase: the turn id describes the
				// item, not its payload.
				item.promptId ??= promptId;

				// Also mirrored into `data` for now. The webview reads it from there,
				// and typing this producer revealed the two had diverged -- the
				// declaration said item-level while this emitted data-level. Kept
				// until the client moves to item.promptId, then removed.
				const data = item.data as unknown as Record<string, unknown>;
				data.promptId ??= promptId;
			}

			// Sort by timestamp
			activityItems.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

			// Stamp every item with when it last changed, so a client can merge
			// pages by keeping the greater updatedAt per id.
			for (const item of activityItems) {
				item.updatedAt = touched.get(item.id) ?? item.timestamp;
			}

			// The cursor advances over the WHOLE window, not the filtered slice.
			// Taken from the returned items only, a poll that filtered everything
			// out would hand back the caller's own cursor and they would re-request
			// the same window forever.
			let nextSince: string | undefined;
			for (const item of activityItems) {
				const at = item.updatedAt as string;
				if (nextSince === undefined || at > nextSince) nextSince = at;
			}

			// INCLUSIVE (>=), and deliberately so. Timestamps collide constantly:
			// across 2807 real captured logs, 984 of them (35.1%) shared a
			// timestamp with another log, and one timestamp covered 12 logs --
			// partly because not every producer emits milliseconds. An exclusive
			// cursor would silently drop every item sharing the boundary instant,
			// which at the worst observed case is twelve missing feed entries.
			//
			// The cost is that a poll re-sends the boundary items; the client
			// merges by id, which it must do anyway to pick up tool completions.
			const visible = since
				? activityItems.filter((item) => (item.updatedAt as string) >= since)
				: activityItems;

			return {
				sessionId,
				session,
				sessionSummary: summarizeSession(session),
				activity: visible,
				totalItems: visible.length,
				since,
				nextSince,
				// Older items exist before this window, reachable by passing the
				// oldest returned timestamp back as `before`.
				hasMore: truncated,
				// True when older logs exist beyond the fetched window, so the UI
				// can show "earlier activity not loaded" rather than implying the
				// session simply started here.
				truncated,
				// How many logs the core currently RETAINS for this session -- not a
				// lifetime total. LogManager serves reads from memory only, so
				// anything evicted past maxLogsInMemory is uncounted. It is a floor.
				availableLogs: newestFirst.total,
			};
		});

		// File change operations
		this.methods.set("fileChanges.getPending", async (params) =>
			this.fileTracker.getPendingChanges(params as any),
		);
		this.methods.set("fileChanges.getDiff", async (params) =>
			this.fileTracker.getDiff((params as any).changeId),
		);
		this.methods.set("fileChanges.keep", async (params) =>
			this.fileTracker.keepChange((params as any).changeId),
		);
		this.methods.set("fileChanges.revert", async (params) =>
			this.fileTracker.revertChange((params as any).changeId),
		);
		this.methods.set("fileChanges.keepAll", async (params) =>
			this.fileTracker.keepAll((params as any).sessionId),
		);
		this.methods.set("fileChanges.revertAll", async (params) =>
			this.fileTracker.revertAll((params as any).sessionId),
		);
		this.methods.set("fileChanges.getAll", async (params) =>
			this.fileTracker.getAllChanges(params as any),
		);
		this.methods.set("fileChanges.getById", async (params) =>
			this.fileTracker.getChangeById((params as any).id),
		);
		this.methods.set("fileChanges.delete", async (params) =>
			this.fileTracker.deleteChange((params as any).changeId),
		);
		this.methods.set("fileChanges.clear", async (params) =>
			this.fileTracker.clearChanges((params as any).filter),
		);
		this.methods.set("fileChanges.updateContent", async (params) =>
			this.fileTracker.updateChangeContent(
				(params as any).changeId,
				(params as any).afterContent,
			),
		);

		// History operations (placeholders)
		this.methods.set("history.getTrackedFiles", async () =>
			this.fileTracker.getTrackedFiles(),
		);
		this.methods.set("history.getVersions", async (params) =>
			this.fileTracker.getVersions(
				(params as any).filePath,
				(params as any).limit,
			),
		);
		this.methods.set("history.getVersionContent", async (params) =>
			this.fileTracker.getVersionContent(
				(params as any).filePath,
				(params as any).versionNumber,
			),
		);
		this.methods.set("history.compareVersions", async (params) =>
			this.fileTracker.compareVersions(
				(params as any).filePath,
				(params as any).version1,
				(params as any).version2,
			),
		);
		this.methods.set("history.restoreVersion", async (params) =>
			this.fileTracker.restoreVersion(
				(params as any).filePath,
				(params as any).versionNumber,
			),
		);
		this.methods.set("history.deleteVersion", async (params) =>
			this.fileTracker.deleteVersion(
				(params as any).filePath,
				(params as any).versionNumber,
			),
		);
		this.methods.set("history.deleteFile", async (params) =>
			this.fileTracker.deleteFileHistory((params as any).filePath),
		);
		this.methods.set("history.clear", async (params) =>
			this.fileTracker.clearHistory((params as any).filter),
		);
		this.methods.set("history.getStats", async () =>
			this.fileTracker.getHistoryStats(),
		);

		// Archive operations (placeholders)
		this.methods.set("archive.getAll", async (params) =>
			this.fileTracker.getArchivedChanges(params as any),
		);
		this.methods.set("archive.getById", async (params) =>
			this.fileTracker.getArchivedById((params as any).id),
		);
		this.methods.set("archive.restoreFromArchive", async (params) =>
			this.fileTracker.restoreFromArchive((params as any).changeId),
		);
		this.methods.set("archive.delete", async (params) =>
			this.fileTracker.deleteArchived((params as any).id),
		);
		this.methods.set("archive.clear", async (params) =>
			this.fileTracker.clearArchive((params as any).filter),
		);
		this.methods.set("archive.getDiff", async (params) =>
			this.fileTracker.getArchivedDiff((params as any).id),
		);
		this.methods.set("archive.getStats", async () =>
			this.fileTracker.getArchiveStats(),
		);

		// ---------------------------------------------------------------------
		// Native auto memory (Milestone 3)
		//
		// Claude Code writes these files and nothing but a text editor reads
		// them back, which is the gap these methods close. Reads are
		// unrestricted; writes and deletes go through native-memory's guards,
		// which refuse to touch a file the user wrote.
		// ---------------------------------------------------------------------

		/** Every project on the machine that has memory — the cross-project rollup. */
		this.methods.set("memory.getProjects", async (params) =>
			listMemoryProjects({
				includeEmpty: asBool(asRec(params)?.includeEmpty) ?? false,
			}),
		);

		/**
		 * One project's memory. Addressed either by directory, or by session so
		 * the caller does not have to know where memory lives.
		 */
		this.methods.set("memory.getProject", async (params) => {
			const dir = await this.memoryDirFrom(params);
			if (!dir) {
				return {
					memoryDir: null,
					files: [],
					hasIndex: false,
					reason:
						"No memory directory for this session: it carries no transcript " +
						"path, and the project slug cannot be derived safely.",
				};
			}
			return readMemoryProject(dir);
		});

		/** One memory file, with its body. */
		this.methods.set("memory.getFile", async (params) => {
			const rec = asRec(params) ?? {};
			const dir = await this.memoryDirFrom(params);
			const fileName = asStr(rec.fileName);
			if (!dir || !fileName) return null;
			const project = await readMemoryProject(dir);
			return project.files.find((f) => f.fileName === fileName) ?? null;
		});

		/** Create or update a memory entry from the curation UI. */
		this.methods.set("memory.write", async (params) => {
			const rec = asRec(params) ?? {};
			const dir = await this.memoryDirFrom(params);
			const name = asStr(rec.name);
			if (!name) {
				return { written: false, reason: "A name is required." };
			}
			return writeMemoryFile(dir, {
				name,
				description: asStr(rec.description) ?? "",
				type: (asStr(rec.type) as MemoryType) ?? "project",
				body: asStr(rec.body) ?? "",
				title: asStr(rec.title),
			});
		});

		/** Delete a memory entry. `force` is required for a file we did not author. */
		this.methods.set("memory.delete", async (params) => {
			const rec = asRec(params) ?? {};
			const dir = await this.memoryDirFrom(params);
			const fileName = asStr(rec.fileName);
			if (!dir || !fileName) {
				return { deleted: false, reason: "A memory directory and file name are required." };
			}
			return deleteMemoryFile(dir, fileName, {
				force: asBool(rec.force) ?? false,
			});
		});

		/**
		 * Reference an existing file from MEMORY.md without rewriting it.
		 *
		 * The fix for an orphaned file, and the reason it is a separate method:
		 * memory.write refuses a file it did not author, so without this the
		 * view could not index a hand-written note at all — the single case
		 * where indexing matters most.
		 */
		this.methods.set("memory.addToIndex", async (params) => {
			const rec = asRec(params) ?? {};
			const dir = await this.memoryDirFrom(params);
			const fileName = asStr(rec.fileName);
			if (!dir || !fileName) {
				return { indexed: false, reason: "A memory directory and file name are required." };
			}
			return indexMemoryFile(dir, fileName, {
				title: asStr(rec.title),
				description: asStr(rec.description),
			});
		});

		/** Drop a file's index line while leaving the file in place. */
		this.methods.set("memory.removeFromIndex", async (params) => {
			const rec = asRec(params) ?? {};
			const dir = await this.memoryDirFrom(params);
			const fileName = asStr(rec.fileName);
			if (!dir || !fileName) {
				return { changed: false, reason: "A memory directory and file name are required." };
			}
			return { changed: await removeIndexEntry(dir, fileName) };
		});

		/**
		 * Build a session's digest.
		 *
		 * Returns it without writing unless `write` is set, so the UI can show
		 * exactly what would be added to memory before anything is added.
		 */
		// ---------------------------------------------------------------------
		// The explicit context picker (M3 item 5)
		//
		// Staging is a deliberate, one-off, expiring hand-off: the SessionStart
		// hook prints it once and deletes it. There is no automatic path here on
		// purpose -- injected text reaches a future model as fact, with nothing
		// for it or the user to check it against, so the failure mode of getting
		// it wrong is silent and compounds. Native auto memory already covers
		// the automatic case from the user's own curated corpus.
		// ---------------------------------------------------------------------

		/**
		 * Stage context for the next session.
		 *
		 * Either explicit `text`, or a `sessionId` whose digest becomes the text.
		 * The returned object contains EXACTLY what will be injected, so a
		 * confirmation step can show the real thing rather than an approximation.
		 */
		this.methods.set("memory.stageContext", async (params) => {
			const rec = asRec(params) ?? {};
			const explicit = asStr(rec.text);
			const sessionId = asStr(rec.sessionId);

			let text = explicit;
			let label = asStr(rec.label);

			if (!text && sessionId) {
				const session = await this.sessionManager.getSession(sessionId);
				if (!session) return { staged: false, reason: `No session ${sessionId}.` };
				const digest = buildSessionDigest({
					session,
					counts: await this.logCountsForSession(sessionId),
					filePaths: await this.filePathsForSession(session.fileChanges),
				});
				if (!digest.worthKeeping) {
					return { staged: false, reason: digest.skipReason };
				}
				text = digest.body;
				label ??= digest.title;
			}

			if (!text) {
				return { staged: false, reason: "Either text or a sessionId is required." };
			}

			const staged = await stageContext(this.storagePath, {
				text,
				sourceSessionId: sessionId,
				label,
				ttlMs: asNum(rec.ttlMs),
			});
			return { staged: true, ...staged };
		});

		/** What is staged, or null. Expiry is applied on read. */
		this.methods.set("memory.getStagedContext", async () =>
			readStagedContext(this.storagePath),
		);

		/** Discard a staged pick before it is consumed. */
		this.methods.set("memory.clearStagedContext", async () => ({
			cleared: await clearStagedContext(this.storagePath),
		}));

		this.methods.set("memory.buildDigest", async (params) => {
			const rec = asRec(params) ?? {};
			const sessionId = asStr(rec.sessionId);
			if (!sessionId) return { error: "A sessionId is required." };
			const session = await this.sessionManager.getSession(sessionId);
			if (!session) return { error: `No session ${sessionId}.` };

			const digest = buildSessionDigest({
				session,
				counts: await this.logCountsForSession(sessionId),
				filePaths: await this.filePathsForSession(session.fileChanges),
			});

			if (!asBool(rec.write)) return { digest, written: false };
			if (!digest.worthKeeping) {
				return { digest, written: false, reason: digest.skipReason };
			}
			const dir = resolveMemoryDir(
				(session.metadata as Record<string, unknown> | undefined)?.transcriptPath,
			);
			const result = await writeMemoryFile(dir, digest);
			return { digest, ...result };
		});
	}

	/**
	 * Resolve a memory directory from an explicit path or from a session.
	 *
	 * An explicit `memoryDir` is honoured because the cross-project view lists
	 * directories and then asks about them. Otherwise it comes from the
	 * session's transcript path, which Claude Code supplied — never from a slug
	 * computed out of the working directory, which can collide.
	 */
	private async memoryDirFrom(params: unknown): Promise<string | null> {
		const rec = asRec(params) ?? {};
		const explicit = asStr(rec.memoryDir);
		if (explicit) return explicit;

		const sessionId = asStr(rec.sessionId);
		if (!sessionId) return null;
		const session = await this.sessionManager.getSession(sessionId);
		if (!session) return null;
		return resolveMemoryDir(
			(session.metadata as Record<string, unknown> | undefined)?.transcriptPath,
		);
	}

	/** Error/warning/blocked counts for one session, from the log index. */
	private async logCountsForSession(sessionId: string): Promise<{
		errors: number;
		warnings: number;
		blocked: number;
		logs: number;
	}> {
		const counts = { errors: 0, warnings: 0, blocked: 0, logs: 0 };
		const { logs } = await this.logManager.getLogs({
			filter: { sessionId },
			pagination: { limit: Number.MAX_SAFE_INTEGER, offset: 0 },
		});
		for (const log of logs) {
			counts.logs++;
			if (log.level === "error") counts.errors++;
			else if (log.level === "warn") counts.warnings++;
			else if (log.level === "blocked") counts.blocked++;
		}
		return counts;
	}

	/** Resolve change IDs to file paths, which only the tracker can do. */
	private async filePathsForSession(
		changeIds: string[] | undefined,
	): Promise<string[]> {
		if (!Array.isArray(changeIds) || changeIds.length === 0) return [];
		const paths: string[] = [];
		for (const id of changeIds) {
			const change = await this.fileTracker.getChangeById(id);
			if (change?.filePath) paths.push(change.filePath);
		}
		return paths;
	}

	/**
	 * Delete the logs and file changes belonging to a session, returning how
	 * many of each were actually removed.
	 */
	private async purgeSessionData(
		sessionId: string,
	): Promise<{ deletedLogs: number; deletedFileChanges: number }> {
		const logs = await this.logManager.clear({ sessionId });
		const changes = await this.fileTracker.clearChanges({ sessionId });
		return {
			deletedLogs: logs.cleared ?? 0,
			deletedFileChanges: changes.deleted ?? 0,
		};
	}

	/**
	 * Start listening on stdin
	 */
	async start(): Promise<void> {
		this.readline = createInterface({
			input: process.stdin,
			terminal: false,
		});

		this.readline.on("line", async (line: string) => {
			if (!line.trim()) return;

			try {
				const message = JSON.parse(line) as JsonRpcRequest;
				await this.handleMessage(message);
			} catch (error) {
				this.sendError(null, ErrorCodes.PARSE_ERROR, "Invalid JSON");
			}
		});
	}

	/**
	 * Stop the IPC server
	 */
	async stop(): Promise<void> {
		if (this.readline) {
			this.readline.close();
			this.readline = null;
		}
	}

	/**
	 * Handle incoming JSON-RPC message
	 */
	private async handleMessage(message: JsonRpcRequest): Promise<void> {
		if (message.jsonrpc !== "2.0") {
			this.sendError(
				message.id,
				ErrorCodes.INVALID_REQUEST,
				"Invalid JSON-RPC version",
			);
			return;
		}

		const handler = this.methods.get(message.method);
		if (!handler) {
			this.sendError(
				message.id,
				ErrorCodes.METHOD_NOT_FOUND,
				`Method not found: ${message.method}`,
			);
			return;
		}

		try {
			const result = await handler(message.params);
			this.sendResponse(message.id, result);
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Internal error";
			this.sendError(message.id, ErrorCodes.INTERNAL_ERROR, errorMessage);
		}
	}

	/**
	 * Send JSON-RPC response
	 */
	private sendResponse(id: string | number, result: unknown): void {
		const response: JsonRpcResponse = {
			jsonrpc: "2.0",
			id,
			result,
		};
		// Write to stdout for JSON-RPC over stdio
		process.stdout.write(JSON.stringify(response) + "\n");
	}

	/**
	 * Send JSON-RPC error
	 */
	private sendError(
		id: string | number | null,
		code: ErrorCode,
		message: string,
	): void {
		const response: JsonRpcError = {
			jsonrpc: "2.0",
			id: id ?? 0,
			error: { code, message },
		};
		// Write to stdout for JSON-RPC over stdio
		process.stdout.write(JSON.stringify(response) + "\n");
	}

	/**
	 * Send JSON-RPC notification
	 */
	sendNotification(method: string, params: unknown): void {
		const notification: JsonRpcNotification = {
			jsonrpc: "2.0",
			method,
			params,
		};
		// Write to stdout for JSON-RPC over stdio
		process.stdout.write(JSON.stringify(notification) + "\n");
	}

	/**
	 * Broadcast a notification to all connected clients
	 * For stdio-based IPC, this is the same as sendNotification
	 * but provides a cleaner API for event-driven notifications
	 */
	broadcast(event: string, data: unknown): void {
		this.sendNotification(event, data);
	}
}
