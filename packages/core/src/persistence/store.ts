/**
 * Persistence Store
 * Handles saving and loading data to disk
 * Supports JSON files for structured data and JSONL for append-only logs
 */

import {
	appendFile,
	mkdir,
	readFile,
	readdir,
	rename,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface PersistenceStoreOptions {
	basePath: string;
	maxLogFileSize?: number; // Max size in bytes before rotating (default: 10MB)
	maxLogFiles?: number; // Max number of log files to keep (default: 10)
}

/**
 * Reduce an untrusted path component to a single safe segment.
 *
 * Separators and parent references are replaced rather than rejected: an id
 * that has always worked must keep resolving to the same file, and every id in
 * real use (UUIDs, and file paths already flattened to `__` by the version
 * store) contains none of these characters, so nothing existing changes.
 */
function safeSegment(value: string): string {
	return String(value)
		.replace(/\.\./g, "__")
		.replace(/[/\\]/g, "__")
		// Control characters and the characters Windows forbids in a filename.
		// biome-ignore lint/suspicious/noControlCharactersInRegex: sanitising them is the point
		.replace(/[\u0000-\u001f<>:"|?*]/g, "_");
}

/** Refuse a path that escapes the store, whatever produced it. */
function assertContained(base: string, candidate: string, original: string): string {
	const root = resolve(base);
	const target = resolve(candidate);
	if (target !== root && !target.startsWith(`${root}/`)) {
		throw new Error(
			`Refusing a path outside the store: ${original}`,
		);
	}
	return target;
}

export class PersistenceStore {
	private basePath: string;
	private maxLogFileSize: number;
	private maxLogFiles: number;
	private initialized = false;

	// Directory structure
	private readonly dirs = {
		sessions: "sessions",
		logs: "logs",
		versions: "versions",
		archives: "archives",
		changes: "changes",
		snapshots: "snapshots",
		// What survives retention. Sessions are collapsed into a summary here
		// before their raw record is deleted, so ageing out bounds storage
		// without destroying the answer to "what happened".
		summaries: "summaries",
		// The research index. Durable by design: it is built as events arrive
		// and must outlive the logs retention deletes.
		research: "research",
	};

	constructor(options: PersistenceStoreOptions) {
		this.basePath = options.basePath;
		this.maxLogFileSize = options.maxLogFileSize || 10 * 1024 * 1024; // 10MB
		this.maxLogFiles = options.maxLogFiles || 10;
	}

	/**
	 * Initialize the persistence store
	 * Creates necessary directories
	 */
	async initialize(): Promise<void> {
		if (this.initialized) return;

		// Create base directory
		if (!existsSync(this.basePath)) {
			await mkdir(this.basePath, { recursive: true });
		}

		// Create subdirectories
		for (const dir of Object.values(this.dirs)) {
			const fullPath = join(this.basePath, dir);
			if (!existsSync(fullPath)) {
				await mkdir(fullPath, { recursive: true });
			}
		}

		this.initialized = true;
	}

	/**
	 * Get the base path
	 */
	getBasePath(): string {
		return this.basePath;
	}

	// =========================================================================
	// JSON File Operations (for structured data)
	// =========================================================================

	/**
	 * Save data as a JSON file, atomically.
	 *
	 * Writes to a unique temporary file and renames it into place. rename(2) is
	 * atomic within a filesystem, so a reader either sees the whole previous
	 * document or the whole new one -- never a half-written file.
	 *
	 * This used to be a plain writeFile, which opens with O_TRUNC: two
	 * overlapping saves of the same document (or a crash mid-write) could leave
	 * a truncated, unparseable record. Session records were especially exposed,
	 * because most callers did not await the write.
	 */
	async saveJSON<T>(category: string, id: string, data: T): Promise<void> {
		await this.ensureInitialized();
		const filePath = this.getJSONPath(category, id);
		const content = JSON.stringify(data, null, 2);
		const tmpPath = `${filePath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;

		try {
			await writeFile(tmpPath, content, "utf-8");
			await rename(tmpPath, filePath);
		} catch (error) {
			await unlink(tmpPath).catch(() => {});
			// A category whose directory initialize() did not create fails with
			// ENOENT. Creating it and retrying once removes a whole class of
			// bug: adding a new category otherwise means remembering to add it
			// to `dirs`, and forgetting shows up only as a write that throws at
			// runtime, in whatever code path happened to save first.
			if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
			await mkdir(dirname(filePath), { recursive: true });
			await writeFile(tmpPath, content, "utf-8");
			await rename(tmpPath, filePath);
		}
	}

	/**
	 * Load data from JSON file
	 */
	async loadJSON<T>(category: string, id: string): Promise<T | null> {
		await this.ensureInitialized();
		const filePath = this.getJSONPath(category, id);
		try {
			const content = await readFile(filePath, "utf-8");
			return JSON.parse(content) as T;
		} catch {
			return null;
		}
	}

	/**
	 * Delete a JSON file
	 */
	async deleteJSON(category: string, id: string): Promise<boolean> {
		await this.ensureInitialized();
		const filePath = this.getJSONPath(category, id);
		try {
			await unlink(filePath);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Check if a JSON file exists
	 */
	/**
	 * Read one document synchronously.
	 *
	 * Exists for exactly one caller: `SessionManager.trackActivity`, which is
	 * synchronous and cannot await. Since sessions became bounded in memory, an
	 * event can arrive for a session that is on disk but not resident -- and
	 * auto-creating a fresh record there would overwrite the real one on the
	 * next persist. Blocking for a single file read on that rare path is a much
	 * better trade than silently replacing a session's history.
	 *
	 * Do not reach for this anywhere else; every other path can await.
	 */
	loadJSONSync<T>(category: string, id: string): T | null {
		try {
			return JSON.parse(
				readFileSync(this.getJSONPath(category, id), "utf-8"),
			) as T;
		} catch {
			return null;
		}
	}

	async existsJSON(category: string, id: string): Promise<boolean> {
		const filePath = this.getJSONPath(category, id);
		return existsSync(filePath);
	}

	/**
	 * List all JSON files in a category
	 */
	async listJSON(category: string): Promise<string[]> {
		await this.ensureInitialized();
		const dirPath = join(this.basePath, category);
		try {
			const files = await readdir(dirPath);
			return files
				.filter((f) => f.endsWith(".json"))
				.map((f) => f.replace(".json", ""));
		} catch {
			return [];
		}
	}

	/**
	 * List a category with each entry's size and last-modified time.
	 *
	 * Uses `stat`, so it costs one syscall per file and parses nothing. That
	 * distinction is the whole point: `loadAllJSON` reads and JSON-parses every
	 * document, and for sessions those run to megabytes each -- which is how the
	 * core reached 939 MB resident against a 200 MB budget, and why start took
	 * ~1,520 ms against a real store versus ~120 ms against an empty one. Both
	 * grow with history rather than levelling off.
	 *
	 * Ranking by mtime lets a caller decide WHICH documents are worth parsing
	 * without parsing all of them first to find out.
	 */
	async listJSONDetailed(
		category: string,
	): Promise<Array<{ id: string; mtimeMs: number; size: number }>> {
		const ids = await this.listJSON(category);
		const out: Array<{ id: string; mtimeMs: number; size: number }> = [];
		for (const id of ids) {
			try {
				const info = await stat(this.getJSONPath(category, id));
				out.push({ id, mtimeMs: info.mtimeMs, size: info.size });
			} catch {
				// Vanished between listing and stat; skip it.
			}
		}
		return out;
	}

	/**
	 * Load all JSON files in a category
	 */
	async loadAllJSON<T>(category: string): Promise<Map<string, T>> {
		const ids = await this.listJSON(category);
		const results = new Map<string, T>();

		for (const id of ids) {
			const data = await this.loadJSON<T>(category, id);
			if (data !== null) {
				results.set(id, data);
			}
		}

		return results;
	}

	// =========================================================================
	// JSONL (JSON Lines) Operations (for append-only logs)
	// =========================================================================

	/**
	 * Append entry to a JSONL log file
	 */
	async appendLog(filename: string, entry: unknown): Promise<void> {
		await this.ensureInitialized();
		const filePath = this.getLogPath(filename);

		// Check if rotation is needed
		await this.rotateLogIfNeeded(filename);

		const line = JSON.stringify(entry) + "\n";
		await appendFile(filePath, line, "utf-8");
	}

	/**
	 * Load all entries from a JSONL log file
	 */
	async loadLogs<T>(filename: string): Promise<T[]> {
		await this.ensureInitialized();
		const filePath = this.getLogPath(filename);
		try {
			const content = await readFile(filePath, "utf-8");
			const lines = content.trim().split("\n").filter(Boolean);
			return lines.map((line) => JSON.parse(line) as T);
		} catch {
			return [];
		}
	}

	/**
	 * Load logs with streaming (for large files)
	 * Returns an async iterator
	 */
	async *streamLogs<T>(filename: string): AsyncGenerator<T> {
		await this.ensureInitialized();
		const filePath = this.getLogPath(filename);
		try {
			const content = await readFile(filePath, "utf-8");
			const lines = content.split("\n");
			for (const line of lines) {
				if (line.trim()) {
					yield JSON.parse(line) as T;
				}
			}
		} catch {
			// File doesn't exist or is empty
		}
	}

	/**
	 * Get the count of entries in a log file
	 */
	async getLogCount(filename: string): Promise<number> {
		await this.ensureInitialized();
		const filePath = this.getLogPath(filename);
		try {
			const content = await readFile(filePath, "utf-8");
			return content.trim().split("\n").filter(Boolean).length;
		} catch {
			return 0;
		}
	}

	/**
	 * Clear a log file
	 */
	async clearLog(filename: string): Promise<void> {
		await this.ensureInitialized();
		const filePath = this.getLogPath(filename);
		try {
			await writeFile(filePath, "", "utf-8");
		} catch {
			// Ignore if file doesn't exist
		}
	}

	/**
	 * Rewrite a log file keeping only the entries a predicate accepts.
	 *
	 * A filtered clear previously touched memory only, so logs "deleted" for a
	 * session reappeared on the next restart. Filtering the file directly (rather
	 * than rewriting from the in-memory buffer) also preserves entries that were
	 * already evicted from memory by the size cap.
	 */
	async filterLog<T>(
		filename: string,
		keep: (entry: T) => boolean,
	): Promise<{ removed: number }> {
		await this.ensureInitialized();
		const entries = await this.loadLogs<T>(filename);
		const retained = entries.filter(keep);
		const removed = entries.length - retained.length;
		if (removed === 0) return { removed: 0 };

		const filePath = this.getLogPath(filename);
		const tmpPath = `${filePath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
		const body = retained.map((e) => JSON.stringify(e)).join("\n");
		try {
			await writeFile(tmpPath, retained.length ? `${body}\n` : "", "utf-8");
			await rename(tmpPath, filePath);
		} catch (error) {
			await unlink(tmpPath).catch(() => {});
			throw error;
		}
		return { removed };
	}

	/**
	 * Load the most recent entries, reading back across rotated files.
	 *
	 * loadLogs only reads the live file, which rotates at maxLogFileSize
	 * (10 MB, roughly 1,800 entries) -- while the in-memory cap is 10,000. So
	 * after any restart the buffer could never refill beyond one rotation's
	 * worth, no matter how much history was on disk. Rotated files are read
	 * newest-first until the limit is met.
	 */
	async loadRecentLogs<T>(filename: string, limit: number): Promise<T[]> {
		await this.ensureInitialized();

		const collected: T[] = await this.loadLogs<T>(filename);
		if (collected.length >= limit) return collected.slice(-limit);

		const baseName = filename.replace(/\.jsonl$/, "");
		const logDir = join(this.basePath, this.dirs.logs);
		let rotated: string[];
		try {
			rotated = (await readdir(logDir))
				.filter(
					(f) =>
						f.startsWith(`${baseName}.`) &&
						f.endsWith(".jsonl") &&
						f !== `${baseName}.jsonl`,
				)
				// Rotated names embed an ISO timestamp, so lexical order is
				// chronological; newest first.
				.sort()
				.reverse();
		} catch {
			return collected;
		}

		for (const file of rotated) {
			if (collected.length >= limit) break;
			const older = await this.loadLogs<T>(file);
			collected.unshift(...older);
		}

		return collected.slice(-limit);
	}

	/**
	 * Delete a log file
	 */
	async deleteLog(filename: string): Promise<boolean> {
		await this.ensureInitialized();
		const filePath = this.getLogPath(filename);
		try {
			await unlink(filePath);
			return true;
		} catch {
			return false;
		}
	}

	// =========================================================================
	// Version Snapshots (for file content history)
	// =========================================================================

	/**
	 * Save a version snapshot
	 */
	async saveVersion(
		filePath: string,
		versionNumber: number,
		content: string,
		metadata?: Record<string, unknown>,
	): Promise<void> {
		await this.ensureInitialized();

		// Create file-specific directory
		const safeFilePath = this.sanitizeFilePath(filePath);
		const versionDir = join(this.basePath, this.dirs.versions, safeFilePath);
		if (!existsSync(versionDir)) {
			await mkdir(versionDir, { recursive: true });
		}

		// Save content
		const contentPath = join(versionDir, `v${versionNumber}.content`);
		await writeFile(contentPath, content, "utf-8");

		// Save metadata if provided
		if (metadata) {
			const metaPath = join(versionDir, `v${versionNumber}.meta.json`);
			await writeFile(metaPath, JSON.stringify(metadata, null, 2), "utf-8");
		}
	}

	/**
	 * Load a version snapshot
	 */
	async loadVersion(
		filePath: string,
		versionNumber: number,
	): Promise<{ content: string; metadata?: Record<string, unknown> } | null> {
		await this.ensureInitialized();

		const safeFilePath = this.sanitizeFilePath(filePath);
		const versionDir = join(this.basePath, this.dirs.versions, safeFilePath);
		const contentPath = join(versionDir, `v${versionNumber}.content`);

		try {
			const content = await readFile(contentPath, "utf-8");
			let metadata: Record<string, unknown> | undefined;

			const metaPath = join(versionDir, `v${versionNumber}.meta.json`);
			try {
				const metaContent = await readFile(metaPath, "utf-8");
				metadata = JSON.parse(metaContent);
			} catch {
				// No metadata file
			}

			return { content, metadata };
		} catch {
			return null;
		}
	}

	/**
	 * List all versions for a file
	 */
	async listVersions(filePath: string): Promise<number[]> {
		await this.ensureInitialized();

		const safeFilePath = this.sanitizeFilePath(filePath);
		const versionDir = join(this.basePath, this.dirs.versions, safeFilePath);

		try {
			const files = await readdir(versionDir);
			const versions = files
				.filter((f) => f.endsWith(".content"))
				.map((f) => parseInt(f.replace("v", "").replace(".content", "")))
				.filter((n) => !isNaN(n))
				.sort((a, b) => a - b);
			return versions;
		} catch {
			return [];
		}
	}

	/**
	 * Delete a version
	 */
	async deleteVersion(filePath: string, versionNumber: number): Promise<boolean> {
		await this.ensureInitialized();

		const safeFilePath = this.sanitizeFilePath(filePath);
		const versionDir = join(this.basePath, this.dirs.versions, safeFilePath);
		const contentPath = join(versionDir, `v${versionNumber}.content`);
		const metaPath = join(versionDir, `v${versionNumber}.meta.json`);

		let deleted = false;
		try {
			await unlink(contentPath);
			deleted = true;
		} catch {
			// Ignore
		}
		try {
			await unlink(metaPath);
		} catch {
			// Ignore
		}

		return deleted;
	}

	// =========================================================================
	// Utility Methods
	// =========================================================================

	/**
	 * Get storage statistics
	 */
	async getStats(): Promise<{
		totalSize: number;
		sessionCount: number;
		logCount: number;
		versionCount: number;
		archiveCount: number;
	}> {
		await this.ensureInitialized();

		const sessionCount = (await this.listJSON(this.dirs.sessions)).length;
		const archiveCount = (await this.listJSON(this.dirs.archives)).length;

		// Count log entries
		let logCount = 0;
		const logFiles = await this.listLogFiles();
		for (const file of logFiles) {
			logCount += await this.getLogCount(file);
		}

		// Count versions
		let versionCount = 0;
		const versionDir = join(this.basePath, this.dirs.versions);
		try {
			const fileDirs = await readdir(versionDir);
			for (const dir of fileDirs) {
				const versions = await this.listVersions(dir);
				versionCount += versions.length;
			}
		} catch {
			// Versions directory might not exist
		}

		// Calculate total size (approximate)
		const totalSize = await this.calculateDirSize(this.basePath);

		return {
			totalSize,
			sessionCount,
			logCount,
			versionCount,
			archiveCount,
		};
	}

	/**
	 * Clean up old data
	 */
	/**
	 * Delete data older than maxAgeMs.
	 *
	 * This was a stub returning zeros, which is why `logRetentionDays` had no
	 * effect: the setting was read from the environment, passed through three
	 * layers, and never acted on. Nothing was ever deleted for being old — the
	 * only bounds on growth were an in-memory cap and size-triggered rotation.
	 *
	 * Age is taken from record content where available (a log entry's timestamp,
	 * a session's last activity) and from file mtime otherwise, because a
	 * rotated log's name encodes its rotation time, not its contents' age.
	 */
	async cleanup(options?: {
		maxAgeMs?: number;
		keepMinVersions?: number;
		/**
		 * Collapse an expiring session into something durable BEFORE its raw
		 * record is deleted.
		 *
		 * Retention was shipped as the destructive half of a two-part design:
		 * the plan pairs "drop raw rows" with "collapse to session summaries
		 * first", and only the dropping existed. Without this, ageing out is
		 * indistinguishable from data loss.
		 *
		 * Returning false, or throwing, CANCELS the delete for that session.
		 * Preserving is the point; pruning something we failed to preserve
		 * would be worse than leaving it on disk.
		 */
		collapseSession?: (
			id: string,
			session: unknown,
		) => Promise<boolean> | boolean;
	}): Promise<{
		deletedFiles: number;
		freedBytes: number;
		collapsed: number;
		collapseFailures: number;
	}> {
		await this.ensureInitialized();

		const maxAgeMs = options?.maxAgeMs;
		if (!maxAgeMs || maxAgeMs <= 0) {
			return { deletedFiles: 0, freedBytes: 0, collapsed: 0, collapseFailures: 0 };
		}

		const cutoffMs = Date.now() - maxAgeMs;
		const cutoffIso = new Date(cutoffMs).toISOString();
		let deletedFiles = 0;
		let freedBytes = 0;
		let collapsed = 0;
		let collapseFailures = 0;

		// 1. Rotated log files whose newest entry predates the cutoff.
		const logDir = join(this.basePath, this.dirs.logs);
		let logFiles: string[] = [];
		try {
			logFiles = await readdir(logDir);
		} catch {
			logFiles = [];
		}

		for (const file of logFiles) {
			if (!file.endsWith(".jsonl")) continue;
			// Never touch a live log by name; it is pruned line-by-line below.
			if (!/\.\d{4}-\d{2}-\d{2}T[\d-]+\.jsonl$/.test(file)) continue;

			const full = join(logDir, file);
			try {
				const info = await stat(full);
				if (info.mtimeMs >= cutoffMs) continue;
				freedBytes += info.size;
				await unlink(full);
				deletedFiles++;
			} catch {
				// Raced with something else; nothing to do.
			}
		}

		// 2. Prune old entries from every live log, keeping newer ones.
		for (const file of logFiles) {
			if (!file.endsWith(".jsonl")) continue;
			if (/\.\d{4}-\d{2}-\d{2}T[\d-]+\.jsonl$/.test(file)) continue;
			const name = file.replace(/\.jsonl$/, "");
			const before = await stat(join(logDir, file)).then(
				(i) => i.size,
				() => 0,
			);
			const { removed } = await this.filterLog<{ timestamp?: string }>(
				name,
				(entry) =>
					typeof entry?.timestamp !== "string" || entry.timestamp >= cutoffIso,
			);
			if (removed > 0) {
				const after = await stat(join(logDir, file)).then(
					(i) => i.size,
					() => 0,
				);
				freedBytes += Math.max(0, before - after);
			}
		}

		// 3. Sessions whose last activity predates the cutoff, and the archived
		//    changes belonging to them. Pending changes are deliberately NOT
		//    aged out: they are awaiting a human decision, and silently
		//    discarding one would lose work.
		const sessions = await this.loadAllJSON<{
			id?: string;
			startTime?: string;
			lastActivityTime?: string;
			endTime?: string;
		}>(this.dirs.sessions);

		const expiredSessionIds = new Set<string>();
		for (const [id, session] of sessions) {
			const last =
				session?.lastActivityTime ?? session?.endTime ?? session?.startTime;
			if (typeof last !== "string" || last >= cutoffIso) continue;

			// Preserve before pruning. A session that cannot be collapsed is
			// left alone: storage stays bounded by everything else that expires,
			// and the alternative is deleting the only copy of something we
			// undertook to summarise.
			if (options?.collapseSession) {
				let preserved = false;
				try {
					preserved = (await options.collapseSession(id, session)) !== false;
				} catch {
					preserved = false;
				}
				if (!preserved) {
					collapseFailures++;
					continue;
				}
				collapsed++;
			}

			const path = this.getJSONPath(this.dirs.sessions, id);
			try {
				freedBytes += (await stat(path)).size;
			} catch {
				// size unknown; the delete still counts
			}
			if (await this.deleteJSON(this.dirs.sessions, id)) {
				deletedFiles++;
				expiredSessionIds.add(id);
			}
		}

		const archives = await this.loadAllJSON<{
			sessionId?: string;
			archivedAt?: string;
		}>(this.dirs.archives);
		for (const [id, archive] of archives) {
			const tooOld =
				typeof archive?.archivedAt === "string" && archive.archivedAt < cutoffIso;
			const orphaned =
				typeof archive?.sessionId === "string" &&
				expiredSessionIds.has(archive.sessionId);
			if (!tooOld && !orphaned) continue;
			const path = this.getJSONPath(this.dirs.archives, id);
			try {
				freedBytes += (await stat(path)).size;
			} catch {
				// as above
			}
			if (await this.deleteJSON(this.dirs.archives, id)) deletedFiles++;
		}

		return { deletedFiles, freedBytes, collapsed, collapseFailures };
	}

	// =========================================================================
	// Private Methods
	// =========================================================================

	private async ensureInitialized(): Promise<void> {
		if (!this.initialized) {
			await this.initialize();
		}
	}

	/**
	 * Path for one JSON record, contained to the store.
	 *
	 * SECURITY: this used to join the id raw. Ids reach it straight from the
	 * ingest payload — session-manager saves under the `sessionId` a hook sent —
	 * so posting `{"sessionId": "../../evil"}` to the local ingest endpoint
	 * wrote a JSON file anywhere the core process could write. Confirmed
	 * end-to-end against a running core before this fix, not inferred.
	 *
	 * The endpoint binds to 127.0.0.1 and rejects browser origins, so this was
	 * reachable only by a local process — but "only local" is the threat model
	 * for a tool that indexes local development, not an exemption from it.
	 *
	 * Two defences, deliberately both: segments are sanitised, AND the resolved
	 * path is checked to fall under the base. The first is what should hold; the
	 * second is what catches an encoding or platform case the first missed.
	 */
	private getJSONPath(category: string, id: string): string {
		const path = join(
			this.basePath,
			safeSegment(category),
			`${safeSegment(id)}.json`,
		);
		return assertContained(this.basePath, path, `${category}/${id}`);
	}

	private getLogPath(filename: string): string {
		const base = safeSegment(filename);
		const name = base.endsWith(".jsonl") ? base : `${base}.jsonl`;
		return assertContained(
			this.basePath,
			join(this.basePath, this.dirs.logs, name),
			filename,
		);
	}

	private sanitizeFilePath(filePath: string): string {
		// Replace path separators and special chars with safe alternatives
		return filePath
			.replace(/[\/\\]/g, "__")
			.replace(/[<>:"|?*]/g, "_")
			.replace(/\.\./g, "__");
	}

	private async listLogFiles(): Promise<string[]> {
		const logDir = join(this.basePath, this.dirs.logs);
		try {
			const files = await readdir(logDir);
			return files.filter((f) => f.endsWith(".jsonl"));
		} catch {
			return [];
		}
	}

	private async rotateLogIfNeeded(filename: string): Promise<void> {
		const filePath = this.getLogPath(filename);
		try {
			const stats = await stat(filePath);
			if (stats.size >= this.maxLogFileSize) {
				await this.rotateLog(filename);
			}
		} catch {
			// File doesn't exist yet
		}
	}

	private async rotateLog(filename: string): Promise<void> {
		const logDir = join(this.basePath, this.dirs.logs);
		const baseName = filename.replace(".jsonl", "");

		// Find existing rotated files
		const files = await readdir(logDir);
		const rotatedFiles = files
			.filter((f) => f.startsWith(baseName) && f.includes("."))
			.sort()
			.reverse();

		// Delete oldest if we have too many
		while (rotatedFiles.length >= this.maxLogFiles) {
			const oldFile = rotatedFiles.pop()!;
			await unlink(join(logDir, oldFile));
		}

		// Rename current file with timestamp
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const newName = `${baseName}.${timestamp}.jsonl`;
		const currentPath = this.getLogPath(filename);
		const newPath = join(logDir, newName);

		try {
			await rename(currentPath, newPath);
		} catch {
			// Ignore if file doesn't exist
		}
	}

	private async calculateDirSize(dirPath: string): Promise<number> {
		let totalSize = 0;
		try {
			const entries = await readdir(dirPath, { withFileTypes: true });
			for (const entry of entries) {
				const fullPath = join(dirPath, entry.name);
				if (entry.isDirectory()) {
					totalSize += await this.calculateDirSize(fullPath);
				} else {
					const stats = await stat(fullPath);
					totalSize += stats.size;
				}
			}
		} catch {
			// Ignore errors
		}
		return totalSize;
	}
}
