/**
 * Is a configured MCP server actually reachable? (Milestone 8)
 *
 * The Tools view could say "configured" and "never called" from files alone.
 * It could not say whether a server *works* — and M8's audit row for
 * reachability was marked `not-impl` rather than guessed, because rendering
 * "reachable" without connecting is the false-reporting class this project
 * treats as its priority bug.
 *
 * So this connects. It spawns the configured command, performs a real MCP
 * handshake over stdio — `initialize`, `notifications/initialized`,
 * `tools/list` — reads the answer, and kills the child. The client half of the
 * protocol M5 already implements on the server side.
 *
 * ## What it found on the first run, which is why it was worth building
 *
 * Of the 4 servers configured on this machine:
 *
 * - `memory` **cannot start at all**: its interpreter is
 *   `~/Desktop/memory-mcp/…/.venv/bin/python` and neither the venv nor
 *   `~/Desktop/memory-mcp` exists. From the config file alone it looks
 *   identical to a server you simply have not used yet.
 * - `fetcher` is reachable, and identifies itself as **`browser-mcp` 0.1.0**
 *   with 3 tools. The config name and the server's own name disagree.
 * - `playwright` is reachable: Playwright 1.63.0-alpha, 20+ tools.
 *
 * "Configured, 0 calls" and "configured, 0 calls, and it is broken" are
 * different findings, and only one of them is the user's fault.
 *
 * ## Why this is never automatic
 *
 * It runs a command from `~/.claude.json`, which starts a real process — some
 * of these download a package on first run. That is a side effect a scan must
 * never cause, so a probe happens only when a caller asks for it, one server
 * at a time, under a timeout.
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import type { McpProbe, McpProbeStatus } from "@inspector-hook/protocol";

/** The protocol version M5's own server speaks. */
export const MCP_PROTOCOL_VERSION = "2024-11-05";

/** How long a server gets to complete the handshake. */
export const PROBE_TIMEOUT_MS = 20_000;

/** Bytes of stderr kept when a server fails, so the reason is reportable. */
const MAX_STDERR = 600;

/** The shape lives in the protocol; these aliases keep call sites readable. */
export type ProbeStatus = McpProbeStatus;
export type ProbeResult = McpProbe;

export interface ProbeTarget {
	name: string;
	command?: string;
	args?: string[];
}

/**
 * Handshake with one server.
 *
 * Never rejects: a probe's failure is its result. A caller probing four
 * servers must not lose three answers to one broken command.
 */
export function probeMcpServer(
	target: ProbeTarget,
	timeoutMs = PROBE_TIMEOUT_MS,
): Promise<ProbeResult> {
	const started = Date.now();
	const base = { server: target.name };
	const command = target.command;

	if (!command) {
		return Promise.resolve({
			...base,
			status: "not-configured",
			durationMs: 0,
			checkedAt: new Date().toISOString(),
			error: "no command is configured for this server",
		});
	}

	return new Promise<ProbeResult>((resolve) => {
		let settled = false;
		let stderr = "";

		// The env is deliberately inherited and NOT read from the config: the
		// config's `env` holds secrets, and this module never touches it. A
		// server that needs a key will fail its handshake, which is reported as
		// a failure rather than worked around.
		const child = spawn(command, target.args ?? [], {
			stdio: ["pipe", "pipe", "pipe"],
		});

		let timer: ReturnType<typeof setTimeout>;

		const finish = (
			result: Omit<ProbeResult, "server" | "durationMs" | "checkedAt">,
		) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			// SIGKILL rather than SIGTERM: several of these servers install
			// signal handlers and a probe must not leave one running.
			try {
				child.kill("SIGKILL");
			} catch {
				// Already gone.
			}
			resolve({
				...base,
				durationMs: Date.now() - started,
				checkedAt: new Date().toISOString(),
				...result,
			});
		};

		timer = setTimeout(() => {
			finish({
				status: "timeout",
				error: `no handshake within ${timeoutMs}ms${stderr ? `: ${stderr}` : ""}`,
			});
		}, timeoutMs);

		child.on("error", (error) => {
			// ENOENT here is the interesting case: the command in the config no
			// longer exists on disk.
			const enoent = (error as NodeJS.ErrnoException).code === "ENOENT";
			finish({
				status: enoent ? "cannot-start" : "failed",
				error: enoent
					? `the configured command does not exist: ${command}`
					: error.message,
			});
		});

		child.on("exit", (code, signal) => {
			if (settled) return;
			finish({
				status: "failed",
				error: `exited with ${signal ?? code} before completing the handshake${
					stderr ? `: ${stderr}` : ""
				}`,
			});
		});

		child.stderr?.on("data", (chunk: Buffer) => {
			if (stderr.length < MAX_STDERR) {
				stderr = `${stderr}${chunk.toString("utf-8")}`.slice(0, MAX_STDERR);
			}
		});

		const send = (message: unknown) => {
			try {
				child.stdin?.write(`${JSON.stringify(message)}\n`);
			} catch {
				// A closed pipe surfaces through exit or error above.
			}
		};

		let info: Record<string, unknown> | undefined;

		createInterface({ input: child.stdout }).on("line", (line) => {
			let message: Record<string, unknown>;
			try {
				message = JSON.parse(line) as Record<string, unknown>;
			} catch {
				// Servers legitimately write non-JSON banners to stdout.
				return;
			}

			if (message.error && (message.id === 1 || message.id === 2)) {
				const detail = message.error as { message?: string };
				finish({
					status: "failed",
					error: detail?.message ?? "the server answered with an error",
				});
				return;
			}

			if (message.id === 1) {
				info = (message.result ?? {}) as Record<string, unknown>;
				send({ jsonrpc: "2.0", method: "notifications/initialized" });
				send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
				return;
			}

			if (message.id === 2) {
				const result = (message.result ?? {}) as {
					tools?: { name?: string }[];
				};
				const serverInfo = (info?.serverInfo ?? {}) as {
					name?: string;
					version?: string;
				};
				finish({
					status: "reachable",
					...(serverInfo.name ? { serverName: serverInfo.name } : {}),
					...(serverInfo.version ? { serverVersion: serverInfo.version } : {}),
					...(typeof info?.protocolVersion === "string"
						? { protocolVersion: info.protocolVersion }
						: {}),
					advertisedTools: (result.tools ?? [])
						.map((t) => t.name)
						.filter((n): n is string => typeof n === "string"),
				});
			}
		});

		send({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: MCP_PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: { name: "inspector-hook", version: "0.1.0" },
			},
		});
	});
}

/**
 * Probe several servers, one at a time.
 *
 * Sequential on purpose. Each of these is a real process — one spawns a
 * browser — and four at once on a developer's machine is a load a diagnostic
 * has no business causing.
 */
export async function probeMcpServers(
	targets: ProbeTarget[],
	timeoutMs = PROBE_TIMEOUT_MS,
): Promise<ProbeResult[]> {
	const out: ProbeResult[] = [];
	for (const target of targets) {
		out.push(await probeMcpServer(target, timeoutMs));
	}
	return out;
}
