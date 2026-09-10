/**
 * Agent parentage from the transcript layout (M5.9).
 *
 * M5 promised "a live agent tree" and shipped a flat list, correctly marked
 * `not-impl`: no captured hook event states which agent spawned another, and
 * inferring it from timing would have been a guess. The signal turned out to
 * be in the on-disk layout, which M8's transcript work surfaced — a subagent's
 * transcript lives inside its parent's directory, so the path IS the answer.
 *
 * The test that carries the weight here is the nested-fixture one. Every real
 * tree on this machine is one level deep, and without a fixture that is two
 * levels deep there would be no way to tell "no agent ever spawned an agent"
 * apart from "the code cannot represent that" — which is precisely the
 * ambiguity that let M5.9 sit unimplemented while looking finished.
 */

import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { AgentTracker, discoverAgentParents } from "../dist/index.js";

const dirs = [];
after(async () => {
	for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

async function temp() {
	const dir = await mkdtemp(join(tmpdir(), "ih-parent-"));
	dirs.push(dir);
	return dir;
}

/** Write an empty transcript at a path, creating its directories. */
async function transcript(root, ...parts) {
	const path = join(root, ...parts);
	await mkdir(join(path, ".."), { recursive: true });
	await writeFile(path, "", "utf-8");
	return path;
}

describe("parentage from the transcript layout", () => {
	it("attributes a subagent to the session whose directory holds it", async () => {
		const root = await temp();
		await transcript(root, "-Users-me-app", "sess-1.jsonl");
		await transcript(
			root,
			"-Users-me-app",
			"sess-1",
			"subagents",
			"agent-a1.jsonl",
		);
		await transcript(
			root,
			"-Users-me-app",
			"sess-1",
			"subagents",
			"agent-a2.jsonl",
		);

		const result = await discoverAgentParents(root);
		assert.equal(result.parents.size, 2);
		const a1 = result.parents.get("a1");
		assert.equal(a1.sessionId, "sess-1");
		assert.equal(a1.project, "-Users-me-app");
		assert.equal(a1.depth, 1);
		// Spawned by the SESSION, so there is no parent agent — and that is a
		// fact, not a missing value.
		assert.equal(a1.parentAgentId, undefined);
		assert.equal(result.maxDepth, 1);
	});

	it("REGRESSION: represents an agent that spawned an agent", async () => {
		// The whole point. On the real machine maxDepth is 1 across all 83
		// subagent transcripts, and a flat result is only meaningful if the
		// code demonstrably handles a deeper one.
		const root = await temp();
		await transcript(root, "-Users-me-app", "sess-1.jsonl");
		await transcript(
			root,
			"-Users-me-app",
			"sess-1",
			"subagents",
			"agent-parent.jsonl",
		);
		await transcript(
			root,
			"-Users-me-app",
			"sess-1",
			"subagents",
			"agent-parent",
			"subagents",
			"agent-child.jsonl",
		);

		const result = await discoverAgentParents(root);
		assert.equal(result.maxDepth, 2, "the second level must be found");

		const child = result.parents.get("child");
		assert.equal(
			child.parentAgentId,
			"parent",
			"the enclosing AGENT is the parent",
		);
		assert.equal(child.sessionId, "sess-1", "and the session is still known");
		assert.equal(child.depth, 2);

		// The parent itself is still owned by the session.
		assert.equal(result.parents.get("parent").parentAgentId, undefined);
	});

	it("reports the depth it FOUND, so flat is never read as unimplemented", async () => {
		const root = await temp();
		await transcript(
			root,
			"-Users-me-app",
			"sess-1",
			"subagents",
			"agent-only.jsonl",
		);
		const result = await discoverAgentParents(root);
		assert.equal(result.maxDepth, 1);
		assert.equal(result.sessionsScanned, 1);
	});

	it("says so when the transcript root cannot be read", async () => {
		const result = await discoverAgentParents("/nonexistent/transcripts");
		assert.equal(result.parents.size, 0);
		assert.equal(
			result.maxDepth,
			0,
			"0 means not looked, 1 means looked and flat",
		);
		assert.match(result.error, /could not read/);
	});

	it("ignores a session with no subagents rather than failing", async () => {
		const root = await temp();
		await transcript(root, "-Users-me-app", "sess-quiet.jsonl");
		await mkdir(join(root, "-Users-me-app", "sess-quiet"), { recursive: true });
		const result = await discoverAgentParents(root);
		assert.equal(result.parents.size, 0);
		assert.equal(result.error, undefined, "an empty session is not an error");
	});
});

describe("the tree the tracker builds", () => {
	/** A tracker holding two agents, one of which spawned the other. */
	function tracker() {
		const t = new AgentTracker();
		t.agents = t.agents ?? new Map();
		return t;
	}

	it("nests a child under its parent", () => {
		const t = tracker();
		// Seeded through the public ingest path rather than by reaching in, so
		// this cannot pass against a tracker that never builds records.
		const base = {
			sessionId: "s1",
			timestamp: "2026-09-09T10:00:00.000Z",
			hook: "PreToolUse",
			event: "PreToolUse",
			level: "info",
			tool: "Read",
			file: "/a.ts",
			message: "Read: /a.ts",
		};
		t.ingest({ ...base, details: { agentId: "parent", agentType: "Explore" } });
		t.ingest({
			...base,
			timestamp: "2026-09-09T10:01:00.000Z",
			details: { agentId: "child", agentType: "Explore" },
		});

		const before = t.getTree();
		assert.equal(before.length, 2, "both are roots until parentage is known");

		// Now state the parentage the layout would have supplied.
		const child = t.get("child");
		assert.ok(child, "the child agent must exist");
		child.parentAgentId = "parent";

		const after = t.getTree();
		assert.equal(after.length, 1, "the child is no longer a root");
		assert.equal(after[0].children.length, 1);
		assert.equal(after[0].children[0].agentId, "child");
	});

	it("REGRESSION: a child whose parent is filtered out is not lost", () => {
		// getTree pages and filters. If a parent falls outside the page, its
		// child must surface at the top level rather than vanish into a parent
		// that is not in the result.
		const t = tracker();
		const base = {
			sessionId: "s1",
			timestamp: "2026-09-09T10:00:00.000Z",
			hook: "PreToolUse",
			event: "PreToolUse",
			level: "info",
			tool: "Read",
			file: "/a.ts",
			message: "Read: /a.ts",
		};
		t.ingest({ ...base, details: { agentId: "orphan", agentType: "Explore" } });
		const orphan = t.get("orphan");
		orphan.parentAgentId = "a-parent-in-another-session";

		const tree = t.getTree();
		assert.equal(tree.length, 1, "the agent must still be reachable");
		assert.equal(tree[0].agentId, "orphan");
	});
});
