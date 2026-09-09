/**
 * The global project list (M3 P9).
 *
 * One list, reconciled in the core across three identity spaces, so every view
 * scopes on the same handle instead of each inventing its own idea of what a
 * project is.
 *
 * A failure answers with an empty list rather than nothing. The project picker
 * gates every other view, so an unanswered message would leave the whole panel
 * scoped to a filter that never arrives — the permanent-loading failure this
 * project has shipped three times.
 */

import type { WebviewMessage } from "@inspector-hook/protocol";
import type { CoreBridge } from "../core-bridge.js";

export interface ProjectsHandlerContext {
	coreBridge: CoreBridge;
	send: (message: WebviewMessage) => void;
}

export async function handleProjectsCommand(
	command: string,
	_params: unknown,
	ctx: ProjectsHandlerContext,
): Promise<boolean> {
	const rpc = ctx.coreBridge as unknown as {
		sendRequest<T>(method: string, params?: unknown): Promise<T>;
	};

	// A switch rather than an early return, matching every other handler module
	// — and matching the contract test, which discovers what the extension
	// handles by reading `case` labels out of these files. An `if` guard here
	// handles the command and is invisible to that check, which is exactly the
	// kind of silent gap the check exists to catch.
	switch (command) {
		case "projects-list": {
			try {
				const result = await rpc.sendRequest<{ projects: unknown[] }>(
					"projects.list",
					{},
				);
				ctx.send({ type: "projects", payload: result });
			} catch (error) {
				ctx.send({
					type: "projects",
					payload: {
						projects: [],
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
