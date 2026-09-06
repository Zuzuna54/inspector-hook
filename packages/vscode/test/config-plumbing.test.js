/**
 * REGRESSION B5 — configuration reaches the core.
 *
 * B5 was "config plumbing dead": `inspectorHook.httpPort` was read from settings
 * and never passed to the spawned core, and the workspace root handed over was
 * VS Code's GLOBAL STORAGE path rather than the folder the user has open. So a
 * configured port did nothing, and the core resolved every relative path
 * against the wrong directory.
 *
 * It was the one bug of B1-B5 with no named regression test, which is how a
 * fixed bug quietly becomes an unfixed one again.
 *
 * Asserted over the source rather than by spawning VS Code: the defect is
 * entirely about which values are passed at two call sites, and an extension
 * host cannot be started from `node --test`. Comments are stripped first, so a
 * comment describing the old behaviour cannot satisfy the check — a trap this
 * project has already fallen into twice.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

/** Read a source file with comments removed. */
function code(name) {
	return readFileSync(join(SRC, name), "utf-8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");
}

describe("REGRESSION B5: config plumbing", () => {
	it("the configured HTTP port is passed to the spawned core", () => {
		const bridge = code("core-bridge.ts");
		assert.match(
			bridge,
			/INSPECTOR_HOOK_HTTP_PORT:\s*String\(this\.options\.httpPort\)/,
			"httpPort must reach the child process, or the setting does nothing",
		);
	});

	it("the workspace root passed is the user's folder, not global storage", () => {
		const extension = code("extension.ts");
		assert.match(
			extension,
			/workspaceRoot:\s*vscode\.workspace\.workspaceFolders/,
			"the core must be told the open folder",
		);
		assert.doesNotMatch(
			extension,
			/workspaceRoot:\s*context\.globalStorage/,
			"global storage is where state lives, not where the user's code is",
		);
	});

	it("no workspace folder means no workspace variable, not a placeholder", () => {
		// The earlier fallback was process.cwd(), which for the extension host is
		// "/" -- so with no folder open the core was told the workspace root was
		// the filesystem root and resolved every relative path against it.
		const bridge = code("core-bridge.ts");
		assert.match(
			bridge,
			/this\.options\.workspaceRoot\s*\?\s*\{\s*INSPECTOR_HOOK_WORKSPACE/,
			"the variable must be omitted rather than sent as a guess",
		);
		assert.doesNotMatch(bridge, /INSPECTOR_HOOK_WORKSPACE:\s*process\.cwd\(\)/);
	});

	it("the port setting is actually read from configuration", () => {
		const extension = code("extension.ts");
		assert.match(
			extension,
			/httpPort/,
			"a setting that is never read is the other half of the same bug",
		);
	});
});

describe("REGRESSION: session memory has a reachable switch", () => {
	// M3's write path is gated on INSPECTOR_HOOK_SESSION_MEMORY, which the core
	// reads from its environment. CoreBridge forwarded only `...process.env`,
	// and no VS Code setting existed — so the ONLY way to enable the feature was
	// to launch VS Code itself from a shell with the variable exported. The
	// feature was unreachable from inside the editor by construction, which is
	// the same class as B5: a setting that exists and reaches nothing.

	it("the extension declares the setting", () => {
		const manifest = JSON.parse(
			readFileSync(join(SRC, "..", "package.json"), "utf-8"),
		);
		const props = manifest.contributes.configuration.properties;
		const setting = props["inspectorHook.writeSessionMemory"];
		assert.ok(setting, "a user must be able to find this in Settings");
		assert.equal(setting.default, false, "off by default — it writes to the user's own memory");
	});

	it("the extension reads it and passes it to CoreBridge", () => {
		const ext = code("extension.ts");
		assert.match(ext, /config\.get<boolean>\("writeSessionMemory"/);
		assert.match(ext, /writeSessionMemory,/, "and forwards it into the options");
	});

	it("CoreBridge forwards it to the spawned core EXPLICITLY", () => {
		// Inheriting it via ...process.env is what made it unreachable.
		const bridge = code("core-bridge.ts");
		assert.match(
			bridge,
			/INSPECTOR_HOOK_SESSION_MEMORY:\s*"1"/,
			"the env var must be set from the option, not inherited",
		);
	});

	it("the flag is reported in core status, so a UI can show it", () => {
		// "No digests exist" and "digests are broken" look identical from
		// outside. For most of this feature's life the second was true while the
		// first was assumed.
		const core = readFileSync(
			join(SRC, "..", "..", "core", "src", "core.ts"),
			"utf-8",
		);
		assert.match(core, /writeSessionMemory: this\.config\.writeSessionMemory/);
	});
});
