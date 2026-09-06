/**
 * Every nav tab reaches a view that is actually registered.
 *
 * This exists because the same shape has now shipped three times, and each
 * time the work was real and a single connecting line was missing:
 *
 *   B2          fixed and tested, while the installed hook forwarded no id
 *   the picker  fixed at the wrong nesting level, so the guard never passed
 *   research    a complete client that never called Router.register
 *
 * In all three a green suite said nothing, because nothing asserted the
 * connection. `router.js` warns to a console nobody is watching and returns, so
 * clicking an unregistered tab does nothing at all — no init, no request, no
 * view — and looks exactly like a view with no data.
 *
 * The registry is hand-maintained wiring that nothing checked, which is the
 * same shape the asset manifest was in before manifest.test.js.
 *
 * BEHAVIOURAL, not textual: it loads the real shipped scripts in the real
 * manifest order and inspects the registry those scripts actually build. A
 * regex over `Router.register(` would have been the obvious version and it is
 * the wrong one — my first pass at exactly that missed three views because they
 * quote the name with apostrophes, and nearly reported them as broken.
 */

import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { installGlobals, readMedia } from "./harness.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(packageRoot, "src", "webview-html.ts"), "utf8");

/** Views whose tab is deliberately absent, with the reason. Empty is healthy. */
const TAB_EXEMPT = {};

/** Every `data-view` in the nav. */
function navTabs() {
	return [...new Set([...html.matchAll(/data-view="([\w-]+)"/g)].map((m) => m[1]))].sort();
}

/** Every script the page loads, in the order it loads them. */
function scriptManifest() {
	const block = /const scripts: string\[\]\[\] = \[([\s\S]*?)\n\t\];/.exec(html);
	assert.ok(block, "could not find the scripts manifest");
	return [...block[1].matchAll(/\[([^\]]*)\]/g)]
		.map((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((p) => p[1]).join("/"))
		.filter(Boolean);
}

/**
 * Load the whole page's scripts and return the registry they built.
 *
 * Loaded in manifest order, exactly as the browser would, so a view that
 * depends on a mixin loading first is exercised the same way it ships. A script
 * that throws is recorded rather than aborting the sweep: one broken file
 * should not hide the state of every other.
 */
function loadRegistry() {
	const registered = {};
	const failures = [];
	installGlobals();
	// navigate is stubbed too: main.js routes to the initial view at load, and a
	// missing navigate would abort main.js before the sweep finished — masking
	// exactly what this test is looking for.
	globalThis.Router = {
		register: (name, view) => (registered[name] = view),
		navigate: () => {},
		views: registered,
	};
	globalThis.window.addEventListener = () => {};
	globalThis.addEventListener = () => {};
	globalThis.acquireVsCodeApi = undefined;

	for (const relPath of scriptManifest()) {
		if (!existsSync(join(packageRoot, "media", relPath))) continue;
		try {
			// biome-ignore lint/security/noGlobalEval: classic script, see harness.js
			eval(readMedia(relPath));
		} catch (error) {
			failures.push(`${relPath}: ${error.message}`);
		}
		// Once api.js has published the real API, later scripts should see it
		// rather than the harness stub. Stubbing every method main.js happens to
		// call would drift from the real surface, and a stub that drifts is how a
		// test stops testing the thing it names.
		if (globalThis.window.API) globalThis.API = globalThis.window.API;
	}
	return { registered, failures };
}

describe("nav tabs reach real views", () => {
	const { registered, failures } = loadRegistry();
	const tabs = navTabs();

	it("finds the nav and the manifest", () => {
		// Without this the sweep could cover nothing and pass.
		assert.ok(tabs.length > 5, `only found ${tabs.length} nav tabs`);
		assert.ok(scriptManifest().length > 15, "the script manifest looks empty");
	});

	it("registers a view for every tab", () => {
		// The whole finding. An unregistered tab is a button that does nothing
		// and reports nothing, which is indistinguishable from an empty view.
		const missing = tabs.filter((t) => !(t in registered) && !(t in TAB_EXEMPT));
		assert.deepEqual(
			missing,
			[],
			"these tabs have no registered view: clicking them does nothing at all",
		);
	});

	it("has a tab for every registered view", () => {
		// The other direction. A registered view with no way to reach it is
		// dead weight that looks alive — the same shape as styles/main.css.
		const unreachable = Object.keys(registered).filter((v) => !tabs.includes(v));
		assert.deepEqual(unreachable, [], "registered but reachable from no tab");
	});

	it("loads every view script without throwing", () => {
		// A script that throws during load registers nothing after the throw, so
		// this failing usually means the previous assertion is about to lie.
		assert.deepEqual(failures, [], "these scripts failed to evaluate");
	});

	it("gives every exemption a reason", () => {
		for (const [name, why] of Object.entries(TAB_EXEMPT)) {
			assert.ok(why && why.length > 10, `${name} needs a reason, not a bare exemption`);
		}
	});
});
