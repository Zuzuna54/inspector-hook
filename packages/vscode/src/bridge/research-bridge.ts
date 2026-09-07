/**
 * Research history over IPC (Milestone 4).
 *
 * The core has indexed research since M4 landed — 569 items in the live store
 * at the time of writing — and `packages/vscode` contained **zero references to
 * `research`**. Three methods were registered, tested, and callable by nothing.
 * This is the half that makes the index reachable.
 *
 * Split from core-bridge.ts rather than added to it: that file is over its size
 * limit with one method per IPC call, and its allowlist entry says the
 * remaining domains split out this way. Memory went first; research follows the
 * same shape.
 */

import type {
	ResearchIndexStats,
	ResearchItem,
	ResearchKind,
	ResearchSearchResult,
} from "@inspector-hook/protocol";

/** What this module needs from the bridge, so it can be tested without one. */
export interface ResearchRpc {
	sendRequest<T>(method: string, params?: unknown): Promise<T>;
}

export interface ResearchSearchParams {
	query: string;
	/** Scope to one project. Omit to search every project on the machine. */
	projectKey?: string;
	kinds?: ResearchKind[];
	since?: string;
	limit?: number;
	/**
	 * Opt in to corpus-derived query expansion.
	 *
	 * Defaults off in the core, because it was measured against the live corpus
	 * and did not improve retrieval. Exposed so it can be evaluated, not because
	 * it is recommended.
	 */
	semantic?: boolean;
}

/**
 * Search the research corpus.
 *
 * Cross-project by default. That is the whole point of a machine-wide core and
 * the thing per-project native memory structurally cannot do — "where did I
 * solve this before" is only answerable across projects. Passing `projectKey`
 * narrows it, and the result always reports which scope it used, so a hit count
 * never leaves its own breadth implicit.
 */
export async function searchResearch(
	rpc: ResearchRpc,
	params: ResearchSearchParams,
): Promise<ResearchSearchResult> {
	return rpc.sendRequest<ResearchSearchResult>("research.search", params);
}

/**
 * One item by id.
 *
 * Needed because a hit's log entry may be long gone: retention deletes raw
 * events while the index deliberately outlives them, so the item held here is
 * the only remaining copy.
 */
export async function getResearchItem(
	rpc: ResearchRpc,
	id: string,
): Promise<ResearchItem | null> {
	return rpc.sendRequest<ResearchItem | null>("research.get", { id });
}

/** Size and composition, including the project a caller should default to. */
export async function getResearchStats(
	rpc: ResearchRpc,
): Promise<ResearchIndexStats> {
	return rpc.sendRequest<ResearchIndexStats>("research.getStats", {});
}
