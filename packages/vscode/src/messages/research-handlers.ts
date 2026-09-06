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

		case "research-enable-embeddings": {
			try {
				const r = await rpc.sendRequest<{
					available: boolean;
					embedded: number;
					error?: string;
				}>("research.enableEmbeddings", {});
				// Normalised to one shape. The two core methods both return a
				// field called `embedded` meaning different things -- a corpus
				// total here, a batch size there -- and the view's backfill loop
				// reads it to decide whether to continue. Left unnormalised, a
				// fresh corpus reported `embedded: 0` from enable and the loop
				// never started at all.
				ctx.send({
					type: "research-embeddings",
					payload: {
						available: r.available,
						embedded: r.embedded,
						// undefined, not 0: no batch has run yet, which is
						// different from a batch that embedded nothing.
						batch: undefined,
						error: r.error,
					},
				});
			} catch (error) {
				// A model that will not load is a state to render, not a crash:
				// search keeps working on BM25 alone.
				ctx.send({
					type: "research-embeddings",
					payload: {
						available: false,
						embedded: 0,
						batch: 0,
						error: error instanceof Error ? error.message : String(error),
					},
				});
			}
			return true;
		}

		case "research-embed-pending": {
			const limit = (params as { limit?: number })?.limit;
			try {
				const r = await rpc.sendRequest<{
					embedded: number;
					total: number;
					available: boolean;
				}>("research.embedPending", { limit });
				ctx.send({
					type: "research-embeddings",
					payload: {
						available: r.available,
						embedded: r.total,
						// How many THIS call embedded. Zero ends the loop.
						batch: r.embedded,
					},
				});
			} catch (error) {
				ctx.send({
					type: "research-embeddings",
					payload: {
						available: false,
						embedded: 0,
						batch: 0,
						error: error instanceof Error ? error.message : String(error),
					},
				});
			}
			return true;
		}

		default:
			return false;
	}
}
