/**
 * Session Manager
 * Handles session tracking and management with full lifecycle support
 */

import { EventEmitter } from "node:events";
import type {
	LogEntry,
	Session,
	SessionDeleteResult,
	SessionFilter,
	SessionStats,
	SessionStatus,
	ToolExecution,
	ExecutionStatus,
} from "@inspector-hook/protocol";
import type { PersistenceStore } from "../persistence/store.js";

export interface SessionManagerOptions {
	storagePath: string;
	persistence?: PersistenceStore;
}

export interface SessionManagerStats {
	activeSessions: number;
	totalSessions: number;
}

export interface SessionManagerEvents {
	"session:created": (session: Session) => void;
	"session:ended": (session: Session) => void;
	"session:terminated": (session: Session) => void;
	"tool:started": (data: { sessionId: string; execution: ToolExecution }) => void;
	"tool:completed": (data: { sessionId: string; execution: ToolExecution }) => void;
	"tool:failed": (data: { sessionId: string; execution: ToolExecution }) => void;
	"tool:blocked": (data: { sessionId: string; execution: ToolExecution }) => void;
}

export class SessionManager extends EventEmitter {
	private sessions: Map<string, Session> = new Map();
	private options: SessionManagerOptions;
	private persistence?: PersistenceStore;

	constructor(options: SessionManagerOptions) {
		super();
		this.options = options;
		this.persistence = options.persistence;
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
	}

	/**
	 * Create a new session
	 */
	createSession(
		id: string,
		metadata?: Record<string, unknown>,
	): Session {
		const session: Session = {
			id,
			status: "active",
			startTime: new Date().toISOString(),
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
	getOrCreateSession(
		id: string,
		metadata?: Record<string, unknown>,
	): Session {
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
		const segments = cwd.split(/[/\\]/).filter(s => s);
		return segments.length > 0 ? segments[segments.length - 1] : undefined;
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
				projectName: (log.details?.projectName as string) || this.extractProjectName(cwd),
				gitBranch: log.details?.gitBranch as string | undefined,
				gitRemote: log.details?.gitRemote as string | undefined,
			});
		}

		// Handle session.start event from SessionStart hook - update metadata if needed
		if (log.event === "session.start" || log.hook === "SessionStart") {
			// Update session metadata with richer info from SessionStart hook
			if (log.details?.projectName && !session.metadata?.projectName) {
				session.metadata = {
					...session.metadata,
					projectName: log.details.projectName as string,
				};
			}
			if (log.details?.gitBranch && !session.metadata?.gitBranch) {
				session.metadata = {
					...session.metadata,
					gitBranch: log.details.gitBranch as string,
				};
			}
			if (log.details?.gitRemote && !session.metadata?.gitRemote) {
				session.metadata = {
					...session.metadata,
					gitRemote: log.details.gitRemote as string,
				};
			}
			if (cwd && !session.metadata?.workingDirectory) {
				session.metadata = {
					...session.metadata,
					workingDirectory: cwd,
					projectName: session.metadata?.projectName || this.extractProjectName(cwd),
				};
			}
		}

		// Track tool execution start (supports both tool.start and PreToolUse)
		if (log.tool && (log.event === "tool.start" || log.event === "PreToolUse")) {
			const execution: ToolExecution = {
				id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
				tool: log.tool,
				input: (log.details?.input as Record<string, unknown>) || log.details || {},
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
			if (log.details?.changeId && !session.fileChanges.includes(log.details.changeId as string)) {
				session.fileChanges.push(log.details.changeId as string);
			}
		}

		// Check for session end
		if (log.event === "session.end" || log.hook === "SessionEnd" || log.hook === "Stop") {
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
			const execution = session.toolExecutions.find((e) => e.id === executionId);
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
		if (session && session.status === "active") {
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
	 * Get all active sessions
	 */
	getActiveSessions(): Session[] {
		return Array.from(this.sessions.values()).filter(
			(s) => s.status === "active",
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

		return {
			activeSessions: active.length,
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
