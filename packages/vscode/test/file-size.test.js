/**
 * No file in this package grows past the size the splits were done to achieve.
 *
 * `module-split.test.js` already pins this for the seven Sessions modules, but
 * only those seven — so every other file was free to grow, and `api.js` did:
 * 610 lines when the split work finished, 726 by the time anyone looked again.
 * A rule enforced on a subset is a rule that quietly stops applying.
 *
 * The three files currently over the line are named individually with their
 * measured size and a reason, rather than the threshold being raised for
 * everyone. Growth against a recorded number fails the suite, so raising one is
 * a deliberate edit with a justification beside it that a reviewer sees in the
 * diff — not drift nobody notices. And a file that drops back under the limit
 * must leave the list, so an exemption cannot outlive its reason.
 *
 * An earlier version of this comment said the numbers "can only go down". That
 * was written before the first real bug fix needed four more lines in a file
 * already over the limit, and refusing it would have meant shipping two known
 * bugs to protect a line count. The rule that survives contact is the weaker
 * and more honest one: a number may move, but only visibly and with a reason.
 */

import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The size every file is expected to stay under. */
const LIMIT = 600;

/**
 * Files knowingly over the limit, with the size recorded and a reason.
 *
 * The number is a ceiling. Growth fails the suite, so raising one is a
 * deliberate edit a reviewer sees in the diff rather than drift nobody
 * notices — which is the whole point. Each entry is scheduled for a split.
 */
const OVER_LIMIT = {
	// 720 -> 645: memory and tray calls moved to src/bridge/memory-bridge.ts.
	// Still one method per IPC call, so it still grows with every feature; the
	// remaining domains (changes, history, sessions) split the same way.
	"src/core-bridge.ts": { lines: 645, why: "one method per IPC call; more domains to split out" },
};

const ROOTS = ["media", "src"];
const EXTENSIONS = [".js", ".css", ".ts"];

/** Every source file under the swept roots, as package-relative paths. */
function sourceFiles() {
	const out = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === "node_modules") continue;
				walk(full);
			} else if (EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
				out.push(relative(packageRoot, full));
			}
		}
	};
	for (const root of ROOTS) {
		const full = join(packageRoot, root);
		if (statSync(full, { throwIfNoEntry: false })) walk(full);
	}
	return out.sort();
}

/**
 * Lines, counted the way `wc -l` counts them.
 *
 * A trailing newline terminates the last line rather than starting a new one,
 * so splitting on "\n" reports one more than every other tool a reader would
 * check against. The numbers recorded above have to mean the same thing as the
 * numbers a developer measures, or the allowlist is annoying rather than useful.
 */
function lineCount(relPath) {
	const text = readFileSync(join(packageRoot, relPath), "utf8");
	const lines = text.split("\n");
	if (lines[lines.length - 1] === "") lines.pop();
	return lines.length;
}

describe("file size", () => {
	const files = sourceFiles();

	it("finds the source tree", () => {
		// Without this the sweep could silently cover nothing and pass.
		assert.ok(files.length > 40, `only found ${files.length} files`);
	});

	it("keeps every file under the limit, except those on the list", () => {
		const over = files
			.filter((f) => !(f in OVER_LIMIT))
			.map((f) => [f, lineCount(f)])
			.filter(([, lines]) => lines >= LIMIT)
			.map(([f, lines]) => `${f} (${lines})`);
		assert.deepEqual(over, [], `over ${LIMIT} lines and not on the allowlist`);
	});

	it("never lets an allowlisted file grow", () => {
		// The recorded number is a ceiling, not a note. Growth on a file already
		// too big is the failure this whole test exists to make visible, and
		// raising a number has to be a visible edit with a reason beside it.
		const grown = [];
		for (const [relPath, entry] of Object.entries(OVER_LIMIT)) {
			const actual = lineCount(relPath);
			if (actual > entry.lines) grown.push(`${relPath}: ${entry.lines} → ${actual}`);
		}
		assert.deepEqual(grown, [], "allowlisted files grew; split them instead");
	});

	it("gives a reason for every entry", () => {
		// A bare number invites raising it. A reason has to be written, and a
		// reviewer can tell whether it is still true.
		for (const [relPath, entry] of Object.entries(OVER_LIMIT)) {
			assert.equal(typeof entry.lines, "number", `${relPath} needs a line count`);
			assert.ok(entry.why && entry.why.length > 10, `${relPath} needs a reason`);
		}
	});

	it("has no stale allowlist entry", () => {
		// A file that came back under the limit must leave the list, or the list
		// stops describing reality and starts excusing it.
		const stale = [];
		for (const relPath of Object.keys(OVER_LIMIT)) {
			const actual = lineCount(relPath);
			if (actual < LIMIT) stale.push(`${relPath} is now ${actual}; remove it`);
		}
		assert.deepEqual(stale, [], "allowlist entries no longer needed");
	});

	it("lists only files that exist", () => {
		const missing = Object.keys(OVER_LIMIT).filter(
			(relPath) => !statSync(join(packageRoot, relPath), { throwIfNoEntry: false }),
		);
		assert.deepEqual(missing, [], "allowlisted file does not exist");
	});
});
