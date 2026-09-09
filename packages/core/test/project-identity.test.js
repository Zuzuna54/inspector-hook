/**
 * Project identity across three spaces (P9).
 *
 * The measured problem, on this machine:
 *
 *   sessions  /Users/g/Desktop/inspector_hook/inspector-hook/packages/core
 *   memory    -Users-giorgobg-Desktop-inspector-hook-inspector-hook
 *   research  Zuzuna54/inspector-hook
 *
 * Three strings with no substring in common, all naming one project.
 *
 * Two properties carry this module:
 *
 * 1. **`unknown` is never `out`.** A boolean filter hid 0-of-17 memory files
 *    and 0-of-238 file changes and reported it as "nothing matched".
 * 2. **Slug derivation goes one way.** `-`→`/` produced a non-existent
 *    directory for 2 of 3 real slugs, so a slug is compared against a slug
 *    computed from a known path, never parsed back into one.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
	buildProjects,
	findProject,
	matches,
	slugForPath,
	total,
} from "../dist/index.js";

const REPO = "/Users/giorgobg/Desktop/inspector_hook/inspector-hook";
const REMOTE = "Zuzuna54/inspector-hook";
const SLUG = "-Users-giorgobg-Desktop-inspector-hook-inspector-hook";

const identity = (over = {}) => ({
	id: REPO,
	name: "inspector-hook",
	root: REPO,
	gitRemote: REMOTE,
	slug: SLUG,
	counts: { sessions: 1, memory: 0, research: 0, changes: 0 },
	...over,
});

describe("slug derivation", () => {
	it("turns both / and _ into -", () => {
		// The real rule, and the reason the reverse is impossible.
		assert.equal(slugForPath(REPO), SLUG);
		assert.equal(slugForPath("/a/b_c"), "-a-b-c");
		assert.equal(slugForPath("/a/b-c"), "-a-b-c");
	});

	it("is lossy, which is why nothing parses a slug back into a path", () => {
		// Three different paths, one slug. Any reverse mapping picks one and is
		// wrong two thirds of the time — measured: the naive reverse produced a
		// non-existent directory for 2 of 3 slugs on this machine.
		assert.equal(slugForPath("/a/b_c"), slugForPath("/a/b-c"));
	});
});

describe("matching is three-valued", () => {
	it("returns unknown when the record offers nothing to decide on", () => {
		// The whole point. `out` here would hide the record.
		assert.equal(matches(identity(), {}), "unknown");
		assert.equal(
			matches(identity(), { path: undefined, projectKey: undefined }),
			"unknown",
		);
	});

	it("matches a session path, including a subdirectory of the repo", () => {
		// One repo must not become one project per subdirectory a tool ran in.
		assert.equal(matches(identity(), { path: REPO }), "in");
		assert.equal(matches(identity(), { path: `${REPO}/packages/core` }), "in");
	});

	it("matches the research index's git remote", () => {
		assert.equal(matches(identity(), { projectKey: REMOTE }), "in");
	});

	it("matches a memory slug", () => {
		assert.equal(matches(identity(), { slug: SLUG }), "in");
	});

	it("matches a memory slug against a project known only by its path", () => {
		// The slug is computed FROM the root, one direction only.
		const pathOnly = identity({ slug: undefined, gitRemote: undefined });
		assert.equal(matches(pathOnly, { slug: SLUG }), "in");
	});

	it("says out when the record names a different project", () => {
		// Three-valued is not "include everything": a known non-match is out.
		assert.equal(
			matches(identity(), { path: "/Users/giorgobg/Desktop/Ordex" }),
			"out",
		);
		assert.equal(
			matches(identity(), { projectKey: "someone/other-repo" }),
			"out",
		);
		assert.equal(
			matches(identity(), { slug: "-Users-giorgobg-Desktop-Ordex" }),
			"out",
		);
	});

	it("a home-directory session does not swallow every project under it", () => {
		// The bug this rule exists for, found on real data: one session ran in
		// /Users/<me>, a containment check made the repo a child of it, and the
		// whole repository collapsed into a "giorgobg" project.
		//
		// `resolveProject` already walks a subdirectory up to its repository
		// root, so exact equality is sufficient AND is the only rule that does
		// not let a parent directory absorb its children.
		const home = {
			id: "/Users/giorgobg",
			name: "giorgobg",
			root: "/Users/giorgobg",
			counts: { sessions: 1, memory: 0, research: 0, changes: 0 },
		};
		assert.equal(matches(home, { path: REPO }), "out");
		assert.equal(matches(home, { path: "/Users/giorgobg" }), "in");
	});

});

describe("building the project list", () => {
	it("collapses the three spaces into one project", () => {
		// A session path, a memory slug and a research remote — three records
		// that share no substring — must produce ONE entry.
		const projects = buildProjects([
			{ candidate: { path: REPO }, source: "sessions" },
			{ candidate: { slug: SLUG }, source: "memory" },
			{ candidate: { projectKey: REMOTE }, source: "research" },
		]);
		assert.equal(projects.length, 1, "one project came out as several");
		assert.equal(projects[0].slug, SLUG);
		assert.equal(projects[0].gitRemote, REMOTE);
		assert.deepEqual(projects[0].counts, {
			sessions: 1,
			memory: 1,
			research: 1,
			changes: 0,
		});
	});

	it("collapses a subdirectory into its repository", () => {
		// Measured: 3 session directories for 2 real projects, one of them
		// `.../inspector-hook/packages/core`.
		const projects = buildProjects([
			{ candidate: { path: REPO }, source: "sessions" },
			{ candidate: { path: `${REPO}/packages/core` }, source: "sessions" },
		]);
		assert.equal(projects.length, 1);
		assert.equal(projects[0].root, REPO);
		assert.equal(projects[0].counts.sessions, 2);
	});

	it("merges groups that only become linked later", () => {
		// The slug arrives first and cannot be linked to anything; the remote
		// arrives second, also unlinkable; the session path arrives last and is
		// the only record that knows they are the same project. A single pass
		// would leave three entries.
		const projects = buildProjects([
			{ candidate: { slug: SLUG }, source: "memory" },
			{ candidate: { projectKey: REMOTE }, source: "research" },
			{ candidate: { path: REPO }, source: "sessions" },
		]);
		assert.equal(
			projects.length,
			1,
			"the late link did not merge the earlier groups",
		);
	});

	it("keeps genuinely different projects apart", () => {
		const projects = buildProjects([
			{ candidate: { path: REPO }, source: "sessions" },
			{
				candidate: { path: "/Users/giorgobg/Desktop/Ordex" },
				source: "sessions",
			},
		]);
		assert.equal(projects.length, 2);
	});

	it("keeps a memory-only project rather than attaching it to a guess", () => {
		// Its slug cannot be turned back into a path, so it is its own identity
		// with no root. Guessing a directory is what native-memory refuses to
		// do, because a wrong one means writing memory nothing ever loads.
		const projects = buildProjects([
			{ candidate: { slug: "-Users-gio-Desktop-lifeos" }, source: "memory" },
		]);
		assert.equal(projects.length, 1);
		assert.equal(projects[0].root, undefined);
		assert.equal(projects[0].id, "slug:-Users-gio-Desktop-lifeos");
	});

	it("skips an observation that identifies nothing", () => {
		assert.deepEqual(
			buildProjects([{ candidate: {}, source: "sessions" }]),
			[],
		);
	});

	it("orders by how much is behind each project", () => {
		const projects = buildProjects([
			{
				candidate: { path: "/Users/giorgobg/Desktop/Ordex" },
				source: "sessions",
			},
			{ candidate: { path: REPO }, source: "sessions" },
			{ candidate: { path: REPO }, source: "changes" },
			{ candidate: { path: REPO }, source: "research" },
		]);
		assert.equal(projects[0].root, REPO, "the busiest project was not first");
		assert.equal(total(projects[0].counts), 3);
	});
});

describe("finding one by id", () => {
	it("returns undefined for no id, which is the all-projects case", () => {
		assert.equal(findProject([identity()], undefined), undefined);
		assert.equal(findProject([identity()], ""), undefined);
	});

	it("finds by id", () => {
		assert.equal(findProject([identity()], REPO)?.name, "inspector-hook");
	});

	it("returns undefined for an id nothing matches", () => {
		// A stale filter from a previous session must not silently scope to
		// something arbitrary.
		assert.equal(findProject([identity()], "/gone"), undefined);
	});
});
