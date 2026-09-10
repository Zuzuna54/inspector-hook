/**
 * The delivery log (P10).
 *
 * The distinction this module exists to hold: **where context went TO**, which
 * is not the same as where it came FROM. `StagedContext.sourceSessionId`
 * records the session whose digest was staged — usually a DIFFERENT session
 * from the one that received it, because that is the entire point of staging.
 * Reading it as a delivery record answers the question backwards.
 *
 * So this is written by the hooks at delivery time, and the properties worth
 * guarding are the ones that make it trustworthy:
 *
 * 1. It records what was **delivered**, not what was armed — a pinned entry
 *    that fires eleven times appears eleven times.
 * 2. A malformed line is **counted**, never fatal and never silently dropped.
 *    Shell scripts write this file.
 * 3. The payload text is never recorded.
 */

import { strict as assert } from "node:assert";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { after, describe, it } from "node:test";

import {
	injectionCounts,
	injectionsPath,
	readInjections,
	recordInjection,
} from "../dist/index.js";
import { cleanup, makeTempStore } from "./helpers.js";

const dirs = [];
after(async () => {
	await Promise.all(dirs.map(cleanup));
});

async function store() {
	const basePath = await makeTempStore();
	dirs.push(basePath);
	return basePath;
}

/** Write a raw line, as a shell script would, without going through the API. */
async function appendRaw(basePath, line) {
	await mkdir(dirname(injectionsPath(basePath)), { recursive: true });
	await writeFile(injectionsPath(basePath), line, { flag: "a" });
}

const rec = (over = {}) => ({
	at: "2026-09-01T10:00:00Z",
	sessionId: "s1",
	tier: "now",
	bytes: 120,
	...over,
});

describe("recording a delivery", () => {
	it("appends one line per delivery", async () => {
		const basePath = await store();
		await recordInjection(basePath, rec());
		await recordInjection(basePath, rec({ at: "2026-09-01T11:00:00Z" }));
		const raw = await readFile(injectionsPath(basePath), "utf-8");
		assert.equal(raw.trim().split("\n").length, 2);
	});

	it("never records the payload text", async () => {
		// The text already lives in the tray, the bundle or the transcript.
		// Copying it here would both duplicate it and push a line past the size
		// at which an append stays atomic.
		const basePath = await store();
		await recordInjection(basePath, { ...rec(), text: "the secret body" });
		const raw = await readFile(injectionsPath(basePath), "utf-8");
		assert.ok(
			!raw.includes("the secret body"),
			"the payload was written to the log",
		);
	});

	it("caps the label rather than writing an essay into a line", async () => {
		const basePath = await store();
		await recordInjection(basePath, rec({ label: "x".repeat(500) }));
		const { records } = await readInjections(basePath);
		assert.equal(records[0].label.length, 120);
	});

	it("keeps every line short enough for an atomic append", async () => {
		// Two hooks can fire at once. Under PIPE_BUF an O_APPEND write is
		// atomic, so lines interleave whole rather than as fragments.
		const basePath = await store();
		await recordInjection(basePath, rec({ label: "y".repeat(500) }));
		const raw = await readFile(injectionsPath(basePath), "utf-8");
		assert.ok(raw.length < 4096, `a line reached ${raw.length} bytes`);
	});
});

describe("reading it back", () => {
	it("returns newest first", async () => {
		const basePath = await store();
		await recordInjection(
			basePath,
			rec({ at: "2026-09-01T10:00:00Z", bytes: 1 }),
		);
		await recordInjection(
			basePath,
			rec({ at: "2026-09-03T10:00:00Z", bytes: 3 }),
		);
		await recordInjection(
			basePath,
			rec({ at: "2026-09-02T10:00:00Z", bytes: 2 }),
		);
		const { records } = await readInjections(basePath);
		assert.deepEqual(
			records.map((r) => r.bytes),
			[3, 2, 1],
		);
	});

	it("applies the limit AFTER sorting, so it returns the most recent", async () => {
		// Limiting first returns the oldest N, which is the opposite of what
		// "the last few injections" means.
		const basePath = await store();
		for (const day of ["01", "02", "03"]) {
			await recordInjection(
				basePath,
				rec({ at: `2026-09-${day}T10:00:00Z`, bytes: Number(day) }),
			);
		}
		const { records } = await readInjections(basePath, { limit: 1 });
		assert.equal(records[0].bytes, 3);
	});

	it("scopes to one session", async () => {
		const basePath = await store();
		await recordInjection(basePath, rec({ sessionId: "mine" }));
		await recordInjection(basePath, rec({ sessionId: "theirs" }));
		const { records } = await readInjections(basePath, { sessionId: "mine" });
		assert.equal(records.length, 1);
		assert.equal(records[0].sessionId, "mine");
	});

	it("is empty, not an error, when nothing has been injected", async () => {
		const { records, unparseable } = await readInjections(await store());
		assert.deepEqual(records, []);
		assert.equal(unparseable, 0);
	});

	it("counts a malformed line rather than dropping or throwing on it", async () => {
		// Shell scripts write this file. A half-written line during a crash is a
		// real state, and it must not cost the panel every other record.
		const basePath = await store();
		await recordInjection(basePath, rec({ bytes: 7 }));
		await writeFile(
			injectionsPath(basePath),
			'not json at all\n{"partial":\n',
			{
				flag: "a",
			},
		);
		await recordInjection(basePath, rec({ bytes: 9 }));

		const { records, unparseable } = await readInjections(basePath);
		assert.equal(records.length, 2, "good records were lost");
		assert.equal(unparseable, 2, "bad lines were not counted");
	});

	it("counts a well-formed line that is not a delivery record", async () => {
		// Valid JSON with the wrong shape is the more dangerous case: it parses,
		// so only a shape check catches it.
		const basePath = await store();
		await appendRaw(basePath, '{"hello":"world"}\n');
		const { records, unparseable } = await readInjections(basePath);
		assert.equal(records.length, 0);
		assert.equal(unparseable, 1);
	});

	it("rejects a record with a tier nothing delivers", async () => {
		const basePath = await store();
		await appendRaw(
			basePath,
			'{"at":"2026-09-01T10:00:00Z","sessionId":"s","tier":"invented"}\n',
		);
		const { records, unparseable } = await readInjections(basePath);
		assert.equal(records.length, 0);
		assert.equal(unparseable, 1);
	});
});

describe("what the log makes visible", () => {
	it("shows a pinned payload being paid for on every prompt", async () => {
		// The whole reason the record is written at DELIVERY. Arming happened
		// once; this is the cost, and it is only visible here.
		const basePath = await store();
		await recordInjection(
			basePath,
			rec({ tier: "pinned", at: "2026-09-01T10:00:00Z", bytes: 400 }),
		);
		await recordInjection(
			basePath,
			rec({ tier: "pinned", at: "2026-09-01T10:05:00Z", bytes: 400 }),
		);
		await recordInjection(
			basePath,
			rec({ tier: "pinned", at: "2026-09-01T10:09:00Z", bytes: 400 }),
		);

		const counts = await injectionCounts(basePath);
		const held = counts.get("s1");
		assert.equal(
			held.count,
			3,
			"a repeating cost looked like a single injection",
		);
		assert.equal(held.bytes, 1200);
		assert.equal(held.last, "2026-09-01T10:09:00Z");
	});

	it("distinguishes the three tiers", async () => {
		const basePath = await store();
		for (const tier of ["next-session", "now", "pinned"]) {
			await recordInjection(
				basePath,
				rec({ tier, at: `2026-09-0${tier.length % 9}T10:00:00Z` }),
			);
		}
		const { records } = await readInjections(basePath);
		assert.deepEqual(
			new Set(records.map((r) => r.tier)),
			new Set(["next-session", "now", "pinned"]),
		);
	});

	it("summarises per session without rescanning per row", async () => {
		const basePath = await store();
		await recordInjection(basePath, rec({ sessionId: "a", bytes: 10 }));
		await recordInjection(basePath, rec({ sessionId: "b", bytes: 20 }));
		await recordInjection(
			basePath,
			rec({ sessionId: "a", bytes: 30, at: "2026-09-02T10:00:00Z" }),
		);

		const counts = await injectionCounts(basePath);
		assert.equal(counts.get("a").count, 2);
		assert.equal(counts.get("a").bytes, 40);
		assert.equal(counts.get("b").count, 1);
		assert.equal(counts.get("nobody"), undefined);
	});
});
