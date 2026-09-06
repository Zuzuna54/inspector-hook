/**
 * Graphify's code/docs graph over IPC (Milestone 4).
 *
 * Sits beside research-bridge.ts and stays separate from it for the same reason
 * the core keeps two indexes: the research index answers "what did I look up
 * and conclude", this answers "what is this symbol and what touches it". One
 * search box can offer both; one bridge module should not pretend they are the
 * same query.
 */

import type {
	GraphNeighborsResult,
	GraphNode,
	GraphSearchResult,
	GraphStatus,
} from "@inspector-hook/protocol";

/** What this module needs from the bridge, so it can be tested without one. */
export interface GraphifyRpc {
	sendRequest<T>(method: string, params?: unknown): Promise<T>;
}

export interface GraphSearchParams {
	query: string;
	limit?: number;
	/** "code" | "document" | "rationale" — omit for all. */
	fileType?: string;
	/** Repository to search. Omit for the core's workspace. */
	root?: string;
}

export interface GraphNeighborsParams {
	id: string;
	depth?: number;
	relations?: string[];
	limit?: number;
	root?: string;
}

/**
 * Whether a graph exists, how big it is, and whether it still matches HEAD.
 *
 * The status is what makes the rest honest: a graph built ten commits ago will
 * confidently return symbols that no longer exist, so the view has to be able
 * to say so.
 */
export async function getGraphStatus(
	rpc: GraphifyRpc,
	root?: string,
): Promise<GraphStatus> {
	return rpc.sendRequest<GraphStatus>("graphify.status", root ? { root } : {});
}

export async function searchGraph(
	rpc: GraphifyRpc,
	params: GraphSearchParams,
): Promise<GraphSearchResult> {
	return rpc.sendRequest<GraphSearchResult>("graphify.search", params);
}

export async function getGraphNode(
	rpc: GraphifyRpc,
	id: string,
	root?: string,
): Promise<GraphNode | null> {
	return rpc.sendRequest<GraphNode | null>("graphify.get", { id, root });
}

/** What a node connects to — the query a text index cannot answer at all. */
export async function getGraphNeighbors(
	rpc: GraphifyRpc,
	params: GraphNeighborsParams,
): Promise<GraphNeighborsResult> {
	return rpc.sendRequest<GraphNeighborsResult>("graphify.neighbors", params);
}
