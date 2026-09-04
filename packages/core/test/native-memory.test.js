/**
 * Tests for the native auto-memory integration (Milestone 3).
 *
 * Every test runs against a temp directory. Nothing here reads or writes the
 * user's real ~/.claude/projects — these files change what future Claude
 * sessions are told, so a test that touched them would be editing the user's
 * memory as a side effect of running the suite.
 *
 * The fixtures are modelled on the real corpus surveyed on this machine (31
 * files across 9 indexed projects), including the one file that predates
 * frontmatter and the one index that carries hand-written prose sections.
 */

import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
	AUTHORED_BY,
	buildSessionDigest,
	deleteMemoryFile,
	formatDuration,
	formatMemoryFile,
	indexMemoryFile,
	listMemoryProjects,
	memoryFileName,
	parseIndexReferences,
	parseMemoryFile,
	readMemoryProject,
	resolveMemoryDir,
	upsertIndexEntry,
	writeMemoryFile,
} from "../dist/index.js";
import { cleanup, makeTempStore } from "./helpers.js";

const tempDirs = [];
after(async () => {
	await Promise.all(tempDirs.map(cleanup));
});

/** A memory directory laid out the way Claude Code lays one out. */
async function makeMemoryDir(slug = "-Users-x-Desktop-proj") {
	const home = await makeTempStore();
	tempDirs.push(home);
	const memoryDir = join(home, ".claude", "projects", slug, "memory");
	await mkdir(memoryDir, { recursive: true });
	return { home, memoryDir };
}

const AUTHORED = (name, body = "generated body") =>
	`---\nname: ${name}\ndescription: a generated entry\nmetadata:\n  type: project\n  source: ${AUTHORED_BY}\n---\n\n${body}\n`;

const HANDWRITTEN = (name, body = "hand-written body") =>
	`---\nname: ${name}\ndescription: written by a person\nmetadata:\n  type: feedback\n---\n\n${body}\n`;

describe("resolveMemoryDir", () => {
	it("derives the memory directory from the transcript path", () => {
		assert.equal(
			resolveMemoryDir(
				"/Users/x/.claude/projects/-Users-x-Desktop-proj/abc-123.jsonl",
			),
			"/Users/x/.claude/projects/-Users-x-Desktop-proj/memory",
		);
	});

	it("returns null rather than guessing when there is no transcript path", () => {
		// The project slug replaces BOTH "/" and "_" with "-", so /a/b_c and
		// /a/b-c produce the same slug. Computing it from the working directory
		// can therefore target another project's memory, and memory written to
		// the wrong directory is never loaded -- a silent failure. Refusing is
		// the correct answer.
		for (const bad of [undefined, null, "", 42, {}, "transcript.jsonl", "/"]) {
			assert.equal(resolveMemoryDir(bad), null, `should refuse: ${String(bad)}`);
		}
	});
});

describe("parseMemoryFile", () => {
	it("reads name, description and metadata.type", () => {
		const parsed = parseMemoryFile(
			"---\nname: my-fact\ndescription: something true\nmetadata:\n  type: feedback\n---\n\nthe body\n",
			"my-fact.md",
		);
		assert.equal(parsed.name, "my-fact");
		assert.equal(parsed.description, "something true");
		assert.equal(parsed.type, "feedback");
		assert.equal(parsed.body, "the body\n");
		assert.equal(parsed.hasFrontmatter, true);
	});

	it("reads metadata.source, which is what authorises a rewrite", () => {
		const parsed = parseMemoryFile(AUTHORED("x"), "x.md");
		assert.equal(parsed.source, AUTHORED_BY);
		assert.equal(parseMemoryFile(HANDWRITTEN("x"), "x.md").source, undefined);
	});

	it("reads a file with no frontmatter at all", () => {
		// One such file exists in the real corpus and a human wrote it. A reader
		// that required frontmatter would silently drop it.
		const parsed = parseMemoryFile("# Deployment Analysis\n\nbody\n", "deploy.md");
		assert.equal(parsed.hasFrontmatter, false);
		assert.equal(parsed.name, "deploy", "falls back to the file stem");
		assert.equal(parsed.body, "# Deployment Analysis\n\nbody\n", "body preserved");
	});

	it("treats an unterminated frontmatter block as body, losing nothing", () => {
		const parsed = parseMemoryFile("---\nname: broken\nno end marker\n", "b.md");
		assert.equal(parsed.hasFrontmatter, false);
		assert.match(parsed.body, /no end marker/);
	});

	it("ignores a type outside the known vocabulary", () => {
		const parsed = parseMemoryFile(
			"---\nname: x\nmetadata:\n  type: nonsense\n---\n\nb\n",
			"x.md",
		);
		assert.equal(parsed.type, undefined);
	});

	it("does not mistake an indented key for a top-level one", () => {
		const parsed = parseMemoryFile(
			"---\nname: outer\nmetadata:\n  name: inner\n  type: user\n---\n\nb\n",
			"x.md",
		);
		assert.equal(parsed.name, "outer", "metadata.name must not win");
		assert.equal(parsed.type, "user");
	});

	it("strips surrounding quotes from a value", () => {
		const parsed = parseMemoryFile(
			'---\nname: x\ndescription: "quoted: with a colon"\n---\n\nb\n',
			"x.md",
		);
		assert.equal(parsed.description, "quoted: with a colon");
	});
});

describe("formatMemoryFile", () => {
	it("round-trips through the parser", () => {
		const entry = {
			name: "session-2026-09-03-abcd1234",
			description: "inspector-hook on main: 3 files changed, 12 tool calls",
			type: "project",
			body: "# Title\n\n- a fact\n",
		};
		const parsed = parseMemoryFile(formatMemoryFile(entry), "x.md");
		assert.equal(parsed.name, entry.name);
		assert.equal(parsed.description, entry.description);
		assert.equal(parsed.type, "project");
		assert.equal(parsed.source, AUTHORED_BY);
		assert.equal(parsed.body, "# Title\n\n- a fact\n");
	});

	it("quotes a description containing a colon so it is not truncated", () => {
		// Unquoted, "proj: 3 files" parses as a nested key and the description
		// silently loses everything after the colon.
		const text = formatMemoryFile({
			name: "x",
			description: "proj: 3 files changed",
			type: "project",
			body: "b",
		});
		assert.match(text, /description: "proj: 3 files changed"/);
		assert.equal(
			parseMemoryFile(text, "x.md").description,
			"proj: 3 files changed",
			"survives the round trip intact",
		);
	});

	it("flattens a newline in a description rather than breaking the block", () => {
		const text = formatMemoryFile({
			name: "x",
			description: "line one\nline two",
			type: "user",
			body: "b",
		});
		assert.equal(parseMemoryFile(text, "x.md").description, "line one line two");
	});
});

describe("memoryFileName", () => {
	it("produces a kebab-case .md name", () => {
		assert.equal(memoryFileName("Session 2026-09-03 ABC"), "session-2026-09-03-abc.md");
	});

	it("cannot escape the memory directory", () => {
		for (const evil of ["../../etc/passwd", "/abs/path", "a/b/c"]) {
			const name = memoryFileName(evil);
			assert.ok(!name.includes("/"), `${name} must not contain a separator`);
			assert.ok(!name.includes(".."), `${name} must not traverse`);
		}
	});

	it("never returns a bare extension", () => {
		assert.equal(memoryFileName("!!!"), "untitled.md");
		assert.equal(memoryFileName(""), "untitled.md");
	});
});

describe("parseIndexReferences", () => {
	it("finds markdown links and wiki links", () => {
		const refs = parseIndexReferences(
			"# Memory\n\n- [A](alpha.md) — x\n- [B](sub/beta.md)\n\nSee [[gamma]] and [[delta.md]].\n",
		);
		assert.deepEqual([...refs].sort(), ["alpha.md", "beta.md", "delta.md", "gamma.md"]);
	});
});

describe("readMemoryProject", () => {
	it("lists files and flags the ones the index does not reference", async () => {
		const { memoryDir } = await makeMemoryDir();
		await writeFile(join(memoryDir, "linked.md"), AUTHORED("linked"));
		await writeFile(join(memoryDir, "orphan.md"), HANDWRITTEN("orphan"));
		await writeFile(
			join(memoryDir, "MEMORY.md"),
			"# Memory\n\n- [Linked](linked.md) — x\n",
		);

		const project = await readMemoryProject(memoryDir);

		assert.equal(project.hasIndex, true);
		assert.equal(project.files.length, 2);
		const byName = Object.fromEntries(project.files.map((f) => [f.fileName, f]));
		assert.equal(byName["linked.md"].orphaned, false);
		assert.equal(
			byName["orphan.md"].orphaned,
			true,
			"a file no index line references is never loaded by name",
		);
		assert.ok(project.totalSize > 0);
	});

	it("treats every file as orphaned when there is no index", async () => {
		// 9 of the 18 memory directories surveyed had no MEMORY.md. Files there
		// are unreachable by name, which is worth surfacing rather than hiding.
		const { memoryDir } = await makeMemoryDir();
		await writeFile(join(memoryDir, "a.md"), AUTHORED("a"));

		const project = await readMemoryProject(memoryDir);
		assert.equal(project.hasIndex, false);
		assert.equal(project.files[0].orphaned, true);
	});

	it("returns an empty listing for a missing directory instead of throwing", async () => {
		const project = await readMemoryProject("/nonexistent/memory");
		assert.deepEqual(project.files, []);
		assert.equal(project.hasIndex, false);
	});

	it("ignores non-markdown files", async () => {
		const { memoryDir } = await makeMemoryDir();
		await writeFile(join(memoryDir, "notes.txt"), "not memory");
		await writeFile(join(memoryDir, "a.md"), AUTHORED("a"));

		const project = await readMemoryProject(memoryDir);
		assert.deepEqual(project.files.map((f) => f.fileName), ["a.md"]);
	});
});

describe("listMemoryProjects", () => {
	it("finds every project with memory, which native memory cannot do", async () => {
		// Native auto memory is scoped to one project at a time, so "where did I
		// solve this before" has no answer from inside a session. This is the
		// cross-project rollup that answers it.
		const { home } = await makeMemoryDir("-Users-x-proj-a");
		const root = join(home, ".claude", "projects");
		for (const slug of ["-Users-x-proj-b", "-Users-x-proj-c"]) {
			const dir = join(root, slug, "memory");
			await mkdir(dir, { recursive: true });
			await writeFile(join(dir, "note.md"), AUTHORED("note"));
		}
		await writeFile(join(root, "-Users-x-proj-a", "memory", "note.md"), AUTHORED("note"));
		// An empty memory directory, which is the common real case.
		await mkdir(join(root, "-Users-x-proj-empty", "memory"), { recursive: true });

		const projects = await listMemoryProjects({ home });
		assert.deepEqual(
			projects.map((p) => p.slug),
			["-Users-x-proj-a", "-Users-x-proj-b", "-Users-x-proj-c"],
			"empty directories are excluded by default",
		);

		const withEmpty = await listMemoryProjects({ home, includeEmpty: true });
		assert.equal(withEmpty.length, 4);
	});

	it("returns nothing when there is no projects root", async () => {
		const home = await makeTempStore();
		tempDirs.push(home);
		assert.deepEqual(await listMemoryProjects({ home }), []);
	});
});

describe("writeMemoryFile", () => {
	it("REGRESSION: creates the memory directory when the project has none", async () => {
		// The FIRST write for a project — the entire point of the feature — used
		// to fail with ENOENT, because nothing in this module ever called mkdir
		// and Claude Code creates `memory/` lazily on its own first write. 13 of
		// 31 project directories on this machine have no memory/ directory.
		//
		// No test caught it because every other test in this file, and in
		// memory-ipc.test.js, mkdirs the directory in setup — creating a state
		// production never creates. So this one deliberately does not.
		const home = await makeTempStore();
		tempDirs.push(home);
		const memoryDir = join(home, ".claude", "projects", "-fresh", "memory");
		assert.equal(existsSync(memoryDir), false, "the directory must not exist yet");

		const result = await writeMemoryFile(memoryDir, {
			name: "first-ever",
			description: "the first memory this project has had",
			type: "project",
			body: "content",
		});

		assert.equal(result.written, true, result.reason ?? "");
		assert.equal(result.indexUpdated, true, "and the index is created too");
		const project = await readMemoryProject(memoryDir);
		assert.deepEqual(project.files.map((f) => f.fileName), ["first-ever.md"]);
		assert.equal(project.hasIndex, true);
	});

	it("creates the directory for an index-only write too", async () => {
		const home = await makeTempStore();
		tempDirs.push(home);
		const memoryDir = join(home, ".claude", "projects", "-fresh2", "memory");
		await mkdir(memoryDir, { recursive: true });
		await writeFile(join(memoryDir, "note.md"), HANDWRITTEN("note"));
		// Remove nothing — the point is upsertIndexEntry on a dir with no index.
		assert.equal(
			await upsertIndexEntry(memoryDir, { fileName: "note.md", title: "Note" }),
			true,
		);
	});

	it("writes the documented format and indexes it", async () => {
		const { memoryDir } = await makeMemoryDir();

		const result = await writeMemoryFile(memoryDir, {
			name: "session-2026-09-03-abcd",
			description: "proj on main: 2 files changed",
			type: "project",
			body: "# Digest\n\n- a fact\n",
			title: "proj — 2026-09-03",
		});

		assert.equal(result.written, true);
		assert.equal(result.indexUpdated, true);

		const text = await readFile(result.path, "utf-8");
		const parsed = parseMemoryFile(text, "session-2026-09-03-abcd.md");
		assert.equal(parsed.source, AUTHORED_BY, "must mark itself as ours");
		assert.equal(parsed.type, "project");

		const index = await readFile(join(memoryDir, "MEMORY.md"), "utf-8");
		assert.match(index, /- \[proj — 2026-09-03\]\(session-2026-09-03-abcd\.md\)/);
	});

	it("REFUSES to overwrite a file it did not author", async () => {
		// These are the user's notes. A generated digest silently replacing a
		// hand-written memory would destroy something no tool can regenerate.
		const { memoryDir } = await makeMemoryDir();
		const target = join(memoryDir, "important.md");
		await writeFile(target, HANDWRITTEN("important", "DO NOT LOSE THIS"));

		const result = await writeMemoryFile(memoryDir, {
			name: "important",
			description: "generated",
			type: "project",
			body: "generated content",
		});

		assert.equal(result.written, false);
		assert.equal(result.refused, "not-authored-by-us");
		assert.match(await readFile(target, "utf-8"), /DO NOT LOSE THIS/);
	});

	it("updates a file it did author", async () => {
		const { memoryDir } = await makeMemoryDir();
		await writeFile(join(memoryDir, "mine.md"), AUTHORED("mine", "old body"));

		const result = await writeMemoryFile(memoryDir, {
			name: "mine",
			description: "refreshed",
			type: "project",
			body: "new body",
		});

		assert.equal(result.written, true);
		const text = await readFile(join(memoryDir, "mine.md"), "utf-8");
		assert.match(text, /new body/);
		assert.doesNotMatch(text, /old body/);
	});

	it("a USER-INITIATED edit may overwrite a hand-written note", async () => {
		// The escape hatch deleteMemoryFile already had. Every file in the real
		// corpus is hand-written, so without this the curation UI could not edit
		// a single one of them.
		const { memoryDir } = await makeMemoryDir();
		const target = join(memoryDir, "theirs.md");
		await writeFile(target, HANDWRITTEN("theirs", "ORIGINAL"));

		const result = await writeMemoryFile(
			memoryDir,
			{ name: "theirs", description: "edited by hand", type: "feedback", body: "EDITED" },
			{ userInitiated: true },
		);

		assert.equal(result.written, true);
		assert.match(await readFile(target, "utf-8"), /EDITED/);
	});

	it("a user edit does NOT stamp our authorship onto someone else's note", async () => {
		// Stamping it would silently promote the file into the set an automated
		// pass may overwrite -- turning one manual edit into a permanent
		// transfer of control over a file a person wrote.
		const { memoryDir } = await makeMemoryDir();
		await writeFile(join(memoryDir, "theirs.md"), HANDWRITTEN("theirs"));

		await writeMemoryFile(
			memoryDir,
			{ name: "theirs", description: "d", type: "feedback", body: "EDITED" },
			{ userInitiated: true },
		);

		const parsed = parseMemoryFile(
			await readFile(join(memoryDir, "theirs.md"), "utf-8"),
			"theirs.md",
		);
		assert.equal(parsed.source, undefined, "still not ours");

		// And the automated path is still refused afterwards, which is the point.
		const automated = await writeMemoryFile(memoryDir, {
			name: "theirs", description: "d", type: "project", body: "GENERATED",
		});
		assert.equal(automated.written, false);
		assert.equal(automated.refused, "not-authored-by-us");
	});

	it("still stamps authorship on a file we create", async () => {
		const { memoryDir } = await makeMemoryDir();
		await writeMemoryFile(
			memoryDir,
			{ name: "ours", description: "d", type: "project", body: "b" },
			{ userInitiated: true },
		);
		const parsed = parseMemoryFile(
			await readFile(join(memoryDir, "ours.md"), "utf-8"), "ours.md",
		);
		assert.equal(parsed.source, AUTHORED_BY, "a new file is ours");
	});

	it("refuses, with a reason, when there is no memory directory", async () => {
		const result = await writeMemoryFile(null, {
			name: "x",
			description: "d",
			type: "project",
			body: "b",
		});
		assert.equal(result.written, false);
		assert.equal(result.refused, "no-memory-dir");
		assert.match(result.reason, /transcript path/);
	});

	it("leaves no temp file behind", async () => {
		const { memoryDir } = await makeMemoryDir();
		await writeMemoryFile(memoryDir, {
			name: "x", description: "d", type: "project", body: "b",
		});
		const project = await readMemoryProject(memoryDir);
		assert.ok(
			project.files.every((f) => !f.fileName.includes(".tmp")),
			"the temp-and-rename write must not leave artefacts",
		);
	});
});

describe("upsertIndexEntry", () => {
	it("appends without disturbing hand-written content", async () => {
		// A real MEMORY.md in the surveyed corpus carries prose sections a person
		// added, against the documented one-line-per-entry rule. Rewriting the
		// index wholesale would delete them -- the same mistake as install.sh's
		// `jq '.hooks = $hooks'` full-key replace, against notes no tool can
		// regenerate.
		const { memoryDir } = await makeMemoryDir();
		const original = [
			"# Memory",
			"",
			"- [Existing](existing.md) — keep me",
			"",
			"## Tailwind 4 CSS Cascade Gotcha",
			"- Un-layered CSS beats ALL @layer rules",
			"- Fix: use an inline style",
			"",
		].join("\n");
		await writeFile(join(memoryDir, "MEMORY.md"), original);

		await upsertIndexEntry(memoryDir, {
			fileName: "new.md",
			title: "New",
			description: "added",
		});

		const text = await readFile(join(memoryDir, "MEMORY.md"), "utf-8");
		assert.match(text, /- \[Existing\]\(existing\.md\) — keep me/);
		assert.match(text, /## Tailwind 4 CSS Cascade Gotcha/);
		assert.match(text, /Un-layered CSS beats ALL @layer rules/);
		assert.match(text, /- \[New\]\(new\.md\) — added/);
	});

	it("replaces an existing line in place rather than duplicating it", async () => {
		const { memoryDir } = await makeMemoryDir();
		await writeFile(
			join(memoryDir, "MEMORY.md"),
			"# Memory\n\n- [Old title](x.md) — old\n- [Other](y.md) — keep\n",
		);

		await upsertIndexEntry(memoryDir, {
			fileName: "x.md",
			title: "New title",
			description: "new",
		});

		const text = await readFile(join(memoryDir, "MEMORY.md"), "utf-8");
		assert.equal(
			[...text.matchAll(/\(x\.md\)/g)].length,
			1,
			"exactly one line may reference the file",
		);
		assert.match(text, /- \[New title\]\(x\.md\) — new/);
		assert.match(text, /- \[Other\]\(y\.md\) — keep/);
	});

	it("creates the index when a project has none", async () => {
		const { memoryDir } = await makeMemoryDir();
		assert.equal(
			await upsertIndexEntry(memoryDir, { fileName: "a.md", title: "A" }),
			true,
		);
		const text = await readFile(join(memoryDir, "MEMORY.md"), "utf-8");
		assert.match(text, /^# Memory/);
		assert.match(text, /- \[A\]\(a\.md\)$/m);
	});

	it("reports no change when the line is already correct", async () => {
		const { memoryDir } = await makeMemoryDir();
		await upsertIndexEntry(memoryDir, { fileName: "a.md", title: "A", description: "d" });
		assert.equal(
			await upsertIndexEntry(memoryDir, { fileName: "a.md", title: "A", description: "d" }),
			false,
			"an idempotent call must not rewrite the file",
		);
	});
});

describe("type: declared vs inferred", () => {
	it("keeps an inferred type out of the declared one", async () => {
		// Six files in the real corpus encode their type only as a filename
		// prefix. Conflating that with a declared type is what made two parsers
		// disagree about how many files are untyped -- 7 undeclared vs 1 with no
		// type recoverable at all. A UI may show the inference; a count of what
		// is declared must not include it.
		const { memoryDir } = await makeMemoryDir();
		await writeFile(
			join(memoryDir, "feedback_no_shortcuts.md"),
			"---\nname: feedback_no_shortcuts\ndescription: d\n---\n\nbody\n",
		);
		await writeFile(join(memoryDir, "user_profile.md"), "# no frontmatter\n");
		await writeFile(join(memoryDir, "declared.md"), HANDWRITTEN("declared"));

		const files = Object.fromEntries(
			(await readMemoryProject(memoryDir)).files.map((f) => [f.fileName, f]),
		);

		assert.equal(files["feedback_no_shortcuts.md"].type, undefined);
		assert.equal(files["feedback_no_shortcuts.md"].inferredType, "feedback");
		assert.equal(files["user_profile.md"].inferredType, "user", "even without frontmatter");
		assert.equal(files["declared.md"].type, "feedback");
		assert.equal(
			files["declared.md"].inferredType,
			undefined,
			"no inference when a type is declared",
		);
	});

	it("does not invent a type from an unrecognised prefix", async () => {
		const { memoryDir } = await makeMemoryDir();
		await writeFile(join(memoryDir, "notes_thing.md"), "# x\n");
		const [file] = (await readMemoryProject(memoryDir)).files;
		assert.equal(file.inferredType, undefined);
	});
});

describe("indexState", () => {
	it("distinguishes an unreferenced file from a project with no index", async () => {
		// `orphaned` is true for both, which is accurate and useless: with no
		// index every file reports orphaned, and the answer there is "create an
		// index" once, not the same warning repeated per file.
		const { memoryDir } = await makeMemoryDir();
		await writeFile(join(memoryDir, "a.md"), AUTHORED("a"));
		await writeFile(join(memoryDir, "b.md"), AUTHORED("b"));

		const noIndex = await readMemoryProject(memoryDir);
		assert.deepEqual(
			noIndex.files.map((f) => f.indexState),
			["no-index", "no-index"],
		);

		await writeFile(join(memoryDir, "MEMORY.md"), "# Memory\n\n- [A](a.md)\n");
		const withIndex = await readMemoryProject(memoryDir);
		const byName = Object.fromEntries(
			withIndex.files.map((f) => [f.fileName, f.indexState]),
		);
		assert.equal(byName["a.md"], "referenced");
		assert.equal(byName["b.md"], "unreferenced");
	});

	it("orphaned stays true whenever the file is not loaded by name", async () => {
		const { memoryDir } = await makeMemoryDir();
		await writeFile(join(memoryDir, "a.md"), AUTHORED("a"));
		const [file] = (await readMemoryProject(memoryDir)).files;
		assert.equal(file.orphaned, true);
		assert.equal(file.indexState, "no-index");
	});
});

describe("userInitiated cannot be set by anything automated", () => {
	it("no core module passes it except the IPC handler", async () => {
		// The flag is only meaningful if nothing internal can set it. Same
		// property as the context picker's explicit-only guarantee, asserted the
		// same way -- and scoped to a PROPERTY (which callers set it) rather
		// than to a file list, so moving code does not silently retire the check.
		const { readdir, readFile: rf } = await import("node:fs/promises");
		const { join: j, resolve: r, dirname: d } = await import("node:path");
		const { fileURLToPath: f2p } = await import("node:url");
		const srcRoot = r(d(f2p(import.meta.url)), "..", "src");

		const files = [];
		const walk = async (dir) => {
			for (const entry of await readdir(dir, { withFileTypes: true })) {
				const full = j(dir, entry.name);
				if (entry.isDirectory()) await walk(full);
				else if (entry.name.endsWith(".ts")) files.push(full);
			}
		};
		await walk(srcRoot);
		assert.ok(files.length > 5, "found the source tree");

		const setters = [];
		for (const file of files) {
			// Comments stripped first: an assertion over source that matches its
			// own explanation can only be satisfied by rewording it, which is
			// backwards.
			const code = (await rf(file, "utf-8"))
				.replace(/\/\*[\s\S]*?\*\//g, "")
				.replace(/^\s*\/\/.*$/gm, "");
			if (/userInitiated\s*:/.test(code)) setters.push(file);
		}

		assert.deepEqual(
			setters.map((f) => f.slice(srcRoot.length + 1)),
			["ipc/ipc-server.ts"],
			"only the IPC handler may set userInitiated; it must come from the UI",
		);
	});

	it("the session-digest write path passes no options at all", async () => {
		const { readFile: rf } = await import("node:fs/promises");
		const { resolve: r, dirname: d } = await import("node:path");
		const { fileURLToPath: f2p } = await import("node:url");
		const core = await rf(
			r(d(f2p(import.meta.url)), "..", "src", "core.ts"),
			"utf-8",
		);
		assert.match(core, /writeMemoryFile\(memoryDir, digest\)/,
			"the automated path must call it with no options");
	});
});

describe("indexMemoryFile", () => {
	it("REGRESSION: indexes an orphaned HAND-WRITTEN file, which write could not", async () => {
		// The gap this closes: writeMemoryFile refuses a file it did not author,
		// which is right for content and made the most valuable curation action
		// -- indexing an orphan so it loads at all -- impossible for exactly the
		// files that need it. Indexing touches only MEMORY.md.
		const { memoryDir } = await makeMemoryDir();
		await writeFile(join(memoryDir, "hand-note.md"), HANDWRITTEN("hand-note", "KEEP"));
		await writeFile(join(memoryDir, "MEMORY.md"), "# Memory\n\n");

		assert.equal((await readMemoryProject(memoryDir)).files[0].orphaned, true);

		const result = await indexMemoryFile(memoryDir, "hand-note.md");

		assert.equal(result.indexed, true);
		assert.equal((await readMemoryProject(memoryDir)).files[0].orphaned, false);
		assert.match(
			await readFile(join(memoryDir, "MEMORY.md"), "utf-8"),
			/- \[hand-note\]\(hand-note\.md\) — written by a person/,
			"title and description come from the file's own frontmatter",
		);
		assert.match(
			await readFile(join(memoryDir, "hand-note.md"), "utf-8"),
			/KEEP/,
			"the file itself must be untouched",
		);
	});

	it("refuses to index a file that does not exist", async () => {
		// A dangling index line is worse than an orphan: an orphan is merely
		// unloaded, while a dangling reference misreports what memory holds.
		const { memoryDir } = await makeMemoryDir();
		const result = await indexMemoryFile(memoryDir, "ghost.md");
		assert.equal(result.indexed, false);
		assert.match(result.reason, /dangling/);
	});

	it("accepts an explicit title and description", async () => {
		const { memoryDir } = await makeMemoryDir();
		await writeFile(join(memoryDir, "x.md"), HANDWRITTEN("x"));
		await indexMemoryFile(memoryDir, "x.md", {
			title: "Custom Title",
			description: "custom text",
		});
		assert.match(
			await readFile(join(memoryDir, "MEMORY.md"), "utf-8"),
			/- \[Custom Title\]\(x\.md\) — custom text/,
		);
	});

	it("indexes a file with no frontmatter, using its stem", async () => {
		const { memoryDir } = await makeMemoryDir();
		await writeFile(join(memoryDir, "legacy.md"), "# Legacy\n\nno frontmatter\n");
		const result = await indexMemoryFile(memoryDir, "legacy.md");
		assert.equal(result.indexed, true);
		assert.match(
			await readFile(join(memoryDir, "MEMORY.md"), "utf-8"),
			/- \[legacy\]\(legacy\.md\)/,
		);
	});

	it("never lets the index reference itself", async () => {
		const { memoryDir } = await makeMemoryDir();
		await writeFile(join(memoryDir, "MEMORY.md"), "# Memory\n\n");
		const result = await indexMemoryFile(memoryDir, "MEMORY.md");
		assert.equal(result.indexed, false);
	});

	it("is idempotent", async () => {
		const { memoryDir } = await makeMemoryDir();
		await writeFile(join(memoryDir, "x.md"), HANDWRITTEN("x"));
		await indexMemoryFile(memoryDir, "x.md");
		const second = await indexMemoryFile(memoryDir, "x.md");
		assert.equal(second.indexed, true);
		assert.equal(second.changed, false, "no rewrite when the line is already right");
	});

	it("cannot be walked out of the directory", async () => {
		const { memoryDir } = await makeMemoryDir();
		const result = await indexMemoryFile(memoryDir, "../../../etc/hosts");
		assert.equal(result.indexed, false, "basename'd, so it misses");
	});
});

describe("deleteMemoryFile", () => {
	it("deletes its own file and drops the index line", async () => {
		const { memoryDir } = await makeMemoryDir();
		await writeMemoryFile(memoryDir, {
			name: "mine", description: "d", type: "project", body: "b",
		});

		const result = await deleteMemoryFile(memoryDir, "mine.md");
		assert.equal(result.deleted, true);

		const index = await readFile(join(memoryDir, "MEMORY.md"), "utf-8");
		assert.doesNotMatch(index, /mine\.md/, "the dangling index line must go too");
	});

	it("refuses a hand-written file unless forced", async () => {
		const { memoryDir } = await makeMemoryDir();
		await writeFile(join(memoryDir, "theirs.md"), HANDWRITTEN("theirs"));

		const refused = await deleteMemoryFile(memoryDir, "theirs.md");
		assert.equal(refused.deleted, false);
		assert.match(refused.reason, /force/);

		// Curation from the UI is an explicit human decision, so force exists.
		const forced = await deleteMemoryFile(memoryDir, "theirs.md", { force: true });
		assert.equal(forced.deleted, true);
	});

	it("never deletes the index", async () => {
		const { memoryDir } = await makeMemoryDir();
		await upsertIndexEntry(memoryDir, { fileName: "a.md", title: "A" });
		const result = await deleteMemoryFile(memoryDir, "MEMORY.md", { force: true });
		assert.equal(result.deleted, false);
		await readFile(join(memoryDir, "MEMORY.md"), "utf-8"); // still there
	});

	it("cannot be walked out of the directory", async () => {
		const { memoryDir } = await makeMemoryDir();
		const result = await deleteMemoryFile(memoryDir, "../../../etc/hosts", {
			force: true,
		});
		assert.equal(result.deleted, false, "the path is basename'd, so it misses");
	});
});

describe("buildSessionDigest", () => {
	const session = (overrides = {}) => ({
		id: "abcd1234-5678",
		status: "completed",
		startTime: "2026-09-03T10:00:00.000Z",
		endTime: "2026-09-03T11:30:00.000Z",
		toolExecutions: [],
		fileChanges: [],
		metadata: { projectName: "inspector-hook", gitBranch: "main" },
		...overrides,
	});

	it("skips a session that recorded nothing", () => {
		// The index is loaded with a line budget, so every worthless entry costs
		// a real one.
		const digest = buildSessionDigest({ session: session() });
		assert.equal(digest.worthKeeping, false);
		assert.match(digest.skipReason, /no file changes/);
	});

	it("takes file paths from tool executions", () => {
		const digest = buildSessionDigest({
			session: session({
				toolExecutions: [
					{ id: "1", tool: "Edit", input: {}, startTime: "", status: "completed",
						affectedFiles: ["/a.ts"] },
					{ id: "2", tool: "Edit", input: {}, startTime: "", status: "completed",
						affectedFiles: ["/a.ts", "/b.ts"] },
				],
			}),
		});
		assert.equal(digest.worthKeeping, true);
		assert.match(digest.body, /## Files changed \(2\)/, "a file edited twice is one file");
		assert.match(digest.body, /Edit ×2/);
	});

	it("prefers caller-resolved paths over execution-recorded ones", () => {
		const digest = buildSessionDigest({
			session: session({
				toolExecutions: [
					{ id: "1", tool: "Edit", input: {}, startTime: "", status: "completed",
						affectedFiles: ["/stale.ts"] },
				],
			}),
			filePaths: ["/resolved.ts"],
		});
		assert.match(digest.body, /resolved\.ts/);
		assert.doesNotMatch(digest.body, /stale\.ts/);
	});

	it("says paths are unresolved rather than reporting zero files", () => {
		// Session.fileChanges holds change IDs. Reporting "0 files changed" for a
		// session with 5 change records would be false.
		const digest = buildSessionDigest({
			session: session({ fileChanges: ["c1", "c2", "c3"] }),
		});
		assert.equal(digest.worthKeeping, true);
		assert.match(digest.description, /3 changes \(paths unresolved\)/);
	});

	it("counts failed and blocked executions", () => {
		const digest = buildSessionDigest({
			session: session({
				toolExecutions: [
					{ id: "1", tool: "Bash", input: {}, startTime: "", status: "failed" },
					{ id: "2", tool: "Bash", input: {}, startTime: "", status: "blocked" },
					{ id: "3", tool: "Bash", input: {}, startTime: "", status: "completed" },
				],
			}),
		});
		assert.match(digest.description, /2 failed/);
		assert.match(digest.body, /2 calls did not succeed/);
	});

	it("records the duration from the session's own timestamps", () => {
		const digest = buildSessionDigest({
			session: session({
				toolExecutions: [
					{ id: "1", tool: "Read", input: {}, startTime: "", status: "completed" },
				],
			}),
		});
		assert.match(digest.body, /Duration: 1h 30m/);
	});

	it("quotes prompts verbatim instead of paraphrasing intent", () => {
		// A paraphrase is an invented fact that every later session would trust.
		const digest = buildSessionDigest({
			session: session({
				toolExecutions: [
					{ id: "1", tool: "Read", input: {}, startTime: "", status: "completed" },
				],
			}),
			prompts: ["fix   the\nretention bug"],
		});
		assert.match(digest.body, /- fix the retention bug/, "whitespace flattened, words kept");
	});

	it("names entries so two sessions on one day do not collide", () => {
		const a = buildSessionDigest({ session: session({ id: "aaaaaaaa-1" , toolExecutions: [
			{ id: "1", tool: "Read", input: {}, startTime: "", status: "completed" }] }) });
		const b = buildSessionDigest({ session: session({ id: "bbbbbbbb-2", toolExecutions: [
			{ id: "1", tool: "Read", input: {}, startTime: "", status: "completed" }] }) });
		assert.notEqual(a.name, b.name);
		assert.match(a.name, /^session-2026-09-03-aaaaaaaa$/);
	});

	it("survives a session with missing and malformed fields", () => {
		const digest = buildSessionDigest({
			session: {
				id: "x", status: "active", startTime: "not a date",
				toolExecutions: undefined, fileChanges: undefined, metadata: undefined,
			},
		});
		assert.equal(digest.worthKeeping, false);
		assert.ok(digest.name.startsWith("session-"));
	});

	it("collapses a long file list instead of emitting hundreds of lines", () => {
		const many = Array.from({ length: 40 }, (_, i) => `/f${i}.ts`);
		const digest = buildSessionDigest({
			session: session({
				toolExecutions: [
					{ id: "1", tool: "Edit", input: {}, startTime: "", status: "completed",
						affectedFiles: many },
				],
			}),
		});
		assert.match(digest.body, /## Files changed \(40\)/);
		assert.match(digest.body, /…and 28 more/);
	});

	it("produces a body that parses back as a valid memory file", () => {
		const digest = buildSessionDigest({
			session: session({
				toolExecutions: [
					{ id: "1", tool: "Edit", input: {}, startTime: "", status: "completed",
						affectedFiles: ["/a.ts"] },
				],
			}),
		});
		const parsed = parseMemoryFile(formatMemoryFile(digest), `${digest.name}.md`);
		assert.equal(parsed.name, digest.name);
		assert.equal(
			parsed.description,
			digest.description,
			"the description contains a colon, so it must survive quoting",
		);
		assert.equal(parsed.type, "project");
	});
});

describe("formatDuration", () => {
	it("reads as a human wrote it", () => {
		assert.equal(formatDuration(0), "under a minute");
		assert.equal(formatDuration(59_000), "under a minute");
		assert.equal(formatDuration(90_000), "2 min");
		assert.equal(formatDuration(3_600_000), "1h");
		assert.equal(formatDuration(5_400_000), "1h 30m");
	});

	it("does not invent a duration it cannot compute", () => {
		assert.equal(formatDuration(Number.NaN), "unknown");
		assert.equal(formatDuration(-1), "unknown");
	});
});
