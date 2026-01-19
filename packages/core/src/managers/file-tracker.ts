/**
 * File Tracker
 * Handles file change tracking, version history, and archive management
 * With content capture, DiffEngine integration, and persistence
 */

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import type {
	ArchiveDeleteResult,
	ArchivedChange,
	ArchiveFilter,
	ArchiveStats,
	DiffResult,
	FileChange,
	FileChangeDeleteResult,
	FileChangeFilter,
	FileChangeStatus,
	FileSnapshot,
	FileVersion,
	HistoryDeleteResult,
	HistoryFilter,
	HistoryStats,
	LogEntry,
	PaginationOptions,
	SortOptions,
	VersionHistory,
} from "@inspector-hook/protocol";
import type { PersistenceStore } from "../persistence/store.js";
import { DiffEngine } from "./diff-engine.js";

export interface FileTrackerOptions {
	workspaceRoot: string;
	storagePath: string;
	persistence?: PersistenceStore;
	maxVersionsPerFile?: number;
}

export interface FileTrackerStats {
	pendingChanges: number;
	archivedChanges: number;
	trackedFiles: number;
}

export interface FileTrackerEvents {
	"change:tracked": (change: FileChange) => void;
	"change:kept": (change: FileChange) => void;
	"change:reverted": (change: FileChange) => void;
	"change:deleted": (changeId: string) => void;
	"version:created": (data: { filePath: string; version: FileVersion }) => void;
	"version:restored": (data: { filePath: string; version: number }) => void;
	"archive:added": (archived: ArchivedChange) => void;
	"archive:restored": (archived: ArchivedChange) => void;
	"archive:deleted": (archiveId: string) => void;
}

// Track pending content capture for Edit/Write operations
interface PendingCapture {
	filePath: string;
	sessionId: string;
	tool: string;
	beforeContent: string;
	capturedAt: string;
}

export class FileTracker extends EventEmitter {
	private changes: Map<string, FileChange> = new Map();
	private archived: Map<string, ArchivedChange> = new Map();
	private history: Map<string, VersionHistory> = new Map();
	private pendingCaptures: Map<string, PendingCapture> = new Map();
	/** Tracked file snapshots (keyed by file path) - used by captureSnapshot/detectChange */
	private trackedFiles: Map<string, FileSnapshot> = new Map();
	private options: FileTrackerOptions;
	private persistence?: PersistenceStore;
	private diffEngine: DiffEngine;
	private maxVersionsPerFile: number;

	constructor(options: FileTrackerOptions) {
		super();
		this.options = options;
		this.persistence = options.persistence;
		this.diffEngine = new DiffEngine();
		this.maxVersionsPerFile = options.maxVersionsPerFile || 50;
	}

	/**
	 * Set persistence store after construction
	 */
	setPersistence(persistence: PersistenceStore): void {
		this.persistence = persistence;
	}

	/**
	 * Load data from persistence
	 */
	async load(): Promise<void> {
		if (!this.persistence) return;

		// Load changes
		const changes = await this.persistence.loadAllJSON<FileChange>("changes");
		for (const [id, change] of changes) {
			this.changes.set(id, change);
		}

		// Load archived changes
		const archived =
			await this.persistence.loadAllJSON<ArchivedChange>("archives");
		for (const [id, archive] of archived) {
			this.archived.set(id, archive);
		}

		// Load version histories
		const histories =
			await this.persistence.loadAllJSON<VersionHistory>("versions");
		for (const [, history] of histories) {
			this.history.set(history.filePath, history);
		}
	}

	// =========================================================================
	// Phase 2 Spec Methods (captureSnapshot / detectChange)
	// These provide a simpler API where only the file path is needed
	// =========================================================================

	/**
	 * Capture a snapshot of a file's current state (Phase 2 spec method)
	 * Reads the file content from disk and stores it in the trackedFiles map
	 * Call this BEFORE a tool modifies the file to capture the "before" state
	 */
	async captureSnapshot(filePath: string): Promise<FileSnapshot> {
		try {
			const content = await readFile(filePath, "utf-8");
			const stats = await stat(filePath);
			const hash = this.diffEngine.computeHash(content);

			const snapshot: FileSnapshot = {
				path: filePath,
				content,
				hash,
				timestamp: new Date().toISOString(),
				size: stats.size,
				exists: true,
			};

			this.trackedFiles.set(filePath, snapshot);
			return snapshot;
		} catch {
			// File doesn't exist - return empty snapshot
			const snapshot: FileSnapshot = {
				path: filePath,
				content: "",
				hash: "",
				timestamp: new Date().toISOString(),
				size: 0,
				exists: false,
			};
			this.trackedFiles.set(filePath, snapshot);
			return snapshot;
		}
	}

	/**
	 * Detect a change in a file by comparing with the previously captured snapshot (Phase 2 spec method)
	 * Reads the current file content from disk and compares with stored snapshot
	 * Call this AFTER a tool modifies the file to detect and record the change
	 */
	async detectChange(
		filePath: string,
		sessionId: string,
	): Promise<FileChange | null> {
		const beforeSnapshot = this.trackedFiles.get(filePath);
		const afterSnapshot = await this.captureSnapshot(filePath);

		// If no before snapshot or hashes match, no change detected
		if (!beforeSnapshot || beforeSnapshot.hash === afterSnapshot.hash) {
			return null;
		}

		const changeId = randomUUID();
		const change: FileChange = {
			id: changeId,
			filePath,
			sessionId,
			timestamp: new Date().toISOString(),
			beforeContent: beforeSnapshot.content,
			afterContent: afterSnapshot.content,
			status: "pending",
			beforeHash: beforeSnapshot.hash,
			afterHash: afterSnapshot.hash,
		};

		this.changes.set(changeId, change);
		this.emit("change:tracked", change);

		// Also add to version history
		await this.addVersion(filePath, afterSnapshot.content, {
			sessionId,
			changeId,
		});

		// Persist the change
		await this.persistChange(change);

		return change;
	}

	/**
	 * Get a previously captured snapshot for a file path
	 */
	getSnapshot(filePath: string): FileSnapshot | undefined {
		return this.trackedFiles.get(filePath);
	}

	/**
	 * Clear a tracked file snapshot
	 */
	clearSnapshot(filePath: string): boolean {
		return this.trackedFiles.delete(filePath);
	}

	// =========================================================================
	// Original Methods (captureBeforeContent / trackFromLog)
	// These use a session-scoped approach with pending captures
	// =========================================================================

	/**
	 * Capture file content before a change (call this before tool execution)
	 */
	async captureBeforeContent(
		filePath: string,
		sessionId: string,
		tool: string,
	): Promise<string | null> {
		try {
			if (!existsSync(filePath)) {
				// New file - no before content
				const captureId = `${filePath}:${sessionId}`;
				this.pendingCaptures.set(captureId, {
					filePath,
					sessionId,
					tool,
					beforeContent: "",
					capturedAt: new Date().toISOString(),
				});
				return null;
			}

			const content = await readFile(filePath, "utf-8");
			const captureId = `${filePath}:${sessionId}`;
			this.pendingCaptures.set(captureId, {
				filePath,
				sessionId,
				tool,
				beforeContent: content,
				capturedAt: new Date().toISOString(),
			});
			return content;
		} catch {
			return null;
		}
	}

	/**
	 * Track file change from log entry
	 * Enhanced to capture actual file content
	 */
	async trackFromLog(log: LogEntry): Promise<FileChange | null> {
		if (!log.file || !log.sessionId) return null;

		// Only track Edit/Write tool operations
		if (log.tool !== "Edit" && log.tool !== "Write") return null;

		const captureId = `${log.file}:${log.sessionId}`;
		const pending = this.pendingCaptures.get(captureId);

		// Get before content from pending capture or try to read it
		const beforeContent = pending?.beforeContent || "";

		// Get after content (current file state)
		let afterContent = "";
		try {
			if (existsSync(log.file)) {
				afterContent = await readFile(log.file, "utf-8");
			}
		} catch {
			// File might not exist anymore
		}

		// Only create change if content actually changed
		if (beforeContent === afterContent) {
			this.pendingCaptures.delete(captureId);
			return null;
		}

		const changeId = randomUUID();
		const change: FileChange = {
			id: changeId,
			filePath: log.file,
			sessionId: log.sessionId,
			timestamp: log.timestamp,
			beforeContent,
			afterContent,
			status: "pending",
			tool: log.tool,
		};

		this.changes.set(changeId, change);
		this.pendingCaptures.delete(captureId);
		this.emit("change:tracked", change);

		// Also add to version history
		await this.addVersion(log.file, afterContent, {
			sessionId: log.sessionId,
			changeId,
			tool: log.tool,
		});

		// Persist the change
		await this.persistChange(change);

		return change;
	}

	/**
	 * Manually track a change with content
	 */
	async trackChange(
		filePath: string,
		sessionId: string,
		beforeContent: string,
		afterContent: string,
		tool: string,
	): Promise<FileChange> {
		const changeId = randomUUID();
		const change: FileChange = {
			id: changeId,
			filePath,
			sessionId,
			timestamp: new Date().toISOString(),
			beforeContent,
			afterContent,
			status: "pending",
			tool,
		};

		this.changes.set(changeId, change);
		this.emit("change:tracked", change);

		// Add to version history
		await this.addVersion(filePath, afterContent, {
			sessionId,
			changeId,
			tool,
		});

		await this.persistChange(change);
		return change;
	}

	/**
	 * Get pending changes
	 */
	async getPendingChanges(params?: {
		sessionId?: string;
		groupBySession?: boolean;
	}): Promise<{
		changes: FileChange[];
		groupedBySession?: Record<string, string[]>;
	}> {
		let changes = Array.from(this.changes.values()).filter(
			(c) => c.status === "pending",
		);

		if (params?.sessionId) {
			changes = changes.filter((c) => c.sessionId === params.sessionId);
		}

		// Sort by timestamp, newest first
		changes.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

		const result: {
			changes: FileChange[];
			groupedBySession?: Record<string, string[]>;
		} = { changes };

		if (params?.groupBySession) {
			const grouped: Record<string, string[]> = {};
			for (const change of changes) {
				if (!grouped[change.sessionId]) {
					grouped[change.sessionId] = [];
				}
				grouped[change.sessionId].push(change.id);
			}
			result.groupedBySession = grouped;
		}

		return result;
	}

	/**
	 * Get all changes with filtering
	 */
	async getAllChanges(params?: {
		filter?: FileChangeFilter;
		pagination?: PaginationOptions;
		sort?: SortOptions;
	}): Promise<{
		changes: FileChange[];
		total: number;
		offset: number;
		limit: number;
	}> {
		let filtered = Array.from(this.changes.values());

		if (params?.filter) {
			const f = params.filter;
			if (f.sessionId)
				filtered = filtered.filter((c) => c.sessionId === f.sessionId);
			if (f.status) {
				const statuses = Array.isArray(f.status) ? f.status : [f.status];
				filtered = filtered.filter((c) =>
					statuses.includes(c.status as FileChangeStatus),
				);
			}
			if (f.filePath)
				filtered = filtered.filter((c) => c.filePath === f.filePath);
			if (f.tool) filtered = filtered.filter((c) => c.tool === f.tool);
		}

		// Apply sorting
		const sortField = params?.sort?.field || "timestamp";
		const sortOrder = params?.sort?.order || "desc";
		filtered.sort((a, b) => {
			const aVal = (a as unknown as Record<string, unknown>)[
				sortField
			] as string;
			const bVal = (b as unknown as Record<string, unknown>)[
				sortField
			] as string;
			const cmp = String(aVal).localeCompare(String(bVal));
			return sortOrder === "desc" ? -cmp : cmp;
		});

		const total = filtered.length;
		const offset = params?.pagination?.offset || 0;
		const limit = params?.pagination?.limit || 100;
		const paginated = filtered.slice(offset, offset + limit);

		return { changes: paginated, total, offset, limit };
	}

	/**
	 * Get change by ID
	 */
	async getChangeById(id: string): Promise<FileChange | null> {
		return this.changes.get(id) || null;
	}

	/**
	 * Get pending changes as a simple array (Phase 2 spec method)
	 * For the full method with filtering, use getPendingChanges()
	 */
	getPendingChangesArray(): FileChange[] {
		return Array.from(this.changes.values())
			.filter((c) => c.status === "pending")
			.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
	}

	/**
	 * Mark a change as kept (Phase 2 spec simple method)
	 * For full functionality with archiving, use keepChange()
	 */
	markAsKept(id: string): void {
		const change = this.changes.get(id);
		if (change) {
			change.status = "kept";
			this.emit("change:kept", change);
		}
	}

	/**
	 * Mark a change as reverted (Phase 2 spec simple method)
	 * For full functionality with file restoration, use revertChange()
	 */
	markAsReverted(id: string): void {
		const change = this.changes.get(id);
		if (change) {
			change.status = "reverted";
			this.emit("change:reverted", change);
		}
	}

	/**
	 * Get diff for a change using DiffEngine
	 */
	async getDiff(
		changeId: string,
		options?: { contextLines?: number },
	): Promise<DiffResult | null> {
		const change = this.changes.get(changeId);
		if (!change) return null;

		return this.diffEngine.computeDiff(
			change.beforeContent,
			change.afterContent,
			{ contextLines: options?.contextLines },
		);
	}

	/**
	 * Update the after content of a change (for inline editing)
	 */
	async updateChangeContent(
		changeId: string,
		afterContent: string,
	): Promise<{ success: boolean; change?: FileChange }> {
		const change = this.changes.get(changeId);
		if (!change) {
			return { success: false };
		}

		// Update the after content and hash
		change.afterContent = afterContent;
		change.afterHash = this.diffEngine.computeHash(afterContent);

		// Persist the change
		await this.persistChange(change);

		// Emit update event
		this.emit("change:tracked", change);

		return { success: true, change };
	}

	/**
	 * Keep a change (approve and move to archive)
	 */
	async keepChange(
		changeId: string,
	): Promise<{ success: boolean; archivedAt: string }> {
		const change = this.changes.get(changeId);
		if (!change) {
			throw new Error(`Change not found: ${changeId}`);
		}

		change.status = "kept";
		const archivedAt = new Date().toISOString();

		// Move to archive
		const archived: ArchivedChange = {
			id: change.id,
			filePath: change.filePath,
			sessionId: change.sessionId,
			archivedAt,
			originalTimestamp: change.timestamp,
			beforeContent: change.beforeContent,
			afterContent: change.afterContent,
		};

		this.archived.set(archived.id, archived);
		this.changes.delete(changeId);

		this.emit("change:kept", change);
		this.emit("archive:added", archived);

		// Persist
		await this.persistArchived(archived);
		if (this.persistence) {
			await this.persistence.deleteJSON("changes", changeId);
		}

		return { success: true, archivedAt };
	}

	/**
	 * Revert a change (restore file to before state)
	 */
	async revertChange(
		changeId: string,
	): Promise<{ success: boolean; revertedAt: string; filePath: string }> {
		const change = this.changes.get(changeId);
		if (!change) {
			throw new Error(`Change not found: ${changeId}`);
		}

		// Actually restore the file content
		try {
			await writeFile(change.filePath, change.beforeContent, "utf-8");
		} catch (error) {
			throw new Error(`Failed to revert file: ${error}`);
		}

		change.status = "reverted";
		const revertedAt = new Date().toISOString();

		this.emit("change:reverted", change);

		// Persist the status change
		await this.persistChange(change);

		return {
			success: true,
			revertedAt,
			filePath: change.filePath,
		};
	}

	/**
	 * Keep all pending changes for a session
	 */
	async keepAll(
		sessionId?: string,
	): Promise<{ success: boolean; count: number; archivedAt: string }> {
		let changes = Array.from(this.changes.values()).filter(
			(c) => c.status === "pending",
		);
		if (sessionId) {
			changes = changes.filter((c) => c.sessionId === sessionId);
		}

		const archivedAt = new Date().toISOString();
		let count = 0;
		for (const change of changes) {
			try {
				await this.keepChange(change.id);
				count++;
			} catch {
				// Continue with other changes
			}
		}

		return { success: true, count, archivedAt };
	}

	/**
	 * Revert all pending changes for a session
	 */
	async revertAll(
		sessionId?: string,
	): Promise<{ success: boolean; count: number; revertedAt: string }> {
		let changes = Array.from(this.changes.values()).filter(
			(c) => c.status === "pending",
		);
		if (sessionId) {
			changes = changes.filter((c) => c.sessionId === sessionId);
		}

		// Revert in reverse order (newest first) to handle dependencies
		changes.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

		let count = 0;
		for (const change of changes) {
			try {
				await this.revertChange(change.id);
				count++;
			} catch {
				// Continue with other changes
			}
		}

		return {
			success: true,
			count,
			revertedAt: new Date().toISOString(),
		};
	}

	/**
	 * Delete a change record
	 */
	async deleteChange(changeId: string): Promise<FileChangeDeleteResult> {
		const deleted = this.changes.delete(changeId);

		if (deleted) {
			this.emit("change:deleted", changeId);
			if (this.persistence) {
				await this.persistence.deleteJSON("changes", changeId);
			}
		}

		return {
			success: deleted,
			deleted: deleted ? 1 : 0,
			deletedAt: new Date().toISOString(),
		};
	}

	/**
	 * Clear changes with filter
	 */
	async clearChanges(
		filter?: FileChangeFilter,
	): Promise<FileChangeDeleteResult> {
		const toDelete: string[] = [];

		for (const [id, change] of this.changes) {
			let shouldDelete = true;

			if (filter?.sessionId) {
				shouldDelete = change.sessionId === filter.sessionId;
			}
			if (filter?.status && shouldDelete) {
				const statuses = Array.isArray(filter.status)
					? filter.status
					: [filter.status];
				shouldDelete = statuses.includes(change.status as FileChangeStatus);
			}
			if (filter?.filePath && shouldDelete) {
				shouldDelete = change.filePath === filter.filePath;
			}

			if (shouldDelete) toDelete.push(id);
		}

		for (const id of toDelete) {
			this.changes.delete(id);
			this.emit("change:deleted", id);
			if (this.persistence) {
				await this.persistence.deleteJSON("changes", id);
			}
		}

		return {
			success: true,
			deleted: toDelete.length,
			clearedAt: new Date().toISOString(),
		};
	}

	// =========================================================================
	// Version History Methods
	// =========================================================================

	/**
	 * Add a new version for a file
	 * Only creates a new version if the content has actually changed
	 */
	async addVersion(
		filePath: string,
		content: string,
		metadata?: {
			sessionId?: string;
			changeId?: string;
			tool?: string;
		},
	): Promise<FileVersion> {
		let history = this.history.get(filePath);
		const timestamp = new Date().toISOString();
		const contentHash = this.diffEngine.computeHash(content);

		if (!history) {
			history = {
				filePath,
				versions: [],
				versionCount: 0,
				firstTracked: timestamp,
				lastModified: timestamp,
			};
			this.history.set(filePath, history);
		}

		// Check if content is the same as the last version (skip duplicate)
		if (history.versions.length > 0) {
			const lastVersion = history.versions[history.versions.length - 1];
			if (lastVersion.hash === contentHash) {
				// Content hasn't changed - return the existing version instead of creating a duplicate
				console.error(
					`[FileTracker] Skipping duplicate version for ${filePath} - hash matches v${lastVersion.versionNumber}`,
				);
				return lastVersion;
			}
		}

		const versionNumber = history.versionCount + 1;
		const versionId = `v${versionNumber}-${contentHash.slice(0, 8)}`;
		const version: FileVersion = {
			id: versionId,
			versionNumber,
			timestamp,
			content,
			sessionId: metadata?.sessionId || "unknown",
			hash: contentHash,
			size: content.length,
		};

		history.versions.push(version);
		history.versionCount = versionNumber;
		history.lastModified = timestamp;

		// Trim old versions if exceeding max
		if (history.versions.length > this.maxVersionsPerFile) {
			history.versions = history.versions.slice(-this.maxVersionsPerFile);
		}

		this.emit("version:created", { filePath, version });

		// Persist version content and history
		if (this.persistence) {
			const safeFilePath = this.sanitizeFilePath(filePath);
			await this.persistence.saveVersion(filePath, versionNumber, content, {
				...metadata,
				hash: contentHash,
				timestamp,
			});
			await this.persistence.saveJSON("versions", safeFilePath, history);
		}

		return version;
	}

	/**
	 * Get tracked files with version info
	 */
	async getTrackedFiles(): Promise<{
		files: Array<{
			filePath: string;
			versionCount: number;
			lastModified: string;
		}>;
	}> {
		const files = Array.from(this.history.values()).map((h) => ({
			filePath: h.filePath,
			versionCount: h.versionCount,
			lastModified: h.lastModified,
		}));

		// Sort by last modified
		files.sort((a, b) => b.lastModified.localeCompare(a.lastModified));

		return { files };
	}

	/**
	 * Get version history for a file
	 */
	async getVersions(
		filePath: string,
		limit?: number,
	): Promise<VersionHistory | null> {
		const history = this.history.get(filePath);
		if (!history) return null;

		if (limit && history.versions.length > limit) {
			return {
				...history,
				versions: history.versions.slice(-limit),
			};
		}

		return history;
	}

	/**
	 * Get content of a specific version
	 */
	async getVersionContent(
		filePath: string,
		versionNumber: number,
	): Promise<{
		filePath: string;
		versionNumber: number;
		content: string;
		timestamp: string;
	} | null> {
		console.error(
			`[FileTracker] getVersionContent: ${filePath} v${versionNumber}`,
		);

		// Try memory first
		const history = this.history.get(filePath);
		if (history) {
			console.error(
				`[FileTracker] Found history in memory, ${history.versions.length} versions`,
			);
			const version = history.versions.find(
				(v) => v.versionNumber === versionNumber,
			);
			if (version) {
				console.error(
					`[FileTracker] Found version in memory, content length: ${version.content?.length || 0}`,
				);
				if (version.content) {
					return {
						filePath,
						versionNumber,
						content: version.content,
						timestamp: version.timestamp,
					};
				} else {
					console.error(
						`[FileTracker] Version found but content is empty, trying persistence`,
					);
				}
			} else {
				console.error(
					`[FileTracker] Version ${versionNumber} not found in memory versions`,
				);
			}
		} else {
			console.error(`[FileTracker] No history in memory for ${filePath}`);
		}

		// Try persistence
		if (this.persistence) {
			console.error(
				`[FileTracker] Trying persistence for ${filePath} v${versionNumber}`,
			);
			const result = await this.persistence.loadVersion(
				filePath,
				versionNumber,
			);
			if (result) {
				console.error(
					`[FileTracker] Found in persistence, content length: ${result.content?.length || 0}`,
				);
				return {
					filePath,
					versionNumber,
					content: result.content,
					timestamp: (result.metadata?.timestamp as string) || "",
				};
			} else {
				console.error(`[FileTracker] Not found in persistence`);
			}
		}

		console.error(`[FileTracker] getVersionContent returning null`);
		return null;
	}

	/**
	 * Compare two versions of a file
	 */
	async compareVersions(
		filePath: string,
		v1: number,
		v2: number,
	): Promise<{
		filePath: string;
		version1: number;
		version2: number;
		diff: DiffResult;
	} | null> {
		console.error(
			`[FileTracker] compareVersions called: ${filePath} v${v1} -> v${v2}`,
		);

		const content1 = await this.getVersionContent(filePath, v1);
		const content2 = await this.getVersionContent(filePath, v2);

		console.error(
			`[FileTracker] content1: ${content1 ? `${content1.content?.length || 0} chars` : "null"}`,
		);
		console.error(
			`[FileTracker] content2: ${content2 ? `${content2.content?.length || 0} chars` : "null"}`,
		);

		if (!content1 || !content2) {
			console.error(
				`[FileTracker] compareVersions returning null - missing content`,
			);
			return null;
		}

		const diff = this.diffEngine.computeDiff(
			content1.content,
			content2.content,
		);
		console.error(
			`[FileTracker] compareVersions diff: ${diff.hunks?.length || 0} hunks`,
		);

		return {
			filePath,
			version1: v1,
			version2: v2,
			diff,
		};
	}

	/**
	 * Restore a previous version of a file
	 */
	async restoreVersion(
		filePath: string,
		versionNumber: number,
	): Promise<{
		success: boolean;
		restoredAt: string;
		newVersionNumber: number;
	}> {
		const versionData = await this.getVersionContent(filePath, versionNumber);
		if (!versionData) {
			throw new Error(`Version ${versionNumber} not found for ${filePath}`);
		}

		// Write the restored content to the file
		try {
			await writeFile(filePath, versionData.content, "utf-8");
		} catch (error) {
			throw new Error(`Failed to restore version: ${error}`);
		}

		// Add as new version
		const newVersion = await this.addVersion(filePath, versionData.content, {
			sessionId: `restore-${versionNumber}`,
		});

		this.emit("version:restored", { filePath, version: versionNumber });

		return {
			success: true,
			restoredAt: new Date().toISOString(),
			newVersionNumber: newVersion.versionNumber,
		};
	}

	/**
	 * Delete a specific version
	 */
	async deleteVersion(
		filePath: string,
		versionNumber: number,
	): Promise<HistoryDeleteResult> {
		const history = this.history.get(filePath);
		if (!history) {
			return { success: false, deletedVersions: 0 };
		}

		const beforeCount = history.versions.length;
		history.versions = history.versions.filter(
			(v) => v.versionNumber !== versionNumber,
		);
		const deleted = beforeCount - history.versions.length;

		if (deleted > 0 && this.persistence) {
			await this.persistence.deleteVersion(filePath, versionNumber);
			const safeFilePath = this.sanitizeFilePath(filePath);
			await this.persistence.saveJSON("versions", safeFilePath, history);
		}

		return { success: deleted > 0, deletedVersions: deleted };
	}

	/**
	 * Delete all history for a file
	 */
	async deleteFileHistory(filePath: string): Promise<HistoryDeleteResult> {
		const history = this.history.get(filePath);
		const count = history?.versionCount || 0;
		this.history.delete(filePath);

		if (this.persistence) {
			const safeFilePath = this.sanitizeFilePath(filePath);
			await this.persistence.deleteJSON("versions", safeFilePath);
			// Delete all version files
			if (history) {
				for (const v of history.versions) {
					await this.persistence.deleteVersion(filePath, v.versionNumber);
				}
			}
		}

		return { success: true, deletedVersions: count, deletedFiles: 1 };
	}

	/**
	 * Clear history with filter
	 */
	async clearHistory(filter?: HistoryFilter): Promise<HistoryDeleteResult> {
		let deletedVersions = 0;
		let deletedFiles = 0;

		for (const [filePath, history] of this.history) {
			if (filter?.olderThan) {
				// Delete versions older than specified time
				const threshold = filter.olderThan;
				const oldVersions = history.versions.filter(
					(v) => v.timestamp < threshold,
				);
				for (const v of oldVersions) {
					await this.deleteVersion(filePath, v.versionNumber);
					deletedVersions++;
				}
			}

			if (
				filter?.maxVersionsPerFile &&
				history.versions.length > filter.maxVersionsPerFile
			) {
				// Trim to keep only maxVersionsPerFile versions
				const toDelete = history.versions.slice(
					0,
					history.versions.length - filter.maxVersionsPerFile,
				);
				for (const v of toDelete) {
					await this.deleteVersion(filePath, v.versionNumber);
					deletedVersions++;
				}
			}

			if (!filter) {
				// No filter means delete all
				deletedVersions += history.versionCount;
				deletedFiles++;
				await this.deleteFileHistory(filePath);
			}
		}

		return { success: true, deletedVersions, deletedFiles };
	}

	/**
	 * Get history statistics
	 */
	async getHistoryStats(): Promise<HistoryStats> {
		let totalVersions = 0;
		let totalSize = 0;
		let oldestVersion = "";
		let newestVersion = "";

		for (const history of this.history.values()) {
			totalVersions += history.versions.length;
			for (const v of history.versions) {
				totalSize += v.content.length;
				if (!oldestVersion || v.timestamp < oldestVersion) {
					oldestVersion = v.timestamp;
				}
				if (!newestVersion || v.timestamp > newestVersion) {
					newestVersion = v.timestamp;
				}
			}
		}

		return {
			trackedFiles: this.history.size,
			totalVersions,
			totalSize,
			oldestVersion,
			newestVersion,
		};
	}

	// =========================================================================
	// Archive Methods
	// =========================================================================

	/**
	 * Get archived changes
	 */
	async getArchivedChanges(params?: {
		filter?: ArchiveFilter;
		limit?: number;
		offset?: number;
	}): Promise<{ changes: ArchivedChange[]; total: number }> {
		let changes = Array.from(this.archived.values());

		if (params?.filter) {
			const f = params.filter;
			if (f.sessionId) {
				changes = changes.filter((c) => c.sessionId === f.sessionId);
			}
			if (f.filePath) {
				changes = changes.filter((c) => c.filePath === f.filePath);
			}
			if (f.olderThan) {
				changes = changes.filter((c) => c.archivedAt < f.olderThan!);
			}
		}

		// Sort by archived time, newest first
		changes.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));

		const total = changes.length;
		const offset = params?.offset || 0;
		const limit = params?.limit || 100;

		return {
			changes: changes.slice(offset, offset + limit),
			total,
		};
	}

	/**
	 * Get archived change by ID
	 */
	async getArchivedById(id: string): Promise<ArchivedChange | null> {
		return this.archived.get(id) || null;
	}

	/**
	 * Restore file from archive (apply archived change)
	 */
	async restoreFromArchive(
		changeId: string,
	): Promise<{ success: boolean; restoredAt: string; filePath: string }> {
		const archived = this.archived.get(changeId);
		if (!archived) {
			throw new Error(`Archived change not found: ${changeId}`);
		}

		// Write the after content to the file
		try {
			await writeFile(archived.filePath, archived.afterContent, "utf-8");
		} catch (error) {
			throw new Error(`Failed to restore from archive: ${error}`);
		}

		this.emit("archive:restored", archived);

		return {
			success: true,
			restoredAt: new Date().toISOString(),
			filePath: archived.filePath,
		};
	}

	/**
	 * Delete archived change
	 */
	async deleteArchived(id: string): Promise<ArchiveDeleteResult> {
		const deleted = this.archived.delete(id);

		if (deleted) {
			this.emit("archive:deleted", id);
			if (this.persistence) {
				await this.persistence.deleteJSON("archives", id);
			}
		}

		return { success: deleted, deleted: deleted ? 1 : 0 };
	}

	/**
	 * Clear archive with filter
	 */
	async clearArchive(filter?: ArchiveFilter): Promise<ArchiveDeleteResult> {
		const toDelete: string[] = [];

		for (const [id, archived] of this.archived) {
			let shouldDelete = true;

			if (filter?.sessionId) {
				shouldDelete = archived.sessionId === filter.sessionId;
			}
			if (filter?.filePath && shouldDelete) {
				shouldDelete = archived.filePath === filter.filePath;
			}
			if (filter?.olderThan && shouldDelete) {
				shouldDelete = archived.archivedAt < filter.olderThan;
			}

			if (shouldDelete) toDelete.push(id);
		}

		for (const id of toDelete) {
			this.archived.delete(id);
			this.emit("archive:deleted", id);
			if (this.persistence) {
				await this.persistence.deleteJSON("archives", id);
			}
		}

		return { success: true, deleted: toDelete.length };
	}

	/**
	 * Get diff for archived change
	 */
	async getArchivedDiff(
		id: string,
		options?: { contextLines?: number },
	): Promise<DiffResult | null> {
		const archived = this.archived.get(id);
		if (!archived) return null;

		// Compute diff on demand
		return this.diffEngine.computeDiff(
			archived.beforeContent,
			archived.afterContent,
			{ contextLines: options?.contextLines },
		);
	}

	/**
	 * Get archive statistics
	 */
	async getArchiveStats(): Promise<ArchiveStats> {
		const changes = Array.from(this.archived.values());
		const sessions = new Set(changes.map((c) => c.sessionId));
		const files = new Set(changes.map((c) => c.filePath));

		let totalSize = 0;
		let oldestArchive = "";
		let newestArchive = "";

		for (const c of changes) {
			totalSize += c.beforeContent.length + c.afterContent.length;
			if (!oldestArchive || c.archivedAt < oldestArchive) {
				oldestArchive = c.archivedAt;
			}
			if (!newestArchive || c.archivedAt > newestArchive) {
				newestArchive = c.archivedAt;
			}
		}

		return {
			totalArchived: changes.length,
			totalSessions: sessions.size,
			totalFiles: files.size,
			totalSize,
			oldestArchive,
			newestArchive,
		};
	}

	// =========================================================================
	// Utility Methods
	// =========================================================================

	/**
	 * Get overall statistics
	 */
	getStats(): FileTrackerStats {
		return {
			pendingChanges: Array.from(this.changes.values()).filter(
				(c) => c.status === "pending",
			).length,
			archivedChanges: this.archived.size,
			trackedFiles: this.history.size,
		};
	}

	/**
	 * Format diff as unified diff string
	 */
	formatDiff(diff: DiffResult, options?: { fileName?: string }): string {
		return this.diffEngine.formatUnifiedDiff(diff, options);
	}

	/**
	 * Flush pending data to persistence
	 */
	async flush(): Promise<void> {
		if (!this.persistence) return;

		// Save all changes
		for (const [id, change] of this.changes) {
			await this.persistence.saveJSON("changes", id, change);
		}

		// Save all archived
		for (const [id, archived] of this.archived) {
			await this.persistence.saveJSON("archives", id, archived);
		}

		// Save all histories
		for (const [filePath, history] of this.history) {
			const safeFilePath = this.sanitizeFilePath(filePath);
			await this.persistence.saveJSON("versions", safeFilePath, history);
		}
	}

	// =========================================================================
	// Private Methods
	// =========================================================================

	private async persistChange(change: FileChange): Promise<void> {
		if (this.persistence) {
			await this.persistence.saveJSON("changes", change.id, change);
		}
	}

	private async persistArchived(archived: ArchivedChange): Promise<void> {
		if (this.persistence) {
			await this.persistence.saveJSON("archives", archived.id, archived);
		}
	}

	private sanitizeFilePath(filePath: string): string {
		return filePath
			.replace(/[/\\]/g, "__")
			.replace(/[<>:"|?*]/g, "_")
			.replace(/\.\./g, "__");
	}
}
