/**
 * The context tray: what a person has assembled to inject into a session.
 *
 * Staging was single-item. Picking a second thing replaced the first, so
 * "compose the context for this session" was not expressible at all — which is
 * the gap this exists to close.
 *
 * The separation that matters, and the one every other decision here follows
 * from: THE TRAY IS A DRAFT, AND AN ARMED PAYLOAD IS AN IMMUTABLE RENDER.
 * Nothing a hook reads is ever mutated by the UI. Arming renders the tray to a
 * frozen string and writes that; the tray itself is never read by a hook. This
 * is what lets `staged-context.ts`'s guarantee — that the preview is the
 * delivery — survive the jump from one item to many, and it removes any
 * read-modify-write race between a hook that must finish fast and a core that
 * may be mid-write.
 */

/** What kind of thing an item came from. */
export type ContextItemKind =
	| "session_digest"
	| "memory_file"
	| "free_text"
	| "file_change";

/** Where an item came from, discriminated by kind. */
export interface ContextItemSource {
	sessionId?: string;
	memoryDir?: string;
	fileName?: string;
	changeId?: string;
}

export interface ContextItem {
	/** Stable, generated core-side. */
	id: string;
	kind: ContextItemKind;
	/** Editable label, shown in the tray. */
	title: string;
	/**
	 * What the source produced. NEVER mutated.
	 *
	 * The user asked for items to be fully editable with the original kept, and
	 * this is that promise in the data model rather than in a convention: an
	 * edit writes `editedText` and leaves this alone, so reverting is deleting a
	 * field and cannot lose anything.
	 */
	originalText: string;
	/** Present only when the user changed the text. */
	editedText?: string;
	/** Soft-disable without removing: excluded from the render, kept in the tray. */
	include: boolean;
	source: ContextItemSource;
	addedAt: string;
	/** Byte length of the effective text, so the UI can show cost per item. */
	bytes: number;
}

export interface ContextTray {
	version: 1;
	/** Order is the injection order. */
	items: ContextItem[];
	updatedAt: string;
}

/**
 * What `previewInjection` returns.
 *
 * `text` is byte-for-byte what arming will write. Preview and delivery are the
 * same artefact, not two renderings of one intent — the property the single-item
 * path already guaranteed, kept here.
 */
export interface InjectionPreview {
	text: string;
	bytes: number;
	truncated: boolean;
	/** Over the advisory threshold, though still under the hard cap. */
	warnThresholdExceeded: boolean;
	items: Array<{
		itemId: string;
		title: string;
		bytes: number;
		included: boolean;
		truncated: boolean;
	}>;
	/**
	 * Secrets removed at render time, and which patterns matched.
	 *
	 * A second pass, because most tray content never passes through ingest
	 * redaction at all: free text is typed in the panel, and memory files are
	 * read straight from disk.
	 */
	redactions: { total: number; byName: Array<{ name: string; count: number }> };
}

/** Refusals a tray operation can return. */
export type TrayRefusal =
	| "no-such-item"
	| "empty-tray"
	| "item-too-large"
	| "unreadable-source";

export interface TrayResult {
	ok: boolean;
	tray?: ContextTray;
	reason?: string;
	refused?: TrayRefusal;
}

/** File the tray is persisted to, inside the storage directory. */
export const TRAY_FILE = "context-tray.json";

/**
 * Per-item cap.
 *
 * One oversized item should be refused on its own rather than silently eating
 * the whole budget and truncating everything after it.
 */
export const MAX_ITEM_BYTES = 64 * 1024;

/**
 * Advisory threshold, reported and not enforced.
 *
 * 32 KB is roughly 9k tokens. Worth saying out loud before it is spent; not
 * worth refusing, because the person asking has more context than we do.
 */
export const WARN_CONTEXT_BYTES = 32 * 1024;
