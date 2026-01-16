/**
 * Session Manager
 * Handles session tracking and management
 */

import type {
	LogEntry,
	Session,
	SessionDeleteResult,
	SessionFilter,
	SessionStats,
	SessionStatus,
} from "@inspector-hook/protocol";

export interface SessionManagerOptions {
	storagePath: string;
}

export interface SessionManagerStats {
	activeSessions: number;
	totalSessions: number;
}

export class SessionManager {
	private sessions: Map<string, Session> = new Map();
	private options: SessionManagerOptions;

	constructor(options: SessionManagerOptions) {
		this.options = options;
	}

	/**
	 * Track activity from a log entry
	 */
	trackActivity(sessionId: string, log: LogEntry): void {
		let session = this.sessions.get(sessionId);

		if (!session) {
			// Create new session
			session = {
				id: sessionId,
				status: "active",
				startTime: log.timestamp,
				toolExecutions: [],
				fileChanges: [],
			};
			this.sessions.set(sessionId, session);
		}

		// Track tool execution
		if (log.tool && log.event === "tool.start") {
			session.toolExecutions.push({
				id: `exec-${Date.now()}`,
				tool: log.tool,
				input: log.details || {},
				startTime: log.timestamp,
				status: "running",
			});
		}

		// Update tool execution on completion
		if (log.tool && log.event === "tool.end") {
			const exec = session.toolExecutions.find(
				(e) => e.tool === log.tool && e.status === "running",
			);
			if (exec) {
				exec.endTime = log.timestamp;
				exec.status = log.level === "error" ? "failed" : "completed";
				exec.result = log.details;
			}
		}

		// Check for session end
		if (log.event === "session.end" || log.hook === "SessionEnd") {
			session.status = "completed";
			session.endTime = log.timestamp;
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

		return {
			sessionId: id,
			status: session.status,
			duration: Math.floor(duration / 1000),
			logCount: 0, // TODO: Count actual logs
			toolExecutions: session.toolExecutions.length,
			fileChangesCount: session.fileChanges.length,
			errors: session.toolExecutions.filter((e) => e.status === "failed")
				.length,
			warnings: 0,
			blocked: session.toolExecutions.filter((e) => e.status === "blocked")
				.length,
		};
	}

	/**
	 * Get overall statistics
	 */
	getStats(): SessionManagerStats {
		const active = Array.from(this.sessions.values()).filter(
			(s) => s.status === "active",
		);

		return {
			activeSessions: active.length,
			totalSessions: this.sessions.size,
		};
	}

	/**
	 * Flush pending changes to disk
	 */
	async flush(): Promise<void> {
		// TODO: Persist to disk
	}
}
