/**
 * Turning the three local corpora into indexable documents.
 *
 * Separated from `context-index.ts` because these are two different jobs: this
 * module decides WHAT is searchable, the index decides HOW it ranks. The rules
 * about what must never be indexed live here, next to the code that would have
 * to break them.
 *
 * ## The rule this module exists to hold: never index file contents
 *
 * `FileChange` carries `beforeContent` and `afterContent` -- the whole file,
 * twice. Indexing those would put every line of every touched file into the
 * postings, which is both enormous and useless: searching for a function name
 * would match every file that merely contains it, ranked by how often, and the
 * one change that introduced it would be indistinguishable from the hundred
 * that happened to sit near it.
 *
 * The research extractor already made this call for reads -- `file_read`
 * indexes the path and the offset, never the bytes (`research/extract.ts`).
 * This follows it: a file change is indexed as its path plus the lines that
 * actually changed.
 *
 * ## Why changed lines are a set difference, not a diff
 *
 * `DiffEngine.computeDiff` is an LCS diff and produces hunks with context and
 * move detection. That is the right thing for RENDERING a change and the wrong
 * thing for indexing one: it is O(n*m) over two whole files, and it would run
 * on every change at index time to produce something the index then throws
 * most of away.
 *
 * What the index needs is the VOCABULARY of what changed, and for that a line
 * set difference is exact where it matters and cheap. A moved line appears on
 * both sides, so it contributes no new vocabulary and its absence costs
 * nothing -- the one case where the two methods disagree is the one case where
 * the disagreement does not matter.
 */

import type {
	ContextCorpus,
	ContextDoc,
	FileChange,
	MemoryFile,
	SessionSummaryRecord,
} from "@inspector-hook/protocol";
import {
	CONTEXT_SNIPPET_LENGTH,
	MAX_CHANGED_LINES,
	MAX_DOC_TEXT_BYTES,
} from "@inspector-hook/protocol";

import type { SessionDigest } from "../memory/session-digest.js";
import { truncateToBytes } from "../memory/staged-context.js";
import { redactString } from "../server/redaction.js";

/**
 * A short extract for display.
 *
 * Whitespace is flattened so a snippet of a Markdown body does not render as
 * a fragment of broken layout in a result row.
 */
export function snippetOf(text: string): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length <= CONTEXT_SNIPPET_LENGTH
		? flat
		: `${flat.slice(0, CONTEXT_SNIPPET_LENGTH - 1)}…`;
}

/**
 * Prepare text for indexing: redact, then bound.
 *
 * Redaction runs BEFORE anything is stored, in both the searchable text and
 * the snippet. Memory files and file changes are read from disk rather than
 * arriving through the already-redacted log path, so this is the first and
 * only place a secret in them would be caught.
 */
function prepare(text: string): string {
	const { value } = redactString(text);
	return truncateToBytes(value, MAX_DOC_TEXT_BYTES);
}

/** Assemble a document, applying redaction and the byte bound once. */
function docOf(
	fields: Omit<ContextDoc, "text" | "snippet"> & { text: string },
): ContextDoc {
	const text = prepare(fields.text);
	return { ...fields, text, snippet: snippetOf(text) };
}

/**
 * A memory file.
 *
 * The description is indexed twice on purpose. It is the line that decides
 * whether Claude loads the file at all, so it carries more intent per word
 * than the body does, and repeating it is the standard way to weight a field
 * in BM25 without adding field-weighting machinery to the index.
 */
export function memoryDoc(
	file: MemoryFile,
	project: { slug: string; name?: string; projectKey?: string },
): ContextDoc {
	const description = file.description ?? "";
	return docOf({
		id: `memory:${project.slug}:${file.fileName}`,
		corpus: "memory",
		title: file.name || file.fileName,
		text: [file.name, description, description, file.body]
			.filter(Boolean)
			.join("\n"),
		timestamp: file.modified,
		projectKey: project.projectKey,
		projectName: project.name ?? project.slug,
		path: file.path,
	});
}

/** A digest built for a live session. */
export function digestDoc(
	digest: SessionDigest,
	meta: {
		timestamp: string;
		projectKey?: string;
		projectName?: string;
	},
): ContextDoc {
	return docOf({
		id: `digest:${digest.sessionId}`,
		corpus: "digest",
		title: digest.title || digest.name,
		text: [digest.title, digest.description, digest.description, digest.body]
			.filter(Boolean)
			.join("\n"),
		timestamp: meta.timestamp,
		projectKey: meta.projectKey,
		projectName: meta.projectName,
		sessionId: digest.sessionId,
	});
}

/**
 * A digest preserved when a session was collapsed.
 *
 * The same corpus as a live digest and deliberately the same id shape, so a
 * session that gets collapsed REPLACES its live entry instead of appearing
 * twice under two ids -- the duplicate-crowding failure the research extractor
 * keys on path to avoid.
 */
export function summaryDoc(
	summary: SessionSummaryRecord,
	meta?: { projectKey?: string; projectName?: string },
): ContextDoc | null {
	const body = summary.digest ?? "";
	const description = summary.description ?? "";
	if (!body && !description) return null;
	return docOf({
		id: `digest:${summary.id}`,
		corpus: "digest",
		title: summary.name || summary.description || summary.id,
		text: [description, description, body].filter(Boolean).join("\n"),
		timestamp: summary.endTime ?? summary.collapsedAt,
		projectKey: meta?.projectKey,
		projectName: meta?.projectName ?? summary.metadata?.projectName,
		sessionId: summary.id,
	});
}

/**
 * The lines that differ between two versions of a file.
 *
 * A set difference in both directions, capped. Order is preserved from the
 * `after` side first, because what a change ADDED is what someone is usually
 * searching for; removals follow so a deleted symbol is still findable.
 *
 * Blank lines and lines that are pure punctuation are dropped -- they carry no
 * terms, and a reformatting commit would otherwise fill the cap with `}`.
 */
export function changedLines(
	before: string,
	after: string,
	limit = MAX_CHANGED_LINES,
): string[] {
	const meaningful = (line: string) => /[A-Za-z0-9_]/.test(line);
	const beforeSet = new Set(before.split("\n").map((l) => l.trim()));
	const afterSet = new Set(after.split("\n").map((l) => l.trim()));

	const out: string[] = [];
	for (const line of afterSet) {
		if (out.length >= limit) return out;
		if (meaningful(line) && !beforeSet.has(line)) out.push(line);
	}
	for (const line of beforeSet) {
		if (out.length >= limit) return out;
		if (meaningful(line) && !afterSet.has(line)) out.push(line);
	}
	return out;
}

/**
 * A file change: its path, and the lines that changed. Never its contents.
 *
 * See the module comment -- this is the single rule that keeps the index a
 * search index rather than a second copy of the working tree.
 */
export function fileChangeDoc(
	change: FileChange,
	meta?: { projectKey?: string; projectName?: string },
): ContextDoc {
	const lines = changedLines(
		change.beforeContent ?? "",
		change.afterContent ?? "",
	);
	return docOf({
		id: `filechange:${change.id}`,
		corpus: "filechange",
		title: change.filePath,
		// The path leads, and the tokeniser splits it on separators, so a search
		// for "tray-store" finds changes to that file by name alone.
		text: [change.filePath, change.tool ?? "", ...lines]
			.filter(Boolean)
			.join("\n"),
		timestamp: change.timestamp,
		projectKey: meta?.projectKey,
		projectName: meta?.projectName,
		sessionId: change.sessionId,
		path: change.filePath,
	});
}

/**
 * One captured event.
 *
 * The header search box used to filter these with a case-insensitive substring
 * match on `message` alone -- so "the file tracker" found nothing that said
 * "FileTracker", and nothing at all matched a tool's arguments unless they
 * happened to sit in the summary line. Indexing them here gives events the
 * same ranking every other corpus gets, and puts them in the same result set.
 *
 * `message` already carries the event name and the tool's primary argument
 * (`Bash: cd /repo && npm test`), and the tool name is added so a search for
 * "Edit" finds edits regardless of how the summary was phrased.
 */
export function logDoc(
	log: {
		id: string;
		timestamp: string;
		message: string;
		hook?: string;
		event?: string;
		tool?: string;
		sessionId?: string;
		level?: string;
	},
	meta?: { projectKey?: string; projectName?: string },
): ContextDoc {
	const title = log.tool ? `${log.tool}` : log.event || log.hook || "event";
	return docOf({
		id: `logs:${log.id}`,
		corpus: "logs",
		title,
		text: [log.tool, log.hook, log.event, log.level, log.message]
			.filter(Boolean)
			.join("\n"),
		timestamp: log.timestamp,
		projectKey: meta?.projectKey,
		projectName: meta?.projectName,
		sessionId: log.sessionId,
	});
}

/** The corpora this module builds. `prompt` is delegated, so it is not here. */
export const LOCAL_CORPORA: ContextCorpus[] = [
	"memory",
	"digest",
	"filechange",
	"logs",
];
