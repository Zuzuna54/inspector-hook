/**
 * PersistenceStore tests — JSON/JSONL round-trips, log rotation, version
 * snapshots, and path sanitization.
 *
 * Path sanitization matters beyond tidiness: version content is stored in a
 * directory named after the file's absolute path, so a path that escaped
 * sanitization could write outside the store.
 */

import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";

import { PersistenceStore } from "../dist/index.js";
import { cleanup, makeTempStore } from "./helpers.js";

const tempDirs = [];

async function newStore(options = {}) {
	const basePath = await makeTempStore();
	tempDirs.push(basePath);
	const store = new PersistenceStore({ basePath, ...options });
	await store.initialize();
	return { store, basePath };
}

after(async () => {
	await Promise.all(tempDirs.map(cleanup));
});

describe("PersistenceStore", () => {
	describe("initialize", () => {
		it("creates the category directories", async () => {
			const { basePath } = await newStore();
			for (const dir of [
				"sessions", "logs", "versions", "archives", "changes", "snapshots",
			]) {
				assert.ok(existsSync(join(basePath, dir)), `${dir} should exist`);
			}
		});

		it("is safe to call twice", async () => {
			const { store, basePath } = await newStore();
			await store.initialize();
			assert.ok(existsSync(join(basePath, "sessions")));
		});
	});

	describe("JSON documents", () => {
		it("round-trips a document", async () => {
			const { store } = await newStore();
			const data = { id: "a", nested: { n: 1 }, list: [1, 2, 3] };

			await store.saveJSON("sessions", "a", data);

			assert.deepEqual(await store.loadJSON("sessions", "a"), data);
		});

		it("returns null for a missing document", async () => {
			const { store } = await newStore();
			assert.equal(await store.loadJSON("sessions", "nope"), null);
		});

		it("returns null rather than throwing on malformed JSON", async () => {
			const { store, basePath } = await newStore();
			const { writeFile } = await import("node:fs/promises");
			await writeFile(join(basePath, "sessions", "bad.json"), "{not json", "utf-8");

			assert.equal(await store.loadJSON("sessions", "bad"), null);
		});

		it("overwrites on repeat save", async () => {
			const { store } = await newStore();
			await store.saveJSON("sessions", "a", { v: 1 });
			await store.saveJSON("sessions", "a", { v: 2 });

			assert.deepEqual(await store.loadJSON("sessions", "a"), { v: 2 });
		});

		it("lists and bulk-loads a category", async () => {
			const { store } = await newStore();
			await store.saveJSON("sessions", "a", { id: "a" });
			await store.saveJSON("sessions", "b", { id: "b" });

			assert.deepEqual((await store.listJSON("sessions")).sort(), ["a", "b"]);
			assert.equal((await store.loadAllJSON("sessions")).size, 2);
		});

		it("skips malformed files when bulk-loading", async () => {
			const { store, basePath } = await newStore();
			const { writeFile } = await import("node:fs/promises");
			await store.saveJSON("sessions", "good", { id: "good" });
			await writeFile(join(basePath, "sessions", "bad.json"), "{{{", "utf-8");

			const all = await store.loadAllJSON("sessions");
			assert.equal(all.size, 1, "one good document survives");
			assert.ok(all.has("good"));
		});

		it("deletes a document", async () => {
			const { store } = await newStore();
			await store.saveJSON("sessions", "a", { id: "a" });

			assert.equal(await store.deleteJSON("sessions", "a"), true);
			assert.equal(await store.loadJSON("sessions", "a"), null);
			assert.equal(await store.deleteJSON("sessions", "a"), false, "idempotent");
		});

		it("reports existence", async () => {
			const { store } = await newStore();
			await store.saveJSON("sessions", "a", {});

			assert.equal(await store.existsJSON("sessions", "a"), true);
			assert.equal(await store.existsJSON("sessions", "b"), false);
		});

		it("returns an empty list for an unknown category", async () => {
			const { store } = await newStore();
			assert.deepEqual(await store.listJSON("no-such-category"), []);
		});
	});

	describe("JSONL logs", () => {
		it("appends and reads back in order", async () => {
			const { store } = await newStore();
			await store.appendLog("activity", { n: 1 });
			await store.appendLog("activity", { n: 2 });

			assert.deepEqual(await store.loadLogs("activity"), [{ n: 1 }, { n: 2 }]);
		});

		it("returns an empty array for a missing log", async () => {
			const { store } = await newStore();
			assert.deepEqual(await store.loadLogs("nothing"), []);
		});

		it("counts entries", async () => {
			const { store } = await newStore();
			await store.appendLog("activity", { n: 1 });
			await store.appendLog("activity", { n: 2 });

			assert.equal(await store.getLogCount("activity"), 2);
		});

		it("streams entries", async () => {
			const { store } = await newStore();
			await store.appendLog("activity", { n: 1 });
			await store.appendLog("activity", { n: 2 });

			const seen = [];
			for await (const entry of store.streamLogs("activity")) seen.push(entry);
			assert.equal(seen.length, 2);
		});

		it("truncates on clear but keeps the file", async () => {
			const { store } = await newStore();
			await store.appendLog("activity", { n: 1 });
			await store.clearLog("activity");

			assert.equal(await store.getLogCount("activity"), 0);
		});

		it("survives a partially-written trailing line", async () => {
			const { store, basePath } = await newStore();
			const { appendFile } = await import("node:fs/promises");
			await store.appendLog("activity", { n: 1 });
			// Simulate a crash mid-append.
			await appendFile(join(basePath, "logs", "activity.jsonl"), '{"n":2', "utf-8");

			// Current behaviour: a torn final line makes the whole read fail soft.
			// Asserted so a future fix (skip-bad-lines) is a deliberate change.
			const logs = await store.loadLogs("activity");
			assert.ok(Array.isArray(logs), "must not throw");
		});

		it("rotates once the size cap is exceeded", async () => {
			const { store, basePath } = await newStore({ maxLogFileSize: 512 });
			const big = "x".repeat(200);
			for (let i = 0; i < 12; i++) {
				await store.appendLog("activity", { i, big });
			}

			const files = (await readdir(join(basePath, "logs")))
				.filter((f) => f.endsWith(".jsonl"));
			assert.ok(files.length > 1, `expected a rotated file, saw ${files}`);
		});

		it("keeps the live log small after rotation", async () => {
			const { store, basePath } = await newStore({ maxLogFileSize: 512 });
			const big = "x".repeat(200);
			for (let i = 0; i < 12; i++) {
				await store.appendLog("activity", { i, big });
			}

			const live = await stat(join(basePath, "logs", "activity.jsonl"));
			assert.ok(live.size < 2048, "the active file should have been rolled");
		});
	});

	describe("version snapshots", () => {
		it("round-trips content and metadata", async () => {
			const { store } = await newStore();
			await store.saveVersion("/proj/src/a.ts", 1, "content v1", { hash: "abc" });

			const loaded = await store.loadVersion("/proj/src/a.ts", 1);
			assert.equal(loaded.content, "content v1");
			assert.equal(loaded.metadata.hash, "abc");
		});

		it("returns null for a missing version", async () => {
			const { store } = await newStore();
			assert.equal(await store.loadVersion("/proj/a.ts", 99), null);
		});

		it("lists versions in numeric order", async () => {
			const { store } = await newStore();
			for (const n of [3, 1, 10, 2]) {
				await store.saveVersion("/proj/a.ts", n, `v${n}`);
			}
			assert.deepEqual(await store.listVersions("/proj/a.ts"), [1, 2, 3, 10]);
		});

		it("deletes a version", async () => {
			const { store } = await newStore();
			await store.saveVersion("/proj/a.ts", 1, "v1");

			assert.equal(await store.deleteVersion("/proj/a.ts", 1), true);
			assert.equal(await store.loadVersion("/proj/a.ts", 1), null);
		});

		it("keeps different files' versions separate", async () => {
			const { store } = await newStore();
			await store.saveVersion("/proj/a.ts", 1, "a content");
			await store.saveVersion("/proj/b.ts", 1, "b content");

			assert.equal((await store.loadVersion("/proj/a.ts", 1)).content, "a content");
			assert.equal((await store.loadVersion("/proj/b.ts", 1)).content, "b content");
		});
	});

	describe("path sanitization", () => {
		it("keeps traversal sequences inside the store", async () => {
			const { store, basePath } = await newStore();
			await store.saveVersion("/proj/../../../etc/passwd", 1, "should stay put");

			// Nothing may be created outside the versions directory.
			const versionDirs = await readdir(join(basePath, "versions"));
			assert.equal(versionDirs.length, 1);
			assert.ok(
				!versionDirs[0].includes("/") && !versionDirs[0].includes(".."),
				`directory name must be flattened, got ${versionDirs[0]}`,
			);
		});

		it("round-trips a path with special characters", async () => {
			const { store } = await newStore();
			const weird = "/proj/a b:c?d*e.ts";
			await store.saveVersion(weird, 1, "content");

			assert.equal((await store.loadVersion(weird, 1)).content, "content");
		});
	});

	describe("getStats", () => {
		it("reports counts and a total size", async () => {
			const { store } = await newStore();
			await store.saveJSON("sessions", "a", { id: "a" });
			await store.appendLog("activity", { n: 1 });
			await store.saveVersion("/proj/a.ts", 1, "v1");

			const stats = await store.getStats();
			assert.equal(stats.sessionCount, 1);
			assert.equal(stats.logCount, 1);
			assert.ok(stats.totalSize > 0);
		});
	});

	describe("path containment", () => {
	it("SECURITY: a traversing id cannot write outside the store", async () => {
		// getJSONPath used to join the id raw, and ids reach it straight from
		// the ingest payload -- session-manager saves under the sessionId a hook
		// sent. So POSTing {"sessionId": "../../evil"} to the local ingest
		// endpoint wrote a JSON file anywhere the core could write. Confirmed
		// end-to-end against a running core before the fix.
		const { store, basePath } = await newStore();
		const escaped = join(basePath, "..", `ESCAPED-${process.pid}.json`);

		await store.saveJSON("sessions", `../../ESCAPED-${process.pid}`, { x: 1 });

		assert.equal(existsSync(escaped), false, "nothing may be written outside");
		const written = await readdir(join(basePath, "sessions"));
		assert.equal(written.length, 1, "it lands inside the store instead");
		assert.ok(!written[0].includes(".."), "and with the traversal neutralised");
	});

	it("SECURITY: a traversing category is contained too", async () => {
		// This test USED TO PASS AGAINST THE UNFIXED CODE. Proven by running it
		// in a worktree at the commit before the traversal fix: the id test
		// failed correctly and this one passed. It checked
		// `basePath/../evil` while an unsanitised `../../evil` category writes
		// to `basePath/../../evil` — one level short, so it asserted the absence
		// of something that was never going to be there either way.
		//
		// A security test that passes against the vulnerability it names is
		// worse than no test: it certifies the bug. Now it asserts the property
		// (nothing outside the store at all) rather than guessing one path.
		const { store, basePath } = await newStore();
		const outside = resolve(basePath, "..");

		const before = new Set(await readdir(outside));
		await store.saveJSON("../../evil", "id", { x: 1 });
		await store.saveJSON("../evil2", "id", { x: 1 });
		const after = new Set(await readdir(outside));

		assert.deepEqual(
			[...after].filter((e) => !before.has(e)),
			[],
			"a traversing category must create nothing outside the store",
		);
		// And positively: it landed inside, with the traversal neutralised.
		const inside = await readdir(basePath);
		assert.ok(
			inside.some((d) => d.includes("evil")),
			`the category should be contained inside the store, got ${inside}`,
		);
	});

	it("leaves ordinary ids exactly as they were", async () => {
		// The sanitiser REPLACES rather than rejects, so every id already in use
		// must still resolve to the same file. UUIDs and the version store's
		// flattened paths contain none of the replaced characters.
		const { store } = await newStore();
		for (const id of [
			"afe5a7cb-ad26-4094-9c1f-000000000001",
			"__Users__me__proj__a.ts",
			"session-2026-09-03-abcd",
		]) {
			await store.saveJSON("sessions", id, { id });
			assert.equal((await store.loadJSON("sessions", id))?.id, id, id);
		}
	});

	it("a log filename cannot escape the log directory", async () => {
		// Asserts the PROPERTY (nothing new outside the store), not a fixed
		// path. The earlier version checked `<tmp>/escaped.jsonl` — a shared
		// name in the system temp directory — so a leftover from any other run
		// broke it. One did: running this very suite against the pre-fix code in
		// a worktree wrote that file for real, which proved the vulnerability
		// and then failed this test in the main tree for an unrelated reason.
		//
		// A test that can be broken by another run's debris is not testing what
		// it claims to.
		const { store, basePath } = await newStore();
		const outside = resolve(basePath, "..");

		const before = new Set(await readdir(outside));
		await store.appendLog("../../escaped", { n: 1 });
		const after = new Set(await readdir(outside));

		assert.deepEqual(
			[...after].filter((e) => !before.has(e)),
			[],
			"a traversing log name must create nothing outside the store",
		);
	});
});

describe("cleanup", () => {
		it("REGRESSION: is no longer a stub — it prunes expired log entries", async () => {
			// This test previously asserted cleanup returned zeroes and deleted
			// nothing. It kept passing after cleanup was implemented, because the
			// fixture entry had no timestamp and so could not be aged -- a passing
			// test asserting behaviour that no longer existed.
			const { store } = await newStore();
			const old = new Date(Date.now() - 60_000).toISOString();
			await store.appendLog("activity", { n: 1, timestamp: old });
			await store.appendLog("activity", { n: 2, timestamp: new Date().toISOString() });

			await store.cleanup({ maxAgeMs: 1_000 });

			assert.equal(
				await store.getLogCount("activity"),
				1,
				"the entry older than the window must be gone",
			);
		});

		it("keeps an entry it cannot date rather than discarding it", async () => {
			const { store } = await newStore();
			await store.appendLog("activity", { n: 1 }); // no timestamp

			await store.cleanup({ maxAgeMs: 1 });

			assert.equal(await store.getLogCount("activity"), 1, "undatable, so kept");
		});
	});
});
