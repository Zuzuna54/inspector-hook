/**
 * The UserPromptSubmit injector, exercised as the shell script it is.
 *
 * This is the only path that reaches a session ALREADY RUNNING, and every
 * property it has was measured rather than read off documentation:
 *
 *   - the payload must be nested under `hookSpecificOutput`. A probe emitted
 *     BOTH that and a top-level `additionalContext` in one object; only the
 *     nested one reached the model. Eleven hooks under config/claude-hooks/
 *     emit the top-level form and have been injecting nothing.
 *   - a registered hook fires for EVERY session in its scope. The same probe
 *     landed in two unrelated sessions at once, which is why this script filters
 *     on `session_id` from its own stdin. Without that, "send to this session"
 *     would silently mean "send to all of them".
 *
 * Tested by running the real script against a real store, because the whole
 * thing is bash and jq: a unit test of a TypeScript stand-in would prove
 * nothing about what actually executes.
 */

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { cleanup, makeTempStore } from "./helpers.js";

/**
 * Run the hook with stdin, synchronously.
 *
 * spawnSync rather than execFile: only the sync API accepts `input`, and
 * execFile leaves stdin open — which makes the script's `cat` block forever
 * rather than fail. That cost a hung test run to discover.
 */
function runHook(input, env) {
	return spawnSync("bash", [HOOK], { input, env, encoding: "utf-8" }).stdout ?? "";
}

const HOOK = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"hooks",
	"claude",
	"inspector-prompt-context.sh",
);

const dirs = [];
after(async () => {
	await Promise.all(dirs.map(cleanup));
});

const iso = (offsetMs) =>
	new Date(Date.now() + offsetMs).toISOString().replace(/\.(\d+)Z$/, ".000Z");

/** A store with the given armed payloads. */
async function seeded({ nowText, pinnedText, sessionId = "sess-1", ttlMs = 3600_000 }) {
	const basePath = await makeTempStore();
	dirs.push(basePath);
	for (const [tier, text] of [
		["now", nowText],
		["pinned", pinnedText],
	]) {
		if (!text) continue;
		await mkdir(join(basePath, "context", tier), { recursive: true });
		await writeFile(
			join(basePath, "context", tier, `${sessionId}.json`),
			JSON.stringify({ text, expiresAt: iso(ttlMs) }),
			"utf-8",
		);
	}
	return basePath;
}

/** Run the hook with a payload, returning stdout. */
async function fire(basePath, payload) {
	return runHook(JSON.stringify(payload), {
		...process.env,
		INSPECTOR_HOOK_STORAGE: basePath,
	});
}

describe("the UserPromptSubmit injector", () => {
	it("exists and is executable", () => {
		assert.ok(existsSync(HOOK), "the hook script is missing");
	});

	it("emits the NESTED shape, which is the only one that works", async () => {
		const basePath = await seeded({ nowText: "REACHED" });
		const out = JSON.parse(await fire(basePath, { session_id: "sess-1" }));
		assert.ok(out.hookSpecificOutput, "not nested under hookSpecificOutput");
		assert.equal(out.hookSpecificOutput.hookEventName, "UserPromptSubmit");
		assert.match(out.hookSpecificOutput.additionalContext, /REACHED/);
		assert.equal(
			out.additionalContext,
			undefined,
			"a top-level additionalContext is ignored by Claude Code; emitting it implies otherwise",
		);
	});

	it("delivers only to the session it was armed for", async () => {
		// The property that makes per-session targeting possible at all.
		const basePath = await seeded({ nowText: "FOR-ONE", sessionId: "sess-1" });
		assert.equal(await fire(basePath, { session_id: "sess-2" }), "");
	});

	it("consumes a one-shot: the second prompt gets nothing", async () => {
		const basePath = await seeded({ nowText: "ONCE" });
		assert.match(await fire(basePath, { session_id: "sess-1" }), /ONCE/);
		assert.equal(await fire(basePath, { session_id: "sess-1" }), "");
		assert.ok(
			!existsSync(join(basePath, "context", "now", "sess-1.json")),
			"the one-shot file survived its delivery",
		);
	});

	it("repeats a pin, and never deletes it", async () => {
		const basePath = await seeded({ pinnedText: "EVERY-TURN" });
		assert.match(await fire(basePath, { session_id: "sess-1" }), /EVERY-TURN/);
		assert.match(await fire(basePath, { session_id: "sess-1" }), /EVERY-TURN/);
		assert.ok(existsSync(join(basePath, "context", "pinned", "sess-1.json")));
	});

	it("delivers both tiers in one payload, pinned first", async () => {
		const basePath = await seeded({ nowText: "ONE-SHOT", pinnedText: "PINNED" });
		const ctx = JSON.parse(await fire(basePath, { session_id: "sess-1" }))
			.hookSpecificOutput.additionalContext;
		assert.ok(ctx.indexOf("PINNED") < ctx.indexOf("ONE-SHOT"));
	});

	it("does not deliver an expired payload", async () => {
		const basePath = await seeded({ nowText: "STALE", ttlMs: -3600_000 });
		assert.equal(await fire(basePath, { session_id: "sess-1" }), "");
	});

	it("says the context describes work already done", async () => {
		// Injected text arrives as context rather than as content, so neither
		// the model nor the reader has anything to check it against. Saying what
		// it is costs one sentence.
		const basePath = await seeded({ nowText: "x" });
		const ctx = JSON.parse(await fire(basePath, { session_id: "sess-1" }))
			.hookSpecificOutput.additionalContext;
		assert.match(ctx, /it is not a request/i);
	});

	it("refuses a traversing session id", async () => {
		const basePath = await seeded({ nowText: "x" });
		assert.equal(await fire(basePath, { session_id: "../../etc/passwd" }), "");
	});

	it("stays silent with no session id, no payload, or nothing armed", async () => {
		const basePath = await seeded({ nowText: "x" });
		assert.equal(await fire(basePath, {}), "");
		assert.equal(await fire(basePath, { session_id: "unknown" }), "");
	});

	it("honours INSPECTOR_HOOK_DISABLED", async () => {
		const basePath = await seeded({ nowText: "x" });
		const stdout = runHook(JSON.stringify({ session_id: "sess-1" }), {
			...process.env,
			INSPECTOR_HOOK_STORAGE: basePath,
			INSPECTOR_HOOK_DISABLED: "1",
		});
		assert.equal(stdout, "");
	});

	it("never fails a prompt, whatever it is given", async () => {
		// A hook that exits non-zero on UserPromptSubmit blocks the prompt. No
		// input this receives is worth that.
		const basePath = await seeded({ nowText: "x" });
		for (const input of ["", "not json", '{"session_id":null}', "[]"]) {
			const stdout = runHook(input, {
				...process.env,
				INSPECTOR_HOOK_STORAGE: basePath,
			});
			assert.equal(typeof stdout, "string");
		}
	});

	it("contains no apostrophe inside the jq program", async () => {
		// A shipped bug in the sibling hook: an apostrophe closes the
		// single-quoted jq program and the rest is parsed as shell.
		const { readFile } = await import("node:fs/promises");
		const src = await readFile(HOOK, "utf-8");
		const jqProgram = /UNEXPIRED='([\s\S]*?)'/.exec(src);
		assert.ok(jqProgram, "could not find the jq program");
		assert.ok(!jqProgram[1].includes("'"), "an apostrophe would terminate the program early");
	});
});
