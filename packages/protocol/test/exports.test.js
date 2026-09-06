/**
 * This package had no test script at all.
 *
 * That is why `hooks.ts` could sit here for months: 412 lines, 31 exports,
 * zero consumers anywhere, exported from the barrel, and describing a
 * subsystem that was specified and never built. Nothing ran, so nothing
 * noticed.
 *
 * Worse than dead: its `HookEvent` union was a closed list of TEN members
 * titled "All Claude Code hook event types" while the installer registered
 * THIRTY. The failure mode is silent adoption, not a crash — a second wrapper
 * (the README names JetBrains and Theia) imports it, switches exhaustively on
 * `HookEvent`, and drops twenty event types with TypeScript calling that switch
 * exhaustive, because by the type it is. And `HOOK_EVENT_DESCRIPTIONS` was
 * `Record<HookEvent, string>`, so widening the union correctly produced twenty
 * compile errors: the stale type was load-bearing against its own repair.
 *
 * It is deleted. These tests exist so the next one is caught by a machine
 * rather than by an audit.
 */

import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(packageRoot, "src");

/** Every module in src/, excluding the barrel. */
function modules() {
	return readdirSync(srcDir)
		.filter((f) => f.endsWith(".ts") && f !== "index.ts")
		.map((f) => f.replace(/\.ts$/, ""));
}

describe("the protocol barrel", () => {
	const barrel = readFileSync(join(srcDir, "index.ts"), "utf8");

	it("finds the source", () => {
		// Without this the sweep could cover nothing and pass.
		assert.ok(modules().length > 5, `only found ${modules().length} modules`);
	});

	it("exports every module in src/", () => {
		// A module the barrel does not export is unreachable to consumers, which
		// is how a type surface starts describing something nobody can use.
		const missing = modules().filter(
			(name) => !barrel.includes(`export * from "./${name}.js";`),
		);
		assert.deepEqual(missing, [], "these modules exist but nothing exports them");
	});

	it("exports nothing that is not there", () => {
		const declared = [...barrel.matchAll(/export \* from "\.\/([\w-]+)\.js";/g)].map(
			(m) => m[1],
		);
		const known = new Set(modules());
		const phantom = declared.filter((name) => !known.has(name));
		assert.deepEqual(phantom, [], "the barrel exports a module that does not exist");
	});

	it("no longer carries the hooks module", () => {
		// Specifically pinned rather than left to the general checks: this one
		// was not merely dead, it stated something false about the platform, and
		// re-adding it should be a deliberate act with a widened union.
		assert.ok(
			!barrel.includes("hooks.js"),
			"hooks.ts is back; if it is needed, HookEvent must cover every event install.sh registers",
		);
	});
});

describe("the built package", () => {
	it("loads, and exposes the types the extension actually imports", async () => {
		// Names taken from real import sites in packages/core and
		// packages/vscode. If the barrel drops one, this fails here rather than
		// in a consumer's build.
		const mod = await import("../dist/index.js");
		for (const name of [
			"ErrorCodes",
			"AUTHORED_BY",
			"INDEX_FILE",
			"INDEX_LOAD_LINES",
			"INDEX_LOAD_BYTES",
			"TRAY_FILE",
			"MAX_ITEM_BYTES",
			"WARN_CONTEXT_BYTES",
		]) {
			assert.ok(name in mod, `the barrel no longer exports ${name}`);
		}
	});
});
