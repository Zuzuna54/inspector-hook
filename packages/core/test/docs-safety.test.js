/**
 * No document in this repo tells the user to destroy their own configuration.
 *
 * `config/README.md` did. Step 1 of its install instructions was:
 *
 *     cp config/claude-settings.json ~/.claude/settings.json
 *
 * which REPLACES the file. On the machine this was found on that would have
 * deleted 30 registered hook events and 52 commands, most belonging to tools
 * with nothing to do with this project. It is the same full-replace behaviour
 * `install.sh` was rewritten to stop doing, still being recommended in prose
 * two directories away.
 *
 * It was broken on its own terms as well: the file it told you to copy
 * hardcodes `/Users/gio/...` in 28 places, and the `sed` repairing those paths
 * came at step 5 — after the copy. Following the steps in order left you with
 * no settings of your own and a set of hook paths that did not exist.
 *
 * This is the only finding in the audit where following the documentation
 * actively damages the reader's machine, which is why it gets a test. Code
 * that lies is a bug; instructions that destroy are worse, and nothing else in
 * this repo was checking prose.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const SKIP_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"out",
	".turbo",
	"coverage",
]);

/** Every markdown file in the repo. */
async function markdownFiles(dir = repoRoot, out = []) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		if (entry.name.startsWith(".") && entry.name !== ".github") continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name)) continue;
			await markdownFiles(full, out);
		} else if (entry.name.endsWith(".md")) {
			out.push(full);
		}
	}
	return out;
}

/**
 * Commands that overwrite a settings file wholesale.
 *
 * Deliberately narrow: it matches a copy or redirect whose TARGET is a
 * settings.json, not any mention of the path. Documenting what not to do — as
 * the fixed README now does — must stay legal, so the patterns require the
 * destructive form itself rather than the words around it.
 */
const DESTRUCTIVE = [
	{
		name: "cp onto settings.json",
		pattern: /^\s*(?:\$\s*)?cp\s+(?!-r\b)[^\n|]*\s+\S*\.claude\/settings\.json\s*$/m,
	},
	{
		name: "redirect onto settings.json",
		pattern: /^\s*[^\n#]*>\s*\S*\.claude\/settings\.json\s*$/m,
	},
	{
		name: "jq assigning the whole .hooks key",
		pattern: /jq[^\n]*'\s*\.hooks\s*=/,
	},
];

describe("documentation cannot destroy the reader's configuration", () => {
	it("finds the markdown to check", async () => {
		// Without this the sweep could cover nothing and pass.
		const files = await markdownFiles();
		assert.ok(files.length > 5, `only found ${files.length} markdown files`);
	});

	it("no document instructs a full overwrite of ~/.claude/settings.json", async () => {
		const offenders = [];
		for (const file of await markdownFiles()) {
			const text = await readFile(file, "utf-8");
			for (const { name, pattern } of DESTRUCTIVE) {
				if (pattern.test(text)) {
					offenders.push(`${relative(repoRoot, file)}: ${name}`);
				}
			}
		}
		assert.deepEqual(
			offenders,
			[],
			"these tell the reader to replace a settings file rather than merge into it",
		);
	});

	it("the sample settings file says it is a sample", async () => {
		// It hardcodes another machine's home directory in 28 places. Anyone who
		// opens it should learn that before they act on it, not after.
		const sample = JSON.parse(
			await readFile(join(repoRoot, "config", "claude-settings.json"), "utf-8"),
		);
		assert.ok(sample._README, "the sample carries no warning");
		assert.match(sample._README, /do not copy/i);
		assert.match(sample._README, /install\.sh/);
	});

	it("points at the installer, which merges per event", async () => {
		const readme = await readFile(join(repoRoot, "config", "README.md"), "utf-8");
		assert.match(
			readme,
			/install\.sh/,
			"the safe path has to be the one the reader is given",
		);
	});
});

describe("the README's stated defaults match the code", () => {
	// The README said `INSPECTOR_HOOK_RETENTION_DAYS=7` for as long as the core
	// shipped 0. Nobody reading it could have known their history was being
	// kept; someone reading it would have believed it was being deleted. A
	// documented default that disagrees with the code is the same failure class
	// as a button that does nothing — it is confidently wrong, and free.
	const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
	const readme = readFileSync(join(root, "README.md"), "utf-8");
	const cli = readFileSync(join(root, "packages", "core", "src", "cli.ts"), "utf-8");

	/** The default the core falls back to for an env var, from cli.ts. */
	function coreDefault(name) {
		const m = new RegExp(`${name} \\|\\| "([^"]*)"`).exec(cli);
		assert.ok(m, `cli.ts has no default for ${name}`);
		return m[1];
	}

	function readmeValue(name) {
		const m = new RegExp(`^${name}=(\\S*)`, "m").exec(readme);
		assert.ok(m, `${name} is not documented in the README`);
		return m[1];
	}

	it("retention: the README states what the core actually defaults to", () => {
		assert.equal(readmeValue("INSPECTOR_HOOK_RETENTION_DAYS"), coreDefault("INSPECTOR_HOOK_RETENTION_DAYS"));
	});

	it("documents the narrative gate at all", () => {
		// One of three gates, and the only one that is not a click. Undocumented,
		// it is a feature nobody can turn on.
		assert.match(readme, /INSPECTOR_HOOK_NARRATIVE/);
		assert.match(readme, /three gates|ONE of three/i);
	});

	it("says the narrative is off by default", () => {
		assert.equal(readmeValue("INSPECTOR_HOOK_NARRATIVE"), "0");
	});

	it("documents session memory as off by default", () => {
		assert.equal(readmeValue("INSPECTOR_HOOK_SESSION_MEMORY"), "0");
	});
});
