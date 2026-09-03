/**
 * Archived view tests - its first of any kind. Regressions for four shipped
 * defects:
 *   - the diff preview could not appear by either route
 *   - a failed diff sat on "Loading..." with no error path
 *   - file-level Restore restored only fileChanges[0]
 *   - restore-archived-result had no handler, so the list never refreshed
 */

import { strict as assert } from "node:assert";
import { beforeEach, describe, it } from "node:test";

import { installGlobals, readMedia } from "./harness.js";

/** Load the Archived view with a recording API stub. */
function loadArchived({ confirmAnswer = true } = {}) {
	const restored = [];
	const refreshed = [];
	installGlobals({
		confirm: () => confirmAnswer,
		API: {
			restoreArchived: (id) => restored.push(id),
			getArchivedChanges: () => refreshed.push("archived"),
			getTrackedFiles: () => refreshed.push("tracked"),
			getDiff: () => {},
		},
	});
	// biome-ignore lint/security/noGlobalEval: classic script, see harness.js
	eval(readMedia("scripts/views/archived.js"));
	const view = globalThis.window.ArchivedView;
	view.renderSessionAccordions = () => {}; // no DOM in this harness
	return { view, restored, refreshed };
}

describe("archived diff routing", () => {
	it("no longer listens on a state key nothing writes", () => {
		// The view subscribed to a State key for the current diff that was never
		// set, and api.js routed diff-result only to FileChangesView - so the
		// preview was unreachable by both paths at once.
		const src = readMedia("scripts/views/archived.js");
		assert.ok(
			!/State\.subscribe\(\s*['"]currentDiff['"]/.test(src),
			"the dead subscription must be gone",
		);
	});

	it("exposes the handlers the router calls by name", () => {
		const { view } = loadArchived();
		assert.equal(typeof view.handleDiffResult, "function");
		assert.equal(typeof view.handleDiffError, "function");
	});

	it("accepts a bare diff payload", () => {
		const { view } = loadArchived();
		view.handleDiffResult({ additions: 3, deletions: 1, hunks: [] });
		assert.equal(view._currentDiff.additions, 3);
	});

	it("accepts a payload that wraps the diff", () => {
		const { view } = loadArchived();
		view.handleDiffResult({ diff: { additions: 9, hunks: [] } });
		assert.equal(view._currentDiff.additions, 9);
	});

	it("surfaces a diff error instead of leaving it loading forever", () => {
		const { view } = loadArchived();
		view.handleDiffResult({ additions: 1, hunks: [] });
		view.handleDiffError({ error: "could not read version" });
		assert.equal(view._currentDiff, null);
		assert.equal(view._diffError, "could not read version");
	});
});

describe("archived file-level restore", () => {
	const CHANGES = [
		{ id: "c1", sessionId: "s1", filePath: "/a.ts", resolution: "reverted" },
		{ id: "c2", sessionId: "s1", filePath: "/a.ts", resolution: "reverted" },
		{ id: "c3", sessionId: "s1", filePath: "/a.ts", resolution: "reverted" },
		{ id: "d1", sessionId: "s1", filePath: "/other.ts", resolution: "reverted" },
		{ id: "e1", sessionId: "s2", filePath: "/a.ts", resolution: "reverted" },
	];

	let ctx;
	beforeEach(() => {
		ctx = loadArchived();
		globalThis.State.archivedChanges = CHANGES;
	});

	it("finds every change grouped under one file row", () => {
		const found = ctx.view._changesForFileKey("s1:/a.ts");
		assert.equal(found.length, 3);
	});

	it("does not reach into another file", () => {
		const found = ctx.view._changesForFileKey("s1:/a.ts");
		assert.ok(!found.some((c) => c.filePath === "/other.ts"));
	});

	it("does not reach into another session with the same path", () => {
		const found = ctx.view._changesForFileKey("s1:/a.ts");
		assert.ok(!found.some((c) => c.sessionId === "s2"));
	});

	it("restores all of them, not just the first", () => {
		// The button carried data-change-id = fileChanges[0].id, so Restore
		// re-applied one change and silently left the rest reverted - while the
		// row then read as restored, which is worse than failing outright.
		ctx.view._confirmRestoreFile("s1:/a.ts");
		assert.deepEqual(ctx.restored, ["c1", "c2", "c3"]);
	});

	it("restores nothing when the confirm is declined", () => {
		const declined = loadArchived({ confirmAnswer: false });
		globalThis.State.archivedChanges = CHANGES;
		declined.view._confirmRestoreFile("s1:/a.ts");
		assert.deepEqual(declined.restored, []);
	});

	it("does nothing for a file key with no changes", () => {
		ctx.view._confirmRestoreFile("nope:/missing.ts");
		assert.deepEqual(ctx.restored, []);
	});
});

describe("api message routing", () => {
	const api = readMedia("scripts/api.js");

	it("routes a diff to the archived view when it is active", () => {
		assert.match(api, /State\.currentView === "archived"/);
	});

	it("handles the results that used to have no case at all", () => {
		// panel.ts sent these; api.js listened for neither, so nothing refreshed
		// and a restored change kept showing as archived until the panel reopened.
		for (const type of ["restore-archived-result", "restore-result"]) {
			assert.ok(api.includes(`case "${type}"`), `missing case ${type}`);
		}
	});

	it("defines the version-content call history.js has always made", () => {
		// API.getVersionContent did not exist; opening a version threw
		// "is not a function".
		assert.match(api, /getVersionContent\(filePath, versionNumber\)/);
		assert.ok(api.includes('case "version-content"'));
	});
});
