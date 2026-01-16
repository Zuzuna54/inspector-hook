/**
 * Main Inspector Hook Core class
 * Orchestrates all components
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
import { HttpServer } from "./server/http-server.js";

export class InspectorCore {
	private httpServer: HttpServer;
	private ipcServer: IpcServer;
	private logManager: LogManager;
	private sessionManager: SessionManager;
	private fileTracker: FileTracker;

	private startTime: number = 0;
	private status: CoreStatus["status"] = "starting";
	private config: CoreConfig;

	constructor(params: CoreInitParams) {
		this.config = params.config;

		// Initialize managers
		this.logManager = new LogManager({
			storagePath: params.storagePath,
			maxLogsInMemory: params.config.maxLogsInMemory,
			retentionDays: params.config.logRetentionDays,
		});

		this.sessionManager = new SessionManager({
			storagePath: params.storagePath,
		});

		this.fileTracker = new FileTracker({
			workspaceRoot: params.workspaceRoot,
			storagePath: params.storagePath,
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
	}

	/**
	 * Start the core process
	 */
	async start(): Promise<void> {
		this.startTime = Date.now();
		this.status = "starting";

		try {
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

			this.status = "running"; // Process will exit after this
		} catch (error) {
			this.status = "error";
			throw error;
		}
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
			httpPort: this.config.httpPort,
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
}
