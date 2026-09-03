/**
 * Incremental fetch (`since`) and backfill (`before`) for sessions.getActivity.
 *
 * Driven end-to-end against a real spawned core, because the behaviour under
 * test lives entirely in the seam between the log query and the item assembly.
 *
 * The two failure modes these guard against are both caused by the OBVIOUS
 * implementation — filtering logs by timestamp before assembling items:
 *
 *   1. A tool call whose PreToolUse falls outside the window is re-emitted
 *      under the PostToolUse's log id, so the client renders the same call
 *      twice under two different ids.
 *   2. A tool call whose PostToolUse falls outside the window is reported as
 *      still running, forever, because the completion is never delivered.
 *
 * The implementation therefore assembles the whole window and filters the
 * resulting ITEMS by when each last changed.
 */

import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

import { cleanup, makeTempStore } from "./helpers.js";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

let child;
let httpPort;
let storagePath;
let nextId = 1;
const pending = new Map();

function rpc(method, params = {}) {
	const id = nextId++;
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), 10_000);
		pending.set(id, { resolve, timer });
		child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
	});
}

async function ingest(body) {
	const res = await fetch(`http://127.0.0.1:${httpPort}/log`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	assert.equal(res.status, 200, `ingest failed: ${await res.text()}`);
}

const activity = (params) =>
	rpc("sessions.getActivity", params).then((r) => {
		assert.ok(r.result, `getActivity errored: ${JSON.stringify(r.error)}`);
		return r.result;
	});

/** A fixed clock, so tests assert on exact cursors rather than on wall time. */
const T = (n) => `2026-09-03T10:00:${String(n).padStart(2, "0")}.000Z`;

before(async () => {
	storagePath = await makeTempStore();
	child = spawn("node", [CLI], {
		stdio: ["pipe", "pipe", "pipe"],
		env: {
			...process.env,
			INSPECTOR_HOOK_STORAGE: storagePath,
			INSPECTOR_HOOK_PORT_FILE: join(storagePath, "port"),
			INSPECTOR_HOOK_HTTP_PORT: "0",
		},
	});

	let buffer = "";
	let ready;
	const readyPromise = new Promise((r) => {
		ready = r;
	});
	child.stdout.on("data", (chunk) => {
		buffer += chunk.toString();
		let idx;
		while ((idx = buffer.indexOf("\n")) !== -1) {
			const line = buffer.slice(0, idx).trim();
			buffer = buffer.slice(idx + 1);
			if (!line) continue;
			let msg;
			try {
				msg = JSON.parse(line);
			} catch {
				continue;
			}
			if (msg.type === "ready") {
				ready(msg);
				continue;
			}
			if (msg.id !== undefined && pending.has(msg.id)) {
				const { resolve, timer } = pending.get(msg.id);
				clearTimeout(timer);
				pending.delete(msg.id);
				resolve(msg);
			}
		}
	});

	const readyMsg = await readyPromise;
	httpPort = readyMsg.port;
});

after(async () => {
	child?.kill();
	await cleanup(storagePath);
});

describe("sessions.getActivity — incremental fetch", () => {
	const sid = "paging";

	before(async () => {
		// A turn: prompt, a tool that completes, then a second prompt.
		await ingest({
			hook: "SessionStart", event: "SessionStart", sessionId: sid,
			timestamp: T(1), message: "start", level: "info",
			details: { cwd: "/p", projectName: "p" },
		});
		await ingest({
			hook: "UserPromptSubmit", event: "UserPromptSubmit", sessionId: sid,
			timestamp: T(2), message: "first ask", level: "info",
			details: { prompt: "first ask", promptId: "turn-1" },
		});
		await ingest({
			hook: "PreToolUse", event: "PreToolUse", sessionId: sid,
			timestamp: T(3), message: "read", level: "info", tool: "Read",
			file: "/p/a.ts", tool_use_id: "tu-a",
			details: { promptId: "turn-1" },
		});
		await ingest({
			hook: "PostToolUse", event: "PostToolUse", sessionId: sid,
			timestamp: T(9), message: "read done", level: "info", tool: "Read",
			file: "/p/a.ts", tool_use_id: "tu-a",
			details: { promptId: "turn-1" },
		});
		await ingest({
			hook: "UserPromptSubmit", event: "UserPromptSubmit", sessionId: sid,
			timestamp: T(10), message: "second ask", level: "info",
			details: { prompt: "second ask", promptId: "turn-2" },
		});
	});

	it("returns everything, and a cursor, when no since is given", async () => {
		const res = await activity({ id: sid });
		assert.ok(res.activity.length >= 4, `got ${res.activity.length} items`);
		assert.equal(res.since, undefined);
		assert.equal(res.nextSince, T(10), "cursor is the newest change in the window");
		assert.ok(
			res.activity.every((i) => typeof i.updatedAt === "string"),
			"every item must carry updatedAt for the client's merge",
		);
	});

	it("returns only what changed after the cursor", async () => {
		const full = await activity({ id: sid });
		const incremental = await activity({ id: sid, since: T(10) });

		assert.ok(
			incremental.activity.length < full.activity.length,
			"an incremental poll must return less than everything",
		);
		assert.deepEqual(
			incremental.activity.map((i) => i.data.prompt),
			["second ask"],
			"only the item at/after the cursor",
		);
		assert.equal(incremental.since, T(10), "the response echoes the request");
	});

	it("REGRESSION: delivers a tool completion whose item STARTED before the cursor", async () => {
		// The trap. The tool_call item's own timestamp is T(3), which is before
		// the cursor, but it CHANGED at T(9) when it completed. Filtering on
		// item.timestamp would withhold the completion and the client's bubble
		// would spin forever.
		const res = await activity({ id: sid, since: T(9) });

		const tool = res.activity.find((i) => i.type === "tool_call");
		assert.ok(tool, "the completed tool call must be delivered");
		assert.equal(tool.timestamp, T(3), "it still reports when it started");
		assert.equal(tool.updatedAt, T(9), "and when it changed");
		assert.equal(tool.data.status, "completed");
	});

	it("REGRESSION: never emits a second item for one tool call", async () => {
		// Filtering LOGS by since would drop the PreToolUse and fall through to
		// the "PostToolUse without matching PreToolUse" branch, producing a
		// second tool_call under the Post log's id — the same call rendered
		// twice, under two ids the client cannot reconcile.
		const res = await activity({ id: sid, since: T(4) });

		const tools = res.activity.filter((i) => i.type === "tool_call");
		assert.equal(tools.length, 1, `one tool call, got ${tools.length}`);
		assert.equal(
			tools[0].data.executionId,
			"tu-a",
			"and it is the same execution, not a synthesised one",
		);
	});

	it("uses an INCLUSIVE cursor, because timestamps collide constantly", async () => {
		// Measured on the real capture: 984 of 2807 logs (35.1%) shared a
		// timestamp with another log, one timestamp covering 12 of them. An
		// exclusive cursor would silently drop every item sharing the boundary
		// instant. The cost is a re-sent boundary item; the client merges by id.
		const res = await activity({ id: sid, since: T(10) });
		assert.equal(
			res.activity.length,
			1,
			"the item exactly at the cursor is returned, not skipped",
		);
	});

	it("delivers every item across two same-millisecond events", async () => {
		const collide = "collide";
		for (const n of [1, 2, 3]) {
			await ingest({
				hook: "UserPromptSubmit", event: "UserPromptSubmit", sessionId: collide,
				timestamp: T(20), message: `same-ms ${n}`, level: "info",
				details: { prompt: `same-ms ${n}` },
			});
		}

		const res = await activity({ id: collide, since: T(20) });
		assert.equal(
			res.activity.filter((i) => i.type === "user_prompt").length,
			3,
			"all three share one timestamp and all three must arrive",
		);
	});

	it("advances the cursor even when the poll returns nothing", async () => {
		// Otherwise a caller that filtered everything out gets its own cursor
		// back and re-requests the same window forever.
		const res = await activity({ id: sid, since: "2099-01-01T00:00:00.000Z" });
		assert.equal(res.activity.length, 0, "nothing is newer");
		assert.equal(res.nextSince, T(10), "but the cursor still reports the window");
	});

	it("is stable: polling with the returned cursor converges", async () => {
		const first = await activity({ id: sid });
		const second = await activity({ id: sid, since: first.nextSince });
		const third = await activity({ id: sid, since: second.nextSince });

		assert.equal(second.nextSince, first.nextSince, "cursor does not drift");
		assert.deepEqual(
			third.activity.map((i) => i.id),
			second.activity.map((i) => i.id),
			"a settled feed returns the same boundary items, not a growing set",
		);
	});

	it("an unknown session yields an empty feed rather than an error", async () => {
		const res = await activity({ id: "no-such-session", since: T(1) });
		assert.deepEqual(res.activity, []);
		assert.equal(res.nextSince, undefined);
	});
});

describe("sessions.getActivity — backfill", () => {
	const sid = "backfill";

	before(async () => {
		for (let n = 30; n <= 39; n++) {
			await ingest({
				hook: "UserPromptSubmit", event: "UserPromptSubmit", sessionId: sid,
				timestamp: T(n), message: `ask ${n}`, level: "info",
				details: { prompt: `ask ${n}` },
			});
		}
	});

	it("before returns only older items", async () => {
		const res = await activity({ id: sid, before: T(35) });
		assert.ok(res.activity.length > 0);
		assert.ok(
			res.activity.every((i) => i.timestamp <= T(35)),
			"nothing at or after the boundary leaks into a backfill page",
		);
	});

	it("walks backwards without gaps or repeats", async () => {
		const page1 = await activity({ id: sid, limit: 4 });
		const oldest1 = page1.activity[0].timestamp;

		const page2 = await activity({ id: sid, before: oldest1, limit: 4 });

		const ids1 = new Set(page1.activity.map((i) => i.id));
		const overlap = page2.activity.filter((i) => ids1.has(i.id));
		assert.ok(
			page2.activity.length > 0,
			"there must be older items to walk back to",
		);
		assert.ok(
			page2.activity.every((i) => i.timestamp <= oldest1),
			"page 2 is strictly older",
		);
		// An overlap of at most the boundary instant is expected and harmless;
		// a large overlap would mean the cursor is not advancing.
		assert.ok(overlap.length <= 1, `unexpected overlap of ${overlap.length}`);
	});

	it("reports hasMore while older items remain", async () => {
		const small = await activity({ id: sid, limit: 3 });
		assert.equal(small.hasMore, true, "10 items, window of 3");
		assert.equal(small.truncated, true, "and truncated agrees");

		const all = await activity({ id: sid, limit: 500 });
		assert.notEqual(all.hasMore, true, "a full window is not truncated");
	});

	it("limit is clamped rather than trusted", async () => {
		for (const limit of [0, -5, 10_000_000, "abc"]) {
			const res = await activity({ id: sid, limit });
			assert.ok(Array.isArray(res.activity), `limit ${limit} must not throw`);
		}
	});
});
