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

import { installGlobals, readMedia } from "./harness.js";

/** Load one view with its shared mixin, in manifest order. */
function loadView(relPath, globalName) {
	installGlobals();
	for (const p of ["scripts/shared/diff-render.js", relPath]) {
		// biome-ignore lint/security/noGlobalEval: classic script, see harness.js
		eval(readMedia(p));
	}
	return globalThis.window[globalName];
}

const SHARED = ["_applySyntaxHighlighting", "_getFileChanges"];

describe("shared diff helpers", () => {
	for (const [relPath, globalName] of [
		["scripts/views/history.js", "HistoryView"],
		["scripts/views/file-changes.js", "FileChangesView"],
	]) {
		describe(globalName, () => {
			const view = loadView(relPath, globalName);

			it("resolves every shared helper at runtime", () => {
				// Object.assign composition means a missing mixin does not fail to
				// load - the method is simply undefined when something calls it.
				for (const name of SHARED) {
					assert.equal(typeof view[name], "function", `${name} must resolve`);
				}
			});

			it("keeps no local copy that could shadow the shared one", () => {
				const src = readMedia(relPath);
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
		const view = loadView("scripts/views/history.js", "HistoryView");
		globalThis.State.fileChanges = null;
		assert.deepEqual(view._getFileChanges(), []);
		globalThis.State.fileChanges = [{ id: "c1" }];
		assert.deepEqual(view._getFileChanges(), [{ id: "c1" }]);
	});
});

describe("view-specific renderers stay separate", () => {
	const history = readMedia("scripts/views/history.js");
	const fileChanges = readMedia("scripts/views/file-changes.js");

	it("each view keeps its own unified and split diff renderers", () => {
		// These were nearly extracted as duplicates. They are not: history's
		// renders hunks inline, file-changes' delegates to _renderFullFileDiff
		// and _renderHunk, and they emit different class namespaces.
		for (const name of ["_renderUnifiedDiff", "_renderSplitDiff"]) {
			assert.match(history, new RegExp(`^\\t${name}\\s*\\(`, "m"));
			assert.match(fileChanges, new RegExp(`^\\t${name}\\s*\\(`, "m"));
		}
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
