/**
 * The resident session set is bounded, and the bound costs a read rather than
 * a disappearance.
 *
 * `load()` parsed EVERY session file into memory. Session records run to
 * megabytes each -- one on this machine is 9 MB -- so the core measured 939 MB
 * resident against a 200 MB budget, and started in ~1,520 ms against a real
 * store versus ~120 ms against an empty one. Both figures grow with history
 * rather than levelling off, and `maxLogsInMemory` bounded the log buffer while
 * nothing bounded this.
 *
 * It also got worse on purpose: retention now defaults to off, so the history
 * this feature exists to search stops being deleted. Unbounded growth was
 * tolerable while something was quietly pruning it. It is not any more.
 *
 * The risk in bounding it is the interesting part, and it is what these tests
 * are mostly about: a session that is not resident must not read as absent.
 * `trackActivity` auto-creates on an unseen id, so an evicted session that
 * looked missing would silently gain a SECOND record.
 */

import { strict as assert } from "node:assert";
import { after, describe, it } from "node:test";

import { PersistenceStore, SessionManager } from "../dist/index.js";
import { cleanup, makeTempStore } from "./helpers.js";

const dirs = [];
after(async () => {
	await Promise.all(dirs.map(cleanup));
});

/** A store seeded with `count` sessions, oldest first. */
async function seeded(count, options = {}) {
	const basePath = await makeTempStore();
	dirs.push(basePath);
	const persistence = new PersistenceStore({ basePath });
	await persistence.initialize();

	for (let i = 0; i < count; i++) {
		const at = new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString();
		await persistence.saveJSON("sessions", `s${i}`, {
			id: `s${i}`,
			name: `session ${i}`,
			status: "completed",
			startTime: at,
			lastActivityTime: at,
			toolExecutions: [],
			fileChanges: [],
			metadata: { projectName: "p" },
		});
		// mtime ordering has one-second resolution on some filesystems, and the
		// bound ranks by mtime. Nudge each file so "newest" is unambiguous.
		const { utimes } = await import("node:fs/promises");
		const t = new Date(Date.UTC(2026, 0, 1, 0, i));
		await utimes(`${basePath}/sessions/s${i}.json`, t, t);
	}

	const manager = new SessionManager({ persistence, ...options });
	await manager.load();
	return { manager, persistence, basePath };
}

describe("the resident session set is bounded", () => {
	it("keeps only the newest N in memory", async () => {
		const { manager } = await seeded(12, { maxSessionsInMemory: 5 });
		const { sessions } = await manager.getSessions();
		assert.equal(sessions.length, 5, "loaded more than the cap");

		// The newest, by mtime.
		const ids = sessions.map((s) => s.id).sort();
		assert.deepEqual(ids, ["s10", "s11", "s7", "s8", "s9"].sort());
		manager.stopStaleSessionCheck?.();
	});

	it("still finds a session that was not loaded", async () => {
		// The whole risk of the bound. `s0` is the oldest and is not resident.
		const { manager } = await seeded(12, { maxSessionsInMemory: 5 });
		const found = await manager.getSession("s0");
		assert.ok(found, "an evicted session read as absent");
		assert.equal(found.id, "s0");
		assert.equal(found.name, "session 0");
		manager.stopStaleSessionCheck?.();
	});

	it("returns null for an id that genuinely does not exist", async () => {
		const { manager } = await seeded(3, { maxSessionsInMemory: 2 });
		assert.equal(await manager.getSession("nope"), null);
		manager.stopStaleSessionCheck?.();
	});

	it("does not let the set grow past the cap as old sessions are read back", async () => {
		const { manager } = await seeded(12, { maxSessionsInMemory: 5 });
		for (const id of ["s0", "s1", "s2", "s3"]) {
			assert.ok(await manager.getSession(id), `${id} should be readable`);
		}
		const { sessions } = await manager.getSessions();
		assert.ok(
			sessions.length <= 5,
			`resident set grew to ${sessions.length}, past the cap of 5`,
		);
		manager.stopStaleSessionCheck?.();
	});

	it("never evicts a session with unsaved changes", async () => {
		// Only memory holds those changes; dropping the record would lose them.
		const { manager } = await seeded(6, { maxSessionsInMemory: 2 });
		await manager.trackActivity("s0", {
			hook: "PostToolUse",
			timestamp: new Date().toISOString(),
			level: "info",
			message: "x",
		});
		// Reading several others must not push the dirty one out.
		for (const id of ["s1", "s2", "s3", "s4"]) await manager.getSession(id);
		assert.ok(await manager.getSession("s0"), "the dirty session survived");
		manager.stopStaleSessionCheck?.();
	});

	it("an event for a non-resident session does not create a second record", async () => {
		// trackActivity auto-creates on an unseen id. If eviction made a session
		// look new, the store would end up with two records for one session.
		const { manager, persistence } = await seeded(8, { maxSessionsInMemory: 2 });
		await manager.trackActivity("s0", {
			hook: "PostToolUse",
			timestamp: new Date().toISOString(),
			level: "info",
			message: "x",
		});
		const session = await manager.getSession("s0");
		assert.equal(session.name, "session 0", "a fresh record replaced the real one");

		const ids = await persistence.listJSON("sessions");
		assert.equal(ids.length, 8, `session count changed: ${ids.length}`);
		manager.stopStaleSessionCheck?.();
	});

	it("loads everything when the store is smaller than the cap", async () => {
		const { manager } = await seeded(3, { maxSessionsInMemory: 200 });
		const { sessions } = await manager.getSessions();
		assert.equal(sessions.length, 3);
		manager.stopStaleSessionCheck?.();
	});
});
