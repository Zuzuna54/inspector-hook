/**
 * Message handlers for native auto memory (Milestone 3).
 *
 * Split out of panel.ts, whose message switch grows with every feature and had
 * been raised past the size limit twice in one day — for the digest envelope
 * unwrap and then for archived-diff routing. Both were fixes for bugs that had
 * shipped, so refusing them to protect a line count would have been the wrong
 * trade; but two raises is the signal that the file needs splitting, not a
 * third exemption. With these lifted out, panel.ts is back under the limit.
 *
 * The handler returns whether it took the command, so panel.ts can fall
 * through to its own switch. Everything it needs is passed in a context rather
 * than reached through `this`, which is what makes it testable without a
 * webview.
 */

import type { WebviewMessage } from "@inspector-hook/protocol";
import type { CoreBridge } from "../core-bridge.js";

export interface MemoryHandlerContext {
	coreBridge: CoreBridge;
	send: (message: WebviewMessage) => void;
}

/**
 * Handle one memory/context command.
 *
 * @returns true when the command was recognised and handled.
 */
export async function handleMemoryCommand(
	command: string,
	params: unknown,
	ctx: MemoryHandlerContext,
): Promise<boolean> {
	switch (command) {
		// Native auto memory (Milestone 3)
		//
		// The four mutating cases all reply as "memory-result" with the
		// core's response passed through UNCHANGED, including `reason`. The
		// view renders refusals verbatim, so rewording one here would mean
		// two explanations of the same refusal drifting apart.
		// ----------------------------------------------------------------

		case "memory-get-projects": {
			const projects = await ctx.coreBridge.getMemoryProjects(
				Boolean((params as any)?.includeEmpty),
			);
			ctx.send({ type: "memory-projects", payload: projects });
			break;
		}

		case "memory-add-to-index": {
			const p = params as { memoryDir: string; fileName: string };
			const result = await ctx.coreBridge.addMemoryToIndex(
				p.memoryDir,
				p.fileName,
			);
			ctx.send({ type: "memory-result", payload: result });
			break;
		}

		case "memory-remove-from-index": {
			const p = params as { memoryDir: string; fileName: string };
			const result = await ctx.coreBridge.removeMemoryFromIndex(
				p.memoryDir,
				p.fileName,
			);
			ctx.send({ type: "memory-result", payload: result });
			break;
		}

		case "memory-write": {
			const result = await ctx.coreBridge.writeMemory(
				params as {
					memoryDir: string;
					name: string;
					fileName?: string;
					description?: string;
					type?: string;
					body?: string;
					title?: string;
					userInitiated?: boolean;
				},
			);
			ctx.send({ type: "memory-result", payload: result });
			break;
		}

		case "memory-delete": {
			const p = params as {
				memoryDir: string;
				fileName: string;
				force?: boolean;
			};
			const result = await ctx.coreBridge.deleteMemory(
				p.memoryDir,
				p.fileName,
				Boolean(p.force),
			);
			ctx.send({ type: "memory-result", payload: result });
			break;
		}

		// The three staging calls share one reply type on purpose: each ends
		// with "here is what is staged, or nothing", so the view re-renders
		// from whatever came back. The staged object is passed through
		// untouched — rebuilding it here would quietly break the guarantee
		// that the preview is the delivery.
		case "memory-stage-context": {
			const staged = await ctx.coreBridge.stageContext(
				params as {
					sessionId?: string;
					text?: string;
					label?: string;
					ttlMs?: number;
				},
			);
			ctx.send({ type: "memory-staged", payload: staged });
			break;
		}

		case "memory-get-staged": {
			const staged = await ctx.coreBridge.getStagedContext();
			ctx.send({ type: "memory-staged", payload: staged });
			break;
		}

		case "memory-clear-staged": {
			await ctx.coreBridge.clearStagedContext();
			ctx.send({ type: "memory-staged", payload: null });
			break;
		}

		case "memory-build-digest": {
			// Only the sessionId is forwarded; a `write` flag is ignored. The
			// core replies with an ENVELOPE `{ digest, written }`, and sending
			// it whole meant the view read worthKeeping, body and sessionId off
			// the wrapper — undefined for all three, so Preview drew an empty
			// box and Stage was a no-op. An {error} reply passes through.
			const { digest, ...outcome } = ((await ctx.coreBridge.buildSessionDigest(
				(params as { sessionId: string }).sessionId,
			)) ?? {}) as { digest?: Record<string, unknown> };
			ctx.send({
				type: "memory-digest",
				payload: digest ? { ...digest, ...outcome } : outcome,
			});
			break;
		}

		default:
			return false;
	}
	return true;
}
