/**
 * File version history and the archive of resolved changes.
 *
 * Split out of the former single index.ts; index.ts re-exports every
 * name here, so imports from @inspector-hook/protocol are unchanged.
 */

import type { Session } from "./session.js";

// =============================================================================
// Version History Models
// =============================================================================

/**
 * A single file version
 */
export interface FileVersion {
	/** Version identifier (e.g., 'v1', 'v2') */
	id: string;
	/** Numeric version number */
	versionNumber: number;
	/** File content at this version */
	content: string;
	/** ISO 8601 timestamp */
	timestamp: string;
	/** Session that created this version */
	sessionId: string;
	/** MD5 hash of content */
	hash: string;
	/** Size in bytes */
	size?: number;
	/** Optional label/description */
	label?: string;
	/**
	 * What produced this version — a tool name like `Edit` or `Write`, or
	 * `revert` / `restore-from-archive` when the content came from undoing or
	 * replaying a change.
	 *
	 * Optional because versions written before it existed do not carry it, and
	 * because it is provenance rather than identity. `addVersion` accepted a
	 * `tool` in its metadata from the beginning and dropped it on the floor;
	 * seven call sites were supplying one, and `CoreBridge.getVersionHistory`
	 * declared `tool: string` to the client, so every consumer saw undefined
	 * where the contract promised a value.
	 */
	tool?: string;
	/** The change this version came from, when it came from one. */
	changeId?: string;
}


/**
 * Version history for a single file
 */
export interface VersionHistory {
	/** Absolute file path */
	filePath: string;
	/** All versions, oldest first */
	versions: FileVersion[];
	/** How many versions are currently retained (matches versions.length) */
	versionCount: number;
	/**
	 * Highest version number ever assigned for this file. Monotonic: it keeps
	 * climbing as versions are trimmed or deleted, so version numbers are never
	 * reused. Optional because histories written before this field existed fall
	 * back to versionCount.
	 */
	lastVersionNumber?: number;
	/** First tracked timestamp */
	firstTracked: string;
	/** Last modified timestamp */
	lastModified: string;
}

// =============================================================================
// Archive Models
// =============================================================================

/**
 * How a pending change was resolved before being archived
 */
export type ArchiveResolution = "kept" | "reverted";


/**
 * An archived (resolved) file change — either kept or reverted
 */
export interface ArchivedChange {
	/** Original change ID */
	id: string;
	/** Absolute file path */
	filePath: string;
	/** Session that made the original change */
	sessionId: string;
	/** ISO 8601 archive timestamp */
	archivedAt: string;
	/** Original change timestamp */
	originalTimestamp: string;
	/** Content before the change */
	beforeContent: string;
	/** Content after the change (as the AI wrote it) */
	afterContent: string;
	/**
	 * Whether the change was kept or reverted. Optional so archives written
	 * before this field existed still load; treat a missing value as "kept",
	 * since only kept changes were archived at all back then.
	 */
	resolution?: ArchiveResolution;
	/** Optional archive notes */
	notes?: string;
	/** Tags for organization */
	tags?: string[];
}


/**
 * Filter options for history queries
 */
export interface HistoryFilter {
	/** Filter versions older than this timestamp */
	olderThan?: string;
	/** Keep at most this many versions per file */
	maxVersionsPerFile?: number;
}


/**
 * Result of history deletion/clear operation
 */
export interface HistoryDeleteResult {
	success: boolean;
	deletedVersions?: number;
	deletedFiles?: number;
	remainingVersions?: number;
	deletedAt?: string;
	clearedAt?: string;
}


/**
 * Statistics for version history
 */
export interface HistoryStats {
	trackedFiles: number;
	totalVersions: number;
	totalSize: number;
	oldestVersion: string;
	newestVersion: string;
}


/**
 * Filter options for archive queries
 */
export interface ArchiveFilter {
	/** Filter by session */
	sessionId?: string;
	/** Filter by file path */
	filePath?: string;
	/** Filter archives older than this timestamp */
	olderThan?: string;
	/** Filter by how the change was resolved (kept vs reverted) */
	resolution?: ArchiveResolution;
}


/**
 * Result of archive deletion/clear operation
 */
export interface ArchiveDeleteResult {
	success: boolean;
	deleted?: number;
	deletedAt?: string;
	clearedAt?: string;
}


/**
 * Statistics for archive
 */
export interface ArchiveStats {
	totalArchived: number;
	totalSessions: number;
	totalFiles: number;
	totalSize: number;
	oldestArchive: string;
	newestArchive: string;
}
