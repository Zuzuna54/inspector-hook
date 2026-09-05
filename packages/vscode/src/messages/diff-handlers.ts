/**
 * Message handlers for diffs, pending and archived.
 *
 * Split out of panel.ts alongside the memory handlers, for the same reason:
 * that file is a message switch that grows with every feature, and it had been
 * raised past the size limit twice in a day before being split.
 *
 * The routing here is the whole point. Pending and archived changes live in
 * different maps in the tracker, each with its own lookup, and for the life of
 * the Archived view the pending lookup was used for both -- returning null by
 * construction for all 155 archived changes.
 */

import type { WebviewMessage } from "@inspector-hook/protocol";
import type { CoreBridge } from "../core-bridge.js";

export interface DiffHandlerContext {
	coreBridge: CoreBridge;
	send: (message: WebviewMessage) => void;
}

/** @returns true when the command was recognised and handled. */
export async function handleDiffCommand(
	command: string,
	params: unknown,
	ctx: DiffHandlerContext,
): Promise<boolean> {
	switch (command) {
		// Pending and archived changes live in DIFFERENT maps in the tracker,
		// and each has its own lookup. Asking the pending one for an archived
		// change returns null by construction -- which is why every archived
		// diff had always rendered as an empty "+0 / -0" and never as an
		// error. See the null guard below for the second half of that.
		case "get-diff":
		case "get-archived-diff": {
			const changeId = (params as any).changeId;
			const archived = command === "get-archived-diff";
			try {
				const diff = archived
					? await ctx.coreBridge.getArchivedDiff(changeId)
					: await ctx.coreBridge.getDiff(changeId);

				// A null lookup is a FAILURE, not an empty diff. Spreading null
				// yields a truthy `{ changeId }`, so the error branch could
				// never run and a missing change rendered as a well-formed diff
				// with no hunks -- indistinguishable from a file that genuinely
				// did not change.
				if (!diff) {
					ctx.send({
						type: "diff-error",
						payload: {
							changeId,
							message: archived
								? `No archived change ${changeId}.`
								: `No pending change ${changeId}. It may have been kept or reverted.`,
						},
					});
					break;
				}

				// Include changeId in the response so webview can match it
				ctx.send({
					type: "diff-result",
					payload: { ...diff, changeId },
				});
			} catch (error) {
				ctx.send({
					type: "diff-error",
					payload: { changeId, message: String(error) },
				});
			}
			break;
		}

		default:
			return false;
	}
	return true;
}
