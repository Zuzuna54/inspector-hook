/**
 * Read a Claude Code session transcript.
 *
 * The transcript is the session's actual content — prompts, replies, thinking,
 * tool inputs and their results — and until now nothing here had ever opened
 * one. The core captures HOOK EVENTS, which are metadata: it knows a Bash call
 * happened and which files it touched, and nothing about what was said. That is
 * why a session digest reads as a fact list rather than as a record of the work.
 *
 * ## Streaming, because these files are large
 *
 * Measured on this machine: the largest transcript is 48 MB and the longest
 * single line is 326 KB. `readFile` on panel open would stall the core, so this
 * streams line by line and keeps only the window asked for.
 *
 * ## The format is internal, so this depends on as little of it as possible
 *
 * Claude Code's own documentation is explicit that the entry format is internal
 * and can change between releases. A real transcript here carries fourteen line
 * types, nine of which are undocumented (`atis-latch`, `bridge-session`,
 * `ai-title`, `agent-name`, `queue-operation`, …). So this reads only:
 *
 *     type · uuid · parentUuid · timestamp · message.content · message.usage
 *
 * and an unrecognised type becomes `{kind:"unknown", rawType}` and increments a
 * counter that is RETURNED to the caller. A format change then shows up as a
 * visible number rather than as a silently shorter transcript — which is the
 * failure this codebase keeps finding everywhere else.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";

/** A line longer than this is clipped, and the clipping is reported. */
export const MAX_LINE_BYTES = 256 * 1024;

/** Refuse rather than freeze. A transcript larger than this is not rendered. */
export const MAX_TRANSCRIPT_BYTES = 128 * 1024 * 1024;

/** Line types that are bookkeeping rather than conversation. */
const BOOKKEEPING = new Set([
	"ai-title",
	"last-prompt",
	"mode",
	"permission-mode",
	"atis-latch",
	"bridge-session",
	"agent-name",
	"queue-operation",
	"file-history-snapshot",
	"file-history-delta",
	"attachment",
]);

export type TranscriptKind =
	| "prompt"
	| "reply"
	| "thinking"
	| "tool_use"
	| "tool_result"
	| "system"
	| "unknown";

export interface TranscriptEntry {
	index: number;
	uuid?: string;
	parentUuid?: string;
	timestamp?: string;
	kind: TranscriptKind;
	/** The rendered text, already clipped if it was oversized. */
	text: string;
	/** Present for tool_use / tool_result. */
	toolName?: string;
	toolUseId?: string;
	isSidechain?: boolean;
	model?: string;
	/** True when this entry's source line was clipped at MAX_LINE_BYTES. */
	clipped?: boolean;
	/** Set only for kind === "unknown". */
	rawType?: string;
}

export interface TranscriptUsage {
	/** The largest context observed in one turn: input + both cache figures. */
	peakContextTokens: number;
	/** The most recent turn's context. */
	lastContextTokens: number;
	totalOutputTokens: number;
	turns: number;
	models: string[];
}

export interface TranscriptStats {
	path: string;
	bytes: number;
	lines: number;
	/** Counts by normalised kind, so a caller can see the shape at a glance. */
	byKind: Record<string, number>;
	/** Every raw `type` seen, and how often. Includes ones we do not model. */
	seenTypes: Record<string, number>;
	/** Lines whose `type` this reader does not recognise. */
	unrecognised: number;
	/** Lines that failed to parse as JSON at all. */
	unparseable: number;
	/** Lines clipped at MAX_LINE_BYTES. */
	clipped: number;
	usage: TranscriptUsage;
	/** True when the file is too large to read. Nothing else is populated. */
	tooLarge?: boolean;
}

function str(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Pull the readable text out of one content block. */
function blockText(block: Record<string, unknown>): string {
	const type = block.type;
	if (type === "text" || type === "thinking") {
		return str(block.text) ?? str(block.thinking) ?? "";
	}
	if (type === "tool_use") {
		try {
			return JSON.stringify(block.input ?? {}, null, 2);
		} catch {
			return "";
		}
	}
	if (type === "tool_result") {
		const content = block.content;
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			return content
				.map((c) =>
					c && typeof c === "object" ? (str((c as Record<string, unknown>).text) ?? "") : "",
				)
				.filter(Boolean)
				.join("\n");
		}
		return "";
	}
	return "";
}

/** Map one parsed line to zero or more entries. */
function toEntries(
	parsed: Record<string, unknown>,
	index: number,
	clipped: boolean,
): TranscriptEntry[] {
	const type = str(parsed.type);
	const base = {
		index,
		uuid: str(parsed.uuid),
		parentUuid: str(parsed.parentUuid),
		timestamp: str(parsed.timestamp),
		isSidechain: parsed.isSidechain === true,
		...(clipped ? { clipped: true } : {}),
	};

	const message = (parsed.message ?? {}) as Record<string, unknown>;
	const model = str(message.model);
	const content = message.content;

	if (type === "user") {
		// Two very different things share this type: a real prompt carries a
		// string, whereas a tool result carries a list. Measured 19 prompts
		// against 163 tool results in one session, so conflating them would bury
		// what the user actually said.
		if (typeof content === "string") {
			return [{ ...base, kind: "prompt", text: content }];
		}
		if (Array.isArray(content)) {
			return content
				.filter((b): b is Record<string, unknown> => Boolean(b) && typeof b === "object")
				.map((b) => ({
					...base,
					kind: "tool_result" as const,
					text: blockText(b),
					toolUseId: str(b.tool_use_id),
				}));
		}
		return [{ ...base, kind: "prompt", text: "" }];
	}

	if (type === "assistant") {
		if (!Array.isArray(content)) return [{ ...base, kind: "reply", text: "", model }];
		return content
			.filter((b): b is Record<string, unknown> => Boolean(b) && typeof b === "object")
			.map((b) => {
				const bt = str(b.type);
				const kind: TranscriptKind =
					bt === "thinking" ? "thinking" : bt === "tool_use" ? "tool_use" : "reply";
				return {
					...base,
					kind,
					text: blockText(b),
					model,
					...(kind === "tool_use"
						? { toolName: str(b.name), toolUseId: str(b.id) }
						: {}),
				};
			});
	}

	if (type === "system") {
		return [{ ...base, kind: "system", text: str(parsed.content) ?? "" }];
	}

	if (type && BOOKKEEPING.has(type)) return [];

	// Never dropped. An unmodelled type is reported so a format change is a
	// number the caller can see rather than a shorter transcript nobody notices.
	return [{ ...base, kind: "unknown", text: "", rawType: type ?? "(missing)" }];
}

export interface ReadOptions {
	/** Skip this many ENTRIES (not lines) before collecting. */
	offset?: number;
	/** Collect at most this many entries. */
	limit?: number;
	/** Include bookkeeping and unknown entries. Off by default. */
	includeAll?: boolean;
}

export interface TranscriptPage {
	entries: TranscriptEntry[];
	stats: TranscriptStats;
	/** Total entries matching the filter, so a caller can page. */
	total: number;
	hasMore: boolean;
}

/**
 * Stream a transcript, returning one page and the whole file's statistics.
 *
 * Statistics cover the FILE, not the page: a caller showing "turn 40 of 900"
 * needs the second number, and computing it from a page would be wrong in a way
 * that looks right.
 */
export async function readTranscript(
	path: string,
	options: ReadOptions = {},
): Promise<TranscriptPage> {
	const offset = Math.max(options.offset ?? 0, 0);
	const limit = Math.max(options.limit ?? 200, 0);

	const stats: TranscriptStats = {
		path,
		bytes: 0,
		lines: 0,
		byKind: {},
		seenTypes: {},
		unrecognised: 0,
		unparseable: 0,
		clipped: 0,
		usage: {
			peakContextTokens: 0,
			lastContextTokens: 0,
			totalOutputTokens: 0,
			turns: 0,
			models: [],
		},
	};

	try {
		stats.bytes = (await stat(path)).size;
	} catch {
		return { entries: [], stats, total: 0, hasMore: false };
	}

	if (stats.bytes > MAX_TRANSCRIPT_BYTES) {
		// Refusing loudly beats freezing the panel.
		stats.tooLarge = true;
		return { entries: [], stats, total: 0, hasMore: false };
	}

	const models = new Set<string>();
	const entries: TranscriptEntry[] = [];
	let matched = 0;

	const rl = createInterface({
		input: createReadStream(path, { encoding: "utf-8" }),
		crlfDelay: Number.POSITIVE_INFINITY,
	});

	let index = 0;
	for await (const raw of rl) {
		if (!raw.trim()) continue;
		stats.lines++;

		let line = raw;
		let clipped = false;
		if (Buffer.byteLength(line, "utf-8") > MAX_LINE_BYTES) {
			line = line.slice(0, MAX_LINE_BYTES);
			clipped = true;
			stats.clipped++;
		}

		let parsed: Record<string, unknown>;
		try {
			parsed = JSON.parse(line) as Record<string, unknown>;
		} catch {
			// A clipped line will not parse; that is expected and already counted.
			stats.unparseable++;
			continue;
		}

		const type = str(parsed.type) ?? "(missing)";
		stats.seenTypes[type] = (stats.seenTypes[type] ?? 0) + 1;

		// Token accounting, from every assistant turn that carries it.
		if (type === "assistant") {
			const usage = ((parsed.message ?? {}) as Record<string, unknown>).usage as
				| Record<string, number>
				| undefined;
			if (usage) {
				const context =
					(usage.input_tokens ?? 0) +
					(usage.cache_read_input_tokens ?? 0) +
					(usage.cache_creation_input_tokens ?? 0);
				stats.usage.turns++;
				stats.usage.totalOutputTokens += usage.output_tokens ?? 0;
				stats.usage.lastContextTokens = context;
				if (context > stats.usage.peakContextTokens) {
					stats.usage.peakContextTokens = context;
				}
				const model = str(((parsed.message ?? {}) as Record<string, unknown>).model);
				if (model) models.add(model);
			}
		}

		for (const entry of toEntries(parsed, index++, clipped)) {
			if (entry.kind === "unknown") stats.unrecognised++;
			stats.byKind[entry.kind] = (stats.byKind[entry.kind] ?? 0) + 1;

			const wanted = options.includeAll || entry.kind !== "unknown";
			if (!wanted) continue;

			matched++;
			if (matched > offset && entries.length < limit) entries.push(entry);
		}
	}

	stats.usage.models = [...models].sort();
	return {
		entries,
		stats,
		total: matched,
		hasMore: offset + entries.length < matched,
	};
}

/** Statistics only — the whole file, none of the content. */
export async function transcriptStats(path: string): Promise<TranscriptStats> {
	const { stats } = await readTranscript(path, { limit: 0 });
	return stats;
}
