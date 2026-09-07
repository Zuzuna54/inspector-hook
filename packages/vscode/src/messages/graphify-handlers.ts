/**
 * Message handlers for the graphify code/docs graph (Milestone 4).
 *
 * Same contract as the research handlers, for the same reason: every command
 * answers, including on failure. A graph query that throws must render as a
 * failed query, not as a spinner — and in this domain the most likely failure
 * is entirely normal (no graph has been built for this repository yet), which
 * makes silence especially wrong.
 */

import type { WebviewMessage } from "@inspector-hook/protocol";
import {
	getGraphNeighbors,
	getGraphNode,
	getGraphStatus,
	searchGraph,
} from "../bridge/graphify-bridge.js";
import type { CoreBridge } from "../core-bridge.js";

export interface GraphifyHandlerContext {
	coreBridge: CoreBridge;
	send: (message: WebviewMessage) => void;
}

/** An empty status that says "unavailable" rather than "nothing here". */
function unavailable(error: string) {
	return {
		available: false,
		path: null,
		nodes: 0,
		edges: 0,
		communities: 0,
		byFileType: {},
		byRelation: {},
		builtAtCommit: null,
		builtAt: null,
		stale: null,
		headCommit: null,
		error,
	};
}

const reason = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

/**
 * Handle one graphify command.
 *
 * @returns true when the command was recognised and handled.
 */
export async function handleGraphifyCommand(
	command: string,
	params: unknown,
	ctx: GraphifyHandlerContext,
): Promise<boolean> {
	const rpc = ctx.coreBridge as unknown as {
		sendRequest<T>(method: string, params?: unknown): Promise<T>;
	};

	switch (command) {
		case "graph-status": {
			const root = (params as { root?: string })?.root;
			try {
				ctx.send({
					type: "graph-status",
					payload: await getGraphStatus(rpc, root),
				});
			} catch (error) {
				ctx.send({ type: "graph-status", payload: unavailable(reason(error)) });
			}
			return true;
		}

		case "graph-search": {
			const p = (params ?? {}) as {
				query?: string;
				limit?: number;
				fileType?: string;
				root?: string;
			};
			const query = typeof p.query === "string" ? p.query.trim() : "";
			if (!query) {
				ctx.send({
					type: "graph-results",
					payload: { hits: [], total: 0, terms: [], searched: 0 },
				});
				return true;
			}
			try {
				ctx.send({
					type: "graph-results",
					payload: await searchGraph(rpc, {
						query,
						limit: p.limit,
						fileType: p.fileType,
						root: p.root,
					}),
				});
			} catch (error) {
				ctx.send({
					type: "graph-results",
					payload: {
						hits: [],
						total: 0,
						terms: [],
						searched: 0,
						error: reason(error),
					},
				});
			}
			return true;
		}

		case "graph-neighbors": {
			const p = (params ?? {}) as {
				id?: string;
				depth?: number;
				relations?: string[];
				limit?: number;
				root?: string;
			};
			if (!p.id) {
				ctx.send({
					type: "graph-neighbors",
					payload: { id: null, neighbors: [] },
				});
				return true;
			}
			try {
				ctx.send({
					type: "graph-neighbors",
					payload: await getGraphNeighbors(rpc, {
						id: p.id,
						depth: p.depth,
						relations: p.relations,
						limit: p.limit,
						root: p.root,
					}),
				});
			} catch (error) {
				ctx.send({
					type: "graph-neighbors",
					payload: { id: p.id, neighbors: [], error: reason(error) },
				});
			}
			return true;
		}

		case "graph-get": {
			const p = (params ?? {}) as { id?: string; root?: string };
			const node = p.id
				? await getGraphNode(rpc, p.id, p.root).catch(() => null)
				: null;
			ctx.send({ type: "graph-node", payload: node });
			return true;
		}

		default:
			return false;
	}
}
