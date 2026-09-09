/**
 * Message handlers for the delivery log (P10).
 *
 * Every failure is answered. This drives a tab in the session detail, and an
 * unanswered message leaves it loading forever — the failure this project has
 * shipped three times.
 */

import type { WebviewMessage } from "@inspector-hook/protocol";
import type { CoreBridge } from "../core-bridge.js";

export interface InjectionsHandlerContext {
	coreBridge: CoreBridge;
	send: (message: WebviewMessage) => void;
}

interface Rpc {
	sendRequest<T>(method: string, params?: unknown): Promise<T>;
}

export async function handleInjectionsCommand(
	command: string,
	params: unknown,
	ctx: InjectionsHandlerContext,
): Promise<boolean> {
	const rpc = ctx.coreBridge as unknown as Rpc;

	switch (command) {
		case "context-get-injections": {
			const p = (params ?? {}) as { sessionId?: string; limit?: number };
			try {
				const result = await rpc.sendRequest<Record<string, unknown>>(
					"context.getInjections",
					{ sessionId: p.sessionId, limit: p.limit },
				);
				// The sessionId is echoed so a reply that arrives after the user
				// has selected a different session can be recognised as stale
				// rather than rendered against the wrong row.
				ctx.send({
					type: "context-injections",
					payload: { ...result, sessionId: p.sessionId },
				});
			} catch (error) {
				ctx.send({
					type: "context-injections",
					payload: {
						records: [],
						unparseable: 0,
						sessionId: p.sessionId,
						error: error instanceof Error ? error.message : String(error),
					},
				});
			}
			return true;
		}

		case "context-injection-counts": {
			try {
				ctx.send({
					type: "context-injection-counts",
					payload: await rpc.sendRequest("context.injectionCounts", {}),
				});
			} catch {
				// A marker on a list row. Failing to load it must not stop the
				// list rendering.
				ctx.send({ type: "context-injection-counts", payload: { counts: {} } });
			}
			return true;
		}

		default:
			return false;
	}
}
