/**
 * Native auto-memory contracts.
 *
 * These live here rather than in `core` because they are IPC contracts, and
 * every other IPC contract is in this package. Without it the extension would
 * import memory types from `@inspector-hook/core` and everything else from
 * `@inspector-hook/protocol` — pulling the whole core build into the
 * extension's type graph for the sake of five type names.
 *
 * Types and constants only. The behaviour — reading, writing, indexing — stays
 * in `core/src/memory/`, which imports these back.
 */

/** The type vocabulary native auto memory uses. */
export type MemoryType = "user" | "feedback" | "project" | "reference";

/** Marks a file this tool authored, and may therefore modify unasked. */
export const AUTHORED_BY = "inspector-hook";

/** The index file every project's memory directory uses. */
export const INDEX_FILE = "MEMORY.md";

/**
 * How much of the index Claude Code loads every session.
 *
 * Used only to report when an index has grown past the point where its tail
 * stops being read; nothing truncates a user's file.
 */
export const INDEX_LOAD_LINES = 200;
export const INDEX_LOAD_BYTES = 25 * 1024;

/** Why a file is or is not reachable from the index. */
export type IndexState = "referenced" | "unreferenced" | "no-index";

/** One parsed memory file. */
export interface MemoryFile {
	/** Absolute path on disk. */
	path: string;
	/** File name including extension. */
	fileName: string;
	/** The `name:` slug, falling back to the file stem when absent. */
	name: string;
	/** The `description:` line, if the file has one. */
	description?: string;
	/** `metadata.type`, when the file actually declares one of the four values. */
	type?: MemoryType;
	/**
	 * The type implied by an older `<type>_name.md` filename convention, when
	 * the file declares none.
	 *
	 * Kept separate from `type` on purpose: a UI may display an inferred type,
	 * but a count of what is DECLARED must not silently include guesses.
	 */
	inferredType?: MemoryType;
	/** `metadata.source`, present on files this tool wrote. */
	source?: string;
	/** Body text with frontmatter removed. */
	body: string;
	/** Whether the file actually had frontmatter, as opposed to defaults. */
	hasFrontmatter: boolean;
	/** Size in bytes. */
	size: number;
	/** Last modification time, ISO 8601. */
	modified: string;
	/**
	 * True when no MEMORY.md line references this file, so native loading never
	 * reaches it by name. Includes the case where there is no index at all.
	 */
	orphaned: boolean;
	/** Why, which is what decides the remedy. */
	indexState: IndexState;
}

/** A project's memory directory, summarised. */
export interface MemoryProject {
	/** The `~/.claude/projects/<slug>` directory name. */
	slug: string;
	/** Absolute path to the `memory/` directory. */
	memoryDir: string;
	/** The workspace path this slug most likely refers to, when resolvable. */
	workspacePath?: string;
	/** Files in the directory, excluding the index. */
	files: MemoryFile[];
	/** Whether MEMORY.md exists. Without it, nothing here is loaded by name. */
	hasIndex: boolean;
	/** Total bytes of all memory files, excluding the index. */
	totalSize: number;
	/** Index size, so a caller can warn before the load limit bites. */
	indexLines: number;
	indexBytes: number;
	/**
	 * MEMORY.md's text, truncated to the slice Claude actually loads.
	 *
	 * The index decides what loads, and it was the one artefact the view could
	 * never show: the text was read to compute `indexLines`/`indexBytes` and
	 * then thrown away, so the renderer written to display it had no possible
	 * source and sat dead, with tests, for as long as it existed.
	 *
	 * Bounded by INDEX_LOAD_BYTES because that is the meaningful slice -- past
	 * it the tail is not read by Claude either, so returning more would not
	 * describe what loads. `indexBytes` still reports the FULL size, so the
	 * view can say the file is larger than what it is showing.
	 */
	indexText?: string;
	/** True when indexText was cut at the load budget. */
	indexTruncated?: boolean;
}

/** Why a write was refused. */
export type WriteRefusal = "no-memory-dir" | "not-authored-by-us" | "unreadable";

export interface WriteResult {
	written: boolean;
	path?: string;
	indexUpdated?: boolean;
	refused?: WriteRefusal;
	reason?: string;
}

/** Context staged for the next session that starts. */
export interface StagedContext {
	/** Exactly the text the hook will emit. */
	text: string;
	/** ISO 8601 stage time. */
	stagedAt: string;
	/** ISO 8601 expiry; past this it is treated as absent. */
	expiresAt: string;
	/** The session this was built from, for display and provenance. */
	sourceSessionId?: string;
	/** Human label for the picker's confirmation. */
	label?: string;
	/** True when `text` was cut to fit the size cap. */
	truncated?: boolean;
}
