/**
 * Tracked file changes and computed diffs.
 *
 * Split out of the former single index.ts; index.ts re-exports every
 * name here, so imports from @inspector-hook/protocol are unchanged.
 */

import type { Session } from "./session.js";

// =============================================================================
// File Change Models
// =============================================================================

export type ChangeStatus = "pending" | "kept" | "reverted" | "staged";


/**
 * A tracked file change
 */
export interface FileChange {
	/** Unique change identifier */
	id: string;
	/** Absolute file path */
	filePath: string;
	/** Session that made this change */
	sessionId: string;
	/** ISO 8601 timestamp of change detection */
	timestamp: string;
	/** File content before the change */
	beforeContent: string;
	/** File content after the change */
	afterContent: string;
	/** Change status */
	status: ChangeStatus;
	/** Tool that made the change (if known) */
	tool?: string;
	/** Hash of before content */
	beforeHash?: string;
	/** Hash of after content */
	afterHash?: string;
}


/**
 * A snapshot of a file at a specific point in time
 */
export interface FileSnapshot {
	/** Absolute file path */
	path: string;
	/** File content */
	content: string;
	/** MD5 hash of content */
	hash: string;
	/** ISO 8601 timestamp */
	timestamp: string;
	/** File size in bytes */
	size: number;
	/** Whether the file exists (false for deleted files) */
	exists?: boolean;
}


export type HunkStatus = "pending" | "kept" | "reverted";


export interface DiffLine {
	/** Line change type */
	type: "added" | "removed" | "context" | "moved-from" | "moved-to";
	/** Line content (without +/- prefix) */
	content: string;
	/** Line number in respective file */
	lineNumber: number;
	/** Line number in original file (for context and removed lines) */
	oldLineNumber?: number;
	/** Line number in modified file (for context and added lines) */
	newLineNumber?: number;
	/** Move ID linking moved-from to moved-to blocks */
	moveId?: string;
}


/**
 * A single diff hunk (continuous block of changes)
 */
export interface DiffHunk {
	/** Unique hunk identifier */
	id: string;
	/** Starting line in original file */
	oldStart: number;
	/** Number of lines in original */
	oldLines: number;
	/** Starting line in modified file */
	newStart: number;
	/** Number of lines in modified */
	newLines: number;
	/** Individual line changes */
	lines: DiffLine[];
	/** Lines added in this hunk */
	additions: number;
	/** Lines removed in this hunk */
	deletions: number;
	/** Hunk operation status */
	status: HunkStatus;
}


/**
 * Diff computation result
 */
export interface DiffResult {
	/** Original content */
	beforeContent: string;
	/** Modified content */
	afterContent: string;
	/** Diff hunks */
	hunks: DiffHunk[];
	/** Total lines added */
	additions: number;
	/** Total lines removed */
	deletions: number;
	/** Unified diff string (optional) */
	unifiedDiff?: string;
}


export type FileChangeStatus = "pending" | "kept" | "reverted";

export type FileChangeType = "create" | "modify" | "delete";


/**
 * Filter options for file change queries
 */
export interface FileChangeFilter {
	/** Filter by session */
	sessionId?: string;
	/** Filter by status */
	status?: FileChangeStatus | FileChangeStatus[];
	/** Filter by file path (exact match) */
	filePath?: string;
	/** Filter by file path pattern (glob) */
	filePattern?: string;
	/** Filter by change type */
	changeType?: FileChangeType | FileChangeType[];
	/** Filter by tool name */
	tool?: string;
	/** Filter changes older than this timestamp */
	olderThan?: string;
}


/**
 * Result of file change deletion/clear operation
 */
export interface FileChangeDeleteResult {
	success: boolean;
	deleted?: number;
	deletedAt?: string;
	clearedAt?: string;
}
