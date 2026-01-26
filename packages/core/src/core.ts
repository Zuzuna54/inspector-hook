/**
 * Main Inspector Hook Core class
 * Orchestrates all components with persistence and event handling
 */

import type {
	CoreConfig,
	CoreInitParams,
	CoreStatus,
	Stats,
} from "@inspector-hook/protocol";
import { VERSION } from "./index.js";
import { IpcServer } from "./ipc/ipc-server.js";
import { FileTracker } from "./managers/file-tracker.js";
import { LogManager } from "./managers/log-manager.js";
import { SessionManager } from "./managers/session-manager.js";
import { PersistenceStore } from "./persistence/store.js";
import { HttpServer } from "./server/http-server.js";

export class InspectorCore {
	private httpServer: HttpServer;
	private ipcServer: IpcServer;
	private logManager: LogManager;
	private sessionManager: SessionManager;
	private fileTracker: FileTracker;
	private persistence: PersistenceStore;

	private startTime: number = 0;
	private status: CoreStatus["status"] = "starting";
	private config: CoreConfig;
	private storagePath: string;

	constructor(params: CoreInitParams) {
		this.config = params.config;
		this.storagePath = params.storagePath;

		// Initialize persistence store
		this.persistence = new PersistenceStore({
			basePath: params.storagePath,
			maxLogFileSize: 10 * 1024 * 1024, // 10MB
			maxLogFiles: 10,
		});

		// Initialize managers with persistence support
		this.logManager = new LogManager({
			storagePath: params.storagePath,
			maxLogsInMemory: params.config.maxLogsInMemory,
			retentionDays: params.config.logRetentionDays,
			persistence: this.persistence,
		});

		this.sessionManager = new SessionManager({
			storagePath: params.storagePath,
			persistence: this.persistence,
		});

		this.fileTracker = new FileTracker({
			workspaceRoot: params.workspaceRoot,
			storagePath: params.storagePath,
			persistence: this.persistence,
		});

		// Initialize servers
		this.httpServer = new HttpServer({
			port: params.config.httpPort,
			logManager: this.logManager,
			sessionManager: this.sessionManager,
			fileTracker: this.fileTracker,
		});

		this.ipcServer = new IpcServer({
			logManager: this.logManager,
			sessionManager: this.sessionManager,
			fileTracker: this.fileTracker,
			core: this,
		});

		// Wire up events for cross-manager communication
		this.setupEventHandlers();
	}

	/**
	 * Set up event handlers for cross-manager communication
	 */
	private setupEventHandlers(): void {
		// When a new log is added, broadcast to VS Code for live updates
		this.logManager.on("log:added", (log) => {
			this.ipcServer.sendNotification("log", log);
		});

		// Broadcast stats updates periodically (every new log triggers stats update)
		this.logManager.on("log:added", () => {
			this.ipcServer.sendNotification("stats", this.getStats());
		});

		// When a session is created, broadcast to VS Code
		// Note: We don't log session.start here - the SessionStart hook already does that
		this.sessionManager.on("session:created", (session) => {
			this.ipcServer.sendNotification("session", session);
		});

		// When a session ends, log it and broadcast
		this.sessionManager.on("session:ended", (session) => {
			this.logManager.addLog({
				hook: "SessionManager",
				timestamp: new Date().toISOString(),
				level: "info",
				message: `Session ended: ${session.id}`,
				sessionId: session.id,
				event: "session.end",
			});
			// Broadcast session event to VS Code
			this.ipcServer.sendNotification("session", session);
		});

		// When a session goes idle, log it and broadcast
		this.sessionManager.on("session:idle", (session) => {
			this.logManager.addLog({
				hook: "SessionManager",
				timestamp: new Date().toISOString(),
				level: "info",
				message: `Session went idle: ${session.id}`,
				sessionId: session.id,
				event: "session.idle",
			});
			// Broadcast session event to VS Code for real-time status update
			this.ipcServer.sendNotification("session", session);
		});

		// When a session is terminated, log it and broadcast
		this.sessionManager.on("session:terminated", (session) => {
			this.logManager.addLog({
				hook: "SessionManager",
				timestamp: new Date().toISOString(),
				level: "info",
				message: `Session terminated: ${session.id}`,
				sessionId: session.id,
				event: "session.terminated",
			});
			// Broadcast session event to VS Code
			this.ipcServer.sendNotification("session", session);
		});

		// When a tool starts, capture file content before changes
		this.sessionManager.on("tool:started", async ({ sessionId, execution }) => {
			if (
				execution.affectedFiles &&
				(execution.tool === "Edit" || execution.tool === "Write")
			) {
				for (const filePath of execution.affectedFiles) {
					await this.fileTracker.captureBeforeContent(
						filePath,
						sessionId,
						execution.tool,
					);
				}
			}
		});

		// When a tool completes, track the file change
		this.sessionManager.on(
			"tool:completed",
			async ({ sessionId, execution }) => {
				if (
					execution.affectedFiles &&
					(execution.tool === "Edit" || execution.tool === "Write")
				) {
					for (const filePath of execution.affectedFiles) {
						const change = await this.fileTracker.trackFromLog({
							id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
							timestamp: execution.endTime || new Date().toISOString(),
							level: "info",
							hook: "ToolEnd",
							message: `File modified: ${filePath}`,
							sessionId,
							tool: execution.tool,
							file: filePath,
							event: "tool.end",
						});

						if (change) {
							// Link the change to the session
							this.sessionManager.addFileChange(sessionId, change.id);
						}
					}
				}
			},
		);

		// When a file change is tracked, broadcast via IPC
		this.fileTracker.on("change:tracked", (change) => {
			// Use "fileChange" method which core-bridge expects
			this.ipcServer.sendNotification("fileChange", change);
		});

		// When a change is kept, broadcast
		this.fileTracker.on("change:kept", (change) => {
			this.ipcServer.sendNotification("fileChange", {
				...change,
				eventType: "kept",
			});
		});

		// When a change is reverted, broadcast
		this.fileTracker.on("change:reverted", (change) => {
			this.ipcServer.sendNotification("fileChange", {
				...change,
				eventType: "reverted",
			});
		});

		// When a version is created, broadcast
		this.fileTracker.on("version:created", ({ filePath, version }) => {
			this.ipcServer.sendNotification("fileChange", {
				eventType: "version:created",
				filePath,
				versionNumber: version.versionNumber,
			});
		});
	}

	/**
	 * Start the core process
	 */
	async start(): Promise<void> {
		this.startTime = Date.now();
		this.status = "starting";

		try {
			// Initialize persistence first
			await this.persistence.initialize();

			// Load persisted data
			await this.sessionManager.load();
			await this.fileTracker.load();
			await this.logManager.load();

			// Start HTTP server for hook ingestion
			await this.httpServer.start();

			// Start IPC server for wrapper communication
			await this.ipcServer.start();

			this.status = "running";
		} catch (error) {
			this.status = "error";
			throw error;
		}
	}

	/**
	 * Stop the core process
	 */
	async stop(): Promise<void> {
		this.status = "stopping";

		try {
			await this.httpServer.stop();
			await this.ipcServer.stop();

			// Persist any pending data
			await this.logManager.flush();
			await this.sessionManager.flush();
			await this.fileTracker.flush();

			this.status = "running"; // Process will exit after this
		} catch (error) {
			this.status = "error";
			throw error;
		}
	}

	/**
	 * Get actual HTTP port (may differ from config if port 0 was used)
	 */
	getHttpPort(): number {
		return this.httpServer.getPort();
	}

	/**
	 * Get current status
	 */
	getStatus(): CoreStatus {
		return {
			status: this.status,
			uptime:
				this.startTime > 0
					? Math.floor((Date.now() - this.startTime) / 1000)
					: 0,
			httpPort: this.httpServer.getPort(),
			wsPort: this.config.wsPort,
			stats: this.getStats(),
			version: VERSION,
		};
	}

	/**
	 * Get current statistics
	 */
	getStats(): Stats {
		const logStats = this.logManager.getStats();
		const sessionStats = this.sessionManager.getStats();
		const fileStats = this.fileTracker.getStats();

		return {
			totalLogs: logStats.totalLogs,
			errors: logStats.errors,
			warnings: logStats.warnings,
			blocked: logStats.blocked,
			logsPerMinute: logStats.logsPerMinute,
			activeSessions: sessionStats.activeSessions,
			pendingChanges: fileStats.pendingChanges,
		};
	}

	/**
	 * Get log manager instance
	 */
	getLogManager(): LogManager {
		return this.logManager;
	}

	/**
	 * Get session manager instance
	 */
	getSessionManager(): SessionManager {
		return this.sessionManager;
	}

	/**
	 * Get file tracker instance
	 */
	getFileTracker(): FileTracker {
		return this.fileTracker;
	}

	/**
	 * Get persistence store instance
	 */
	getPersistence(): PersistenceStore {
		return this.persistence;
	}
}
