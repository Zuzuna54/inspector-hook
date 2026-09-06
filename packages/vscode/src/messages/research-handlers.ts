/**
 * Message handlers for research history search (Milestone 4).
 *
 * Same shape as the memory handlers: the function reports whether it took the
 * command so panel.ts can fall through, and everything it needs arrives in a
 * context rather than through `this`, which is what makes it testable without a
 * webview.
 *
 * Errors are answered rather than thrown. A search that fails must render as a
 * failed search — an unanswered message leaves the view on its loading state
 * forever, which is the exact failure this project has now shipped three times
 * (the diff-error gap, the version-content chain, and the digest envelope).
 */

import type { WebviewMessage } from "@inspector-hook/protocol";
import type { CoreBridge } from "../core-bridge.js";
import {
	getResearchItem,
	getResearchStats,
	searchResearch,
} from "../bridge/research-bridge.js";

export interface ResearchHandlerContext {
	coreBridge: CoreBridge;
	send: (message: WebviewMessage) => void;
}

/**
 * Handle one research command.
 *
 * @returns true when the command was recognised and handled.
 */
export async function handleResearchCommand(
	command: string,
	params: unknown,
	ctx: ResearchHandlerContext,
): Promise<boolean> {
	// The bridge exposes sendRequest; the research functions need only that.
	const rpc = ctx.coreBridge as unknown as {
		sendRequest<T>(method: string, params?: unknown): Promise<T>;
	};

	switch (command) {
		case "research-search": {
			const p = (params ?? {}) as {
				query?: string;
				projectKey?: string;
				kinds?: string[];
				limit?: number;
				semantic?: boolean;
			};
			const query = typeof p.query === "string" ? p.query.trim() : "";
			if (!query) {
				// An empty query is not an error; it is the initial state. Answering
				// with an empty result lets the view render "type something" rather
				// than a spinner.
				ctx.send({
					type: "research-results",
					payload: { hits: [], total: 0, searched: 0, terms: [], scope: "all" },
				});
				return true;
			}
			try {
				const result = await searchResearch(rpc, {
					query,
					projectKey: p.projectKey,
					kinds: p.kinds as never,
					limit: p.limit,
					semantic: p.semantic,
				});
				ctx.send({ type: "research-results", payload: result });
			} catch (error) {
				ctx.send({
					type: "research-results",
					payload: {
						hits: [],
						total: 0,
						searched: 0,
						terms: [],
						scope: "all",
						error: error instanceof Error ? error.message : String(error),
					},
				});
			}
			return true;
		}

		case "research-get": {
			const id = (params as { id?: string })?.id;
			const item = id ? await getResearchItem(rpc, id).catch(() => null) : null;
			ctx.send({ type: "research-item", payload: item });
			return true;
		}

		case "research-stats": {
			try {
				ctx.send({
					type: "research-stats",
					payload: await getResearchStats(rpc),
				});
			} catch {
				// Stats drive a header line. Failing to load them must not stop the
				// view rendering, so an empty shape is sent rather than nothing.
				ctx.send({
					type: "research-stats",
					payload: { items: 0, terms: 0, byKind: {}, byProject: {} },
				});
			}
			return true;
		}

		default:
			return false;
	}
}
