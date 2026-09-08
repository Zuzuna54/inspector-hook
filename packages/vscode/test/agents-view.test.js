/**
 * Agents view (M5).
 *
 * Loads the REAL scripts/state.js, for the same reason research-view.test.js
 * does: the harness stub's `update` is a no-op, so a view that forgot to
 * subscribe would pass against it. That exact bug shipped once already.
 *
 * Fixtures use the live shapes — a spawn acknowledgement rather than a report,
 * a computed duration rather than a reported one, and an unlinked agent — which
 * are what 384 real `SubagentStop` events and 32 real spawn calls actually look
 * like.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { installGlobals, readMedia } from "./harness.js";

function element(id) {
	return {
		id,
		innerHTML: "",
		className: "",
		dataset: {},
		listeners: {},
		classList: { toggle() {} },
		addEventListener(t, fn) {
			(this.listeners[t] ||= []).push(fn);
		},
		click() {
			for (const fn of this.listeners.click || []) fn();
		},
	};
}

function loadAgents(stateOverrides = {}) {
	const sent = [];
	const els = new Map();
	for (const id of ["agents-view", "ag-stats", "ag-list", "ag-refresh"]) {
		els.set(id, element(id));
	}
	installGlobals({
		API: {
			agentsTree: (p) => sent.push({ tree: p ?? {} }),
			agentsGet: (p) => sent.push({ get: p }),
			agentsStats: () => sent.push({ stats: true }),
		},
		document: {
			getElementById: (id) => els.get(id) ?? null,
			querySelector: () => null,
			querySelectorAll: () => [],
			createElement: () => element("created"),
			visibilityState: "visible",
		},
	});

	// biome-ignore lint/security/noGlobalEval: classic script, see harness.js
	eval(readMedia("scripts/state.js"));
	globalThis.State = globalThis.window.State;
	globalThis.State.agentsView = {
		agents: [],
		stats: null,
		selected: null,
		filter: "all",
		loading: false,
		error: null,
		...stateOverrides,
	};

	// biome-ignore lint/security/noGlobalEval: classic script, see harness.js
	eval(readMedia("scripts/views/agents.js"));
	const view = globalThis.window.AgentsView;
	view._unsubscribers = [];
	return { view, sent, els, State: globalThis.State };
}

/** An agent that acknowledged its spawn and never reported — the common case. */
const teammate = (over = {}) => ({
	id: "spawn-1",
	agentId: "aa-m5-abcdefabcdefabcd",
	name: "a-m5",
	type: "Explore",
	status: "completed",
	description: "Audit M5 agent tree",
	prompt: "Independent correctness audit of the agent tree.",
	result: '{"status":"teammate_spawned"}',
	resultKind: "spawn-ack",
	durationMs: 738_000,
	durationSource: "computed",
	toolCalls: [
		{
			tool: "Bash",
			timestamp: "2026-09-07T10:00:00.000Z",
			summary: "run tests",
		},
	],
	linked: true,
	children: [],
	...over,
});

const stats = (over = {}) => ({
	total: 170,
	running: 0,
	completed: 170,
	unknown: 0,
	unlinked: 148,
	spawnAckOnly: 14,
	byType: { Explore: 24 },
	totalToolCalls: 1874,
	...over,
});

describe("agents view: it subscribes, or it shows nothing", () => {
	it("REGRESSION: a tree arriving actually re-renders", () => {
		const { view, els, State } = loadAgents();
		view.init();
		view.render();
		State.update("agentsView", { ...State.agentsView, loading: true });
		assert.match(els.get("ag-list").innerHTML, /Loading agents/);

		State.update("agentsView", {
			...State.agentsView,
			loading: false,
			agents: [teammate()],
		});
		const html = els.get("ag-list").innerHTML;
		assert.ok(!html.includes("Loading agents"), "the spinner must clear");
		assert.match(html, /a-m5/);
	});

	it("a failed load renders the failure, not an empty tree", () => {
		// "No agents ran" and "we could not ask" are different facts.
		const { view, els, State } = loadAgents();
		view.init();
		view.render();
		State.update("agentsView", {
			...State.agentsView,
			loading: false,
			error: "core is not running",
		});
		const html = els.get("ag-list").innerHTML;
		assert.ok(!html.includes("No agents match"));
		assert.match(html, /core is not running/);
	});

	it("asks for the tree on init", () => {
		const { view, sent } = loadAgents();
		view.init();
		assert.equal(sent.filter((s) => s.tree).length, 1);
	});

	it("cleanup unsubscribes", () => {
		const { view, els, State } = loadAgents();
		view.init();
		view.render();
		view.cleanup();
		State.update("agentsView", {
			...State.agentsView,
			loading: false,
			agents: [teammate()],
		});
		assert.ok(!els.get("ag-list").innerHTML.includes("a-m5"));
	});
});

describe("agents view: a spawn acknowledgement is never shown as a report", () => {
	it("REGRESSION: labels a spawn-ack agent 'never reported'", () => {
		// The finding the whole view exists for. All 32 captured spawn calls
		// returned an acknowledgement; the plan opens M5 by noting six agents
		// whose reports never reached the parent.
		const { view, els, State } = loadAgents();
		view.init();
		view.render();
		State.update("agentsView", {
			...State.agentsView,
			loading: false,
			agents: [teammate()],
		});

		const html = els.get("ag-list").innerHTML;
		assert.match(html, /never reported/);
		assert.ok(
			!/>reported</.test(html.replace(/never reported/g, "")),
			"not shown as reported",
		);
	});

	it("labels a real report as reported", () => {
		const { view, els, State } = loadAgents();
		view.init();
		view.render();
		State.update("agentsView", {
			...State.agentsView,
			loading: false,
			agents: [teammate({ resultKind: "report", result: "Found three bugs." })],
		});
		assert.match(els.get("ag-list").innerHTML, /reported/);
		assert.ok(!els.get("ag-list").innerHTML.includes("never reported"));
	});

	it("marks the expanded acknowledgement as an acknowledgement", () => {
		const agent = teammate();
		const { view, els, State } = loadAgents();
		view.init();
		view.render();
		State.update("agentsView", {
			...State.agentsView,
			loading: false,
			agents: [agent],
			selected: agent,
		});
		assert.match(els.get("ag-list").innerHTML, /acknowledgement only/);
	});
});

describe("agents view: a duration always states where it came from", () => {
	it("says 'so far' while the agent is still running", () => {
		// A computed span for a running agent means "so far", not "in total".
		const { view, els, State } = loadAgents();
		view.init();
		view.render();
		State.update("agentsView", {
			...State.agentsView,
			loading: false,
			agents: [teammate({ status: "running", durationMs: 90_000 })],
		});
		assert.match(els.get("ag-list").innerHTML, /so far/);
	});

	it("says so when there is no usable duration", () => {
		// SubagentStop.durationMs is null in 384 of 384, so this is common.
		const { view, els, State } = loadAgents();
		view.init();
		view.render();
		State.update("agentsView", {
			...State.agentsView,
			loading: false,
			agents: [teammate({ durationMs: undefined, durationSource: undefined })],
		});
		assert.match(els.get("ag-list").innerHTML, /no duration/);
	});

	it("distinguishes reported from computed in the tooltip", () => {
		const { view, els, State } = loadAgents();
		view.init();
		view.render();
		State.update("agentsView", {
			...State.agentsView,
			loading: false,
			agents: [teammate({ durationSource: "reported", durationMs: 4200 })],
		});
		assert.match(els.get("ag-list").innerHTML, /Reported by the platform/);
	});
});

describe("agents view: unlinked agents are shown, not hidden", () => {
	it("REGRESSION: an agent with no spawn call still appears, marked", () => {
		// 148 of 170 live agents are unlinked. Hiding them would hide most of
		// the picture; merging them would invent one.
		const { view, els, State } = loadAgents();
		view.init();
		view.render();
		State.update("agentsView", {
			...State.agentsView,
			loading: false,
			agents: [
				teammate({
					id: "a7ade5549bfbe9d4d",
					name: undefined,
					description: undefined,
					prompt: undefined,
					linked: false,
				}),
			],
		});
		const html = els.get("ag-list").innerHTML;
		assert.match(html, /a7ade5549bfbe9d4d/);
		assert.match(html, /unlinked/);
	});

	it("says the ask is unknown rather than leaving it blank", () => {
		const agent = teammate({
			prompt: undefined,
			description: undefined,
			linked: false,
		});
		const { view, els, State } = loadAgents();
		view.init();
		view.render();
		State.update("agentsView", {
			...State.agentsView,
			loading: false,
			agents: [agent],
			selected: agent,
		});
		assert.match(els.get("ag-list").innerHTML, /what it was asked is unknown/);
	});
});

describe("agents view: stats and filters", () => {
	it("surfaces the two numbers that matter", () => {
		const { view, els, State } = loadAgents();
		view.init();
		view.render();
		State.update("agentsView", { ...State.agentsView, stats: stats() });
		const html = els.get("ag-stats").innerHTML;
		assert.match(html, /170 agents/);
		assert.match(html, /14 never reported/);
		assert.match(html, /148 unlinked/);
	});

	it("filters to the agents that never reported", () => {
		const { view, State } = loadAgents({
			agents: [teammate(), teammate({ id: "b", resultKind: "report" })],
		});
		view.init();
		view.render();
		State.update("agentsView", { ...State.agentsView, filter: "unreported" });
		assert.deepEqual(
			view.visible().map((a) => a.id),
			["spawn-1"],
		);
	});

	it("filters to running and to agents that did work", () => {
		const { view, State } = loadAgents({
			agents: [
				teammate({ id: "run", status: "running" }),
				teammate({ id: "idle", toolCalls: [] }),
			],
		});
		view.init();
		view.render();
		State.update("agentsView", { ...State.agentsView, filter: "running" });
		assert.deepEqual(
			view.visible().map((a) => a.id),
			["run"],
		);
		State.update("agentsView", { ...State.agentsView, filter: "worked" });
		assert.deepEqual(
			view.visible().map((a) => a.id),
			["run"],
		);
	});

	it("escapes agent-supplied text", () => {
		const { view, els, State } = loadAgents();
		view.init();
		view.render();
		State.update("agentsView", {
			...State.agentsView,
			loading: false,
			agents: [teammate({ name: "<img onerror=1>", description: "<script>" })],
		});
		const html = els.get("ag-list").innerHTML;
		assert.ok(!html.includes("<img"));
		assert.ok(!html.includes("<script>"));
	});

	it("renders without a container rather than throwing", () => {
		const { view } = loadAgents();
		globalThis.document.getElementById = () => null;
		assert.doesNotThrow(() => view.render());
		assert.doesNotThrow(() => view.renderList());
		assert.doesNotThrow(() => view.renderStats());
	});
});

describe("agents view: the state slice has one definition", () => {
	it("REGRESSION: reset() and the literal must not drift", () => {
		const source = readMedia("scripts/state.js");
		const keysOf = (b) =>
			[...b.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort();
		const literal = source.match(/\n\tagentsView: \{([\s\S]*?)\n\t\},/);
		const reset = source.match(/this\.agentsView = \{([\s\S]*?)\n\t\t\};/);
		assert.ok(literal && reset, "both definitions must be findable");
		assert.deepEqual(keysOf(reset[1]), keysOf(literal[1]));
	});
});
