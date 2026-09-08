/**
 * Agents and subagents over IPC (Milestone 5).
 *
 * Sits beside research-bridge.ts and graphify-bridge.ts and stays separate for
 * the same reason: the agent tree answers "what ran, what was it asked, what
 * came back", which is neither a text search nor a graph query.
 */

import type {
	AgentRecord,
	AgentStats,
	AgentTreeResult,
} from "@inspector-hook/protocol";

/** What this module needs from the bridge, so it can be tested without one. */
export interface AgentsRpc {
	sendRequest<T>(method: string, params?: unknown): Promise<T>;
}

export interface AgentTreeParams {
	/** Scope to one session. Omit for every agent this core has seen. */
	sessionId?: string;
	limit?: number;
}

/**
 * The tree, newest first, with its stats.
 *
 * Stats travel with the tree rather than in a second call because the two
 * numbers that matter most — how many agents were never linked to a spawn
 * call, and how many only ever returned an acknowledgement — describe the tree
 * being rendered and would be misleading if they came from a different moment.
 */
export async function getAgentTree(
	rpc: AgentsRpc,
	params: AgentTreeParams = {},
): Promise<AgentTreeResult> {
	return rpc.sendRequest<AgentTreeResult>("agents.getTree", params);
}

/** One agent, by our id or by the platform's `agentId`. */
export async function getAgent(
	rpc: AgentsRpc,
	id: string,
): Promise<AgentRecord | null> {
	return rpc.sendRequest<AgentRecord | null>("agents.get", { id });
}

export async function getAgentStats(rpc: AgentsRpc): Promise<AgentStats> {
	return rpc.sendRequest<AgentStats>("agents.getStats", {});
}
