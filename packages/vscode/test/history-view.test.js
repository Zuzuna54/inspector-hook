/**
 * Characterisation tests for the History view.
 *
 * Written against history.js BEFORE it is split, and required to pass on the
 * current file first. That is what makes them evidence: the identical suite then
 * runs against the composed modules, and green means the move preserved
 * behaviour rather than merely membership. A test adjusted to fit the new
 * structure would prove nothing about the move, so these must not change.
 *
 * They pin behaviour as it is TODAY, bugs included, because a move must not
 * change behaviour. Where something looks wrong it is marked, not fixed here.
 *
 * NOT covered, deliberately: _initVirtualScroll, _renderVirtualScrollContent and
 * _renderScrollbarMarkers. They co-operate through live element heights and
 * scroll offsets, so a stubbed DOM would only test the stub. That module is
 * moved whole and needs a human scrolling a long diff.
 */

import { strict as assert } from "node:assert";
import { beforeEach, describe, it } from "node:test";

import { installGlobals, readMedia } from "./harness.js";

function loadHistory(overrides = {}) {
	const requested = [];
	installGlobals({
		API: { getVersionContent: (f, v) => requested.push(`${f}:${v}`), ...overrides.API },
		...overrides,
	});
	for (const p of ["scripts/shared/diff-render.js", "scripts/views/history.js"]) {
		// biome-ignore lint/security/noGlobalEval: classic script, see harness.js
		eval(readMedia(p));
	}
	const view = globalThis.window.HistoryView;
	view.renderViewer = () => {}; // no DOM here
	return { view, requested };
}

describe("history: version identity", () => {
	const { view } = loadHistory();

	it("keys cached content by path and version", () => {
		assert.equal(view._getVersionContentKey("/a/b.ts", 3), "/a/b.ts:3");
	});

	it("does not collide across files sharing a version number", () => {
		assert.notEqual(
			view._getVersionContentKey("/a.ts", 2),
			view._getVersionContentKey("/b.ts", 2),
		);
	});

	it("labels a version with its number and date", () => {
		const label = view._formatVersionLabel(7, "2026-09-03T12:00:00.000Z");
		assert.match(label, /^v7 - /);
	});
});

describe("history: relative time", () => {
	const { view } = loadHistory();
	const ago = (ms) => new Date(Date.now() - ms).toISOString();

	it("reports minutes under an hour", () => {
		assert.match(view._formatShortTime(ago(20 * 60 * 1000)), /^\d+m ago$/);
	});

	it("reports hours under a day", () => {
		assert.match(view._formatShortTime(ago(5 * 60 * 60 * 1000)), /^\d+h ago$/);
	});

	it("says Yesterday between 24 and 48 hours", () => {
		assert.equal(view._formatShortTime(ago(30 * 60 * 60 * 1000)), "Yesterday");
	});

	it("falls back to a date beyond 48 hours", () => {
		const out = view._formatShortTime(ago(5 * 24 * 60 * 60 * 1000));
		assert.ok(!/ago|Yesterday/.test(out), `expected a date, got ${out}`);
	});
});

describe("history: tracked file list", () => {
	it("returns the paths of tracked files", () => {
		const { view } = loadHistory();
		globalThis.State.trackedFiles = [
			{ filePath: "/a.ts", versionCount: 2 },
			{ filePath: "/b.ts", versionCount: 1 },
		];
		assert.deepEqual(view._getUniqueFiles(), ["/a.ts", "/b.ts"]);
	});

	it("drops entries with no path rather than yielding undefined", () => {
		const { view } = loadHistory();
		globalThis.State.trackedFiles = [{ filePath: "/a.ts" }, { versionCount: 9 }];
		assert.deepEqual(view._getUniqueFiles(), ["/a.ts"]);
	});
});

describe("history: version content cache", () => {
	let ctx;
	beforeEach(() => {
		ctx = loadHistory();
		ctx.view._loadedVersionContent.clear();
		ctx.view._loadingVersions.clear();
	});

	it("requests content the first time and marks it loading", () => {
		assert.equal(ctx.view.requestVersionContent("/a.ts", 1), null);
		assert.deepEqual(ctx.requested, ["/a.ts:1"]);
		assert.ok(ctx.view.isVersionContentLoading("/a.ts", 1));
		assert.ok(!ctx.view.isVersionContentLoaded("/a.ts", 1));
	});

	it("does not request the same version twice while one is in flight", () => {
		ctx.view.requestVersionContent("/a.ts", 1);
		ctx.view.requestVersionContent("/a.ts", 1);
		assert.deepEqual(ctx.requested, ["/a.ts:1"], "a second request was issued");
	});

	it("serves the cached content without re-requesting", () => {
		ctx.view.requestVersionContent("/a.ts", 1);
		ctx.view.handleVersionContent({ filePath: "/a.ts", versionNumber: 1, content: "x" });
		assert.equal(ctx.view.requestVersionContent("/a.ts", 1), "x");
		assert.deepEqual(ctx.requested, ["/a.ts:1"]);
	});

	it("clears the loading flag when content arrives", () => {
		ctx.view.requestVersionContent("/a.ts", 1);
		ctx.view.handleVersionContent({ filePath: "/a.ts", versionNumber: 1, content: "x" });
		assert.ok(!ctx.view.isVersionContentLoading("/a.ts", 1));
		assert.ok(ctx.view.isVersionContentLoaded("/a.ts", 1));
	});

	it("clears the loading flag on a miss, so it cannot stick on loading forever", () => {
		// The core answers a missing version with content: null rather than
		// staying silent, precisely so this path resolves.
		ctx.view.requestVersionContent("/a.ts", 99);
		ctx.view.handleVersionContent({
			filePath: "/a.ts",
			versionNumber: 99,
			content: null,
			error: "Version content not found",
		});
		assert.ok(!ctx.view.isVersionContentLoading("/a.ts", 99));
		assert.ok(ctx.view.isVersionContentLoaded("/a.ts", 99), "the miss is cached");
	});

	it("evicts to stay near its stated 50-version bound", () => {
		for (let i = 0; i < 60; i++) {
			ctx.view.handleVersionContent({ filePath: "/f.ts", versionNumber: i, content: `c${i}` });
		}
		assert.ok(
			ctx.view._loadedVersionContent.size <= 51,
			`cache grew to ${ctx.view._loadedVersionContent.size}`,
		);
	});
});

describe("history: hunk line rendering", () => {
	const { view } = loadHistory();
	const line = (type, content, extra = {}) => ({ type, content, ...extra });

	it("prefixes added, removed and context lines", () => {
		const html = view._renderHunkLines(
			[
				line("added", "new"),
				line("removed", "old"),
				line("context", "same"),
			],
			"plaintext",
		);
		assert.ok(html.includes(">+<"), "added line needs a + prefix");
		assert.ok(html.includes(">-<"), "removed line needs a - prefix");
	});

	it("uses the history namespace, not file-changes'", () => {
		const html = view._renderHunkLines([line("context", "x")], "plaintext");
		assert.match(html, /hv-diff-line/);
		assert.ok(!/\bfc-/.test(html), "history must not emit fc- classes");
	});

	it("renders an empty hunk as empty output", () => {
		assert.equal(view._renderHunkLines([], "plaintext"), "");
	});

	it("marks moved lines in both directions", () => {
		const from = view._renderHunkLines([line("moved-from", "x", { moveId: "m1" })], "plaintext");
		const to = view._renderHunkLines([line("moved-to", "x", { moveId: "m1" })], "plaintext");
		assert.match(from, /hv-move-indicator/);
		assert.match(to, /hv-move-indicator/);
		assert.match(from, /data-move-id="m1"/);
	});

	it("escapes content rather than emitting it raw", () => {
		const html = view._renderHunkLines([line("context", "<script>")], "plaintext");
		assert.ok(!html.includes("<script>"), "content must be escaped");
	});
});

describe("history: split diff line distribution", () => {
	const { view } = loadHistory();

	it("puts a removal on the left with a gap on the right", () => {
		const { leftLines, rightLines } = view._splitHunkLines([
			{ type: "removed", content: "gone" },
		]);
		assert.equal(leftLines[0].type, "removed");
		assert.equal(rightLines[0].type, "empty");
	});

	it("puts an addition on the right with a gap on the left", () => {
		const { leftLines, rightLines } = view._splitHunkLines([
			{ type: "added", content: "new" },
		]);
		assert.equal(leftLines[0].type, "empty");
		assert.equal(rightLines[0].type, "added");
	});

	it("shows context on both sides", () => {
		const { leftLines, rightLines } = view._splitHunkLines([
			{ type: "context", content: "same" },
		]);
		assert.equal(leftLines[0], rightLines[0], "context is the same object both sides");
	});

	it("keeps both sides the same length so rows align", () => {
		const { leftLines, rightLines } = view._splitHunkLines([
			{ type: "removed", content: "a" },
			{ type: "added", content: "b" },
			{ type: "context", content: "c" },
			{ type: "moved-from", content: "d" },
			{ type: "moved-to", content: "e" },
		]);
		assert.equal(leftLines.length, rightLines.length);
		assert.equal(leftLines.length, 5);
	});

	it("returns two empty sides for no lines", () => {
		const { leftLines, rightLines } = view._splitHunkLines([]);
		assert.deepEqual(leftLines, []);
		assert.deepEqual(rightLines, []);
	});
});
