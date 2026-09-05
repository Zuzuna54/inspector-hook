/**
 * Incremental activity merge.
 *
 * The poll now asks for only what changed since the last response. That makes
 * the merge load-bearing: replacing instead of merging would drop the whole
 * feed on the first delta, and merging wrongly would leave a completed tool
 * call rendered as still running forever. Neither failure is loud.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { apiSource } from "./api-sources.js";
import { readMedia } from "./harness.js";

// mergeActivity now has its own module, so the whole file is the function --
// no slicing it back out of api.js, which was fragile in exactly the way the
// extraction fixed: the shim keyed on "\nconst API =" as an end marker, so
// editing that line would have silently changed what this test evaluated.
const mergeActivity = (() => {
	globalThis.window = globalThis.window || {};
	// biome-ignore lint/security/noGlobalEval: classic script, see harness.js
	eval(readMedia("scripts/shared/activity-merge.js"));
	return globalThis.window.mergeActivity;
})();

const item = (id, timestamp, extra = {}) => ({ id, timestamp, ...extra });

describe("activity merge", () => {
	it("returns what it had when nothing changed", () => {
		const existing = [item("a", "1"), item("b", "2")];
		assert.equal(mergeActivity(existing, []), existing);
	});

	it("appends genuinely new items", () => {
		const merged = mergeActivity([item("a", "1")], [item("b", "2")]);
		assert.deepEqual(merged.map((i) => i.id), ["a", "b"]);
	});

	it("updates an item already held rather than duplicating it", () => {
		// The server re-sends an item whenever it changes; a tool call going from
		// running to completed arrives under the same id.
		const merged = mergeActivity(
			[item("a", "1", { data: { status: "running" } })],
			[item("a", "1", { data: { status: "completed" } })],
		);
		assert.equal(merged.length, 1, "the item was duplicated");
		assert.equal(merged[0].data.status, "completed", "the update did not win");
	});

	it("keeps everything older than the delta", () => {
		// The failure this prevents: replacing on the first incremental response
		// would leave the feed showing only the last two seconds.
		const existing = Array.from({ length: 50 }, (_, i) =>
			item(`old-${i}`, `2026-09-03T10:00:${String(i).padStart(2, "0")}.000Z`),
		);
		const merged = mergeActivity(existing, [item("new", "2026-09-03T11:00:00.000Z")]);
		assert.equal(merged.length, 51);
	});

	it("orders by timestamp regardless of arrival order", () => {
		const merged = mergeActivity(
			[item("late", "2026-09-03T12:00:00.000Z")],
			[item("early", "2026-09-03T09:00:00.000Z")],
		);
		assert.deepEqual(merged.map((i) => i.id), ["early", "late"]);
	});

	it("keeps the newer version when a stale copy arrives late", () => {
		// updatedAt, not arrival order. A tool call keeps its start time as its
		// timestamp while status and duration arrive later, so a slow or
		// reordered response must not turn a completed call back into a running
		// one.
		const merged = mergeActivity(
			[item("a", "1", { updatedAt: "5", data: { status: "completed" } })],
			[item("a", "1", { updatedAt: "3", data: { status: "running" } })],
		);
		assert.equal(merged[0].data.status, "completed", "a stale copy overwrote a newer one");
	});

	it("applies an update that is genuinely newer", () => {
		const merged = mergeActivity(
			[item("a", "1", { updatedAt: "3", data: { status: "running" } })],
			[item("a", "1", { updatedAt: "5", data: { status: "completed" } })],
		);
		assert.equal(merged[0].data.status, "completed");
	});

	it("falls back to timestamp when updatedAt is absent", () => {
		// Items recorded before updatedAt existed have only a timestamp.
		const merged = mergeActivity(
			[item("a", "1", { data: { status: "running" } })],
			[item("a", "1", { data: { status: "completed" } })],
		);
		assert.equal(merged[0].data.status, "completed");
	});

	it("orders by timestamp, not by updatedAt", () => {
		// A tool call that completes late must stay where it started in the feed
		// rather than jumping to the end.
		const merged = mergeActivity(
			[item("tool", "2026-09-03T10:00:00Z", { updatedAt: "2026-09-03T12:00:00Z" })],
			[item("later", "2026-09-03T11:00:00Z", { updatedAt: "2026-09-03T11:00:00Z" })],
		);
		assert.deepEqual(merged.map((i) => i.id), ["tool", "later"]);
	});

	it("tolerates an item with no timestamp instead of throwing", () => {
		assert.doesNotThrow(() => mergeActivity([item("a", "1")], [{ id: "b" }]));
	});

	it("survives an empty starting feed", () => {
		assert.deepEqual(mergeActivity([], [item("a", "1")]).map((i) => i.id), ["a"]);
		assert.deepEqual(mergeActivity(undefined, [item("a", "1")]).map((i) => i.id), ["a"]);
	});
});

describe("activity polling contract", () => {
	const api = apiSource();
	const sessions = readMedia("scripts/views/sessions.js");
	const list = readMedia("scripts/views/sessions/session-list.js");

	it("forwards the cursor when there is one", () => {
		assert.match(api, /options\.since \? \{ since: options\.since \}/);
	});

	it("merges only on a delta response, and replaces on a full one", () => {
		// A full-window response must replace: it is authoritative, and merging
		// would keep items the server no longer reports.
		assert.match(api, /const isDelta =/);
		assert.match(api, /isDelta[\s\S]{0,80}mergeActivity/);
	});

	it("polls with the stored cursor", () => {
		assert.match(sessions, /since: State\.sessionView\.activitySince/);
	});

	it("clears the cursor when the selected session changes", () => {
		// Carrying a cursor across sessions would make the new session's first
		// fetch return almost nothing.
		assert.match(list, /activitySince: null/);
	});
});
