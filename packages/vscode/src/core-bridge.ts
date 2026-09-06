/**
 * Core Bridge
 * Communication between VS Code extension and Core process
 * Uses JSON-RPC 2.0 over stdio
 */

import { type ChildProcess, spawn } from "node:child_process";
import { createMemoryBridge, type MemoryBridge } from "./bridge/memory-bridge.js";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { createInterface, type Interface } from "node:readline";
import type {
	DiffResult,
	SessionActivityResponse,
	FileChange,
	JsonRpcError,
	JsonRpcNotification,
	JsonRpcRequest,
	JsonRpcResponse,
	LogEntry,
	LogFilter,
	PaginationOptions,
	Session,
	Stats,
} from "@inspector-hook/protocol";

// Union type for JSON-RPC response (success or error)
type JsonRpcResult = JsonRpcResponse | JsonRpcError;

export interface CoreBridgeOptions {
	/** Where the core keeps its own state (VS Code global storage). */
	storagePath: string;
	/**
	 * The user's workspace folder — what the core treats as the project root.
	 * Undefined when no folder is open; the env var is then omitted entirely
	 * rather than passing a meaningless path.
	 */
	workspaceRoot?: string;
	httpPort: number;
	/** Write a session digest into native auto memory when a session ends. */
	writeSessionMemory?: boolean;
	extensionPath?: string;
}

type ResponseCallback = {
	resolve: (result: unknown) => void;
	reject: (error: Error) => void;
};

/**
 * Memory and context-tray methods live in ./bridge/memory-bridge.ts.
 *
 * Declaration merging puts them on the class type, and the constructor spreads
 * the real implementations onto the instance, so every existing caller keeps
 * working unchanged -- the split is structural, not a rename.
 */
export interface CoreBridge extends MemoryBridge {}

export class CoreBridge extends EventEmitter {
	private process: ChildProcess | null = null;
	private readline: Interface | null = null;
	private options: CoreBridgeOptions;
	private requestId = 0;
	private pendingRequests: Map<number, ResponseCallback> = new Map();
	private stats: Stats | null = null;
	private running = false;
	private httpPort = 0;

	constructor(options: CoreBridgeOptions) {
		super();
		this.options = options;
		// The memory and tray methods, from ./bridge/. Assigned rather than
		// inherited so `sendRequest` can stay private.
		Object.assign(
			this,
			createMemoryBridge(<T,>(method: string, params?: unknown) =>
				this.sendRequest<T>(method, params),
			),
		);
	}

	/**
	 * Start the core process
	 */
	async start(): Promise<void> {
		if (this.running) {
			return;
		}

		return new Promise((resolve, reject) => {
			// Find the core CLI
			const corePath = this.findCorePath();

			// Spawn the core process.
			// The configured ports are passed through here; previously they were
			// read from settings, handed to CoreBridge, and then never used, so
			// `inspectorHook.httpPort` had no effect at all. Workspace root is the
			// actual workspace folder -- it used to be VS Code's global storage
			// path, which is where core state lives, not where the user's code is.
			this.process = spawn("node", [corePath], {
				stdio: ["pipe", "pipe", "pipe"],
				env: {
					...process.env,
					INSPECTOR_HOOK_HTTP_PORT: String(this.options.httpPort),
					// Forwarded EXPLICITLY, not inherited. The core reads this from
					// its environment, and the only other way to set it was to launch
					// VS Code itself from a shell with the variable exported — so the
					// feature had no reachable switch at all from inside the editor.
					...(this.options.writeSessionMemory
						? { INSPECTOR_HOOK_SESSION_MEMORY: "1" }
						: {}),
					// Omitted when there is no workspace folder, rather than sent
					// as a placeholder the core would treat as a real root.
					...(this.options.workspaceRoot
						? { INSPECTOR_HOOK_WORKSPACE: this.options.workspaceRoot }
						: {}),
				},
			});

			// Handle process errors
			this.process.on("error", (error) => {
				this.running = false;
				reject(error);
			});

			this.process.on("exit", (code) => {
				this.running = false;
				this.emit("exit", code);
			});

			// Read stderr for error/debug messages
			if (this.process.stderr) {
				this.process.stderr.on("data", (data: Buffer) => {
					const msg = data.toString();
					this.emit("stderr", msg);
				});
			}

			// Set up readline for stdout
			if (this.process.stdout) {
				this.readline = createInterface({
					input: this.process.stdout,
					terminal: false,
				});

				let readyReceived = false;

				this.readline.on("line", (line: string) => {
					if (!line.trim()) return;

					try {
						const message = JSON.parse(line);

						// Handle ready message (first message from core)
						if (!readyReceived && message.type === "ready") {
							readyReceived = true;
							this.httpPort = message.port;
							this.running = true;
							this.initializeStats();
							resolve();
							return;
						}

						// Handle JSON-RPC response
						if ("id" in message && message.jsonrpc === "2.0") {
							this.handleResponse(message as JsonRpcResult);
							return;
						}

						// Handle JSON-RPC notification
						if ("method" in message && !("id" in message)) {
							this.handleNotification(message as JsonRpcNotification);
							return;
						}
					} catch {
						// Ignore malformed messages
					}
				});
			}

			// Timeout after 10 seconds
			setTimeout(() => {
				if (!this.running) {
					this.stop();
					reject(new Error("Timeout waiting for core process to start"));
				}
			}, 10000);
		});
	}

	/**
	 * Find the path to the core CLI
	 */
	private findCorePath(): string {
		// When running from VS Code extension, look in node_modules
		if (this.options.extensionPath) {
			return join(
				this.options.extensionPath,
				"node_modules",
				"@inspector-hook",
				"core",
				"dist",
				"cli.js",
			);
		}

		// Fallback to workspace path for development
		return join(__dirname, "..", "..", "core", "dist", "cli.js");
	}

	/**
	 * Initialize stats
	 */
	private initializeStats(): void {
		this.stats = {
			totalLogs: 0,
			errors: 0,
			warnings: 0,
			blocked: 0,
			logsPerMinute: 0,
			activeSessions: 0,
			pendingChanges: 0,
		};
	}

	/**
	 * Handle JSON-RPC response
	 */
	private handleResponse(response: JsonRpcResult): void {
		const pending = this.pendingRequests.get(response.id as number);
		if (pending) {
			this.pendingRequests.delete(response.id as number);
			if ("error" in response) {
				pending.reject(new Error(response.error.message));
			} else {
				pending.resolve(response.result);
			}
		}
	}

	/**
	 * Handle JSON-RPC notification
	 */
	private handleNotification(notification: JsonRpcNotification): void {
		switch (notification.method) {
			case "log":
				this.emit("log", notification.params);
				break;
			case "stats":
				this.stats = notification.params as Stats;
				this.emit("stats", notification.params);
				break;
			case "session":
				this.emit("session", notification.params);
				break;
			case "fileChange":
				this.emit("fileChange", notification.params);
				break;
		}
	}

	/**
	 * Stop the core process
	 */
	async stop(): Promise<void> {
		if (this.process) {
			// Try graceful shutdown first
			try {
				await this.sendRequest("core.shutdown", {});
			} catch {
				// Ignore errors during shutdown
			}

			this.process.kill();
			this.process = null;
		}
		if (this.readline) {
			this.readline.close();
			this.readline = null;
		}
		this.running = false;
		this.pendingRequests.clear();
	}

	/**
	 * Check if core is running
	 */
	isRunning(): boolean {
		return this.running;
	}

	/**
	 * Get the HTTP port
	 */
	getHttpPort(): number {
		return this.httpPort;
	}

	/**
	 * Get current stats from core via IPC
	 */
	async getStats(): Promise<Stats> {
		return this.sendRequest<Stats>("logs.getStats", {});
	}

	/**
	 * Send JSON-RPC request and wait for response
	 */
	private async sendRequest<T>(method: string, params?: unknown): Promise<T> {
		if (!this.running || !this.process?.stdin) {
			throw new Error("Core process is not running");
		}

		const id = ++this.requestId;
		const request: JsonRpcRequest = {
			jsonrpc: "2.0",
			id,
			method,
			params: params as Record<string, unknown>,
		};

		return new Promise((resolve, reject) => {
			this.pendingRequests.set(id, {
				resolve: resolve as (result: unknown) => void,
				reject,
			});

			// Send request to core process
			this.process!.stdin!.write(JSON.stringify(request) + "\n");

			// Timeout after 30 seconds
			setTimeout(() => {
				if (this.pendingRequests.has(id)) {
					this.pendingRequests.delete(id);
					reject(new Error(`Request timeout: ${method}`));
				}
			}, 30000);
		});
	}

	// ==========================================================================
	// Public API Methods
	// ==========================================================================

	/**
	 * Get logs with optional filtering
	 */
	async getLogs(params?: {
		filter?: LogFilter;
		pagination?: PaginationOptions;
	}): Promise<{
		logs: LogEntry[];
		total: number;
		offset: number;
		limit: number;
	}> {
		return this.sendRequest("logs.getAll", params);
	}

	/**
	 * Get sessions
	 */
	async getSessions(params?: {
		status?: string;
		limit?: number;
	}): Promise<{ sessions: Session[] }> {
		return this.sendRequest("sessions.getAll", params);
	}

	/**
	 * Get pending file changes
	 */
	async getPendingChanges(params?: {
		sessionId?: string;
	}): Promise<{ changes: FileChange[] }> {
		return this.sendRequest("fileChanges.getPending", params);
	}

	/**
	 * Get diff for a change
	 */
	async getDiff(changeId: string): Promise<DiffResult> {
		return this.sendRequest("fileChanges.getDiff", { changeId });
	}

	/**
	 * Keep a change
	 */
	async keepChange(changeId: string): Promise<{ success: boolean }> {
		return this.sendRequest("fileChanges.keep", { changeId });
	}

	/**
	 * Revert a change
	 */
	async revertChange(changeId: string): Promise<{ success: boolean }> {
		return this.sendRequest("fileChanges.revert", { changeId });
	}

	/**
	 * Clear logs
	 */
	async clearLogs(filter?: LogFilter): Promise<{ success: boolean }> {
		return this.sendRequest("logs.clear", { filter });
	}

	/**
	 * Get a single session by ID
	 */
	async getSession(sessionId: string): Promise<Session | null> {
		return this.sendRequest("sessions.getById", { id: sessionId });
	}

	/**
	 * Delete a session
	 */
	async deleteSession(sessionId: string): Promise<{ success: boolean }> {
		return this.sendRequest("sessions.delete", { id: sessionId });
	}

	/**
	 * Get logs for a specific session
	 */
	async getSessionLogs(sessionId: string): Promise<{ logs: LogEntry[] }> {
		return this.sendRequest("logs.getAll", {
			filter: { sessionId },
			pagination: { limit: 500 },
		});
	}

	/**
	 * Get activity feed for a session (ordered events: prompts, responses, tools)
	 *
	 * `since` makes a poll incremental: pass back the `nextSince` from the
	 * previous response and only items created or CHANGED after it are returned.
	 * The cursor is inclusive, so the boundary items come back again — the caller
	 * must merge by `id`, keeping the version with the greater `updatedAt`. That
	 * merge is required regardless of paging, because a tool call is created by
	 * PreToolUse and updated in place when it completes.
	 *
	 * `before` walks backwards for the `truncated`/`hasMore` case: pass the
	 * oldest timestamp already held to fetch the window before it.
	 */
	async getSessionActivity(
		sessionId: string,
		options?: { since?: string; before?: string; limit?: number },
	): Promise<SessionActivityResponse> {
		return this.sendRequest("sessions.getActivity", {
			id: sessionId,
			...(options?.since ? { since: options.since } : {}),
			...(options?.before ? { before: options.before } : {}),
			...(options?.limit ? { limit: options.limit } : {}),
		});
	}


	/**
	 * Keep all pending changes
	 */
	async keepAllChanges(
		sessionId?: string,
	): Promise<{ success: boolean; count: number }> {
		return this.sendRequest("fileChanges.keepAll", { sessionId });
	}

	/**
	 * Revert all pending changes
	 */
	async revertAllChanges(
		sessionId?: string,
	): Promise<{ success: boolean; count: number }> {
		return this.sendRequest("fileChanges.revertAll", { sessionId });
	}

	/**
	 * Update change content (for inline editing)
	 */
	async updateChangeContent(
		changeId: string,
		afterContent: string,
	): Promise<{ success: boolean }> {
		return this.sendRequest("fileChanges.updateContent", {
			changeId,
			afterContent,
		});
	}

	/**
	 * Get all tracked files with version history
	 */
	async getTrackedFiles(): Promise<{
		files: Array<{
			filePath: string;
			versionCount: number;
			lastModified: string;
		}>;
	}> {
		return this.sendRequest("history.getTrackedFiles", {});
	}

	/**
	 * Get version history for a file
	 */
	async getVersionHistory(
		filePath: string,
		limit?: number,
	): Promise<{
		filePath: string;
		versions: Array<{
			versionNumber: number;
			timestamp: string;
			/**
			 * Optional, honestly: versions written before provenance was recorded
			 * do not carry it. This was declared as a required string while the
			 * core discarded the value, so every consumer saw undefined where the
			 * type promised a value.
			 */
			tool?: string;
			sessionId: string;
			content?: string;
		}>;
	}> {
		return this.sendRequest("history.getVersions", { filePath, limit });
	}

	/**
	 * Get the stored content of one version.
	 *
	 * The webview has always called this (history.js -> API.getVersionContent),
	 * and the core has always exposed `history.getVersionContent`, but the two
	 * middle links -- this method and the panel's message case -- did not exist,
	 * so opening a version in the History viewer could never load anything.
	 *
	 * Returns null when the version is not found, which the caller must still
	 * report to the webview: history.js clears its "loading" flag from the
	 * response, so swallowing a miss leaves the viewer spinning forever.
	 */
	async getVersionContent(
		filePath: string,
		versionNumber: number,
	): Promise<{
		filePath: string;
		versionNumber: number;
		content: string;
		timestamp: string;
	} | null> {
		return this.sendRequest("history.getVersionContent", {
			filePath,
			versionNumber,
		});
	}

	/**
	 * Restore a specific version of a file
	 */
	async restoreVersion(
		filePath: string,
		versionNumber: number,
	): Promise<{ success: boolean }> {
		return this.sendRequest("history.restoreVersion", {
			filePath,
			versionNumber,
		});
	}

	/**
	 * Compare two versions of a file
	 */
	async compareVersions(
		filePath: string,
		version1: number,
		version2: number | "current",
	): Promise<{
		filePath: string;
		version1: number;
		version2: number;
		diff: DiffResult;
	} | null> {
		return this.sendRequest("history.compareVersions", {
			filePath,
			version1,
			version2,
		});
	}

	/**
	 * Delete a specific version of a file
	 */
	async deleteVersion(
		filePath: string,
		versionNumber: number,
	): Promise<{ success: boolean }> {
		return this.sendRequest("history.deleteVersion", {
			filePath,
			versionNumber,
		});
	}

	/**
	 * Get archived changes
	 */
	async getArchivedChanges(params?: {
		resolution?: string;
		limit?: number;
	}): Promise<{ changes: FileChange[] }> {
		return this.sendRequest("archive.getAll", params);
	}

	/**
	 * Restore a change from archive
	 */
	async restoreArchived(changeId: string): Promise<{ success: boolean }> {
		return this.sendRequest("archive.restoreFromArchive", { changeId });
	}

	/**
	 * Get diff for an archived change
	 */
	async getArchivedDiff(changeId: string): Promise<DiffResult> {
		return this.sendRequest("archive.getDiff", { id: changeId });
	}

	// ==========================================================================
	// Event Listeners
	// ==========================================================================

	/**
	 * Subscribe to log events
	 */
	onLog(callback: (log: LogEntry) => void): void {
		this.on("log", callback);
	}

	/**
	 * Subscribe to stats updates
	 */
	onStats(callback: (stats: Stats) => void): void {
		this.on("stats", callback);
	}

	/**
	 * Subscribe to session events
	 */
	onSession(callback: (session: Session) => void): void {
		this.on("session", callback);
	}

	/**
	 * Subscribe to file change events
	 */
	onFileChange(callback: (change: FileChange) => void): void {
		this.on("fileChange", callback);
	}
}
