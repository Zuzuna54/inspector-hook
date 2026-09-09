/**
 * What was actually injected into a session.
 *
 * ## Why this is written by the HOOK and not by the core
 *
 * The core knows what it *armed*. Only the hook knows what was *delivered* —
 * and the two differ in every failure this design already accounts for: a
 * payload that expired between arming and the prompt, a `now` tier consumed by
 * a session other than the one you meant, a pinned entry that fired eleven
 * times. A record written by the core would describe intent and be believed as
 * history.
 *
 * ## Why not derive it from `StagedContext.sourceSessionId`
 *
 * That field records where the text came *from*, not where it went *to*. It is
 * the session whose digest was staged, which is usually a DIFFERENT session
 * from the one that received it — that is the entire point of staging. Reading
 * it as a delivery record would answer "what was injected into this session"
 * with "what this session was the source of", confidently and backwards.
 *
 * ## Append-only, and small on purpose
 *
 * One JSON object per line, written with a single `>>`. Every field is a short
 * scalar and the text itself is NEVER recorded: a POSIX append of under
 * PIPE_BUF is atomic, so two hooks firing at once interleave whole lines
 * rather than fragments. Recording the payload would both break that and
 * duplicate content that already lives in the tray, the bundle, or the
 * transcript.
 *
 * A malformed line is counted, never dropped silently and never fatal — the
 * same rule the transcript reader follows, for the same reason: this file is
 * written by shell scripts on a machine we do not control.
 */

import { createReadStream } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

/** Which delivery path carried it. */
export type InjectionTier = "next-session" | "now" | "pinned";

export interface InjectionRecord {
	/** ISO 8601, written by the hook at delivery time. */
	at: string;
	/** The session it was delivered INTO. */
	sessionId: string;
	tier: InjectionTier;
	/** Size of the delivered text, in bytes. */
	bytes: number;
	/** The label the tray carried, when it had one. */
	label?: string;
}

export interface InjectionReadResult {
	records: InjectionRecord[];
	/** Lines that did not parse. Reported rather than hidden. */
	unparseable: number;
	/** True when the file was longer than the byte ceiling. */
	clipped: boolean;
}

export const INJECTIONS_FILE = "injections.jsonl";

/** Ceiling on one read. A log of scalars; this is years of injections. */
export const MAX_INJECTIONS_BYTES = 8 * 1024 * 1024;

/** Longest label recorded, so a line stays comfortably under PIPE_BUF. */
export const MAX_LABEL = 120;

export function injectionsPath(storagePath: string): string {
	return join(storagePath, "context", INJECTIONS_FILE);
}

/**
 * Append one delivery record.
 *
 * Exported for the core's own use and for tests. The hooks write the same
 * shape directly with `>>`, because they must work whether or not the core is
 * running — the whole point of the file-based tiers.
 */
export async function recordInjection(
	storagePath: string,
	entry: InjectionRecord,
): Promise<void> {
	await mkdir(join(storagePath, "context"), { recursive: true });
	const line = JSON.stringify({
		at: entry.at,
		sessionId: entry.sessionId,
		tier: entry.tier,
		bytes: entry.bytes,
		...(entry.label ? { label: entry.label.slice(0, MAX_LABEL) } : {}),
	});
	await appendFile(injectionsPath(storagePath), `${line}\n`, "utf-8");
}

function isRecord(value: unknown): value is InjectionRecord {
	if (!value || typeof value !== "object") return false;
	const r = value as Record<string, unknown>;
	return (
		typeof r.at === "string" &&
		typeof r.sessionId === "string" &&
		(r.tier === "next-session" || r.tier === "now" || r.tier === "pinned")
	);
}

/**
 * Read the log, newest first.
 *
 * Streamed rather than read whole: this file only grows, and a tool that
 * answers "what was injected here" must not get slower in proportion to every
 * injection ever made on the machine.
 */
export async function readInjections(
	storagePath: string,
	options: { sessionId?: string; limit?: number } = {},
): Promise<InjectionReadResult> {
	const records: InjectionRecord[] = [];
	let unparseable = 0;
	let clipped = false;
	let bytes = 0;

	let stream: ReturnType<typeof createReadStream>;
	try {
		stream = createReadStream(injectionsPath(storagePath), {
			encoding: "utf-8",
		});
	} catch {
		return { records, unparseable, clipped };
	}

	try {
		const lines = createInterface({
			input: stream,
			crlfDelay: Number.POSITIVE_INFINITY,
		});
		for await (const line of lines) {
			bytes += Buffer.byteLength(line, "utf-8") + 1;
			if (bytes > MAX_INJECTIONS_BYTES) {
				clipped = true;
				break;
			}
			if (!line.trim()) continue;
			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch {
				unparseable++;
				continue;
			}
			if (!isRecord(parsed)) {
				unparseable++;
				continue;
			}
			if (options.sessionId && parsed.sessionId !== options.sessionId) continue;
			records.push({
				at: parsed.at,
				sessionId: parsed.sessionId,
				tier: parsed.tier,
				bytes: Number(parsed.bytes) || 0,
				...(parsed.label ? { label: String(parsed.label) } : {}),
			});
		}
	} catch {
		// A file that vanished or became unreadable mid-read is not an error
		// worth failing a panel over; what was read is still true.
	} finally {
		stream.destroy();
	}

	// Newest first, and the limit applied AFTER sorting so it returns the most
	// recent N rather than the first N encountered.
	records.sort((a, b) => b.at.localeCompare(a.at));
	const limit = options.limit ?? 200;
	return { records: records.slice(0, limit), unparseable, clipped };
}

/**
 * A one-line summary per session, for marking rows in a list.
 *
 * Returns a map rather than a list because every caller so far wants to ask
 * "does this session have any?" while rendering, and a linear scan per row
 * turns a session list into a quadratic one.
 */
export async function injectionCounts(
	storagePath: string,
): Promise<Map<string, { count: number; bytes: number; last: string }>> {
	const { records } = await readInjections(storagePath, { limit: 100_000 });
	const out = new Map<string, { count: number; bytes: number; last: string }>();
	for (const record of records) {
		const held = out.get(record.sessionId);
		if (held) {
			held.count++;
			held.bytes += record.bytes;
			if (record.at > held.last) held.last = record.at;
		} else {
			out.set(record.sessionId, {
				count: 1,
				bytes: record.bytes,
				last: record.at,
			});
		}
	}
	return out;
}
