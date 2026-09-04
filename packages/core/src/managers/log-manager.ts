/**
 * Log Manager
 * Handles log storage, retrieval, and statistics with persistence
 */

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type {
	LogClearResult,
	LogEntry,
	LogFilter,
	PaginationOptions,
	SortOptions,
} from "@inspector-hook/protocol";
import type { PersistenceStore } from "../persistence/store.js";
import { resolveProject } from "./project-resolver.js";

export interface LogManagerOptions {
	storagePath: string;
	maxLogsInMemory: number;
	retentionDays: number;
	/**
	 * Called for each session about to be aged out, so it can be preserved in a
	 * durable form first. Returning false cancels that session's deletion.
	 */
	collapseSession?: (id: string, session: unknown) => Promise<boolean> | boolean;
	persistence?: PersistenceStore;
}

export interface LogManagerStats {
	totalLogs: number;
	errors: number;
	warnings: number;
	blocked: number;
	logsPerMinute: number;
}

export interface LogManagerEvents {
	"log:added": (log: LogEntry) => void;
	"log:error": (log: LogEntry) => void;
	"log:warning": (log: LogEntry) => void;
	"log:blocked": (log: LogEntry) => void;
}

/**
 * Read the effort level.
 *
 * The shipped hook flattens `.effort.level` to a string before sending, but the
 * native payload nests it under `{ level }`. Accepting both means a raw
 * forwarder -- an HTTP hook posting the payload unchanged, which is where M2 is
 * headed -- does not silently store an object in a string field.
 */
function readEffort(
	data: Record<string, unknown>,
	details: Record<string, unknown>,
): string | undefined {
	for (const candidate of [data.effort, details.effort]) {
		if (typeof candidate === "string" && candidate) return candidate;
		if (candidate && typeof candidate === "object") {
			const level = (candidate as { level?: unknown }).level;
			if (typeof level === "string" && level) return level;
		}
	}
	return undefined;
}

export class LogManager extends EventEmitter {
	private logs: LogEntry[] = [];
	private options: LogManagerOptions;
	private persistence?: PersistenceStore;
	private logsLastMinute: number[] = [];
	private cleanupInterval?: ReturnType<typeof setInterval>;

	constructor(options: LogManagerOptions) {
		super();
		this.options = options;
		this.persistence = options.persistence;

		// Clean up old rate tracking entries every minute.
		// unref() so this housekeeping timer never keeps the process (or a test
		// run) alive on its own -- it is bookkeeping, not work worth waiting for.
		this.cleanupInterval = setInterval(() => {
			const cutoff = Date.now() - 60000;
			this.logsLastMinute = this.logsLastMinute.filter((t) => t > cutoff);
			// Retention is cheap when nothing has expired, so it rides along on
			// the same timer rather than adding another.
			void this.enforceRetention().catch(() => {});
		}, 60000);
		this.cleanupInterval.unref?.();
	}


	/**
	 * Load logs from persistence
	 */
	async load(): Promise<void> {
		if (!this.persistence) return;

		try {
			// loadRecentLogs reads back across rotated files. loadLogs only read
			// the live file, which rotates at 10 MB (~1,800 entries) while the
			// memory cap is 10,000 -- so after a restart the buffer could never
			// refill beyond a single rotation's worth of history.
			this.logs = await this.persistence.loadRecentLogs<LogEntry>(
				"activity",
				this.options.maxLogsInMemory,
			);
		} catch {
			// No logs to load or file doesn't exist
		}

		// Apply retention to what we just loaded, so a restart does not
		// resurrect data the policy says should be gone.
		await this.enforceRetention();
	}

	/**
	 * Add a new log entry
	 */
	async addLog(
		data: Partial<LogEntry> & Record<string, unknown>,
	): Promise<LogEntry> {
		// Build details object, merging existing details with toolInput/toolResponse
		// The hook script sends toolInput and toolResponse at root level
		const details: Record<string, unknown> = {};

		// Copy existing details if present
		if (data.details && typeof data.details === "object") {
			Object.assign(details, data.details);
		}

		// Capture toolInput/toolResponse from hook scripts
		// Map to tool_input/tool_result for consistency with logs view
		if ((data as Record<string, unknown>).toolInput) {
			details.tool_input = (data as Record<string, unknown>).toolInput;
		}
		if ((data as Record<string, unknown>).toolResponse) {
			details.tool_result = (data as Record<string, unknown>).toolResponse;
		}
		// Also capture raw input if present
		if ((data as Record<string, unknown>).rawInput) {
			details.rawInput = (data as Record<string, unknown>).rawInput;
		}

		// Restore the project metadata the hook stopped sending.
		//
		// M2's hook consolidation removed the `git -C` and package.json reads
		// that produced gitBranch/gitRemote/projectName, because they were most
		// of the 337ms per-event cost — and removed the fields with them
		// unnoticed. Measured after the fact: 0 of 1752 recent events carried
		// them where 1610 of 4325 older ones did.
		//
		// Derived here instead, from the `cwd` every event already carries. The
		// hook pays nothing, the result is cached per directory, and it resolves
		// to the REPOSITORY ROOT — which is what stops one repo fragmenting into
		// five projectKeys, as it had in the live index.
		//
		// A value the payload already carries always wins: a producer that knows
		// its own project must not be overridden by our inference.
		const project = resolveProject(details.cwd);
		if (project) {
			if (!details.projectName) details.projectName = project.projectName;
			if (!details.gitBranch && project.gitBranch) {
				details.gitBranch = project.gitBranch;
			}
			if (!details.gitRemote && project.gitRemote) {
				details.gitRemote = project.gitRemote;
			}
		}

		const log: LogEntry = {
			id: randomUUID(),
			// Preserve original timestamp from hooks if provided
			timestamp: data.timestamp || new Date().toISOString(),
			hook: data.hook || "unknown",
			event: data.event || "unknown",
			level: data.level || "info",
			message: data.message || "",
			sessionId: data.sessionId,
			tool: data.tool,
			file: data.file,
			// Correlates PreToolUse with PostToolUse. Claude Code supplies
			// `tool_use_id` natively on both events, which is exact even for
			// parallel calls to the same tool; `executionId` is the legacy field
			// name accepted for hooks that still send it.
			executionId: ((data as Record<string, unknown>).tool_use_id ||
				(data as Record<string, unknown>).executionId) as string | undefined,
			// Groups every event in one user turn. The hook was already sending
			// this and nothing read it, so turn grouping had to be inferred from
			// prompt boundaries -- which collapses a whole session into one turn
			// whenever prompts were logged before the field existed.
			promptId: ((data as Record<string, unknown>).prompt_id ||
				(data as Record<string, unknown>).promptId) as string | undefined,
			// Both forwarded by the hook since M2 and read by nothing until now.
			// Accepted under either the native snake_case name or the camelCase
			// one the hook emits, because the hook renames them on the way out.
			permissionMode: ((data as Record<string, unknown>).permission_mode ||
				(data as Record<string, unknown>).permissionMode ||
				details.permissionMode) as string | undefined,
			effort: readEffort(data, details),
			details: Object.keys(details).length > 0 ? details : undefined,
		};

		// Add to in-memory store
		this.logs.push(log);

		// Trim if exceeding max
		if (this.logs.length > this.options.maxLogsInMemory) {
			this.logs = this.logs.slice(-this.options.maxLogsInMemory);
		}

		// Track rate
		this.logsLastMinute.push(Date.now());

		// Emit events
		this.emit("log:added", log);
		if (log.level === "error") {
			this.emit("log:error", log);
		} else if (log.level === "warn") {
			this.emit("log:warning", log);
		} else if (log.level === "blocked") {
			this.emit("log:blocked", log);
		}

		// Persist to JSONL log file
		if (this.persistence) {
			await this.persistence.appendLog("activity", log);
		}

		return log;
	}

	/**
	 * Get logs with optional filtering
	 */
	async getLogs(params?: {
		filter?: LogFilter;
		pagination?: PaginationOptions;
		sort?: SortOptions;
	}): Promise<{
		logs: LogEntry[];
		total: number;
		offset: number;
		limit: number;
	}> {
		let filtered = [...this.logs];

		// Apply filters
		if (params?.filter) {
			const f = params.filter;
			if (f.sessionId)
				filtered = filtered.filter((l) => l.sessionId === f.sessionId);
			if (f.hook) filtered = filtered.filter((l) => l.hook === f.hook);
			if (f.event) filtered = filtered.filter((l) => l.event === f.event);
			if (f.level) {
				const levels = Array.isArray(f.level) ? f.level : [f.level];
				filtered = filtered.filter((l) => levels.includes(l.level));
			}
			if (f.tool) filtered = filtered.filter((l) => l.tool === f.tool);
			if (f.file) filtered = filtered.filter((l) => l.file === f.file);
			if (f.search) {
				const search = f.search.toLowerCase();
				filtered = filtered.filter((l) =>
					l.message.toLowerCase().includes(search),
				);
			}
			if (f.startTime)
				filtered = filtered.filter((l) => l.timestamp >= f.startTime!);
			if (f.endTime)
				filtered = filtered.filter((l) => l.timestamp <= f.endTime!);
		}

		// Apply sorting
		if (params?.sort) {
			const { field, order } = params.sort;
			filtered.sort((a, b) => {
				const aVal = (a as unknown as Record<string, unknown>)[field];
				const bVal = (b as unknown as Record<string, unknown>)[field];
				const cmp = String(aVal).localeCompare(String(bVal));
				return order === "asc" ? cmp : -cmp;
			});
		} else {
			// Default: newest first
			filtered.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
		}

		// Apply pagination
		const total = filtered.length;
		const offset = params?.pagination?.offset || 0;
		const limit = params?.pagination?.limit || 100;
		const paginated = filtered.slice(offset, offset + limit);

		return { logs: paginated, total, offset, limit };
	}

	/**
	 * Get a single log by ID
	 */
	async getLogById(id: string): Promise<LogEntry | null> {
		return this.logs.find((l) => l.id === id) || null;
	}

	/**
	 * Clear logs with optional filter
	 */
	async clear(filter?: LogFilter): Promise<LogClearResult> {
		const before = this.logs.length;

		// One predicate drives both the in-memory buffer and the file, so they
		// cannot disagree. Previously a filtered clear touched memory only, and
		// the "deleted" logs reappeared on the next restart.
		const keep = (l: LogEntry): boolean => {
			if (!filter) return false;
			if (filter.sessionId && l.sessionId === filter.sessionId) return false;
			if (filter.olderThan && l.timestamp < filter.olderThan) return false;
			return true;
		};

		this.logs = filter ? this.logs.filter(keep) : [];

		if (this.persistence) {
			if (filter) {
				await this.persistence.filterLog<LogEntry>("activity", keep);
			} else {
				await this.persistence.clearLog("activity");
			}
		}

		return {
			success: true,
			cleared: before - this.logs.length,
			clearedAt: new Date().toISOString(),
		};
	}

	/**
	 * Drop in-memory entries older than the configured retention window, and
	 * ask the store to prune what it holds.
	 *
	 * `retentionDays` was previously read from the environment, threaded through
	 * three layers, stored on this object, and never used again — so the setting
	 * was decoration. This makes it mean what it says.
	 *
	 * Returns 0 immediately when retention is disabled (0 or negative), which is
	 * how a user opts into keeping everything.
	 */
	async enforceRetention(): Promise<{ removed: number }> {
		const days = this.options.retentionDays;
		if (!days || days <= 0) return { removed: 0 };

		const maxAgeMs = days * 24 * 60 * 60 * 1000;
		const cutoff = new Date(Date.now() - maxAgeMs).toISOString();

		const before = this.logs.length;
		// An entry with an unparseable timestamp is kept: it cannot be aged, and
		// silently discarding data is the worse failure.
		this.logs = this.logs.filter(
			(l) => typeof l.timestamp !== "string" || l.timestamp >= cutoff,
		);
		const removed = before - this.logs.length;

		if (this.persistence) {
			// The collapse hook is supplied by the core, which owns the session
			// data and the digest builder. LogManager only forwards it: it runs
			// the retention timer, but it must not be the thing that decides
			// what a preserved session looks like.
			await this.persistence.cleanup({
				maxAgeMs,
				collapseSession: this.options.collapseSession,
			});
		}

		return { removed };
	}

	/**
	 * Get statistics
	 */
	getStats(): LogManagerStats {
		const errors = this.logs.filter((l) => l.level === "error").length;
		const warnings = this.logs.filter((l) => l.level === "warn").length;
		const blocked = this.logs.filter((l) => l.level === "blocked").length;

		return {
			totalLogs: this.logs.length,
			errors,
			warnings,
			blocked,
			logsPerMinute: this.logsLastMinute.length,
		};
	}

	/**
	 * Flush pending changes to disk
	 * Note: Logs are already persisted on each add, so this is mostly a no-op
	 */
	async flush(): Promise<void> {
		// Logs are appended immediately, nothing to flush
	}

	/**
	 * Cleanup resources
	 */
	destroy(): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
		}
	}
}
