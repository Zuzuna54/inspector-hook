/**
 * Graph analysis for build effectiveness (M7).
 *
 * Fixtures are hand-built so each signal can be checked against a known
 * answer, and the suite ends by running against this repo's REAL graph — 4095
 * nodes — because a fixture cannot show that the percentile threshold behaves
 * on a real degree distribution.
 *
 * The numbers the real-graph test asserts were measured independently by hand
 * before this module existed: 9 orphans, 12% coupling, 0 rot.
 */

import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { analyseGraph, GraphifyGraph } from "../dist/index.js";
import { cleanup, makeTempStore } from "./helpers.js";

const dirs = [];
after(async () => {
	await Promise.all(dirs.map(cleanup));
});

const node = (id, over = {}) => ({
	id,
	label: over.label ?? id,
	file_type: "code",
	source_file: over.source_file ?? `src/${id}.ts`,
	source_location: "L1",
	community: over.community ?? 1,
	...over,
});

const link = (source, target) => ({
	source,
	target,
	relation: "calls",
	confidence: "EXTRACTED",
	weight: 1,
	source_file: "src/a.ts",
	source_location: "L1",
});

const graph = (nodes, links) => new GraphifyGraph({ nodes, links });

describe("graph analysis: orphans", () => {
	it("finds nodes with no edges at all", () => {
		const g = graph([node("a"), node("b"), node("lonely")], [link("a", "b")]);
		const a = analyseGraph(g);
		assert.equal(a.orphanCount, 1);
		assert.equal(a.orphans[0].id, "lonely");
	});

	it("a self-loop is not connectivity, but it is not degree 0 either", () => {
		// A node that only references itself is reachable from nothing else. It
		// counts as degree 1, so it is deliberately NOT reported as an orphan --
		// calling it one would be a claim the graph does not support.
		const g = graph([node("selfish")], [link("selfish", "selfish")]);
		assert.equal(analyseGraph(g).orphanCount, 0);
	});

	it("reports the total even when the list is capped", () => {
		// A caller must be able to tell "3 orphans" from "3 shown of 40".
		const nodes = Array.from({ length: 40 }, (_, i) => node(`o${i}`));
		const a = analyseGraph(graph(nodes, []), { topN: 3 });
		assert.equal(a.orphans.length, 3);
		assert.equal(a.orphanCount, 40);
	});
});

describe("graph analysis: god nodes", () => {
	it("finds the hub and reports how many communities it touches", () => {
		// Breadth, not just volume: a node with 20 edges inside one module is
		// ordinary, and one with 20 edges across 8 modules is a coupling
		// problem. Degree alone cannot tell them apart.
		const nodes = [node("hub", { community: 0 })];
		const links = [];
		for (let i = 0; i < 12; i++) {
			nodes.push(node(`leaf${i}`, { community: i }));
			links.push(link("hub", `leaf${i}`));
		}
		const a = analyseGraph(graph(nodes, links));
		assert.equal(a.godNodes[0].id, "hub");
		assert.equal(a.godNodes[0].degree, 12);
		assert.equal(a.godNodes[0].communitiesTouched, 12);
	});

	it("REGRESSION: a small graph does not nominate its most ordinary node", () => {
		// A pure percentile on four nodes makes the busiest of them a "god
		// node" at 2 edges, which is meaningless. GOD_NODE_FLOOR stops that.
		const g = graph(
			[node("a"), node("b"), node("c"), node("d")],
			[link("a", "b"), link("a", "c")],
		);
		assert.deepEqual(analyseGraph(g).godNodes, []);
	});

	it("orders by degree, and breaks ties stably", () => {
		const nodes = [node("x"), node("y"), node("z")];
		const links = [];
		for (let i = 0; i < 10; i++) {
			nodes.push(node(`n${i}`));
			links.push(link("x", `n${i}`));
			if (i < 9) links.push(link("y", `n${i}`));
		}
		const a = analyseGraph(graph(nodes, links));
		assert.equal(a.godNodes[0].id, "x");
		assert.ok(a.godNodes[0].degree > a.godNodes[1].degree);
	});
});

describe("graph analysis: coupling", () => {
	it("measures edges crossing community boundaries", () => {
		const g = graph(
			[
				node("a1", { community: 1 }),
				node("a2", { community: 1 }),
				node("b1", { community: 2 }),
			],
			[link("a1", "a2"), link("a1", "b1")],
		);
		const c = analyseGraph(g).coupling;
		assert.equal(c.internalEdges, 1);
		assert.equal(c.crossingEdges, 1);
		assert.equal(c.ratio, 0.5);
		assert.equal(c.communities, 2);
	});

	it("REGRESSION: an unclassified node moves the ratio in neither direction", () => {
		// Counting an edge that touches a community-less node as internal OR as
		// crossing would move a tracked metric on no evidence.
		const g = graph(
			[
				node("a", { community: 1 }),
				node("b", { community: 1 }),
				node("loose", { community: null }),
			],
			[link("a", "b"), link("a", "loose")],
		);
		const c = analyseGraph(g).coupling;
		assert.equal(c.internalEdges, 1);
		assert.equal(c.crossingEdges, 0);
		assert.equal(c.ratio, 0);
	});

	it("reports zero rather than dividing by zero", () => {
		assert.equal(analyseGraph(graph([], [])).coupling.ratio, 0);
	});
});

describe("graph analysis: rot", () => {
	it("counts nodes whose source file is gone", async () => {
		const root = await makeTempStore();
		dirs.push(root);
		await mkdir(join(root, "src"), { recursive: true });
		await writeFile(join(root, "src", "here.ts"), "export {};", "utf-8");

		const g = graph(
			[
				node("here", { source_file: "src/here.ts" }),
				node("gone", { source_file: "src/gone.ts" }),
			],
			[link("here", "gone")],
		);
		const rot = analyseGraph(g, { root }).rot;
		assert.equal(rot.checked, true);
		assert.equal(rot.nodes, 1);
		assert.deepEqual(rot.files, ["src/gone.ts"]);
		assert.equal(rot.ratio, 0.5);
	});

	it("REGRESSION: without a root, rot is UNCHECKED rather than zero", () => {
		// source_file is repository-relative. Checking it against the process
		// cwd would test the wrong paths and report either a healthy graph as
		// entirely rotten or a rotten one as clean. `checked: false` is the
		// honest answer, and it is not the same as 0.
		const rot = analyseGraph(
			graph([node("gone", { source_file: "src/gone.ts" })], []),
			{},
		).rot;
		assert.equal(rot.checked, false);
		assert.equal(rot.nodes, 0);
		assert.deepEqual(rot.files, []);
	});

	it("a relative root is refused, not resolved against the cwd", () => {
		const rot = analyseGraph(graph([node("x")], []), {
			root: "relative/path",
		}).rot;
		assert.equal(rot.checked, false);
	});
});

describe("graph analysis: junk and edges", () => {
	it("never throws on an empty or malformed graph", () => {
		for (const raw of [{}, null, { nodes: null, links: "no" }]) {
			assert.doesNotThrow(() => analyseGraph(new GraphifyGraph(raw)));
		}
		const a = analyseGraph(new GraphifyGraph({}));
		assert.equal(a.nodes, 0);
		assert.equal(a.orphanCount, 0);
		assert.deepEqual(a.godNodes, []);
	});
});

describe("graph analysis: against this repository's real graph", () => {
	// A fixture cannot show that the percentile threshold behaves on a real
	// degree distribution, or that 4095 nodes are analysed in reasonable time.
	const root = "/Users/giorgobg/Desktop/inspector_hook/inspector-hook";
	const graphPath = join(root, "graphify-out", "graph.json");
	const skip = !existsSync(graphPath);

	it("reproduces the hand-measured numbers", { skip }, async () => {
		const { readFileSync } = await import("node:fs");
		const g = new GraphifyGraph(JSON.parse(readFileSync(graphPath, "utf8")));
		const a = analyseGraph(g, { root });

		assert.ok(a.nodes > 1000, `real graph has ${a.nodes} nodes`);
		// Measured by hand before this module existed.
		assert.equal(a.orphanCount, 9, "9 orphans were counted independently");
		assert.equal(Math.round(a.coupling.ratio * 100), 12, "12% coupling");
		assert.equal(a.rot.checked, true);

		// The top god node is the barrel that madge also implicates in the one
		// real circular dependency. Two unrelated signals, one problem.
		assert.match(a.godNodes[0].sourceFile, /index\.ts$/);
		assert.ok(a.godNodes[0].degree > 100, `top degree ${a.godNodes[0].degree}`);
		assert.ok(a.godNodes[0].communitiesTouched > 5, "it spans many modules");
	});

	it("finds the dead file knip cannot see", { skip }, async () => {
		// config/claude-hooks/lib/http_logger.py is Python. knip traces
		// ES-module imports and is structurally blind to it; the graph is not.
		const { readFileSync } = await import("node:fs");
		const g = new GraphifyGraph(JSON.parse(readFileSync(graphPath, "utf8")));
		const a = analyseGraph(g, { root, topN: 20 });
		assert.ok(
			a.orphans.some((o) => o.sourceFile.endsWith(".py")),
			"the graph reaches languages knip does not",
		);
	});
});
