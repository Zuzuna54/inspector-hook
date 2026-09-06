/**
 * Main Inspector Hook Core class
 * Orchestrates all components with persistence and event handling
 */

import type {
	CoreConfig,
	CoreInitParams,
	CoreStatus,
	Session,
	SessionSummaryRecord,
	Stats,
} from "@inspector-hook/protocol";
import { VERSION } from "./index.js";
import { IpcServer } from "./ipc/ipc-server.js";
import { FileTracker } from "./managers/file-tracker.js";
import { LogManager } from "./managers/log-manager.js";
import { SessionManager } from "./managers/session-manager.js";
import { collectDigestInput } from "./memory/digest-input.js";
import { resolveMemoryDir, writeMemoryFile } from "./memory/native-memory.js";
import { buildSessionDigest } from "./memory/session-digest.js";
import { migrateStore } from "./persistence/migrations.js";
import { PersistenceStore } from "./persistence/store.js";
import { ResearchIndex } from "./research/research-index.js";
import { HttpServer } from "./server/http-server.js";

export class InspectorCore {
	private httpServer: HttpServer;
	private ipcServer: IpcServer;
	private logManager: LogManager;
	private sessionManager: SessionManager;
	private fileTracker: FileTracker;
	private persistence: PersistenceStore;
	private researchIndex: ResearchIndex;

	/**
	 * Periodic index flush.
	 *
	 * Without it the index is written only on a clean shutdown, so a crash or a
	 * kill loses everything indexed since start — and the index is the thing
	 * that is supposed to outlive the logs. unref'd so it cannot hold the
	 * process open, which is the leaked-timer bug this branch already fixed once.
	 */
	private researchFlushInterval?: NodeJS.Timeout;

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
			// Retention must preserve before it prunes. Bound as a method so the
			// managers it needs are the ones on this instance.
			collapseSession: (id, session) => this.collapseSession(id, session),
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

		// Research history index (M4). Built as events arrive and persisted
		// separately from the logs, because retention deletes those and the
		// index has to outlive them.
		this.researchIndex = new ResearchIndex({
			persistence: this.persistence,
			workspaceRoot: params.workspaceRoot,
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
			storagePath: params.storagePath,
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

		// Index anything research-shaped as it arrives. Most entries yield
		// nothing, which is the normal case; the call is a cheap field check.
		this.logManager.on("log:added", (log) => {
			this.researchIndex.ingest(log);
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

			// Milestone 3: record what happened into Claude Code's own memory,
			// so the next session in this project loads it with no injection
			// hook of ours involved. Off unless explicitly enabled.
			void this.writeSessionMemory(session);
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

		// NOTE: file capture/tracking is deliberately NOT wired to the
		// "tool:started"/"tool:completed" session events. HttpServer.handleLogPost
		// already drives captureBeforeContent on PreToolUse and trackFromLog on
		// PostToolUse. Doing it here as well raced that path: trackActivity emits
		// these events synchronously, the async handler yielded at its first await,
		// and both readers saw the same entry in the shared pendingCaptures map
		// before either deleted it -- producing two FileChange records per edit.
		// The HTTP ingest path is the single source of truth for file tracking.

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

			// Repair any records left by previously-fixed bugs before the managers
			// read them into memory.
			const migration = await migrateStore(this.storagePath);
			if (migration.applied.length > 0) {
				process.stderr.write(
					`[Migration] ${migration.fromVersion} -> ${migration.toVersion}: ${
						migration.notes.join("; ") || "no changes needed"
					}\n`,
				);
			}

			// Load persisted data
			await this.sessionManager.load();
			await this.fileTracker.load();
			await this.logManager.load();

			// Restore the research index, and adopt an existing store on first
			// run: everything captured before the index existed is still in the
			// log, and re-reading it once beats telling a user their history
			// starts today.
			const restored = await this.researchIndex.load();
			if (restored.items === 0) {
				const { logs } = await this.logManager.getLogs({
					pagination: { limit: 100_000, offset: 0 },
				});
				const built = this.researchIndex.backfill(logs);
				if (built.indexed > 0) {
					process.stderr.write(
						`[Research] indexed ${built.indexed} items from ${built.scanned} existing logs\n`,
					);
					await this.researchIndex.flush();
				}
			} else if (restored.rebuilt) {
				process.stderr.write(
					`[Research] index was inconsistent with its items; rebuilt ${restored.items}\n`,
				);
				await this.researchIndex.flush();
			}

			// Start HTTP server for hook ingestion
			await this.httpServer.start();

			// Start IPC server for wrapper communication
			await this.ipcServer.start();

			this.researchFlushInterval = setInterval(
				() => {
					void this.researchIndex.flush().catch(() => {});
				},
				5 * 60 * 1000,
			);
			this.researchFlushInterval.unref?.();

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

			// Release the managers' housekeeping timers. Without this the process
			// stays alive after a shutdown request, because both intervals were
			// created and never cleared.
			this.sessionManager.stopStaleSessionCheck();
			this.logManager.destroy();
			if (this.researchFlushInterval) {
				clearInterval(this.researchFlushInterval);
				this.researchFlushInterval = undefined;
			}

			// Persist any pending data
			await this.researchIndex.flush();
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
			stats: this.getStats(),
			version: VERSION,
			writeSessionMemory: this.config.writeSessionMemory === true,
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
	 * Collapse an expiring session into a durable summary.
	 *
	 * Retention shipped as the destructive half of a two-part design: the plan
	 * pairs dropping raw rows with collapsing to session summaries first, and
	 * only the dropping existed. So ageing out deleted the only record of a
	 * session, and any memory digest citing it became unresolvable — which the
	 * corpus already shows happening for Claude Code's own memory, where 0 of
	 * 11 cited sessions still exist anywhere.
	 *
	 * The summary is the same digest the memory path uses, stored in the store
	 * rather than in the user's memory corpus: this is Inspector Hook's own
	 * record, written without asking, so it does not belong in files that shape
	 * what future Claude sessions are told.
	 *
	 * Returns false on failure, which cancels that session's deletion. A
	 * session we could not preserve is worth more on disk than freed.
	 */
	/**
	 * Everything a digest is built from, for either path here.
	 *
	 * Both callers used to pass a bare session, which silently produced a
	 * thinner digest than the one the panel showed for the same session. One
	 * collector means there is no longer a "which path built this" question to
	 * get wrong.
	 */
	private async digestInputFor(session: Session) {
		return collectDigestInput({
			session,
			logs: this.logManager,
			changes: this.fileTracker,
		});
	}

	private async collapseSession(
		id: string,
		session: unknown,
	): Promise<boolean> {
		try {
			const record = session as Session | undefined;
			if (!record || typeof record !== "object") return false;

			// The full input, not a bare session. This is the retention path: its
			// whole purpose is to preserve value before the raw data is deleted,
			// so it must not write the weakest of the three digests. It used to
			// -- the summary that survives permanently said "N changes (paths
			// unresolved)" and carried no counts, while the preview you can
			// regenerate any time got the good one. Exactly backwards.
			const digest = buildSessionDigest(await this.digestInputFor(record));
			const summary: SessionSummaryRecord = {
				id,
				collapsedAt: new Date().toISOString(),
				startTime: record.startTime,
				endTime: record.endTime,
				status: record.status,
				name: record.name,
				metadata: record.metadata,
				toolExecutionCount: Array.isArray(record.toolExecutions)
					? record.toolExecutions.length
					: 0,
				fileChangeCount: Array.isArray(record.fileChanges)
					? record.fileChanges.length
					: 0,
				// Even a session judged not worth a MEMORY entry gets a summary
				// here: the bar for "keep a record" is far lower than the bar for
				// "tell a future Claude about it".
				description: digest.description,
				digest: digest.worthKeeping ? digest.body : undefined,
			};

			await this.persistence.saveJSON("summaries", id, summary);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Write a session digest into native auto memory.
	 *
	 * Never throws into the event emitter: a failure here must not take down
	 * session bookkeeping, and it must not fail silently either -- every
	 * outcome, including a refusal, is logged with its reason. This is the part
	 * of the system most able to make a false claim ("saved to memory" when
	 * nothing was written), so it reports what actually happened.
	 */
	private async writeSessionMemory(session: Session): Promise<void> {
		if (!this.config.writeSessionMemory) return;

		try {
			const digest = buildSessionDigest(await this.digestInputFor(session));
			if (!digest.worthKeeping) {
				this.logManager.addLog({
					hook: "SessionMemory",
					timestamp: new Date().toISOString(),
					level: "info",
					message: `No memory written for ${session.id}: ${digest.skipReason}`,
					sessionId: session.id,
					event: "memory.skipped",
				});
				return;
			}

			const memoryDir = resolveMemoryDir(session.metadata?.transcriptPath);
			const result = await writeMemoryFile(memoryDir, digest);

			this.logManager.addLog({
				hook: "SessionMemory",
				timestamp: new Date().toISOString(),
				level: result.written ? "info" : "warn",
				message: result.written
					? `Wrote session memory to ${result.path}`
					: `Session memory not written: ${result.reason ?? result.refused}`,
				sessionId: session.id,
				event: result.written ? "memory.written" : "memory.refused",
			});
		} catch (error) {
			this.logManager.addLog({
				hook: "SessionMemory",
				timestamp: new Date().toISOString(),
				level: "error",
				message: `Session memory failed: ${
					error instanceof Error ? error.message : String(error)
				}`,
				sessionId: session.id,
				event: "memory.error",
			});
		}
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
	 * Get the research index
	 */
	getResearchIndex(): ResearchIndex {
		return this.researchIndex;
	}

	/**
	 * Get persistence store instance
	 */
	getPersistence(): PersistenceStore {
		return this.persistence;
	}
}
