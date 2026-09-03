/**
 * LogManager tests — filtering, pagination, sorting, stats, persistence.
 *
 * Also pins down the current retention behaviour honestly: `retentionDays` is
 * accepted but not enforced anywhere, so the test asserts what the code really
 * does and names the gap, rather than pretending the setting works.
 */

import { strict as assert } from "node:assert";
import { after, describe, it } from "node:test";

import { LogManager, PersistenceStore } from "../dist/index.js";
import { cleanup, makeTempStore } from "./helpers.js";

const tempDirs = [];

async function newManager(overrides = {}) {
	const storagePath = await makeTempStore();
	tempDirs.push(storagePath);
	const persistence = new PersistenceStore({ basePath: storagePath });
	await persistence.initialize();
	const manager = new LogManager({
		storagePath,
		maxLogsInMemory: 1000,
		retentionDays: 7,
		persistence,
		...overrides,
	});
	return { manager, storagePath, persistence };
}

/** Seed a spread of logs covering the fields the filters key on. */
async function seed(manager) {
	await manager.addLog({
		hook: "PreToolUse", event: "PreToolUse", level: "info",
		message: "read a file", sessionId: "s1", tool: "Read", file: "/a.ts",
		timestamp: "2026-01-01T00:00:01.000Z",
	});
	await manager.addLog({
		hook: "PostToolUse", event: "PostToolUse", level: "error",
		message: "bash failed", sessionId: "s1", tool: "Bash",
		timestamp: "2026-01-01T00:00:02.000Z",
	});
	await manager.addLog({
		hook: "PreToolUse", event: "PreToolUse", level: "warn",
		message: "suspicious edit", sessionId: "s2", tool: "Edit", file: "/b.ts",
		timestamp: "2026-01-01T00:00:03.000Z",
	});
	await manager.addLog({
		hook: "Notification", event: "notification", level: "blocked",
		message: "denied by policy", sessionId: "s2",
		timestamp: "2026-01-01T00:00:04.000Z",
	});
}

after(async () => {
	await Promise.all(tempDirs.map(cleanup));
});

describe("LogManager", () => {
	describe("addLog", () => {
		it("assigns an id and defaults", async () => {
			const { manager } = await newManager();
			const log = await manager.addLog({ hook: "H", event: "E" });

			assert.ok(log.id, "must assign an id");
			assert.equal(log.level, "info", "defaults to info");
			assert.ok(log.timestamp, "defaults the timestamp");
		});

		it("preserves a timestamp supplied by the hook", async () => {
			const { manager } = await newManager();
			const ts = "2026-01-01T12:00:00.000Z";
			const log = await manager.addLog({ hook: "H", event: "E", timestamp: ts });
			assert.equal(log.timestamp, ts);
		});

		it("maps tool_use_id onto executionId", async () => {
			const { manager } = await newManager();
			const log = await manager.addLog({
				hook: "PreToolUse", event: "PreToolUse", tool_use_id: "toolu_abc",
			});
			assert.equal(log.executionId, "toolu_abc");
		});

		it("still accepts the legacy executionId field", async () => {
			const { manager } = await newManager();
			const log = await manager.addLog({
				hook: "PreToolUse", event: "PreToolUse", executionId: "legacy_1",
			});
			assert.equal(log.executionId, "legacy_1");
		});

		it("lifts toolInput/toolResponse into details", async () => {
			const { manager } = await newManager();
			const log = await manager.addLog({
				hook: "PostToolUse", event: "PostToolUse",
				toolInput: { command: "ls" },
				toolResponse: "output text",
			});
			assert.deepEqual(log.details.tool_input, { command: "ls" });
			assert.equal(log.details.tool_result, "output text");
		});

		it("emits log:added, and a level-specific event", async () => {
			const { manager } = await newManager();
			const seen = [];
			manager.on("log:added", () => seen.push("added"));
			manager.on("log:error", () => seen.push("error"));

			await manager.addLog({ hook: "H", event: "E", level: "error" });

			assert.ok(seen.includes("added"));
			assert.ok(seen.includes("error"));
		});

		it("trims the in-memory buffer to maxLogsInMemory", async () => {
			const { manager } = await newManager({ maxLogsInMemory: 5 });
			for (let i = 0; i < 20; i++) {
				await manager.addLog({ hook: "H", event: "E", message: `m${i}` });
			}
			assert.equal(manager.getStats().totalLogs, 5);
		});
	});

	describe("getLogs filtering", () => {
		it("filters by sessionId", async () => {
			const { manager } = await newManager();
			await seed(manager);
			const { logs } = await manager.getLogs({ filter: { sessionId: "s1" } });
			assert.equal(logs.length, 2);
		});

		it("filters by hook", async () => {
			const { manager } = await newManager();
			await seed(manager);
			const { logs } = await manager.getLogs({ filter: { hook: "PreToolUse" } });
			assert.equal(logs.length, 2);
		});

		it("filters by tool", async () => {
			const { manager } = await newManager();
			await seed(manager);
			const { logs } = await manager.getLogs({ filter: { tool: "Bash" } });
			assert.equal(logs.length, 1);
		});

		it("filters by file", async () => {
			const { manager } = await newManager();
			await seed(manager);
			const { logs } = await manager.getLogs({ filter: { file: "/a.ts" } });
			assert.equal(logs.length, 1);
		});

		it("filters by a single level", async () => {
			const { manager } = await newManager();
			await seed(manager);
			const { logs } = await manager.getLogs({ filter: { level: "error" } });
			assert.equal(logs.length, 1);
		});

		it("filters by several levels at once", async () => {
			const { manager } = await newManager();
			await seed(manager);
			const { logs } = await manager.getLogs({
				filter: { level: ["error", "warn"] },
			});
			assert.equal(logs.length, 2);
		});

		it("searches message text case-insensitively", async () => {
			const { manager } = await newManager();
			await seed(manager);
			const { logs } = await manager.getLogs({ filter: { search: "FAILED" } });
			assert.equal(logs.length, 1);
		});

		it("filters by a time window", async () => {
			const { manager } = await newManager();
			await seed(manager);
			const { logs } = await manager.getLogs({
				filter: {
					startTime: "2026-01-01T00:00:02.000Z",
					endTime: "2026-01-01T00:00:03.000Z",
				},
			});
			assert.equal(logs.length, 2);
		});

		it("combines filters conjunctively", async () => {
			const { manager } = await newManager();
			await seed(manager);
			const { logs } = await manager.getLogs({
				filter: { sessionId: "s1", level: "error" },
			});
			assert.equal(logs.length, 1);
			assert.equal(logs[0].tool, "Bash");
		});
	});

	describe("getLogs pagination and sorting", () => {
		it("defaults to newest first", async () => {
			const { manager } = await newManager();
			await seed(manager);
			const { logs } = await manager.getLogs();
			assert.ok(logs[0].timestamp > logs[logs.length - 1].timestamp);
		});

		it("sorts ascending on request", async () => {
			const { manager } = await newManager();
			await seed(manager);
			const { logs } = await manager.getLogs({
				sort: { field: "timestamp", order: "asc" },
			});
			assert.ok(logs[0].timestamp < logs[logs.length - 1].timestamp);
		});

		it("reports total independently of the page size", async () => {
			const { manager } = await newManager();
			await seed(manager);
			const result = await manager.getLogs({ pagination: { limit: 2, offset: 0 } });

			assert.equal(result.logs.length, 2);
			assert.equal(result.total, 4, "total is the unpaginated count");
			assert.equal(result.limit, 2);
		});

		it("honours offset", async () => {
			const { manager } = await newManager();
			await seed(manager);
			const page1 = await manager.getLogs({ pagination: { limit: 2, offset: 0 } });
			const page2 = await manager.getLogs({ pagination: { limit: 2, offset: 2 } });

			assert.notEqual(page1.logs[0].id, page2.logs[0].id);
		});
	});

	describe("getStats", () => {
		it("counts by level", async () => {
			const { manager } = await newManager();
			await seed(manager);
			const stats = manager.getStats();

			assert.equal(stats.totalLogs, 4);
			assert.equal(stats.errors, 1);
			assert.equal(stats.warnings, 1);
			assert.equal(stats.blocked, 1);
		});

		it("tracks a per-minute rate", async () => {
			const { manager } = await newManager();
			await seed(manager);
			assert.equal(manager.getStats().logsPerMinute, 4);
		});
	});

	describe("clear", () => {
		it("clears everything with no filter", async () => {
			const { manager } = await newManager();
			await seed(manager);
			const result = await manager.clear();

			assert.equal(result.cleared, 4);
			assert.equal(manager.getStats().totalLogs, 0);
		});

		it("clears only one session", async () => {
			const { manager } = await newManager();
			await seed(manager);
			const result = await manager.clear({ sessionId: "s1" });

			assert.equal(result.cleared, 2);
			assert.equal(manager.getStats().totalLogs, 2);
		});

		it("clears logs older than a timestamp", async () => {
			const { manager } = await newManager();
			await seed(manager);
			await manager.clear({ olderThan: "2026-01-01T00:00:03.000Z" });

			const { logs } = await manager.getLogs();
			assert.ok(logs.every((l) => l.timestamp >= "2026-01-01T00:00:03.000Z"));
		});
	});

	describe("persistence", () => {
		it("reloads logs from the JSONL file", async () => {
			const { manager, storagePath, persistence } = await newManager();
			await seed(manager);

			const reloaded = new LogManager({
				storagePath,
				maxLogsInMemory: 1000,
				retentionDays: 7,
				persistence,
			});
			await reloaded.load();

			assert.equal(reloaded.getStats().totalLogs, 4);
		});

		it("keeps only the newest maxLogsInMemory entries on load", async () => {
			const { manager, storagePath, persistence } = await newManager();
			for (let i = 0; i < 30; i++) {
				await manager.addLog({ hook: "H", event: "E", message: `m${i}` });
			}

			const reloaded = new LogManager({
				storagePath,
				maxLogsInMemory: 10,
				retentionDays: 7,
				persistence,
			});
			await reloaded.load();

			assert.equal(reloaded.getStats().totalLogs, 10);
		});
	});

	describe("retention (known gap)", () => {
		it("does NOT yet drop logs by age — retentionDays is inert", async () => {
			// Documents real behaviour rather than the intended behaviour.
			// `retentionDays` is accepted, stored, and never read; the only bounds
			// on growth are maxLogsInMemory and size-based JSONL rotation. When
			// age-based retention is implemented, this test should be inverted.
			const { manager } = await newManager({ retentionDays: 1 });
			await manager.addLog({
				hook: "H", event: "E",
				timestamp: "2020-01-01T00:00:00.000Z",
			});

			assert.equal(
				manager.getStats().totalLogs,
				1,
				"a six-year-old log is still retained",
			);
		});
	});
});
