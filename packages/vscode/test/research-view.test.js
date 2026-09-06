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
	for (const id of ["research-view", "rs-query", "rs-go", "rs-filters", "rs-stats", "rs-results"]) {
		els.set(id, element(id));
	}

	installGlobals({
		API: {
			researchSearch: (p) => sent.push({ search: p }),
			researchGet: (p) => sent.push({ get: p }),
			researchStats: (p) => sent.push({ stats: p ?? null }),
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
		scope: "all",
		kinds: [],
		results: null,
		selected: null,
		stats: null,
		searching: false,
		error: null,
		...stateOverrides,
	};

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
		assert.match(els.get("rs-results").innerHTML, /Searching/, "spinner while in flight");

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
			stats: { items: 599, terms: 7441, byKind: { file_read: 107 }, byProject: { a: 1, b: 2 } },
		});

		assert.match(els.get("rs-stats").innerHTML, /599 items/);
		assert.match(els.get("rs-stats").innerHTML, /2 projects/);
		assert.match(els.get("rs-filters").innerHTML, /107/, "kind counts come from stats");
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

		const warm = loadResearch({ stats: { items: 1, terms: 1, byKind: {}, byProject: {} } });
		warm.view.init();
		assert.equal(warm.sent.filter((s) => "stats" in s).length, 0);
	});
});

describe("research: a count never leaves its scope implicit", () => {
	it("says which breadth produced the number", () => {
		const { view, els, State } = loadResearch();
		view.init();
		view.render();

		State.update("researchView", { ...State.researchView, results: result({ scope: "all" }) });
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
			stats: { items: 1, terms: 1, byKind: {}, byProject: {}, defaultProjectKey: "acme/widget" },
		});
		view.render();
		els.get("rs-query").value = "path traversal";
		view.search();

		const params = sent.find((s) => s.search).search;
		assert.equal("projectKey" in params, false, "no key at all, not an empty one");
		assert.equal(params.query, "path traversal");
	});

	it("sends the default project key when scoped", () => {
		const { view, sent, els } = loadResearch({
			scope: "project",
			stats: { items: 1, terms: 1, byKind: {}, byProject: {}, defaultProjectKey: "acme/widget" },
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
		assert.equal(sent.filter((s) => s.search).length, 0, "no request for whitespace");
		assert.equal(State.researchView.searching, false, "and no spinner left behind");
	});

	it("passes kind filters through", () => {
		const { view, sent, els } = loadResearch({ kinds: ["web_search", "conclusion"] });
		view.render();
		els.get("rs-query").value = "q";
		view.search();
		assert.deepEqual(sent.find((s) => s.search).search.kinds, ["web_search", "conclusion"]);
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
				hits: [{ score: 1, item: { id: "x", kind: "user_prompt", title: "<img onerror=1>", text: "t" } }],
			}),
		});
		assert.ok(!els.get("rs-results").innerHTML.includes("<img"), "title is escaped");
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
