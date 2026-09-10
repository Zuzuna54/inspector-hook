/**
 * Message handlers for skills and MCP tools (Milestone 8).
 *
 * Same contract as the other domains: every command answers, including on
 * failure. The overview reads 121 transcripts, so a silent failure would leave
 * the view on its loading message long enough to look like a hang — which is
 * exactly the bug the Agents view shipped with in M5.
 */

import type { WebviewMessage } from "@inspector-hook/protocol";
import {
	getMcpProbes,
	getSkillsOverview,
	probeMcpServers,
	readSkillFile,
	setSkillArchived,
} from "../bridge/skills-bridge.js";
import type { CoreBridge } from "../core-bridge.js";

export interface SkillsHandlerContext {
	coreBridge: CoreBridge;
	send: (message: WebviewMessage) => void;
}

const reason = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

/** An empty overview carrying the failure, so the view can render the reason. */
function failedOverview(error: unknown) {
	return {
		skills: [],
		servers: [],
		archived: [],
		source: { transcriptsScanned: 0, scanMs: 0, error: reason(error) },
		summary: {
			installed: 0,
			installedUsed: 0,
			invalid: 0,
			builtinUsed: 0,
			pluginSkills: 0,
			serversConfigured: 0,
			serversObserved: 0,
			mcpInvocations: 0,
		},
		error: reason(error),
	};
}

/**
 * Handle one skills command.
 *
 * @returns true when the command was recognised and handled.
 */
export async function handleSkillsCommand(
	command: string,
	params: unknown,
	ctx: SkillsHandlerContext,
): Promise<boolean> {
	const rpc = ctx.coreBridge as unknown as {
		sendRequest<T>(method: string, params?: unknown): Promise<T>;
	};
	const p = (params ?? {}) as {
		id?: string;
		refresh?: boolean;
		archived?: boolean;
		servers?: string[];
	};

	switch (command) {
		case "skills-overview": {
			try {
				ctx.send({
					type: "skills-overview",
					payload: await getSkillsOverview(rpc, p.refresh === true),
				});
			} catch (error) {
				ctx.send({ type: "skills-overview", payload: failedOverview(error) });
			}
			return true;
		}

		case "skills-read-file": {
			if (!p.id) {
				ctx.send({
					type: "skills-file",
					payload: { error: "a skill id is required" },
				});
				return true;
			}
			try {
				ctx.send({
					type: "skills-file",
					payload: await readSkillFile(rpc, p.id),
				});
			} catch (error) {
				ctx.send({
					type: "skills-file",
					payload: { id: p.id, error: reason(error) },
				});
			}
			return true;
		}

		case "skills-probe-servers": {
			try {
				const { probes } = await probeMcpServers(rpc, p.servers);
				ctx.send({ type: "skills-probes", payload: { probes } });
			} catch (error) {
				// A probe that dies must stop the spinner and say why. It runs
				// external processes for tens of seconds, so there is no timeout
				// a user could infer from.
				ctx.send({
					type: "skills-probes",
					payload: { probes: [], error: reason(error) },
				});
			}
			return true;
		}

		case "skills-get-probes": {
			try {
				ctx.send({ type: "skills-probes", payload: await getMcpProbes(rpc) });
			} catch (error) {
				ctx.send({
					type: "skills-probes",
					payload: { probes: [], error: reason(error) },
				});
			}
			return true;
		}

		case "skills-set-archived": {
			if (!p.id) {
				ctx.send({
					type: "skills-archived",
					payload: { ok: false, error: "a skill id is required" },
				});
				return true;
			}
			try {
				const result = await setSkillArchived(rpc, p.id, p.archived !== false);
				ctx.send({ type: "skills-archived", payload: result });
				// The inventory changed on disk, so the list the user is looking at
				// is now wrong. Refresh rather than leaving them to guess whether
				// it worked.
				if (result.ok) {
					ctx.send({
						type: "skills-overview",
						payload: await getSkillsOverview(rpc, true).catch(failedOverview),
					});
				}
			} catch (error) {
				ctx.send({
					type: "skills-archived",
					payload: { ok: false, error: reason(error) },
				});
			}
			return true;
		}

		default:
			return false;
	}
}
