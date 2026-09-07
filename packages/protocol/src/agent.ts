/**
 * Agents and subagents (Milestone 5).
 *
 * Every field here was chosen against what the live store actually contains,
 * measured over 9014 tool events and 384 `SubagentStop` events. Several
 * obvious-looking fields are deliberately absent because the platform declares
 * them and never fills them in:
 *
 *     SubagentStop.durationMs    0 of 384 non-null
 *     SubagentStop.endReason     0 of 384
 *     SubagentStop.model         0 of 384
 *     SubagentStop.prompt        0 of 384
 *     SubagentStop.agentType     blank string in 195 of 384
 *
 * A view built on those would render empty columns forever, which is why
 * duration is computed here and carries its own provenance.
 */

/** Whether the agent is still going, finished, or ended without a record. */
export type AgentStatus = "running" | "completed" | "unknown";

/**
 * What came back from the spawn call.
 *
 * The distinction is load-bearing. An agent launched as a background teammate
 * returns `{status: "teammate_spawned"}` immediately — an acknowledgement that
 * it started, NOT its findings, which arrive later through a different channel.
 * Every one of the 32 captured Agent calls returned exactly that. Displaying it
 * as "what the agent returned" would be a lie of precisely the kind this
 * milestone exists to expose: the plan notes six subagents whose reports never
 * reached the parent, and this is why.
 */
export type AgentResultKind = "report" | "spawn-ack" | "none";

/** Where a duration came from, because one source is usually empty. */
export type DurationSource = "reported" | "computed";

/** A tool call attributed to an agent by its `agentId`. */
export interface AgentToolCall {
	tool: string;
	timestamp: string;
	status?: string;
	/** Present on Bash and similar; already redacted upstream. */
	summary?: string;
}

export interface AgentRecord {
	/** Stable id: the platform `agentId` when known, else a synthetic one. */
	id: string;
	/** The platform's agent id, when one was ever observed for this agent. */
	agentId?: string;
	/** "Explore", "Plan", a teammate name — blank on roughly half of stops. */
	type?: string;
	/** The name the caller gave at spawn time, when it gave one. */
	name?: string;
	sessionId?: string;
	promptId?: string;
	/** The one-line description from the spawning tool call. */
	description?: string;
	/** The full prompt the agent was given. */
	prompt?: string;
	status: AgentStatus;
	startTime?: string;
	endTime?: string;
	durationMs?: number;
	/** How the duration was obtained. `computed` means from first/last event. */
	durationSource?: DurationSource;
	/** What came back, truncated. Read `resultKind` before believing it. */
	result?: string;
	resultKind: AgentResultKind;
	/** Tool calls this agent made, attributed by `agentId`. */
	toolCalls: AgentToolCall[];
	/**
	 * True when the spawn call and the lifecycle events were matched to each
	 * other. False means this record is one half of an agent — reported rather
	 * than papered over, because an unlinked half is a real gap.
	 */
	linked: boolean;
}

export interface AgentTreeNode extends AgentRecord {
	/** Agents spawned by this one, when the nesting is known. */
	children: AgentTreeNode[];
}

export interface AgentStats {
	total: number;
	running: number;
	completed: number;
	unknown: number;
	/** Agents whose spawn call was never matched to lifecycle events. */
	unlinked: number;
	/** Agents that returned a spawn acknowledgement and never a report. */
	spawnAckOnly: number;
	byType: Record<string, number>;
	totalToolCalls: number;
}

export interface AgentTreeResult {
	agents: AgentTreeNode[];
	stats: AgentStats;
}
