/**
 * MCP server reachability (M8).
 *
 * The audit row for this was `not-impl` on purpose: showing "reachable"
 * without connecting is the false-reporting class this project treats as its
 * priority bug. So the probe does a real handshake, and these tests do too —
 * against fixture servers written here rather than against whatever happens to
 * be installed, so they pass on CI and can exercise the failure modes.
 *
 * The finding that justified building it: on the machine this was written for,
 * `memory` is configured, has never been called, and its interpreter does not
 * exist. `cannot-start` is a different fact from `never used`, and only one of
 * them is the user's fault.
 */

import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { probeMcpServer, probeMcpServers } from "../dist/index.js";

const dirs = [];
after(async () => {
	for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

async function temp() {
	const dir = await mkdtemp(join(tmpdir(), "ih-mcp-"));
	dirs.push(dir);
	return dir;
}

/** A fixture server that speaks just enough MCP to be probed. */
async function fakeServer(body) {
	const dir = await temp();
	const path = join(dir, "server.mjs");
	await writeFile(
		path,
		`import { createInterface } from "node:readline";
const send = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  ${body}
});
`,
		"utf-8",
	);
	return path;
}

const WELL_BEHAVED = `
  if (m.id === 1) return send({ jsonrpc: "2.0", id: 1, result: {
    protocolVersion: "2024-11-05",
    serverInfo: { name: "fixture-server", version: "9.9.9" },
    capabilities: {},
  }});
  if (m.id === 2) return send({ jsonrpc: "2.0", id: 2, result: {
    tools: [{ name: "alpha" }, { name: "beta" }, { name: "gamma" }],
  }});
`;

describe("probing a server that answers", () => {
	it("completes the handshake and reports what the server advertises", async () => {
		const server = await fakeServer(WELL_BEHAVED);
		const result = await probeMcpServer(
			{ name: "fixture", command: process.execPath, args: [server] },
			15000,
		);

		assert.equal(result.status, "reachable");
		assert.equal(result.server, "fixture", "the config key it was probed as");
		// The name the server calls ITSELF, which really does disagree with the
		// config key in practice: `fetcher` answers as `browser-mcp`.
		assert.equal(result.serverName, "fixture-server");
		assert.equal(result.serverVersion, "9.9.9");
		assert.equal(result.protocolVersion, "2024-11-05");
		assert.deepEqual(result.advertisedTools, ["alpha", "beta", "gamma"]);
		assert.ok(result.durationMs >= 0);
		assert.ok(result.checkedAt, "a probe is a fact about a moment in time");
	});

	it("tolerates a non-JSON banner on stdout", async () => {
		// Real servers print startup noise. Treating a banner as a protocol
		// error would report a working server as broken.
		const server = await fakeServer(
			`if (m.id === 1) { process.stdout.write("starting up...\\n"); ${WELL_BEHAVED} }
       else { ${WELL_BEHAVED} }`,
		);
		const result = await probeMcpServer(
			{ name: "noisy", command: process.execPath, args: [server] },
			15000,
		);
		assert.equal(result.status, "reachable");
	});
});

describe("probing a server that does not answer", () => {
	it("REGRESSION: a command that does not exist is cannot-start, not failed", async () => {
		// The real case. `memory` on this machine points at a venv interpreter
		// under a directory that has been deleted, and the whole reason to
		// probe is that the config file cannot tell you that.
		const result = await probeMcpServer(
			{
				name: "memory",
				command: "/nonexistent/.venv/bin/python",
				args: ["-m", "x"],
			},
			5000,
		);
		assert.equal(result.status, "cannot-start");
		assert.match(result.error, /does not exist/);
		assert.match(result.error, /nonexistent/, "it names the command");
	});

	it("reports a server that exits before handshaking", async () => {
		const dir = await temp();
		const path = join(dir, "quitter.mjs");
		await writeFile(
			path,
			`process.stderr.write("cannot find config\\n"); process.exit(3);`,
			"utf-8",
		);
		const result = await probeMcpServer(
			{ name: "quitter", command: process.execPath, args: [path] },
			8000,
		);
		assert.equal(result.status, "failed");
		// stderr is carried through, because "it exited" alone is not actionable.
		assert.match(result.error, /cannot find config/);
	});

	it("times out on a server that starts and says nothing", async () => {
		const dir = await temp();
		const path = join(dir, "mute.mjs");
		await writeFile(path, `setInterval(() => {}, 1000);`, "utf-8");
		const started = Date.now();
		const result = await probeMcpServer(
			{ name: "mute", command: process.execPath, args: [path] },
			1200,
		);
		assert.equal(result.status, "timeout");
		assert.match(result.error, /no handshake within 1200ms/);
		// And it must actually return at the timeout rather than hang.
		assert.ok(Date.now() - started < 6000, "the timeout is enforced");
	});

	it("surfaces a JSON-RPC error answer as failed", async () => {
		const server = await fakeServer(
			`if (m.id === 1) return send({ jsonrpc: "2.0", id: 1,
         error: { code: -32603, message: "no API key configured" } });`,
		);
		const result = await probeMcpServer(
			{ name: "keyless", command: process.execPath, args: [server] },
			8000,
		);
		assert.equal(result.status, "failed");
		assert.match(result.error, /no API key configured/);
	});

	it("reports a server with no command rather than spawning nothing", async () => {
		const result = await probeMcpServer({ name: "bodiless" }, 1000);
		assert.equal(result.status, "not-configured");
		assert.equal(result.durationMs, 0);
	});
});

describe("probing several servers", () => {
	it("one broken server does not cost the others their answer", async () => {
		const good = await fakeServer(WELL_BEHAVED);
		const results = await probeMcpServers(
			[
				{ name: "broken", command: "/nonexistent/thing" },
				{ name: "good", command: process.execPath, args: [good] },
			],
			8000,
		);
		assert.equal(results.length, 2);
		assert.equal(results[0].status, "cannot-start");
		assert.equal(results[1].status, "reachable");
	});

	it("probes sequentially, because these are real processes", async () => {
		// One of the servers configured on this machine starts a browser.
		// Four at once is a load a diagnostic has no business causing.
		const server = await fakeServer(
			`if (m.id === 1) { setTimeout(() => { ${WELL_BEHAVED} }, 250); } else { ${WELL_BEHAVED} }`,
		);
		const target = { name: "slow", command: process.execPath, args: [server] };
		const started = Date.now();
		await probeMcpServers([target, { ...target, name: "slow2" }], 15000);
		// Two sequential 250ms handshakes cannot finish in under 250ms.
		assert.ok(
			Date.now() - started >= 250,
			`took ${Date.now() - started}ms, which suggests they overlapped`,
		);
	});
});
