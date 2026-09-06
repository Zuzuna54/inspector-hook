/**
 * The inbound switch became a registry, and nothing was lost in the move.
 *
 * A 29-case switch was split across five modules. The failure mode of that move
 * is silent: a case that fails to re-register does not throw, it simply means
 * one message type is never handled again -- the work happens in the extension,
 * the reply arrives, and no view renders it. That is precisely the archived-diff
 * bug, and it survived for the life of the view.
 *
 * So this loads the real shipped modules and inspects the real registry rather
 * than scraping source for `case "x"`. EXPECTED_TYPES is the inventory the
 * switch had, recorded before the conversion; adding a handler means adding it
 * here, which is the point.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { apiSourcePaths } from "./api-sources.js";
import { installGlobals, readMedia } from "./harness.js";

/** Every type the pre-split switch handled. */
const EXPECTED_TYPES = [
	"archived",
	"context-armed",
	"context-targets",
	"context-tray",
	"core-status",
	"delete-session-result",
	"delete-version-result",
	"diff-error",
	"diff-result",
	"error",
	"fileChange",
	"fileChanges",
	"file-changes",
	"init",
	"log",
	"logs",
	"memory-digest",
	"memory-projects",
	"memory-result",
	"memory-staged",
	"ping",
	"restore-archived-result",
	"restore-result",
	"session",
	"session-activity",
	"session-logs",
	"sessions",
	"stats",
	"tracked-files",
	"version-comparison",
	"version-content",
	"version-history",
];

/** Load api.js and every handler module, returning the composed API. */
function loadApi() {
	installGlobals();
	globalThis.acquireVsCodeApi = undefined;
	globalThis.window = globalThis.window || {};
	// api.js installs a message listener at load. There is no DOM here and the
	// tests drive handleMessage directly, so a no-op listener is enough.
	globalThis.window.addEventListener = () => {};
	globalThis.addEventListener = () => {};
	globalThis.mergeActivity = () => [];
	for (const relPath of apiSourcePaths()) {
		// biome-ignore lint/security/noGlobalEval: classic script, see harness.js
		eval(readMedia(relPath));
	}
	return globalThis.window.API;
}

describe("the inbound registry", () => {
	const API = loadApi();

	it("loads", () => {
		assert.ok(API, "api.js did not publish window.API");
		assert.equal(typeof API.on, "function");
	});

	it("has a handler for every type the switch handled", () => {
		const missing = EXPECTED_TYPES.filter((t) => typeof API._inbound[t] !== "function");
		assert.deepEqual(missing, [], "these message types lost their handler in the split");
	});

	it("registers nothing undocumented", () => {
		// A handler added to a module without being recorded here would let the
		// inventory drift out of date silently, which is how the list stops
		// describing reality.
		const known = new Set(EXPECTED_TYPES);
		const extra = Object.keys(API._inbound).filter((t) => !known.has(t));
		assert.deepEqual(extra, [], "undocumented handlers - add them to EXPECTED_TYPES");
	});

	it("refuses a duplicate registration", () => {
		// The reason this is a registry and not an Object.assign of mixins:
		// message types are data, and a merge would let two modules claim
		// "memory-staged" with whichever loaded last winning, silently.
		assert.throws(
			() => API.on("memory-staged", () => {}),
			/Duplicate inbound handler/,
			"a second claim on one message type was accepted",
		);
	});

	it("dispatches to the registered handler with API as `this`", () => {
		let seen = null;
		let self = null;
		API.on("__probe", function (payload) {
			seen = payload;
			self = this;
		});
		API.ready();
		API.handleMessage({ data: { type: "__probe", payload: { n: 1 } } });
		assert.deepEqual(seen, { n: 1 });
		assert.equal(self, API, "handlers must run with API as `this`");
		delete API._inbound.__probe;
	});

	it("ignores an unknown type rather than throwing", () => {
		// The extension may send something a newer webview knows about, or the
		// reverse. That was true of the switch's default case and stays true.
		API._ready = true;
		assert.doesNotThrow(() =>
			API.handleMessage({ data: { type: "nothing-handles-this" } }),
		);
		assert.doesNotThrow(() => API.handleMessage({ data: {} }));
		assert.doesNotThrow(() => API.handleMessage({}));
	});

	it("queues a message that arrives before its handler, and flushes it", () => {
		// In practice nothing arrives early -- panel.ts only sends init after
		// webview-ready, which main.js posts last. But "in practice" is how the
		// digest envelope bug survived, so early messages are held rather than
		// dropped.
		const fresh = loadApi();
		fresh._ready = false;
		fresh._deferred = [];
		fresh.handleMessage({ data: { type: "__late", payload: "kept" } });
		assert.equal(fresh._deferred.length, 1, "an early message was dropped");

		let got = null;
		fresh.on("__late", (payload) => {
			got = payload;
		});
		fresh.ready();
		assert.equal(got, "kept", "the queue was not flushed on ready()");
	});
});
