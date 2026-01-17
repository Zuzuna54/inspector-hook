/**
 * IPC Server for wrapper communication
 * Uses JSON-RPC 2.0 over stdio
 */

import { createInterface, type Interface } from "node:readline";
import type {
	ErrorCode,
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
		this.methods.set("sessions.delete", async (params) =>
			this.sessionManager.delete(
				(params as any).id,
				(params as any).deleteAssociatedData,
			),
		);
		this.methods.set("sessions.clear", async (params) =>
			this.sessionManager.clear(
				(params as any).filter,
				(params as any).deleteAssociatedData,
			),
		);
		this.methods.set("sessions.getStats", async (params) =>
			this.sessionManager.getSessionStats((params as any).id),
		);

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
