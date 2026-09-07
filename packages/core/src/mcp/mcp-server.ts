/**
 * MCP server (Milestone 5).
 *
 * The plan's last M5 deliverable: "Subagent context passing is **capture +
 * expose via MCP** so later agents can query prior findings — working with the
 * platform rather than intercepting it."
 *
 * ## What it answers, and why these three
 *
 * The failure this exists to fix is measured, not hypothetical: 14 of 170
 * captured agents returned a spawn acknowledgement and never a report, so their
 * findings exist only as the trail of work they left behind. A later agent
 * cannot ask the parent what an earlier one concluded, because the parent never
 * received it. It can ask here.
 *
 *   - `search_history`   what was looked up, asked, delegated and concluded,
 *                        across every project on the machine
 *   - `list_agents`      what prior agents were asked, what they did, and
 *                        crucially whether their findings ever came back
 *   - `search_code`      the code and docs graph
 *
 * ## Why the protocol is hand-rolled
 *
 * The same reason the IPC server is: MCP over stdio is newline-delimited
 * JSON-RPC 2.0, this project already implements exactly that, and the official
 * SDK would be the first runtime dependency of a package whose whole point is
 * not to need one. The surface used here is small and stable — `initialize`,
 * `tools/list`, `tools/call`.
 *
 * ## One rule for every response
 *
 * Results say what they are. A tool that returns an agent's result also returns
 * what KIND of result it is, so a reader — human or model — is never handed a
 * spawn acknowledgement dressed as findings. That distinction is the whole
 * reason this milestone found anything.
 */

import { createInterface } from "node:readline";

import type { InspectorCore } from "../core.js";

/** The MCP revision this speaks. */
export const PROTOCOL_VERSION = "2024-11-05";

export const SERVER_NAME = "inspector-hook";

/** Largest text a single tool result may return, to bound context cost. */
export const MAX_RESULT_CHARS = 24_000;

interface JsonRpcMessage {
	jsonrpc?: string;
	id?: string | number | null;
	method?: string;
	params?: unknown;
}

const asRec = (v: unknown): Record<string, unknown> =>
	v && typeof v === "object" && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: {};

const asStr = (v: unknown): string | undefined =>
	typeof v === "string" && v.length > 0 ? v : undefined;

const asNum = (v: unknown): number | undefined =>
	typeof v === "number" && Number.isFinite(v) ? v : undefined;

export interface McpTool {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

/** The tools this server advertises. */
export const TOOLS: McpTool[] = [
	{
		name: "search_history",
		description:
			"Search this machine's Claude Code history: web lookups, subagent " +
			"reports, prompts, conclusions and files read. Cross-project by " +
			"default, which is the point — it answers 'where did I solve this " +
			"before' across every repository, which per-project memory cannot.",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "What to look for." },
				projectKey: {
					type: "string",
					description: "Restrict to one project. Omit to search every project.",
				},
				kinds: {
					type: "array",
					items: { type: "string" },
					description:
						"Filter by kind: web_search, web_fetch, subagent_task, " +
						"subagent_report, user_prompt, conclusion, file_read.",
				},
				limit: { type: "number", description: "Max results (default 10)." },
			},
			required: ["query"],
		},
	},
	{
		name: "list_agents",
		description:
			"List agents and subagents this machine has run: what each was asked, " +
			"how many tool calls it made, how long it took, and whether its " +
			"findings ever came back. An agent whose result is a spawn " +
			"acknowledgement never reported to its parent, so its work is only " +
			"visible here.",
		inputSchema: {
			type: "object",
			properties: {
				sessionId: { type: "string", description: "Restrict to one session." },
				onlyUnreported: {
					type: "boolean",
					description:
						"Only agents that acknowledged their spawn and never returned findings.",
				},
				limit: { type: "number", description: "Max agents (default 20)." },
			},
		},
	},
	{
		name: "search_code",
		description:
			"Search the code and docs graph for this workspace: symbols, the files " +
			"they live in, and what connects to what. Built by graphify; reports " +
			"whether the graph is current, out of date, or of unknown age.",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "Symbol or words to find." },
				limit: { type: "number", description: "Max results (default 10)." },
			},
			required: ["query"],
		},
	},
];

/** Trim a payload so one call cannot flood a caller's context. */
function bounded(text: string): string {
	if (text.length <= MAX_RESULT_CHARS) return text;
	return `${text.slice(0, MAX_RESULT_CHARS)}\n… truncated at ${MAX_RESULT_CHARS} characters.`;
}

/**
 * Run one tool.
 *
 * Exported so the tools are testable without standing up a stdio transport.
 */
export async function callTool(
	core: InspectorCore,
	name: string,
	args: Record<string, unknown>,
): Promise<string> {
	switch (name) {
		case "search_history": {
			const query = asStr(args.query);
			if (!query) return "No query given.";
			const index = core.getResearchIndex();
			const options = {
				limit: Math.min(asNum(args.limit) ?? 10, 50),
				projectKey: asStr(args.projectKey),
				kinds: (Array.isArray(args.kinds)
					? args.kinds.filter((k) => typeof k === "string")
					: undefined) as never,
			};
			const result = index.embeddingsAvailable
				? await index.searchHybrid(query, options)
				: index.search(query, options);

			if (result.hits.length === 0) {
				return `No matches for ${JSON.stringify(query)} in ${result.searched} indexed items (${result.scope}).`;
			}
			const lines = result.hits.map((hit, i) => {
				const item = hit.item;
				return [
					`${i + 1}. [${item.kind}] ${item.title ?? "(untitled)"}`,
					`   ${item.projectName ?? item.projectKey ?? "(unknown project)"} · ${item.timestamp?.slice(0, 10) ?? ""}`,
					`   ${(item.text ?? "").replace(/\s+/g, " ").slice(0, 400)}`,
				].join("\n");
			});
			return bounded(
				`${result.total} matches in ${result.scope === "project" ? "this project" : "all projects"} ` +
					`of ${result.searched} indexed (${result.retrieval ?? "lexical"} retrieval).\n\n` +
					lines.join("\n\n"),
			);
		}

		case "list_agents": {
			const tracker = core.getAgentTracker();
			const limit = Math.min(asNum(args.limit) ?? 20, 100);
			let agents = tracker.getTree({
				sessionId: asStr(args.sessionId),
				limit: 500,
			});
			if (args.onlyUnreported === true) {
				agents = agents.filter((a) => a.resultKind === "spawn-ack");
			}
			const stats = tracker.stats();
			if (agents.length === 0) return "No agents recorded.";

			const lines = agents.slice(0, limit).map((a) => {
				const label = a.name ?? a.type ?? a.agentId ?? a.id;
				const secs =
					a.durationMs != null
						? `${(a.durationMs / 1000).toFixed(0)}s`
						: "unknown";
				const source = a.durationSource ? ` (${a.durationSource})` : "";
				const returned =
					a.resultKind === "spawn-ack"
						? "NEVER REPORTED — the spawn was acknowledged, findings did not come back"
						: a.resultKind === "report"
							? "reported"
							: "nothing recorded";
				return [
					`- ${label} · ${a.status} · ${a.toolCalls.length} tool calls · ${secs}${source}`,
					a.description
						? `  asked: ${a.description}`
						: "  asked: unknown (no spawn call captured)",
					`  returned: ${returned}`,
				].join("\n");
			});
			return bounded(
				`${stats.total} agents · ${stats.running} running · ` +
					`${stats.spawnAckOnly} never reported · ${stats.totalToolCalls} tool calls\n\n` +
					lines.join("\n"),
			);
		}

		case "search_code": {
			const query = asStr(args.query);
			if (!query) return "No query given.";
			const reader = core.getGraphify();
			const status = reader.status();
			if (!status.available) {
				return (
					"No code graph for this workspace. Build one with `graphify update .` " +
					"(AST-only, no API key needed)." +
					(status.error ? `\nReason: ${status.error}` : "")
				);
			}
			const freshness =
				status.stale === null
					? "age unknown"
					: status.stale
						? "OUT OF DATE — symbols may no longer exist"
						: "current";
			const result = reader.search(query, {
				limit: Math.min(asNum(args.limit) ?? 10, 50),
			});
			if (result.hits.length === 0) {
				return `No nodes match ${JSON.stringify(query)} in ${result.searched} (${freshness}).`;
			}
			const lines = result.hits.map(
				(h, i) =>
					`${i + 1}. ${h.node.label} [${h.node.fileType}] ${h.node.sourceFile}:${h.node.sourceLocation} · ${h.degree} edges`,
			);
			return bounded(
				`${result.total} of ${result.searched} nodes match · graph is ${freshness}\n\n${lines.join("\n")}`,
			);
		}

		default:
			return `Unknown tool: ${name}`;
	}
}

/**
 * Speak MCP over stdio until the stream closes.
 *
 * Notifications (a message with no `id`) are answered with nothing, which the
 * spec requires — replying to `notifications/initialized` makes some clients
 * drop the connection.
 */
export function startMcpServer(
	core: InspectorCore,
	options?: { input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream },
): { close: () => void } {
	const input = options?.input ?? process.stdin;
	const output = options?.output ?? process.stdout;
	const rl = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });

	const send = (message: Record<string, unknown>) => {
		output.write(`${JSON.stringify(message)}\n`);
	};

	rl.on("line", (line) => {
		const text = line.trim();
		if (!text) return;

		let msg: JsonRpcMessage;
		try {
			msg = JSON.parse(text);
		} catch {
			send({
				jsonrpc: "2.0",
				id: null,
				error: { code: -32700, message: "Parse error" },
			});
			return;
		}

		// A notification has no id and must never be answered.
		const isNotification = msg.id === undefined || msg.id === null;

		void (async () => {
			try {
				switch (msg.method) {
					case "initialize":
						if (!isNotification) {
							send({
								jsonrpc: "2.0",
								id: msg.id,
								result: {
									protocolVersion: PROTOCOL_VERSION,
									capabilities: { tools: {} },
									serverInfo: { name: SERVER_NAME, version: "0.1.0" },
								},
							});
						}
						return;

					case "notifications/initialized":
					case "initialized":
						return;

					case "tools/list":
						if (!isNotification) {
							send({ jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS } });
						}
						return;

					case "tools/call": {
						if (isNotification) return;
						const params = asRec(msg.params);
						const toolName = asStr(params.name) ?? "";
						const result = await callTool(
							core,
							toolName,
							asRec(params.arguments),
						);
						send({
							jsonrpc: "2.0",
							id: msg.id,
							result: { content: [{ type: "text", text: result }] },
						});
						return;
					}

					case "ping":
						if (!isNotification)
							send({ jsonrpc: "2.0", id: msg.id, result: {} });
						return;

					default:
						if (!isNotification) {
							send({
								jsonrpc: "2.0",
								id: msg.id,
								error: {
									code: -32601,
									message: `Unknown method: ${msg.method}`,
								},
							});
						}
				}
			} catch (error) {
				// A failing tool must not take the server down: the caller is a
				// model mid-turn, and a dead transport is far worse than an error.
				if (!isNotification) {
					send({
						jsonrpc: "2.0",
						id: msg.id,
						error: {
							code: -32603,
							message: error instanceof Error ? error.message : String(error),
						},
					});
				}
			}
		})();
	});

	return { close: () => rl.close() };
}
