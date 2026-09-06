/**
 * Compose a tray item from selected transcript turns.
 *
 * This is what the digest could never be. A digest is derived from hook events
 * — counts of tools, lists of files — so it can say a session touched fifteen
 * files and nothing about what was decided. The transcript holds what was
 * actually said, and this turns a selection of it into context worth injecting.
 *
 * ## The selection is resolved HERE, not in the panel
 *
 * The webview already holds the entries it rendered, so composing client-side
 * would be one line shorter. It would also mean the text that reaches a future
 * session came from a copy the panel happened to be holding, which can be stale
 * the moment the transcript grows. Selecting by INDEX against a fresh read means
 * the item carries what the transcript says now, and a selection that no longer
 * resolves is reported rather than silently producing a shorter item.
 */

import {
	type TranscriptEntry,
	readTranscript,
} from "../transcript/transcript-reader.js";

/** How a composed entry is labelled in the rendered item. */
const LABELS: Record<string, string> = {
	prompt: "User",
	reply: "Claude",
	thinking: "Claude (thinking)",
	tool_use: "Tool call",
	tool_result: "Tool result",
	system: "System",
	unknown: "Unrecognised entry",
};

/**
 * Per-entry cap.
 *
 * A single tool result can run to hundreds of kilobytes, and one of those would
 * consume the whole tray budget on its own. Cut here, visibly, rather than
 * letting the renderer silently drop everything after it.
 */
export const MAX_ENTRY_BYTES = 8 * 1024;

function clip(text: string): { text: string; clipped: boolean } {
	const buf = Buffer.from(text, "utf-8");
	if (buf.length <= MAX_ENTRY_BYTES) return { text, clipped: false };
	let end = MAX_ENTRY_BYTES;
	while (end > 0 && (buf[end] & 0b1100_0000) === 0b1000_0000) end--;
	return { text: buf.subarray(0, end).toString("utf-8"), clipped: true };
}

/** Render one entry as a labelled markdown block. */
function renderEntry(entry: TranscriptEntry): string {
	const label = LABELS[entry.kind] ?? entry.kind;
	const heading =
		entry.kind === "tool_use" && entry.toolName
			? `**${label}: ${entry.toolName}**`
			: `**${label}**`;
	const { text, clipped } = clip(entry.text ?? "");
	const body = text.trim() ? text : "_(empty)_";
	return `${heading}\n\n${body}${clipped ? "\n\n_(truncated)_" : ""}`;
}

export interface ComposeResult {
	text: string;
	/** How many of the requested indexes actually resolved. */
	matched: number;
	requested: number;
	/** Indexes that did not resolve, so a caller can say which. */
	missing: number[];
	reason?: string;
}

/**
 * Build the text of a tray item from a transcript selection.
 *
 * Ordered by transcript position rather than by selection order: the point of
 * carrying turns across is that they read as a conversation, and a caller
 * clicking in an arbitrary order should not produce a scrambled record.
 */
export async function composeFromTranscript(
	transcriptPath: string,
	indexes: number[],
): Promise<ComposeResult> {
	const wanted = [...new Set(indexes.filter((n) => Number.isInteger(n) && n >= 0))].sort(
		(a, b) => a - b,
	);
	if (wanted.length === 0) {
		return {
			text: "",
			matched: 0,
			requested: 0,
			missing: [],
			reason: "Nothing selected.",
		};
	}

	// Read far enough to cover the highest index asked for. Reading the whole
	// file would be simpler and, on a 48 MB transcript, wasteful for a selection
	// of four turns.
	const { entries } = await readTranscript(transcriptPath, {
		limit: Math.max(...wanted) + 1,
		includeAll: true,
	});

	const byIndex = new Map(entries.map((e) => [e.index, e]));
	const selected: TranscriptEntry[] = [];
	const missing: number[] = [];
	for (const n of wanted) {
		const entry = byIndex.get(n);
		if (entry) selected.push(entry);
		else missing.push(n);
	}

	if (selected.length === 0) {
		return {
			text: "",
			matched: 0,
			requested: wanted.length,
			missing,
			reason:
				"None of the selected turns are in the transcript any more. It may have been compacted or replaced.",
		};
	}

	return {
		text: selected.map(renderEntry).join("\n\n---\n\n"),
		matched: selected.length,
		requested: wanted.length,
		missing,
	};
}

/**
 * A title for a composed item, derived from what was selected.
 *
 * Uses the first prompt when there is one, because "what was asked" is what a
 * person recognises the selection by. Falls back to a count rather than
 * inventing a summary — a made-up title is a small false claim and this corpus
 * has enough of those.
 */
export function composeTitle(entries: TranscriptEntry[]): string {
	const prompt = entries.find((e) => e.kind === "prompt" && e.text?.trim());
	if (prompt) {
		const line = prompt.text.replace(/\s+/g, " ").trim();
		return line.length > 60 ? `${line.slice(0, 59)}…` : line;
	}
	return `${entries.length} turn${entries.length === 1 ? "" : "s"} from a session`;
}
