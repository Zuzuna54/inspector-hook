/**
 * The Find view — four corpora, searched and reported separately.
 *
 * What is guarded here is everything that would let the view state something
 * untrue while looking like it works:
 *
 * 1. **No merged ranking.** Four indexes, four `avgdl` values, four IDFs. A
 *    combined order would look authoritative and be arbitrary, so there is no
 *    code path that produces one.
 * 2. **Counts carry denominators.** "3 hits" out of 34 memory files and out of
 *    8,000 prompts are different claims.
 * 3. **"could not search" never renders as "nothing matched".**
 * 4. **Add sends the id, not the snippet.** The core re-reads the source; the
 *    snippet is 600 characters and adding it as the whole file would inject a
 *    truncated file with nothing saying so.
 * 5. **It subscribes.** The Research view shipped with every claim in its
 *    header comment true and no subscription, so results landed in state and
 *    nothing re-rendered. Every search spun forever.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { installGlobals, readMedia } from "./harness.js";

const FIND_LOAD_ORDER = [
	"scripts/views/find/find-render.js",
	"scripts/views/find.js",
];

function loadFind(overrides = {}) {
	const registered = {};
	installGlobals(overrides);
	globalThis.Router = { register: (name, view) => (registered[name] = view) };
	for (const relPath of FIND_LOAD_ORDER) {
		// biome-ignore lint/security/noGlobalEval: classic script, see harness.js
		eval(readMedia(relPath));
	}
	return registered.find;
}

const hit = (over = {}) => ({
	id: "memory:proj:notes.md",
	corpus: "memory",
	title: "auth notes",
	snippet: "the login flow uses PKCE",
	timestamp: "2026-09-01T10:00:00.000Z",
	score: 3.25,
	matched: ["login"],
	projectName: "inspector-hook",
	...over,
});

const group = (over = {}) => ({
	corpus: "memory",
	hits: [hit()],
	total: 1,
	searched: 34,
	terms: ["login"],
	...over,
});

const findState = (over = {}) => ({
	query: "login",
	groups: [group()],
	stats: null,
	searching: false,
	collapsed: [],
	projectKey: null,
	...over,
});

describe("registration", () => {
	it("registers under the name the nav tab uses", () => {
		// An unregistered view is indistinguishable from an empty one: router.js
		// warns to a console nobody reads and returns.
		assert.ok(loadFind(), "the Find tab points at nothing");
	});

	it("subscribes to its state slice on init", () => {
		// The bug this exists for: State.update only notifies subscribers, so a
		// view that never subscribes receives results and never re-renders.
		const keys = [];
		const view = loadFind({
			State: { contextFind: findState(), subscribe: (key) => (keys.push(key), () => {}) },
			API: { contextFindStats() {}, contextFind() {} },
		});
		view.init();
		assert.ok(keys.includes("contextFind"), "results would arrive and nothing would redraw");
	});

	it("asks for corpus sizes on init", () => {
		let asked = false;
		const view = loadFind({
			State: { contextFind: findState() },
			API: { contextFindStats: () => (asked = true), contextFind() {} },
		});
		view.init();
		assert.ok(asked, "the header would render without its counts");
	});
});

describe("groups are never merged", () => {
	it("renders one section per corpus, in the order given", () => {
		const view = loadFind();
		const html = view.renderGroups(
			findState({
				groups: [
					group({ corpus: "memory" }),
					group({ corpus: "digest" }),
					group({ corpus: "filechange" }),
					group({ corpus: "prompt" }),
				],
			}),
		);
		const order = [...html.matchAll(/data-corpus="([a-z]+)"/g)].map((m) => m[1]);
		// Each corpus appears on its section and again on its toggle button.
		assert.deepEqual([...new Set(order)], [
			"memory",
			"digest",
			"filechange",
			"prompt",
		]);
	});

	it("has no renderer that sorts hits across corpora", () => {
		// A negative property, so a source assertion is the right tool: there
		// must be no code path that produces a combined ranking.
		const source = readMedia("scripts/views/find/find-render.js");
		assert.ok(
			!/\.sort\(/.test(source),
			"the renderer sorts — across groups that would be a meaningless order",
		);
	});
});

describe("counts carry their denominator", () => {
	it("shows matched and searched, not just a hit count", () => {
		const view = loadFind();
		const html = view.renderCount(group({ hits: [hit()], total: 56, searched: 240 }));
		assert.match(html, /1 of 56/);
		assert.match(html, /searched 240/);
	});

	it("says how many it could not attribute to the project", () => {
		// Those documents were INCLUDED rather than judged. Hiding them loses
		// real material; including them silently claims they belong here.
		const view = loadFind();
		const html = view.renderCount(group({ hits: [hit()], total: 1, unattributed: 34 }));
		assert.match(html, /34 unattributed/);
	});

	it("says nothing about attribution when no project was scoped", () => {
		const view = loadFind();
		assert.ok(!/unattributed/.test(view.renderCount(group())));
	});

	it("does not say 'of' when nothing was withheld by the limit", () => {
		const view = loadFind();
		assert.match(view.renderCount(group({ hits: [hit()], total: 1 })), />1</);
	});
});

describe("an unsearchable corpus says so", () => {
	it("renders the reason, not an empty list", () => {
		// "nothing matched" and "this could not be searched" are different
		// statements and the second must never render as the first.
		const view = loadFind();
		const html = view.renderGroupBody(
			group({ hits: [], total: 0, unavailable: "The research index is not available." }),
		);
		assert.match(html, /research index is not available/);
		assert.ok(!/Nothing in this corpus matched/.test(html));
	});

	it("marks the count as unavailable rather than zero", () => {
		const view = loadFind();
		const html = view.renderCount(group({ hits: [], total: 0, unavailable: "gone" }));
		assert.match(html, /unavailable/);
		assert.ok(!/searched 0/.test(html), "a broken corpus reported as an empty one");
	});

	it("still says nothing matched when that is what happened", () => {
		const view = loadFind();
		assert.match(
			view.renderGroupBody(group({ hits: [], total: 0 })),
			/Nothing in this corpus matched/,
		);
	});
});

describe("adding a hit to the tray", () => {
	it("sends the id, never the snippet", () => {
		// The core resolves the id back to the source. Sending the snippet
		// would put 600 characters in the tray labelled as the whole file.
		const sent = [];
		const view = loadFind({
			State: { contextFind: findState() },
			API: { contextAddFromFind: (p) => sent.push(p), contextFind() {}, contextFindStats() {} },
		});
		const button = {
			dataset: { hitId: "memory:proj:notes.md" },
			disabled: false,
			textContent: "",
		};
		const container = {
			querySelector: () => null,
			addEventListener: (_type, handler) => {
				handler({
					target: {
						closest: (sel) => (sel === ".fd-add" ? button : null),
					},
				});
			},
		};
		view.bind(container);

		assert.deepEqual(sent, [{ id: "memory:proj:notes.md" }]);
		assert.equal(button.disabled, true, "the button stayed clickable after adding");
	});

	it("disables the button for a delegated hit, and says why", () => {
		// The research index stores only a snippet of a turn, so the full text
		// genuinely does not exist anywhere this core can reach.
		const view = loadFind();
		const html = view.renderHit(hit({ corpus: "prompt" }));
		assert.match(html, /disabled/);
		assert.match(html, /stores only a snippet/);
	});

	it("leaves it enabled for a corpus that can be resolved", () => {
		const view = loadFind();
		const html = view.renderHit(hit({ corpus: "memory" }));
		assert.ok(!/disabled/.test(html));
		assert.match(html, /Adds the full source/);
	});
});

describe("stats", () => {
	it("names the index that owns a delegated corpus", () => {
		const view = loadFind();
		const html = view.renderStats({
			corpora: [
				{ corpus: "memory", documents: 34, vocabulary: 3133, cap: 2000, evicted: 0 },
				{ corpus: "prompt", documents: 327, delegatedTo: "research" },
			],
		});
		assert.match(html, /34 indexed/);
		assert.match(html, /held by the research index/);
	});

	it("does not print a cap or an eviction count for a delegated corpus", () => {
		// Those fields are absent because the core cannot read them from the
		// index that owns them — printing 0 would read as "no limit".
		const view = loadFind();
		const html = view.renderStats({
			corpora: [{ corpus: "prompt", documents: 327, delegatedTo: "research" }],
		});
		assert.ok(!/cap /.test(html), "invented a cap");
		assert.ok(!/evicted/.test(html), "invented an eviction count");
	});

	it("reports what the store costs, and that nothing deletes it", () => {
		const view = loadFind();
		const html = view.renderStats({
			corpora: [{ corpus: "memory", documents: 1, cap: 10, evicted: 0 }],
			store: {
				totalSize: 110_345_334,
				sessionCount: 4,
				logCount: 14_370,
				versionCount: 240,
				archiveCount: 240,
			},
		});
		assert.match(html, /105\.2 MB/);
		assert.match(html, /Retention is off/);
	});

	it("renders nothing rather than an empty frame when stats are missing", () => {
		const view = loadFind();
		assert.equal(view.renderStats(null), "");
		assert.equal(view.renderStats({ corpora: [] }), "");
	});
});

describe("the empty and in-flight states", () => {
	it("prompts rather than spinning before anything is typed", () => {
		const view = loadFind();
		const html = view.renderGroups(findState({ query: "", groups: [] }));
		assert.match(html, /Search your own history/);
		assert.ok(!/Searching/.test(html));
	});

	it("shows a searching state only while a query is in flight", () => {
		const view = loadFind();
		assert.match(view.renderGroups(findState({ searching: true })), /Searching/);
	});

	it("escapes a hit's text", () => {
		const view = loadFind();
		const html = view.renderHit(hit({ title: "<img src=x onerror=1>" }));
		assert.ok(!html.includes("<img"), "unescaped title");
	});
});
