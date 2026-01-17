/**
 * Core Bridge
 * Communication between VS Code extension and Core process
 * Uses JSON-RPC 2.0 over stdio
 */

import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { createInterface, type Interface } from "node:readline";
import type {
	DiffResult,
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
	storagePath: string;
	httpPort: number;
	wsPort: number;
	extensionPath?: string;
}

type ResponseCallback = {
	resolve: (result: unknown) => void;
	reject: (error: Error) => void;
};

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
	}

	/**
	 * Start the core process
	 */
	async start(): Promise<void> {
		if (this.running) {
			console.log("[CoreBridge] Already running, skipping start");
			return;
		}

		console.log("[CoreBridge] Starting core process...");

		return new Promise((resolve, reject) => {
			// Find the core CLI
			const corePath = this.findCorePath();
			console.log("[CoreBridge] Core path:", corePath);

			// Spawn the core process
			this.process = spawn("node", [corePath], {
				stdio: ["pipe", "pipe", "pipe"],
				env: {
					...process.env,
					INSPECTOR_HOOK_WORKSPACE: this.options.storagePath,
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
					console.log("[CoreBridge] stderr:", msg.trim());
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
							console.log("[CoreBridge] Core process ready on port", this.httpPort);
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
	 * Keep all pending changes
	 */
	async keepAllChanges(sessionId?: string): Promise<{ success: boolean; count: number }> {
		return this.sendRequest("fileChanges.keepAll", { sessionId });
	}

	/**
	 * Revert all pending changes
	 */
	async revertAllChanges(sessionId?: string): Promise<{ success: boolean; count: number }> {
		return this.sendRequest("fileChanges.revertAll", { sessionId });
	}

	/**
	 * Get version history for a file
	 */
	async getVersionHistory(filePath: string, limit?: number): Promise<{
		filePath: string;
		versions: Array<{
			versionNumber: number;
			timestamp: string;
			tool: string;
			sessionId: string;
			content?: string;
		}>;
	}> {
		return this.sendRequest("history.getVersions", { filePath, limit });
	}

	/**
	 * Restore a specific version of a file
	 */
	async restoreVersion(filePath: string, versionNumber: number): Promise<{ success: boolean }> {
		return this.sendRequest("history.restoreVersion", { filePath, versionNumber });
	}

	/**
	 * Compare two versions of a file
	 */
	async compareVersions(filePath: string, version1: number, version2: number | 'current'): Promise<DiffResult> {
		return this.sendRequest("history.compareVersions", { filePath, version1, version2 });
	}

	/**
	 * Get archived changes
	 */
	async getArchivedChanges(params?: { resolution?: string; limit?: number }): Promise<{ changes: FileChange[] }> {
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
