/**
 * The client half of the global project filter (P9).
 *
 * Two properties, and both exist because getting them wrong produces a view
 * that looks correct and is short:
 *
 * 1. **Three-valued.** A record the filter cannot place is KEPT and labelled,
 *    never dropped. Measured on the real store, a boolean hid 0-of-17 memory
 *    files and 0-of-238 file changes and reported it as "nothing matched".
 * 2. **Exact set membership, never prefix matching.** The core resolves paths
 *    through the filesystem and ships what it resolved. A prefix rule looks
 *    equivalent and is not — it let a session run from the home directory
 *    absorb every project on the machine.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { installGlobals, readMedia } from "./harness.js";

const REPO = "/Users/giorgobg/Desktop/inspector_hook/inspector-hook";
const REMOTE = "Zuzuna54/inspector-hook";
const SLUG = "-Users-giorgobg-Desktop-inspector-hook-inspector-hook";

function loadFilter(overrides = {}) {
	installGlobals(overrides);
	// biome-ignore lint/security/noGlobalEval: classic script, see harness.js
	eval(readMedia("scripts/shared/project-filter.js"));
	return globalThis.window.ProjectFilter;
}

const identity = (over = {}) => ({
	id: REPO,
	name: "inspector-hook",
	root: REPO,
	gitRemote: REMOTE,
	slug: SLUG,
	paths: [REPO, `${REPO}/packages/core`],
	counts: { sessions: 4, memory: 1, research: 1, changes: 205 },
	...over,
});

describe("three-valued matching", () => {
	it("keeps a record that carries no identity at all", () => {
		// The whole point. `out` here hides it.
		const f = loadFilter();
		assert.equal(f.match(identity(), {}), "unknown");
		assert.equal(f.match(identity(), { path: undefined }), "unknown");
	});

	it("matches a path the core resolved into this project", () => {
		const f = loadFilter();
		assert.equal(f.match(identity(), { path: REPO }), "in");
		assert.equal(f.match(identity(), { path: `${REPO}/packages/core` }), "in");
	});

	it("matches the git remote and the memory slug", () => {
		const f = loadFilter();
		assert.equal(f.match(identity(), { projectKey: REMOTE }), "in");
		assert.equal(f.match(identity(), { slug: SLUG }), "in");
	});

	it("says out for a record that names a different project", () => {
		const f = loadFilter();
		assert.equal(
			f.match(identity(), { path: "/Users/giorgobg/Desktop/Ordex" }),
			"out",
		);
		assert.equal(
			f.match(identity(), { slug: "-Users-giorgobg-Desktop-Ordex" }),
			"out",
		);
	});

	it("does NOT prefix-match, so a parent cannot absorb its children", () => {
		// The bug this rule exists for. A session run from the home directory
		// has /Users/<me> as its root, which is a prefix of every project on the
		// machine; a prefix rule collapsed the whole repo into one project.
		const f = loadFilter();
		const home = {
			id: "/Users/giorgobg",
			name: "giorgobg",
			root: "/Users/giorgobg",
			paths: ["/Users/giorgobg"],
			counts: {},
		};
		assert.equal(f.match(home, { path: REPO }), "out");
		assert.equal(f.match(home, { path: "/Users/giorgobg" }), "in");
	});

	it("matches everything when no project is selected", () => {
		const f = loadFilter();
		assert.equal(f.match(null, { path: "/anywhere" }), "in");
		assert.equal(f.match(null, {}), "in");
	});
});

describe("splitting a list", () => {
	it("returns the matches AND the unplaceable, separately", () => {
		// A caller given only the matches could not tell the reader that some
		// records were unattributable — the difference between "4 sessions" and
		// "4 sessions, and 6 we cannot place".
		const f = loadFilter();
		const records = [
			{ id: "a", dir: REPO },
			{ id: "b", dir: "/Users/giorgobg/Desktop/Ordex" },
			{ id: "c", dir: undefined },
		];
		const { included, unknown } = f.split(identity(), records, (r) => ({
			path: r.dir,
		}));
		assert.deepEqual(
			included.map((r) => r.id),
			["a"],
		);
		assert.deepEqual(
			unknown.map((r) => r.id),
			["c"],
		);
	});

	it("survives an empty or missing list", () => {
		const f = loadFilter();
		assert.deepEqual(f.split(identity(), []), { included: [], unknown: [] });
		assert.deepEqual(f.split(identity(), null), { included: [], unknown: [] });
	});
});

describe("the selected identity", () => {
	it("is null when nothing is chosen, which means every project", () => {
		const f = loadFilter({
			State: { projectFilter: { projects: [identity()], selectedId: null } },
		});
		assert.equal(f.selected(), null);
	});

	it("resolves the chosen id to its full identity", () => {
		const f = loadFilter({
			State: { projectFilter: { projects: [identity()], selectedId: REPO } },
		});
		assert.equal(f.selected()?.gitRemote, REMOTE);
	});

	it("is null when the chosen id is no longer in the list", () => {
		// A stale selection must not scope every view to something arbitrary.
		const f = loadFilter({
			State: { projectFilter: { projects: [identity()], selectedId: "/gone" } },
		});
		assert.equal(f.selected(), null);
	});

	it("survives a state slice that has not loaded yet", () => {
		const f = loadFilter({ State: { projectFilter: undefined } });
		assert.equal(f.selected(), null);
	});
});
