/**
 * An edit lands on the file that was opened.
 *
 * The target used to be derived from `entry.name` -- the FRONTMATTER name --
 * rather than from the file being edited. Those differ in 6 of the 33 files in
 * the real corpus on this machine, because Claude Code's own writer sets a
 * descriptive `name:` independent of the filename. So editing
 * `feedback_no_shortcuts.md` created `no-shortcuts-or-corner-cutting.md`, left
 * the original byte-for-byte unchanged, added a SECOND line to MEMORY.md, and
 * returned `written: true`.
 *
 * That last part is what makes it the worst defect in this module rather than
 * merely a bug: `core.ts` says of this path that it "is the part of the system
 * most able to make a false claim ('saved to memory' when nothing was
 * written), so it reports what actually happened". It reported what happened to
 * a file the user had never opened.
 *
 * The fixture deliberately uses a name/filename mismatch, because a fixture
 * where they agree cannot express this bug at all -- which is exactly why the
 * existing suite passed through it.
 */

import { strict as assert } from "node:assert";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { AUTHORED_BY, writeMemoryFile } from "../dist/index.js";
import { cleanup, makeTempStore } from "./helpers.js";

const dirs = [];
after(async () => {
	await Promise.all(dirs.map(cleanup));
});

/** A memory dir holding one file whose frontmatter name != its filename. */
async function withMismatchedFile() {
	const basePath = await makeTempStore();
	dirs.push(basePath);
	const memoryDir = join(basePath, "memory");
	const { mkdir } = await import("node:fs/promises");
	await mkdir(memoryDir, { recursive: true });

	// The real shape: filename is snake_case with a type prefix; `name:` is a
	// human-readable kebab slug. Neither derives from the other.
	await writeFile(
		join(memoryDir, "feedback_no_shortcuts.md"),
		`---\nname: no-shortcuts-or-corner-cutting\ndescription: how to work\nmetadata:\n  type: feedback\n---\n\noriginal body\n`,
		"utf-8",
	);
	await writeFile(
		join(memoryDir, "MEMORY.md"),
		"# Memory\n\n- [No shortcuts](feedback_no_shortcuts.md) — how to work\n",
		"utf-8",
	);
	return memoryDir;
}

describe("editing a memory file whose name differs from its filename", () => {
	it("writes the file that was opened, not one named after the frontmatter", async () => {
		const memoryDir = await withMismatchedFile();

		const result = await writeMemoryFile(
			memoryDir,
			{
				name: "no-shortcuts-or-corner-cutting",
				fileName: "feedback_no_shortcuts.md",
				description: "how to work",
				type: "feedback",
				body: "edited body",
			},
			{ userInitiated: true },
		);

		assert.equal(result.written, true);
		assert.ok(
			result.path.endsWith("feedback_no_shortcuts.md"),
			`wrote ${result.path}, not the file that was opened`,
		);

		const onDisk = await readFile(join(memoryDir, "feedback_no_shortcuts.md"), "utf-8");
		assert.match(onDisk, /edited body/, "the opened file was not updated");
	});

	it("creates no second file", async () => {
		const memoryDir = await withMismatchedFile();
		await writeMemoryFile(
			memoryDir,
			{
				name: "no-shortcuts-or-corner-cutting",
				fileName: "feedback_no_shortcuts.md",
				description: "how to work",
				type: "feedback",
				body: "edited body",
			},
			{ userInitiated: true },
		);

		const files = (await readdir(memoryDir)).sort();
		assert.deepEqual(files, ["MEMORY.md", "feedback_no_shortcuts.md"]);
	});

	it("leaves the index with one line, still pointing at the real file", async () => {
		const memoryDir = await withMismatchedFile();
		await writeMemoryFile(
			memoryDir,
			{
				name: "no-shortcuts-or-corner-cutting",
				fileName: "feedback_no_shortcuts.md",
				description: "how to work",
				type: "feedback",
				body: "edited body",
			},
			{ userInitiated: true },
		);

		const index = await readFile(join(memoryDir, "MEMORY.md"), "utf-8");
		const links = index.match(/\]\(([^)]+)\)/g) ?? [];
		assert.deepEqual(links, ["](feedback_no_shortcuts.md)"], "index gained a second entry");
	});

	it("still derives the name for a NEW entry, where no file exists yet", async () => {
		// The fallback has to keep working: a generated digest supplies no
		// fileName and must land under its own name.
		const memoryDir = await withMismatchedFile();
		const result = await writeMemoryFile(memoryDir, {
			name: "Session 2026-09-04",
			description: "a digest",
			type: "project",
			body: "facts",
		});
		assert.equal(result.written, true);
		assert.ok(result.path.endsWith("session-2026-09-04.md"), result.path);
	});

	it("contains a client-supplied fileName to the memory directory", async () => {
		// fileName crosses IPC from the webview, so it is untrusted input used to
		// build a path -- the same shape as the ingest-id traversal already fixed
		// in the persistence store.
		const memoryDir = await withMismatchedFile();
		const result = await writeMemoryFile(
			memoryDir,
			{
				name: "escape-attempt",
				fileName: "../../../../tmp/ESCAPED.md",
				description: "d",
				type: "project",
				body: "b",
			},
			{ userInitiated: true },
		);

		assert.equal(result.written, true);
		assert.ok(
			result.path.startsWith(memoryDir),
			`escaped the memory directory: ${result.path}`,
		);
		assert.ok(result.path.endsWith("ESCAPED.md"), result.path);
	});

	it("ignores a fileName that is not a memory file", async () => {
		const memoryDir = await withMismatchedFile();
		const result = await writeMemoryFile(
			memoryDir,
			{
				name: "not-markdown",
				fileName: "payload.sh",
				description: "d",
				type: "project",
				body: "b",
			},
			{ userInitiated: true },
		);
		assert.ok(result.path.endsWith("not-markdown.md"), result.path);
	});

	it("keeps authorship: editing someone else's file does not stamp it as ours", async () => {
		const memoryDir = await withMismatchedFile();
		await writeMemoryFile(
			memoryDir,
			{
				name: "no-shortcuts-or-corner-cutting",
				fileName: "feedback_no_shortcuts.md",
				description: "how to work",
				type: "feedback",
				body: "edited body",
			},
			{ userInitiated: true },
		);
		const onDisk = await readFile(join(memoryDir, "feedback_no_shortcuts.md"), "utf-8");
		assert.ok(
			!onDisk.includes(AUTHORED_BY),
			"a hand-written file edited by hand must not become tool-authored",
		);
	});
});
