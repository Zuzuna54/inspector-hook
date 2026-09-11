/**
 * No file in this package grows past the size the splits were done to achieve.
 *
 * The vscode package has had this guard for a while. **This package never did**,
 * and the omission is the exact failure that file's own header warns about:
 * "A rule enforced on a subset is a rule that quietly stops applying." While
 * `media/` and `vscode/src` were held to 600 lines, `ipc-server.ts` reached
 * 2130 and `file-tracker.ts` 1709 with nothing to notice.
 *
 * Every file over the limit today is recorded below with its measured size and
 * a reason. The number is a CEILING: growth fails the suite, so raising one is
 * a deliberate edit a reviewer sees in the diff rather than drift nobody
 * notices. A file that drops back under the limit must leave the list, so an
 * exemption cannot outlive its reason.
 *
 * These entries are a debt, not an approval. They are recorded rather than
 * fixed in one pass because splitting nine files at once, with no behaviour
 * change to justify it, is how a refactor breaks something quietly.
 */

import { strict as assert } from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The size every file is expected to stay under. */
const LIMIT = 600;

/**
 * Files knowingly over the limit, with the size recorded and a reason.
 *
 * Measured 2026-09-11, when this guard was first extended to cover `core`.
 */
const OVER_LIMIT = {
	// One `this.methods.set(...)` per IPC method, across every domain the core
	// exposes: logs, sessions, changes, versions, memory, context, research,
	// graphify, agents, quality, skills, find. It grows once per feature and
	// splits cleanly by domain, the same way vscode/src/messages/ already did.
	"src/ipc/ipc-server.ts": {
		lines: 2130,
		why: "one handler per IPC method; splits by domain like messages/ did",
	},
	// Capture, diff, versioning, keep/revert, per-hunk resolution, archive and
	// restore in one class. The diff engine is already separate; the version
	// store is the next seam.
	"src/managers/file-tracker.ts": {
		lines: 1709,
		why: "capture + versions + hunks + archive in one class",
	},
	// The composition root: it constructs every manager and owns the accessors
	// each milestone adds. Most of its growth is delegation, which is the kind
	// that splits by moving whole domains out rather than by cutting lines.
	"src/core.ts": {
		lines: 1064,
		why: "composition root; grows one accessor per milestone",
	},
	"src/managers/session-manager.ts": {
		lines: 912,
		why: "sessions + tool executions + the staleness sweep",
	},
	"src/persistence/store.ts": {
		lines: 904,
		why: "JSON, JSONL, versions, rotation and retention in one store",
	},
	"src/memory/native-memory.ts": {
		lines: 771,
		why: "parse, format and index the native memory format",
	},
	"src/research/research-index.ts": {
		lines: 718,
		why: "BM25 + vectors + hybrid fusion + snapshots",
	},
	// 692 at M2.20, from the canonical-port reclaim. Routing and ingest are the
	// natural seam if this grows again.
	"src/server/http-server.ts": {
		lines: 692,
		why: "routing + ingest + the port strategy",
	},
	"src/research/graphify.ts": {
		lines: 600,
		why: "reader, cache, analysis helpers and the build shell",
	},
};

const ROOTS = ["src"];
const EXTENSIONS = [".ts"];

/** Every source file under the swept roots, as package-relative paths. */
function sourceFiles() {
	const out = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === "node_modules" || entry.name === "dist") continue;
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
 * check against.
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
		// Without this the sweep could silently cover nothing and pass — which
		// is a smaller version of the bug that let this package go unguarded.
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
		const grown = [];
		for (const [file, { lines }] of Object.entries(OVER_LIMIT)) {
			const actual = lineCount(file);
			if (actual > lines) grown.push(`${file}: ${lines} -> ${actual}`);
		}
		assert.deepEqual(
			grown,
			[],
			"raise the recorded number deliberately, with a reason beside it",
		);
	});

	it("drops a file from the list once it is back under the limit", () => {
		// An exemption that outlives its reason is how the list stops meaning
		// anything.
		const redundant = Object.keys(OVER_LIMIT).filter(
			(f) => lineCount(f) < LIMIT,
		);
		assert.deepEqual(
			redundant,
			[],
			"these are under the limit now; remove them",
		);
	});

	it("lists no file that does not exist", () => {
		const missing = Object.keys(OVER_LIMIT).filter(
			(f) => !statSync(join(packageRoot, f), { throwIfNoEntry: false }),
		);
		assert.deepEqual(missing, [], "the allowlist names files that are gone");
	});
});
