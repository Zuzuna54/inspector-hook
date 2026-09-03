/**
 * The memory IPC surface, driven end-to-end against the real CLI.
 *
 * Two things this covers that the unit tests cannot:
 *
 * 1. That the methods are actually REGISTERED. This branch has repeatedly
 *    found handlers that were correct and unreachable — PostToolUseFailure and
 *    StopFailure were both implemented and absent from settings.json, so
 *    neither could ever fire. A dispatch test is the only thing that catches it.
 * 2. That writing into the user's real ~/.claude is OFF by default. The child
 *    runs with INSPECTOR_HOOK_SESSION_MEMORY unset, and the assertion is that
 *    a completed session leaves no memory file behind.
 *
 * The child is isolated with INSPECTOR_HOOK_STORAGE and a temp port file, and
 * every memory path used here is a temp directory. Nothing reads or writes the
 * real memory corpus.
 */

import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

import { AUTHORED_BY } from "../dist/index.js";
import { cleanup, makeTempStore } from "./helpers.js";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

let child;
let storagePath;
let fakeHome;
let memoryDir;
let httpPort;
let nextId = 1;
const pending = new Map();

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

/** Post a hook event the way the shell hook does. */
async function ingest(body) {
	const res = await fetch(`http://127.0.0.1:${httpPort}/log`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	return res.status;
}

before(async () => {
	storagePath = await makeTempStore();
	fakeHome = await makeTempStore();
	// The transcript path is what locates memory, so lay out a project the way
	// Claude Code does and point a session's transcript inside it.
	memoryDir = join(fakeHome, ".claude", "projects", "-tmp-proj", "memory");
	await mkdir(memoryDir, { recursive: true });

	child = spawn("node", [CLI], {
		stdio: ["pipe", "pipe", "pipe"],
		env: {
			...process.env,
			INSPECTOR_HOOK_STORAGE: storagePath,
			INSPECTOR_HOOK_PORT_FILE: join(storagePath, "port"),
			INSPECTOR_HOOK_HTTP_PORT: "0",
			// Deliberately NOT set, so the default is what gets tested:
			// INSPECTOR_HOOK_SESSION_MEMORY
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
	assert.ok(httpPort > 0);
});

after(async () => {
	child?.kill();
	await cleanup(storagePath);
	await cleanup(fakeHome);
});

describe("memory IPC methods", () => {
	it("every method dispatches — none is registered-but-unreachable", async () => {
		// The failure this guards against: a handler that is written, tested and
		// never wired up. It has happened twice on this branch.
		const methods = [
			["memory.getProjects", {}],
			["memory.getProject", { memoryDir }],
			["memory.getFile", { memoryDir, fileName: "nope.md" }],
			["memory.write", { memoryDir, name: "probe", description: "d", type: "project", body: "b" }],
			["memory.delete", { memoryDir, fileName: "probe.md" }],
			["memory.addToIndex", { memoryDir, fileName: "nope.md" }],
			["memory.removeFromIndex", { memoryDir, fileName: "nope.md" }],
			["memory.buildDigest", { sessionId: "does-not-exist" }],
		];
		for (const [method, params] of methods) {
			const res = await rpc(method, params);
			assert.ok(
				"result" in res,
				`${method} must dispatch, got ${JSON.stringify(res.error)}`,
			);
			assert.notEqual(res.error?.code, -32601, `${method} is not registered`);
		}
	});

	it("reads a project's memory, flagging unindexed files", async () => {
		await writeFile(
			join(memoryDir, "indexed.md"),
			`---\nname: indexed\ndescription: d\nmetadata:\n  type: project\n  source: ${AUTHORED_BY}\n---\n\nbody\n`,
		);
		await writeFile(
			join(memoryDir, "unindexed.md"),
			"---\nname: unindexed\ndescription: d\nmetadata:\n  type: user\n---\n\nbody\n",
		);
		await writeFile(join(memoryDir, "MEMORY.md"), "# Memory\n\n- [I](indexed.md) — d\n");

		const { result } = await rpc("memory.getProject", { memoryDir });

		assert.equal(result.hasIndex, true);
		const byName = Object.fromEntries(result.files.map((f) => [f.fileName, f]));
		assert.equal(byName["indexed.md"].orphaned, false);
		assert.equal(byName["unindexed.md"].orphaned, true);
	});

	it("returns a reason, not an empty list, for a session with no memory dir", async () => {
		const { result } = await rpc("memory.getProject", { sessionId: "unknown" });
		assert.equal(result.memoryDir, null);
		assert.match(result.reason, /transcript path/);
	});

	it("writes and then deletes its own entry, keeping the index consistent", async () => {
		const write = await rpc("memory.write", {
			memoryDir,
			name: "curated entry",
			description: "added from the UI",
			type: "reference",
			body: "# Curated\n\ncontent\n",
			title: "Curated",
		});
		assert.equal(write.result.written, true);

		const text = await readFile(join(memoryDir, "curated-entry.md"), "utf-8");
		assert.match(text, /type: reference/);
		assert.match(text, new RegExp(`source: ${AUTHORED_BY}`));
		assert.match(
			await readFile(join(memoryDir, "MEMORY.md"), "utf-8"),
			/- \[Curated\]\(curated-entry\.md\)/,
		);

		const del = await rpc("memory.delete", { memoryDir, fileName: "curated-entry.md" });
		assert.equal(del.result.deleted, true);
		assert.doesNotMatch(
			await readFile(join(memoryDir, "MEMORY.md"), "utf-8"),
			/curated-entry\.md/,
		);
	});

	it("refuses over IPC to overwrite a file it did not author", async () => {
		await writeFile(
			join(memoryDir, "handwritten.md"),
			"---\nname: handwritten\ndescription: mine\nmetadata:\n  type: feedback\n---\n\nKEEP THIS\n",
		);

		const { result } = await rpc("memory.write", {
			memoryDir,
			name: "handwritten",
			description: "generated",
			type: "project",
			body: "overwritten",
		});

		assert.equal(result.written, false);
		assert.equal(result.refused, "not-authored-by-us");
		assert.match(await readFile(join(memoryDir, "handwritten.md"), "utf-8"), /KEEP THIS/);
	});

	it("builds a digest from a real ingested session without writing it", async () => {
		const sessionId = "digest-session-1";
		const transcriptPath = join(
			fakeHome, ".claude", "projects", "-tmp-proj", `${sessionId}.jsonl`,
		);
		assert.equal(
			await ingest({
				hook: "SessionStart", event: "SessionStart", sessionId,
				timestamp: new Date().toISOString(), message: "start",
				details: { cwd: "/tmp/proj", projectName: "proj", gitBranch: "main", transcriptPath },
			}),
			200,
		);
		// PreToolUse opens the execution; without it the session records nothing
		// and the digest is correctly judged not worth keeping.
		for (const hook of ["PreToolUse", "PostToolUse"]) {
			assert.equal(
				await ingest({
					hook, event: hook, sessionId,
					timestamp: new Date().toISOString(), message: "edited",
					tool: "Edit", file: "/tmp/proj/a.ts",
					details: { toolUseId: "tu-1", transcriptPath },
				}),
				200,
			);
		}

		const { result } = await rpc("memory.buildDigest", { sessionId });

		assert.ok(result.digest, `expected a digest, got ${JSON.stringify(result)}`);
		assert.equal(result.written, false, "a preview must not write");
		// Assert worthKeeping explicitly: the skip path ALSO produces a
		// description mentioning the project ("Session on proj with no recorded
		// activity"), so matching the project name alone passes either way.
		assert.equal(result.digest.worthKeeping, true, result.digest.skipReason);
		assert.match(result.digest.description, /1 tool call/);
		assert.equal(
			(await readdir(memoryDir)).includes(`${result.digest.name}.md`),
			false,
			"nothing may reach disk from a preview",
		);
	});

	it("REGRESSION: transcriptPath is stored on the session, not dropped", async () => {
		// The hook has always forwarded this field -- it was present on 2298 of
		// 2309 captured events -- and every session record threw it away, which
		// left the memory directory unlocatable. Same shape as tool_use_id.
		const sessionId = "transcript-session";
		const transcriptPath = join(
			fakeHome, ".claude", "projects", "-tmp-proj", `${sessionId}.jsonl`,
		);
		await ingest({
			hook: "SessionStart", event: "SessionStart", sessionId,
			timestamp: new Date().toISOString(), message: "start",
			details: { cwd: "/tmp/proj", projectName: "proj", transcriptPath },
		});

		const { result } = await rpc("sessions.getById", { id: sessionId });
		assert.equal(
			result?.metadata?.transcriptPath,
			transcriptPath,
			"without this the memory directory cannot be located",
		);

		// And it resolves through to the right directory end to end.
		const project = await rpc("memory.getProject", { sessionId });
		assert.equal(project.result.memoryDir, memoryDir);
	});

	it("writes nothing to memory by default when a session ends", async () => {
		// The gate matters: these files change what every future Claude session
		// in the project is told. Enabling that on the user's behalf is not this
		// tool's call, so the default must be verified rather than assumed.
		const sessionId = "ending-session";
		const transcriptPath = join(
			fakeHome, ".claude", "projects", "-tmp-proj", `${sessionId}.jsonl`,
		);
		const before = (await readdir(memoryDir)).sort();

		await ingest({
			hook: "SessionStart", event: "SessionStart", sessionId,
			timestamp: new Date().toISOString(), message: "start",
			details: { cwd: "/tmp/proj", projectName: "proj", transcriptPath },
		});
		// Real activity, so the gate is what stops the write -- not an empty
		// session being skipped for lack of anything to record.
		for (const hook of ["PreToolUse", "PostToolUse"]) {
			await ingest({
				hook, event: hook, sessionId,
				timestamp: new Date().toISOString(), message: "edited",
				tool: "Edit", file: "/tmp/proj/b.ts",
				details: { toolUseId: "tu-2", transcriptPath },
			});
		}
		const preview = await rpc("memory.buildDigest", { sessionId });
		assert.equal(
			preview.result.digest.worthKeeping,
			true,
			"the session must be digest-worthy, or this test proves nothing",
		);
		await ingest({
			hook: "SessionEnd", event: "SessionEnd", sessionId,
			timestamp: new Date().toISOString(), message: "end",
			details: { transcriptPath },
		});

		// Wait for a POSITIVE signal that session-end processing ran -- the
		// status transition that emits session:ended, which is the event the
		// write hangs off -- rather than sleeping a fixed 400ms and hoping.
		//
		// A fixed sleep here is a latent false green: if the gate were broken,
		// the write would normally land well inside 400ms, but under load it
		// might not, and the test would pass because nothing had happened YET
		// rather than because the gate stopped it.
		let status;
		for (let i = 0; i < 60; i++) {
			const { result } = await rpc("sessions.getById", { id: sessionId });
			status = result?.status;
			if (status === "completed") break;
			await new Promise((r) => setTimeout(r, 50));
		}
		assert.equal(
			status,
			"completed",
			"the session must have ended, or this test asserts nothing",
		);
		// Then a short grace period, so a write that WAS going to happen has
		// had its turn on the event loop before we conclude it did not.
		await new Promise((r) => setTimeout(r, 250));

		assert.deepEqual(
			(await readdir(memoryDir)).sort(),
			before,
			"INSPECTOR_HOOK_SESSION_MEMORY is unset, so nothing may be written",
		);
	});

	it("DOES write when the gate is on — so the negative test proves a gate, not a bug", async () => {
		// Without this, "nothing was written by default" is indistinguishable
		// from "the write path does not work". A pair of tests where only the
		// negative one exists is the same false-green shape as asserting the
		// old broken behaviour: it passes for the wrong reason.
		const home2 = await makeTempStore();
		const storage2 = await makeTempStore();
		const dir2 = join(home2, ".claude", "projects", "-tmp-proj2", "memory");
		await mkdir(dir2, { recursive: true });

		const sessionId = "gated-on-session";
		const transcriptPath = join(
			home2, ".claude", "projects", "-tmp-proj2", `${sessionId}.jsonl`,
		);

		const gated = spawn("node", [CLI], {
			stdio: ["pipe", "pipe", "pipe"],
			env: {
				...process.env,
				INSPECTOR_HOOK_STORAGE: storage2,
				INSPECTOR_HOOK_PORT_FILE: join(storage2, "port"),
				INSPECTOR_HOOK_HTTP_PORT: "0",
				INSPECTOR_HOOK_SESSION_MEMORY: "1",
			},
		});

		try {
			const port = await new Promise((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error("no handshake")), 10_000);
				let buf = "";
				gated.stdout.on("data", (c) => {
					buf += c.toString();
					for (const line of buf.split("\n")) {
						try {
							const msg = JSON.parse(line);
							if (msg.type === "ready") {
								clearTimeout(timer);
								resolve(msg.port);
							}
						} catch {
							/* partial line */
						}
					}
				});
			});

			const post = (body) =>
				fetch(`http://127.0.0.1:${port}/log`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
				});

			await post({
				hook: "SessionStart", event: "SessionStart", sessionId,
				timestamp: new Date().toISOString(), message: "start",
				details: { cwd: "/tmp/proj2", projectName: "proj2", gitBranch: "main", transcriptPath },
			});
			for (const hook of ["PreToolUse", "PostToolUse"]) {
				await post({
					hook, event: hook, sessionId,
					timestamp: new Date().toISOString(), message: "edited",
					tool: "Edit", file: "/tmp/proj2/a.ts",
					details: { toolUseId: "tu-9", transcriptPath },
				});
			}
			await post({
				hook: "SessionEnd", event: "SessionEnd", sessionId,
				timestamp: new Date().toISOString(), message: "end",
				details: { transcriptPath },
			});

			// Poll for the COMPLETE end state, not for the first artefact.
			//
			// writeMemoryFile renames the digest into place and only then writes
			// MEMORY.md (native-memory.ts: rename at the file write, then
			// upsertIndexEntry). Polling only for the digest therefore returns
			// mid-write, and reading the index straight afterwards raced it --
			// this test failed roughly 1 run in 4 under full-suite load. The
			// method awaits both writes correctly; the defect was here.
			//
			// The two conditions are tracked separately so a genuine ordering
			// regression still fails with a message that says which half is
			// missing, rather than a bare timeout.
			let written = [];
			let index = "";
			for (let i = 0; i < 60; i++) {
				written = (await readdir(dir2)).filter((f) => f.startsWith("session-"));
				index = await readFile(join(dir2, "MEMORY.md"), "utf-8").catch(() => "");
				if (written.length > 0 && written.every((f) => index.includes(f))) break;
				await new Promise((r) => setTimeout(r, 50));
			}

			assert.equal(written.length, 1, `expected one digest, found [${written}]`);
			const text = await readFile(join(dir2, written[0]), "utf-8");
			assert.match(text, new RegExp(`source: ${AUTHORED_BY}`), "must mark itself");
			assert.match(text, /type: project/);
			assert.match(text, /proj2/);
			assert.match(text, /a\.ts/, "the file it changed must appear");

			// An unindexed digest is never loaded by name, so the index write is
			// as much a part of "written to memory" as the file itself.
			assert.ok(
				index.includes(written[0]),
				`MEMORY.md does not reference ${written[0]}; index contents: ${JSON.stringify(index)}`,
			);
		} finally {
			gated.kill();
			await cleanup(home2);
			await cleanup(storage2);
		}
	});

	it("indexes an orphan over IPC without touching the file", async () => {
		// The view's headline action. memory.write cannot do this for a
		// hand-written file, which is why the method exists.
		await writeFile(
			join(memoryDir, "orphan-fix.md"),
			"---\nname: orphan-fix\ndescription: a persons note\nmetadata:\n  type: user\n---\n\nUNTOUCHED\n",
		);

		const before = await rpc("memory.getProject", { memoryDir });
		assert.equal(
			before.result.files.find((f) => f.fileName === "orphan-fix.md").orphaned,
			true,
		);

		const indexed = await rpc("memory.addToIndex", {
			memoryDir, fileName: "orphan-fix.md",
		});
		assert.equal(indexed.result.indexed, true);

		const after = await rpc("memory.getProject", { memoryDir });
		assert.equal(
			after.result.files.find((f) => f.fileName === "orphan-fix.md").orphaned,
			false,
		);
		assert.match(
			await readFile(join(memoryDir, "orphan-fix.md"), "utf-8"),
			/UNTOUCHED/,
		);

		// And it can be un-indexed without deleting the file.
		const removed = await rpc("memory.removeFromIndex", {
			memoryDir, fileName: "orphan-fix.md",
		});
		assert.equal(removed.result.changed, true);
		assert.match(
			await readFile(join(memoryDir, "orphan-fix.md"), "utf-8"),
			/UNTOUCHED/,
			"un-indexing must not delete anything",
		);
	});

	it("lists projects across the machine", async () => {
		// Cross-project rollup: scoped per project, native memory cannot answer
		// "where did I solve this before" at all.
		const { result } = await rpc("memory.getProjects", {});
		assert.ok(Array.isArray(result), "must return a list");
		for (const project of result) {
			assert.ok(typeof project.slug === "string");
			assert.ok(Array.isArray(project.files));
		}
	});
});
