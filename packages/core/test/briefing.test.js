/**
 * Prior-work briefings (M5) — the answer to "what should a later agent ask?"
 *
 * The MCP server is pull-only: an agent must decide to ask, then guess a query.
 * A fresh subagent cannot search for "a-m5 audited the agent tree" because it
 * does not know that happened. A briefing inverts that — given only the task
 * about to start, it says what is already known.
 *
 * The behaviours pinned here are the ones that decide whether this helps or
 * harms: saying nothing when nothing is relevant, never citing a stale graph,
 * and staying inside its size budget.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { AgentTracker, buildBriefing, ResearchIndex } from "../dist/index.js";

const log = (id, kind, text, over = {}) => {
	const details = { cwd: "/w/proj", projectName: "proj", ...over.details };
	if (kind === "conclusion") {
		return {
			id,
			timestamp: over.timestamp ?? "2026-09-07T10:00:00.000Z",
			level: "info",
			sessionId: "s1",
			hook: "Stop",
			event: "Stop",
			message: "",
			details: { ...details, lastAssistantMessage: text },
		};
	}
	if (kind === "file_read") {
		return {
			id,
			timestamp: "2026-09-07T10:00:00.000Z",
			level: "info",
			sessionId: "s1",
			hook: "PostToolUse",
			event: "PostToolUse",
			message: "",
			tool: "Read",
			details: { ...details, tool_input: { file_path: text } },
		};
	}
	// web_search
	return {
		id,
		timestamp: "2026-09-07T10:00:00.000Z",
		level: "info",
		sessionId: "s1",
		hook: "PostToolUse",
		event: "PostToolUse",
		message: "",
		tool: "WebSearch",
		details: {
			...details,
			tool_input: { query: text },
			tool_result: { query: text, results: [] },
		},
	};
};

/** An index holding a few items of each kind, all in one project. */
function makeIndex() {
	const index = new ResearchIndex();
	index.ingest(
		log(
			"c1",
			"conclusion",
			"Retention now prunes logs after seven days and preserves summaries first.",
		),
	);
	index.ingest(
		log("c2", "conclusion", "The diff engine computes hunks with an LCS pass."),
	);
	index.ingest(
		log("f1", "file_read", "/w/proj/packages/core/src/managers/log-manager.ts"),
	);
	index.ingest(log("w1", "web_search", "log retention best practices"));
	return index;
}

/** A tracker holding one agent that never reported. */
function makeTracker() {
	const tracker = new AgentTracker();
	tracker.ingest({
		id: "l1",
		timestamp: "2026-09-07T09:00:00.000Z",
		level: "info",
		sessionId: "s1",
		hook: "PreToolUse",
		event: "PreToolUse",
		message: "",
		tool: "Agent",
		details: {
			cwd: "/w/proj",
			tool_input: {
				description: "Audit retention",
				prompt: "Check whether retention actually prunes.",
				subagent_type: "Explore",
				name: "a-ret",
			},
		},
	});
	tracker.ingest({
		id: "l2",
		timestamp: "2026-09-07T09:00:01.000Z",
		level: "info",
		sessionId: "s1",
		hook: "PostToolUse",
		event: "PostToolUse",
		message: "",
		tool: "Agent",
		details: {
			cwd: "/w/proj",
			tool_input: { name: "a-ret", subagent_type: "Explore" },
			tool_result: { status: "teammate_spawned" },
			durationMs: 30,
		},
	});
	return tracker;
}

const projectKey = "/w/proj";

describe("briefing: says nothing when nothing is relevant", () => {
	it("REGRESSION: an unrelated task gets an EMPTY briefing, not a padded one", async () => {
		// The failure that would do real harm: a briefing assembled out of the
		// merely recent, cited to an agent as prior art. A genuinely new task
		// must get silence.
		const b = await buildBriefing({
			index: makeIndex(),
			tracker: new AgentTracker(),
			projectKey,
			task: "configure kubernetes ingress for the staging cluster",
		});
		assert.equal(b.empty, true);
		assert.equal(b.text, "");
		assert.equal(b.cited, 0);
	});

	it("says nothing at all when there is no task to judge relevance against", async () => {
		const b = await buildBriefing({
			index: makeIndex(),
			tracker: new AgentTracker(),
			projectKey,
		});
		assert.equal(b.empty, true);
	});

	it("an empty corpus is empty, not an error", async () => {
		const b = await buildBriefing({
			index: new ResearchIndex(),
			tracker: new AgentTracker(),
			task: "anything",
		});
		assert.equal(b.empty, true);
	});
});

describe("briefing: what it cites for a matching task", () => {
	it("leads with what was already concluded", async () => {
		const b = await buildBriefing({
			index: makeIndex(),
			tracker: new AgentTracker(),
			projectKey,
			task: "make retention prune old logs",
		});
		assert.equal(b.empty, false);
		assert.match(b.text, /Already concluded/);
		assert.match(b.text, /Retention now prunes/);
		// The unrelated conclusion must not be dragged in.
		assert.ok(!b.text.includes("LCS pass"), "only relevant conclusions");
	});

	it("names agents whose findings never came back, and how to read them", async () => {
		// Unique information: a spawn-ack agent's work exists nowhere else.
		const b = await buildBriefing({
			index: makeIndex(),
			tracker: makeTracker(),
			projectKey,
			task: "make retention prune old logs",
		});
		assert.match(b.text, /never came back/);
		assert.match(b.text, /a-ret/);
		assert.match(b.text, /Audit retention/);
		assert.match(
			b.text,
			/list_agents/,
			"tells the reader how to get the detail",
		);
	});

	it("includes where the work lives and what was already fetched", async () => {
		const b = await buildBriefing({
			index: makeIndex(),
			tracker: new AgentTracker(),
			projectKey,
			task: "log retention pruning",
		});
		assert.match(b.text, /log-manager\.ts|Where this work lives/);
		assert.match(b.text, /Already looked up|retention best practices/);
	});

	it("states its own coverage and calls itself leads, not conclusions", async () => {
		// A briefing that overstates itself is worse than none.
		const b = await buildBriefing({
			index: makeIndex(),
			tracker: new AgentTracker(),
			projectKey,
			task: "make retention prune old logs",
		});
		assert.match(b.text, /related item/);
		assert.match(b.text, /from \d+ indexed/);
		assert.match(b.text, /leads, not conclusions/);
		assert.ok(b.cited > 0 && b.searched > 0);
	});
});

describe("briefing: a stale graph is never cited", () => {
	const graph = (status) => ({
		status: () => status,
		search: () => ({
			hits: [
				{
					score: 9,
					degree: 3,
					matched: [],
					node: {
						id: "n",
						label: "LogManager",
						fileType: "code",
						sourceFile: "src/managers/log-manager.ts",
						sourceLocation: "L1",
						community: 1,
					},
				},
			],
			total: 1,
			terms: [],
			searched: 100,
		}),
	});

	it("cites symbols from a CURRENT graph", async () => {
		const b = await buildBriefing({
			index: makeIndex(),
			tracker: new AgentTracker(),
			graphify: graph({ available: true, stale: false }),
			projectKey,
			task: "log retention pruning",
		});
		assert.match(b.text, /LogManager/);
	});

	it("REGRESSION: skips symbols when the graph is OUT OF DATE", async () => {
		// A stale graph names symbols that may no longer exist. Handing those to
		// an agent as a starting point is precisely the wrong thing.
		const b = await buildBriefing({
			index: makeIndex(),
			tracker: new AgentTracker(),
			graphify: graph({ available: true, stale: true }),
			projectKey,
			task: "log retention pruning",
		});
		assert.ok(
			!b.text.includes("LogManager"),
			"stale symbols must not be cited",
		);
	});

	it("skips symbols when the graph's age is UNKNOWN", async () => {
		// null is not false. An unknown age cannot be treated as current.
		const b = await buildBriefing({
			index: makeIndex(),
			tracker: new AgentTracker(),
			graphify: graph({ available: true, stale: null }),
			projectKey,
			task: "log retention pruning",
		});
		assert.ok(!b.text.includes("LogManager"));
	});
});

describe("briefing: it stays inside its budget", () => {
	it("truncates at maxChars, because this is prepended to someone's prompt", async () => {
		const index = new ResearchIndex();
		for (let i = 0; i < 40; i++) {
			index.ingest(
				log(
					`c${i}`,
					"conclusion",
					`Retention pruning detail number ${i}: ${"x".repeat(300)}`,
				),
			);
		}
		const b = await buildBriefing({
			index,
			tracker: makeTracker(),
			projectKey,
			task: "retention pruning",
			maxChars: 200,
		});
		assert.ok(b.text.length <= 260, `expected <=260, got ${b.text.length}`);
		assert.match(b.text, /truncated/);
	});

	it("never throws on junk input", async () => {
		for (const bad of [{}, { task: null }, { task: 42 }]) {
			await assert.doesNotReject(() =>
				buildBriefing({
					index: new ResearchIndex(),
					tracker: new AgentTracker(),
					...bad,
				}),
			);
		}
	});
});
