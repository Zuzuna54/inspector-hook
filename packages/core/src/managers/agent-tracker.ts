/**
 * Agent and subagent tracking (Milestone 5).
 *
 * ## What the data actually supports
 *
 * Measured on the live store before any of this was designed — 9014 tool
 * events, 32 Agent/Task spawn calls, 44 `SubagentStart`, 384 `SubagentStop`:
 *
 *   - **What it was asked** comes from the spawn call's `tool_input`
 *     (`description`, `prompt`, `subagent_type`, `name`) — 32 of 32.
 *   - **What it did** comes from tool events carrying `agentId` — 3757 events
 *     across 31 distinct agents. This is the richest signal by far.
 *   - **How long it took** is NOT on `SubagentStop`: `durationMs` is null in
 *     384 of 384. It is on the spawn call's PostToolUse (23 of 32), and
 *     otherwise computed from first-to-last timestamps. Which one was used is
 *     recorded, because a number without its provenance is the thing this
 *     project keeps getting wrong.
 *   - **What it returned** is the subtle one. See `classifyResult`.
 *
 * `endReason`, `model` and `prompt` on `SubagentStop` are null in 384 of 384
 * and are not read here at all. `agentType` is a blank string in 195 of 384,
 * so the type is inferred from the agent id when the field is empty.
 *
 * ## Why a spawn acknowledgement is not a report
 *
 * All 32 captured spawn calls returned `{"status": "teammate_spawned", ...}` —
 * confirmation that the agent started, not its findings. The plan opens M5 by
 * noting that six subagents' reports never reached the parent; this is the
 * mechanism, and a tree that showed the acknowledgement under "returned" would
 * hide exactly the failure the view exists to make visible.
 */

import { EventEmitter } from "node:events";

import type {
	AgentRecord,
	AgentResultKind,
	AgentStats,
	AgentToolCall,
	AgentTreeNode,
	LogEntry,
} from "@inspector-hook/protocol";

/** Tool names that spawn an agent. */
const SPAWN_TOOLS = new Set(["Agent", "Task"]);

/** Longest result or prompt kept per agent. */
export const MAX_TEXT = 4_000;

/** Tool calls retained per agent, newest dropped last. */
export const MAX_TOOL_CALLS = 500;

/** Agents held in memory. */
export const MAX_AGENTS = 2_000;

const str = (v: unknown): string | undefined =>
	typeof v === "string" && v.length > 0 ? v : undefined;

const rec = (v: unknown): Record<string, unknown> | undefined =>
	v && typeof v === "object" && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: undefined;

/**
 * Decide what a spawn call's result actually is.
 *
 * A background teammate returns an acknowledgement immediately and its findings
 * never come back through this channel. Calling that a report would misdescribe
 * every agent in the live store.
 */
export function classifyResult(result: unknown): {
	kind: AgentResultKind;
	text?: string;
} {
	if (result === null || result === undefined) return { kind: "none" };
	const text =
		typeof result === "string" ? result : (JSON.stringify(result) ?? "");
	if (text.length === 0 || text === "{}") return { kind: "none" };
	// Both spellings appear depending on whether the payload round-tripped
	// through Python repr or JSON.
	if (/["']status["']\s*:\s*["']teammate_spawned["']/.test(text)) {
		return { kind: "spawn-ack", text: text.slice(0, MAX_TEXT) };
	}
	return { kind: "report", text: text.slice(0, MAX_TEXT) };
}

/**
 * Recover an agent's type from its id when the field is blank.
 *
 * Ids look like `amemory-backend-e6cd168ae458950e` or `a7ade5549bfbe9d4d`: a
 * leading `a`, an optional name, then a hex suffix. When there is no name the
 * id is all hex and there is nothing to recover, which is the honest answer for
 * 195 of the 384 stops whose `agentType` is empty.
 */
export function typeFromAgentId(
	agentId: string | undefined,
): string | undefined {
	if (!agentId || agentId.length < 2 || !agentId.startsWith("a"))
		return undefined;
	const body = agentId.slice(1);
	const match = body.match(/^(.*?)-?[0-9a-f]{16,}$/);
	const name = match?.[1];
	return name && !/^[0-9a-f]*$/.test(name) ? name : undefined;
}

export interface AgentTrackerOptions {
	maxAgents?: number;
}

type Events = {
	"agent:started": (agent: AgentRecord) => void;
	"agent:updated": (agent: AgentRecord) => void;
	"agent:ended": (agent: AgentRecord) => void;
};

export declare interface AgentTracker {
	on<K extends keyof Events>(event: K, listener: Events[K]): this;
	emit<K extends keyof Events>(
		event: K,
		...args: Parameters<Events[K]>
	): boolean;
}

export class AgentTracker extends EventEmitter {
	private readonly agents = new Map<string, AgentRecord>();
	/** platform agentId -> our record id, once the two are linked. */
	private readonly byAgentId = new Map<string, string>();
	private readonly maxAgents: number;
	private counter = 0;

	constructor(options: AgentTrackerOptions = {}) {
		super();
		this.maxAgents = options.maxAgents ?? MAX_AGENTS;
	}

	get size(): number {
		return this.agents.size;
	}

	/** Feed one log entry. Safe to call for every event; most are ignored. */
	ingest(log: LogEntry): AgentRecord | null {
		if (!log || typeof log !== "object") return null;
		const details = log.details ?? {};
		const hook = log.hook || log.event;
		const tool = log.tool ?? str(details.tool);

		if (tool && SPAWN_TOOLS.has(tool)) {
			if (hook === "PreToolUse" || log.event === "tool.start") {
				return this.onSpawn(log, details);
			}
			if (hook === "PostToolUse" || log.event === "tool.end") {
				return this.onSpawnResult(log, details);
			}
			return null;
		}

		if (hook === "SubagentStart")
			return this.onLifecycle(log, details, "start");
		if (hook === "SubagentStop") return this.onLifecycle(log, details, "stop");

		// Any other event carrying an agentId is work done BY that agent.
		const agentId = str(details.agentId) ?? str(details.agent_id);
		if (agentId && tool)
			return this.onAgentToolCall(log, details, agentId, tool);
		return null;
	}

	/** The spawn call: the only place the prompt and description exist. */
	private onSpawn(
		log: LogEntry,
		details: Record<string, unknown>,
	): AgentRecord {
		const input = rec(details.tool_input) ?? {};
		const id = `spawn-${++this.counter}`;
		const agent: AgentRecord = {
			id,
			type: str(input.subagent_type),
			name: str(input.name),
			sessionId: log.sessionId,
			promptId: log.promptId ?? str(details.prompt_id),
			description: str(input.description),
			prompt: str(input.prompt)?.slice(0, MAX_TEXT),
			status: "running",
			startTime: log.timestamp,
			resultKind: "none",
			toolCalls: [],
			linked: false,
		};
		this.put(agent);
		this.emit("agent:started", agent);
		return agent;
	}

	/** The spawn call returning. Duration is reported here, unlike on stop. */
	private onSpawnResult(
		log: LogEntry,
		details: Record<string, unknown>,
	): AgentRecord | null {
		const input = rec(details.tool_input) ?? {};
		const agent = this.findSpawn(
			log.sessionId,
			str(input.name),
			str(input.subagent_type),
		);
		if (!agent) return null;

		// Provisionally complete; a spawn-ack reverts this below, because an
		// acknowledged spawn means the agent is only just STARTING.
		agent.endTime = log.timestamp;
		agent.status = "completed";

		const { kind, text } = classifyResult(details.tool_result);
		agent.resultKind = kind;
		agent.result = text;

		// The reported duration is the SPAWN CALL's duration, which equals the
		// agent's runtime only when the agent ran synchronously and returned its
		// findings. For a background teammate the call returns the moment the
		// agent starts -- measured at 0-40ms against agents that then ran for
		// minutes -- so trusting it there would report every teammate as
		// instantaneous. Computed from observed events instead.
		const reported = details.durationMs;
		if (kind === "report" && typeof reported === "number" && reported > 0) {
			agent.durationMs = reported;
			agent.durationSource = "reported";
		} else {
			// A spawn-ack agent keeps running after this event, so its end is
			// not now. Leave endTime for the lifecycle event to set.
			if (kind === "spawn-ack") {
				agent.endTime = undefined;
				agent.status = "running";
			}
			this.computeDuration(agent);
		}
		this.emit("agent:ended", agent);
		return agent;
	}

	/**
	 * SubagentStart / SubagentStop.
	 *
	 * These carry the platform `agentId`; the spawn call does not, because the
	 * agent does not exist yet when it fires. Linking them is therefore a match
	 * on the name embedded in the id — which held for 34 of 44 starts — falling
	 * back to the turn. An unmatched half becomes its own record with
	 * `linked: false` rather than being silently dropped or silently merged.
	 */
	private onLifecycle(
		log: LogEntry,
		details: Record<string, unknown>,
		phase: "start" | "stop",
	): AgentRecord | null {
		const agentId = str(details.agentId) ?? str(details.agent_id);
		if (!agentId) return null;

		let agent = this.resolve(agentId);
		if (!agent) {
			const declared = str(details.agentType) ?? str(details.agent_type);
			const inferred = declared ?? typeFromAgentId(agentId);
			agent = this.adoptSpawn(log, agentId, inferred);
		}

		if (phase === "start") {
			agent.startTime ??= log.timestamp;
			if (agent.status !== "completed") agent.status = "running";
			this.emit("agent:started", agent);
		} else {
			agent.endTime = log.timestamp;
			agent.status = "completed";
			this.computeDuration(agent);
			this.emit("agent:ended", agent);
		}
		return agent;
	}

	/** Attribute a tool call to the agent that made it. */
	private onAgentToolCall(
		log: LogEntry,
		details: Record<string, unknown>,
		agentId: string,
		tool: string,
	): AgentRecord {
		let agent = this.resolve(agentId);
		if (!agent) {
			const declared = str(details.agentType) ?? str(details.agent_type);
			agent = this.adoptSpawn(
				log,
				agentId,
				declared ?? typeFromAgentId(agentId),
			);
		}

		// One entry per call, not per hook: PreToolUse and PostToolUse both
		// arrive and counting both would double every agent's work.
		if (log.hook === "PostToolUse" || log.event === "tool.end") return agent;

		const call: AgentToolCall = { tool, timestamp: log.timestamp };
		const input = rec(details.tool_input);
		const summary = input
			? (str(input.description) ?? str(input.query))
			: undefined;
		if (summary) call.summary = summary.slice(0, 200);

		agent.toolCalls.push(call);
		if (agent.toolCalls.length > MAX_TOOL_CALLS) agent.toolCalls.shift();
		agent.startTime ??= log.timestamp;
		// A running agent's span grows with the work seen. Without this the
		// duration is whatever it was when the spawn call returned, which for a
		// background teammate is nothing at all.
		this.computeDuration(agent);
		this.emit("agent:updated", agent);
		return agent;
	}

	/**
	 * Bind a platform agentId to an existing spawn record, or make a new one.
	 *
	 * The match is the agent's name appearing inside the id. Nothing else is
	 * available: the spawn call has no agentId and the lifecycle events have no
	 * prompt.
	 */
	private adoptSpawn(
		log: LogEntry,
		agentId: string,
		type: string | undefined,
	): AgentRecord {
		const promptId = log.promptId ?? str(log.details?.prompt_id);
		for (const candidate of this.agents.values()) {
			if (candidate.agentId) continue;
			const key = candidate.name ?? candidate.type;
			const nameMatches = key ? agentId.includes(key) : false;
			const turnMatches =
				Boolean(promptId) && candidate.promptId === promptId && Boolean(key);
			if (!nameMatches && !turnMatches) continue;

			candidate.agentId = agentId;
			candidate.linked = true;
			candidate.type ??= type;
			this.byAgentId.set(agentId, candidate.id);
			return candidate;
		}

		const agent: AgentRecord = {
			id: agentId,
			agentId,
			type,
			sessionId: log.sessionId,
			promptId,
			status: "running",
			startTime: log.timestamp,
			resultKind: "none",
			toolCalls: [],
			// No spawn call was ever seen for this agent. Common and honest:
			// most captured lifecycle events belong to teammate sessions that
			// this core never saw being created.
			linked: false,
		};
		this.put(agent);
		this.byAgentId.set(agentId, agent.id);
		return agent;
	}

	private resolve(agentId: string): AgentRecord | undefined {
		const id = this.byAgentId.get(agentId);
		return id ? this.agents.get(id) : undefined;
	}

	/** The newest running spawn matching a name or type in this session. */
	private findSpawn(
		sessionId: string | undefined,
		name: string | undefined,
		type: string | undefined,
	): AgentRecord | undefined {
		let best: AgentRecord | undefined;
		for (const agent of this.agents.values()) {
			if (agent.status !== "running") continue;
			if (sessionId && agent.sessionId !== sessionId) continue;
			if (name && agent.name !== name) continue;
			if (!name && type && agent.type !== type) continue;
			if (!best || (agent.startTime ?? "") > (best.startTime ?? ""))
				best = agent;
		}
		return best;
	}

	/**
	 * Duration from timestamps.
	 *
	 * Used because `SubagentStop.durationMs` is null in 384 of 384 live events.
	 * Marked `computed` so a caller can tell the difference between "the
	 * platform told us" and "we measured the gap between two events we saw".
	 */
	private computeDuration(agent: AgentRecord): void {
		if (agent.durationSource === "reported") return;
		const first = agent.startTime ?? agent.toolCalls[0]?.timestamp;
		// A running agent still has a measurable span: the work seen so far.
		const last =
			agent.endTime ?? agent.toolCalls[agent.toolCalls.length - 1]?.timestamp;
		if (!first || !last) return;
		const ms = Date.parse(last) - Date.parse(first);
		if (Number.isFinite(ms) && ms >= 0) {
			agent.durationMs = ms;
			agent.durationSource = "computed";
		}
	}

	private put(agent: AgentRecord): void {
		this.agents.set(agent.id, agent);
		if (this.agents.size <= this.maxAgents) return;
		// Oldest first. Insertion order is chronological because records are
		// created when their first event arrives.
		const oldest = this.agents.keys().next().value;
		if (oldest !== undefined) {
			const evicted = this.agents.get(oldest);
			if (evicted?.agentId) this.byAgentId.delete(evicted.agentId);
			this.agents.delete(oldest);
		}
	}

	get(id: string): AgentRecord | null {
		return this.agents.get(id) ?? this.resolve(id) ?? null;
	}

	/**
	 * The tree, newest first.
	 *
	 * Nesting is flat today: no captured event states which agent spawned
	 * another, so inventing a hierarchy would be a guess. `children` exists so
	 * the shape does not change when parentage becomes available.
	 */
	getTree(options?: { sessionId?: string; limit?: number }): AgentTreeNode[] {
		let list = [...this.agents.values()];
		if (options?.sessionId) {
			list = list.filter((a) => a.sessionId === options.sessionId);
		}
		list.sort((a, b) => (b.startTime ?? "").localeCompare(a.startTime ?? ""));
		return list
			.slice(0, options?.limit ?? 200)
			.map((agent) => ({ ...agent, children: [] }));
	}

	stats(): AgentStats {
		const byType: Record<string, number> = {};
		let running = 0;
		let completed = 0;
		let unknown = 0;
		let unlinked = 0;
		let spawnAckOnly = 0;
		let totalToolCalls = 0;

		for (const agent of this.agents.values()) {
			const type = agent.type ?? "(untyped)";
			byType[type] = (byType[type] ?? 0) + 1;
			if (agent.status === "running") running++;
			else if (agent.status === "completed") completed++;
			else unknown++;
			if (!agent.linked) unlinked++;
			if (agent.resultKind === "spawn-ack") spawnAckOnly++;
			totalToolCalls += agent.toolCalls.length;
		}

		return {
			total: this.agents.size,
			running,
			completed,
			unknown,
			unlinked,
			spawnAckOnly,
			byType,
			totalToolCalls,
		};
	}

	/**
	 * Rebuild from stored logs, for a core that starts after the work.
	 *
	 * **Sorts chronologically first, and that is not optional.** `getLogs`
	 * returns newest-first by default, so feeding its output straight in
	 * replays history backwards: stops arrive before starts, results before
	 * spawns, and every duration is computed from an end that precedes its
	 * beginning. Measured: the same 13593 events produced 199 agents and 24
	 * spawn-acks in order, and 182 agents and ZERO spawn-acks reversed — a
	 * plausible-looking tree that was wrong in every column.
	 */
	backfill(logs: LogEntry[]): { agents: number; scanned: number } {
		const ordered = [...logs].sort((a, b) =>
			String(a?.timestamp ?? "").localeCompare(String(b?.timestamp ?? "")),
		);
		let scanned = 0;
		for (const log of ordered) {
			scanned++;
			this.ingest(log);
		}
		return { agents: this.agents.size, scanned };
	}
}
