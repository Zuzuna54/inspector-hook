/**
 * The service that assembles the four-corpus search.
 *
 * The index is tested separately; what is here is everything the index cannot
 * know about — where documents come from, when they are rebuilt, and the one
 * corpus this service does not own.
 *
 * The delegation is the part most able to fail quietly. `ResearchIndex` holds
 * seven kinds; only two of them are prompts and replies. Forwarding without
 * the kind filter would return web lookups and subagent traffic under a
 * heading that says "Prompts and replies", ranked and plausible.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { ContextFindService, STALE_AFTER_MS } from "../dist/index.js";

function memFile(name, body) {
	return {
		path: `/memory/${name}.md`,
		fileName: `${name}.md`,
		name,
		description: "",
		body,
		modified: "2026-01-01T00:00:00Z",
		size: body.length,
		hasFrontmatter: true,
		indexState: "referenced",
	};
}

/** Records what it was asked, so the kind filter can be asserted. */
function fakeResearch(hits = []) {
	const calls = [];
	return {
		calls,
		search(query, options) {
			calls.push({ query, options });
			return {
				hits,
				total: hits.length,
				searched: 42,
				terms: query.trim() ? query.split(/\s+/) : [],
				scope: options?.projectKey ? "project" : "all",
			};
		},
	};
}

function researchHit(id, title, text) {
	return {
		item: {
			id,
			kind: "user_prompt",
			timestamp: "2026-01-01T00:00:00Z",
			title,
			text,
			sessionId: "s1",
			projectKey: "proj",
			projectName: "Proj",
		},
		score: 3.5,
		matched: ["term"],
	};
}

/** A service with every source empty unless overridden. */
function service(overrides = {}) {
	return new ContextFindService({
		memoryProjects: async () => [],
		sessions: async () => [],
		digestFor: async () => ({
			sessionId: "s",
			name: "n",
			description: "d",
			type: "project",
			body: "b",
			title: "t",
			worthKeeping: true,
		}),
		summaries: async () => [],
		changes: async () => [],
		research: () => fakeResearch(),
		projects: async () => [
			{
				id: "/repo",
				name: "Repo",
				root: "/repo",
				gitRemote: "acme/repo",
				paths: ["/repo"],
				counts: {},
			},
		],
		...overrides,
	});
}

describe("the delegated corpus", () => {
	it("asks the research index for prompts and replies ONLY", () => {
		// Without the filter this group returns web lookups, subagent reports
		// and file reads under a heading that says prompts and replies.
		const research = fakeResearch();
		return service({ research: () => research })
			.find("anything")
			.then(() => {
				assert.equal(research.calls.length, 1);
				assert.deepEqual(research.calls[0].options.kinds, [
					"user_prompt",
					"conclusion",
				]);
			});
	});

	it("carries the hits through as its own group", async () => {
		const research = fakeResearch([researchHit("r1", "a prompt", "the body")]);
		const result = await service({ research: () => research }).find("q");
		const group = result.groups.find((g) => g.corpus === "prompt");
		assert.equal(group.hits.length, 1);
		assert.equal(group.hits[0].id, "r1");
		assert.equal(group.hits[0].corpus, "prompt");
		assert.equal(group.hits[0].snippet, "the body");
		assert.equal(group.searched, 42, "the delegated count was not passed through");
	});

	it("says so when the research index cannot be reached", async () => {
		// An empty group would read as "nothing matched", which is a different
		// and false statement.
		const result = await service({
			research: () => {
				throw new Error("not loaded");
			},
		}).find("q");
		const group = result.groups.find((g) => g.corpus === "prompt");
		assert.match(group.unavailable, /research index/i);
		assert.equal(group.hits.length, 0);
	});

	it("forwards the GIT REMOTE, which is what the research index keys on", async () => {
		// Passing the project's path here returned "0 of 0" prompts for a
		// project whose digests and file changes all matched — the research
		// corpus is keyed on `acme/repo`, not on `/repo`.
		const research = fakeResearch();
		await service({ research: () => research }).find("q", { projectId: "/repo" });
		assert.equal(research.calls[0].options.projectKey, "acme/repo");
	});
});

describe("the result", () => {
	it("returns all five corpora, in a stable order", async () => {
		// Events joined when the header search became global; the delegated
		// prompt corpus stays last because a different index answers for it.
		const result = await service().find("q");
		assert.deepEqual(
			result.groups.map((g) => g.corpus),
			["memory", "digest", "filechange", "logs", "prompt"],
		);
	});

	it("reports its own breadth", async () => {
		assert.equal((await service().find("q")).scope, "all");
		const scoped = await service().find("q", { projectId: "/repo" });
		assert.equal(scoped.scope, "project");
		assert.equal(scoped.projectKey, "/repo");
	});

	it("has no field holding a merged ranking", async () => {
		// The scores come from four indexes with four different `avgdl` values.
		// A combined list would be arbitrary and look authoritative.
		const result = await service().find("q");
		for (const key of ["hits", "results", "ranked", "merged", "all"]) {
			assert.equal(result[key], undefined, `a merged list appeared as \`${key}\``);
		}
	});
});

describe("building from sources", () => {
	it("indexes what the sources return", async () => {
		const result = await service({
			memoryProjects: async () => [
				{
					slug: "proj",
					memoryDir: "/m",
					files: [memFile("notes", "the distinctive marker")],
					hasIndex: true,
					totalSize: 1,
					indexLines: 1,
					indexBytes: 1,
				},
			],
		}).find("distinctive");
		const group = result.groups.find((g) => g.corpus === "memory");
		assert.equal(group.hits.length, 1);
		assert.equal(group.searched, 1);
	});

	it("one failing source does not cost the others their corpus", async () => {
		// A rejected read must not take down the whole search — the other
		// corpora are unaffected and the broken one reports as empty.
		const result = await service({
			memoryProjects: async () => {
				throw new Error("disk gone");
			},
			changes: async () => [
				{
					id: "c1",
					filePath: "src/found.ts",
					sessionId: "s",
					timestamp: "2026-01-01T00:00:00Z",
					beforeContent: "",
					afterContent: "marker line\n",
					status: "kept",
				},
			],
		}).find("marker");

		assert.equal(result.groups.find((g) => g.corpus === "memory").searched, 0);
		assert.equal(result.groups.find((g) => g.corpus === "filechange").hits.length, 1);
	});

	it("attributes a file change through the session that made it", async () => {
		// A change knows its session but not its project; the session knows
		// both. Without this every file change is unattributable — 0 of 238 on
		// the live store — so a scoped search can never confirm one.
		const result = await service({
			sessions: async () => [
				{
					id: "s1",
					name: "one",
					startTime: "2026-01-01T00:00:00Z",
					metadata: { workingDirectory: "/repo", projectName: "Repo" },
				},
			],
			changes: async () => [
				{
					id: "c1",
					filePath: "src/a.ts",
					sessionId: "s1",
					timestamp: "2026-01-01T00:00:00Z",
					beforeContent: "",
					afterContent: "marker\n",
					status: "kept",
				},
			],
		}).find("marker");
		const hit = result.groups.find((g) => g.corpus === "filechange").hits[0];
		assert.equal(hit.projectKey, "/repo");
		assert.equal(hit.projectName, "Repo");
	});

	it("leaves a change unattributed when its session is gone", async () => {
		// A real state — retention outlives sessions — and reported as unknown
		// rather than guessed at from the file path.
		const result = await service({
			changes: async () => [
				{
					id: "c1",
					filePath: "src/a.ts",
					sessionId: "long-gone",
					timestamp: "2026-01-01T00:00:00Z",
					beforeContent: "",
					afterContent: "marker\n",
					status: "kept",
				},
			],
		}).find("marker");
		const hit = result.groups.find((g) => g.corpus === "filechange").hits[0];
		assert.equal(hit.projectKey, undefined);
	});

	it("skips a digest that judged itself not worth keeping", async () => {
		// Indexing them would rank "nothing happened" bodies against real work.
		const result = await service({
			sessions: async () => [
				{ id: "s1", name: "one", startTime: "2026-01-01T00:00:00Z" },
			],
			digestFor: async () => ({
				sessionId: "s1",
				name: "n",
				description: "d",
				type: "project",
				body: "distinctive body",
				title: "t",
				worthKeeping: false,
				skipReason: "nothing happened",
			}),
		}).find("distinctive");
		assert.equal(result.groups.find((g) => g.corpus === "digest").searched, 0);
	});

	it("a collapsed summary replaces the live digest for the same session", async () => {
		const result = await service({
			sessions: async () => [
				{ id: "s1", name: "one", startTime: "2026-01-01T00:00:00Z" },
			],
			digestFor: async () => ({
				sessionId: "s1",
				name: "n",
				description: "d",
				type: "project",
				body: "live body",
				title: "t",
				worthKeeping: true,
			}),
			summaries: async () => [
				{
					id: "s1",
					collapsedAt: "2026-01-02T00:00:00Z",
					description: "collapsed description",
					digest: "collapsed body",
					toolExecutionCount: 1,
					fileChangeCount: 0,
				},
			],
		}).find("collapsed");
		const group = result.groups.find((g) => g.corpus === "digest");
		assert.equal(group.searched, 1, "the session is in the corpus twice");
		assert.equal(group.hits.length, 1);
	});
});

describe("the events corpus", () => {
	it("indexes captured events, so a global search reaches them", async () => {
		// The header search used to be a substring match on a log's summary
		// line and nothing else. This is the corpus that replaces it.
		const result = await service({
			logs: async () => [
				{
					id: "l1",
					timestamp: "2026-01-01T00:00:00Z",
					message: "Bash: npm run distinctivetask",
					hook: "PreToolUse",
					event: "tool.pre",
					tool: "Bash",
					sessionId: "s1",
					level: "info",
				},
			],
		}).find("distinctivetask");
		const group = result.groups.find((g) => g.corpus === "logs");
		assert.equal(group.hits.length, 1);
		assert.equal(group.hits[0].title, "Bash");
	});

	it("indexes the tool name, not only the summary line", async () => {
		// A substring match on `message` could not find "Edit" unless the
		// summary happened to spell it. This is the difference.
		const result = await service({
			logs: async () => [
				{
					id: "l1",
					timestamp: "2026-01-01T00:00:00Z",
					message: "wrote 4 lines",
					tool: "Edit",
					sessionId: "s1",
				},
			],
		}).find("Edit");
		assert.equal(
			result.groups.find((g) => g.corpus === "logs").hits.length,
			1,
			"the tool name is not searchable",
		);
	});

	it("attributes an event through the session that produced it", async () => {
		const result = await service({
			sessions: async () => [
				{
					id: "s1",
					name: "one",
					startTime: "2026-01-01T00:00:00Z",
					metadata: { workingDirectory: "/repo", projectName: "Repo" },
				},
			],
			logs: async () => [
				{
					id: "l1",
					timestamp: "2026-01-01T00:00:00Z",
					message: "marker",
					sessionId: "s1",
				},
			],
		}).find("marker");
		const hit = result.groups.find((g) => g.corpus === "logs").hits[0];
		assert.equal(hit.projectKey, "/repo");
	});

	it("resolves an event back to its full record", async () => {
		// Left unhandled this returned null, which the panel renders as "that
		// result no longer resolves to a source" — a false statement about a
		// record sitting in the store, on an ENABLED button.
		const svc = service({
			logs: async () => [
				{
					id: "l1",
					timestamp: "2026-01-01T00:00:00Z",
					message: "Bash: npm run build",
					hook: "PreToolUse",
					tool: "Bash",
					sessionId: "s1",
				},
			],
		});
		const resolved = await svc.resolveHit("logs:l1");
		assert.ok(resolved, "an event in the store did not resolve");
		assert.equal(resolved.kind, "free_text");
		assert.match(resolved.text, /npm run build/);
		assert.equal(resolved.source.sessionId, "s1");
	});

	it("returns null for an event that is no longer in the store", async () => {
		const resolved = await service({ logs: async () => [] }).resolveHit("logs:gone");
		assert.equal(resolved, null);
	});

	it("is a corpus of its own, never merged into another", async () => {
		const result = await service().find("q");
		assert.deepEqual(
			result.groups.map((g) => g.corpus),
			["memory", "digest", "filechange", "logs", "prompt"],
		);
	});

	it("costs nothing when no log source is supplied", async () => {
		const result = await service({ logs: undefined }).find("q");
		assert.equal(result.groups.find((g) => g.corpus === "logs").searched, 0);
	});
});

describe("rebuilding", () => {
	it("builds once and reuses it inside the staleness window", async () => {
		let reads = 0;
		const svc = service({
			memoryProjects: async () => {
				reads++;
				return [];
			},
		});
		await svc.find("a");
		await svc.find("b");
		assert.equal(reads, 1, "every search re-read the disk");
	});

	it("concurrent searches share one rebuild", async () => {
		let reads = 0;
		const svc = service({
			memoryProjects: async () => {
				reads++;
				await new Promise((r) => setTimeout(r, 10));
				return [];
			},
		});
		await Promise.all([svc.find("a"), svc.find("b"), svc.find("c")]);
		assert.equal(reads, 1, "a concurrent search started a second rebuild");
	});

	it("rebuilds when asked, regardless of age", async () => {
		let reads = 0;
		const svc = service({
			memoryProjects: async () => {
				reads++;
				return [];
			},
		});
		await svc.find("a");
		await svc.find("b", { refresh: true });
		assert.equal(reads, 2);
	});

	it("picks up a source that changed after the first build", async () => {
		let files = [];
		const svc = service({
			memoryProjects: async () => [
				{
					slug: "p",
					memoryDir: "/m",
					files,
					hasIndex: true,
					totalSize: 0,
					indexLines: 0,
					indexBytes: 0,
				},
			],
		});
		await svc.find("later");
		files = [memFile("new", "arrived later")];
		const result = await svc.find("later", { refresh: true });
		assert.equal(result.groups.find((g) => g.corpus === "memory").hits.length, 1);
	});

	it("keeps a staleness window long enough to be worth having", () => {
		// A window near zero would make every keystroke re-read every memory
		// file on the machine.
		assert.ok(STALE_AFTER_MS >= 5_000, "the window is too short to help");
	});
});

describe("stats", () => {
	it("omits the numbers it cannot truthfully supply for a delegated corpus", async () => {
		// ResearchIndex exposes neither its vocabulary nor its cap. Reporting 0
		// would read as "no terms, no limit" — two specific and false claims.
		const stats = await service().stats();
		const prompt = stats.corpora.find((c) => c.corpus === "prompt");
		assert.equal(prompt.delegatedTo, "research");
		assert.equal(prompt.vocabulary, undefined);
		assert.equal(prompt.cap, undefined);
		assert.equal(prompt.evicted, undefined);
		assert.equal(prompt.documents, 42, "the delegated count was invented");
	});

	it("counts the delegated corpus kind-filtered, not the whole index", async () => {
		const research = fakeResearch();
		await service({ research: () => research }).stats();
		const call = research.calls.at(-1);
		assert.deepEqual(call.options.kinds, ["user_prompt", "conclusion"]);
	});

	it("reports the local corpora with their caps", async () => {
		const stats = await service().stats();
		for (const corpus of ["memory", "digest", "filechange"]) {
			const held = stats.corpora.find((c) => c.corpus === corpus);
			assert.equal(held.delegatedTo, undefined);
			assert.ok(held.cap > 0, `${corpus} reports no cap`);
			assert.equal(held.evicted, 0);
		}
	});

	it("surfaces what the store costs on disk", async () => {
		// Retention is off by choice, so growth is unbounded and nothing else
		// in the UI reports it.
		const stats = await service({
			storeStats: async () => ({
				totalSize: 1234,
				sessionCount: 4,
				logCount: 10,
				versionCount: 2,
				archiveCount: 3,
			}),
		}).stats();
		assert.equal(stats.store.totalSize, 1234);
	});

	it("survives a store that cannot report", async () => {
		const stats = await service({
			storeStats: async () => {
				throw new Error("no store");
			},
		}).stats();
		assert.equal(stats.store, undefined);
		assert.ok(stats.corpora.length, "a failing store cost us the corpus stats");
	});
});
