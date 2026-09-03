/**
 * End-to-end ingest tests: HTTP POST /log through to tracked state.
 *
 * This is where the B1 regression lives. B1 was a race between two code paths
 * that both tracked the same edit, so it can only be caught by driving the real
 * ingest endpoint - a manager-level test would not reproduce it.
 */

import { strict as assert } from "node:assert";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import {
	FileTracker,
	HttpServer,
	LogManager,
	PersistenceStore,
	SessionManager,
} from "../dist/index.js";
import { cleanup, makeTempStore } from "./helpers.js";

let storagePath;
let server;
let port;
let fileTracker;
let sessionManager;

before(async () => {
	storagePath = await makeTempStore();
	const persistence = new PersistenceStore({ basePath: storagePath });
	await persistence.initialize();

	const logManager = new LogManager({
		storagePath,
		maxLogsInMemory: 1000,
		retentionDays: 7,
		persistence,
	});
	sessionManager = new SessionManager({ storagePath, persistence });
	fileTracker = new FileTracker({
		workspaceRoot: storagePath,
		storagePath,
		persistence,
	});

	// Port 0 so the test never collides with a real running core.
	server = new HttpServer({
		port: 0,
		logManager,
		sessionManager,
		fileTracker,
	});
	await server.start();
	port = server.getPort();
});

after(async () => {
	await server?.stop();
	await cleanup(storagePath);
});

const post = (body) =>
	fetch(`http://127.0.0.1:${port}/log`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});

describe("HTTP ingest", () => {
	describe("validation", () => {
		it("rejects a payload missing hook and event", async () => {
			const res = await post({ message: "no hook" });
			assert.equal(res.status, 400);
		});

		it("rejects a tool hook with no sessionId", async () => {
			const res = await post({ hook: "PreToolUse", event: "PreToolUse" });
			assert.equal(res.status, 400);
		});

		it("rejects malformed JSON", async () => {
			const res = await fetch(`http://127.0.0.1:${port}/log`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "{not json",
			});
			assert.equal(res.status, 400);
		});

		it("404s an unknown route", async () => {
			const res = await fetch(`http://127.0.0.1:${port}/nope`);
			assert.equal(res.status, 404);
		});

		it("accepts a valid log", async () => {
			const res = await post({
				hook: "SessionStart",
				event: "session.start",
				sessionId: "ingest-1",
				level: "info",
				message: "started",
			});
			assert.equal(res.status, 200);
			assert.equal((await res.json()).success, true);
		});
	});

	describe("file tracking", () => {
		it("REGRESSION B1: one edit produces exactly one change", async () => {
			const file = join(storagePath, "b1.txt");
			const sessionId = "ingest-b1";
			await writeFile(file, "before", "utf-8");

			await post({
				hook: "PreToolUse",
				event: "PreToolUse",
				sessionId,
				tool: "Edit",
				file,
				tool_use_id: "toolu_b1",
				level: "info",
				message: "edit start",
			});

			await writeFile(file, "after", "utf-8");

			await post({
				hook: "PostToolUse",
				event: "PostToolUse",
				sessionId,
				tool: "Edit",
				file,
				tool_use_id: "toolu_b1",
				level: "info",
				message: "edit done",
			});

			const { changes } = await fileTracker.getPendingChanges({ sessionId });
			assert.equal(changes.length, 1, "exactly one change, not two");
			assert.equal(changes[0].beforeContent, "before");
			assert.equal(changes[0].afterContent, "after");
		});

		it("a duplicate PostToolUse does not fabricate a phantom change", async () => {
			const file = join(storagePath, "dupe.txt");
			const sessionId = "ingest-dupe";
			await writeFile(file, "v1", "utf-8");

			const pre = {
				hook: "PreToolUse",
				event: "PreToolUse",
				sessionId,
				tool: "Edit",
				file,
				tool_use_id: "toolu_d",
				level: "info",
				message: "start",
			};
			const postEvent = { ...pre, hook: "PostToolUse", event: "PostToolUse" };

			await post(pre);
			await writeFile(file, "v2", "utf-8");
			await post(postEvent);
			// Same event delivered twice - a retried or doubly-registered hook.
			await post(postEvent);

			const { changes } = await fileTracker.getPendingChanges({ sessionId });
			assert.equal(changes.length, 1, "the replay must not add a change");
			assert.notEqual(
				changes[0].beforeContent,
				"",
				"must not claim the file was created from nothing",
			);
		});

		it("links the tracked change to its session", async () => {
			const file = join(storagePath, "linked.txt");
			const sessionId = "ingest-link";
			await writeFile(file, "a", "utf-8");

			await post({
				hook: "PreToolUse", event: "PreToolUse", sessionId,
				tool: "Write", file, tool_use_id: "t1", level: "info", message: "s",
			});
			await writeFile(file, "b", "utf-8");
			await post({
				hook: "PostToolUse", event: "PostToolUse", sessionId,
				tool: "Write", file, tool_use_id: "t1", level: "info", message: "e",
			});

			const session = await sessionManager.getSession(sessionId);
			assert.equal(session.fileChanges.length, 1);
		});
	});

	describe("read endpoints", () => {
		it("reports health", async () => {
			const res = await fetch(`http://127.0.0.1:${port}/api/health`);
			assert.equal((await res.json()).status, "healthy");
		});

		it("returns stats", async () => {
			const res = await fetch(`http://127.0.0.1:${port}/api/stats`);
			assert.ok(typeof (await res.json()).totalLogs === "number");
		});

		it("lists sessions", async () => {
			const res = await fetch(`http://127.0.0.1:${port}/api/sessions`);
			assert.ok(Array.isArray((await res.json()).sessions));
		});
	});
});
