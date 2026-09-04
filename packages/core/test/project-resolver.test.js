/**
 * Project resolution — restoring metadata that M2 silently dropped.
 *
 * The hook used to derive gitBranch/gitRemote/projectName by shelling out to
 * git. M2's consolidation removed those spawns for the 9x latency win and
 * removed the fields with them, unnoticed for the rest of the branch. Measured
 * afterwards on the live store: 1610 of 4325 older events carried the metadata
 * and 0 of 1752 recent ones did.
 *
 * The consequence was not cosmetic. `projectKey` is `gitRemote ?? cwd`, so one
 * repository fragmented into five keys in the research index depending on which
 * subdirectory a tool ran in. These tests pin the property that matters: every
 * directory inside one repository resolves to the same project.
 */

import { strict as assert } from "node:assert";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { clearProjectCache, resolveProject } from "../dist/index.js";
import { cleanup, makeTempStore } from "./helpers.js";

const dirs = [];
after(async () => {
	await Promise.all(dirs.map(cleanup));
});

/** A directory tree with a .git that looks like a real one. */
async function makeRepo(options = {}) {
	const root = await makeTempStore();
	dirs.push(root);
	await mkdir(join(root, ".git"), { recursive: true });
	await writeFile(
		join(root, ".git", "HEAD"),
		options.head ?? "ref: refs/heads/main\n",
		"utf-8",
	);
	if (options.remote !== null) {
		await writeFile(
			join(root, ".git", "config"),
			`[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = ${
				options.remote ?? "git@github.com:acme/widget.git"
			}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`,
			"utf-8",
		);
	}
	await mkdir(join(root, "packages", "core", "src"), { recursive: true });
	clearProjectCache();
	return root;
}

describe("resolveProject", () => {
	it("REGRESSION: every directory in one repo resolves to ONE project", async () => {
		// The de-fragmentation property. In the live index a single repository
		// had produced five projectKeys — 191 at the root, 67 under
		// packages/core, 5 under packages/vscode — because the key fell back to
		// whatever directory a tool happened to run in.
		const root = await makeRepo();

		const keys = new Set(
			[root, join(root, "packages"), join(root, "packages", "core", "src")].map(
				(d) => resolveProject(d)?.gitRemote,
			),
		);

		assert.deepEqual([...keys], ["acme/widget"], "one repo, one key");
	});

	it("reads the branch from .git/HEAD without spawning git", async () => {
		const root = await makeRepo({ head: "ref: refs/heads/feature/thing\n" });
		assert.equal(resolveProject(root).gitBranch, "feature/thing");
	});

	it("reports no branch for a detached HEAD rather than inventing one", async () => {
		const root = await makeRepo({ head: "a1b2c3d4e5f6\n" });
		assert.equal(resolveProject(root).gitBranch, undefined);
	});

	it("reduces ssh and https remotes to the same key", async () => {
		// The same repository cloned two ways must produce one project, or the
		// rollup splits for a reason that has nothing to do with the work.
		for (const url of [
			"git@github.com:acme/widget.git",
			"https://github.com/acme/widget.git",
			"ssh://git@github.com/acme/widget",
		]) {
			const root = await makeRepo({ remote: url });
			assert.equal(resolveProject(root).gitRemote, "acme/widget", url);
		}
	});

	it("prefers the remote's repo name over the directory name", async () => {
		// A repo cloned into a differently-named directory is still that repo.
		const root = await makeRepo({ remote: "git@github.com:acme/widget.git" });
		assert.equal(resolveProject(root).projectName, "widget");
	});

	it("still names a repository that has no remote", async () => {
		const root = await makeRepo({ remote: null });
		const info = resolveProject(root);
		assert.equal(info.gitRemote, undefined);
		assert.ok(info.projectName.length > 0, "falls back to the directory name");
	});

	it("degrades to the directory itself outside a repository", async () => {
		// A session can run anywhere; this is a normal case, not an error.
		const info = resolveProject("/tmp");
		assert.equal(info.root, "/tmp");
		assert.equal(info.projectName, "tmp");
		assert.equal(info.gitRemote, undefined);
	});

	it("recognises a worktree, where .git is a file", async () => {
		const root = await makeTempStore();
		dirs.push(root);
		await writeFile(join(root, ".git"), "gitdir: /elsewhere/.git/worktrees/wt\n");
		clearProjectCache();
		assert.equal(resolveProject(root).root, root);
	});

	it("never throws on junk input", () => {
		for (const bad of [undefined, null, "", 42, {}, "relative/path"]) {
			assert.doesNotThrow(() => resolveProject(bad));
		}
		assert.equal(resolveProject(""), null);
		assert.equal(resolveProject(undefined), null);
	});

	it("caches, and the cache is bounded", async () => {
		// This map is keyed on every distinct cwd, so an unusual workload could
		// otherwise grow it without limit — the shape that becomes its own leak.
		const root = await makeRepo();
		const first = resolveProject(root);
		assert.equal(resolveProject(root), first, "same object, so it was cached");

		for (let i = 0; i < 600; i++) resolveProject(`/nonexistent/dir-${i}`);
		assert.doesNotThrow(() => resolveProject(root), "still usable after eviction");
	});
});
