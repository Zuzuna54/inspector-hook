/**
 * Agent tracking (Milestone 5).
 *
 * Fixtures are shaped from the live store — 13593 events, 32 Agent/Task spawn
 * calls, 44 `SubagentStart`, 384 `SubagentStop` — because the shapes that
 * matter are exactly the ones an invented fixture would get wrong:
 *
 *   - `SubagentStop.durationMs` is null in 384 of 384. A tracker that reads it
 *     shows an empty column forever.
 *   - `SubagentStop.agentType` is a BLANK STRING in 195 of 384, not absent.
 *   - Every one of the 32 spawn calls returned `{"status":"teammate_spawned"}`,
 *     an acknowledgement that the agent started — not its findings.
 *   - The spawn call has no `agentId`; the lifecycle events have no prompt.
 *     Nothing in the payload joins them.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
	AgentTracker,
	classifyResult,
	typeFromAgentId,
} from "../dist/index.js";

const base = (over = {}) => ({
	id: `l-${Math.random().toString(36).slice(2)}`,
	timestamp: "2026-09-07T10:00:00.000Z",
	level: "info",
	sessionId: "s1",
	hook: "PreToolUse",
	event: "PreToolUse",
	message: "",
	...over,
});

/** The Agent tool being called — the only place the prompt exists. */
const spawn = (over = {}, details = {}) =>
	base({
		hook: "PreToolUse",
		event: "PreToolUse",
		tool: "Agent",
		...over,
		details: {
			cwd: "/w",
			tool_input: {
				description: "Audit M5",
				prompt: "You are auditing the agent tree.",
				subagent_type: "Explore",
				name: "a-m5",
			},
			...details,
		},
	});

/** The Agent tool returning. Carries durationMs; the stop event does not. */
const spawnResult = (over = {}, details = {}) =>
	base({
		hook: "PostToolUse",
		event: "PostToolUse",
		tool: "Agent",
		timestamp: "2026-09-07T10:00:01.000Z",
		...over,
		details: {
			cwd: "/w",
			tool_input: { subagent_type: "Explore", name: "a-m5" },
			tool_result: { status: "teammate_spawned", prompt: "..." },
			durationMs: 34,
			...details,
		},
	});

const lifecycle = (hook, agentId, over = {}, details = {}) =>
	base({
		hook,
		event: hook,
		...over,
		details: { cwd: "/w", agentId, ...details },
	});

const agentToolCall = (agentId, tool, timestamp, details = {}) =>
	base({
		hook: "PreToolUse",
		event: "PreToolUse",
		tool,
		timestamp,
		details: { cwd: "/w", agentId, ...details },
	});

describe("agents: what came back is not always a report", () => {
	it("REGRESSION: a teammate spawn acknowledgement is not the agent's findings", () => {
		// All 32 captured spawn calls returned this. The plan opens M5 by noting
		// six subagents whose reports never reached the parent -- this is the
		// mechanism, and showing the ack as "returned" would hide it.
		const ack = classifyResult({ status: "teammate_spawned", prompt: "..." });
		assert.equal(ack.kind, "spawn-ack");

		const report = classifyResult("Here is what I found: three bugs.");
		assert.equal(report.kind, "report");
		assert.match(report.text, /three bugs/);

		for (const empty of [null, undefined, "", {}]) {
			assert.equal(classifyResult(empty).kind, "none", JSON.stringify(empty));
		}
	});

	it("recognises the acknowledgement through either quoting style", () => {
		// The payload reaches us as JSON or as a Python repr depending on path.
		assert.equal(
			classifyResult(`{'status': 'teammate_spawned'}`).kind,
			"spawn-ack",
		);
		assert.equal(
			classifyResult(`{"status": "teammate_spawned"}`).kind,
			"spawn-ack",
		);
	});
});

describe("agents: duration, and where the number came from", () => {
	it("REGRESSION: a spawn call's duration is NOT the agent's runtime", () => {
		// The measured bug. `durationMs` on the spawn call is how long it took to
		// START a background teammate -- 34ms against agents that then ran for
		// twenty minutes. Reporting it as the agent's duration made every
		// teammate look instantaneous (0.0s for an agent that ran 1191s).
		const t = new AgentTracker();
		t.ingest(spawn());
		t.ingest(spawnResult());
		t.ingest(
			agentToolCall(
				"a-a-m5-deadbeefdeadbeef",
				"Bash",
				"2026-09-07T10:05:00.000Z",
			),
		);
		t.ingest(
			lifecycle("SubagentStop", "a-a-m5-deadbeefdeadbeef", {
				timestamp: "2026-09-07T10:10:00.000Z",
			}),
		);

		const [agent] = t.getTree();
		assert.equal(agent.resultKind, "spawn-ack");
		assert.equal(
			agent.durationSource,
			"computed",
			"must not trust the spawn latency",
		);
		assert.ok(
			agent.durationMs > 500_000,
			`expected ~600s, got ${agent.durationMs}`,
		);
	});

	it("DOES trust the reported duration when the agent actually reported", () => {
		// A synchronous agent returns its findings, so the call's duration IS
		// the agent's runtime.
		const t = new AgentTracker();
		t.ingest(spawn());
		t.ingest(
			spawnResult({}, { tool_result: "Found three bugs.", durationMs: 4200 }),
		);
		const [agent] = t.getTree();
		assert.equal(agent.resultKind, "report");
		assert.equal(agent.durationSource, "reported");
		assert.equal(agent.durationMs, 4200);
	});

	it("a spawn-ack leaves the agent RUNNING, not completed", () => {
		// The call returned; the agent did not.
		const t = new AgentTracker();
		t.ingest(spawn());
		t.ingest(spawnResult());
		assert.equal(t.getTree()[0].status, "running");
	});

	it("measures a still-running agent from the work seen so far", () => {
		const t = new AgentTracker();
		t.ingest(spawn());
		t.ingest(spawnResult());
		t.ingest(
			agentToolCall(
				"a-a-m5-cafecafecafecafe",
				"Bash",
				"2026-09-07T10:03:00.000Z",
			),
		);
		const [agent] = t.getTree();
		assert.ok(agent.durationMs >= 180_000, "the span so far is measurable");
		assert.equal(agent.durationSource, "computed");
	});

	it("reports no duration rather than a wrong one", () => {
		const t = new AgentTracker();
		t.ingest(lifecycle("SubagentStart", "a1234567890abcdef"));
		assert.equal(t.getTree()[0].durationMs, undefined);
	});
});

describe("agents: what it was asked, and what it did", () => {
	it("captures the prompt and description from the spawn call", () => {
		const t = new AgentTracker();
		t.ingest(spawn());
		const [agent] = t.getTree();
		assert.equal(agent.description, "Audit M5");
		assert.match(agent.prompt, /auditing the agent tree/);
		assert.equal(agent.type, "Explore");
		assert.equal(agent.name, "a-m5");
	});

	it("attributes tool calls by agentId, counting each call ONCE", () => {
		// Pre and Post both arrive for every call; counting both would double
		// every agent's work.
		const t = new AgentTracker();
		const id = "aexplorer-1234567890abcdef";
		t.ingest(agentToolCall(id, "Bash", "2026-09-07T10:00:00.000Z"));
		t.ingest(
			base({
				hook: "PostToolUse",
				event: "PostToolUse",
				tool: "Bash",
				timestamp: "2026-09-07T10:00:01.000Z",
				details: { agentId: id },
			}),
		);
		t.ingest(agentToolCall(id, "Read", "2026-09-07T10:00:02.000Z"));

		assert.equal(t.getTree()[0].toolCalls.length, 2);
	});

	it("keeps a short summary of each call", () => {
		const t = new AgentTracker();
		t.ingest(
			agentToolCall(
				"aexp-1234567890abcdef",
				"Bash",
				"2026-09-07T10:00:00.000Z",
				{
					tool_input: { description: "List the packages" },
				},
			),
		);
		assert.equal(t.getTree()[0].toolCalls[0].summary, "List the packages");
	});
});

describe("agents: linking the spawn call to the lifecycle events", () => {
	it("links by the name embedded in the agent id", () => {
		// The spawn call has no agentId and the lifecycle events have no prompt,
		// so the name inside the id is the only join available. It held for 34
		// of 44 real starts.
		const t = new AgentTracker();
		t.ingest(spawn());
		t.ingest(lifecycle("SubagentStart", "aa-m5-e6cd168ae458950e"));

		const tree = t.getTree();
		assert.equal(tree.length, 1, "one agent, not two halves");
		assert.equal(tree[0].linked, true);
		assert.equal(tree[0].agentId, "aa-m5-e6cd168ae458950e");
		assert.match(tree[0].prompt, /auditing/);
	});

	it("REGRESSION: an unlinked half is kept and MARKED, never silently dropped", () => {
		// Most captured lifecycle events belong to teammate sessions this core
		// never saw spawned -- 176 of 199 agents in the live backfill. Dropping
		// them would hide most of the picture; merging them would invent one.
		const t = new AgentTracker();
		t.ingest(lifecycle("SubagentStop", "a7ade5549bfbe9d4d"));
		const [agent] = t.getTree();
		assert.equal(agent.linked, false);
		assert.equal(agent.prompt, undefined, "we do not know what it was asked");
		assert.equal(t.stats().unlinked, 1);
	});

	it("never merges two different agents onto one record", () => {
		const t = new AgentTracker();
		t.ingest(spawn());
		t.ingest(lifecycle("SubagentStart", "aa-m5-1111111111111111"));
		t.ingest(lifecycle("SubagentStart", "aother-2222222222222222"));
		const tree = t.getTree();
		assert.equal(tree.length, 2);
		assert.equal(new Set(tree.map((a) => a.agentId)).size, 2);
	});
});

describe("agents: recovering the type the platform left blank", () => {
	it("REGRESSION: a blank agentType is not treated as a name", () => {
		// 195 of 384 stops carry agentType as an EMPTY STRING, not absent. A
		// truthy check passes it straight through as the type.
		const t = new AgentTracker();
		t.ingest(
			lifecycle(
				"SubagentStop",
				"amemory-backend-e6cd168ae458950e",
				{},
				{ agentType: "" },
			),
		);
		const [agent] = t.getTree();
		assert.equal(agent.type, "memory-backend", "recovered from the id");
	});

	it("prefers a declared type over the inferred one", () => {
		const t = new AgentTracker();
		t.ingest(
			lifecycle(
				"SubagentStop",
				"asomething-e6cd168ae458950e",
				{},
				{ agentType: "Explore" },
			),
		);
		assert.equal(t.getTree()[0].type, "Explore");
	});

	it("admits it does not know, rather than inventing a type", () => {
		// An all-hex id carries no name. That is the honest answer.
		assert.equal(typeFromAgentId("a7ade5549bfbe9d4d"), undefined);
		assert.equal(
			typeFromAgentId("amemory-backend-e6cd168ae458950e"),
			"memory-backend",
		);
		assert.equal(typeFromAgentId(undefined), undefined);
		assert.equal(typeFromAgentId(""), undefined);
		assert.equal(typeFromAgentId("nope"), undefined);
	});
});

describe("agents: the tree and its stats", () => {
	it("counts spawn-ack-only agents, which is the finding that matters", () => {
		const t = new AgentTracker();
		t.ingest(spawn());
		t.ingest(spawnResult());
		const s = t.stats();
		assert.equal(s.spawnAckOnly, 1);
		assert.equal(s.total, 1);
	});

	it("orders newest first and scopes by session", () => {
		const t = new AgentTracker();
		t.ingest(
			lifecycle("SubagentStart", "a111111111111111a", {
				timestamp: "2026-09-07T10:00:00.000Z",
			}),
		);
		t.ingest(
			lifecycle("SubagentStart", "a222222222222222b", {
				timestamp: "2026-09-07T11:00:00.000Z",
				sessionId: "s2",
			}),
		);

		assert.equal(t.getTree()[0].agentId, "a222222222222222b");
		assert.deepEqual(
			t.getTree({ sessionId: "s2" }).map((a) => a.agentId),
			["a222222222222222b"],
		);
	});

	it("exposes children so the shape survives learning about parentage", () => {
		// Nesting is flat today: no captured event says which agent spawned
		// another, and inventing a hierarchy would be a guess.
		const t = new AgentTracker();
		t.ingest(lifecycle("SubagentStart", "a111111111111111a"));
		assert.deepEqual(t.getTree()[0].children, []);
	});

	it("is bounded, and forgets the oldest first", () => {
		const t = new AgentTracker({ maxAgents: 5 });
		for (let i = 0; i < 20; i++) {
			t.ingest(lifecycle("SubagentStart", `a${String(i).padStart(16, "0")}f`));
		}
		assert.equal(t.size, 5);
	});

	it("ignores everything that is not about an agent", () => {
		const t = new AgentTracker();
		t.ingest(base({ tool: "Bash", details: { cwd: "/w" } }));
		t.ingest(base({ hook: "SessionStart", event: "SessionStart" }));
		assert.equal(t.size, 0);
	});

	it("never throws on junk", () => {
		const t = new AgentTracker();
		for (const bad of [
			null,
			undefined,
			{},
			{ details: null },
			{ hook: "SubagentStop", details: {} },
		]) {
			assert.doesNotThrow(() => t.ingest(bad), JSON.stringify(bad));
		}
	});
});

describe("agents: backfill must replay history forwards", () => {
	it("REGRESSION: a reversed log produces the same tree as an ordered one", () => {
		// `logManager.getLogs` returns NEWEST FIRST by default, and the core
		// hands its output straight to backfill. Replayed backwards, stops
		// arrive before starts and results before spawns. Measured on the real
		// 13593 events: 199 agents and 24 spawn-acks in order, 182 agents and
		// ZERO spawn-acks reversed -- a tree that looked fine and was wrong in
		// every column.
		const events = [
			spawn(),
			spawnResult(),
			agentToolCall(
				"aa-m5-abcdefabcdefabcd",
				"Bash",
				"2026-09-07T10:05:00.000Z",
			),
			lifecycle("SubagentStop", "aa-m5-abcdefabcdefabcd", {
				timestamp: "2026-09-07T10:10:00.000Z",
			}),
		];

		const forward = new AgentTracker();
		forward.backfill(events);

		const backward = new AgentTracker();
		backward.backfill([...events].reverse());

		const shape = (t) =>
			t.getTree().map((a) => ({
				name: a.name ?? a.type,
				status: a.status,
				calls: a.toolCalls.length,
				kind: a.resultKind,
				linked: a.linked,
			}));

		assert.deepEqual(
			shape(backward),
			shape(forward),
			"order must not change the tree",
		);
		assert.equal(forward.stats().spawnAckOnly, 1);
		assert.equal(backward.stats().spawnAckOnly, 1);
	});

	it("survives entries with no timestamp", () => {
		const t = new AgentTracker();
		assert.doesNotThrow(() =>
			t.backfill([spawn(), { ...spawn(), timestamp: undefined }, null]),
		);
	});
});
