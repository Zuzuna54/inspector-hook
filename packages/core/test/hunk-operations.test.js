/**
 * Per-hunk keep and revert.
 *
 * ## The bug this replaces, which was destructive rather than inert
 *
 * `panel.ts` handled `keep-hunk` by calling `keepChange` and `revert-hunk` by
 * calling `revertChange` — the WHOLE change, every hunk of it — and reported
 * the outcome as `keep-hunk-result`. Clicking "revert this hunk" on a
 * three-hunk change reverted all three and rewrote the file to its original
 * content. The handler's own comment said "for now, keep the whole change".
 *
 * So the load-bearing test here is not "does reverting a hunk work" but "does
 * reverting ONE hunk leave the others alone".
 */

import { strict as assert } from "node:assert";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { FileTracker } from "../dist/index.js";
import { cleanup, makeTempStore } from "./helpers.js";

const dirs = [];
after(async () => {
	await Promise.all(dirs.map(cleanup));
});

// Twenty lines, edited at the first and last.
//
// The gap has to exceed twice the diff engine's context window or the two
// edits merge into ONE hunk -- a seven-line file with edits at lines 1 and 7
// produced a single hunk, which makes "leaves the other alone" untestable.
const LINES = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
const BEFORE = LINES.join("\n");
const AFTER = ["FIRST", ...LINES.slice(1, 19), "LAST"].join("\n");

/**
 * A tracker holding one change with two well-separated hunks.
 *
 * Separated deliberately: adjacent edits collapse into a single hunk, which
 * would make "leaves the other alone" untestable.
 */
async function makeChange() {
	const root = await makeTempStore();
	dirs.push(root);
	const filePath = join(root, "file.txt");
	await writeFile(filePath, AFTER, "utf-8");

	const tracker = new FileTracker({ workspaceRoot: root, storagePath: root });
	// trackChange is POSITIONAL: (filePath, sessionId, before, after, tool).
	const change = await tracker.trackChange(filePath, "s1", BEFORE, AFTER, "Edit");
	return { tracker, change, filePath };
}

describe("hunks: resolving one leaves the others alone", () => {
	it("precondition: the fixture really has two hunks", async () => {
		const { tracker, change } = await makeChange();
		const diff = await tracker.getDiff(change.id);
		assert.equal(diff.hunks.length, 2, "two separated edits, two hunks");
	});

	it("REGRESSION: reverting one hunk does NOT revert the whole change", async () => {
		// The destructive bug. Reverting hunk 0 must restore "one" and leave
		// "SEVEN" — the old path produced the entire BEFORE content.
		const { tracker, change, filePath } = await makeChange();

		const result = await tracker.resolveHunk(change.id, 0, "revert");
		assert.equal(result.success, true, result.reason);

		const onDisk = await readFile(filePath, "utf-8");
		assert.notEqual(onDisk, BEFORE, "the WHOLE change must not be reverted");
		assert.match(onDisk, /^line 1\n/, "hunk 0 was reverted");
		assert.match(onDisk, /LAST$/, "hunk 1 was left alone");
	});

	it("the reverted hunk disappears from the diff and the other remains", async () => {
		const { tracker, change } = await makeChange();
		await tracker.resolveHunk(change.id, 0, "revert");
		const diff = await tracker.getDiff(change.id);
		assert.equal(diff.hunks.length, 1, "one hunk resolved, one to go");
	});

	it("keeping a hunk changes no file, and still shrinks the diff", async () => {
		// Keeping means the file already holds it; moving beforeContent forward
		// is what removes it from the pending diff.
		const { tracker, change, filePath } = await makeChange();
		const before = await readFile(filePath, "utf-8");

		const result = await tracker.resolveHunk(change.id, 0, "keep");
		assert.equal(result.success, true, result.reason);
		assert.equal(await readFile(filePath, "utf-8"), before, "no write on keep");
		assert.equal((await tracker.getDiff(change.id)).hunks.length, 1);
	});

	it("resolving every hunk resolves the change", async () => {
		const { tracker, change } = await makeChange();
		const first = await tracker.resolveHunk(change.id, 0, "keep");
		assert.equal(first.changeResolved, false);
		assert.equal(first.remainingHunks, 1);

		const second = await tracker.resolveHunk(change.id, 0, "keep");
		assert.equal(second.remainingHunks, 0);
		assert.equal(second.changeResolved, true);
	});

	it("records a version when a revert writes the file", async () => {
		const { tracker, change } = await makeChange();
		const result = await tracker.resolveHunk(change.id, 0, "revert");
		assert.equal(typeof result.newVersionNumber, "number");
	});
});

describe("hunks: it refuses rather than corrupting", () => {
	it("REGRESSION: refuses when the file on disk has moved on", async () => {
		// Splicing by line number into a file that changed since capture would
		// mangle it. A refusal is recoverable; a corrupted file is not.
		const { tracker, change, filePath } = await makeChange();
		await writeFile(filePath, "someone else rewrote this entirely\n", "utf-8");

		const result = await tracker.resolveHunk(change.id, 0, "revert");
		assert.equal(result.success, false);
		assert.match(result.reason, /no longer matches/);
		assert.equal(
			await readFile(filePath, "utf-8"),
			"someone else rewrote this entirely\n",
			"the file must be untouched",
		);
	});

	it("rejects an out-of-range hunk index with the count", async () => {
		const { tracker, change } = await makeChange();
		const result = await tracker.resolveHunk(change.id, 99, "revert");
		assert.equal(result.success, false);
		assert.match(result.reason, /does not exist/);
		assert.match(result.reason, /has 2/, "says how many there are");
	});

	it("rejects an unknown change", async () => {
		const { tracker } = await makeChange();
		const result = await tracker.resolveHunk("nope", 0, "revert");
		assert.equal(result.success, false);
		assert.match(result.reason, /not found/);
	});

	it("preserves a trailing newline through the splice", async () => {
		// split/join on "\n" round-trips it; a regex splice would not.
		const root = await makeTempStore();
		dirs.push(root);
		const filePath = join(root, "nl.txt");
		const before = "a\nb\nc\n";
		const afterText = "A\nb\nc\n";
		await writeFile(filePath, afterText, "utf-8");

		const tracker = new FileTracker({ workspaceRoot: root, storagePath: root });
		const change = await tracker.trackChange(
			filePath,
			"s1",
			before,
			afterText,
			"Edit",
		);
		await tracker.resolveHunk(change.id, 0, "revert");
		assert.equal(await readFile(filePath, "utf-8"), before);
	});
});
