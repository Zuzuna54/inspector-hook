/**
 * Collect everything a session digest is built from, in one place.
 *
 * `buildSessionDigest` is a pure function of its input, which is the right
 * shape for testing and the wrong shape for consistency: three call sites each
 * assembled their own input, and two of them assembled less. `collapseSession`
 * and `writeSessionMemory` both called `buildSessionDigest({ session })` bare,
 * so the digest written into the user's memory and the summary preserved during
 * retention were both strictly weaker than the one the panel previewed -- no
 * counts, no resolved file paths. A preview that does not match delivery is the
 * same failure this module's neighbours exist to prevent, so there is now one
 * collector and every caller uses it.
 *
 * Dependencies are structural rather than the concrete managers: this keeps the
 * module testable with two object literals, and keeps `memory/` from importing
 * `managers/`.
 */

import type { DigestInput } from "./session-digest.js";

/** A log row, as narrow as this module actually needs it. */
interface LogRow {
	level?: string;
	hook?: string;
	timestamp?: string;
	details?: Record<string, unknown> | null;
}

/** The slice of LogManager used here. */
export interface LogSource {
	getLogs(query: {
		filter: { sessionId: string };
		pagination: { limit: number; offset: number };
	}): Promise<{ logs: LogRow[] }>;
}

/** The slice of FileTracker used here. */
export interface ChangeSource {
	getChangeById(id: string): Promise<{ filePath?: string } | null | undefined>;
}

/** A session, as narrow as this module needs it. */
interface SessionLike {
	id: string;
	fileChanges?: string[];
}

export interface CollectOptions {
	session: SessionLike;
	logs?: LogSource;
	changes?: ChangeSource;
}

/**
 * How many prompts and replies to carry.
 *
 * `bulletList` already collapses the tail at 8, so gathering hundreds only to
 * discard them costs work for nothing. Kept slightly above that so the digest
 * can say "and N more" truthfully.
 */
const MAX_TURNS = 24;

/**
 * Build the full digest input for a session.
 *
 * Every source is optional: a caller without a log manager still gets a valid
 * input, just a thinner one. That matters because `collapseSession` runs during
 * retention, where a partial failure must not cancel the preservation.
 */
export async function collectDigestInput(
	options: CollectOptions,
): Promise<DigestInput> {
	const { session, logs, changes } = options;

	const [fromLogs, filePaths] = await Promise.all([
		collectFromLogs(session.id, logs),
		resolveFilePaths(session.fileChanges, changes),
	]);

	return {
		session: session as DigestInput["session"],
		counts: fromLogs.counts,
		prompts: fromLogs.prompts,
		replies: fromLogs.replies,
		filePaths,
	};
}

/**
 * One pass over the session's logs for counts, prompts and replies.
 *
 * Reading the log set three times to answer three questions about it would
 * triple the cost of the largest read in the digest path.
 */
async function collectFromLogs(
	sessionId: string,
	source: LogSource | undefined,
): Promise<{
	counts: NonNullable<DigestInput["counts"]>;
	prompts: string[];
	replies: string[];
}> {
	const counts = { errors: 0, warnings: 0, blocked: 0, logs: 0 };
	const prompts: Array<{ at: string; text: string }> = [];
	const replies: Array<{ at: string; text: string }> = [];

	if (!source) return { counts, prompts: [], replies: [] };

	let rows: LogRow[];
	try {
		const result = await source.getLogs({
			filter: { sessionId },
			pagination: { limit: Number.MAX_SAFE_INTEGER, offset: 0 },
		});
		rows = Array.isArray(result?.logs) ? result.logs : [];
	} catch {
		// A digest with no prompts is worth more than no digest at all.
		return { counts, prompts: [], replies: [] };
	}

	for (const row of rows) {
		counts.logs++;
		if (row.level === "error") counts.errors++;
		else if (row.level === "warn") counts.warnings++;
		else if (row.level === "blocked") counts.blocked++;

		const details = row.details ?? undefined;
		const at = typeof row.timestamp === "string" ? row.timestamp : "";

		if (row.hook === "UserPromptSubmit") {
			const text = str(details?.prompt);
			if (text) prompts.push({ at, text });
		} else if (row.hook === "Stop") {
			// `Stop` only, never `StopFailure`. Both write to the same field, but
			// StopFailure's value is an API error string -- so including it would
			// record "API Error: rate limit reached" in native memory as though it
			// were something the session concluded.
			const text = str(details?.lastAssistantMessage);
			if (text) replies.push({ at, text });
		}
	}

	return {
		counts,
		prompts: oldestFirst(prompts),
		replies: oldestFirst(replies),
	};
}

/** Chronological, de-duplicated, and capped. */
function oldestFirst(items: Array<{ at: string; text: string }>): string[] {
	const sorted = [...items].sort((a, b) => a.at.localeCompare(b.at));
	const seen = new Set<string>();
	const out: string[] = [];
	for (const { text } of sorted) {
		if (seen.has(text)) continue;
		seen.add(text);
		out.push(text);
		if (out.length >= MAX_TURNS) break;
	}
	return out;
}

/**
 * Resolve change IDs to paths.
 *
 * `Session.fileChanges` holds IDs; only the tracker can turn them into paths.
 * An ID that no longer resolves is skipped rather than reported as a path,
 * which is why the digest distinguishes "N files changed" from "N changes
 * (paths unresolved)".
 */
async function resolveFilePaths(
	changeIds: string[] | undefined,
	source: ChangeSource | undefined,
): Promise<string[]> {
	if (!source || !Array.isArray(changeIds) || changeIds.length === 0) return [];

	const paths: string[] = [];
	for (const id of changeIds) {
		try {
			const change = await source.getChangeById(id);
			if (change?.filePath) paths.push(change.filePath);
		} catch {
			// Skip: an unresolvable ID is reported as unresolved, not as absent.
		}
	}
	return paths;
}

function str(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0
		? value
		: undefined;
}
