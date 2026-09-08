/**
 * Views must build themselves from `init()` alone.
 *
 * ## The bug this exists to catch
 *
 * `Router.navigate` calls `view.init(params)` and **nothing else**. It never
 * calls `render()`. A view that only subscribes in `init()` therefore leaves
 * the panel showing the static fallback baked into webview-html.ts — "Loading
 * agents…", "Loading research history…" — forever, because every targeted
 * render afterwards looks up an element that render() was supposed to create
 * and returns early.
 *
 * Both the Agents view and the Search view shipped exactly like that.
 *
 * ## Why the existing tests missed it
 *
 * They called `view.init(); view.render();` — doing the thing the router does
 * not do — and they handed the view a DOM that already contained the inner
 * elements render() is responsible for creating. The test did the view's job
 * twice over, so a view that did none of it still passed.
 *
 * So this file does two things differently, and both matter:
 *   1. calls ONLY `init()`, exactly like the router
 *   2. gives it a DOM containing ONLY the outer panel, so an element exists
 *      after render() has written it and not before
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { installGlobals, readMedia } from "./harness.js";

/**
 * A DOM where inner elements exist only once render() has written them.
 *
 * This is the property the old fixtures lacked: they pre-created `ag-list` and
 * `rs-results`, so a view that never rendered still found somewhere to write.
 */
function bootstrapDom(containerId, fallbackHtml) {
	const container = {
		id: containerId,
		innerHTML: fallbackHtml,
		className: "",
		dataset: {},
		addEventListener() {},
	};
	const made = new Map([[containerId, container]]);

	return {
		container,
		document: {
			getElementById(id) {
				if (made.has(id)) return made.get(id);
				// Only ids the container's current markup declares.
				if (!container.innerHTML.includes(`id="${id}"`)) return null;
				const el = {
					id,
					innerHTML: "",
					className: "",
					dataset: {},
					listeners: {},
					classList: { toggle() {} },
					addEventListener(t, fn) {
						(this.listeners[t] ||= []).push(fn);
					},
				};
				made.set(id, el);
				return el;
			},
			querySelector: () => null,
			querySelectorAll: () => [],
			createElement: () => ({
				innerHTML: "",
				dataset: {},
				addEventListener() {},
			}),
			visibilityState: "visible",
		},
	};
}

/** Load a view exactly as the manifest does, with the real State. */
function loadView({ scripts, slice, sliceName, api, containerId, fallback }) {
	const dom = bootstrapDom(containerId, fallback);
	installGlobals({ API: api, document: dom.document });

	// biome-ignore lint/security/noGlobalEval: classic script, see harness.js
	eval(readMedia("scripts/state.js"));
	globalThis.State = globalThis.window.State;
	globalThis.State[sliceName] = slice;

	for (const path of scripts) {
		// biome-ignore lint/security/noGlobalEval: classic script, see harness.js
		eval(readMedia(path));
	}
	return dom;
}

describe("view bootstrap: the router calls init() and nothing else", () => {
	it("REGRESSION: the Agents view builds its shell from init() alone", () => {
		const dom = loadView({
			scripts: ["scripts/views/agents.js"],
			sliceName: "agentsView",
			slice: {
				agents: [],
				stats: null,
				selected: null,
				filter: "all",
				loading: false,
				error: null,
			},
			api: {
				agentsTree() {},
				agentsGet() {},
				agentsStats() {},
			},
			containerId: "agents-view",
			fallback: `<div class="ag-empty">Loading agents…</div>`,
		});

		globalThis.window.AgentsView._unsubscribers = [];
		globalThis.window.AgentsView.init();

		assert.ok(
			!dom.container.innerHTML.includes("Loading agents…"),
			"the static fallback must be replaced",
		);
		assert.match(
			dom.container.innerHTML,
			/id="ag-list"/,
			"the list host exists",
		);
		assert.match(
			dom.container.innerHTML,
			/id="ag-stats"/,
			"the stats host exists",
		);
	});

	it("REGRESSION: the Search view builds its shell from init() alone", () => {
		const dom = loadView({
			scripts: [
				"scripts/views/research/graph-render.js",
				"scripts/views/research.js",
			],
			sliceName: "researchView",
			slice: {
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
				embedding: false,
			},
			api: {
				researchStats() {},
				researchSearch() {},
				researchGet() {},
				researchEnableEmbeddings() {},
				researchEmbedPending() {},
				graphStatus() {},
				graphSearch() {},
				graphNeighbors() {},
				graphGet() {},
			},
			containerId: "research-view",
			fallback: `<div class="rs-empty">Loading research history…</div>`,
		});

		globalThis.window.ResearchView._unsubscribers = [];
		globalThis.window.ResearchView.init();

		assert.ok(
			!dom.container.innerHTML.includes("Loading research history…"),
			"the static fallback must be replaced",
		);
		assert.match(
			dom.container.innerHTML,
			/id="rs-query"/,
			"the search box exists",
		);
		assert.match(
			dom.container.innerHTML,
			/id="rs-results"/,
			"the results host exists",
		);
	});
});
