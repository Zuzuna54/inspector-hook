/**
 * Retention must preserve before it prunes.
 *
 * The plan pairs "drop raw rows" with "collapse to session summaries first".
 * Only the dropping was implemented, so ageing out deleted the single record of
 * a session and left every citation of it unresolvable. That is not a
 * hypothetical: 27 of 33 files in the real memory corpus cite an origin
 * session, and none of those sessions exists anywhere any more.
 *
 * The tests that matter here are the refusals — a session that cannot be
 * summarised must survive, because deleting the only copy of something we
 * undertook to preserve is strictly worse than leaving it on disk.
 */

import { strict as assert } from "node:assert";
import { after, describe, it } from "node:test";

import { PersistenceStore } from "../dist/index.js";
import { cleanup, makeTempStore } from "./helpers.js";

const dirs = [];
after(async () => {
	await Promise.all(dirs.map(cleanup));
});

async function newStore() {
	const basePath = await makeTempStore();
	dirs.push(basePath);
	const store = new PersistenceStore({ basePath });
	await store.initialize();
	return { store, basePath };
}

const daysAgo = (n) =>
	new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

/** Seed one expired and one recent session. */
async function seed(store) {
	await store.saveJSON("sessions", "old", {
		id: "old",
		status: "completed",
		startTime: daysAgo(60),
		lastActivityTime: daysAgo(60),
	});
	await store.saveJSON("sessions", "recent", {
		id: "recent",
		status: "active",
		startTime: daysAgo(1),
		lastActivityTime: daysAgo(1),
	});
}

const WEEK = 7 * 24 * 60 * 60 * 1000;

describe("retention tiering", () => {
	it("collapses an expiring session before deleting it", async () => {
		const { store } = await newStore();
		await seed(store);

		const collapsed = [];
		const result = await store.cleanup({
			maxAgeMs: WEEK,
			collapseSession: async (id, session) => {
				collapsed.push({ id, startTime: session.startTime });
				await store.saveJSON("summaries", id, { id, description: "kept" });
				return true;
			},
		});

		assert.deepEqual(
			collapsed.map((c) => c.id),
			["old"],
			"only the expired session is collapsed",
		);
		assert.equal(result.collapsed, 1);
		assert.equal(await store.loadJSON("sessions", "old"), null, "raw record gone");
		assert.ok(await store.loadJSON("summaries", "old"), "summary survives");
		assert.ok(await store.loadJSON("sessions", "recent"), "recent untouched");
	});

	it("REFUSES to delete a session it could not collapse", async () => {
		// The property that matters. Freeing bytes is worth less than the only
		// copy of something we undertook to summarise.
		const { store } = await newStore();
		await seed(store);

		const result = await store.cleanup({
			maxAgeMs: WEEK,
			collapseSession: () => false,
		});

		assert.equal(result.collapseFailures, 1);
		assert.equal(result.collapsed, 0);
		assert.ok(
			await store.loadJSON("sessions", "old"),
			"an unpreservable session stays on disk",
		);
	});

	it("treats a throwing collapse as a failure, not as permission", async () => {
		const { store } = await newStore();
		await seed(store);

		const result = await store.cleanup({
			maxAgeMs: WEEK,
			collapseSession: () => {
				throw new Error("summary backend down");
			},
		});

		assert.equal(result.collapseFailures, 1);
		assert.ok(await store.loadJSON("sessions", "old"), "still there");
	});

	it("still deletes when no collapse hook is supplied", async () => {
		// Backwards compatible: a caller that does not opt in gets the old
		// behaviour rather than silently stopping retention.
		const { store } = await newStore();
		await seed(store);

		const result = await store.cleanup({ maxAgeMs: WEEK });

		assert.equal(await store.loadJSON("sessions", "old"), null);
		assert.equal(result.collapsed, 0);
		assert.equal(result.collapseFailures, 0);
	});

	it("keeps an archive whose session survived a failed collapse", async () => {
		// Archives are deleted when orphaned by an expired session. If the
		// session was not actually deleted, its archive must not be either.
		const { store } = await newStore();
		await seed(store);
		await store.saveJSON("archives", "a1", {
			id: "a1",
			sessionId: "old",
			archivedAt: daysAgo(1),
		});

		await store.cleanup({ maxAgeMs: WEEK, collapseSession: () => false });

		assert.ok(await store.loadJSON("sessions", "old"), "session kept");
		assert.ok(
			await store.loadJSON("archives", "a1"),
			"and so is the archive that belongs to it",
		);
	});

	it("reports zero counts when nothing expires", async () => {
		const { store } = await newStore();
		await store.saveJSON("sessions", "recent", {
			id: "recent",
			startTime: daysAgo(1),
			lastActivityTime: daysAgo(1),
		});

		const result = await store.cleanup({
			maxAgeMs: WEEK,
			collapseSession: () => {
				throw new Error("must not be called");
			},
		});
		assert.equal(result.collapsed, 0);
		assert.equal(result.collapseFailures, 0);
	});

	it("a no-op cleanup reports the new counters too", async () => {
		const { store } = await newStore();
		assert.deepEqual(await store.cleanup(), {
			deletedFiles: 0,
			freedBytes: 0,
			collapsed: 0,
			collapseFailures: 0,
		});
	});
});
