/**
 * Every asset the webview asks for exists.
 *
 * `webview-html.ts` emits real <link>/<script> tags, and a path that does not
 * exist is a 404 the webview ignores. That tolerance is deliberate — it lets a
 * large view be split one module at a time without a broken intermediate state
 * — but it also means a typo, a rename or an abandoned plan costs nothing at
 * load time and is invisible forever after.
 *
 * Two entries had been sitting in the manifests naming files that were never
 * written: `styles/shared/diff.css` and `scripts/shared/session-accordion.js`.
 * Neither was mid-split; they were simply wrong, and the comment justifying the
 * tolerance was keeping them alive.
 *
 * So the tolerance stays and gains a receipt: a missing file is legal only
 * while it is named in PENDING, with a reason. Same idiom as
 * AWAITING_EXTENSION_WIRING in message-contract.test.js, which exists so an
 * exemption cannot outlive its gap.
 */

import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const htmlSource = readFileSync(join(packageRoot, "src", "webview-html.ts"), "utf8");

/**
 * Assets deliberately named before they are written, each with the reason.
 *
 * Empty is the healthy state. An entry here is a promise to add the file.
 */
const PENDING = {
	// e.g. "scripts/tray/tray-host.js": "tray lands in P3",
};

/**
 * Pull one `const <name>: string[][] = [ … ];` manifest out of the source.
 *
 * Parsed from the source rather than imported: the module imports `vscode`,
 * which does not exist outside the extension host, so evaluating it here is not
 * an option. The manifests are plain literals, which makes this safe to read
 * textually.
 */
function manifest(name) {
	const block = new RegExp(
		`const ${name}: string\\[\\]\\[\\] = \\[([\\s\\S]*?)\\n\\t\\];`,
	).exec(htmlSource);
	assert.ok(block, `could not find the ${name} manifest`);

	const entries = [];
	for (const match of block[1].matchAll(/\[([^\]]*)\]/g)) {
		const parts = [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
		if (parts.length) entries.push(parts.join("/"));
	}
	return entries;
}

describe("webview asset manifests", () => {
	const styles = manifest("styles");
	const scripts = manifest("scripts");
	const all = [...styles, ...scripts];

	it("parses both manifests", () => {
		// A regex that silently matched nothing would make every other
		// assertion here vacuously true.
		assert.ok(styles.length > 5, `only parsed ${styles.length} stylesheets`);
		assert.ok(scripts.length > 15, `only parsed ${scripts.length} scripts`);
	});

	it("names only files that exist", () => {
		const missing = all
			.filter((relPath) => !(relPath in PENDING))
			.filter((relPath) => !existsSync(join(packageRoot, "media", relPath)));
		assert.deepEqual(missing, [], "manifest names a file that is not there");
	});

	it("has no stale PENDING entry", () => {
		const landed = Object.keys(PENDING).filter((relPath) =>
			existsSync(join(packageRoot, "media", relPath)),
		);
		assert.deepEqual(landed, [], "these exist now; remove them from PENDING");
	});

	it("does not list PENDING files that no manifest asks for", () => {
		const orphan = Object.keys(PENDING).filter((relPath) => !all.includes(relPath));
		assert.deepEqual(orphan, [], "PENDING names an asset nothing loads");
	});

	it("lists each asset exactly once", () => {
		// A duplicate <script> tag re-evaluates a module, which for these
		// classic scripts means re-running every top-level assignment.
		const seen = new Set();
		const dupes = all.filter((p) => (seen.has(p) ? true : (seen.add(p), false)));
		assert.deepEqual(dupes, [], "asset listed more than once");
	});
});
