/**
 * IpcServer tests — driven end-to-end against the real built CLI.
 *
 * The server reads process.stdin, so it can only be exercised honestly by
 * spawning the actual process and speaking JSON-RPC 2.0 over its stdio. That
 * also covers the startup handshake and clean shutdown.
 *
 * The child is isolated with INSPECTOR_HOOK_STORAGE and
 * INSPECTOR_HOOK_PORT_FILE so it never touches the user's real store or
 * redirect the machine's hooks at the test instance.
 */

import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";

import { cleanup, makeTempStore } from "./helpers.js";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

let child;
let storagePath;
let nextId = 1;
const pending = new Map();

/** Send a JSON-RPC request and resolve with the full response envelope. */
function rpc(method, params = {}) {
	const id = nextId++;
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`timeout waiting for ${method}`)),
			10_000,
		);
		pending.set(id, { resolve, timer });
		child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
	});
}

/** Send a raw line, bypassing JSON-RPC framing. */
function raw(line) {
	child.stdin.write(`${line}\n`);
}

before(async () => {
	storagePath = await makeTempStore();

	child = spawn("node", [CLI], {
		stdio: ["pipe", "pipe", "pipe"],
		env: {
			...process.env,
			INSPECTOR_HOOK_STORAGE: storagePath,
			INSPECTOR_HOOK_PORT_FILE: join(storagePath, "port"),
			// 0 = let the OS pick, so we never collide with a real core.
			INSPECTOR_HOOK_HTTP_PORT: "0",
		},
	});

	let buffer = "";
	let ready;
	const readyPromise = new Promise((resolve) => {
		ready = resolve;
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
			// Notifications have no id; responses do.
			if (msg.id !== undefined && pending.has(msg.id)) {
				const { resolve, timer } = pending.get(msg.id);
				clearTimeout(timer);
				pending.delete(msg.id);
				resolve(msg);
			}
		}
	});

	const readyMsg = await readyPromise;
	assert.ok(readyMsg.port > 0, "handshake must report a bound port");
});

after(async () => {
	child?.kill();
	await cleanup(storagePath);
});

describe("IpcServer over stdio", () => {
	describe("protocol handling", () => {
		it("answers with a matching id and jsonrpc version", async () => {
			const res = await rpc("core.getStatus");
			assert.equal(res.jsonrpc, "2.0");
			assert.ok("result" in res);
		});

		it("returns -32601 for an unknown method", async () => {
			const res = await rpc("does.notExist");
			assert.ok(res.error, "must be an error envelope");
			assert.equal(res.error.code, -32601);
			assert.match(res.error.message, /not found/i);
		});

		it("survives a malformed line without dying", async () => {
			raw("{ this is not json");
			// The very next request must still be answered.
			const res = await rpc("core.getStatus");
			assert.ok(res.result, "server still responsive after garbage input");
		});

		it("ignores blank lines", async () => {
			raw("");
			const res = await rpc("core.getStatus");
			assert.ok(res.result);
		});

		it("rejects a wrong jsonrpc version", async () => {
			const id = nextId++;
			const got = new Promise((resolve) => {
				pending.set(id, { resolve, timer: setTimeout(() => {}, 0) });
			});
			raw(JSON.stringify({ jsonrpc: "1.0", id, method: "core.getStatus" }));
			const res = await got;
			assert.ok(res.error, "must reject a non-2.0 request");
		});

		it("handles concurrent requests without crossing responses", async () => {
			const [status, stats, sessions] = await Promise.all([
				rpc("core.getStatus"),
				rpc("logs.getStats"),
				rpc("sessions.getAll", { limit: 5 }),
			]);

			assert.ok(status.result.status, "getStatus answered getStatus");
			assert.equal(typeof stats.result.totalLogs, "number");
			assert.ok(Array.isArray(sessions.result.sessions));
		});
	});

	describe("every registered method dispatches", () => {
		// Each entry must return a result envelope rather than -32601. Params are
		// the minimum each handler needs; a domain-level failure (e.g. "not
		// found") is fine here -- we are asserting the method is wired, not that
		// the store contains anything.
		const methods = [
			["core.getStatus", {}],
			["logs.getAll", {}],
			["logs.getStats", {}],
			["logs.getById", { id: "missing" }],
			["sessions.getAll", {}],
			["sessions.getById", { id: "missing" }],
			["fileChanges.getPending", {}],
			["fileChanges.getAll", {}],
			["fileChanges.getById", { id: "missing" }],
			["fileChanges.getDiff", { changeId: "missing" }],
			["history.getTrackedFiles", {}],
			["history.getVersions", { filePath: "/nope.ts" }],
			["history.getVersionContent", { filePath: "/nope.ts", versionNumber: 1 }],
			["history.getStats", {}],
			["archive.getAll", {}],
			["archive.getById", { id: "missing" }],
			["archive.getStats", {}],
		];

		for (const [method, params] of methods) {
			it(`${method} is registered`, async () => {
				const res = await rpc(method, params);
				if (res.error) {
					assert.notEqual(
						res.error.code,
						-32601,
						`${method} should be registered, got METHOD_NOT_FOUND`,
					);
				}
			});
		}
	});

	describe("core.getStatus", () => {
		it("reports a running core with a live port and stats", async () => {
			const { result } = await rpc("core.getStatus");

			assert.equal(result.status, "running");
			assert.ok(result.httpPort > 0);
			assert.ok(result.version);
			assert.equal(typeof result.stats.totalLogs, "number");
		});
	});

	describe("shutdown", () => {
		it("exits the process on core.shutdown", async () => {
			const exited = new Promise((resolve) => child.once("exit", resolve));
			await rpc("core.shutdown");
			// A leaked interval used to keep the process alive here forever.
			const timedOut = await Promise.race([
				exited.then(() => false),
				new Promise((r) => setTimeout(() => r(true), 8000)),
			]);
			assert.equal(timedOut, false, "core must exit after shutdown");
		});
	});
});
