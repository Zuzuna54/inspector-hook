/**
 * The header search is global (M3 P9 follow-up).
 *
 * It used to call `API.getLogs({search})` and nothing else — a box in the
 * header, above every view, that filtered ONE view by a case-insensitive
 * substring of a log's summary line. It could not reach a memory file, a
 * session digest, a file change or a prompt, and inside logs it could not
 * match anything the summary line did not already contain.
 *
 * Two properties are pinned here, and both would regress silently:
 *
 * 1. **The header searches every corpus, not logs.** A regression looks like a
 *    working search box that quietly stops finding four fifths of the corpus.
 * 2. **The Logs view kept its own filter.** Making the header global without
 *    that would silently remove the ability to narrow the log table at all.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { installGlobals, readMedia } from "./harness.js";

/** Load header.js the way the manifest does, and hand back the object. */
function loadHeader(overrides = {}) {
	installGlobals(overrides);
	globalThis.Router = { navigate: () => {}, register: () => {} };
	// biome-ignore lint/security/noGlobalEval: classic script, see harness.js
	eval(readMedia("scripts/header.js"));
	return globalThis.window.Header;
}

describe("the header search reaches every corpus", () => {
	it("issues a five-corpus search, not a log filter", () => {
		const calls = { find: [], logs: [] };
		const header = loadHeader({
			State: {
				contextFind: { query: "", groups: [] },
				update: () => {},
			},
			API: {
				contextFind: (p) => calls.find.push(p),
				getLogs: (p) => calls.logs.push(p),
			},
		});

		header.runGlobalSearch("retention");

		assert.equal(calls.find.length, 1, "the global search did not run");
		assert.equal(calls.find[0].query, "retention");
		assert.equal(
			calls.logs.length,
			0,
			"the header still filters logs — that is the old, logs-only behaviour",
		);
	});

	it("shows the results instead of leaving them somewhere to find", () => {
		// A global search whose results appear in a view you have to navigate to
		// yourself is a filter, not a search.
		const navigated = [];
		installGlobals({
			State: { contextFind: { query: "", groups: [] }, update: () => {} },
			API: { contextFind: () => {} },
		});
		globalThis.Router = {
			navigate: (v) => navigated.push(v),
			register: () => {},
		};
		// biome-ignore lint/security/noGlobalEval: classic script, see harness.js
		eval(readMedia("scripts/header.js"));

		globalThis.window.Header.runGlobalSearch("anything");
		assert.deepEqual(navigated, ["find"]);
	});

	it("carries the global project filter into the query", () => {
		const calls = [];
		const header = loadHeader({
			State: { contextFind: { query: "", groups: [] }, update: () => {} },
			API: { contextFind: (p) => calls.push(p) },
		});
		globalThis.ProjectFilter = { selected: () => ({ id: "/repo" }) };

		header.runGlobalSearch("q");
		assert.equal(calls[0].projectId, "/repo");
		globalThis.ProjectFilter = undefined;
	});

	it("marks the search as in flight so the view can say so", () => {
		const updates = [];
		const header = loadHeader({
			State: {
				contextFind: { query: "", groups: [] },
				update: (key, value) => updates.push([key, value]),
			},
			API: { contextFind: () => {} },
		});
		header.runGlobalSearch("q");
		const [key, value] = updates[0];
		assert.equal(key, "contextFind");
		assert.equal(value.searching, true);
		assert.equal(value.query, "q");
	});
});

describe("the Logs view kept a way to narrow itself", () => {
	it("still has its own filter input", () => {
		// Moving the header to global search removes the only control that
		// narrowed the log table. Without this the feature is a net loss.
		const src = readMedia("scripts/views/logs.js");
		assert.match(src, /id="filter-text"/, "the Logs view has no filter box");
		assert.match(
			src,
			/API\.getLogs\(\{ search:/,
			"it does not filter server-side",
		);
	});

	it("writes the same state key the table already reads", () => {
		const src = readMedia("scripts/views/logs.js");
		assert.match(src, /State\.update\('searchQuery'/);
		assert.match(src, /State\.subscribe\('searchQuery'/);
	});
});

describe("the header markup matches what it now does", () => {
	it("no longer says it searches logs", () => {
		// A placeholder that says "Search logs..." on a box that searches five
		// corpora is the same class of untruth as a button that does nothing.
		const html = readMedia("../src/webview-html.ts");
		assert.ok(
			!/placeholder="Search logs/.test(html),
			"the header still advertises a log search",
		);
		assert.match(html, /id="search"[^>]*placeholder="Search everything/);
	});
});
