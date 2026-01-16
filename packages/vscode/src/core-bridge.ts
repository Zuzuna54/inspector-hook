/**
 * Core Bridge
 * Communication between VS Code extension and Core process
 * Uses JSON-RPC 2.0 over stdio
 */

import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
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

export interface CoreBridgeOptions {
	storagePath: string;
	httpPort: number;
	wsPort: number;
}

type Callback = (result: any, error?: any) => void;

export class CoreBridge extends EventEmitter {
	private process: ChildProcess | null = null;
	private readline: Interface | null = null;
	private options: CoreBridgeOptions;
	private requestId = 0;
	private pendingRequests: Map<number, Callback> = new Map();
	private stats: Stats | null = null;
	private running = false;

	constructor(options: CoreBridgeOptions) {
		super();
		this.options = options;
	}

	/**
	 * Start the core process
	 */
	async start(): Promise<void> {
		if (this.running) return;

		// TODO: In production, spawn the actual core process
		// For now, we'll use a mock implementation
		this.running = true;
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
	 * Stop the core process
	 */
	async stop(): Promise<void> {
		if (this.process) {
			this.process.kill();
			this.process = null;
		}
		if (this.readline) {
			this.readline.close();
			this.readline = null;
		}
		this.running = false;
	}

	/**
	 * Check if core is running
	 */
	isRunning(): boolean {
		return this.running;
	}

	/**
	 * Get current stats
	 */
	getStats(): Stats | null {
		return this.stats;
	}

	/**
	 * Send JSON-RPC request and wait for response
	 */
	private async sendRequest<T>(method: string, params?: unknown): Promise<T> {
		if (!this.running) {
			throw new Error("Core process is not running");
		}

		// Mock implementation for now
		return this.mockRequest<T>(method, params);
	}

	/**
	 * Mock request handler for development
	 */
	private async mockRequest<T>(method: string, params?: unknown): Promise<T> {
		switch (method) {
			case "logs.getAll":
				return { logs: [], total: 0, offset: 0, limit: 100 } as T;

			case "sessions.getAll":
				return { sessions: [] } as T;

			case "fileChanges.getPending":
				return { changes: [] } as T;

			case "fileChanges.getDiff":
				return {
					beforeContent: "",
					afterContent: "",
					hunks: [],
					additions: 0,
					deletions: 0,
				} as T;

			case "fileChanges.keep":
			case "fileChanges.revert":
				return { success: true } as T;

			case "logs.clear":
				return {
					success: true,
					cleared: 0,
					clearedAt: new Date().toISOString(),
				} as T;

			default:
				return {} as T;
		}
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
