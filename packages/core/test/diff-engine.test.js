/**
 * DiffEngine tests.
 *
 * Pure functions with no I/O, so this is the cheapest place in the codebase to
 * get real confidence -- and the engine underpins every diff the UI renders,
 * every version comparison, and the keep/revert flow.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { DiffEngine } from "../dist/index.js";

const engine = new DiffEngine();

/** All lines of a given type across every hunk. */
const linesOfType = (diff, type) =>
	diff.hunks.flatMap((h) => h.lines.filter((l) => l.type === type));

describe("DiffEngine", () => {
	describe("computeDiff", () => {
		it("reports no hunks for identical content", () => {
			const diff = engine.computeDiff("same\ncontent\n", "same\ncontent\n");
			assert.equal(diff.hunks.length, 0);
		});

		it("detects a single changed line", () => {
			const diff = engine.computeDiff("a\nb\nc\n", "a\nCHANGED\nc\n");

			assert.equal(linesOfType(diff, "removed").length, 1);
			assert.equal(linesOfType(diff, "added").length, 1);
			assert.equal(linesOfType(diff, "removed")[0].content, "b");
			assert.equal(linesOfType(diff, "added")[0].content, "CHANGED");
		});

		it("detects a pure addition", () => {
			const diff = engine.computeDiff("a\nb\n", "a\nb\nc\n");
			assert.equal(linesOfType(diff, "added").length, 1);
			assert.equal(linesOfType(diff, "removed").length, 0);
		});

		it("detects a pure deletion", () => {
			const diff = engine.computeDiff("a\nb\nc\n", "a\nc\n");
			assert.equal(linesOfType(diff, "removed").length, 1);
			assert.equal(linesOfType(diff, "added").length, 0);
		});

		it("treats creation from empty as all-added", () => {
			const diff = engine.computeDiff("", "one\ntwo\n");
			assert.equal(linesOfType(diff, "removed").length, 0);
			assert.ok(linesOfType(diff, "added").length >= 2);
		});

		it("treats deletion to empty as all-removed", () => {
			const diff = engine.computeDiff("one\ntwo\n", "");
			assert.equal(linesOfType(diff, "added").length, 0);
			assert.ok(linesOfType(diff, "removed").length >= 2);
		});

		it("preserves unchanged lines as context", () => {
			const diff = engine.computeDiff("keep\nchange\nkeep2\n", "keep\nCHANGED\nkeep2\n");
			const context = linesOfType(diff, "context").map((l) => l.content);
			assert.ok(context.includes("keep"));
			assert.ok(context.includes("keep2"));
		});

		it("limits surrounding context to contextLines", () => {
			// 40 identical lines with one change in the middle: a small context
			// setting must not drag the whole file into the hunk.
			const before = Array.from({ length: 40 }, (_, i) => `line${i}`).join("\n");
			const after = before.replace("line20", "CHANGED");

			const tight = engine.computeDiff(before, after, { contextLines: 1 });
			const loose = engine.computeDiff(before, after, { contextLines: 10 });

			const count = (d) => d.hunks.reduce((n, h) => n + h.lines.length, 0);
			assert.ok(
				count(tight) < count(loose),
				"fewer context lines should yield a smaller hunk",
			);
			assert.ok(count(tight) < 40, "must not include the entire file");
		});

		it("splits distant changes into separate hunks", () => {
			const before = Array.from({ length: 60 }, (_, i) => `line${i}`).join("\n");
			const after = before
				.replace("line5", "FIRST")
				.replace("line50", "SECOND");

			const diff = engine.computeDiff(before, after, { contextLines: 2 });
			assert.ok(
				diff.hunks.length >= 2,
				"changes 45 lines apart belong to different hunks",
			);
		});

		it("can ignore whitespace-only differences", () => {
			const diff = engine.computeDiff("a\n  b\n", "a\nb\n", {
				ignoreWhitespace: true,
			});
			assert.equal(diff.hunks.length, 0);
		});

		it("reports whitespace differences when not ignoring them", () => {
			const diff = engine.computeDiff("a\n  b\n", "a\nb\n", {
				ignoreWhitespace: false,
			});
			assert.ok(diff.hunks.length > 0);
		});

		it("handles content with no trailing newline", () => {
			const diff = engine.computeDiff("a\nb", "a\nc");
			assert.equal(linesOfType(diff, "added")[0].content, "c");
		});

		it("handles a single line with no newline at all", () => {
			const diff = engine.computeDiff("before", "after");
			assert.ok(diff.hunks.length > 0);
		});
	});

	describe("areIdentical", () => {
		it("is true for equal content", () => {
			assert.equal(engine.areIdentical("x\ny\n", "x\ny\n"), true);
		});

		it("is false for differing content", () => {
			assert.equal(engine.areIdentical("x\n", "y\n"), false);
		});
	});

	describe("computeHash", () => {
		it("is stable for the same content", () => {
			assert.equal(engine.computeHash("content"), engine.computeHash("content"));
		});

		it("differs for different content", () => {
			assert.notEqual(engine.computeHash("a"), engine.computeHash("b"));
		});

		it("handles empty content", () => {
			assert.ok(engine.computeHash("").length > 0);
		});

		it("is sensitive to whitespace (used for version dedup)", () => {
			// FileTracker dedups versions by this hash, so a whitespace-only edit
			// must still register as a distinct version.
			assert.notEqual(engine.computeHash("a b"), engine.computeHash("a  b"));
		});
	});

	describe("getStats", () => {
		it("counts additions and deletions", () => {
			const diff = engine.computeDiff("a\nb\nc\n", "a\nX\nY\nc\n");
			const stats = engine.getStats(diff);

			assert.equal(typeof stats.additions, "number");
			assert.equal(typeof stats.deletions, "number");
			assert.ok(stats.additions > 0);
		});

		it("reports zeroes for an empty diff", () => {
			const stats = engine.getStats(engine.computeDiff("same\n", "same\n"));
			assert.equal(stats.additions, 0);
			assert.equal(stats.deletions, 0);
		});
	});

	describe("formatUnifiedDiff", () => {
		it("emits +/- prefixed lines", () => {
			const diff = engine.computeDiff("a\nb\n", "a\nc\n");
			const text = engine.formatUnifiedDiff(diff);

			assert.match(text, /^-b$/m);
			assert.match(text, /^\+c$/m);
		});
	});

	describe("robustness", () => {
		it("handles a large file without pathological blowup", () => {
			const before = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join("\n");
			const after = before.replace("line 1000", "CHANGED");

			const started = Date.now();
			const diff = engine.computeDiff(before, after);
			const elapsed = Date.now() - started;

			assert.ok(diff.hunks.length > 0);
			assert.ok(elapsed < 5000, `took ${elapsed}ms for 2000 lines`);
		});

		it("handles content containing regex metacharacters", () => {
			const diff = engine.computeDiff("a.*+?[]{}\n", "b.*+?[]{}\n");
			assert.ok(diff.hunks.length > 0);
		});
	});
});
