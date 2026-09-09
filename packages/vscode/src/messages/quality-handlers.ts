/**
 * Message handlers for code quality (Milestone 7).
 *
 * Same contract as the other domains: every command answers, including on
 * failure. A scan takes tens of seconds, so an unanswered failure would leave
 * the view spinning long enough that a user reasonably concludes it works that
 * way.
 */

import type { WebviewMessage } from "@inspector-hook/protocol";
import {
	getQualityProjects,
	getQualityReport,
	getQualityTrend,
	scanQuality,
} from "../bridge/quality-bridge.js";
import type { CoreBridge } from "../core-bridge.js";

export interface QualityHandlerContext {
	coreBridge: CoreBridge;
	send: (message: WebviewMessage) => void;
}

const reason = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

/**
 * Handle one quality command.
 *
 * @returns true when the command was recognised and handled.
 */
export async function handleQualityCommand(
	command: string,
	params: unknown,
	ctx: QualityHandlerContext,
): Promise<boolean> {
	const rpc = ctx.coreBridge as unknown as {
		sendRequest<T>(method: string, params?: unknown): Promise<T>;
	};
	const root = (params as { root?: string })?.root;

	switch (command) {
		case "quality-projects": {
			try {
				ctx.send({
					type: "quality-projects",
					payload: await getQualityProjects(rpc),
				});
			} catch (error) {
				ctx.send({
					type: "quality-projects",
					payload: {
						projects: [],
						discovered: 0,
						existing: 0,
						scanned: 0,
						error: reason(error),
					},
				});
			}
			return true;
		}

		case "quality-scan": {
			if (!root) {
				ctx.send({
					type: "quality-report",
					payload: { error: "a project root is required" },
				});
				return true;
			}
			try {
				ctx.send({
					type: "quality-report",
					payload: await scanQuality(rpc, root),
				});
			} catch (error) {
				// A scan that dies must land as a failed scan, not a spinner that
				// never resolves -- this one legitimately runs for tens of
				// seconds, so there is no timeout a user could infer from.
				ctx.send({
					type: "quality-report",
					payload: { projectRoot: root, error: reason(error) },
				});
			}
			return true;
		}

		case "quality-report": {
			const report = root
				? await getQualityReport(rpc, root).catch(() => null)
				: null;
			ctx.send({ type: "quality-report", payload: report });
			return true;
		}

		case "quality-trend": {
			try {
				ctx.send({
					type: "quality-trend",
					payload: root
						? await getQualityTrend(rpc, root)
						: { projectRoot: "", points: [], highDelta: 0 },
				});
			} catch (error) {
				ctx.send({
					type: "quality-trend",
					payload: {
						projectRoot: root ?? "",
						points: [],
						highDelta: 0,
						error: reason(error),
					},
				});
			}
			return true;
		}

		default:
			return false;
	}
}
