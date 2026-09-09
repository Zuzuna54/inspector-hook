/**
 * The ordered chain of domain handlers.
 *
 * Extracted from `panel.ts` because that file had reached the 600-line limit
 * the splits were done to achieve, and this was the part of it that grows with
 * every milestone: one import and one line per domain, ten domains so far.
 * Adding the eleventh now touches this file instead.
 *
 * Order is not arbitrary. Each handler reports whether it took the command, so
 * the first to claim one wins, and a command claimed by two domains would
 * resolve silently by position. `message-contract.test.js` reads every module
 * in this directory, so a command handled here stays covered by the contract
 * assertions rather than becoming invisible to them.
 */

import type { WebviewCommand, WebviewMessage } from "@inspector-hook/protocol";
import type { CoreBridge } from "../core-bridge.js";
import { handleAgentsCommand } from "./agents-handlers.js";
import { handleDiffCommand } from "./diff-handlers.js";
import { handleFindCommand } from "./find-handlers.js";
import { handleGraphifyCommand } from "./graphify-handlers.js";
import { handleInjectionsCommand } from "./injections-handlers.js";
import { handleMemoryCommand } from "./memory-handlers.js";
import { handleProjectsCommand } from "./projects-handlers.js";
import { handleQualityCommand } from "./quality-handlers.js";
import { handleResearchCommand } from "./research-handlers.js";
import { handleSkillsCommand } from "./skills-handlers.js";

export interface HandlerContext {
	coreBridge: CoreBridge;
	send: (message: WebviewMessage) => void;
}

/** Every domain handler, in the order they get offered a command. */
const HANDLERS = [
	handleMemoryCommand,
	handleDiffCommand,
	handleResearchCommand,
	handleGraphifyCommand,
	handleAgentsCommand,
	handleQualityCommand,
	handleSkillsCommand,
	handleFindCommand,
	handleProjectsCommand,
	handleInjectionsCommand,
] as const;

/**
 * Offer a command to each domain in turn.
 *
 * @returns true when a domain took it, so the caller's own switch is skipped.
 */
export async function dispatchDomainCommand(
	message: WebviewCommand,
	ctx: HandlerContext,
): Promise<boolean> {
	for (const handler of HANDLERS) {
		if (await handler(message.command, message.params, ctx)) return true;
	}
	return false;
}
