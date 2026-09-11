/**
 * Retention tiering, end to end through the core (M4.13).
 *
 * `retention-tiering.test.js` already pins `PersistenceStore.cleanup` against a
 * FAKE collapse hook, and every one of those tests passed while the feature had
 * never run once: `summaries/` on the real machine was empty, because the store
 * held four days against a seven-day retention. So the unit tests proved the
 * contract and proved nothing about the wiring.
 *
 * This drives the real path — `InspectorCore` → `LogManager.enforceRetention` →
 * `PersistenceStore.cleanup` → `core.collapseSession` → a summary on disk with
 * a real digest in it. It is the difference between "cleanup calls the hook it
 * was given" and "the core actually gives it one".
 *
 * Verified first against a copy of the real store: one session aged past the
 * cutoff, produced a summary carrying its digest and counts, and its raw record
 * was then deleted (14 sessions to 13).
 */

import { strict as assert } from "node:assert";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { InspectorCore } from "../dist/index.js";
import { cleanup, makeTempStore } from "./helpers.js";

const dirs = [];
after(async () => {
	for (const dir of dirs) await cleanup(dir);
});

/** ISO timestamp N days ago. */
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();

/**
 * A store holding one old session and one recent one.
 *
 * Written as files rather than through the API because retention reads what is
 * on disk, and seeding through the API would prove only that the API writes
 * what the API reads.
 */
async function seedStore({ oldDays, recentDays }) {
	const storagePath = await makeTempStore();
	dirs.push(storagePath);

	const session = (id, started, ended) => ({
		id,
		name: `session-${id}`,
		status: "completed",
		startTime: started,
		endTime: ended,
		metadata: { projectName: "demo", workingDirectory: "/tmp/demo" },
		toolExecutions: [
			{ id: "e1", tool: "Bash", status: "completed", startTime: started },
			{ id: "e2", tool: "Read", status: "completed", startTime: started },
		],
		fileChanges: [],
		logs: [],
	});

	// makeTempStore only creates the base directory; the category folders are
	// made by PersistenceStore.initialize, which has not run yet.
	await mkdir(join(storagePath, "sessions"), { recursive: true });
	await writeFile(
		join(storagePath, "sessions", "old-one.json"),
		JSON.stringify(session("old-one", daysAgo(oldDays), daysAgo(oldDays))),
		"utf-8",
	);
	await writeFile(
		join(storagePath, "sessions", "recent-one.json"),
		JSON.stringify(
			session("recent-one", daysAgo(recentDays), daysAgo(recentDays)),
		),
		"utf-8",
	);
	return storagePath;
}

async function startCore(storagePath, logRetentionDays) {
	const core = new InspectorCore({
		storagePath,
		config: { httpPort: 0, logRetentionDays, enableIpc: false },
	});
	await core.start();
	return core;
}

const ls = async (dir) => (await readdir(dir).catch(() => [])).sort();

describe("retention through the core", () => {
	it("REGRESSION: an expiring session becomes a summary before it is deleted", async () => {
		const storagePath = await seedStore({ oldDays: 9, recentDays: 1 });
		// Retention runs at LOAD, not only on the timer — `loadLogs` calls it so
		// a restart cannot resurrect data the policy says is gone. So by the
		// time start() resolves, the collapse has already happened; asserting an
		// empty summaries/ beforehand was a wrong guess about the lifecycle, and
		// the test said so before the code did.
		const core = await startCore(storagePath, 5);
		try {
			const summaries = await ls(join(storagePath, "summaries"));
			assert.deepEqual(
				summaries,
				["old-one.json"],
				"the expiring session must be preserved before the delete",
			);

			// The raw record is gone, which is the half that already worked.
			const sessions = await ls(join(storagePath, "sessions"));
			assert.equal(
				sessions.includes("old-one.json"),
				false,
				"raw record pruned",
			);
			assert.equal(
				sessions.includes("recent-one.json"),
				true,
				"a session inside the window is untouched",
			);
		} finally {
			await core.stop();
		}
	});

	it("the summary carries the real digest, not a placeholder", async () => {
		// The collapse path used to write the WEAKEST of the three digests —
		// the permanent record said "N changes (paths unresolved)" while the
		// regenerable preview got the good one. Exactly backwards, and only
		// visible by reading what actually lands on disk.
		const storagePath = await seedStore({ oldDays: 9, recentDays: 1 });
		const core = await startCore(storagePath, 5);
		try {
			const summary = JSON.parse(
				await readFile(join(storagePath, "summaries", "old-one.json"), "utf-8"),
			);

			assert.equal(summary.id, "old-one");
			assert.ok(summary.collapsedAt, "when it was collapsed");
			assert.equal(
				summary.toolExecutionCount,
				2,
				"counts survive the collapse",
			);
			assert.ok(
				typeof summary.digest === "string" && summary.digest.length > 0,
				"a summary with no digest preserves nothing worth keeping",
			);
			assert.match(summary.digest, /old-one/, "the digest names its session");
		} finally {
			await core.stop();
		}
	});

	it("does nothing when retention is disabled", async () => {
		// 0 is how a user opts into keeping everything, and it must not be
		// treated as "expire immediately".
		const storagePath = await seedStore({ oldDays: 90, recentDays: 1 });
		const core = await startCore(storagePath, 0);
		try {
			await core.getLogManager().enforceRetention();
			assert.deepEqual(
				await ls(join(storagePath, "summaries")),
				[],
				"retention off must not be read as expire-immediately",
			);
			assert.equal(
				(await ls(join(storagePath, "sessions"))).length,
				2,
				"nothing is pruned when retention is off",
			);
		} finally {
			await core.stop();
		}
	});

	it("leaves everything alone when nothing has expired", async () => {
		const storagePath = await seedStore({ oldDays: 2, recentDays: 1 });
		const core = await startCore(storagePath, 30);
		try {
			await core.getLogManager().enforceRetention();
			assert.deepEqual(await ls(join(storagePath, "summaries")), []);
			assert.equal((await ls(join(storagePath, "sessions"))).length, 2);
		} finally {
			await core.stop();
		}
	});
});
