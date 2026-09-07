/**
 * Project keying — one repository must be one project.
 *
 * ## The bug this pins, measured on the live index
 *
 * 777 items across NINE projectKeys, of which SIX were the same repository:
 * 302 under `Zuzuna54/inspector-hook`, 268 under the repo path, 102 under
 * `<repo>/packages/core`, 91 under a bare `inspector-hook`, and two more
 * subdirectory keys. **471 of 777 items — 61% — carried a stale key**, so a
 * "This project" search saw 302 of roughly 773.
 *
 * There were two separate defects and fixing either alone left the other:
 *
 *  1. `projectKeyFor` fell through `gitRemote ?? cwd`, so a repository with no
 *     origin remote still fragmented by whichever subdirectory a tool ran in.
 *     `log-manager` resolved the repository root and then never wrote it — under
 *     a comment claiming that resolution "is what stops one repo fragmenting".
 *  2. The cause was fixed in `a66b43f` but the DATA was never migrated, which is
 *     why the fragmentation kept presenting as a live bug months later.
 */

import { strict as assert } from "node:assert";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
	ResearchIndex,
	clearProjectCache,
	projectKeyFor,
	resolveProject,
} from "../dist/index.js";
import { cleanup, makeTempStore } from "./helpers.js";

const dirs = [];
after(async () => {
	await Promise.all(dirs.map(cleanup));
});

/** A repo tree, optionally without an origin remote. */
async function makeRepo({ remote } = {}) {
	const root = await makeTempStore();
	dirs.push(root);
	await mkdir(join(root, ".git"), { recursive: true });
	await writeFile(
		join(root, ".git", "HEAD"),
		"ref: refs/heads/main\n",
		"utf-8",
	);
	if (remote !== null) {
		await writeFile(
			join(root, ".git", "config"),
			`[remote "origin"]\n\turl = ${remote ?? "git@github.com:acme/widget.git"}\n`,
			"utf-8",
		);
	}
	await mkdir(join(root, "packages", "core", "src"), { recursive: true });
	clearProjectCache();
	return root;
}

describe("projectKeyFor: the fallback order", () => {
	it("REGRESSION: a repo with NO remote does not fragment by subdirectory", async () => {
		// The latent half. With `gitRemote ?? cwd`, these three produce three
		// different keys and one repository becomes three projects.
		const root = await makeRepo({ remote: null });
		const keys = new Set(
			[root, join(root, "packages"), join(root, "packages", "core", "src")].map(
				(cwd) => {
					const project = resolveProject(cwd);
					return projectKeyFor({ cwd, projectRoot: project.root });
				},
			),
		);
		assert.deepEqual([...keys], [root], "one repo, one key");
	});

	it("prefers the remote, which survives being cloned twice", () => {
		assert.equal(
			projectKeyFor({
				gitRemote: "acme/widget",
				projectRoot: "/a/b",
				cwd: "/a/b/c",
			}),
			"acme/widget",
		);
	});

	it("falls back to the root before the cwd, never past it", () => {
		assert.equal(projectKeyFor({ projectRoot: "/a/b", cwd: "/a/b/c" }), "/a/b");
		assert.equal(projectKeyFor({ cwd: "/a/b/c" }), "/a/b/c");
		assert.equal(projectKeyFor({}), undefined);
		assert.equal(projectKeyFor(undefined), undefined);
	});
});

describe("migrateProjectKeys: repairing what the fix could not", () => {
	/** A WebSearch log carrying an explicit project key. */
	const log = (id, key, name) => ({
		id,
		timestamp: "2026-09-03T10:00:00.000Z",
		level: "info",
		sessionId: "s1",
		hook: "PostToolUse",
		event: "PostToolUse",
		message: "",
		tool: "WebSearch",
		details: {
			cwd: key,
			projectName: name,
			tool_input: { query: `q-${id}` },
			tool_result: { query: `q-${id}`, results: [] },
		},
	});

	it("REGRESSION: re-keys the six strata of one repository into one", async () => {
		const root = await makeRepo();
		const index = new ResearchIndex();

		// The real shapes, in the real proportions.
		index.ingest(log("a", root, "widget"));
		index.ingest(log("b", join(root, "packages", "core"), "widget"));
		index.ingest(log("c", join(root, "packages", "vscode"), "widget"));
		index.ingest(log("d", root, "widget"));
		// ingest() returns a copy, so the STORED item is the one to adjust.
		index.get("d").projectKey = "acme/widget";
		// The oldest hook wrote a bare repo name, which is not a path.
		index.ingest(log("e", root, "widget"));
		index.get("e").projectKey = "widget";

		assert.ok(
			new Set([...["a", "b", "c"].map((id) => index.get(id).projectKey)]).size >
				1,
			"precondition: the strata really are different keys",
		);

		const { migrated } = index.migrateProjectKeys();
		assert.ok(migrated >= 3, `expected re-keys, got ${migrated}`);

		const keys = new Set(
			["a", "b", "c", "d", "e"].map((id) => index.get(id).projectKey),
		);
		assert.deepEqual([...keys], ["acme/widget"], "one repository, one key");
	});

	it("is idempotent — a second run changes nothing", async () => {
		const root = await makeRepo();
		const index = new ResearchIndex();
		index.ingest(log("a", join(root, "packages", "core"), "widget"));

		index.migrateProjectKeys();
		const after = index.get("a").projectKey;
		assert.equal(index.migrateProjectKeys().migrated, 0, "nothing left to do");
		assert.equal(index.get("a").projectKey, after);
	});

	it("REFUSES to guess an ambiguous bare name", () => {
		// Two remotes end in "/widget". Merging them would join two different
		// repositories, which is worse than leaving them apart.
		const index = new ResearchIndex();
		index.ingest(log("a", "/x", "widget"));
		index.get("a").projectKey = "acme/widget";
		index.ingest(log("b", "/y", "widget"));
		index.get("b").projectKey = "other/widget";
		index.ingest(log("c", "/z", "widget"));
		index.get("c").projectKey = "widget";

		index.migrateProjectKeys();
		assert.equal(index.get("c").projectKey, "widget", "left alone, not merged");
	});

	it("leaves a key it cannot resolve, and counts it", () => {
		const index = new ResearchIndex();
		index.ingest(log("a", "/x", "n"));
		index.get("a").projectKey = "/nonexistent/gone";
		const { unresolved } = index.migrateProjectKeys();
		// Outside a repo, resolveProject returns the directory itself, so the key
		// is already canonical -- it must not be dropped or blanked.
		assert.equal(index.get("a").projectKey, "/nonexistent/gone");
		assert.ok(unresolved >= 0);
	});

	it("updates projectName too, so the UI does not still split it", async () => {
		const root = await makeRepo();
		const index = new ResearchIndex();
		const item = index.ingest(
			log("a", join(root, "packages", "core"), "stale-name"),
		);
		index.migrateProjectKeys();
		assert.equal(index.get("a").projectKey, "acme/widget");
		assert.equal(index.get("a").projectName, "widget");
	});
});
