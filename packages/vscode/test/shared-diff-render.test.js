/**
 * The helpers shared by the History and File Changes views.
 *
 * Only two functions are genuinely shared, which is the finding that matters
 * here. _renderUnifiedDiff and _renderSplitDiff LOOK like duplicates by name
 * but are not: they emit different CSS namespaces (hv-* against fc-*) and
 * delegate differently, so these tests also pin that they stay separate. A
 * future tidy-up that "de-duplicates" them by name would break both views.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
	FILE_CHANGES_LOAD_ORDER,
	HISTORY_LOAD_ORDER,
	existing,
	installGlobals,
	readMedia,
} from "./harness.js";

/** Load one view with its shared mixin, in manifest order. */
function loadView(order, globalName) {
	installGlobals();
	for (const p of existing(order)) {
		// biome-ignore lint/security/noGlobalEval: classic script, see harness.js
		eval(readMedia(p));
	}
	return globalThis.window[globalName];
}

const SHARED = ["_applySyntaxHighlighting", "_getFileChanges"];

describe("shared diff helpers", () => {
	for (const [order, globalName, relPath] of [
		[HISTORY_LOAD_ORDER, "HistoryView", "scripts/views/history.js"],
		[FILE_CHANGES_LOAD_ORDER, "FileChangesView", "scripts/views/file-changes.js"],
	]) {
		describe(globalName, () => {
			const view = loadView(order, globalName);

			it("resolves every shared helper at runtime", () => {
				// Object.assign composition means a missing mixin does not fail to
				// load - the method is simply undefined when something calls it.
				for (const name of SHARED) {
					assert.equal(typeof view[name], "function", `${name} must resolve`);
				}
			});

			it("keeps no local copy that could shadow the shared one", () => {
				// The view's own modules only - shared/ is where these legitimately
				// live, so including it would match the definition it is checking for.
				const src = existing(order)
					.filter((p) => !p.startsWith("scripts/shared/"))
					.map((p) => readMedia(p))
					.join("\n");
				for (const name of SHARED) {
					assert.ok(
						!new RegExp(`^\\t${name}\\s*\\(`, "m").test(src),
						`${name} still declared locally in ${relPath}`,
					);
				}
			});

			it("composes the mixin after its own literal", () => {
				// Assigning before the literal would let a stale local copy win.
				const src = readMedia(relPath);
				assert.match(src, /Object\.assign\(\w+, window\.DiffRenderMixin\)/);
			});
		});
	}

	it("returns an empty list when there are no file changes", () => {
		const view = loadView(HISTORY_LOAD_ORDER, "HistoryView");
		globalThis.State.fileChanges = null;
		assert.deepEqual(view._getFileChanges(), []);
		globalThis.State.fileChanges = [{ id: "c1" }];
		assert.deepEqual(view._getFileChanges(), [{ id: "c1" }]);
	});
});

describe("view-specific renderers stay separate", () => {
	// Read across each view's whole module set, so the guard follows the code
	// through the splits instead of pinning it to a filename.
	const srcOf = (order) => existing(order).map((p) => readMedia(p)).join("\n");
	const history = srcOf(HISTORY_LOAD_ORDER);
	const fileChanges = srcOf(FILE_CHANGES_LOAD_ORDER);

	it("each view keeps its own unified and split diff renderers", () => {
		// These were nearly extracted as duplicates. They are not: history's
		// renders hunks inline, file-changes' delegates to _renderFullFileDiff
		// and _renderHunk, and they emit different class namespaces.
		for (const name of ["_renderUnifiedDiff", "_renderSplitDiff"]) {
			assert.match(history, new RegExp(`^\\t${name}\\s*\\(`, "m"), `history lost ${name}`);
			assert.match(fileChanges, new RegExp(`^\\t${name}\\s*\\(`, "m"), `file-changes lost ${name}`);
		}
		// And they must still emit different namespaces - the actual reason they
		// are two functions rather than one.
		assert.match(history, /hv-diff-line/);
		assert.match(fileChanges, /fc-line/);
	});

	it("the shared module contains no view-namespaced markup", () => {
		// If a hv-* or fc-* class ever appears here, something view-specific has
		// been pulled in and one of the two views is rendering the other's classes.
		const shared = readMedia("scripts/shared/diff-render.js").replace(
			/\/\*[\s\S]*?\*\//g,
			"",
		);
		assert.ok(!/\bhv-[\w-]+/.test(shared), "history classes leaked into shared");
		assert.ok(!/\bfc-[\w-]+/.test(shared), "file-changes classes leaked into shared");
	});
});
