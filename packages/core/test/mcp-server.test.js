/**
 * MCP server (Milestone 5).
 *
 * The plan's last M5 deliverable: expose captured findings over MCP "so later
 * agents can query prior findings". The reason it matters is measured — 14 of
 * 170 captured agents acknowledged their spawn and never reported, so their
 * work is reachable only here.
 *
 * The protocol tests drive a real stdio transport over PassThrough streams
 * rather than asserting on the handler in isolation, because the two things
 * that actually break an MCP client are transport-level: answering a
 * notification, and dying on a bad message.
 */

import { strict as assert } from "node:assert";
import { PassThrough } from "node:stream";
import { describe, it } from "node:test";

import {
	callTool,
	PROTOCOL_VERSION,
	SERVER_NAME,
	startMcpServer,
	TOOLS,
} from "../dist/index.js";

/** A core stand-in exposing only what the tools reach for. */
function fakeCore(over = {}) {
	return {
		getResearchIndex: () => ({
			embeddingsAvailable: false,
			search: () => ({
				hits: [
					{
						score: 3,
						matched: ["traversal"],
						item: {
							id: "1",
							kind: "conclusion",
							title: "Path traversal fixed",
							text: "assertContained now guards every write",
							timestamp: "2026-09-05T10:00:00.000Z",
							projectName: "inspector-hook",
						},
					},
				],
				total: 1,
				searched: 868,
				terms: ["traversal"],
				scope: "all",
				retrieval: "lexical",
			}),
			...over.research,
		}),
		getAgentTracker: () => ({
			getTree: () => [
				{
					id: "spawn-1",
					name: "a-m5",
					status: "completed",
					description: "Audit M5 agent tree",
					durationMs: 738_000,
					durationSource: "computed",
					resultKind: "spawn-ack",
					toolCalls: [{ tool: "Bash", timestamp: "2026-09-07T10:00:00.000Z" }],
					linked: true,
					children: [],
				},
				{
					id: "spawn-2",
					name: "reporter",
					status: "completed",
					resultKind: "report",
					durationMs: 4200,
					durationSource: "reported",
					toolCalls: [],
					linked: true,
					children: [],
				},
			],
			stats: () => ({
				total: 170,
				running: 0,
				completed: 170,
				unknown: 0,
				unlinked: 148,
				spawnAckOnly: 14,
				byType: {},
				totalToolCalls: 1874,
			}),
			...over.agents,
		}),
		getGraphify: () => ({
			status: () => ({ available: true, stale: false, nodes: 4095 }),
			search: () => ({
				hits: [
					{
						score: 9,
						degree: 4,
						matched: ["agent"],
						node: {
							id: "n1",
							label: "AgentTracker",
							fileType: "code",
							sourceFile: "packages/core/src/managers/agent-tracker.ts",
							sourceLocation: "L1",
							community: 1,
						},
					},
				],
				total: 75,
				terms: ["agent"],
				searched: 4095,
			}),
			...over.graph,
		}),
	};
}

describe("mcp: the tools it advertises", () => {
	it("declares three tools with schemas a client can use", () => {
		assert.equal(TOOLS.length, 3);
		for (const tool of TOOLS) {
			assert.ok(tool.name, "every tool is named");
			assert.ok(tool.description.length > 40, `${tool.name} explains itself`);
			assert.equal(tool.inputSchema.type, "object");
		}
		assert.deepEqual(TOOLS.map((t) => t.name).sort(), [
			"list_agents",
			"search_code",
			"search_history",
		]);
	});
});

describe("mcp: list_agents never dresses an acknowledgement as findings", () => {
	it("REGRESSION: says NEVER REPORTED for a spawn acknowledgement", () => {
		// The reason the tool exists. An agent that acknowledged its spawn did
		// not report to its parent, so a later agent reading this must be told
		// that plainly rather than handed the acknowledgement.
		return callTool(fakeCore(), "list_agents", {}).then((text) => {
			assert.match(text, /a-m5/);
			assert.match(text, /NEVER REPORTED/);
			assert.match(text, /asked: Audit M5 agent tree/);
		});
	});

	it("filters to only the agents that never reported", async () => {
		const text = await callTool(fakeCore(), "list_agents", {
			onlyUnreported: true,
		});
		assert.match(text, /a-m5/);
		assert.ok(!text.includes("reporter"), "a reporting agent is excluded");
	});

	it("states where each duration came from", async () => {
		const text = await callTool(fakeCore(), "list_agents", {});
		assert.match(text, /738s \(computed\)/);
		assert.match(text, /4s \(reported\)/);
	});

	it("says the ask is unknown rather than leaving it blank", async () => {
		const core = fakeCore({
			agents: {
				getTree: () => [
					{
						id: "x",
						status: "completed",
						resultKind: "none",
						toolCalls: [],
						linked: false,
						children: [],
					},
				],
			},
		});
		assert.match(await callTool(core, "list_agents", {}), /asked: unknown/);
	});

	it("reports an empty tree as empty, not as an error", async () => {
		const core = fakeCore({ agents: { getTree: () => [] } });
		assert.match(await callTool(core, "list_agents", {}), /No agents recorded/);
	});
});

describe("mcp: search_history", () => {
	it("returns hits with their scope and retrieval mode", async () => {
		const text = await callTool(fakeCore(), "search_history", {
			query: "path traversal",
		});
		assert.match(text, /Path traversal fixed/);
		assert.match(text, /all projects/);
		assert.match(text, /lexical retrieval/);
		assert.match(text, /868 indexed/);
	});

	it("uses hybrid retrieval when embeddings are loaded, and says so", async () => {
		const core = fakeCore({
			research: {
				embeddingsAvailable: true,
				searchHybrid: async () => ({
					hits: [
						{
							score: 1,
							matched: [],
							item: { id: "1", kind: "conclusion", title: "t", text: "x" },
						},
					],
					total: 1,
					searched: 10,
					terms: [],
					scope: "all",
					retrieval: "hybrid",
				}),
			},
		});
		assert.match(
			await callTool(core, "search_history", { query: "q" }),
			/hybrid retrieval/,
		);
	});

	it("answers an empty query rather than searching for nothing", async () => {
		assert.match(await callTool(fakeCore(), "search_history", {}), /No query/);
	});
});

describe("mcp: search_code carries the graph's age", () => {
	it("warns when the graph is out of date", async () => {
		// A stale graph confidently returns symbols that no longer exist.
		const core = fakeCore({
			graph: { status: () => ({ available: true, stale: true }) },
		});
		assert.match(
			await callTool(core, "search_code", { query: "x" }),
			/OUT OF DATE/,
		);
	});

	it("says 'age unknown' rather than implying current", async () => {
		const core = fakeCore({
			graph: { status: () => ({ available: true, stale: null }) },
		});
		assert.match(
			await callTool(core, "search_code", { query: "x" }),
			/age unknown/,
		);
	});

	it("tells the caller how to build a missing graph", async () => {
		const core = fakeCore({
			graph: { status: () => ({ available: false, stale: null }) },
		});
		const text = await callTool(core, "search_code", { query: "x" });
		assert.match(text, /No code graph/);
		assert.match(text, /graphify update/);
	});
});

describe("mcp: the stdio transport", () => {
	/** Drive a real server over streams and collect its replies. */
	function harness() {
		const input = new PassThrough();
		const output = new PassThrough();
		const replies = [];
		let buf = "";
		output.on("data", (d) => {
			buf += d;
			let i;
			while ((i = buf.indexOf("\n")) >= 0) {
				const line = buf.slice(0, i).trim();
				buf = buf.slice(i + 1);
				if (line) replies.push(JSON.parse(line));
			}
		});
		const server = startMcpServer(fakeCore(), { input, output });
		const send = (msg) => input.write(`${JSON.stringify(msg)}\n`);
		const rawSend = (text) => input.write(text);
		const settle = () => new Promise((r) => setTimeout(r, 30));
		return { send, rawSend, replies, settle, server };
	}

	it("completes the initialize handshake", async () => {
		const h = harness();
		h.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
		await h.settle();
		assert.equal(h.replies[0].result.protocolVersion, PROTOCOL_VERSION);
		assert.equal(h.replies[0].result.serverInfo.name, SERVER_NAME);
		assert.deepEqual(h.replies[0].result.capabilities, { tools: {} });
		h.server.close();
	});

	it("REGRESSION: never answers a notification", async () => {
		// A reply to `notifications/initialized` makes some clients drop the
		// connection: it has no id, so a response is unmatched and protocol-
		// illegal.
		const h = harness();
		h.send({ jsonrpc: "2.0", method: "notifications/initialized" });
		h.send({ jsonrpc: "2.0", method: "tools/list" });
		await h.settle();
		assert.deepEqual(h.replies, [], "a notification gets no reply at all");
		h.server.close();
	});

	it("lists tools and calls one", async () => {
		const h = harness();
		h.send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
		h.send({
			jsonrpc: "2.0",
			id: 2,
			method: "tools/call",
			params: { name: "list_agents", arguments: {} },
		});
		await h.settle();
		assert.equal(h.replies[0].result.tools.length, 3);
		assert.equal(h.replies[1].result.content[0].type, "text");
		assert.match(h.replies[1].result.content[0].text, /NEVER REPORTED/);
		h.server.close();
	});

	it("answers malformed JSON with a parse error and keeps serving", async () => {
		const h = harness();
		// Raw garbage on the wire. A transport that dies here takes the whole
		// MCP connection with it, mid-turn, for the model using it.
		h.rawSend("this is not json\n");
		await h.settle();
		assert.equal(h.replies[0].error.code, -32700);

		h.send({ jsonrpc: "2.0", id: 1, method: "ping" });
		await h.settle();
		assert.deepEqual(h.replies[1].result, {}, "still serving afterwards");
		h.server.close();
	});

	it("answers an unknown method with -32601", async () => {
		const h = harness();
		h.send({ jsonrpc: "2.0", id: 1, method: "nope/method" });
		await h.settle();
		assert.equal(h.replies[0].error.code, -32601);
		h.server.close();
	});

	it("returns a message, not a crash, for an unknown tool", async () => {
		const h = harness();
		h.send({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name: "does_not_exist", arguments: {} },
		});
		await h.settle();
		assert.match(h.replies[0].result.content[0].text, /Unknown tool/);
		h.server.close();
	});
});

describe("mcp: --mcp owns stdio alone", () => {
	it("REGRESSION: no IPC notification is interleaved into the MCP stream", async () => {
		// The core broadcasts session/log/fileChange events by writing JSON-RPC
		// notifications straight to stdout. Under `--mcp` the IPC server is never
		// started, but `sendNotification` wrote anyway -- so an MCP client got
		// unsolicited notifications for a protocol it was not speaking,
		// interleaved with its own replies. Two protocols on one pipe.
		const { spawn } = await import("node:child_process");
		const { fileURLToPath } = await import("node:url");
		const { dirname, join } = await import("node:path");
		const { makeTempStore, cleanup: rm } = await import("./helpers.js");

		const CLI = join(
			dirname(fileURLToPath(import.meta.url)),
			"..",
			"dist",
			"cli.js",
		);
		const storagePath = await makeTempStore();

		const child = spawn(process.execPath, [CLI, "--mcp"], {
			env: {
				...process.env,
				INSPECTOR_HOOK_STORAGE: storagePath,
				INSPECTOR_HOOK_WORKSPACE: storagePath,
			},
			stdio: ["pipe", "pipe", "pipe"],
		});

		const lines = [];
		let buf = "";
		child.stdout.on("data", (d) => {
			buf += d;
			let i;
			while ((i = buf.indexOf("\n")) >= 0) {
				const line = buf.slice(0, i).trim();
				buf = buf.slice(i + 1);
				if (line) lines.push(line);
			}
		});

		try {
			await new Promise((r) => setTimeout(r, 3000));
			child.stdin.write(
				`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`,
			);
			await new Promise((r) => setTimeout(r, 1500));

			assert.ok(lines.length > 0, "the server answered");
			const parsed = lines.map((l) => JSON.parse(l));
			const notifications = parsed.filter((m) => m.id === undefined);
			assert.deepEqual(
				notifications.map((n) => n.method),
				[],
				`stdio carried ${notifications.length} unsolicited notifications`,
			);
			assert.equal(parsed[0].id, 1);
			assert.equal(parsed[0].result.tools.length, 3);
		} finally {
			child.kill();
			await rm(storagePath);
		}
	});
});
