/**
 * IPC Server for wrapper communication
 * Uses JSON-RPC 2.0 over stdio
 */

import { createInterface, type Interface } from "node:readline";
import type {
	ErrorCode,
	LogEntry,
	Session,
	SessionFilter,
	SessionSummary,
	JsonRpcError,
	JsonRpcNotification,
	JsonRpcRequest,
	JsonRpcResponse,
} from "@inspector-hook/protocol";
import { ErrorCodes } from "@inspector-hook/protocol";
import type { InspectorCore } from "../core.js";
import type { FileTracker } from "../managers/file-tracker.js";
import type { LogManager } from "../managers/log-manager.js";
import type { SessionManager } from "../managers/session-manager.js";

export interface IpcServerOptions {
	logManager: LogManager;
	sessionManager: SessionManager;
	fileTracker: FileTracker;
	core: InspectorCore;
}

type MethodHandler = (params: unknown) => Promise<unknown>;

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
	promptId?: string;
} {
	const d = log.details ?? {};
	return {
		durationMs: typeof d.durationMs === "number" ? d.durationMs : undefined,
		agentId: typeof d.agentId === "string" ? d.agentId : undefined,
		agentType: typeof d.agentType === "string" ? d.agentType : undefined,
		promptId: typeof d.promptId === "string" ? d.promptId : undefined,
	};
}

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
	private methods: Map<string, MethodHandler> = new Map();

	constructor(options: IpcServerOptions) {
		this.logManager = options.logManager;
		this.sessionManager = options.sessionManager;
		this.fileTracker = options.fileTracker;
		this.core = options.core;

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
		this.methods.set("sessions.getStats", async (params) =>
			this.sessionManager.getSessionStats((params as any).id),
		);

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
			const newestFirst = await this.logManager.getLogs({
				filter: { sessionId },
				pagination: { limit, offset: 0 },
				sort: { field: "timestamp", order: "desc" },
			});
			const logsResult = {
				...newestFirst,
				logs: [...newestFirst.logs].reverse(),
			};
			const truncated = newestFirst.total > newestFirst.logs.length;


			// Build activity items from logs
			// Types: user_prompt, ai_response, tool_call, session_start, notification, subagent_complete, message
			const activityItems: Array<{
				id: string;
				type:
					| "user_prompt"
					| "ai_response"
					| "tool_call"
					| "session_start"
					| "notification"
					| "subagent_complete"
					| "message";
				timestamp: string;
				data: unknown;
			}> = [];

			for (const log of logsResult.logs) {
				// User prompts
				if (log.hook === "UserPromptSubmit" || log.event === "user.prompt") {

					activityItems.push({
						id: log.id,
						type: "user_prompt",
						timestamp: log.timestamp,
						data: {
							prompt: log.details?.prompt || log.message,
						},
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
							details: {
								stopError: log.details?.stopError,
								errorDetails: log.details?.errorDetails,
							},
						},
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
							stopHookActive: log.details?.stopHookActive,
							backgroundTasks: log.details?.backgroundTasks,
							assistantMessage: log.details?.lastAssistantMessage,
						},
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
							notificationType: log.details?.notificationType,
						},
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
							projectName: log.details?.projectName,
							gitBranch: log.details?.gitBranch,
							workingDirectory: log.details?.cwd,
						},
					});
				}
				// Subagent completion (Task tool)
				else if (log.hook === "SubagentStop" || log.event === "subagent.stop") {
					activityItems.push({
						id: log.id,
						type: "subagent_complete",
						timestamp: log.timestamp,
						data: {
							subagentType: log.details?.subagent_type,
							success: log.details?.success,
							result: log.details?.result,
							message: log.message,
						},
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
									log.details?.tool_input || log.details?.input || log.details,
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
						const data = existing.data as Record<string, unknown>;
						data.status = terminalStatus(log);
						data.result =
							log.details?.tool_result ?? log.details?.result ?? log.details;
						data.endTime = log.timestamp;
						if (log.details?.toolError !== undefined) {
							data.error = log.details.toolError;
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
								input: log.details?.tool_input || log.details?.input,
								result:
									log.details?.tool_result ??
									log.details?.result ??
									log.details,
								error: log.details?.toolError,
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
						},
					});
				}
			}

			// Sort by timestamp
			activityItems.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

			return {
				sessionId,
				session,
				sessionSummary: summarizeSession(session),
				activity: activityItems,
				totalItems: activityItems.length,
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
