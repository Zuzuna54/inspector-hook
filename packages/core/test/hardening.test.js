/**
 * Tests for the hardening pass: retention, rate limiting, secret redaction,
 * and honest session statistics.
 *
 * Three of these four were features the code CLAIMED to have. retentionDays was
 * read, threaded through three layers and never used; getSessionStats returned
 * hardcoded zeros; the rate limit the spec called for did not exist. Tests here
 * assert the behaviour actually happens, not just that the option is accepted.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
	LogManager,
	PersistenceStore,
	RateLimiter,
	SessionManager,
	redactPayload,
	redactString,
} from "../dist/index.js";
import { cleanup, makeLog, makeTempStore } from "./helpers.js";

const tempDirs = [];
async function newStore() {
	const basePath = await makeTempStore();
	tempDirs.push(basePath);
	const store = new PersistenceStore({ basePath });
	await store.initialize();
	return { store, basePath };
}

const daysAgo = (n) =>
	new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

after(async () => {
	await Promise.all(tempDirs.map(cleanup));
});

describe("retention", () => {
	it("REGRESSION: logRetentionDays actually deletes old entries", async () => {
		// Previously inert: read from env, passed through three layers, never used.
		const { store, basePath } = await newStore();
		const mgr = new LogManager({
			storagePath: basePath,
			maxLogsInMemory: 1000,
			retentionDays: 7,
			persistence: store,
		});

		await mgr.addLog({ hook: "H", event: "E", message: "old", timestamp: daysAgo(30) });
		await mgr.addLog({ hook: "H", event: "E", message: "recent", timestamp: daysAgo(1) });

		const { removed } = await mgr.enforceRetention();

		assert.equal(removed, 1, "the 30-day-old entry must be dropped");
		const { logs } = await mgr.getLogs();
		assert.equal(logs.length, 1);
		assert.equal(logs[0].message, "recent");
	});

	it("removes expired entries from disk, not just memory", async () => {
		const { store, basePath } = await newStore();
		const mgr = new LogManager({
			storagePath: basePath, maxLogsInMemory: 1000, retentionDays: 7,
			persistence: store,
		});
		await mgr.addLog({ hook: "H", event: "E", message: "old", timestamp: daysAgo(30) });
		await mgr.addLog({ hook: "H", event: "E", message: "recent", timestamp: daysAgo(1) });

		await mgr.enforceRetention();

		// The point: a restart must not resurrect it.
		const reloaded = new LogManager({
			storagePath: basePath, maxLogsInMemory: 1000, retentionDays: 7,
			persistence: store,
		});
		await reloaded.load();
		assert.equal(reloaded.getStats().totalLogs, 1, "must not come back");
	});

	it("keeps everything when retention is disabled", async () => {
		const { store, basePath } = await newStore();
		const mgr = new LogManager({
			storagePath: basePath, maxLogsInMemory: 1000, retentionDays: 0,
			persistence: store,
		});
		await mgr.addLog({ hook: "H", event: "E", timestamp: daysAgo(999) });

		assert.equal((await mgr.enforceRetention()).removed, 0);
		assert.equal(mgr.getStats().totalLogs, 1, "0 means keep forever");
	});

	it("keeps an entry whose timestamp cannot be parsed", async () => {
		// It cannot be aged, and silently discarding data is the worse failure.
		const { store, basePath } = await newStore();
		const mgr = new LogManager({
			storagePath: basePath, maxLogsInMemory: 1000, retentionDays: 1,
			persistence: store,
		});
		await mgr.addLog({ hook: "H", event: "E", timestamp: "not a date" });

		await mgr.enforceRetention();
		assert.equal(mgr.getStats().totalLogs, 1);
	});

	it("cleanup deletes expired sessions but never pending changes", async () => {
		const { store, basePath } = await newStore();

		await store.saveJSON("sessions", "old", {
			id: "old", status: "completed",
			startTime: daysAgo(60), lastActivityTime: daysAgo(60),
		});
		await store.saveJSON("sessions", "recent", {
			id: "recent", status: "active",
			startTime: daysAgo(1), lastActivityTime: daysAgo(1),
		});
		// A pending change is awaiting a human decision; ageing it out loses work.
		await mkdir(join(basePath, "changes"), { recursive: true });
		await store.saveJSON("changes", "pending-old", {
			id: "pending-old", status: "pending", timestamp: daysAgo(60),
		});

		const result = await store.cleanup({ maxAgeMs: 7 * 24 * 60 * 60 * 1000 });

		assert.ok(result.deletedFiles > 0, "something should have been deleted");
		assert.equal(await store.loadJSON("sessions", "old"), null, "expired session gone");
		assert.ok(await store.loadJSON("sessions", "recent"), "recent session kept");
		assert.ok(
			await store.loadJSON("changes", "pending-old"),
			"a pending change must survive retention — it awaits a decision",
		);
	});

	it("cleanup is a no-op when no age is given", async () => {
		const { store } = await newStore();
		await store.saveJSON("sessions", "s", { id: "s", startTime: daysAgo(999) });

		assert.deepEqual(await store.cleanup(), { deletedFiles: 0, freedBytes: 0 });
		assert.ok(await store.loadJSON("sessions", "s"), "left alone");
	});
});

describe("RateLimiter", () => {
	it("allows up to the limit then refuses", () => {
		const rl = new RateLimiter({ limit: 3, windowMs: 1000 });
		const now = 1_000_000;

		assert.equal(rl.check("a", now).allowed, true);
		assert.equal(rl.check("a", now).allowed, true);
		assert.equal(rl.check("a", now).allowed, true);
		assert.equal(rl.check("a", now).allowed, false, "fourth is refused");
	});

	it("reports remaining and a reset time", () => {
		const rl = new RateLimiter({ limit: 2, windowMs: 1000 });
		const now = 1_000_000;

		assert.equal(rl.check("a", now).remaining, 1);
		const second = rl.check("a", now);
		assert.equal(second.remaining, 0);
		assert.equal(second.resetAt, now + 1000);
	});

	it("recovers after the window slides", () => {
		const rl = new RateLimiter({ limit: 1, windowMs: 1000 });
		assert.equal(rl.check("a", 1_000_000).allowed, true);
		assert.equal(rl.check("a", 1_000_500).allowed, false, "still inside");
		assert.equal(rl.check("a", 1_001_001).allowed, true, "window passed");
	});

	it("does not extend its own lockout by recording refused requests", () => {
		// If a refused request were recorded, a caller over the limit would keep
		// pushing the window forward and never recover.
		const rl = new RateLimiter({ limit: 1, windowMs: 1000 });
		rl.check("a", 1_000_000);
		for (let t = 1_000_100; t < 1_001_000; t += 100) rl.check("a", t);

		assert.equal(rl.check("a", 1_001_001).allowed, true, "must recover on time");
	});

	it("tracks callers independently", () => {
		const rl = new RateLimiter({ limit: 1, windowMs: 1000 });
		assert.equal(rl.check("a", 1000).allowed, true);
		assert.equal(rl.check("b", 1000).allowed, true, "b has its own budget");
	});

	it("prunes idle keys so its own map cannot grow forever", () => {
		const rl = new RateLimiter({ limit: 5, windowMs: 1000 });
		for (let i = 0; i < 50; i++) rl.check(`peer-${i}`, 1_000_000);
		assert.equal(rl.trackedKeys, 50);

		rl.prune(1_002_000);
		assert.equal(rl.trackedKeys, 0, "an unbounded map would be its own bug");
	});
});

describe("secret redaction", () => {
	const cases = [
		["anthropic key", "use sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAA now"],
		["github token", "token ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
		["aws access key", "AKIAIOSFODNN7EXAMPLE"],
		["google api key", "AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
		["slack token", "xoxb-1234567890-abcdefghijkl"],
		["jwt", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N"],
	];

	for (const [name, text] of cases) {
		it(`redacts a ${name}`, () => {
			const { value, redacted } = redactString(text);
			assert.ok(redacted > 0, "should have matched");
			assert.match(value, /\[redacted\]/);
		});
	}

	it("keeps the variable name of an assignment, so the record still says what was there", () => {
		const { value } = redactString('export API_KEY="super-secret-value-here"');
		assert.match(value, /API_KEY=\[redacted\]/);
		assert.doesNotMatch(value, /super-secret-value-here/);
	});

	it("redacts credentials embedded in a URL but keeps the scheme", () => {
		const { value } = redactString("clone https://user:hunter2@github.com/x/y");
		assert.match(value, /https:\/\/\[redacted\]@github\.com/);
		assert.doesNotMatch(value, /hunter2/);
	});

	it("redacts a private key block", () => {
		const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----";
		assert.doesNotMatch(redactString(pem).value, /MIIEow/);
	});

	it("leaves ordinary text and ordinary config alone", () => {
		for (const safe of [
			"npm test -- --coverage",
			"PORT=52376",
			"const timeout = 5000;",
			"reading /Users/dev/project/src/index.ts",
		]) {
			const { value, redacted } = redactString(safe);
			assert.equal(redacted, 0, `should not have matched: ${safe}`);
			assert.equal(value, safe);
		}
	});

	it("walks a nested payload, including arrays", () => {
		const { value, redacted } = redactPayload({
			message: "ok",
			details: {
				tool_input: { command: "curl -H 'Authorization: Bearer ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'" },
				env: ["HOME=/x", "SECRET_TOKEN=abcdef123456"],
			},
		});

		assert.ok(redacted >= 2);
		const json = JSON.stringify(value);
		assert.doesNotMatch(json, /ghp_A/);
		assert.doesNotMatch(json, /abcdef123456/);
		assert.match(json, /HOME=\/x/, "non-secrets survive");
	});

	it("passes payloads through untouched when disabled", () => {
		const original = { key: "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAA" };
		const { value, redacted } = redactPayload(original, { enabled: false });
		assert.equal(redacted, 0);
		assert.deepEqual(value, original);
	});

	it("does not recurse without bound on a deep payload", () => {
		let deep = { v: "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAA" };
		for (let i = 0; i < 40; i++) deep = { nested: deep };
		// Must terminate rather than blow the stack.
		assert.ok(redactPayload(deep));
	});

	it("preserves non-string scalars", () => {
		const { value } = redactPayload({ n: 42, b: true, z: null });
		assert.deepEqual(value, { n: 42, b: true, z: null });
	});
});

describe("session statistics", () => {
	it("REGRESSION: logCount and warnings are no longer hardcoded to 0", async () => {
		const storagePath = await makeTempStore();
		tempDirs.push(storagePath);
		const mgr = new SessionManager({ storagePath });

		mgr.trackActivity("s1", makeLog({ sessionId: "s1" }));

		// Supplied by the caller that owns the LogManager, since SessionManager
		// has no reference to it and cannot count logs itself.
		const stats = await mgr.getSessionStats("s1", { logCount: 42, warnings: 7 });

		assert.equal(stats.logCount, 42);
		assert.equal(stats.warnings, 7);
	});

	it("still reports 0 honestly when no counts are supplied", async () => {
		const storagePath = await makeTempStore();
		tempDirs.push(storagePath);
		const mgr = new SessionManager({ storagePath });
		mgr.trackActivity("s1", makeLog({ sessionId: "s1" }));

		const stats = await mgr.getSessionStats("s1");
		assert.equal(stats.logCount, 0);
	});

	it("counts errors and blocked from real execution state", async () => {
		const storagePath = await makeTempStore();
		tempDirs.push(storagePath);
		const mgr = new SessionManager({ storagePath });

		for (const [id, level] of [["t1", "error"], ["t2", "blocked"], ["t3", "info"]]) {
			mgr.trackActivity("s1", makeLog({
				sessionId: "s1", tool: "Bash", event: "PreToolUse", executionId: id,
			}));
			mgr.trackActivity("s1", makeLog({
				sessionId: "s1", tool: "Bash", event: "PostToolUse", executionId: id, level,
			}));
		}

		const stats = await mgr.getSessionStats("s1");
		assert.equal(stats.toolExecutions, 3);
		assert.equal(stats.errors, 1);
		assert.equal(stats.blocked, 1);
	});
});

describe("dead code removal", () => {
	it("no WebSocket scaffolding survives, since no server exists", () => {
		// wsPort was configurable, documented and plumbed through four files for a
		// server that was never written.
		const files = [
			"packages/protocol/src/ipc.ts",
			"packages/core/src/cli.ts",
			"packages/core/src/core.ts",
			"packages/vscode/src/core-bridge.ts",
			"packages/vscode/src/extension.ts",
		];
		for (const f of files) {
			const src = readFileSync(join(process.cwd(), "..", "..", f), "utf-8");
			assert.doesNotMatch(src, /wsPort/, `${f} still references wsPort`);
			assert.doesNotMatch(src, /WebSocketEvent/, `${f} still references WebSocketEvent`);
		}
	});

	it("the JSON-RPC types survived that removal", () => {
		// A regex-based removal of the WebSocket block silently took these five
		// with it; only an explicit before/after export comparison caught it.
		const src = readFileSync(
			join(process.cwd(), "..", "..", "packages/protocol/src/ipc.ts"),
			"utf-8",
		);
		for (const name of [
			"JsonRpcRequest", "JsonRpcResponse", "JsonRpcErrorDetail",
			"JsonRpcError", "JsonRpcNotification",
		]) {
			assert.match(src, new RegExp(`export interface ${name}\\b`), `${name} missing`);
		}
	});
});
