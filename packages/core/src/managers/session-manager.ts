/**
 * Session Manager
 * Handles session tracking and management with full lifecycle support
 */

import { EventEmitter } from "node:events";
import type {
	ExecutionStatus,
	LogEntry,
	Session,
	SessionDeleteResult,
	SessionFilter,
	SessionStats,
	SessionStatus,
	ToolExecution,
} from "@inspector-hook/protocol";
import type { PersistenceStore } from "../persistence/store.js";

export interface SessionManagerOptions {
	storagePath: string;
	persistence?: PersistenceStore;
	/** Time in milliseconds before marking active session as idle (default: 30 minutes) */
	idleTimeoutMs?: number;
	/** Time in milliseconds before marking idle session as completed (default: 2 hours) */
	completedTimeoutMs?: number;
}

export interface SessionManagerStats {
	activeSessions: number;
	totalSessions: number;
}

export interface SessionManagerEvents {
	"session:created": (session: Session) => void;
	"session:ended": (session: Session) => void;
	"session:idle": (session: Session) => void;
	"session:terminated": (session: Session) => void;
	"tool:started": (data: {
		sessionId: string;
		execution: ToolExecution;
	}) => void;
	"tool:completed": (data: {
		sessionId: string;
		execution: ToolExecution;
	}) => void;
	"tool:failed": (data: {
		sessionId: string;
		execution: ToolExecution;
	}) => void;
	"tool:blocked": (data: {
		sessionId: string;
		execution: ToolExecution;
	}) => void;
}

// Default timeout values
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_COMPLETED_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours
const STALE_CHECK_INTERVAL_MS = 60 * 1000; // Check every minute

export class SessionManager extends EventEmitter {
	private sessions: Map<string, Session> = new Map();
	private options: SessionManagerOptions;
	private persistence?: PersistenceStore;
	private staleCheckInterval: NodeJS.Timeout | null = null;
	private idleTimeoutMs: number;
	private completedTimeoutMs: number;

	constructor(options: SessionManagerOptions) {
		super();
		this.options = options;
		this.persistence = options.persistence;
		this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
		this.completedTimeoutMs =
			options.completedTimeoutMs ?? DEFAULT_COMPLETED_TIMEOUT_MS;
	}

	/**
	 * Set the persistence store after construction
	 */
	setPersistence(persistence: PersistenceStore): void {
		this.persistence = persistence;
	}

	/**
	 * Load sessions from persistence
	 */
	async load(): Promise<void> {
		if (!this.persistence) return;

		const sessions = await this.persistence.loadAllJSON<Session>("sessions");
		for (const [id, session] of sessions) {
			this.sessions.set(id, session);
		}

		// Start the stale session check interval
		this.startStaleSessionCheck();

		// Immediately check for stale sessions on load
		await this.checkStaleSessions();
	}

	/**
	 * Start the interval to check for stale sessions
	 */
	startStaleSessionCheck(): void {
		if (this.staleCheckInterval) return;

		this.staleCheckInterval = setInterval(() => {
			this.checkStaleSessions();
		}, STALE_CHECK_INTERVAL_MS);
	}

	/**
	 * Stop the stale session check interval
	 */
	stopStaleSessionCheck(): void {
		if (this.staleCheckInterval) {
			clearInterval(this.staleCheckInterval);
			this.staleCheckInterval = null;
		}
	}

	/**
	 * Check for stale sessions and update their status
	 * - Active sessions with no activity for idleTimeoutMs become "idle"
	 * - Idle sessions with no activity for completedTimeoutMs become "completed"
	 */
	async checkStaleSessions(): Promise<void> {
		const now = Date.now();

		for (const session of this.sessions.values()) {
			// Skip already completed/terminated/error sessions
			if (
				session.status === "completed" ||
				session.status === "terminated" ||
				session.status === "error"
			) {
				continue;
			}

			// Get the last activity time (or fall back to start time)
			const lastActivity = session.lastActivityTime || session.startTime;
			const lastActivityTime = new Date(lastActivity).getTime();
			const timeSinceActivity = now - lastActivityTime;

			if (session.status === "active") {
				// Check if active session should become idle
				if (timeSinceActivity >= this.idleTimeoutMs) {
					session.status = "idle";
					this.emit("session:idle", session);
					await this.persistSession(session);
				}
			} else if (session.status === "idle") {
				// Check if idle session should become completed
				if (timeSinceActivity >= this.completedTimeoutMs) {
					session.status = "completed";
					session.endTime = new Date().toISOString();
					this.emit("session:ended", session);
					await this.persistSession(session);
				}
			}
		}
	}

	/**
	 * Reactivate a session when new activity is detected
	 * Handles idle, completed, and terminated sessions
	 */
	private reactivateSession(session: Session): void {
		// Reactivate idle or completed sessions (but not error/terminated which are intentional endings)
		if (session.status === "idle" || session.status === "completed") {
			const wasCompleted = session.status === "completed";
			session.status = "active";
			// Clear endTime since session is active again
			if (wasCompleted) {
				session.endTime = undefined;
			}
			// Note: We don't emit session:created here since it's a reactivation
		}
	}

	/**
	 * Create a new session
	 */
	createSession(id: string, metadata?: Record<string, unknown>): Session {
		const now = new Date().toISOString();
		const session: Session = {
			id,
			name: this.deriveSessionName(metadata),
			status: "active",
			startTime: now,
			lastActivityTime: now,
			toolExecutions: [],
			fileChanges: [],
			metadata,
		};

		this.sessions.set(id, session);
		this.emit("session:created", session);
		this.persistSession(session);

		return session;
	}

	/**
	 * Get or create a session
	 */
	getOrCreateSession(id: string, metadata?: Record<string, unknown>): Session {
		let session = this.sessions.get(id);
		if (!session) {
			session = this.createSession(id, metadata);
		}
		return session;
	}

	/**
	 * Extract project name from a path
	 * @param cwd - working directory path
	 * @returns project name (last segment of path)
	 */
	private extractProjectName(cwd: string | undefined): string | undefined {
		if (!cwd) return undefined;
		// Get the last non-empty segment of the path
		const segments = cwd.split(/[/\\]/).filter((s) => s);
		return segments.length > 0 ? segments[segments.length - 1] : undefined;
	}

	/**
	 * Derive session name from metadata
	 * Priority: projectName > folder from workingDirectory
	 * @param metadata - session metadata
	 * @returns derived session name or undefined
	 */
	private deriveSessionName(
		metadata?: Record<string, unknown>,
	): string | undefined {
		if (!metadata) return undefined;

		// First try explicit projectName
		if (metadata.projectName && typeof metadata.projectName === "string") {
			return metadata.projectName;
		}

		// Then try to extract from workingDirectory
		if (
			metadata.workingDirectory &&
			typeof metadata.workingDirectory === "string"
		) {
			return this.extractProjectName(metadata.workingDirectory);
		}

		return undefined;
	}

	/**
	 * Track activity from a log entry
	 */
	trackActivity(sessionId: string, log: LogEntry): void {
		let session = this.sessions.get(sessionId);
		const cwd = log.details?.cwd as string | undefined;

		if (!session) {
			// Create new session with metadata extracted from the log entry
			session = this.createSession(sessionId, {
				workingDirectory: cwd,
				projectName:
					(log.details?.projectName as string) || this.extractProjectName(cwd),
				gitBranch: log.details?.gitBranch as string | undefined,
				gitRemote: log.details?.gitRemote as string | undefined,
			});
		}

		// Update last activity time and reactivate idle sessions
		session.lastActivityTime = log.timestamp || new Date().toISOString();
		this.reactivateSession(session);

		// Handle session.start event from SessionStart hook - ALWAYS update metadata
		// SessionStart provides the most accurate session info (project name, git branch, etc.)
		if (log.event === "session.start" || log.hook === "SessionStart") {
			// Always update session metadata with SessionStart info (overwrites previous values)
			const newMetadata: Record<string, unknown> = { ...session.metadata };

			if (log.details?.projectName) {
				newMetadata.projectName = log.details.projectName as string;
			}
			if (log.details?.gitBranch) {
				newMetadata.gitBranch = log.details.gitBranch as string;
			}
			if (log.details?.gitRemote) {
				newMetadata.gitRemote = log.details.gitRemote as string;
			}
			if (cwd) {
				newMetadata.workingDirectory = cwd;
				// Only set projectName from cwd if not already set by projectName field
				if (!log.details?.projectName) {
					newMetadata.projectName = this.extractProjectName(cwd);
				}
			}

			session.metadata = newMetadata;

			// Update session.name based on updated metadata
			session.name = this.deriveSessionName(newMetadata);
		}

		// Track tool execution start (supports both tool.start and PreToolUse)
		if (
			log.tool &&
			(log.event === "tool.start" || log.event === "PreToolUse")
		) {
			const execution: ToolExecution = {
				id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
				tool: log.tool,
				input:
					(log.details?.input as Record<string, unknown>) || log.details || {},
				startTime: log.timestamp,
				status: "running",
				affectedFiles: log.file ? [log.file] : undefined,
			};
			session.toolExecutions.push(execution);
			this.emit("tool:started", { sessionId, execution });
		}

		// Update tool execution on completion (supports both tool.end and PostToolUse)
		if (log.tool && (log.event === "tool.end" || log.event === "PostToolUse")) {
			const exec = session.toolExecutions.find(
				(e) => e.tool === log.tool && e.status === "running",
			);
			if (exec) {
				exec.endTime = log.timestamp;
				exec.status = log.level === "error" ? "failed" : "completed";
				exec.result = log.details;

				if (exec.status === "completed") {
					this.emit("tool:completed", { sessionId, execution: exec });
				} else {
					this.emit("tool:failed", { sessionId, execution: exec });
				}
			}
		}

		// Track blocked operations
		if (log.level === "blocked") {
			const exec = session.toolExecutions.find(
				(e) => e.tool === log.tool && e.status === "running",
			);
			if (exec) {
				exec.status = "blocked";
				exec.error = log.message;
				this.emit("tool:blocked", { sessionId, execution: exec });
			}
		}

		// Track file changes
		if (log.file && (log.tool === "Edit" || log.tool === "Write")) {
			if (
				log.details?.changeId &&
				!session.fileChanges.includes(log.details.changeId as string)
			) {
				session.fileChanges.push(log.details.changeId as string);
			}
		}

		// Check for session end
		if (
			log.event === "session.end" ||
			log.hook === "SessionEnd" ||
			log.hook === "Stop"
		) {
			session.status = "completed";
			session.endTime = log.timestamp;
			this.emit("session:ended", session);
		}

		this.persistSession(session);
	}

	/**
	 * Add a file change ID to a session
	 */
	addFileChange(sessionId: string, changeId: string): void {
		const session = this.sessions.get(sessionId);
		if (session && !session.fileChanges.includes(changeId)) {
			session.fileChanges.push(changeId);
			this.persistSession(session);
		}
	}

	/**
	 * Add a tool execution to a session
	 */
	addToolExecution(sessionId: string, execution: ToolExecution): void {
		const session = this.sessions.get(sessionId);
		if (session) {
			session.toolExecutions.push(execution);
			this.emit("tool:started", { sessionId, execution });
			this.persistSession(session);
		}
	}

	/**
	 * Complete a tool execution
	 */
	completeToolExecution(
		sessionId: string,
		executionId: string,
		result: unknown,
		status: ExecutionStatus = "completed",
	): void {
		const session = this.sessions.get(sessionId);
		if (session) {
			const execution = session.toolExecutions.find(
				(e) => e.id === executionId,
			);
			if (execution) {
				execution.endTime = new Date().toISOString();
				execution.status = status;
				execution.result = result;

				if (status === "completed") {
					this.emit("tool:completed", { sessionId, execution });
				} else if (status === "failed") {
					this.emit("tool:failed", { sessionId, execution });
				} else if (status === "blocked") {
					this.emit("tool:blocked", { sessionId, execution });
				}

				this.persistSession(session);
			}
		}
	}

	/**
	 * End a session
	 */
	endSession(id: string): void {
		const session = this.sessions.get(id);
		if (session && (session.status === "active" || session.status === "idle")) {
			session.status = "completed";
			session.endTime = new Date().toISOString();
			this.emit("session:ended", session);
			this.persistSession(session);
		}
	}

	/**
	 * Get all sessions with optional filtering
	 */
	async getSessions(params?: {
		status?: SessionStatus;
		limit?: number;
	}): Promise<{ sessions: Session[] }> {
		let sessions = Array.from(this.sessions.values());

		if (params?.status) {
			sessions = sessions.filter((s) => s.status === params.status);
		}

		// Sort by start time, newest first
		sessions.sort((a, b) => b.startTime.localeCompare(a.startTime));

		if (params?.limit) {
			sessions = sessions.slice(0, params.limit);
		}

		return { sessions };
	}

	/**
	 * Get all active sessions (includes both "active" and "idle" status)
	 */
	getActiveSessions(): Session[] {
		return Array.from(this.sessions.values()).filter(
			(s) => s.status === "active" || s.status === "idle",
		);
	}

	/**
	 * Get a single session by ID
	 */
	async getSession(id: string): Promise<Session | null> {
		return this.sessions.get(id) || null;
	}

	/**
	 * Terminate an active session
	 */
	async terminate(
		id: string,
		reason?: string,
	): Promise<{ success: boolean; terminatedAt: string }> {
		const session = this.sessions.get(id);
		if (!session) {
			throw new Error(`Session not found: ${id}`);
		}

		session.status = "terminated";
		session.endTime = new Date().toISOString();
		if (reason) {
			session.metadata = { ...session.metadata, terminationReason: reason };
		}

		this.emit("session:terminated", session);
		this.persistSession(session);

		return {
			success: true,
			terminatedAt: session.endTime,
		};
	}

	/**
	 * Delete a session
	 */
	async delete(
		id: string,
		deleteAssociatedData?: boolean,
	): Promise<SessionDeleteResult> {
		const session = this.sessions.get(id);
		if (!session) {
			throw new Error(`Session not found: ${id}`);
		}

		this.sessions.delete(id);

		// Delete from persistence
		if (this.persistence) {
			await this.persistence.deleteJSON("sessions", id);
		}

		return {
			success: true,
			deletedSessions: 1,
			deletedLogs: 0, // TODO: Delete associated logs if requested
			deletedFileChanges: deleteAssociatedData ? session.fileChanges.length : 0,
			deletedAt: new Date().toISOString(),
		};
	}

	/**
	 * Clear sessions with filter
	 */
	async clear(
		filter?: SessionFilter,
		deleteAssociatedData?: boolean,
	): Promise<SessionDeleteResult> {
		const toDelete: string[] = [];

		for (const [id, session] of this.sessions) {
			let shouldDelete = true;

			if (filter?.status) {
				const statuses = Array.isArray(filter.status)
					? filter.status
					: [filter.status];
				shouldDelete = statuses.includes(session.status);
			}
			if (filter?.olderThan && shouldDelete) {
				shouldDelete = session.startTime < filter.olderThan;
			}

			if (shouldDelete) {
				toDelete.push(id);
			}
		}

		for (const id of toDelete) {
			this.sessions.delete(id);
			if (this.persistence) {
				await this.persistence.deleteJSON("sessions", id);
			}
		}

		return {
			success: true,
			deletedSessions: toDelete.length,
			clearedAt: new Date().toISOString(),
		};
	}

	/**
	 * Get statistics for a specific session
	 */
	async getSessionStats(id: string): Promise<SessionStats> {
		const session = this.sessions.get(id);
		if (!session) {
			throw new Error(`Session not found: ${id}`);
		}

		const duration = session.endTime
			? new Date(session.endTime).getTime() -
				new Date(session.startTime).getTime()
			: Date.now() - new Date(session.startTime).getTime();

		const executions = session.toolExecutions;

		return {
			sessionId: id,
			status: session.status,
			duration: Math.floor(duration / 1000),
			logCount: 0, // TODO: Count actual logs
			toolExecutions: executions.length,
			fileChangesCount: session.fileChanges.length,
			errors: executions.filter((e) => e.status === "failed").length,
			warnings: 0,
			blocked: executions.filter((e) => e.status === "blocked").length,
		};
	}

	/**
	 * Get overall statistics
	 */
	getStats(): SessionManagerStats {
		const sessions = Array.from(this.sessions.values());
		const active = sessions.filter((s) => s.status === "active");
		const idle = sessions.filter((s) => s.status === "idle");

		return {
			activeSessions: active.length + idle.length, // Count both active and idle as "active"
			totalSessions: sessions.length,
		};
	}

	/**
	 * Flush pending changes to disk
	 */
	async flush(): Promise<void> {
		if (!this.persistence) return;

		for (const [id, session] of this.sessions) {
			await this.persistence.saveJSON("sessions", id, session);
		}
	}

	/**
	 * Persist a single session
	 */
	private async persistSession(session: Session): Promise<void> {
		if (this.persistence) {
			await this.persistence.saveJSON("sessions", session.id, session);
		}
	}
}
