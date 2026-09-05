/**
 * Archived view tests - its first of any kind. Regressions for four shipped
 * defects:
 *   - the diff preview could not appear by either route
 *   - a failed diff sat on "Loading..." with no error path
 *   - file-level Restore restored only fileChanges[0]
 *   - restore-archived-result had no handler, so the list never refreshed
 */

import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * panel.ts plus the handler modules it delegates to.
 *
 * The diff cases moved to src/messages/ when panel.ts was split. Reading only
 * panel.ts would silently stop checking anything -- the same vacuous-guard
 * shape these tests exist to catch.
 */
function panelSources() {
	const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
	const files = [join(srcDir, "panel.ts")];
	for (const entry of readdirSync(join(srcDir, "messages"), { withFileTypes: true })) {
		if (entry.isFile() && entry.name.endsWith(".ts")) {
			files.push(join(srcDir, "messages", entry.name));
		}
	}
	return files.map((f) => readFileSync(f, "utf8")).join("\n");
}


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
	// api.js plus its sender mixins -- the senders moved into ./api/ when the file
// was split, and reading only api.js would quietly stop checking them.
const api = [
	"scripts/api.js",
	"scripts/api/memory-senders.js",
	"scripts/api/history-senders.js",
].map((f) => readMedia(f)).join("\n");

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

describe("archived diffs reach the archive, not the pending map", () => {
	// 155 of 155 archived diffs returned nothing, silently, for the life of the
	// view. Two independent causes, both fixed here:
	//
	//  1. The view asked `get-diff`, which routes to fileChanges.getDiff and
	//     reads `this.changes`. Archived changes live in `this.archived`, so
	//     the lookup was null by construction. The correct method existed on
	//     both sides and nothing dispatched to it.
	//  2. panel.ts spread that null: `{ ...diff, changeId }` yields a truthy
	//     `{ changeId }`, so the error branch could never fire and a missing
	//     change rendered as a well-formed diff with no hunks -- which is
	//     indistinguishable from a file that genuinely did not change.
	//
	// The second is why the first survived: the failure had no symptom.

	it("the view requests the archived diff", () => {
		const src = readMedia("scripts/views/archived.js");
		assert.match(src, /API\.getArchivedDiff\(changeId\)/, "still asking the pending map");
		assert.ok(
			!/API\.getDiff\(changeId\)/.test(src),
			"still calls the pending lookup, which returns null for every archived change",
		);
	});

	it("api.js can express the request", () => {
		const src = readMedia("scripts/api.js");
		assert.match(src, /getArchivedDiff\(changeId\)/);
		assert.match(src, /send\("get-archived-diff"/);
	});

	it("panel.ts dispatches it to the archive lookup", () => {
		const src = panelSources();
		assert.match(src, /case "get-archived-diff"/, "no handler for the command");
		assert.match(
			src,
			/coreBridge\.getArchivedDiff\(changeId\)/,
			"the case exists but does not call the archive lookup",
		);
	});

	it("a null lookup is reported as an error, not as an empty diff", () => {
		const src = panelSources()
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/^\s*\/\/.*$/gm, "");
		assert.match(
			src,
			/if \(!diff\) \{[\s\S]*?type: "diff-error"/,
			"a null diff can still be spread into a truthy, empty-looking result",
		);
	});
});
