/**
 * Characterisation tests for the File Changes view.
 *
 * Written against file-changes.js BEFORE it is split, and required to pass on
 * the current file first. The identical suite then runs against the composed
 * modules; green means the move preserved behaviour, not merely membership. A
 * test adjusted to fit the new structure would prove nothing, so these must not
 * change during the split.
 *
 * They pin behaviour as it is TODAY, bugs included, because a move must not
 * change behaviour. Anything that looks wrong is marked, not fixed here.
 */

import { strict as assert } from "node:assert";
import { beforeEach, describe, it } from "node:test";

import { FILE_CHANGES_LOAD_ORDER, existing, installGlobals, readMedia } from "./harness.js";

function loadFileChanges(overrides = {}) {
	const sent = [];
	installGlobals({
		API: {
			updateChangeContent: (id, content) => sent.push({ id, content }),
			getDiff: () => {},
			keepChange: (id) => sent.push({ keep: id }),
			revertChange: (id) => sent.push({ revert: id }),
			...overrides.API,
		},
		...overrides,
	});
	for (const p of existing(FILE_CHANGES_LOAD_ORDER)) {
		// biome-ignore lint/security/noGlobalEval: classic script, see harness.js
		eval(readMedia(p));
	}
	const view = globalThis.window.FileChangesView;
	view.renderDiff = () => {}; // no DOM here
	view.renderSidebar = () => {};
	return { view, sent };
}

describe("file changes: tool classification", () => {
	const { view } = loadFileChanges();

	it("classifies each tool it knows", () => {
		assert.equal(view._getToolType("Edit"), "edit");
		assert.equal(view._getToolType("Write"), "write");
		assert.equal(view._getToolType("Bash"), "bash");
		assert.equal(view._getToolType("Read"), "read");
	});

	it("matches case-insensitively and on substrings", () => {
		assert.equal(view._getToolType("NotebookEdit"), "edit");
		assert.equal(view._getToolType("bash"), "bash");
	});

	it("falls back to unknown rather than throwing", () => {
		assert.equal(view._getToolType(""), "unknown");
		assert.equal(view._getToolType(null), "unknown");
		assert.equal(view._getToolType("Glob"), "unknown");
	});
});

describe("file changes: grouping by session", () => {
	let view;
	beforeEach(() => {
		({ view } = loadFileChanges());
		globalThis.State.sessions = [
			{ id: "s1", name: "one", startTime: "2026-09-03T10:00:00.000Z" },
			{ id: "s2", name: "two", startTime: "2026-09-03T12:00:00.000Z" },
		];
	});

	it("groups changes under their session and file", () => {
		const groups = view._groupBySession([
			{ id: "c1", sessionId: "s1", filePath: "/a.ts", additions: 2, deletions: 1, tool: "Edit" },
			{ id: "c2", sessionId: "s1", filePath: "/a.ts", additions: 3, deletions: 0, tool: "Write" },
			{ id: "c3", sessionId: "s1", filePath: "/b.ts", additions: 1, deletions: 0 },
		]);
		assert.equal(groups.length, 1);
		assert.equal(groups[0].files.length, 2);
		const fileA = groups[0].files.find((f) => f.filePath === "/a.ts");
		assert.equal(fileA.changes.length, 2);
		assert.equal(fileA.totalAdditions, 5, "additions accumulate across changes");
		assert.equal(fileA.totalDeletions, 1);
		assert.equal(fileA.tools.size, 2, "distinct tools are collected");
	});

	it("orders sessions newest first", () => {
		const groups = view._groupBySession([
			{ id: "c1", sessionId: "s1", filePath: "/a.ts" },
			{ id: "c2", sessionId: "s2", filePath: "/b.ts" },
		]);
		assert.deepEqual(groups.map((g) => g.session.id), ["s2", "s1"]);
	});

	it("keeps a change whose session is unknown rather than dropping it", () => {
		const groups = view._groupBySession([{ id: "c1", filePath: "/a.ts" }]);
		assert.equal(groups.length, 1);
		assert.equal(groups[0].session.id, "unknown");
	});

	it("returns nothing for no changes", () => {
		assert.deepEqual(view._groupBySession([]), []);
	});
});

describe("file changes: line change map", () => {
	const { view } = loadFileChanges();

	it("maps added lines to their new line numbers", () => {
		const map = view._buildLineChangeMap([
			{
				newStart: 10,
				lines: [
					{ type: "context", content: "a" },
					{ type: "added", content: "b" },
					{ type: "added", content: "c" },
				],
			},
		]);
		assert.deepEqual([...map.keys()], [11, 12]);
		assert.equal(map.get(11).content, "b");
	});

	it("does not advance the counter for removed lines", () => {
		// Removed lines do not exist in the new file, so they must not consume a
		// new-file line number.
		const map = view._buildLineChangeMap([
			{
				newStart: 1,
				lines: [
					{ type: "removed", content: "gone" },
					{ type: "added", content: "new" },
				],
			},
		]);
		assert.deepEqual([...map.keys()], [1]);
	});

	it("defaults newStart to 1 when a hunk omits it", () => {
		const map = view._buildLineChangeMap([{ lines: [{ type: "added", content: "x" }] }]);
		assert.deepEqual([...map.keys()], [1]);
	});

	it("handles a hunk with no lines and no hunks at all", () => {
		assert.equal(view._buildLineChangeMap([{ newStart: 5 }]).size, 0);
		assert.equal(view._buildLineChangeMap([]).size, 0);
	});
});

describe("file changes: diff cache eviction", () => {
	it("clears every per-change map together", () => {
		// A partial eviction would leave edited content attached to a change whose
		// diff had been dropped.
		const { view } = loadFileChanges();
		view._diffCache.set("c1", { hunks: [] });
		view._editedContent.set("c1", "edited");
		view._originalContent.set("c1", "original");
		view._removeFromCache("c1");
		assert.ok(!view._diffCache.has("c1"));
		assert.ok(!view._editedContent.has("c1"));
		assert.ok(!view._originalContent.has("c1"));
	});

	it("is a no-op for a change it does not hold", () => {
		const { view } = loadFileChanges();
		assert.doesNotThrow(() => view._removeFromCache("missing"));
	});
});

describe("file changes: edit mode state machine", () => {
	let ctx;
	const diffEntry = () => ({
		changeId: "c1",
		diff: { afterContent: "line1\nline2", hunks: [{ newStart: 1, lines: [] }] },
	});

	beforeEach(() => {
		ctx = loadFileChanges();
		ctx.view._selectedFile = "/a.ts";
		ctx.view._currentDiffs = [diffEntry()];
		ctx.view._isEditMode = false;
		ctx.view._editedContent.clear();
		ctx.view._originalContent.clear();
		ctx.view._originalHunks.clear();
	});

	it("captures the original content and hunks on entry", () => {
		ctx.view.enterEditMode();
		assert.ok(ctx.view._isEditMode);
		assert.equal(ctx.view._originalContent.get("c1"), "line1\nline2");
		assert.ok(ctx.view._originalHunks.has("c1"));
	});

	it("deep-copies the hunks so later edits cannot corrupt the original", () => {
		ctx.view.enterEditMode();
		ctx.view._currentDiffs[0].diff.hunks[0].newStart = 999;
		assert.equal(
			ctx.view._originalHunks.get("c1")[0].newStart,
			1,
			"the stored original was mutated through a shared reference",
		);
	});

	it("does not overwrite the original when entered twice", () => {
		ctx.view.enterEditMode();
		ctx.view._currentDiffs[0].diff.afterContent = "edited!";
		ctx.view.enterEditMode();
		assert.equal(ctx.view._originalContent.get("c1"), "line1\nline2");
	});

	it("restores content on cancel and leaves edit mode", () => {
		ctx.view.enterEditMode();
		ctx.view._editedContent.set("c1", "edited");
		ctx.view._currentDiffs[0].diff.afterContent = "edited";
		ctx.view.cancelEditMode();
		assert.equal(ctx.view._currentDiffs[0].diff.afterContent, "line1\nline2");
		assert.ok(!ctx.view._editedContent.has("c1"));
		assert.ok(!ctx.view._isEditMode);
	});

	it("tells the backend to reset when cancelling", () => {
		ctx.view.enterEditMode();
		ctx.view._currentDiffs[0].diff.afterContent = "edited";
		ctx.view.cancelEditMode();
		assert.deepEqual(ctx.sent, [{ id: "c1", content: "line1\nline2" }]);
	});

	it("clears the stored originals on cancel", () => {
		ctx.view.enterEditMode();
		ctx.view.cancelEditMode();
		assert.equal(ctx.view._originalContent.size, 0);
		assert.equal(ctx.view._originalHunks.size, 0);
	});

	it("resets edits but stays in edit mode", () => {
		// The difference from cancel: resetAllEdits keeps you editing.
		ctx.view.enterEditMode();
		ctx.view._editedContent.set("c1", "edited");
		ctx.view._currentDiffs[0].diff.afterContent = "edited";
		ctx.view.resetAllEdits();
		assert.equal(ctx.view._currentDiffs[0].diff.afterContent, "line1\nline2");
		assert.ok(!ctx.view._editedContent.has("c1"));
		assert.ok(ctx.view._isEditMode, "reset must not exit edit mode");
		assert.ok(ctx.view._originalContent.has("c1"), "originals stay available");
	});

	it("does nothing without a selected file", () => {
		ctx.view._selectedFile = null;
		ctx.view.enterEditMode();
		assert.ok(!ctx.view._isEditMode);
	});
});

describe("file changes: non-content diff states", () => {
	// These write into the DOM rather than returning markup, so they are driven
	// through a minimal element stub. That still exercises the real method and
	// asserts the real output.
	function withElements(ids) {
		const els = {};
		for (const id of ids) {
			els[id] = {
				innerHTML: "",
				querySelector: () => null,
				addEventListener: () => {},
			};
		}
		globalThis.document.getElementById = (id) => els[id] ?? null;
		return els;
	}

	it("writes the empty state into the diff container", () => {
		const { view } = loadFileChanges();
		const els = withElements(["fc-diff-container", "fc-toolbar"]);
		view.renderEmptyDiff();
		assert.match(els["fc-diff-container"].innerHTML, /fc-empty-state/);
		assert.equal(els["fc-toolbar"].innerHTML, "", "the toolbar is cleared");
	});

	it("writes a loading state", () => {
		const { view } = loadFileChanges();
		const els = withElements(["fc-diff-container", "fc-toolbar"]);
		view.renderDiffLoading();
		assert.match(els["fc-diff-container"].innerHTML, /fc-diff-loading/);
	});

	it("shows the error text it was given, escaped", () => {
		const { view } = loadFileChanges();
		const els = withElements(["fc-diff-container", "fc-toolbar"]);
		view.renderDiffError("could not <read> file");
		const html = els["fc-diff-container"].innerHTML;
		assert.match(html, /fc-diff-error/);
		assert.ok(html.includes("&lt;read&gt;"), "the message must be escaped");
	});

	it("uses its default message when given none", () => {
		const { view } = loadFileChanges();
		const els = withElements(["fc-diff-container", "fc-toolbar"]);
		view.renderDiffError();
		assert.match(els["fc-diff-container"].innerHTML, /Failed to load diff/);
	});

	it("does nothing when the container is absent", () => {
		const { view } = loadFileChanges();
		withElements([]); // getElementById returns null for everything
		assert.doesNotThrow(() => view.renderDiffLoading());
	});

	it("KNOWN BUG: throws when the toolbar is absent but the container is not", () => {
		// renderEmptyDiff and renderDiffError null-check `container` and then
		// write `toolbar.innerHTML` unguarded. Pinned as current behaviour, not
		// endorsed - fixing it is a behaviour change and belongs in its own
		// commit, not inside a move.
		const { view } = loadFileChanges();
		withElements(["fc-diff-container"]);
		assert.throws(() => view.renderEmptyDiff(), /toolbar|null|undefined/i);
	});
});
