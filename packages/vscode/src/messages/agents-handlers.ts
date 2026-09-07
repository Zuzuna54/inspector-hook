/**
 * Message handlers for the agent tree (Milestone 5).
 *
 * Same contract as the research and graphify handlers: every command answers,
 * including on failure, because an unanswered message leaves the view on its
 * loading state forever — the failure this project has now shipped four times.
 */

import type { WebviewMessage } from "@inspector-hook/protocol";
import {
	getAgent,
	getAgentStats,
	getAgentTree,
} from "../bridge/agents-bridge.js";
import type { CoreBridge } from "../core-bridge.js";

export interface AgentsHandlerContext {
	coreBridge: CoreBridge;
	send: (message: WebviewMessage) => void;
}

/** An empty tree that says why, rather than looking like "no agents ran". */
const emptyTree = (error: string) => ({
	agents: [],
	stats: {
		total: 0,
		running: 0,
		completed: 0,
		unknown: 0,
		unlinked: 0,
		spawnAckOnly: 0,
		byType: {},
		totalToolCalls: 0,
	},
	error,
});

const reason = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

/**
 * Handle one agents command.
 *
 * @returns true when the command was recognised and handled.
 */
export async function handleAgentsCommand(
	command: string,
	params: unknown,
	ctx: AgentsHandlerContext,
): Promise<boolean> {
	const rpc = ctx.coreBridge as unknown as {
		sendRequest<T>(method: string, params?: unknown): Promise<T>;
	};

	switch (command) {
		case "agents-tree": {
			const p = (params ?? {}) as { sessionId?: string; limit?: number };
			try {
				ctx.send({
					type: "agents-tree",
					payload: await getAgentTree(rpc, {
						sessionId: p.sessionId,
						limit: p.limit,
					}),
				});
			} catch (error) {
				ctx.send({ type: "agents-tree", payload: emptyTree(reason(error)) });
			}
			return true;
		}

		case "agents-get": {
			const id = (params as { id?: string })?.id;
			const agent = id ? await getAgent(rpc, id).catch(() => null) : null;
			ctx.send({ type: "agent-detail", payload: agent });
			return true;
		}

		case "agents-stats": {
			try {
				ctx.send({ type: "agents-stats", payload: await getAgentStats(rpc) });
			} catch {
				ctx.send({ type: "agents-stats", payload: emptyTree("").stats });
			}
			return true;
		}

		default:
			return false;
	}
}
