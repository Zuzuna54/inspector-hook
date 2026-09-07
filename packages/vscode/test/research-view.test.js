/**
 * Research view (M4) — the client over the research index.
 *
 * ## Why this file loads the real State
 *
 * The bug this suite exists to pin was invisible to a stubbed State. The first
 * version of research.js never called `State.subscribe`, and `State.update`
 * notifies subscribers and does nothing else — so results arrived from the
 * core, landed in state, and no pixel changed. Every search spun forever, under
 * a header comment promising that it would not.
 *
 * A stub whose `update` is a no-op (harness.js's default) cannot see that, and
 * a stub whose `update` re-renders would be testing the stub. So this loads
 * `scripts/state.js` itself — the shipped file, with its real listener
 * semantics — and asserts on what the DOM actually receives.
 *
 * The DOM here is a small recording stub rather than jsdom, consistent with the
 * rest of this suite: assertions are about which region got which HTML, which
 * does not need layout.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { installGlobals, readMedia } from "./harness.js";

/** An element that records what is written to it. */
function element(id) {
	return {
		id,
		innerHTML: "",
		className: "",
		value: "",
		dataset: {},
		listeners: {},
		addEventListener(type, fn) {
			(this.listeners[type] ||= []).push(fn);
		},
		click() {
			for (const fn of this.listeners.click || []) fn();
		},
	};
}

/**
 * Load the view against the real State and a recording DOM.
 *
 * `state.js` is evaluated with its own trailing `window.State = State`, which
 * is how the real webview publishes it; the harness's stub is then replaced by
 * the genuine object before the view loads.
 */
function loadResearch(stateOverrides = {}) {
	const sent = [];
	const els = new Map();
	for (const id of [
		"research-view",
		"rs-query",
		"rs-go",
		"rs-filters",
		"rs-stats",
		"rs-graph-status",
		"rs-results",
	]) {
		els.set(id, element(id));
	}

	installGlobals({
		API: {
			researchSearch: (p) => sent.push({ search: p }),
			researchGet: (p) => sent.push({ get: p }),
			researchStats: (p) => sent.push({ stats: p ?? null }),
			graphStatus: (p) => sent.push({ graphStatus: p ?? null }),
			researchEnableEmbeddings: () => sent.push({ enableEmbeddings: true }),
			researchEmbedPending: (limit) => sent.push({ embedPending: limit }),
			graphSearch: (p) => sent.push({ graphSearch: p }),
			graphNeighbors: (p) => sent.push({ graphNeighbors: p }),
			graphGet: (p) => sent.push({ graphGet: p }),
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
	globalThis.State.researchView = {
		query: "",
		source: "history",
		scope: "all",
		kinds: [],
		results: null,
		selected: null,
		stats: null,
		searching: false,
		error: null,
		graphStatus: null,
		graphResults: null,
		graphSelected: null,
		graphNeighbors: null,
		neighborsLoading: false,
		...stateOverrides,
	};

	// Load order matches the manifest: the mixin before the view that composes it.
	// biome-ignore lint/security/noGlobalEval: classic script, see harness.js
	eval(readMedia("scripts/views/research/graph-render.js"));
	// biome-ignore lint/security/noGlobalEval: classic script, see harness.js
	eval(readMedia("scripts/views/research.js"));
	const view = globalThis.window.ResearchView;
	view._unsubscribers = [];
	return { view, sent, els, State: globalThis.State };
}

/** A search result as the core returns it. */
const result = (over = {}) => ({
	hits: [
		{
			score: 4.2,
			item: {
				id: "read:acme/widget:/src/a.ts",
				kind: "file_read",
				title: "a.ts",
				text: "the indexed text",
				timestamp: "2026-09-04T10:00:00.000Z",
				projectName: "widget",
			},
		},
	],
	total: 1,
	searched: 599,
	terms: ["path"],
	scope: "all",
	...over,
});

describe("research: the subscription", () => {
	it("REGRESSION: results arriving actually re-render, they do not spin forever", () => {
		// The whole reason this file exists. Shipped once without the subscribe
		// call: the core answered, state changed, the DOM kept saying "Searching".
		const { view, els, State } = loadResearch();
		view.init();
		view.render();

		State.update("researchView", { ...State.researchView, searching: true });
		assert.match(
			els.get("rs-results").innerHTML,
			/Searching/,
			"spinner while in flight",
		);

		State.update("researchView", {
			...State.researchView,
			searching: false,
			results: result(),
		});

		const html = els.get("rs-results").innerHTML;
		assert.ok(!html.includes("Searching"), "the spinner must be gone");
		assert.match(html, /the indexed text|a\.ts/, "the hit must be on screen");
	});

	it("REGRESSION: a failed search renders the failure, not a spinner", () => {
		// Three permanent loading states have shipped in this project, every one
		// because a failure path changed state that nothing was listening to.
		const { view, els, State } = loadResearch();
		view.init();
		view.render();

		State.update("researchView", { ...State.researchView, searching: true });
		State.update("researchView", {
			...State.researchView,
			searching: false,
			error: "core is not running",
		});

		const html = els.get("rs-results").innerHTML;
		assert.ok(!html.includes("Searching"), "no spinner after a failure");
		assert.match(html, /core is not running/, "the backend's own words");
	});

	it("stats arriving fill the filters, which start empty", () => {
		const { view, els, State } = loadResearch();
		view.init();
		view.render();
		assert.ok(!els.get("rs-stats").innerHTML.includes("599"));

		State.update("researchView", {
			...State.researchView,
			stats: {
				items: 599,
				terms: 7441,
				byKind: { file_read: 107 },
				byProject: { a: 1, b: 2 },
			},
		});

		assert.match(els.get("rs-stats").innerHTML, /599 items/);
		assert.match(els.get("rs-stats").innerHTML, /2 projects/);
		assert.match(
			els.get("rs-filters").innerHTML,
			/107/,
			"kind counts come from stats",
		);
	});

	it("cleanup unsubscribes, so a hidden view stops rendering", () => {
		const { view, els, State } = loadResearch();
		view.init();
		view.render();
		view.cleanup();

		State.update("researchView", { ...State.researchView, results: result() });
		assert.ok(
			!els.get("rs-results").innerHTML.includes("a.ts"),
			"an unsubscribed view must not keep writing to the DOM",
		);
	});

	it("init asks for stats once, and does not re-ask when it has them", () => {
		const cold = loadResearch();
		cold.view.init();
		assert.equal(cold.sent.filter((s) => "stats" in s).length, 1);

		const warm = loadResearch({
			stats: { items: 1, terms: 1, byKind: {}, byProject: {} },
		});
		warm.view.init();
		assert.equal(warm.sent.filter((s) => "stats" in s).length, 0);
	});
});

describe("research: a count never leaves its scope implicit", () => {
	it("says which breadth produced the number", () => {
		const { view, els, State } = loadResearch();
		view.init();
		view.render();

		State.update("researchView", {
			...State.researchView,
			results: result({ scope: "all" }),
		});
		assert.match(els.get("rs-results").innerHTML, /all projects/);

		State.update("researchView", {
			...State.researchView,
			results: result({ scope: "project", searched: 124 }),
		});
		const html = els.get("rs-results").innerHTML;
		assert.match(html, /this project/);
		assert.match(html, /124 indexed/, "the denominator is scoped too");
	});

	it("an empty result still reports where it looked", () => {
		const { view, els, State } = loadResearch();
		view.init();
		view.render();
		State.update("researchView", {
			...State.researchView,
			query: "nothing",
			results: result({ hits: [], total: 0, scope: "project" }),
		});
		assert.match(els.get("rs-results").innerHTML, /No matches.*this project/s);
	});
});

describe("research: what the search sends", () => {
	it("omits projectKey when the scope is all projects", () => {
		// Omitting the key is what makes the search cross-project; sending an
		// empty string or a null would scope it to nothing.
		const { view, sent, els } = loadResearch({
			scope: "all",
			stats: {
				items: 1,
				terms: 1,
				byKind: {},
				byProject: {},
				defaultProjectKey: "acme/widget",
			},
		});
		view.render();
		els.get("rs-query").value = "path traversal";
		view.search();

		const params = sent.find((s) => s.search).search;
		assert.equal(
			"projectKey" in params,
			false,
			"no key at all, not an empty one",
		);
		assert.equal(params.query, "path traversal");
	});

	it("sends the default project key when scoped", () => {
		const { view, sent, els } = loadResearch({
			scope: "project",
			stats: {
				items: 1,
				terms: 1,
				byKind: {},
				byProject: {},
				defaultProjectKey: "acme/widget",
			},
		});
		view.render();
		els.get("rs-query").value = "path traversal";
		view.search();

		assert.equal(sent.find((s) => s.search).search.projectKey, "acme/widget");
	});

	it("does not scope to a project the core could not name", () => {
		// defaultProjectKey was undefined for the entire first day this shipped,
		// because it was derived from a name comparison that never matched.
		// Scoping to undefined must degrade to searching everything.
		const { view, sent, els } = loadResearch({
			scope: "project",
			stats: { items: 1, terms: 1, byKind: {}, byProject: {} },
		});
		view.render();
		els.get("rs-query").value = "x";
		view.search();
		assert.equal("projectKey" in sent.find((s) => s.search).search, false);
	});

	it("sends nothing for a blank query, and clears the spinner", () => {
		const { view, sent, els, State } = loadResearch();
		view.render();
		els.get("rs-query").value = "   ";
		view.search();
		assert.equal(
			sent.filter((s) => s.search).length,
			0,
			"no request for whitespace",
		);
		assert.equal(
			State.researchView.searching,
			false,
			"and no spinner left behind",
		);
	});

	it("passes kind filters through", () => {
		const { view, sent, els } = loadResearch({
			kinds: ["web_search", "conclusion"],
		});
		view.render();
		els.get("rs-query").value = "q";
		view.search();
		assert.deepEqual(sent.find((s) => s.search).search.kinds, [
			"web_search",
			"conclusion",
		]);
	});
});

describe("research: rendering", () => {
	it("escapes item text, which is arbitrary captured content", () => {
		const { view, els, State } = loadResearch();
		view.init();
		view.render();
		State.update("researchView", {
			...State.researchView,
			results: result({
				hits: [
					{
						score: 1,
						item: {
							id: "x",
							kind: "user_prompt",
							title: "<img onerror=1>",
							text: "t",
						},
					},
				],
			}),
		});
		assert.ok(
			!els.get("rs-results").innerHTML.includes("<img"),
			"title is escaped",
		);
	});

	it("shows the body only for the selected hit", () => {
		const { view, els, State } = loadResearch();
		view.init();
		view.render();
		State.update("researchView", { ...State.researchView, results: result() });
		assert.ok(!els.get("rs-results").innerHTML.includes("the indexed text"));

		State.update("researchView", {
			...State.researchView,
			selected: { id: "read:acme/widget:/src/a.ts" },
		});
		assert.match(els.get("rs-results").innerHTML, /the indexed text/);
	});

	it("renders without a container rather than throwing", () => {
		// The router can init a view before its panel exists.
		const { view } = loadResearch();
		globalThis.document.getElementById = () => null;
		assert.doesNotThrow(() => view.render());
		assert.doesNotThrow(() => view.renderResults());
	});
});

// ============================================================================
// The graphify half: a second corpus behind the same search box.
// ============================================================================

/** A graph search result as the core returns it. */
const graphResult = (over = {}) => ({
	hits: [
		{
			score: 11.2,
			degree: 15,
			matched: ["tracker"],
			node: {
				id: "packages_core_src_managers_file_tracker_ts",
				label: "file-tracker.ts",
				fileType: "code",
				sourceFile: "packages/core/src/managers/file-tracker.ts",
				sourceLocation: "L1",
				community: 4,
			},
		},
	],
	total: 203,
	terms: ["file", "tracker"],
	searched: 3933,
	...over,
});

const status = (over = {}) => ({
	available: true,
	path: "/repo/graphify-out/graph.json",
	nodes: 3933,
	edges: 4685,
	communities: 333,
	byFileType: { code: 1779, document: 2115, rationale: 39 },
	byRelation: { contains: 3306 },
	builtAtCommit: "a".repeat(40),
	builtAt: "2026-09-07T00:52:00.000Z",
	stale: false,
	headCommit: "a".repeat(40),
	...over,
});

describe("research: two corpora, one search box", () => {
	it("asks for graph status on init, so the tab can say whether a graph exists", () => {
		const { view, sent } = loadResearch();
		view.init();
		assert.equal(sent.filter((s) => "graphStatus" in s).length, 1);
	});

	it("routes the query to the graph when the graph source is selected", () => {
		const { view, sent, els } = loadResearch({ source: "graph" });
		view.render();
		els.get("rs-query").value = "file tracker";
		view.search();

		assert.equal(
			sent.filter((s) => s.search).length,
			0,
			"not the history index",
		);
		assert.equal(
			sent.find((s) => s.graphSearch).graphSearch.query,
			"file tracker",
		);
	});

	it("routes to history when history is selected", () => {
		const { view, sent, els } = loadResearch({ source: "history" });
		view.render();
		els.get("rs-query").value = "file tracker";
		view.search();
		assert.equal(sent.filter((s) => s.graphSearch).length, 0);
		assert.ok(sent.find((s) => s.search));
	});

	it("renders graph hits with their file, position and degree", () => {
		const { view, els, State } = loadResearch({ source: "graph" });
		view.init();
		view.render();
		State.update("researchView", {
			...State.researchView,
			graphResults: graphResult(),
		});

		const html = els.get("rs-results").innerHTML;
		assert.match(html, /file-tracker\.ts/);
		assert.match(html, /packages\/core\/src\/managers/);
		assert.match(html, /15/, "degree is shown");
		assert.match(html, /203 nodes match/);
		assert.match(html, /3933 in the graph/, "the count carries its universe");
	});

	it("switching source does not discard the other corpus's results", () => {
		// Two searches, two answers. Flipping a tab is not a reason to throw one
		// away and make the user run it again.
		const { view, els, State } = loadResearch({ source: "history" });
		view.init();
		view.render();
		State.update("researchView", {
			...State.researchView,
			results: result(),
			graphResults: graphResult(),
		});

		State.update("researchView", { ...State.researchView, source: "graph" });
		assert.match(els.get("rs-results").innerHTML, /file-tracker\.ts/);

		State.update("researchView", { ...State.researchView, source: "history" });
		assert.match(els.get("rs-results").innerHTML, /a\.ts|the indexed text/);
	});

	it("hides project scope and research kinds on the graph tab", () => {
		// They filter the history index and mean nothing to a code graph;
		// leaving them on screen would imply they apply.
		const { view, els, State } = loadResearch({
			source: "history",
			stats: { items: 5, terms: 9, byKind: { file_read: 3 }, byProject: {} },
		});
		view.init();
		view.render();
		assert.match(els.get("rs-filters").innerHTML, /All projects/);

		State.update("researchView", { ...State.researchView, source: "graph" });
		assert.equal(
			els.get("rs-filters").innerHTML,
			"",
			"scope and kinds are gone",
		);
		assert.equal(
			els.get("rs-stats").innerHTML,
			"",
			"so is the history corpus size",
		);
	});
});

describe("research: the graph's freshness is three-valued", () => {
	it("REGRESSION: unknown age is not drawn as current", () => {
		// A graph of unknown age returning symbols that no longer exist, labelled
		// "current", is precisely the confident-wrong-answer failure this project
		// treats as its priority bug class.
		const { view, els, State } = loadResearch({ source: "graph" });
		view.init();
		view.render();

		State.update("researchView", {
			...State.researchView,
			graphStatus: status({ stale: null }),
		});
		const unknown = els.get("rs-graph-status").innerHTML;
		assert.match(unknown, /age unknown/);
		assert.ok(!/current/.test(unknown), "must not claim current");

		State.update("researchView", {
			...State.researchView,
			graphStatus: status({ stale: false }),
		});
		assert.match(els.get("rs-graph-status").innerHTML, /current/);

		State.update("researchView", {
			...State.researchView,
			graphStatus: status({ stale: true, headCommit: "b".repeat(40) }),
		});
		assert.match(els.get("rs-graph-status").innerHTML, /out of date/);
	});

	it("shows size once a graph is loaded", () => {
		const { view, els, State } = loadResearch({ source: "graph" });
		view.init();
		view.render();
		State.update("researchView", {
			...State.researchView,
			graphStatus: status(),
		});
		const html = els.get("rs-graph-status").innerHTML;
		assert.match(html, /3933 nodes/);
		assert.match(html, /4685 edges/);
	});

	it("treats a missing graph as a normal state with a remedy", () => {
		// Never built is the common case, not an error, and the fix is one
		// command that needs no API key.
		const { view, els, State } = loadResearch({ source: "graph" });
		view.init();
		view.render();
		State.update("researchView", {
			...State.researchView,
			graphStatus: { available: false, nodes: 0, edges: 0, stale: null },
		});
		const html = els.get("rs-graph-status").innerHTML;
		assert.match(html, /No code graph/);
		assert.match(html, /graphify update/, "tells the user how to build one");
	});

	it("surfaces the reason when a graph exists but could not be read", () => {
		const { view, els, State } = loadResearch({ source: "graph" });
		view.init();
		view.render();
		State.update("researchView", {
			...State.researchView,
			graphStatus: {
				available: false,
				nodes: 0,
				edges: 0,
				stale: null,
				error: "cannot parse graph: bad json",
			},
		});
		assert.match(els.get("rs-graph-status").innerHTML, /cannot parse graph/);
	});
});

describe("research: neighbours", () => {
	const neighbors = {
		id: "packages_core_src_managers_file_tracker_ts",
		node: graphResult().hits[0].node,
		neighbors: [
			{
				node: { id: "core", label: "core.ts", sourceFile: "src/core.ts" },
				relation: "imports_from",
				direction: "in",
				weight: 1,
				depth: 1,
			},
			{
				node: {
					id: "ft",
					label: "FileTracker",
					sourceFile: "src/managers/file-tracker.ts",
				},
				relation: "contains",
				direction: "out",
				weight: 1,
				depth: 1,
			},
		],
	};

	it("groups by direction, which the graph file itself throws away", () => {
		// graphify writes `directed: false`, but "what calls this" and "what this
		// calls" are different questions.
		const { view, els, State } = loadResearch({ source: "graph" });
		view.init();
		view.render();
		State.update("researchView", {
			...State.researchView,
			graphResults: graphResult(),
			graphSelected: graphResult().hits[0].node,
			graphNeighbors: neighbors,
		});

		const html = els.get("rs-results").innerHTML;
		assert.match(html, /This node →/);
		assert.match(html, /→ This node/);
		assert.match(html, /imports_from/);
		assert.match(html, /FileTracker/);
	});

	it("shows a loading state while they arrive, then replaces it", () => {
		const { view, els, State } = loadResearch({ source: "graph" });
		view.init();
		view.render();
		State.update("researchView", {
			...State.researchView,
			graphResults: graphResult(),
			graphSelected: graphResult().hits[0].node,
			neighborsLoading: true,
		});
		assert.match(els.get("rs-results").innerHTML, /Loading connections/);

		State.update("researchView", {
			...State.researchView,
			neighborsLoading: false,
			graphNeighbors: neighbors,
		});
		const html = els.get("rs-results").innerHTML;
		assert.ok(!html.includes("Loading connections"), "the spinner must clear");
		assert.match(html, /core\.ts/);
	});

	it("says so when a node connects to nothing, rather than rendering blank", () => {
		const { view, els, State } = loadResearch({ source: "graph" });
		view.init();
		view.render();
		State.update("researchView", {
			...State.researchView,
			graphResults: graphResult(),
			graphSelected: graphResult().hits[0].node,
			graphNeighbors: { id: "x", neighbors: [] },
		});
		assert.match(els.get("rs-results").innerHTML, /Nothing connects/);
	});

	it("a failed neighbour lookup renders as a failure", () => {
		const { view, els, State } = loadResearch({ source: "graph" });
		view.init();
		view.render();
		State.update("researchView", {
			...State.researchView,
			graphResults: graphResult(),
			neighborsLoading: false,
			error: "core is not running",
		});
		const html = els.get("rs-results").innerHTML;
		assert.ok(!html.includes("Loading"), "no spinner left behind");
		assert.match(html, /core is not running/);
	});

	it("escapes node labels, which come from arbitrary source files", () => {
		const { view, els, State } = loadResearch({ source: "graph" });
		view.init();
		view.render();
		State.update("researchView", {
			...State.researchView,
			graphResults: graphResult({
				hits: [
					{
						score: 1,
						degree: 0,
						matched: [],
						node: {
							id: "x",
							label: "<img onerror=1>",
							fileType: "code",
							sourceFile: "<script>",
							sourceLocation: "",
						},
					},
				],
			}),
		});
		const html = els.get("rs-results").innerHTML;
		assert.ok(!html.includes("<img"), "label escaped");
		assert.ok(!html.includes("<script>"), "path escaped");
	});
});

describe("research: the state slice has one definition", () => {
	it("REGRESSION: reset() and the literal must not drift apart", () => {
		// state.js declares researchView twice -- once as the initial literal and
		// once inside reset(). Adding a key to one and not the other means a
		// reset silently drops it, and the view then reads undefined for a field
		// it was written to rely on. Nothing pinned these together before the
		// graph slices were added, which is exactly when it would have happened.
		const source = readMedia("scripts/state.js");
		const keysOf = (block) =>
			[...block.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort();

		const literal = source.match(/\n\tresearchView: \{([\s\S]*?)\n\t\},/);
		const reset = source.match(/this\.researchView = \{([\s\S]*?)\n\t\t\};/);
		assert.ok(literal && reset, "both definitions must be findable");

		assert.deepEqual(
			keysOf(reset[1]),
			keysOf(literal[1]),
			"reset() and the initial researchView literal define different keys",
		);
	});
});

// ============================================================================
// Semantic retrieval: the control surface, and the loop that fills the corpus.
// ============================================================================

const statsWith = (embeddings, items = 693) => ({
	items,
	terms: 7441,
	byKind: {},
	byProject: { a: 1 },
	embeddings,
});

describe("research: enabling semantic search", () => {
	it("offers it rather than performing it", () => {
		// Loading the model and embedding a real corpus is about half a minute
		// of CPU. Doing that because someone opened a tab would be rude.
		const { view, els, sent, State } = loadResearch();
		view.init();
		view.render();
		State.update("researchView", {
			...State.researchView,
			stats: statsWith({ available: false, embedded: 0 }),
		});

		assert.match(els.get("rs-stats").innerHTML, /lexical only/);
		assert.match(els.get("rs-stats").innerHTML, /enable semantic search/);
		assert.equal(sent.filter((s) => s.enableEmbeddings).length, 0, "not without being asked");
	});

	it("explains why it is unavailable when the core said", () => {
		// The sharp binding failure was invisible for exactly this reason.
		const { view, els, State } = loadResearch();
		view.init();
		view.render();
		State.update("researchView", {
			...State.researchView,
			stats: statsWith({ available: false, embedded: 0, error: "Something went wrong installing the \"sharp\" module" }),
		});
		assert.match(els.get("rs-stats").innerHTML, /sharp/);
	});

	it("REGRESSION: the inbound handler starts the loop on a FRESH corpus", () => {
		// The bug lived in inbound-research.js, so this drives that file rather
		// than setting `embedding` by hand -- a test that seeds the flag itself
		// bypasses the exact decision that was wrong.
		//
		// The two core methods both return a field called `embedded` meaning
		// different things: a corpus TOTAL from enableEmbeddings, a BATCH size
		// from embedPending. Deciding "keep going" from the total meant a corpus
		// with nothing embedded yet reported 0 and the loop never started, so
		// semantic search could only be enabled on a corpus already embedded.
		const handlers = {};
		installGlobals({
			API: { on: (types, fn) => types.forEach((t) => (handlers[t] = fn)) },
		});
		// biome-ignore lint/security/noGlobalEval: classic script, see harness.js
		eval(readMedia("scripts/state.js"));
		globalThis.State = globalThis.window.State;
		globalThis.window.API = globalThis.API;
		// biome-ignore lint/security/noGlobalEval: classic script, see harness.js
		eval(readMedia("scripts/api/inbound-research.js"));

		// enableEmbeddings on an empty corpus: available, 0 embedded, no batch.
		handlers["research-embeddings"]({ available: true, embedded: 0, batch: undefined });
		assert.equal(
			globalThis.State.researchView.embedding,
			true,
			"must keep going: 0 embedded is the reason to start, not to stop",
		);

		// A batch that embedded nothing is what ends it.
		handlers["research-embeddings"]({ available: true, embedded: 693, batch: 0 });
		assert.equal(globalThis.State.researchView.embedding, false, "the loop terminates");

		// And an unavailable model never starts it.
		handlers["research-embeddings"]({ available: false, embedded: 0, error: "no sharp" });
		assert.equal(globalThis.State.researchView.embedding, false);
		assert.equal(globalThis.State.researchView.stats, null, "no stats to fold into yet");
	});

	it("the view requests a batch once embedding begins", () => {
		// The two core methods both return a field called `embedded` meaning
		// different things -- a corpus total from enable, a batch size from
		// embedPending. Reading the total to decide whether to continue meant a
		// corpus with nothing embedded yet reported 0 and the loop never ran,
		// so semantic search could only ever be enabled on a corpus that was
		// already embedded.
		const { view, sent, State } = loadResearch();
		view.init();
		view.render();

		// Enabling on an empty corpus: available, nothing embedded, no batch yet.
		State.update("researchView", {
			...State.researchView,
			embedding: true,
			stats: statsWith({ available: true, embedded: 0 }),
		});

		assert.equal(
			sent.filter((s) => "embedPending" in s).length,
			1,
			"the first batch must be requested even with 0 embedded",
		);
	});

	it("keeps requesting batches while they produce work, and stops at zero", () => {
		const { view, sent, State } = loadResearch();
		view.init();
		view.render();

		State.update("researchView", {
			...State.researchView,
			embedding: true,
			stats: statsWith({ available: true, embedded: 0 }),
		});
		const afterFirst = sent.filter((s) => "embedPending" in s).length;

		// A batch came back with work: stats changed, still embedding.
		State.update("researchView", {
			...State.researchView,
			embedding: true,
			stats: statsWith({ available: true, embedded: 200 }),
		});
		assert.ok(
			sent.filter((s) => "embedPending" in s).length > afterFirst,
			"a productive batch asks for the next",
		);

		// A batch embedded nothing: the inbound handler clears `embedding`.
		const before = sent.filter((s) => "embedPending" in s).length;
		State.update("researchView", {
			...State.researchView,
			embedding: false,
			stats: statsWith({ available: true, embedded: 693 }),
		});
		assert.equal(
			sent.filter((s) => "embedPending" in s).length,
			before,
			"the loop must terminate",
		);
	});

	it("shows progress while embedding, not a bare 'on'", () => {
		const { view, els, State } = loadResearch();
		view.init();
		view.render();
		State.update("researchView", {
			...State.researchView,
			embedding: true,
			stats: statsWith({ available: true, embedded: 200 }),
		});
		assert.match(els.get("rs-stats").innerHTML, /embedding 200\/693/);
	});

	it("distinguishes partial coverage from full", () => {
		// "on" at 3 of 693 embedded is true and useless.
		const { view, els, State } = loadResearch();
		view.init();
		view.render();

		State.update("researchView", {
			...State.researchView,
			stats: statsWith({ available: true, embedded: 3 }),
		});
		assert.match(els.get("rs-stats").innerHTML, /semantic 3\/693/);

		State.update("researchView", {
			...State.researchView,
			stats: statsWith({ available: true, embedded: 693 }),
		});
		const full = els.get("rs-stats").innerHTML;
		assert.match(full, /semantic/);
		assert.ok(!/693\/693/.test(full), "full coverage does not need a fraction");
	});
});

describe("research: a result states which signals ranked it", () => {
	it("labels hybrid and lexical differently", () => {
		// A hybrid search that silently degraded to lexical is otherwise
		// indistinguishable from one that merely ranked differently.
		const { view, els, State } = loadResearch();
		view.init();
		view.render();

		State.update("researchView", {
			...State.researchView,
			results: result({ retrieval: "hybrid" }),
		});
		assert.match(els.get("rs-results").innerHTML, /hybrid/);

		State.update("researchView", {
			...State.researchView,
			results: result({ retrieval: "lexical" }),
		});
		assert.match(els.get("rs-results").innerHTML, /lexical/);
	});

	it("says nothing when the core did not report a mode", () => {
		// An older core reports no `retrieval`. Guessing "lexical" there would
		// be a claim about a core that never made it.
		const { view, els, State } = loadResearch();
		view.init();
		view.render();
		State.update("researchView", { ...State.researchView, results: result() });
		const html = els.get("rs-results").innerHTML;
		assert.ok(!/hybrid|lexical/.test(html));
	});
});
