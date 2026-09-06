/**
 * Armed context: the two tiers that reach a running session.
 *
 * `pinned` deliberately breaks the one-shot guarantee that staged-context.ts
 * calls "the failure mode hardest to notice and worst to inherit" — a pick that
 * silently repeats into every turn from now on. The mitigations are what these
 * tests are mostly about, and the plan is explicit that if only one survives it
 * should be the expiry:
 *
 *   - expiry is MANDATORY, not defaulted: 24h if unspecified, 7 days hard max
 *   - keyed to one session, so a pin dies with the session rather than
 *     following the user into unrelated work
 *   - the repeat cost is reported, because pinned bytes are paid every prompt
 *
 * Plus the containment that comes with keying files by an id from outside: a
 * session id builds a path, and untrusted input in a path is the exact shape of
 * the traversal already fixed in the persistence store.
 */

import { strict as assert } from "node:assert";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
	armContext,
	disarmContext,
	estimatedRepeatBytes,
	isSafeSessionId,
	listArmed,
	readAllArmed,
	readArmed,
	resolveTtl,
	DEFAULT_NOW_TTL_MS,
	DEFAULT_PIN_TTL_MS,
	MAX_PIN_TTL_MS,
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

const arm = (basePath, over = {}) =>
	armContext(basePath, {
		tier: "now",
		targetSessionId: "sess-1",
		text: "some context",
		bytes: 12,
		...over,
	});

describe("arming", () => {
	it("writes a payload the hook can read", async () => {
		const basePath = await store();
		const result = await arm(basePath);
		assert.equal(result.armed, true);
		assert.match(result.path, /context\/now\/sess-1\.json$/);
		const back = await readArmed(basePath, "now", "sess-1");
		assert.equal(back.text, "some context");
	});

	it("refuses empty text rather than arming a blank injection", async () => {
		const result = await arm(await store(), { text: "   " });
		assert.equal(result.armed, false);
		assert.match(result.reason, /empty/i);
	});

	it("keeps the two tiers in separate files for one session", async () => {
		const basePath = await store();
		await arm(basePath, { tier: "now", text: "one-shot" });
		await arm(basePath, { tier: "pinned", text: "repeating" });
		const both = await readAllArmed(basePath, "sess-1");
		assert.equal(both.now.text, "one-shot");
		assert.equal(both.pinned.text, "repeating");
	});

	it("keys by session, so one session's context never reaches another", async () => {
		// The property the whole tier design rests on. A hook registered for a
		// project fires for EVERY session in it — measured, not assumed — so
		// targeting has to happen in the payload, not in the registration.
		const basePath = await store();
		await arm(basePath, { targetSessionId: "sess-1", text: "for one" });
		assert.equal(await readArmed(basePath, "now", "sess-2"), null);
	});
});

describe("expiry is mandatory on a pin", () => {
	it("defaults to 24 hours when none is asked for", () => {
		assert.equal(resolveTtl("pinned"), DEFAULT_PIN_TTL_MS);
		assert.equal(resolveTtl("pinned", 0), DEFAULT_PIN_TTL_MS);
		assert.equal(resolveTtl("pinned", -1), DEFAULT_PIN_TTL_MS);
	});

	it("caps at seven days however long is requested", () => {
		// A pin outliving a week is not a decision anyone made deliberately.
		assert.equal(resolveTtl("pinned", 365 * 24 * 60 * 60 * 1000), MAX_PIN_TTL_MS);
	});

	it("gives a one-shot its own shorter default", () => {
		assert.equal(resolveTtl("now"), DEFAULT_NOW_TTL_MS);
	});

	it("treats an expired entry as absent", async () => {
		const basePath = await store();
		await arm(basePath, { tier: "pinned", ttlMs: 1000 });
		const later = Date.now() + 5000;
		assert.equal(await readArmed(basePath, "pinned", "sess-1", later), null);
	});

	it("treats a payload with NO expiry as expired, not as forever", async () => {
		// An unbounded injection is the outcome this module is fenced against,
		// so a missing field fails closed.
		const basePath = await store();
		const { writeFile, mkdir } = await import("node:fs/promises");
		await mkdir(join(basePath, "context", "pinned"), { recursive: true });
		await writeFile(
			join(basePath, "context", "pinned", "sess-1.json"),
			JSON.stringify({ text: "forever?" }),
			"utf-8",
		);
		assert.equal(await readArmed(basePath, "pinned", "sess-1"), null);
	});

	it("treats an unparseable expiry as expired", async () => {
		const basePath = await store();
		const { writeFile, mkdir } = await import("node:fs/promises");
		await mkdir(join(basePath, "context", "pinned"), { recursive: true });
		await writeFile(
			join(basePath, "context", "pinned", "sess-1.json"),
			JSON.stringify({ text: "x", expiresAt: "not a date" }),
			"utf-8",
		);
		assert.equal(await readArmed(basePath, "pinned", "sess-1"), null);
	});
});

describe("session ids build paths, so they are validated", () => {
	it("accepts a real session id", () => {
		assert.equal(isSafeSessionId("1f7c9a2e-0000-4000-8000-abcdefabcdef"), true);
	});

	it("rejects anything that could leave the directory", () => {
		for (const bad of ["../../etc/passwd", "a/b", "a\\b", "", "  ", null, 42]) {
			assert.equal(isSafeSessionId(bad), false, `${bad} was accepted`);
		}
	});

	it("refuses to arm with a traversing id, and writes nothing", async () => {
		const basePath = await store();
		const result = await arm(basePath, { targetSessionId: "../../../tmp/ESCAPED" });
		assert.equal(result.armed, false);
		assert.match(result.reason, /session id/i);

		// And nothing landed anywhere: the refusal is before any write.
		const entries = await readdir(basePath);
		assert.ok(!entries.includes("context"), "a refused arm still created the tree");
	});
});

describe("what a pin costs", () => {
	it("reports zero for a one-shot", async () => {
		const basePath = await store();
		const { entry } = await arm(basePath, { tier: "now" });
		assert.equal(estimatedRepeatBytes(entry), 0);
	});

	it("multiplies bytes by deliveries for a pin", async () => {
		// Pinned bytes are paid on EVERY prompt. Showing only the payload size
		// would describe a repeating cost as a one-off.
		const basePath = await store();
		const { entry } = await arm(basePath, { tier: "pinned", bytes: 500 });
		assert.equal(estimatedRepeatBytes({ ...entry, deliveries: 8 }), 4000);
	});

	it("counts an undelivered pin as one payload rather than zero", async () => {
		const basePath = await store();
		const { entry } = await arm(basePath, { tier: "pinned", bytes: 500 });
		assert.equal(estimatedRepeatBytes(entry), 500);
	});
});

describe("disarming and listing", () => {
	it("removes one tier and leaves the other", async () => {
		const basePath = await store();
		await arm(basePath, { tier: "now" });
		await arm(basePath, { tier: "pinned" });
		assert.equal(await disarmContext(basePath, "pinned", "sess-1"), true);
		const both = await readAllArmed(basePath, "sess-1");
		assert.ok(both.now, "the one-shot was removed too");
		assert.equal(both.pinned, null);
	});

	it("is safe to disarm when there is nothing armed", async () => {
		assert.equal(await disarmContext(await store(), "now", "sess-1"), false);
	});

	it("lists every live entry across tiers and sessions", async () => {
		const basePath = await store();
		await arm(basePath, { tier: "now", targetSessionId: "sess-1" });
		await arm(basePath, { tier: "pinned", targetSessionId: "sess-2" });
		const all = await listArmed(basePath);
		assert.equal(all.length, 2);
		assert.deepEqual(all.map((a) => a.targetSessionId).sort(), ["sess-1", "sess-2"]);
	});

	it("omits expired entries from the listing", async () => {
		const basePath = await store();
		await arm(basePath, { tier: "pinned", ttlMs: 1000 });
		assert.deepEqual(await listArmed(basePath, Date.now() + 5000), []);
	});
});
