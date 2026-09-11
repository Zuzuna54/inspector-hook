/**
 * Taking the canonical port back (M2.20).
 *
 * An HTTP hook is configured with a LITERAL url — `http://127.0.0.1:52376/api/hook`
 * — and until now the core would settle on 52377 when 52376 was taken and stay
 * there for the rest of its life. So the moment the incumbent exited, the
 * canonical port was dead and every event posted to it went nowhere, with
 * nothing on screen to say so. That is why HTTP could not be the default.
 *
 * These tests use real sockets rather than a stub, because the behaviour under
 * test IS the bind: a mock would prove only that the code calls `listen`.
 */

import { strict as assert } from "node:assert";
import { createServer } from "node:net";
import { after, describe, it } from "node:test";

import {
	FileTracker,
	HttpServer,
	LogManager,
	PersistenceStore,
	PORT_RECLAIM_MS,
	SessionManager,
} from "../dist/index.js";
import { cleanup, makeTempStore } from "./helpers.js";

const servers = [];
const blockers = [];
const stores = [];
after(async () => {
	for (const s of servers) await s.stop().catch(() => {});
	for (const b of blockers) await new Promise((r) => b.close(r));
	for (const dir of stores) await cleanup(dir);
});

/** Occupy a port the way a second core would. */
function occupy(port) {
	return new Promise((resolve, reject) => {
		const blocker = createServer();
		blocker.once("error", reject);
		blocker.listen(port, "127.0.0.1", () => {
			blockers.push(blocker);
			resolve(blocker);
		});
	});
}

async function server(port, onPortChange) {
	// A real store, because the managers persist on construction; the test is
	// about the socket, not about faking their dependencies.
	const storagePath = await makeTempStore();
	stores.push(storagePath);
	const persistence = new PersistenceStore({ basePath: storagePath });
	await persistence.initialize();

	const s = new HttpServer({
		port,
		logManager: new LogManager({
			storagePath,
			maxLogsInMemory: 10,
			persistence,
		}),
		sessionManager: new SessionManager({ storagePath, persistence }),
		fileTracker: new FileTracker({
			workspaceRoot: storagePath,
			storagePath,
			persistence,
		}),
		onPortChange,
	});
	servers.push(s);
	return s;
}

/** Poll until `check` passes or the budget runs out. */
async function until(check, budgetMs = 8000) {
	const deadline = Date.now() + budgetMs;
	while (Date.now() < deadline) {
		if (check()) return true;
		await new Promise((r) => setTimeout(r, 100));
	}
	return false;
}

/**
 * A port unlikely to collide with anything real on this machine.
 *
 * Stepped by more than PORT_SCAN_RANGE (20): a core that scanned upward in an
 * earlier test is still listening a few ports along, and a stride of 1 handed
 * the next test a port that was already taken — which failed as EADDRINUSE
 * inside `occupy`, not inside the code under test.
 */
let next = 53810;
const freePort = () => (next += 30);

describe("the canonical port", () => {
	it("is used directly when free", async () => {
		const port = freePort();
		const core = await server(port);
		await core.start();
		assert.equal(core.getPort(), port);
		assert.equal(core.isReclaiming(), false, "nothing to reclaim");
	});

	it("scans upward when taken, rather than refusing to start", async () => {
		const port = freePort();
		await occupy(port);
		const core = await server(port);
		await core.start();
		assert.ok(core.getPort() > port, "it moved up");
		assert.equal(core.isReclaiming(), true, "and it wants the canonical one");
	});

	it("REGRESSION: takes the canonical port back when its holder exits", async () => {
		// The whole reason HTTP could not be the default. Without this the core
		// sits on 52377 forever and a statically configured hook posts into a
		// closed port for the rest of the session.
		const port = freePort();
		const blocker = await occupy(port);
		const moved = [];
		const core = await server(port, (p) => moved.push(p));
		await core.start();
		assert.ok(core.getPort() > port);

		// The incumbent exits.
		await new Promise((r) => blocker.close(r));

		assert.ok(
			await until(() => core.getPort() === port, PORT_RECLAIM_MS * 3),
			`still on ${core.getPort()} after the canonical port freed up`,
		);
		assert.equal(core.isReclaiming(), false, "the poll stops once it wins");
		assert.deepEqual(moved, [port], "the move is announced exactly once");
	});

	it("keeps serving throughout the migration", async () => {
		// The new socket binds BEFORE the old one closes, so there is no instant
		// at which the core is listening nowhere. Checked by hitting it on the
		// old port right up to the move and on the new one after.
		const port = freePort();
		const blocker = await occupy(port);
		const core = await server(port);
		await core.start();
		const scanned = core.getPort();

		const health = async (p) => {
			try {
				const res = await fetch(`http://127.0.0.1:${p}/api/health`);
				return res.ok;
			} catch {
				return false;
			}
		};
		assert.equal(await health(scanned), true, "serving before the move");

		await new Promise((r) => blocker.close(r));
		assert.ok(await until(() => core.getPort() === port, PORT_RECLAIM_MS * 3));
		assert.equal(await health(port), true, "serving after the move");
	});

	it("stops polling when the core is stopped", async () => {
		// A reclaim timer outliving its server would rebind the canonical port
		// after the core was told to stop — a listener nobody owns.
		const port = freePort();
		const blocker = await occupy(port);
		const core = await server(port);
		await core.start();
		assert.equal(core.isReclaiming(), true);

		await core.stop();
		assert.equal(core.isReclaiming(), false);

		await new Promise((r) => blocker.close(r));
		// Give it more than one interval to misbehave in.
		await new Promise((r) => setTimeout(r, PORT_RECLAIM_MS + 500));
		const stillFree = await new Promise((resolve) => {
			const probe = createServer();
			probe.once("error", () => resolve(false));
			probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
		});
		assert.equal(stillFree, true, "a stopped core must not grab the port");
	});
});
