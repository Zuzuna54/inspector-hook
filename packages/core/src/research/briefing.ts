/**
 * Prior-work briefings (Milestone 5).
 *
 * ## The problem this solves, which the MCP server alone does not
 *
 * M5 exposed prior findings over MCP and that is pull-only: a later agent has
 * to decide to ask, and then guess what to ask for. Search needs a query, and a
 * fresh agent cannot query for "a-m5 audited the agent tree" because it has no
 * idea that happened. An available API is not a handoff.
 *
 * A briefing inverts it. Given nothing but the task an agent is about to start,
 * it answers "here is what is already known about this" — and names the tools
 * to drill into. Discovery first, search second.
 *
 * ## Why these four sections, in this order
 *
 * Ordered by value per token, because this text is prepended to a subagent's
 * prompt and every character costs it context:
 *
 *  1. **Conclusions matching the task.** The most directly useful thing: what
 *     was already decided about the thing this agent is about to do.
 *  2. **Agents whose findings never came back.** 14 of 173 in the live store
 *     acknowledged their spawn and never reported, so their work exists
 *     NOWHERE else. Unique information, and the gap M5 exists to expose.
 *  3. **Files the prior work touched.** Orients an agent toward where to look,
 *     which is cheaper than telling it what was concluded everywhere.
 *  4. **Pages already fetched.** Stops an agent re-reading documentation an
 *     earlier one already read.
 *
 * ## Two rules that keep this from doing harm
 *
 * **A weak match is worse than nothing.** A briefing that confidently cites
 * loosely-related work will send an agent down the wrong path, so the match
 * count and the retrieval mode are always stated, and a briefing with nothing
 * relevant returns empty rather than padding itself with the merely recent.
 *
 * **It is bounded.** Prepending unbounded text to a prompt is a way to spend
 * someone else's context, so every section is capped and the whole thing is
 * truncated at `maxChars`.
 */

import type { ResearchItem } from "@inspector-hook/protocol";

import type { AgentTracker } from "../managers/agent-tracker.js";
import type { GraphifyReader } from "./graphify.js";
import type { ResearchIndex } from "./research-index.js";

/** Default ceiling for a whole briefing. */
export const DEFAULT_MAX_CHARS = 2_000;

/** Items considered per section before trimming. */
export const PER_SECTION = 3;

/**
 * A hit must score at least this to be cited.
 *
 * BM25 scores are unbounded, so this is a floor on "the retrieval actually
 * matched something" rather than a calibrated relevance threshold. Its job is
 * to stop a briefing being assembled out of the merely recent when the task
 * has no prior work at all.
 */
export const MIN_SCORE = 1.0;

export interface BriefingSection {
	title: string;
	lines: string[];
}

export interface Briefing {
	/** Ready to prepend to a prompt. Empty when nothing relevant was found. */
	text: string;
	sections: BriefingSection[];
	/** How many items were cited, across every section. */
	cited: number;
	/** How many the corpus held in scope, so a reader can judge coverage. */
	searched: number;
	/** "lexical" or "hybrid" — whether embeddings were in play. */
	retrieval: string;
	/** True when there was nothing worth saying. */
	empty: boolean;
}

export interface BriefingInput {
	index: ResearchIndex;
	tracker: AgentTracker;
	graphify?: GraphifyReader;
	/** Scope. Omit to draw on every project, which is rarely what you want. */
	projectKey?: string;
	/** The task about to start. Drives relevance; without it, nothing is cited. */
	task?: string;
	maxChars?: number;
}

const oneLine = (text: unknown, max: number): string =>
	String(text ?? "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, max);

/** Search one kind, keeping only hits that actually matched. */
async function relevant(
	index: ResearchIndex,
	task: string,
	kinds: string[],
	projectKey: string | undefined,
	limit: number,
): Promise<{ items: ResearchItem[]; searched: number; retrieval: string }> {
	const options = {
		limit: limit * 3,
		projectKey,
		kinds: kinds as never,
	};
	const result = index.embeddingsAvailable
		? await index.searchHybrid(task, options)
		: index.search(task, options);

	// Hybrid scores are fused ranks, not BM25 magnitudes, so the floor only
	// applies to the lexical path. Applying it to both would silently drop
	// every hybrid hit.
	const floor = result.retrieval === "hybrid" ? 0 : MIN_SCORE;
	const items = result.hits
		.filter((h) => h.score >= floor)
		.slice(0, limit)
		.map((h) => h.item);

	return {
		items,
		searched: result.searched,
		retrieval: result.retrieval ?? "lexical",
	};
}

/**
 * Build a briefing for a task that is about to start.
 *
 * Returns an empty briefing rather than a padded one when nothing relevant
 * exists. That is the common case for a genuinely new task, and saying nothing
 * is the correct answer there.
 */
export async function buildBriefing(input: BriefingInput): Promise<Briefing> {
	const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS;
	// Coerced, not assumed: this is called from an IPC method and an HTTP
	// endpoint, so `task` arrives from outside and a number would crash on
	// .trim().
	const task = typeof input.task === "string" ? input.task.trim() : "";
	const sections: BriefingSection[] = [];
	let searched = 0;
	let retrieval = "lexical";

	// 1. What was already concluded about this.
	if (task) {
		const found = await relevant(
			input.index,
			task,
			["conclusion"],
			input.projectKey,
			PER_SECTION,
		);
		searched = found.searched;
		retrieval = found.retrieval;
		if (found.items.length > 0) {
			sections.push({
				title: "Already concluded",
				lines: found.items.map(
					(i) =>
						`(${i.timestamp?.slice(0, 10) ?? "?"}) ${oneLine(i.text || i.title, 150)}`,
				),
			});
		}
	}

	// 2. Agents whose findings never reached anyone. Unique information.
	const unreported = input.tracker
		.getTree({ limit: 500 })
		.filter((a) => a.resultKind === "spawn-ack" && a.description)
		.slice(0, PER_SECTION);
	if (unreported.length > 0) {
		sections.push({
			title: "Earlier agents whose findings never came back",
			lines: unreported.map(
				(a) =>
					`[${a.name ?? a.type ?? a.id}] asked: "${oneLine(a.description, 80)}" ` +
					`— ${a.toolCalls.length} tool calls, never reported. Use list_agents.`,
			),
		});
	}

	// 3. Where the prior work happened.
	if (task) {
		const files = await relevant(
			input.index,
			task,
			["file_read"],
			input.projectKey,
			PER_SECTION,
		);
		const paths = [
			...new Set(files.items.map((i) => oneLine(i.title || i.text, 90))),
		].filter(Boolean);

		// Symbols come from graphify when a graph exists, and are skipped rather
		// than guessed at when the graph is stale -- a stale graph names symbols
		// that may no longer exist, which is exactly the wrong thing to hand an
		// agent as a starting point.
		const symbols: string[] = [];
		const status = input.graphify?.status();
		if (status?.available && status.stale === false) {
			for (const hit of input.graphify?.search(task, { limit: PER_SECTION })
				?.hits ?? []) {
				symbols.push(`${hit.node.label} (${hit.node.sourceFile})`);
			}
		}

		const lines = [...paths, ...symbols];
		if (lines.length > 0) {
			sections.push({ title: "Where this work lives", lines });
		}
	}

	// 4. What was already fetched, so it is not fetched again.
	if (task) {
		const web = await relevant(
			input.index,
			task,
			["web_search", "web_fetch"],
			input.projectKey,
			PER_SECTION,
		);
		if (web.items.length > 0) {
			sections.push({
				title: "Already looked up",
				lines: web.items.map((i) => oneLine(i.url || i.title, 110)),
			});
		}
	}

	const cited = sections.reduce((n, s) => n + s.lines.length, 0);
	if (cited === 0) {
		return {
			text: "",
			sections: [],
			cited: 0,
			searched,
			retrieval,
			empty: true,
		};
	}

	const header =
		"## Prior work on this repository (captured by Inspector Hook)\n" +
		`${cited} related item${cited === 1 ? "" : "s"} from ${searched} indexed ` +
		`(${retrieval} retrieval). Treat as leads, not conclusions.`;

	const body = sections
		.map((s) => `\n### ${s.title}\n${s.lines.map((l) => `- ${l}`).join("\n")}`)
		.join("\n");

	const footer =
		"\n\nAsk `search_history`, `list_agents` or `search_code` for detail.";

	let text = `${header}${body}${footer}`;
	if (text.length > maxChars) {
		text = `${text.slice(0, maxChars)}\n… briefing truncated.`;
	}

	return { text, sections, cited, searched, retrieval, empty: false };
}
