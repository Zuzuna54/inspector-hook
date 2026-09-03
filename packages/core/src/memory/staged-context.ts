/**
 * The explicit session-context picker (Milestone 3, item 5).
 *
 * Native auto memory already handles the automatic case: it loads a project's
 * curated facts every session, from the user's own corpus. What it cannot do is
 * let someone say "start the next session knowing about THAT one" — including a
 * session in a different project, which native memory is structurally unable to
 * reach. That deliberate, one-off hand-off is all this provides.
 *
 * ## Why this is the most dangerous thing in the codebase, and is built to be dull
 *
 * Everything else the panel does is reversible by looking at it. A wrong diff, a
 * wrong duration, a wrong turn grouping — all visible, all correctable. Injected
 * context is not: it reaches a future model as fact, arriving as context rather
 * than as content, so neither the model nor the user has anything to check it
 * against. If it is wrong or stale, the error is silent and compounds, because
 * every later session inherits it.
 *
 * Four properties follow, and they are enforced here rather than in the UI:
 *
 * 1. **Explicit only.** Nothing stages itself. There is no automatic path, no
 *    default, and no "remember my last choice". If it turns out people always
 *    pick the same thing, that is evidence for a default later — guessing at one
 *    now is how a tool starts quietly lying to your future self.
 * 2. **One-shot.** The hook deletes what it reads. A pick cannot silently repeat
 *    into every session from now on, which is the failure mode that would be
 *    hardest to notice and worst to inherit.
 * 3. **Expiring.** A pick staged and forgotten must not inject into an unrelated
 *    session tomorrow. Past its TTL it is treated as absent.
 * 4. **Exactly what was previewed.** The stored text is the text injected —
 *    there is no templating step between preview and delivery, because a preview
 *    that differs from what lands is worse than no preview.
 *
 * The staging file is deliberately trivial: one JSON object at a fixed path, so
 * the SessionStart hook can be a short shell script with no dependency on the
 * core being alive. If the core is down, a pick made earlier still works.
 */

import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Where the hook looks. Fixed, because the hook must find it without help. */
export const STAGED_CONTEXT_FILE = "pending-context.json";

/** One hour. Long enough to stage then start a session; short enough to forget. */
export const DEFAULT_TTL_MS = 60 * 60 * 1000;

/**
 * Injected text is capped.
 *
 * A whole session transcript would swamp the window it is injected into, and
 * the point of a digest is that it is short. Truncation is reported rather than
 * silent — a caller that gets back less than it staged is told so.
 */
export const MAX_CONTEXT_BYTES = 16 * 1024;

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
	/** True when `text` was cut to fit MAX_CONTEXT_BYTES. */
	truncated?: boolean;
}

export function stagedContextPath(storagePath: string): string {
	return join(storagePath, STAGED_CONTEXT_FILE);
}

/**
 * Stage text for the next session that starts.
 *
 * Written temp-and-rename so a SessionStart firing mid-write cannot read a
 * half-written object and inject a fragment.
 */
export async function stageContext(
	storagePath: string,
	entry: {
		text: string;
		sourceSessionId?: string;
		label?: string;
		ttlMs?: number;
	},
): Promise<StagedContext> {
	const now = Date.now();
	const ttl = entry.ttlMs && entry.ttlMs > 0 ? entry.ttlMs : DEFAULT_TTL_MS;

	let text = entry.text ?? "";
	let truncated = false;
	if (Buffer.byteLength(text, "utf-8") > MAX_CONTEXT_BYTES) {
		text = truncateToBytes(text, MAX_CONTEXT_BYTES);
		truncated = true;
	}

	const staged: StagedContext = {
		text,
		stagedAt: new Date(now).toISOString(),
		expiresAt: new Date(now + ttl).toISOString(),
		sourceSessionId: entry.sourceSessionId,
		label: entry.label,
		...(truncated ? { truncated } : {}),
	};

	const target = stagedContextPath(storagePath);
	const temp = `${target}.${process.pid}.tmp`;
	await writeFile(temp, JSON.stringify(staged, null, 2), "utf-8");
	await rename(temp, target);
	return staged;
}

/**
 * Read what is staged, or null.
 *
 * Expiry is evaluated on read, so a stale pick reports as absent to every
 * caller — the UI and the hook agree without either having to remember to check.
 */
export async function readStagedContext(
	storagePath: string,
	now: number = Date.now(),
): Promise<StagedContext | null> {
	let raw: string;
	try {
		raw = await readFile(stagedContextPath(storagePath), "utf-8");
	} catch {
		return null;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		// A corrupt staging file must not inject anything.
		return null;
	}

	if (!parsed || typeof parsed !== "object") return null;
	const entry = parsed as Partial<StagedContext>;
	if (typeof entry.text !== "string" || entry.text.length === 0) return null;

	if (typeof entry.expiresAt === "string") {
		const expires = Date.parse(entry.expiresAt);
		if (Number.isNaN(expires) || expires <= now) return null;
	} else {
		// No expiry recorded: treat as expired rather than as forever. An
		// unbounded injection is the outcome this whole module exists to avoid.
		return null;
	}

	return entry as StagedContext;
}

/** Remove whatever is staged. Safe to call when nothing is. */
export async function clearStagedContext(storagePath: string): Promise<boolean> {
	try {
		await unlink(stagedContextPath(storagePath));
		return true;
	} catch {
		return false;
	}
}

/**
 * Cut a string to a byte budget without splitting a multi-byte character.
 *
 * Byte-based because the cap is about payload size, and a naive slice on
 * `length` would let a run of multi-byte characters through at up to 4x.
 */
function truncateToBytes(text: string, maxBytes: number): string {
	const notice = "\n\n[truncated by Inspector Hook]";
	const budget = maxBytes - Buffer.byteLength(notice, "utf-8");
	const buf = Buffer.from(text, "utf-8");
	if (buf.length <= budget) return text;

	let end = budget;
	// Step back off a continuation byte so the cut lands on a character boundary.
	while (end > 0 && (buf[end] & 0b1100_0000) === 0b1000_0000) end--;
	return buf.subarray(0, end).toString("utf-8") + notice;
}
