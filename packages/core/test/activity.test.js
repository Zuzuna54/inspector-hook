/**
 * Activity feed tests — the full round trip.
 *
 * Hook-shaped payload -> HTTP ingest -> sessions.getActivity over stdio, against
 * a real spawned core. This is the only way to catch a class of bug that lives
 * in the seam: fields that arrive correctly, are stored correctly, and are then
 * dropped while assembling the feed.
 *
 * That is exactly what happened with durationMs. It reached the store, but the
 * feed built `result` as `tool_result || result || details` -- and since
 * details.tool_result is always set for a tool event, `result` collapsed to the
 * tool output and every sibling key was silently lost.
 */

import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
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

/** POST a hook-shaped payload to the core's ingest endpoint. */
async function ingest(body) {
	const res = await fetch(`http://127.0.0.1:${httpPort}/log`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	assert.equal(res.status, 200, `ingest failed: ${await res.text()}`);
}

const toolEvent = (over) => ({
	hook: "PreToolUse",
	event: "PreToolUse",
	level: "info",
	message: "tool",
	sessionId: "act",
	...over,
});

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
				ready(msg.port);
			} else if (msg.id !== undefined && pending.has(msg.id)) {
				const { resolve, timer } = pending.get(msg.id);
				clearTimeout(timer);
				pending.delete(msg.id);
				resolve(msg);
			}
		}
	});

	httpPort = await readyPromise;
});

after(async () => {
	child?.kill();
	await cleanup(storagePath);
});

/** Fetch the activity feed for a session. */
const activityFor = async (sessionId) =>
	(await rpc("sessions.getActivity", { id: sessionId })).result.activity;

describe("session activity feed", () => {
	it("pairs a tool call and reports it completed", async () => {
		await ingest(toolEvent({ tool: "Bash", tool_use_id: "t-pair" }));
		await ingest(
			toolEvent({
				hook: "PostToolUse", event: "PostToolUse",
				tool: "Bash", tool_use_id: "t-pair",
				details: { tool_result: "output" },
			}),
		);

		const items = await activityFor("act");
		const call = items.find((i) => i.data.executionId === "t-pair");
		assert.ok(call, "the tool call should appear");
		assert.equal(call.data.status, "completed");
		assert.equal(call.data.result, "output");
	});

	it("REGRESSION: durationMs survives assembly instead of being eaten by result", async () => {
		await ingest(toolEvent({ tool: "Read", tool_use_id: "t-dur" }));
		await ingest(
			toolEvent({
				hook: "PostToolUse", event: "PostToolUse",
				tool: "Read", tool_use_id: "t-dur",
				// tool_result is always present on a real tool event, which is
				// precisely why the sibling keys used to disappear.
				details: { tool_result: "file contents", durationMs: 253 },
			}),
		);

		const call = (await activityFor("act")).find(
			(i) => i.data.executionId === "t-dur",
		);
		assert.equal(call.data.durationMs, 253, "must be a first-class field");
		assert.equal(call.data.result, "file contents", "result still the output");
	});

	it("exposes agentType and agentId as first-class fields", async () => {
		await ingest(
			toolEvent({
				tool: "Grep", tool_use_id: "t-agent",
				details: { agentId: "agent-3", agentType: "Explore" },
			}),
		);
		await ingest(
			toolEvent({
				hook: "PostToolUse", event: "PostToolUse",
				tool: "Grep", tool_use_id: "t-agent",
				details: { tool_result: "4 matches", agentId: "agent-3", agentType: "Explore", durationMs: 64 },
			}),
		);

		const call = (await activityFor("act")).find(
			(i) => i.data.executionId === "t-agent",
		);
		assert.equal(call.data.agentType, "Explore");
		assert.equal(call.data.agentId, "agent-3");
		assert.equal(call.data.durationMs, 64);
	});

	it("exposes promptId for turn grouping", async () => {
		// prompt_id is a ROOT field on the hook payload, alongside tool_use_id --
		// not something inside `details`. This test previously sent it in details,
		// which only passed because the assembler had a matching (and equally
		// wrong) details.promptId read. Both are gone; this now mirrors what the
		// real hook actually sends.
		await ingest(
			toolEvent({
				tool: "Edit", tool_use_id: "t-prompt", prompt_id: "prompt-42",
			}),
		);
		// Complete it, so this test does not leave a call open and break the
		// "nothing left running" invariant asserted below.
		await ingest(
			toolEvent({
				hook: "PostToolUse", event: "PostToolUse",
				tool: "Edit", tool_use_id: "t-prompt", prompt_id: "prompt-42",
				details: { tool_result: "applied" },
			}),
		);

		const call = (await activityFor("act")).find(
			(i) => i.data.executionId === "t-prompt",
		);
		assert.equal(call.data.promptId, "prompt-42");
		assert.equal(call.data.status, "completed");
	});

	it("marks a PostToolUseFailure call failed and keeps its error", async () => {
		await ingest(toolEvent({ tool: "Read", tool_use_id: "t-fail" }));
		await ingest(
			toolEvent({
				hook: "PostToolUseFailure", event: "PostToolUseFailure",
				level: "error", tool: "Read", tool_use_id: "t-fail",
				details: { toolError: "ENOENT: no such file", durationMs: 12 },
			}),
		);

		const call = (await activityFor("act")).find(
			(i) => i.data.executionId === "t-fail",
		);
		assert.equal(call.data.status, "failed");
		assert.equal(call.data.error, "ENOENT: no such file");
		assert.equal(call.data.durationMs, 12);
	});

	it("marks a blocked call blocked", async () => {
		await ingest(toolEvent({ tool: "Bash", tool_use_id: "t-blk" }));
		await ingest(
			toolEvent({
				hook: "PostToolUse", event: "PostToolUse", level: "blocked",
				tool: "Bash", tool_use_id: "t-blk",
				details: { tool_result: { error: "blocked by policy" } },
			}),
		);

		const call = (await activityFor("act")).find(
			(i) => i.data.executionId === "t-blk",
		);
		assert.equal(call.data.status, "blocked");
	});

	it("leaves no tool call running after all completions arrive", async () => {
		const items = await activityFor("act");
		const stuck = items.filter(
			(i) => i.type === "tool_call" && i.data.status === "running",
		);
		assert.equal(
			stuck.length,
			0,
			`stuck: ${stuck.map((s) => s.data.executionId).join(", ")}`,
		);
	});

	it("does not cross-pair parallel calls to the same tool", async () => {
		for (const n of [1, 2, 3]) {
			await ingest(toolEvent({ tool: "Bash", tool_use_id: `par-${n}` }));
		}
		// Complete out of order, each with a distinct duration so a mis-pair shows.
		for (const n of [3, 1, 2]) {
			await ingest(
				toolEvent({
					hook: "PostToolUse", event: "PostToolUse",
					tool: "Bash", tool_use_id: `par-${n}`,
					details: { tool_result: `out-${n}`, durationMs: n * 100 },
				}),
			);
		}

		const items = await activityFor("act");
		for (const n of [1, 2, 3]) {
			const call = items.find((i) => i.data.executionId === `par-${n}`);
			assert.ok(call, `par-${n} should exist`);
			assert.equal(call.data.result, `out-${n}`, `par-${n} got another's result`);
			assert.equal(call.data.durationMs, n * 100, `par-${n} got another's duration`);
		}
	});

	it("renders prompts, responses and notifications as their own types", async () => {
		const sid = "act-types";
		await ingest({
			hook: "UserPromptSubmit", event: "user.prompt", level: "info",
			message: "asked", sessionId: sid, details: { prompt: "do the thing" },
		});
		await ingest({
			hook: "Stop", event: "ai.response", level: "info",
			message: "done", sessionId: sid,
			details: { lastAssistantMessage: "Finished." },
		});
		await ingest({
			hook: "Notification", event: "notification", level: "info",
			message: "needs permission", sessionId: sid,
			details: { notificationType: "permission_prompt" },
		});

		const types = (await activityFor(sid)).map((i) => i.type);
		assert.ok(types.includes("user_prompt"));
		assert.ok(types.includes("ai_response"));
		assert.ok(types.includes("notification"));
	});

	it("REGRESSION: promptId lands on EVERY item type, not just tool calls", async () => {
		const sid = "act-turns";
		const turn = "prompt-turn-1";

		// prompt_id is a root-level hook field, present on every event but
		// SessionStart. It previously reached only tool_call items, so a client
		// had no anchor on the user_prompt item to group a turn against.
		await ingest({
			hook: "UserPromptSubmit", event: "user.prompt", level: "info",
			message: "asked", sessionId: sid, prompt_id: turn,
			details: { prompt: "do the thing" },
		});
		await ingest({
			hook: "PreToolUse", event: "PreToolUse", level: "info", message: "t",
			sessionId: sid, tool: "Bash", tool_use_id: "turn-t1", prompt_id: turn,
		});
		await ingest({
			hook: "PostToolUse", event: "PostToolUse", level: "info", message: "t",
			sessionId: sid, tool: "Bash", tool_use_id: "turn-t1", prompt_id: turn,
			details: { tool_result: "ok" },
		});
		await ingest({
			hook: "Notification", event: "notification", level: "info",
			message: "heads up", sessionId: sid, prompt_id: turn,
		});
		await ingest({
			hook: "Stop", event: "ai.response", level: "info",
			message: "done", sessionId: sid, prompt_id: turn,
		});

		const items = await activityFor(sid);
		const byType = new Map(items.map((i) => [i.type, i]));

		for (const type of ["user_prompt", "tool_call", "notification", "ai_response"]) {
			const item = byType.get(type);
			assert.ok(item, `${type} item should exist`);
			assert.equal(
				item.data.promptId,
				turn,
				`${type} must carry promptId so turns group exactly, not by inference`,
			);
		}
	});

	it("does not invent a promptId when the hook sent none", async () => {
		const sid = "act-noturn";
		await ingest({
			hook: "UserPromptSubmit", event: "user.prompt", level: "info",
			message: "asked", sessionId: sid, details: { prompt: "old log" },
		});

		const [item] = await activityFor(sid);
		assert.equal(item.data.promptId, undefined);
	});

	it("returns items in chronological order", async () => {
		const items = await activityFor("act");
		const stamps = items.map((i) => i.timestamp);
		assert.deepEqual(stamps, [...stamps].sort(), "feed must be ordered");
	});
});
