/**
 * FileTracker tests, including the regression for:
 *   B3 - reverted changes were never archived, so they vanished from the UI
 *        and accumulated forever in the pending map
 */

import { strict as assert } from "node:assert";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { FileTracker, PersistenceStore } from "../dist/index.js";
import { cleanup, makeLog, makeTempStore } from "./helpers.js";

const tempDirs = [];

async function newTracker(options = {}) {
	const storagePath = await makeTempStore();
	tempDirs.push(storagePath);
	const persistence = new PersistenceStore({ basePath: storagePath });
	await persistence.initialize();
	const tracker = new FileTracker({
		workspaceRoot: storagePath,
		storagePath,
		persistence,
		...options,
	});
	return { tracker, storagePath };
}

/** Simulate one AI edit: capture before, write the file, then track. */
async function performEdit(tracker, filePath, sessionId, before, after) {
	await writeFile(filePath, before, "utf-8");
	await tracker.captureBeforeContent(filePath, sessionId, "Edit");
	await writeFile(filePath, after, "utf-8");
	return tracker.trackFromLog(
		makeLog({
			sessionId,
			tool: "Edit",
			file: filePath,
			hook: "PostToolUse",
			event: "PostToolUse",
		}),
	);
}

after(async () => {
	await Promise.all(tempDirs.map(cleanup));
});

describe("FileTracker", () => {
	describe("change tracking", () => {
		it("captures before/after content for an edit", async () => {
			const { tracker, storagePath } = await newTracker();
			const file = join(storagePath, "a.txt");

			const change = await performEdit(tracker, file, "s1", "old", "new");

			assert.ok(change, "a change should be produced");
			assert.equal(change.beforeContent, "old");
			assert.equal(change.afterContent, "new");
			assert.equal(change.status, "pending");
		});

		it("produces exactly one change per edit", async () => {
			const { tracker, storagePath } = await newTracker();
			const file = join(storagePath, "a.txt");

			await performEdit(tracker, file, "s1", "old", "new");

			const { changes } = await tracker.getPendingChanges();
			assert.equal(changes.length, 1);
		});

		it("does not create a change when content is unchanged", async () => {
			const { tracker, storagePath } = await newTracker();
			const file = join(storagePath, "a.txt");

			const change = await performEdit(tracker, file, "s1", "same", "same");
			assert.equal(change, null);
		});

		it("consumes the pending capture so a repeat track is a no-op", async () => {
			const { tracker, storagePath } = await newTracker();
			const file = join(storagePath, "a.txt");
			await performEdit(tracker, file, "s1", "old", "new");

			// A second PostToolUse for the same edit must not invent a change.
			const again = await tracker.trackFromLog(
				makeLog({
					sessionId: "s1",
					tool: "Edit",
					file,
					hook: "PostToolUse",
					event: "PostToolUse",
				}),
			);

			assert.equal(again, null, "no second change for the same edit");
			const { changes } = await tracker.getPendingChanges();
			assert.equal(changes.length, 1);
		});

		it("ignores tools that do not modify files", async () => {
			const { tracker, storagePath } = await newTracker();
			const change = await tracker.trackFromLog(
				makeLog({
					sessionId: "s1",
					tool: "Read",
					file: join(storagePath, "a.txt"),
					event: "PostToolUse",
				}),
			);
			assert.equal(change, null);
		});
	});

	describe("resolving changes", () => {
		it("keep archives the change and clears it from pending", async () => {
			const { tracker, storagePath } = await newTracker();
			const file = join(storagePath, "a.txt");
			const change = await performEdit(tracker, file, "s1", "old", "new");

			await tracker.keepChange(change.id);

			assert.equal((await tracker.getPendingChanges()).changes.length, 0);
			const archived = await tracker.getArchivedChanges();
			assert.equal(archived.changes.length, 1);
			assert.equal(archived.changes[0].resolution, "kept");
			// Keeping must not touch the file on disk.
			assert.equal(await readFile(file, "utf-8"), "new");
		});

		it("REGRESSION B3: revert archives the change instead of orphaning it", async () => {
			const { tracker, storagePath } = await newTracker();
			const file = join(storagePath, "a.txt");
			const change = await performEdit(tracker, file, "s1", "old", "new");

			await tracker.revertChange(change.id);

			// The file goes back to its pre-edit content.
			assert.equal(await readFile(file, "utf-8"), "old");
			// It is gone from pending...
			assert.equal((await tracker.getPendingChanges()).changes.length, 0);
			// ...and present in the archive, marked reverted.
			const archived = await tracker.getArchivedChanges();
			assert.equal(archived.changes.length, 1);
			assert.equal(archived.changes[0].resolution, "reverted");
		});

		it("filters the archive by resolution", async () => {
			const { tracker, storagePath } = await newTracker();
			const keptFile = join(storagePath, "kept.txt");
			const revertedFile = join(storagePath, "reverted.txt");

			const kept = await performEdit(tracker, keptFile, "s1", "a", "b");
			const reverted = await performEdit(tracker, revertedFile, "s1", "a", "b");
			await tracker.keepChange(kept.id);
			await tracker.revertChange(reverted.id);

			const onlyKept = await tracker.getArchivedChanges({
				filter: { resolution: "kept" },
			});
			const onlyReverted = await tracker.getArchivedChanges({
				filter: { resolution: "reverted" },
			});

			assert.equal(onlyKept.total, 1);
			assert.equal(onlyReverted.total, 1);
			assert.equal(onlyKept.changes[0].filePath, keptFile);
			assert.equal(onlyReverted.changes[0].filePath, revertedFile);
		});

		it("restores an archived change back onto disk", async () => {
			const { tracker, storagePath } = await newTracker();
			const file = join(storagePath, "a.txt");
			const change = await performEdit(tracker, file, "s1", "old", "new");
			await tracker.revertChange(change.id);
			assert.equal(await readFile(file, "utf-8"), "old");

			await tracker.restoreFromArchive(change.id);
			assert.equal(await readFile(file, "utf-8"), "new");
		});
	});

	describe("version history", () => {
		it("records a version per distinct content", async () => {
			const { tracker, storagePath } = await newTracker();
			const file = join(storagePath, "a.txt");

			await performEdit(tracker, file, "s1", "v1", "v2");
			await performEdit(tracker, file, "s1", "v2", "v3");

			const history = await tracker.getVersions(file);
			assert.equal(history.versionCount, 2);
		});

		it("does not create a duplicate version for identical content", async () => {
			const { tracker, storagePath } = await newTracker();
			const file = join(storagePath, "a.txt");

			await tracker.addVersion(file, "same", { sessionId: "s1" });
			await tracker.addVersion(file, "same", { sessionId: "s1" });

			assert.equal((await tracker.getVersions(file)).versionCount, 1);
		});

		it("retrieves the content of a specific version", async () => {
			const { tracker, storagePath } = await newTracker();
			const file = join(storagePath, "a.txt");
			await tracker.addVersion(file, "first", { sessionId: "s1" });
			await tracker.addVersion(file, "second", { sessionId: "s1" });

			const v1 = await tracker.getVersionContent(file, 1);
			assert.equal(v1.content, "first");
		});

		it("diffs two versions of a file", async () => {
			const { tracker, storagePath } = await newTracker();
			const file = join(storagePath, "a.txt");
			await tracker.addVersion(file, "line one\n", { sessionId: "s1" });
			await tracker.addVersion(file, "line two\n", { sessionId: "s1" });

			const result = await tracker.compareVersions(file, 1, 2);
			assert.ok(result, "comparison should succeed");
			assert.ok(result.diff.hunks.length > 0, "should report a difference");
		});

		it("trims history to maxVersionsPerFile", async () => {
			const { tracker, storagePath } = await newTracker({
				maxVersionsPerFile: 3,
			});
			const file = join(storagePath, "a.txt");
			for (let i = 0; i < 6; i++) {
				await tracker.addVersion(file, `content ${i}`, { sessionId: "s1" });
			}

			const history = await tracker.getVersions(file);
			assert.equal(history.versions.length, 3, "only the newest are retained");
			assert.equal(
				history.versionCount,
				3,
				"versionCount reports what is retained",
			);
			assert.equal(
				history.lastVersionNumber,
				6,
				"numbering keeps climbing so numbers are never reused",
			);
		});
	});

	describe("persistence", () => {
		it("reloads pending changes from disk", async () => {
			const { tracker, storagePath } = await newTracker();
			const file = join(storagePath, "a.txt");
			await performEdit(tracker, file, "s1", "old", "new");

			const persistence = new PersistenceStore({ basePath: storagePath });
			await persistence.initialize();
			const reloaded = new FileTracker({
				workspaceRoot: storagePath,
				storagePath,
				persistence,
			});
			await reloaded.load();

			assert.equal((await reloaded.getPendingChanges()).changes.length, 1);
		});
	});
});
