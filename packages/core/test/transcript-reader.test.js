/**
 * The transcript reader.
 *
 * The transcript is the session's actual content — prompts, replies, thinking,
 * tool inputs and results. The core had never opened one: it captures hook
 * EVENTS, which are metadata, which is why a digest reads as a fact list rather
 * than as a record of the work.
 *
 * Two properties matter more than the parsing, and both are here because real
 * files forced them:
 *
 *  1. It must not drop what it does not understand. Claude Code's format is
 *     documented as internal and changeable, and a real transcript here carries
 *     fourteen line types of which nine are undocumented. An unmodelled type
 *     becomes a counted `unknown` rather than a silently shorter transcript.
 *  2. It must stream. The largest transcript on this machine is 48 MB with a
 *     326 KB line in it; `readFile` on panel open would stall the core.
 *
 * Fixtures are written to look like the real thing, including the two shapes
 * that share the `user` type — a string is a prompt, a list is tool results.
 * Measured 19 prompts against 163 tool results in one session, so conflating
 * them would bury what the user actually said.
 */

import { strict as assert } from "node:assert";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
	MAX_LINE_BYTES,
	readTranscript,
	transcriptStats,
} from "../dist/index.js";
import { cleanup, makeTempStore } from "./helpers.js";

const dirs = [];
after(async () => {
	await Promise.all(dirs.map(cleanup));
});

/** Write a transcript from a list of objects and return its path. */
async function transcript(lines) {
	const dir = await makeTempStore();
	dirs.push(dir);
	const path = join(dir, "session.jsonl");
	await writeFile(path, lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n"), "utf-8");
	return path;
}

const assistant = (blocks, usage, over = {}) => ({
	type: "assistant",
	uuid: "a1",
	timestamp: "2026-09-06T10:00:00.000Z",
	message: { model: "claude-opus-5", content: blocks, ...(usage ? { usage } : {}) },
	...over,
});

describe("reading a transcript", () => {
	it("tells a prompt from a tool result, though both are `user`", async () => {
		const path = await transcript([
			{ type: "user", uuid: "u1", message: { content: "fix the parser" } },
			{
				type: "user",
				uuid: "u2",
				message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
			},
		]);
		const { entries } = await readTranscript(path);
		assert.deepEqual(entries.map((e) => e.kind), ["prompt", "tool_result"]);
		assert.equal(entries[0].text, "fix the parser");
		assert.equal(entries[1].toolUseId, "t1");
	});

	it("splits an assistant turn into its blocks", async () => {
		const path = await transcript([
			assistant([
				{ type: "thinking", thinking: "considering" },
				{ type: "text", text: "Here is the fix." },
				{ type: "tool_use", id: "t9", name: "Edit", input: { file: "a.ts" } },
			]),
		]);
		const { entries } = await readTranscript(path);
		assert.deepEqual(entries.map((e) => e.kind), ["thinking", "reply", "tool_use"]);
		assert.equal(entries[2].toolName, "Edit");
		assert.match(entries[2].text, /a\.ts/);
		assert.equal(entries[1].model, "claude-opus-5");
	});

	it("skips bookkeeping lines without counting them as content", async () => {
		const path = await transcript([
			{ type: "ai-title", title: "x" },
			{ type: "atis-latch" },
			{ type: "user", message: { content: "hello" } },
		]);
		const { entries, stats } = await readTranscript(path);
		assert.equal(entries.length, 1);
		assert.equal(stats.lines, 3, "every line is still counted");
		assert.equal(stats.unrecognised, 0, "bookkeeping is known, not unknown");
	});

	it("COUNTS a type it does not model rather than dropping it", async () => {
		// The property that makes a format change visible. A silently shorter
		// transcript is the failure this whole codebase keeps finding.
		const path = await transcript([
			{ type: "something-new-in-a-future-release", uuid: "x1" },
			{ type: "user", message: { content: "hi" } },
		]);
		const { stats } = await readTranscript(path);
		assert.equal(stats.unrecognised, 1);
		assert.equal(stats.seenTypes["something-new-in-a-future-release"], 1);
	});

	it("can return the unknown entries when asked", async () => {
		const path = await transcript([{ type: "brand-new", uuid: "x1" }]);
		const { entries } = await readTranscript(path, { includeAll: true });
		assert.equal(entries.length, 1);
		assert.equal(entries[0].kind, "unknown");
		assert.equal(entries[0].rawType, "brand-new");
	});

	it("clips an oversized line and reports it", async () => {
		// Real files have 326 KB lines. Clipping breaks the JSON, which is why
		// the clip and the parse failure are counted separately and both
		// returned: one explains the other.
		const huge = JSON.stringify({
			type: "assistant",
			message: { content: [{ type: "text", text: "x".repeat(MAX_LINE_BYTES + 1000) }] },
		});
		const path = await transcript([huge, { type: "user", message: { content: "after" } }]);
		const { stats, entries } = await readTranscript(path);
		assert.equal(stats.clipped, 1);
		assert.equal(stats.unparseable, 1);
		assert.equal(entries.length, 1, "the line after a clipped one must still be read");
		assert.equal(entries[0].text, "after");
	});

	it("survives a line that is not JSON at all", async () => {
		const path = await transcript(["not json", { type: "user", message: { content: "ok" } }]);
		const { stats, entries } = await readTranscript(path);
		assert.equal(stats.unparseable, 1);
		assert.equal(entries.length, 1);
	});

	it("returns an empty result for a file that is not there", async () => {
		const { entries, stats } = await readTranscript("/nope/missing.jsonl");
		assert.deepEqual(entries, []);
		assert.equal(stats.bytes, 0);
	});
});

describe("token accounting", () => {
	it("reports the peak context, not just the last turn", async () => {
		// "How full is this session" is the peak, because that is where a
		// compaction boundary or a limit would have been hit.
		const path = await transcript([
			assistant([{ type: "text", text: "a" }], {
				input_tokens: 10,
				cache_read_input_tokens: 500_000,
				cache_creation_input_tokens: 2_000,
				output_tokens: 100,
			}),
			assistant([{ type: "text", text: "b" }], {
				input_tokens: 5,
				cache_read_input_tokens: 100,
				cache_creation_input_tokens: 0,
				output_tokens: 50,
			}),
		]);
		const { usage } = await transcriptStats(path);
		assert.equal(usage.peakContextTokens, 502_010);
		assert.equal(usage.lastContextTokens, 105, "the last turn is reported separately");
		assert.equal(usage.totalOutputTokens, 150);
		assert.equal(usage.turns, 2);
		assert.deepEqual(usage.models, ["claude-opus-5"]);
	});

	it("counts cache reads, which are most of a large context", async () => {
		// Measured on a real session: 520,013 of 522,107 tokens were cache_read.
		// Counting only input_tokens would have reported 2.
		const path = await transcript([
			assistant([{ type: "text", text: "a" }], {
				input_tokens: 2,
				cache_read_input_tokens: 520_013,
				cache_creation_input_tokens: 2_092,
				output_tokens: 10,
			}),
		]);
		const { usage } = await transcriptStats(path);
		assert.equal(usage.peakContextTokens, 522_107);
	});

	it("ignores an assistant turn with no usage rather than counting a zero", async () => {
		const path = await transcript([assistant([{ type: "text", text: "a" }], null)]);
		const { usage } = await transcriptStats(path);
		assert.equal(usage.turns, 0);
		assert.equal(usage.peakContextTokens, 0);
	});
});

describe("paging", () => {
	const many = () =>
		Array.from({ length: 25 }, (_, i) => ({
			type: "user",
			uuid: `u${i}`,
			message: { content: `prompt ${i}` },
		}));

	it("returns a window and says whether there is more", async () => {
		const path = await transcript(many());
		const first = await readTranscript(path, { limit: 10 });
		assert.equal(first.entries.length, 10);
		assert.equal(first.total, 25, "total covers the FILE, not the page");
		assert.equal(first.hasMore, true);
		assert.equal(first.entries[0].text, "prompt 0");
	});

	it("offsets into the file", async () => {
		const path = await transcript(many());
		const page = await readTranscript(path, { offset: 20, limit: 10 });
		assert.equal(page.entries[0].text, "prompt 20");
		assert.equal(page.entries.length, 5);
		assert.equal(page.hasMore, false);
	});

	it("stats alone reads the whole file and returns no content", async () => {
		const path = await transcript(many());
		const stats = await transcriptStats(path);
		assert.equal(stats.byKind.prompt, 25);
	});
});
