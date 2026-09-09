/**
 * Message handlers for the four-corpus search (M3 P8).
 *
 * Same shape as the research and memory handlers: the function reports whether
 * it took the command so `panel.ts` can fall through, and its dependencies
 * arrive in a context rather than through `this`, which is what makes it
 * testable without a webview.
 *
 * ## Every failure is answered
 *
 * A search that fails must render AS a failed search. An unanswered message
 * leaves the view on its loading state forever — the failure this project has
 * now shipped three times (the diff-error gap, the version-content chain, the
 * digest envelope), and each time it looked like a hang rather than an error.
 *
 * ## The error goes on the group, not beside it
 *
 * When the core cannot be reached, every corpus is equally unreachable, so the
 * reply is the full set of groups each carrying `unavailable`. That keeps one
 * rendering path: the view draws groups, and a group that could not be
 * searched says why. A separate top-level `error` would need a second path
 * that only appears when something is broken — the path least likely to have
 * been looked at.
 */

import type {
	ContextCorpus,
	ContextFindResult,
	ContextFindStats,
	ContextGroup,
	WebviewMessage,
} from "@inspector-hook/protocol";
import { CONTEXT_CORPORA } from "@inspector-hook/protocol";
import type { CoreBridge } from "../core-bridge.js";

export interface FindHandlerContext {
	coreBridge: CoreBridge;
	send: (message: WebviewMessage) => void;
}

interface Rpc {
	sendRequest<T>(method: string, params?: unknown): Promise<T>;
}

/** An empty group per corpus, optionally carrying why it is empty. */
function emptyGroups(reason?: string): ContextGroup[] {
	return CONTEXT_CORPORA.map((corpus: ContextCorpus) => ({
		corpus,
		hits: [],
		total: 0,
		searched: 0,
		terms: [],
		...(reason ? { unavailable: reason } : {}),
	}));
}

function emptyResult(query: string, reason?: string): ContextFindResult {
	return { query, scope: "all", groups: emptyGroups(reason) };
}

export async function handleFindCommand(
	command: string,
	params: unknown,
	ctx: FindHandlerContext,
): Promise<boolean> {
	const rpc = ctx.coreBridge as unknown as Rpc;

	switch (command) {
		case "context-find": {
			const p = (params ?? {}) as {
				query?: string;
				projectId?: string;
				limit?: number;
				refresh?: boolean;
			};
			const query = typeof p.query === "string" ? p.query.trim() : "";

			// An empty query is the initial state, not an error. Answering with
			// empty groups lets the view render its prompt rather than a spinner.
			if (!query) {
				ctx.send({ type: "context-find-results", payload: emptyResult("") });
				return true;
			}

			try {
				const result = await rpc.sendRequest<ContextFindResult>("context.find", {
					query,
					projectId: p.projectId,
					limit: p.limit,
					refresh: p.refresh,
				});
				ctx.send({ type: "context-find-results", payload: result });
			} catch (error) {
				ctx.send({
					type: "context-find-results",
					payload: emptyResult(
						query,
						error instanceof Error ? error.message : String(error),
					),
				});
			}
			return true;
		}

		case "context-add-from-find": {
			// Answers on the tray's own message type, so the tray updates
			// through the path it already has rather than a second one that
			// only this view uses.
			try {
				const payload = await rpc.sendRequest<unknown>("context.addFromFind", {
					id: (params as { id?: string })?.id,
				});
				ctx.send({ type: "context-tray", payload });
			} catch (error) {
				ctx.send({
					type: "context-tray",
					payload: {
						ok: false,
						reason: error instanceof Error ? error.message : String(error),
					},
				});
			}
			return true;
		}

		case "context-find-stats": {
			try {
				ctx.send({
					type: "context-find-stats",
					payload: await rpc.sendRequest<ContextFindStats>(
						"context.findStats",
						{},
					),
				});
			} catch {
				// Stats drive a header line. Failing to load them must not stop
				// the view rendering, so an empty shape is sent rather than
				// nothing at all.
				ctx.send({ type: "context-find-stats", payload: { corpora: [] } });
			}
			return true;
		}

		case "context-find-refresh": {
			try {
				ctx.send({
					type: "context-find-stats",
					payload: await rpc.sendRequest<ContextFindStats>(
						"context.findRefresh",
						{},
					),
				});
			} catch {
				ctx.send({ type: "context-find-stats", payload: { corpora: [] } });
			}
			return true;
		}

		default:
			return false;
	}
}
