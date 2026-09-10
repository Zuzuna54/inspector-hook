/**
 * Discovering the projects Inspector Hook can scan (M7).
 *
 * Measured on this machine: 31 transcript directories, 17 of which still exist,
 * 3 with a package.json, 1 with a graph. The registry has to reproduce that,
 * and two behaviours are deliberate refusals rather than conveniences.
 */

import { strict as assert } from "node:assert";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
	cwdFromTranscript,
	discoverProjects,
	pathFromDashedName,
	summarise,
	TRANSCRIPT_ROOT,
} from "../dist/index.js";
import { cleanup, makeTempStore } from "./helpers.js";

const dirs = [];
after(async () => {
	await Promise.all(dirs.map(cleanup));
});

/** A fake transcript root with one project directory. */
async function makeTranscripts(entries) {
	const root = await makeTempStore();
	dirs.push(root);
	for (const [dir, lines] of Object.entries(entries)) {
		await mkdir(join(root, dir), { recursive: true });
		if (lines !== null) {
			await writeFile(join(root, dir, "a.jsonl"), lines, "utf-8");
		}
	}
	return root;
}

describe("registry: the root comes from the transcript, not the directory name", () => {
	it("REGRESSION: prefers the recorded cwd, because the dashed name is ambiguous", async () => {
		// `-Users-gio-Desktop-dev-inspector-hook` could be
		// /Users/gio/Desktop/dev/inspector-hook OR
		// /Users/gio/Desktop/dev-inspector/hook. The dashes are not reversible,
		// so a name-derived path is a guess and is marked as one.
		const project = await makeTempStore();
		dirs.push(project);
		const root = await makeTranscripts({
			"-some-dashed-name": `${JSON.stringify({ type: "user", cwd: project })}\n`,
		});

		const [p] = discoverProjects({ transcriptRoot: root });
		assert.equal(p.root, project, "the exact recorded path");
		assert.equal(p.rootSource, "transcript");
		assert.equal(p.exists, true);
	});

	it("falls back to the dashed name and SAYS it is a guess", async () => {
		const root = await makeTranscripts({ "-tmp-nope-nowhere": "" });
		const [p] = discoverProjects({ transcriptRoot: root });
		assert.equal(p.rootSource, "dashed-name");
		assert.equal(p.root, "/tmp/nope/nowhere");
	});

	it("reverses a dashed name the only way it can", () => {
		assert.equal(
			pathFromDashedName("-Users-me-Desktop-app"),
			"/Users/me/Desktop/app",
		);
		assert.equal(pathFromDashedName("-tmp"), "/tmp");
	});

	it("returns null rather than guessing when no cwd is recorded", async () => {
		const root = await makeTranscripts({ "-x": '{"type":"user"}\n' });
		assert.equal(cwdFromTranscript(join(root, "-x")), null);
		assert.equal(cwdFromTranscript("/nonexistent"), null);
	});
});

describe("registry: missing projects are reported, not dropped", () => {
	it("REGRESSION: a project that moved is returned with exists:false", async () => {
		// Fourteen of the 31 real directories point at paths that are gone.
		// Filtering them out would silently shrink the list from 31 to 17 and
		// hide the fact that work happened somewhere that no longer exists.
		const gone = "/tmp/definitely-not-here-xyz";
		const root = await makeTranscripts({
			"-gone": `${JSON.stringify({ type: "user", cwd: gone })}\n`,
		});
		const [p] = discoverProjects({ transcriptRoot: root });
		assert.equal(p.exists, false);
		assert.equal(p.root, gone);
		// And nothing is claimed to be scannable.
		assert.deepEqual(p.tools, {
			knip: false,
			madge: false,
			graphify: false,
			sonarSecrets: false,
		});
	});

	it("counts existing and missing separately", async () => {
		const live = await makeTempStore();
		dirs.push(live);
		const root = await makeTranscripts({
			"-live": `${JSON.stringify({ cwd: live })}\n`,
			"-dead": `${JSON.stringify({ cwd: "/tmp/gone-abc" })}\n`,
		});
		const s = summarise(discoverProjects({ transcriptRoot: root }));
		assert.equal(s.discovered, 2);
		assert.equal(s.existing, 1);
		assert.equal(s.missing, 1);
	});
});

describe("registry: which tools apply", () => {
	it("knip needs a package.json, graphify does not", async () => {
		// knip with no entry points reports the whole tree as unused, which is
		// worse than not running it. graphify takes anything.
		const bare = await makeTempStore();
		const withPkg = await makeTempStore();
		dirs.push(bare, withPkg);
		await writeFile(join(withPkg, "package.json"), "{}", "utf-8");

		const root = await makeTranscripts({
			"-bare": `${JSON.stringify({ cwd: bare })}\n`,
			"-pkg": `${JSON.stringify({ cwd: withPkg })}\n`,
		});
		const projects = discoverProjects({ transcriptRoot: root });
		const b = projects.find((p) => p.root === bare);
		const w = projects.find((p) => p.root === withPkg);

		assert.equal(b.tools.knip, false);
		assert.equal(b.tools.graphify, true, "graphify is language-agnostic");
		assert.equal(b.tools.sonarSecrets, true);
		assert.equal(w.tools.knip, true);
	});

	it("notices an existing graph", async () => {
		const project = await makeTempStore();
		dirs.push(project);
		await mkdir(join(project, "graphify-out"), { recursive: true });
		await writeFile(join(project, "graphify-out", "graph.json"), "{}", "utf-8");
		const root = await makeTranscripts({
			"-g": `${JSON.stringify({ cwd: project })}\n`,
		});
		assert.equal(discoverProjects({ transcriptRoot: root })[0].hasGraph, true);
	});

	it("one path discovered twice yields ONE project", async () => {
		// A repo opened at different times gets two transcript directories.
		// Two entries would run every scan twice.
		const project = await makeTempStore();
		dirs.push(project);
		const root = await makeTranscripts({
			"-a": `${JSON.stringify({ cwd: project })}\n`,
			"-b": `${JSON.stringify({ cwd: project })}\n`,
		});
		assert.equal(discoverProjects({ transcriptRoot: root }).length, 1);
	});

	it("a missing transcript root is empty, not an error", () => {
		assert.deepEqual(discoverProjects({ transcriptRoot: "/nonexistent" }), []);
	});
});

describe("registry: against this machine", () => {
	const skip = !existsSync(TRANSCRIPT_ROOT);

	it("discovers every project directory, counted independently", { skip }, () => {
		// This asserted `discovered === 31`, hand-measured. It broke the moment
		// a new project directory appeared -- one `claude -p` run in a temp dir
		// was enough -- and the fix would have been to bump the number forever,
		// which tests the machine rather than the function. So the expected
		// count is now derived a second way: one readdir, the simplest possible
		// independent implementation.
		const expected = readdirSync(TRANSCRIPT_ROOT, {
			withFileTypes: true,
		}).filter((e) => e.isDirectory()).length;

		const s = summarise(discoverProjects());
		assert.equal(s.discovered, expected, `discovered ${s.discovered}`);
		// The measured shape still holds and is the part worth pinning: most
		// projects Inspector Hook has seen are no longer on disk, and only a
		// handful are JS/TS -- which is why knip reaches so few of them.
		assert.ok(s.discovered >= 31, `only ${s.discovered} projects`);
		assert.ok(
			s.existing >= 17 && s.existing <= s.discovered,
			`existing ${s.existing} of ${s.discovered}`,
		);
		assert.ok(s.knipEligible >= 3, `knip-eligible ${s.knipEligible}`);
		assert.ok(
			s.knipEligible < s.existing / 2,
			`knip reaches ${s.knipEligible} of ${s.existing}, which should be a minority`,
		);
		assert.ok(s.missing > 0, "some projects have moved, and that is reported");
	});
});
