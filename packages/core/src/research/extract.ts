/**
 * Turn captured hook events into indexable research items.
 *
 * Every field read here was verified against real captured payloads rather than
 * taken from the documentation, because this project has repeatedly found the
 * two disagreeing — a `details.toolUseId` that is actually top-level
 * `tool_use_id`, a `details.promptId` nothing ever wrote. The shapes below were
 * read off the live store:
 *
 *   WebSearch   details.tool_input.query, details.tool_result.results[]
 *   WebFetch    details.tool_input.{url,prompt}, details.tool_result.result
 *   Task/Agent  details.tool_input.{description,prompt}
 *   Subagent    details.lastAssistantMessage, details.agentType
 *   Prompts     details.prompt
 *
 * Extraction is pure and total: anything unrecognised returns null rather than
 * throwing, so one odd payload can never stop the index from being built.
 */

import type { LogEntry, ResearchItem, ResearchKind } from "@inspector-hook/protocol";

/**
 * Cap on any single item's text.
 *
 * A fetched page can be hundreds of kilobytes. Indexing it whole would let one
 * document dominate the vocabulary and blow up the persisted index, and BM25
 * already discounts long documents rather than rewarding them.
 */
export const MAX_ITEM_TEXT = 8 * 1024;

/** Read a nested value without trusting any level of the path to exist. */
function rec(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function str(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function clip(text: string): string {
	return text.length <= MAX_ITEM_TEXT ? text : text.slice(0, MAX_ITEM_TEXT);
}

/**
 * The project an item belongs to.
 *
 * Git remote first because it survives the same repository being cloned to two
 * paths; the working directory is the fallback. Both are on every hook event,
 * so nothing has to be inferred.
 */
export function projectKeyFor(
	details: Record<string, unknown> | undefined,
): string | undefined {
	return str(details?.gitRemote) ?? str(details?.cwd);
}

/**
 * Extract a research item from one log entry, or null if it holds none.
 *
 * Only PostToolUse is read for tool events: PreToolUse has the input but not
 * the result, and indexing both would double every entry under two ids.
 */
export function extractResearchItem(log: LogEntry): ResearchItem | null {
	const details = rec(log.details);
	const base = {
		id: log.id,
		timestamp: log.timestamp,
		sessionId: log.sessionId,
		projectKey: projectKeyFor(details),
		projectName: str(details?.projectName),
		promptId: str((log as { promptId?: unknown }).promptId),
	};

	const input = rec(details?.tool_input);
	const result = rec(details?.tool_result);
	const isPost = log.hook === "PostToolUse" || log.event === "PostToolUse";

	// --- Web search: the query, and the titles it surfaced ---------------
	if (isPost && log.tool === "WebSearch") {
		const query = str(input?.query) ?? str(result?.query);
		if (!query) return null;
		const titles = Array.isArray(result?.results)
			? (result.results as unknown[])
					.flatMap((r) => {
						const entry = rec(r);
						const content = Array.isArray(entry?.content) ? entry.content : [];
						return content.map((c) => {
							const item = rec(c);
							return [str(item?.title), str(item?.url)]
								.filter(Boolean)
								.join(" — ");
						});
					})
					.filter((t) => t.length > 0)
			: [];
		return {
			...base,
			kind: "web_search",
			title: query,
			text: clip([query, ...titles].join("\n")),
		};
	}

	// --- Web fetch: the URL, what was asked of it, and what came back -----
	if (isPost && log.tool === "WebFetch") {
		const url = str(input?.url);
		if (!url) return null;
		const ask = str(input?.prompt);
		const body = str(result?.result);
		return {
			...base,
			kind: "web_fetch",
			title: url,
			url,
			text: clip([url, ask, body].filter(Boolean).join("\n\n")),
		};
	}

	// --- Delegated work: what a subagent was asked to do ------------------
	if (isPost && (log.tool === "Task" || log.tool === "Agent")) {
		const description = str(input?.description);
		const prompt = str(input?.prompt);
		if (!description && !prompt) return null;
		return {
			...base,
			kind: "subagent_task",
			agentType: str(input?.subagent_type),
			title: description ?? "Delegated task",
			text: clip([description, prompt].filter(Boolean).join("\n\n")),
		};
	}

	// --- Which files were read ---------------------------------------------
	//
	// Named in M4's capture list alongside web lookups and subagent reports,
	// and missed on the first pass. Only the PATH is indexed, never the
	// contents: a Read result is the file itself, so indexing it would put a
	// copy of the codebase into the research corpus -- enormous, redundant with
	// the files on disk, and it would drown every other kind of item in the
	// ranking. The useful question is "which files did I look at when working
	// on X", and the path answers it.
	if (isPost && log.tool === "Read") {
		const path = str(input?.file_path) ?? str(log.file);
		if (!path) return null;
		return {
			...base,
			// A stable id per file, NOT the log id.
			//
			// Reading a file twenty times is one fact observed twenty times, not
			// twenty facts. Measured on the real corpus: 165 read events over
			// 100 distinct paths, with ipc-server.ts alone appearing 14 times.
			// Keying on the path makes a re-read REPLACE, so the item carries the
			// most recent read and the corpus is not padded with duplicates that
			// crowd out the other kinds in the ranking.
			id: `read:${base.projectKey ?? "-"}:${path}`,
			kind: "file_read",
			title: path,
			// The path is split on separators by the tokeniser, so a search for
			// "file-tracker" finds it. The offset/limit are included because
			// "which part of the file" is part of what was looked at.
			text: [path, str(input?.offset), str(input?.limit)]
				.filter(Boolean)
				.join(" "),
		};
	}

	// --- What a subagent reported back ------------------------------------
	if (log.hook === "SubagentStop" || log.event === "subagent.stop") {
		const message = str(details?.lastAssistantMessage);
		if (!message) return null;
		const agentType = str(details?.agentType);
		return {
			...base,
			kind: "subagent_report",
			agentType,
			title: agentType ? `${agentType} report` : "Subagent report",
			text: clip(message),
		};
	}

	// --- What the user asked ----------------------------------------------
	if (log.hook === "UserPromptSubmit" || log.event === "UserPromptSubmit") {
		const prompt = str(details?.prompt) ?? str(log.message);
		if (!prompt) return null;
		return {
			...base,
			kind: "user_prompt",
			title: firstLine(prompt),
			text: clip(prompt),
		};
	}

	// --- What was concluded ------------------------------------------------
	//
	// Stop only. StopFailure carries an API error in the same field, and
	// indexing "API Error: rate limit reached" as a conclusion would put
	// noise into the corpus that reads exactly like a finding.
	if (log.hook === "Stop" || log.event === "ai.response") {
		const message = str(details?.lastAssistantMessage);
		if (!message) return null;
		return {
			...base,
			kind: "conclusion",
			title: firstLine(message),
			text: clip(message),
		};
	}

	return null;
}

function firstLine(text: string): string {
	const line = text.split("\n").find((l) => l.trim().length > 0) ?? text;
	const flat = line.trim();
	return flat.length <= 120 ? flat : `${flat.slice(0, 119)}…`;
}

/** Which kinds an extractor can produce, for stats and filters. */
export const RESEARCH_KINDS: readonly ResearchKind[] = [
	"web_search",
	"web_fetch",
	"subagent_task",
	"subagent_report",
	"user_prompt",
	"conclusion",
	"file_read",
];
