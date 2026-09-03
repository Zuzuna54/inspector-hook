/**
 * Store migration tests.
 *
 * These operate on hand-built stores shaped like the ones the fixed bugs
 * actually produced, so the migration is verified against realistic damage
 * rather than a synthetic ideal.
 */

import { strict as assert } from "node:assert";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { CURRENT_SCHEMA_VERSION, migrateStore } from "../dist/index.js";
import { cleanup, makeTempStore } from "./helpers.js";

const tempDirs = [];

async function newStore() {
	const basePath = await makeTempStore();
	tempDirs.push(basePath);
	await mkdir(join(basePath, "changes"), { recursive: true });
	await mkdir(join(basePath, "sessions"), { recursive: true });
	return basePath;
}

async function writeChange(basePath, id, fields) {
	await writeFile(
		join(basePath, "changes", `${id}.json`),
		JSON.stringify({ id, status: "pending", ...fields }, null, 2),
		"utf-8",
	);
}

async function writeSession(basePath, id, fields) {
	await writeFile(
		join(basePath, "sessions", `${id}.json`),
		JSON.stringify({ id, toolExecutions: [], fileChanges: [], ...fields }, null, 2),
		"utf-8",
	);
}

const countChanges = async (basePath) =>
	(await readdir(join(basePath, "changes"))).length;

after(async () => {
	await Promise.all(tempDirs.map(cleanup));
});

describe("migrateStore", () => {
	it("collapses duplicate file-change records, keeping the earliest", async () => {
		const basePath = await newStore();
		const shared = {
			sessionId: "s1",
			filePath: "/proj/a.ts",
			beforeContent: "old",
			afterContent: "new",
		};
		await writeChange(basePath, "first", {
			...shared,
			timestamp: "2026-01-01T00:00:00.000Z",
		});
		await writeChange(basePath, "second", {
			...shared,
			timestamp: "2026-01-01T00:00:00.500Z",
		});

		const result = await migrateStore(basePath);

		assert.equal(await countChanges(basePath), 1);
		assert.ok(result.applied.includes("v0->v1"));
		const [remaining] = await readdir(join(basePath, "changes"));
		assert.equal(remaining, "first.json", "the earliest record is kept");
	});

	it("keeps genuinely distinct changes to the same file", async () => {
		const basePath = await newStore();
		await writeChange(basePath, "one", {
			sessionId: "s1",
			filePath: "/proj/a.ts",
			beforeContent: "v1",
			afterContent: "v2",
			timestamp: "2026-01-01T00:00:00.000Z",
		});
		await writeChange(basePath, "two", {
			sessionId: "s1",
			filePath: "/proj/a.ts",
			beforeContent: "v2",
			afterContent: "v3",
			timestamp: "2026-01-01T00:01:00.000Z",
		});

		await migrateStore(basePath);
		assert.equal(await countChanges(basePath), 2, "sequential edits survive");
	});

	it("repairs a session whose endTime precedes its last activity", async () => {
		const basePath = await newStore();
		await writeSession(basePath, "s1", {
			status: "completed",
			startTime: "2026-01-01T00:00:00.000Z",
			endTime: "2026-01-01T00:05:00.000Z",
			lastActivityTime: "2026-01-01T00:10:00.000Z",
		});

		await migrateStore(basePath);

		const session = JSON.parse(
			await readFile(join(basePath, "sessions", "s1.json"), "utf-8"),
		);
		assert.equal(session.endTime, undefined, "contradictory endTime cleared");
		assert.equal(session.status, "idle");
	});

	it("leaves a legitimately ended session alone", async () => {
		const basePath = await newStore();
		await writeSession(basePath, "s1", {
			status: "completed",
			startTime: "2026-01-01T00:00:00.000Z",
			lastActivityTime: "2026-01-01T00:05:00.000Z",
			endTime: "2026-01-01T00:10:00.000Z",
		});

		await migrateStore(basePath);

		const session = JSON.parse(
			await readFile(join(basePath, "sessions", "s1.json"), "utf-8"),
		);
		assert.equal(session.status, "completed");
		assert.equal(session.endTime, "2026-01-01T00:10:00.000Z");
	});

	it("records the schema version and is idempotent", async () => {
		const basePath = await newStore();
		await writeChange(basePath, "a", {
			sessionId: "s1",
			filePath: "/proj/a.ts",
			beforeContent: "x",
			afterContent: "y",
			timestamp: "2026-01-01T00:00:00.000Z",
		});

		const first = await migrateStore(basePath);
		assert.equal(first.toVersion, CURRENT_SCHEMA_VERSION);

		const second = await migrateStore(basePath);
		assert.equal(second.applied.length, 0, "second run does nothing");
		assert.equal(second.fromVersion, CURRENT_SCHEMA_VERSION);
		assert.equal(await countChanges(basePath), 1);
	});

	it("survives a store containing malformed JSON", async () => {
		const basePath = await newStore();
		await writeFile(join(basePath, "changes", "broken.json"), "{not json", "utf-8");
		await writeChange(basePath, "ok", {
			sessionId: "s1",
			filePath: "/proj/a.ts",
			beforeContent: "x",
			afterContent: "y",
			timestamp: "2026-01-01T00:00:00.000Z",
		});

		const result = await migrateStore(basePath);
		assert.equal(result.toVersion, CURRENT_SCHEMA_VERSION);
		// The unreadable file is left untouched rather than deleted.
		assert.equal(await countChanges(basePath), 2);
	});

	it("handles an empty store", async () => {
		const basePath = await newStore();
		const result = await migrateStore(basePath);
		assert.equal(result.toVersion, CURRENT_SCHEMA_VERSION);
	});
});
