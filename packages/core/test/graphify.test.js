/**
 * Graphify integration — the code/docs graph half of Milestone 4.
 *
 * The fixture is shaped from the real artifact this repo now builds (3933
 * nodes, 4685 edges, `graphify update .`), not invented: same node-link layout,
 * same snake_case field names, the same `relation` vocabulary, and the same
 * `built_at_commit` at the top level. The three shapes that matter here are all
 * ones a made-up fixture would miss:
 *
 *   - node labels are IDENTIFIERS, so tokenisation decides whether the graph is
 *     searchable by anything except the exact symbol name
 *   - relations are directional (`contains`, `calls`) while the file declares
 *     `directed: false`
 *   - the file is rewritten underneath a running core by `graphify watch`
 */

import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
	buildGraph,
	findGraphPath,
	GraphifyGraph,
	GraphifyReader,
	headCommit,
	identifierText,
} from "../dist/index.js";
import { cleanup, makeTempStore } from "./helpers.js";

const dirs = [];
after(async () => {
	await Promise.all(dirs.map(cleanup));
});

const node = (id, label, over = {}) => ({
	id,
	label,
	file_type: "code",
	source_file: "packages/core/src/thing.ts",
	source_location: "L1",
	community: 1,
	...over,
});

const link = (source, target, relation = "contains", over = {}) => ({
	source,
	target,
	relation,
	confidence: "EXTRACTED",
	weight: 1.0,
	source_file: "packages/core/src/thing.ts",
	source_location: "L2",
	...over,
});

/** A graph in graphify's exact on-disk shape. */
const GRAPH = {
	directed: false,
	multigraph: false,
	graph: {},
	hyperedges: [],
	built_at_commit: "a".repeat(40),
	nodes: [
		node("file_ts", "research-handlers.ts", {
			file_type: "code",
			source_file: "src/research-handlers.ts",
		}),
		node("handle_research_command", "handleResearchCommand"),
		node("search_research", "searchResearch"),
		node("get_stats", "getResearchStats"),
		node("unrelated", "formatDuration"),
		node("readme", "README", {
			file_type: "document",
			source_file: "README.md",
		}),
	],
	links: [
		link("file_ts", "handle_research_command"),
		link("handle_research_command", "search_research", "calls"),
		link("handle_research_command", "get_stats", "calls"),
		link("search_research", "readme", "references"),
		// A link to a node that is not in the graph. Real exports have contained
		// these; keeping it would make every degree count wrong.
		link("handle_research_command", "ghost_node", "calls"),
	],
};

/** Write a graph to a temp repo and return its root. */
async function makeRepo(graph = GRAPH, options = {}) {
	const root = await makeTempStore();
	dirs.push(root);
	if (graph !== null) {
		await mkdir(join(root, "graphify-out"), { recursive: true });
		await writeFile(
			join(root, "graphify-out", "graph.json"),
			typeof graph === "string" ? graph : JSON.stringify(graph),
			"utf-8",
		);
	}
	if (options.head) {
		await mkdir(join(root, ".git", "refs", "heads"), { recursive: true });
		await writeFile(
			join(root, ".git", "HEAD"),
			"ref: refs/heads/main\n",
			"utf-8",
		);
		await writeFile(
			join(root, ".git", "refs", "heads", "main"),
			`${options.head}\n`,
			"utf-8",
		);
	}
	return root;
}

describe("graphify: making an identifier graph searchable", () => {
	it("REGRESSION: a word inside an identifier finds the node", () => {
		// tokenize() splits on non-alphanumerics, so `handleResearchCommand` is
		// ONE token and a search for "research" cannot match it. A code graph
		// searchable only by exact symbol name is searchable only by people who
		// already know the answer.
		const g = new GraphifyGraph(GRAPH);
		const hits = g.search("research").hits.map((h) => h.node.label);
		assert.ok(
			hits.includes("handleResearchCommand"),
			`"research" must find handleResearchCommand, got ${JSON.stringify(hits)}`,
		);
	});

	it("still finds the exact identifier", () => {
		// Splitting must not cost the literal match, which is the query someone
		// pasting a symbol name actually types.
		const g = new GraphifyGraph(GRAPH);
		const top = g.search("handleResearchCommand").hits[0];
		assert.equal(top.node.label, "handleResearchCommand");
	});

	it("finds symbols through the file they live in", () => {
		const g = new GraphifyGraph(GRAPH);
		const hits = g.search("research handlers").hits.map((h) => h.node.id);
		assert.ok(hits.includes("file_ts"));
	});

	it("splits camelCase, PascalCase, snake_case and paths, keeping the original", () => {
		assert.equal(
			identifierText("handleResearchCommand"),
			"handleResearchCommand handle Research Command",
		);
		assert.match(identifierText("HTTPServerConfig"), /HTTP Server Config/);
		assert.match(
			identifierText("src/core/file-tracker.ts"),
			/src core file tracker ts/,
		);
		// A plain word must not be duplicated into the index.
		assert.equal(identifierText("README"), "README");
		assert.equal(identifierText(""), "");
	});

	it("filters by file type", () => {
		const g = new GraphifyGraph(GRAPH);
		const docs = g.search("readme research", { fileType: "document" });
		assert.deepEqual(
			docs.hits.map((h) => h.node.id),
			["readme"],
		);
	});

	it("reports what matched and how connected the node is", () => {
		const g = new GraphifyGraph(GRAPH);
		const hit = g.search("handleResearchCommand").hits[0];
		assert.ok(hit.matched.length > 0, "a hit says which terms matched");
		// contains(in) + calls x2(out) = 3. The link to the missing node is NOT
		// counted, because it cannot be traversed.
		assert.equal(hit.degree, 3);
	});
});

describe("graphify: the graph itself", () => {
	it("drops links whose endpoints are not in the graph", () => {
		const g = new GraphifyGraph(GRAPH);
		assert.equal(g.edgeCount, 4, "5 links, one dangling");
		assert.equal(g.nodeCount, 6);
	});

	it("counts communities, file types and relations", () => {
		const g = new GraphifyGraph(GRAPH);
		assert.equal(g.communities(), 1);
		assert.deepEqual(g.byFileType(), { code: 5, document: 1 });
		assert.deepEqual(g.byRelation(), { contains: 1, calls: 2, references: 1 });
	});

	it("survives a graph with no nodes, no links, or junk fields", () => {
		for (const raw of [
			{},
			null,
			{ nodes: null, links: "no" },
			{ nodes: [{}], links: [{}] },
		]) {
			assert.doesNotThrow(() => {
				const g = new GraphifyGraph(raw);
				g.search("x");
				g.neighbors("y");
			}, JSON.stringify(raw));
		}
	});

	it("ignores a duplicate node id rather than letting it overwrite", () => {
		const g = new GraphifyGraph({
			nodes: [node("a", "First"), node("a", "Second")],
			links: [],
		});
		assert.equal(g.nodeCount, 1);
		assert.equal(g.node("a").label, "First");
	});
});

describe("graphify: neighbours", () => {
	it("preserves edge direction, which the file itself throws away", () => {
		// graphify writes `directed: false` and serve.py loads it undirected,
		// but "what calls this" and "what does this call" are different
		// questions. Collapsing them would make the answer useless.
		const g = new GraphifyGraph(GRAPH);
		const n = g.neighbors("handle_research_command", { depth: 1 });
		const byId = Object.fromEntries(n.map((x) => [x.node.id, x.direction]));
		assert.equal(byId.search_research, "out", "it calls searchResearch");
		assert.equal(byId.file_ts, "in", "the file contains it");
	});

	it("depth is shortest-hop distance, breadth first", () => {
		const g = new GraphifyGraph(GRAPH);
		const n = g.neighbors("file_ts", { depth: 3 });
		const depth = Object.fromEntries(n.map((x) => [x.node.id, x.depth]));
		assert.equal(depth.handle_research_command, 1);
		assert.equal(depth.search_research, 2);
		assert.equal(depth.readme, 3);
		assert.equal(depth.unrelated, undefined, "disconnected stays out");
	});

	it("never revisits, and never returns the node itself", () => {
		const g = new GraphifyGraph(GRAPH);
		const n = g.neighbors("handle_research_command", { depth: 5 });
		const ids = n.map((x) => x.node.id);
		assert.equal(new Set(ids).size, ids.length, "no duplicates");
		assert.ok(!ids.includes("handle_research_command"));
	});

	it("filters by relation", () => {
		const g = new GraphifyGraph(GRAPH);
		const calls = g.neighbors("handle_research_command", {
			depth: 1,
			relations: ["calls"],
		});
		assert.deepEqual(calls.map((n) => n.node.id).sort(), [
			"get_stats",
			"search_research",
		]);
	});

	it("honours a limit and an unknown id", () => {
		const g = new GraphifyGraph(GRAPH);
		assert.equal(g.neighbors("file_ts", { depth: 3, limit: 2 }).length, 2);
		assert.deepEqual(g.neighbors("nope"), []);
	});

	it("does not double-count a self loop", () => {
		const g = new GraphifyGraph({
			nodes: [node("a", "A")],
			links: [link("a", "a", "calls")],
		});
		assert.equal(g.degree("a"), 1);
		assert.deepEqual(g.neighbors("a"), [], "a self loop reaches nothing new");
	});
});

describe("graphify: reading from disk", () => {
	it("reports no graph without inventing one", async () => {
		const root = await makeRepo(null);
		const status = new GraphifyReader(root).status();
		assert.equal(status.available, false);
		assert.equal(status.nodes, 0);
		assert.equal(status.path, null);
		assert.equal(findGraphPath(root), null);
	});

	it("loads a real one and reports its composition", async () => {
		const root = await makeRepo();
		const status = new GraphifyReader(root).status();
		assert.equal(status.available, true);
		assert.equal(status.nodes, 6);
		assert.equal(status.edges, 4);
		assert.equal(status.builtAtCommit, "a".repeat(40));
		assert.ok(status.builtAt, "mtime is reported");
	});

	it("REGRESSION: unknown staleness is null, never false", async () => {
		// `false` says "the graph is current". With no HEAD to compare against,
		// that is a claim the reader cannot support, and this project's priority
		// bug class is exactly the confident-but-unfounded answer.
		const noGit = await makeRepo();
		assert.equal(new GraphifyReader(noGit).status().stale, null);

		const fresh = await makeRepo(GRAPH, { head: "a".repeat(40) });
		assert.equal(new GraphifyReader(fresh).status().stale, false);

		const stale = await makeRepo(GRAPH, { head: "b".repeat(40) });
		assert.equal(new GraphifyReader(stale).status().stale, true);
	});

	it("REGRESSION: a rewritten graph is re-read, not served from cache", async () => {
		// `graphify watch` rewrites graph.json underneath a running core.
		const root = await makeRepo();
		const reader = new GraphifyReader(root);
		assert.equal(reader.status().nodes, 6);

		await new Promise((r) => setTimeout(r, 12)); // distinct mtime
		await writeFile(
			join(root, "graphify-out", "graph.json"),
			JSON.stringify({
				...GRAPH,
				nodes: [...GRAPH.nodes, node("added", "newThing")],
			}),
			"utf-8",
		);

		assert.equal(reader.status().nodes, 7, "the rewrite must be visible");
		assert.ok(reader.search("newThing").hits.length > 0);
	});

	it("answers a corrupt graph with a reason instead of throwing", async () => {
		const root = await makeRepo("{ this is not json");
		const status = new GraphifyReader(root).status();
		assert.equal(status.available, false);
		assert.match(status.error, /cannot parse/);
		// And the query surface stays usable.
		assert.deepEqual(new GraphifyReader(root).search("x").hits, []);
		assert.equal(new GraphifyReader(root).node("x"), null);
	});

	it("refuses a relative or empty root rather than resolving it somewhere", () => {
		for (const bad of ["", "relative/path", undefined, null, 42]) {
			assert.equal(findGraphPath(bad), null, String(bad));
		}
	});

	it("reads HEAD without spawning git, and admits when it cannot", async () => {
		const root = await makeRepo(GRAPH, { head: "c".repeat(40) });
		assert.equal(headCommit(root), "c".repeat(40));
		// packed-refs: the ref file is absent, so the answer is unknown.
		await rm(join(root, ".git", "refs", "heads", "main"));
		assert.equal(headCommit(root), null);
		assert.equal(headCommit("/nonexistent"), null);
	});
});

describe("graphify: building", () => {
	it("reports a missing binary as a state, not a crash", async () => {
		const root = await makeRepo(null);
		const result = await buildGraph(root, {
			binary: "graphify-does-not-exist-xyz",
		});
		assert.equal(result.ok, false);
		assert.match(result.error, /not installed|not on PATH/);
	});
});

describe("graphify: against the real artifact", () => {
	// This repo builds its own graph with `graphify update .`. When it is
	// present, assert on it — a fixture cannot show that the parser survives
	// 3933 real nodes, and a passing fixture on a broken parser is exactly the
	// failure this project keeps finding.
	const root = new URL("../../../", import.meta.url).pathname.replace(
		/\/$/,
		"",
	);
	const graphPath = join(root, "graphify-out", "graph.json");

	it("parses this repository's own graph", {
		skip: !existsSync(graphPath),
	}, () => {
		const reader = new GraphifyReader(root);
		const status = reader.status();
		assert.equal(status.available, true);
		assert.ok(status.nodes > 1000, `real graph has ${status.nodes} nodes`);
		assert.ok(status.edges > 1000, `real graph has ${status.edges} edges`);

		// Every link in the real export resolves, so nothing should be dropped.
		const raw = JSON.parse(readFileSync(graphPath, "utf-8"));
		assert.equal(status.nodes, raw.nodes.length);
		assert.equal(status.edges, raw.links.length);
	});

	it("finds a known symbol in it", { skip: !existsSync(graphPath) }, () => {
		const reader = new GraphifyReader(root);
		const hits = reader.search("file tracker", { limit: 10 }).hits;
		assert.ok(hits.length > 0, "the real graph must be searchable");
		assert.ok(
			hits.some(
				(h) =>
					/tracker/i.test(h.node.label) || /tracker/i.test(h.node.sourceFile),
			),
			`expected a tracker node, got ${hits.map((h) => h.node.label).join(", ")}`,
		);
	});
});
