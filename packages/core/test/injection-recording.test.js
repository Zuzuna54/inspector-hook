/**
 * The hooks record what they DELIVER (P10).
 *
 * Run as the shell scripts they are, against a real store, because that is the
 * only thing that proves anything: the whole mechanism is bash and jq, and the
 * core never sees the delivery at all.
 *
 * The property being guarded is the one the plan is explicit about — this log
 * answers "what was injected INTO this session", which is NOT what
 * `StagedContext.sourceSessionId` records. That field names the session the
 * text came FROM, usually a different one.
 *
 * Two failure shapes matter more than the happy path:
 *
 *   - a hook that records but stops injecting. Bookkeeping must never cost a
 *     session its context, so recording happens after the text is emitted and
 *     every path still exits 0.
 *   - a `pinned` payload that looks like one injection. It fires on every
 *     prompt, and only a delivery-time record shows that.
 */

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { readInjections } from "../dist/index.js";
import { cleanup, makeTempStore } from "./helpers.js";

const hooksDir = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"hooks",
	"claude",
);
const PROMPT_HOOK = join(hooksDir, "inspector-prompt-context.sh");
const START_HOOK = join(hooksDir, "inspector-context.sh");

const SID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const dirs = [];
after(async () => {
	await Promise.all(dirs.map(cleanup));
});

async function store() {
	const basePath = await makeTempStore();
	dirs.push(basePath);
	await mkdir(join(basePath, "context", "now"), { recursive: true });
	await mkdir(join(basePath, "context", "pinned"), { recursive: true });
	return basePath;
}

function future() {
	return new Date(Date.now() + 2 * 3600_000).toISOString();
}

/**
 * Run a hook with stdin, synchronously.
 *
 * spawnSync rather than execFile: only the sync API accepts `input`, and
 * execFile leaves stdin open, which makes the script's `cat` block forever.
 */
function run(hook, basePath, sessionId = SID) {
	return spawnSync("bash", [hook], {
		input: sessionId ? JSON.stringify({ session_id: sessionId }) : "",
		env: { ...process.env, INSPECTOR_HOOK_STORAGE: basePath },
		encoding: "utf-8",
	});
}

async function payload(path, text, label) {
	await writeFile(
		path,
		JSON.stringify({ text, expiresAt: future(), ...(label ? { label } : {}) }),
		"utf-8",
	);
}

const haveJq = spawnSync("jq", ["--version"]).status === 0;

describe("the SessionStart hook records its delivery", {
	skip: !haveJq,
}, () => {
	it("writes one record, and still injects the text", async () => {
		const basePath = await store();
		await payload(
			join(basePath, "pending-context.json"),
			"seeded body",
			"Auth bundle",
		);

		const result = run(START_HOOK, basePath);
		assert.equal(result.status, 0, "the hook must never fail a session");
		assert.match(
			result.stdout,
			/seeded body/,
			"recording cost the session its context",
		);

		const { records } = await readInjections(basePath);
		assert.equal(records.length, 1);
		assert.equal(records[0].tier, "next-session");
		assert.equal(records[0].sessionId, SID);
		assert.equal(records[0].label, "Auth bundle");
		assert.ok(records[0].bytes > 0);
	});

	it("still injects when no session id arrives, and records nothing", async () => {
		// The id is best-effort. A hook that refused to inject without one would
		// trade a working feature for bookkeeping.
		const basePath = await store();
		await payload(join(basePath, "pending-context.json"), "seeded body");

		const result = run(START_HOOK, basePath, "");
		assert.equal(result.status, 0);
		assert.match(
			result.stdout,
			/seeded body/,
			"context was withheld for want of an id",
		);

		const { records } = await readInjections(basePath);
		assert.equal(records.length, 0);
	});

	it("records nothing when there was nothing to inject", async () => {
		const basePath = await store();
		const result = run(START_HOOK, basePath);
		assert.equal(result.status, 0);
		const { records } = await readInjections(basePath);
		assert.deepEqual(records, []);
	});

	it("refuses a session id that is not one a store would use", async () => {
		const basePath = await store();
		await payload(join(basePath, "pending-context.json"), "seeded body");
		const result = run(START_HOOK, basePath, "../../etc/passwd");
		assert.equal(result.status, 0);
		assert.match(result.stdout, /seeded body/);
		const { records } = await readInjections(basePath);
		assert.equal(records.length, 0, "an unvalidated id reached the record");
	});
});

describe("the prompt hook records both tiers", { skip: !haveJq }, () => {
	it("records `now` once — it is consumed", async () => {
		const basePath = await store();
		await payload(
			join(basePath, "context", "now", `${SID}.json`),
			"now body",
			"Tray now",
		);

		run(PROMPT_HOOK, basePath);
		run(PROMPT_HOOK, basePath);

		const { records } = await readInjections(basePath);
		assert.equal(records.length, 1, "a one-shot was recorded twice");
		assert.equal(records[0].tier, "now");
		assert.equal(records[0].label, "Tray now");
	});

	it("records `pinned` on EVERY prompt, which is the cost it exists to show", async () => {
		// Arming happened once. Three prompts is three deliveries and three
		// times the bytes, and nothing else in the system can say so.
		const basePath = await store();
		await payload(
			join(basePath, "context", "pinned", `${SID}.json`),
			"pinned body",
			"Tray pinned",
		);

		run(PROMPT_HOOK, basePath);
		run(PROMPT_HOOK, basePath);
		run(PROMPT_HOOK, basePath);

		const { records } = await readInjections(basePath);
		assert.equal(records.length, 3);
		assert.ok(records.every((r) => r.tier === "pinned"));
	});

	it("does not record a delivery for a different session", async () => {
		// A hook registered for a project fires for every session in it. The
		// record must describe the session that actually received the text.
		const basePath = await store();
		await payload(join(basePath, "context", "now", `${SID}.json`), "now body");

		run(PROMPT_HOOK, basePath, "11111111-2222-3333-4444-555555555555");

		const { records } = await readInjections(basePath);
		assert.deepEqual(records, [], "a non-delivery was recorded as one");
	});

	it("records nothing for an expired payload", async () => {
		const basePath = await store();
		await writeFile(
			join(basePath, "context", "now", `${SID}.json`),
			JSON.stringify({
				text: "stale",
				expiresAt: new Date(Date.now() - 3600_000).toISOString(),
			}),
			"utf-8",
		);
		run(PROMPT_HOOK, basePath);
		const { records } = await readInjections(basePath);
		assert.deepEqual(
			records,
			[],
			"an expired payload was recorded as delivered",
		);
	});
});

describe("the hooks stay safe", { skip: !haveJq }, () => {
	it("the SessionStart hook returns promptly when stdin never closes", async () => {
		// A REGRESSION, and a bad one. This hook read no stdin for its whole
		// life; adding an unguarded `cat` made it block forever whenever stdin
		// was an open pipe with no data and no EOF. It hung this suite for
		// minutes on the first run, and in production it would hang the start
		// of a session — the failure the read exists to be careful about.
		//
		// A `[ -t 0 ]` check does not catch it: an open pipe is not a terminal.
		// The read is bounded instead.
		const basePath = await store();
		await payload(join(basePath, "pending-context.json"), "seeded body");

		const started = Date.now();
		const result = spawnSync("bash", [START_HOOK], {
			// No `input` at all: stdin is an open pipe that never delivers EOF.
			env: { ...process.env, INSPECTOR_HOOK_STORAGE: basePath },
			encoding: "utf-8",
			timeout: 10_000,
		});
		const elapsed = Date.now() - started;

		assert.equal(result.status, 0, "the hook did not exit cleanly");
		assert.ok(elapsed < 5_000, `the hook took ${elapsed}ms — it is blocking on stdin`);
		assert.match(result.stdout, /seeded body/, "it stopped injecting");
	});

	it("both scripts parse", () => {
		for (const hook of [START_HOOK, PROMPT_HOOK]) {
			assert.ok(existsSync(hook), `${hook} is missing`);
			assert.equal(
				spawnSync("bash", ["-n", hook]).status,
				0,
				`${hook} has a syntax error`,
			);
		}
	});

	it("neither writes the payload text into the log", () => {
		// The text lives in the tray, the bundle and the transcript already, and
		// a long line breaks the atomicity an append relies on.
		for (const hook of [START_HOOK, PROMPT_HOOK]) {
			const src = readFileSync(hook, "utf-8");
			assert.ok(
				!/--arg text|"text":\s*\$/.test(src),
				`${hook} records the payload text`,
			);
		}
	});
});
