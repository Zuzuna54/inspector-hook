/**
 * The explicit context picker (M3 item 5), core side and hook side.
 *
 * This is the one place in the project that writes text a future model reads as
 * fact, so the tests are about its refusals more than its successes: expiry,
 * one-shot consumption, corrupt input, and the absence of any automatic path.
 *
 * The hook is exercised as a real subprocess. It has to be — the failure that
 * matters is silent emptiness, and the last two bugs in it (a jq date parse
 * that rejected fractional seconds, and an apostrophe closing the bash string)
 * were both invisible to anything short of running it.
 */

import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { after, describe, it } from "node:test";

import {
	DEFAULT_TTL_MS,
	MAX_CONTEXT_BYTES,
	clearStagedContext,
	readStagedContext,
	stageContext,
	stagedContextPath,
} from "../dist/index.js";
import { cleanup, makeTempStore } from "./helpers.js";

const run = promisify(execFile);
const HOOK = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..", "..", "hooks", "claude", "inspector-context.sh",
);

const dirs = [];
after(async () => {
	await Promise.all(dirs.map(cleanup));
});

async function newStore() {
	const dir = await makeTempStore();
	dirs.push(dir);
	return dir;
}

/** Run the SessionStart hook against a store and return its stdout. */
async function runHook(storagePath) {
	const { stdout } = await run("bash", [HOOK], {
		env: { ...process.env, INSPECTOR_HOOK_STORAGE: storagePath },
	});
	return stdout;
}

describe("stageContext", () => {
	it("stores exactly the text that will be injected", async () => {
		// No templating between preview and delivery: a preview that differs
		// from what lands is worse than no preview at all.
		const dir = await newStore();
		const text = "Fixed retention. Files: store.ts, log-manager.ts";

		const staged = await stageContext(dir, { text, label: "proj — today" });

		assert.equal(staged.text, text);
		const back = await readStagedContext(dir);
		assert.equal(back.text, text);
		assert.equal(back.label, "proj — today");
	});

	it("sets an expiry, and never leaves one open-ended", async () => {
		const dir = await newStore();
		const staged = await stageContext(dir, { text: "x" });

		const ttl = Date.parse(staged.expiresAt) - Date.parse(staged.stagedAt);
		assert.equal(ttl, DEFAULT_TTL_MS);
	});

	it("treats an entry with no expiry as expired, not as forever", async () => {
		// An unbounded injection is the outcome this module exists to avoid, so
		// a missing expiry must fail closed.
		const dir = await newStore();
		await writeFile(
			stagedContextPath(dir),
			JSON.stringify({ text: "no expiry recorded" }),
			"utf-8",
		);

		assert.equal(await readStagedContext(dir), null);
	});

	it("reports as absent once expired", async () => {
		const dir = await newStore();
		await stageContext(dir, { text: "x", ttlMs: 1000 });

		assert.ok(await readStagedContext(dir), "live now");
		assert.equal(
			await readStagedContext(dir, Date.now() + 2000),
			null,
			"a forgotten pick must not surface in an unrelated session later",
		);
	});

	it("truncates on a byte budget and says that it did", async () => {
		const dir = await newStore();
		const staged = await stageContext(dir, { text: "x".repeat(MAX_CONTEXT_BYTES * 2) });

		assert.equal(staged.truncated, true, "truncation must be reported");
		assert.ok(
			Buffer.byteLength(staged.text, "utf-8") <= MAX_CONTEXT_BYTES,
			"and actually respected",
		);
		assert.match(staged.text, /\[truncated by Inspector Hook\]/);
	});

	it("does not split a multi-byte character when truncating", async () => {
		// A naive slice on .length lets 4-byte characters through at 4x the
		// budget, and a naive slice on bytes produces a replacement character.
		const dir = await newStore();
		const emoji = "🙂";
		const staged = await stageContext(dir, {
			text: emoji.repeat(MAX_CONTEXT_BYTES),
		});

		assert.ok(Buffer.byteLength(staged.text, "utf-8") <= MAX_CONTEXT_BYTES);
		assert.ok(
			!staged.text.includes("�"),
			"no replacement character, so the cut landed on a boundary",
		);
	});

	it("returns null for a corrupt staging file rather than injecting it", async () => {
		const dir = await newStore();
		await writeFile(stagedContextPath(dir), "{ not json", "utf-8");

		assert.equal(await readStagedContext(dir), null);
	});

	it("returns null for empty text", async () => {
		const dir = await newStore();
		await writeFile(
			stagedContextPath(dir),
			JSON.stringify({ text: "", expiresAt: "2099-01-01T00:00:00.000Z" }),
			"utf-8",
		);
		assert.equal(await readStagedContext(dir), null);
	});

	it("leaves no temp file behind", async () => {
		const dir = await newStore();
		await stageContext(dir, { text: "x" });
		// The staged file must be readable under its final name, which is what a
		// SessionStart firing mid-write depends on.
		const raw = await readFile(stagedContextPath(dir), "utf-8");
		assert.ok(JSON.parse(raw).text);
	});

	it("clearStagedContext discards a pick, and is safe when there is none", async () => {
		const dir = await newStore();
		await stageContext(dir, { text: "x" });

		assert.equal(await clearStagedContext(dir), true);
		assert.equal(await readStagedContext(dir), null);
		assert.equal(await clearStagedContext(dir), false, "no throw on a second call");
	});
});

describe("the SessionStart hook", () => {
	it("emits the staged text, with provenance", async () => {
		const dir = await newStore();
		await stageContext(dir, {
			text: "Fixed the retention bug.",
			sourceSessionId: "abc-123",
			label: "inspector-hook — 2026-09-03",
		});

		const out = await runHook(dir);

		assert.match(out, /## Context from a previous session/);
		assert.match(out, /Fixed the retention bug\./);
		assert.match(out, /abc-123/, "the source session is named");
		assert.match(
			out,
			/it is not a request/,
			"and it is framed as history, not as an instruction",
		);
	});

	it("REGRESSION: parses an expiry written by toISOString()", async () => {
		// This shipped broken once. jq's fromdateiso8601 REJECTS fractional
		// seconds, and Date.prototype.toISOString always emits them -- so every
		// entry parsed as 0, compared as expired, and the hook emitted nothing
		// while its one-shot delete worked perfectly. Silently inert, and
		// invisible to anything that did not run it and check stdout.
		const dir = await newStore();
		const staged = await stageContext(dir, { text: "milliseconds present" });
		assert.match(staged.expiresAt, /\.\d{3}Z$/, "the fixture has fractional seconds");

		assert.match(await runHook(dir), /milliseconds present/);
	});

	it("is one-shot: a pick cannot repeat into later sessions", async () => {
		// The worst failure this could have. It would be silent, permanent and
		// inherited by every future session.
		const dir = await newStore();
		await stageContext(dir, { text: "once only" });

		assert.match(await runHook(dir), /once only/);
		assert.equal(await runHook(dir), "", "second start gets nothing");
		assert.equal(await readStagedContext(dir), null, "and the file is gone");
	});

	it("consumes the file even when it emits nothing", async () => {
		// Delete-before-print, deliberately: a crash then loses one injection
		// instead of making it permanent.
		const dir = await newStore();
		await writeFile(
			stagedContextPath(dir),
			JSON.stringify({ text: "stale", expiresAt: "2020-01-01T00:00:00.000Z" }),
			"utf-8",
		);

		assert.equal(await runHook(dir), "", "expired, so nothing is emitted");
		assert.equal(await readStagedContext(dir), null, "but it is not left to retry");
	});

	it("emits nothing, and exits 0, for every malformed input", async () => {
		// A session must never fail because of this hook.
		for (const body of ["", "not json", "null", "[]", '{"text":123}', "{}"]) {
			const dir = await newStore();
			await writeFile(stagedContextPath(dir), body, "utf-8");
			assert.equal(await runHook(dir), "", `should be silent for: ${body}`);
		}
	});

	it("emits nothing when nothing is staged", async () => {
		assert.equal(await runHook(await newStore()), "");
	});

	it("respects INSPECTOR_HOOK_DISABLED", async () => {
		const dir = await newStore();
		await stageContext(dir, { text: "should not appear" });

		const { stdout } = await run("bash", [HOOK], {
			env: {
				...process.env,
				INSPECTOR_HOOK_STORAGE: dir,
				INSPECTOR_HOOK_DISABLED: "1",
			},
		});
		assert.equal(stdout, "");
	});

	it("contains no apostrophe inside its jq program", async () => {
		// A single apostrophe closes the surrounding bash string and kills the
		// hook silently. That bug has already shipped once in this repo, and was
		// reintroduced while writing this file.
		const source = await readFile(HOOK, "utf-8");
		const start = source.indexOf("jq -r '") + 7;
		const program = source.slice(start, source.indexOf("' 2>/dev/null", start));
		assert.ok(program.length > 0, "found the jq program");
		assert.ok(!program.includes("'"), "no apostrophe may appear inside it");
	});
});

describe("there is no automatic staging path", () => {
	it("nothing writes a staged context except an explicit call", async () => {
		// The property, asserted over the source: injected text reaches a future
		// model as fact with nothing to check it against, so an automatic path
		// would be a silent, compounding error. Native auto memory already
		// covers the automatic case from the user's own curated corpus.
		const roots = ["src/core.ts", "src/cli.ts", "src/managers", "src/server"];
		const { readdir, readFile: rf } = await import("node:fs/promises");
		const base = resolve(dirname(fileURLToPath(import.meta.url)), "..");

		const files = [];
		for (const entry of roots) {
			const full = join(base, entry);
			try {
				const names = await readdir(full);
				for (const n of names) if (n.endsWith(".ts")) files.push(join(full, n));
			} catch {
				files.push(full); // it was a file, not a directory
			}
		}

		for (const file of files) {
			const source = await rf(file, "utf-8").catch(() => "");
			// Comments stripped first: a source-level assertion that matches its
			// own explanation is a check that can only be satisfied by rewording.
			const code = source
				.replace(/\/\*[\s\S]*?\*\//g, "")
				.replace(/^\s*\/\/.*$/gm, "");
			assert.ok(
				!code.includes("stageContext("),
				`${file} stages context automatically; staging must be user-initiated`,
			);
		}
	});
});
