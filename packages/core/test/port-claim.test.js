/**
 * The port file is how every hook on the machine finds the core, so who owns
 * it decides whose capture works.
 *
 * It used to be written unconditionally. A second core -- a second VS Code
 * window, an Extension Development Host, a scratch instance -- silently
 * redirected all hook traffic at itself; the first kept running and captured
 * nothing, with no error anywhere. On exit the file was left naming a dead
 * port, so capture stayed broken until something restarted.
 *
 * These tests spawn real cores, because the behaviour is entirely about two
 * processes contending for one file.
 */

import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";

import { cleanup, makeTempStore } from "./helpers.js";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

const running = [];
const dirs = [];

after(async () => {
	for (const child of running) child.kill();
	await Promise.all(dirs.map(cleanup));
});

/** Start a core with its own storage but a SHARED port file, and wait for ready. */
async function startCore(portFile, env = {}) {
	const storage = await makeTempStore();
	dirs.push(storage);

	const child = spawn("node", [CLI], {
		stdio: ["pipe", "pipe", "pipe"],
		env: {
			...process.env,
			INSPECTOR_HOOK_STORAGE: storage,
			INSPECTOR_HOOK_PORT_FILE: portFile,
			INSPECTOR_HOOK_HTTP_PORT: "0",
			...env,
		},
	});
	running.push(child);

	let stderr = "";
	child.stderr.on("data", (d) => {
		stderr += d.toString();
	});

	const port = await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("no handshake")), 15_000);
		let buf = "";
		child.stdout.on("data", (chunk) => {
			buf += chunk.toString();
			let i;
			while ((i = buf.indexOf("\n")) !== -1) {
				const line = buf.slice(0, i).trim();
				buf = buf.slice(i + 1);
				if (!line) continue;
				try {
					const msg = JSON.parse(line);
					if (msg.type === "ready") {
						clearTimeout(timer);
						resolve(msg.port);
					}
				} catch {
					/* partial */
				}
			}
		});
	});

	return { child, port, storage, stderr: () => stderr };
}

const readPort = async (file) =>
	parseInt((await readFile(file, "utf-8")).trim(), 10);

describe("port file ownership", () => {
	it("the first core claims it", async () => {
		const dir = await makeTempStore();
		dirs.push(dir);
		const portFile = join(dir, "port");

		const first = await startCore(portFile);

		assert.equal(await readPort(portFile), first.port);
	});

	it("REGRESSION: a second core does NOT steal a live core's claim", async () => {
		// The bug. Both cores run; only the first receives hook events; nothing
		// anywhere said so.
		const dir = await makeTempStore();
		dirs.push(dir);
		const portFile = join(dir, "port");

		const first = await startCore(portFile);
		const second = await startCore(portFile);

		assert.notEqual(second.port, first.port, "they bound different ports");
		assert.equal(
			await readPort(portFile),
			first.port,
			"the incumbent keeps the claim",
		);
	});

	it("and says so on stderr rather than failing silently", async () => {
		const dir = await makeTempStore();
		dirs.push(dir);
		const portFile = join(dir, "port");

		await startCore(portFile);
		const second = await startCore(portFile);
		// stderr is written during startup, which has already completed.
		await new Promise((r) => setTimeout(r, 200));

		const err = second.stderr();
		assert.match(err, /will NOT receive hook events/, `stderr was: ${err}`);
		assert.match(err, /INSPECTOR_HOOK_CLAIM_PORT/, "and says how to override");
	});

	it("takes over a stale claim pointing at a dead port", async () => {
		// The other half of the old bug: a file naming a port nothing listens on
		// must not block a new core, or capture never recovers.
		const dir = await makeTempStore();
		dirs.push(dir);
		const portFile = join(dir, "port");
		await writeFile(portFile, "59999", "utf-8"); // nothing there

		const core = await startCore(portFile);

		assert.equal(await readPort(portFile), core.port, "stale claim replaced");
	});

	it("takes over when the file is corrupt", async () => {
		const dir = await makeTempStore();
		dirs.push(dir);
		const portFile = join(dir, "port");
		await writeFile(portFile, "not a port at all", "utf-8");

		const core = await startCore(portFile);

		assert.equal(await readPort(portFile), core.port);
	});

	it("INSPECTOR_HOOK_CLAIM_PORT=1 takes over deliberately", async () => {
		const dir = await makeTempStore();
		dirs.push(dir);
		const portFile = join(dir, "port");

		const first = await startCore(portFile);
		const second = await startCore(portFile, {
			INSPECTOR_HOOK_CLAIM_PORT: "1",
		});

		assert.equal(
			await readPort(portFile),
			second.port,
			"an explicit takeover is honoured",
		);
		assert.notEqual(await readPort(portFile), first.port);
	});

	it("releases its own claim on shutdown, leaving no dead pointer", async () => {
		const dir = await makeTempStore();
		dirs.push(dir);
		const portFile = join(dir, "port");

		const core = await startCore(portFile);
		assert.equal(await readPort(portFile), core.port);

		core.child.kill("SIGTERM");
		for (let i = 0; i < 40; i++) {
			const still = await readFile(portFile, "utf-8").catch(() => null);
			if (still === null) break;
			await new Promise((r) => setTimeout(r, 50));
		}

		const after_ = await readFile(portFile, "utf-8").catch(() => null);
		assert.equal(after_, null, "a dead core must not keep the claim");
	});

	it("a shutting-down core does not delete someone else's claim", async () => {
		// The guard on release. If the second core deleted the file on exit, it
		// would break capture for the first, which is still running and still
		// the rightful owner.
		const dir = await makeTempStore();
		dirs.push(dir);
		const portFile = join(dir, "port");

		const first = await startCore(portFile);
		const second = await startCore(portFile); // did not claim

		second.child.kill("SIGTERM");
		await new Promise((r) => setTimeout(r, 600));

		assert.equal(
			await readPort(portFile),
			first.port,
			"the incumbent's claim survives the other core's exit",
		);
	});
});
