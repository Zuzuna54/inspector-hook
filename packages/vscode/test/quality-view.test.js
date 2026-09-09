/**
 * Quality view (M7).
 *
 * Loads the REAL scripts/state.js, and calls ONLY `init()` — the router never
 * calls `render()`, and two views shipped stuck on their static fallback
 * because of it.
 *
 * The property most of these tests defend: **a count is never shown without
 * what measured it.** Raw knip flags 66 files here of which 64 are false
 * positives, and `sonar` is not installed at all — so "0 secrets" is the
 * absence of a tool, not a fact about the project.
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

/** A DOM where an inner element exists only once render() has written it. */
function loadQuality(stateOverrides = {}) {
	const sent = [];
	const container = element("quality-view");
	container.innerHTML = `<div class="ql-empty">Loading projects…</div>`;
	const made = new Map([["quality-view", container]]);

	installGlobals({
		API: {
			qualityProjects: () => sent.push({ projects: true }),
			qualityScan: (root) => sent.push({ scan: root }),
			qualityReport: (root) => sent.push({ report: root }),
			qualityTrend: (root) => sent.push({ trend: root }),
		},
		document: {
			getElementById(id) {
				if (made.has(id)) return made.get(id);
				if (!container.innerHTML.includes(`id="${id}"`)) return null;
				const el = element(id);
				made.set(id, el);
				return el;
			},
			querySelector: () => null,
			querySelectorAll: () => [],
			createElement: () => element("created"),
			visibilityState: "visible",
		},
	});

	// biome-ignore lint/security/noGlobalEval: classic script, see harness.js
	eval(readMedia("scripts/state.js"));
	globalThis.State = globalThis.window.State;
	globalThis.State.qualityView = {
		projects: [],
		discovered: 0,
		existing: 0,
		scannedCount: 0,
		selected: null,
		report: null,
		trend: null,
		loading: false,
		scanning: false,
		error: null,
		...stateOverrides,
	};

	// biome-ignore lint/security/noGlobalEval: classic script, see harness.js
	eval(readMedia("scripts/views/quality.js"));
	const view = globalThis.window.QualityView;
	view._unsubscribers = [];
	return { view, sent, container, made, State: globalThis.State };
}

const project = (over = {}) => ({
	root: "/Users/me/Desktop/app",
	name: "app",
	exists: true,
	hasGraph: false,
	tools: { knip: true, madge: true, graphify: true, sonarSecrets: true },
	rootSource: "transcript",
	...over,
});

const report = (over = {}) => ({
	projectRoot: "/Users/me/Desktop/app",
	projectName: "app",
	scannedAt: "2026-09-09T10:00:00.000Z",
	durationMs: 12400,
	tools: [
		{ tool: "knip", status: "ok", durationMs: 7186 },
		{ tool: "madge", status: "ok", durationMs: 5121 },
		{
			tool: "sonar-secrets",
			status: "unavailable",
			durationMs: 5,
			error: "the sonar CLI is not installed",
		},
		{ tool: "graphify", status: "ok", durationMs: 121 },
	],
	findings: [
		{
			file: "scripts/dead.js",
			agreed: ["graph-orphan", "knip"],
			disagreed: [],
			confidence: "high",
		},
		{
			file: "src/barrel.ts",
			agreed: ["knip"],
			disagreed: [
				{ signal: "graph-orphan", because: "the graph shows 6 edges" },
			],
			confidence: "low",
		},
		{
			file: "media/scripts/api.js",
			agreed: ["knip"],
			disagreed: [],
			confidence: "suppressed",
			suppressedBy:
				"the webview manifest in packages/vscode/src/webview-html.ts",
		},
	],
	circular: [{ cycle: ["a.ts", "b.ts", "a.ts"] }],
	secrets: [],
	graph: {
		nodes: 4095,
		edges: 4922,
		orphanCount: 9,
		godNodes: [
			{
				label: "index.ts",
				sourceFile: "src/index.ts",
				degree: 149,
				communitiesTouched: 18,
			},
		],
		coupling: { communities: 339, ratio: 0.12, crossingEdges: 603 },
		rot: { nodes: 0, ratio: 0, checked: true },
		stale: true,
	},
	summary: {
		high: 1,
		medium: 0,
		low: 1,
		suppressed: 1,
		circular: 1,
		secrets: 0,
		measured: ["knip", "madge", "graphify"],
		unmeasured: ["sonar-secrets"],
	},
	...over,
});

describe("quality view: it builds itself from init() alone", () => {
	it("REGRESSION: the router calls init() and never render()", () => {
		const { view, container } = loadQuality();
		view.init();
		assert.ok(!container.innerHTML.includes("Loading projects…"));
		assert.match(container.innerHTML, /id="ql-projects"/);
		assert.match(container.innerHTML, /id="ql-report"/);
	});

	it("asks for projects on init, once", () => {
		const { view, sent } = loadQuality();
		view.init();
		assert.equal(sent.filter((s) => s.projects).length, 1);
	});

	it("does not re-ask when projects are already loaded", () => {
		const { view, sent } = loadQuality({ projects: [project()] });
		view.init();
		assert.equal(sent.filter((s) => s.projects).length, 0);
	});

	it("cleanup unsubscribes", () => {
		const { view, made, State } = loadQuality();
		view.init();
		view.cleanup();
		State.update("qualityView", {
			...State.qualityView,
			loading: false,
			projects: [project()],
		});
		assert.ok(!made.get("ql-projects")?.innerHTML.includes("app"));
	});
});

describe("quality view: a count is never shown without what measured it", () => {
	it("REGRESSION: a scanned project with nothing measured is not 'clean'", () => {
		// The failure this whole milestone exists to avoid. high:0 with an empty
		// `measured` means no tool ran, which is not a clean project.
		const { view, made, State } = loadQuality();
		view.init();
		State.update("qualityView", {
			...State.qualityView,
			loading: false,
			projects: [
				project({
					lastScannedAt: "2026-09-09T10:00:00.000Z",
					high: 0,
					measured: [],
				}),
			],
		});
		const html = made.get("ql-projects").innerHTML;
		assert.match(html, /nothing measured/);
		assert.ok(!/>clean</.test(html), "must not claim clean");
	});

	it("a scanned project WITH tools shows clean and names them", () => {
		const { view, made, State } = loadQuality();
		view.init();
		State.update("qualityView", {
			...State.qualityView,
			loading: false,
			projects: [
				project({
					lastScannedAt: "2026-09-09T10:00:00.000Z",
					high: 0,
					measured: ["knip", "graphify"],
				}),
			],
		});
		const html = made.get("ql-projects").innerHTML;
		assert.match(html, /clean/);
		assert.match(html, /knip, graphify/);
	});

	it("an unscanned project says so, distinctly from clean", () => {
		const { view, made, State } = loadQuality();
		view.init();
		State.update("qualityView", {
			...State.qualityView,
			loading: false,
			projects: [project()],
		});
		assert.match(made.get("ql-projects").innerHTML, /never scanned/);
	});

	it("the report warns which tools did not run", () => {
		const { view, made, State } = loadQuality({
			selected: "/Users/me/Desktop/app",
		});
		view.init();
		State.update("qualityView", { ...State.qualityView, report: report() });
		const html = made.get("ql-report").innerHTML;
		assert.match(html, /Not measured: sonar-secrets/);
		assert.match(html, /counts below exclude/);
	});

	it("lists every tool with its status, including the ones that did not run", () => {
		const { view, made, State } = loadQuality({
			selected: "/Users/me/Desktop/app",
		});
		view.init();
		State.update("qualityView", { ...State.qualityView, report: report() });
		const html = made.get("ql-report").innerHTML;
		assert.match(html, /knip/);
		assert.match(html, /unavailable/);
		assert.match(html, /sonar CLI is not installed/);
	});
});

describe("quality view: findings and suppression", () => {
	it("shows actionable findings with their agreeing signals", () => {
		const { view, made, State } = loadQuality({
			selected: "/Users/me/Desktop/app",
		});
		view.init();
		State.update("qualityView", { ...State.qualityView, report: report() });
		const html = made.get("ql-report").innerHTML;
		assert.match(html, /scripts\/dead\.js/);
		assert.match(html, /graph-orphan \+ knip/);
	});

	it("shows a disagreement rather than hiding the finding", () => {
		// src/barrel.ts is genuinely dead and the graph says 6 edges. Hiding it
		// would lose a true finding; showing it silently would mislead.
		const { view, made, State } = loadQuality({
			selected: "/Users/me/Desktop/app",
		});
		view.init();
		State.update("qualityView", { ...State.qualityView, report: report() });
		const html = made.get("ql-report").innerHTML;
		assert.match(html, /src\/barrel\.ts/);
		assert.match(html, /the graph shows 6 edges/);
	});

	it("REGRESSION: suppressions are counted and explained, not silently dropped", () => {
		// 64 of 66 findings on this repo are suppressed. A reader has to see
		// that a filter is doing that much work.
		const { view, made, State } = loadQuality({
			selected: "/Users/me/Desktop/app",
		});
		view.init();
		State.update("qualityView", { ...State.qualityView, report: report() });
		const html = made.get("ql-report").innerHTML;
		assert.match(html, /1 suppressed by ground truth/);
		assert.match(html, /webview manifest/);
		// And the suppressed file is NOT in the actionable list.
		const dead = html.slice(html.indexOf("Dead code"));
		assert.ok(!dead.includes("ql-conf-suppressed"));
	});
});

describe("quality view: graph and cycles", () => {
	it("shows graph health with three-valued freshness", () => {
		const { view, made, State } = loadQuality({
			selected: "/Users/me/Desktop/app",
		});
		view.init();
		State.update("qualityView", { ...State.qualityView, report: report() });
		const html = made.get("ql-report").innerHTML;
		assert.match(html, /4095 nodes/);
		assert.match(html, /9 orphans/);
		assert.match(html, /12% coupling/);
		assert.match(html, /out of date/, "a stale graph says so");
		assert.match(html, /149 edges across 18 modules/);
	});

	it("says age unknown rather than implying current", () => {
		const { view, made, State } = loadQuality({
			selected: "/Users/me/Desktop/app",
		});
		view.init();
		State.update("qualityView", {
			...State.qualityView,
			report: report({ graph: { ...report().graph, stale: null } }),
		});
		assert.match(made.get("ql-report").innerHTML, /age unknown/);
	});

	it("tells you how to build a missing graph", () => {
		const { view, made, State } = loadQuality({
			selected: "/Users/me/Desktop/app",
		});
		view.init();
		State.update("qualityView", {
			...State.qualityView,
			report: report({ graph: undefined }),
		});
		assert.match(made.get("ql-report").innerHTML, /graphify update/);
	});

	it("lists circular dependencies", () => {
		const { view, made, State } = loadQuality({
			selected: "/Users/me/Desktop/app",
		});
		view.init();
		State.update("qualityView", { ...State.qualityView, report: report() });
		assert.match(made.get("ql-report").innerHTML, /a\.ts → b\.ts → a\.ts/);
	});
});

describe("quality view: scanning is explicit and slow", () => {
	it("does not scan on selection — only reads the stored report", () => {
		// knip took 7s and madge 5s. Scanning on click would look broken.
		const { view, sent, State } = loadQuality({ projects: [project()] });
		view.init();
		State.update("qualityView", {
			...State.qualityView,
			selected: project().root,
		});
		assert.equal(sent.filter((s) => s.scan).length, 0, "no scan");
	});

	it("shows a scanning state that explains the wait", () => {
		const { view, made, State } = loadQuality({
			selected: "/Users/me/Desktop/app",
		});
		view.init();
		State.update("qualityView", { ...State.qualityView, scanning: true });
		const html = made.get("ql-report").innerHTML;
		assert.match(html, /tens of seconds/);
		assert.match(html, /disabled/, "the button cannot be double-clicked");
	});

	it("a failed scan renders the failure, not a spinner", () => {
		const { view, made, State } = loadQuality({
			selected: "/Users/me/Desktop/app",
		});
		view.init();
		State.update("qualityView", {
			...State.qualityView,
			scanning: false,
			report: {
				projectRoot: "/Users/me/Desktop/app",
				error: "core is not running",
			},
		});
		const html = made.get("ql-report").innerHTML;
		assert.ok(!html.includes("tens of seconds"));
		assert.match(html, /core is not running/);
	});

	it("an unselected project explains that nothing runs unasked", () => {
		const { view, made, State } = loadQuality();
		view.init();
		State.update("qualityView", {
			...State.qualityView,
			loading: false,
			projects: [project()],
		});
		assert.match(made.get("ql-report").innerHTML, /nothing runs until you ask/);
	});
});

describe("quality view: projects that moved away", () => {
	it("shows them, separated and marked", () => {
		// 14 of 31 real projects are gone. Hiding them would hide that work
		// happened somewhere that no longer exists.
		const { view, made, State } = loadQuality();
		view.init();
		State.update("qualityView", {
			...State.qualityView,
			loading: false,
			projects: [
				project(),
				project({ root: "/gone", name: "gone", exists: false }),
			],
		});
		const html = made.get("ql-projects").innerHTML;
		assert.match(html, /No longer on disk/);
		assert.match(html, /1 moved away/);
	});

	it("escapes project names and file paths", () => {
		const { view, made, State } = loadQuality({ selected: "/x" });
		view.init();
		State.update("qualityView", {
			...State.qualityView,
			loading: false,
			projects: [project({ name: "<img onerror=1>" })],
			report: report({
				findings: [
					{
						file: "<script>x</script>",
						agreed: ["knip"],
						disagreed: [],
						confidence: "high",
					},
				],
			}),
		});
		assert.ok(!made.get("ql-projects").innerHTML.includes("<img"));
		assert.ok(!made.get("ql-report").innerHTML.includes("<script>x"));
	});

	it("renders without a container rather than throwing", () => {
		const { view } = loadQuality();
		globalThis.document.getElementById = () => null;
		assert.doesNotThrow(() => view.render());
		assert.doesNotThrow(() => view.renderProjects());
		assert.doesNotThrow(() => view.renderReport());
	});
});

describe("quality view: the state slice has one definition", () => {
	it("REGRESSION: reset() and the literal must not drift", () => {
		const source = readMedia("scripts/state.js");
		const keysOf = (b) =>
			[...b.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort();
		const literal = source.match(/\n\tqualityView: \{([\s\S]*?)\n\t\},/);
		const reset = source.match(/this\.qualityView = \{([\s\S]*?)\n\t\t\};/);
		assert.ok(literal && reset, "both definitions must be findable");
		assert.deepEqual(keysOf(reset[1]), keysOf(literal[1]));
	});
});
