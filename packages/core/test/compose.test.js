/**
 * Composing a tray item from selected transcript turns.
 *
 * The thing a digest structurally cannot do. A digest is derived from hook
 * events — counts of tools, lists of files — so it can say a session touched
 * fifteen files and nothing about what was decided. This carries what was
 * actually said.
 *
 * The property worth guarding is where the text comes from: the selection is
 * resolved against a FRESH READ of the transcript, not against whatever the
 * panel happened to be holding. Composing client-side would be shorter and
 * would mean the text reaching a future session came from a stale copy — and a
 * stale copy that looks current is this codebase's most-repeated failure.
 */

import { strict as assert } from "node:assert";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { MAX_ENTRY_BYTES, composeFromTranscript, composeTitle } from "../dist/index.js";
import { cleanup, makeTempStore } from "./helpers.js";

const dirs = [];
after(async () => {
	await Promise.all(dirs.map(cleanup));
});

async function transcript(lines) {
	const dir = await makeTempStore();
	dirs.push(dir);
	const path = join(dir, "session.jsonl");
	await writeFile(path, lines.map((l) => JSON.stringify(l)).join("\n"), "utf-8");
	return path;
}

/** A short conversation: prompt, thinking, tool call, result, reply. */
const CONVERSATION = [
	{ type: "user", uuid: "u1", message: { content: "make the parser handle CRLF" } },
	{
		type: "assistant",
		uuid: "a1",
		message: {
			model: "claude-opus-5",
			content: [
				{ type: "thinking", thinking: "the tokenizer splits on \\n only" },
				{ type: "tool_use", id: "t1", name: "Edit", input: { file: "tokenizer.ts" } },
			],
		},
	},
	{
		type: "user",
		uuid: "u2",
		message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "applied" }] },
	},
	{
		type: "assistant",
		uuid: "a2",
		message: { model: "claude-opus-5", content: [{ type: "text", text: "Handled CRLF." }] },
	},
];

describe("composing from a transcript", () => {
	it("carries the actual words, labelled by who said them", async () => {
		const path = await transcript(CONVERSATION);
		const out = await composeFromTranscript(path, [0, 4]);
		assert.equal(out.matched, 2);
		assert.match(out.text, /\*\*User\*\*/);
		assert.match(out.text, /make the parser handle CRLF/);
		assert.match(out.text, /\*\*Claude\*\*/);
		assert.match(out.text, /Handled CRLF\./);
	});

	it("names the tool on a tool call", async () => {
		const path = await transcript(CONVERSATION);
		const out = await composeFromTranscript(path, [2]);
		assert.match(out.text, /\*\*Tool call: Edit\*\*/);
		assert.match(out.text, /tokenizer\.ts/);
	});

	it("orders by transcript position, not by selection order", async () => {
		// The point of carrying turns across is that they read as a conversation.
		const path = await transcript(CONVERSATION);
		const out = await composeFromTranscript(path, [4, 0]);
		assert.ok(
			out.text.indexOf("make the parser") < out.text.indexOf("Handled CRLF"),
			"the selection came back scrambled",
		);
	});

	it("de-duplicates a repeated index", async () => {
		const path = await transcript(CONVERSATION);
		const out = await composeFromTranscript(path, [0, 0, 0]);
		assert.equal(out.matched, 1);
	});

	it("reports indexes that no longer resolve, rather than quietly shrinking", async () => {
		// A transcript can be compacted or replaced between the panel rendering
		// it and someone clicking Add. Silently producing a shorter item would
		// look exactly like a successful selection.
		const path = await transcript(CONVERSATION);
		const out = await composeFromTranscript(path, [0, 999]);
		assert.equal(out.matched, 1);
		assert.equal(out.requested, 2);
		assert.deepEqual(out.missing, [999]);
	});

	it("refuses, with a reason, when nothing resolves", async () => {
		const path = await transcript(CONVERSATION);
		const out = await composeFromTranscript(path, [900, 901]);
		assert.equal(out.text, "");
		assert.match(out.reason, /in the transcript any more/i);
	});

	it("refuses an empty selection", async () => {
		const path = await transcript(CONVERSATION);
		const out = await composeFromTranscript(path, []);
		assert.match(out.reason, /Nothing selected/);
	});

	it("ignores nonsense indexes rather than throwing", async () => {
		const path = await transcript(CONVERSATION);
		const out = await composeFromTranscript(path, [-1, 1.5, Number.NaN, 0]);
		assert.equal(out.matched, 1);
	});

	it("clips an oversized entry and says so", async () => {
		// One tool result can run to hundreds of kilobytes and would consume the
		// whole tray budget alone.
		const path = await transcript([
			{
				type: "user",
				message: {
					content: [
						{ type: "tool_result", tool_use_id: "t", content: "z".repeat(MAX_ENTRY_BYTES + 5000) },
					],
				},
			},
		]);
		const out = await composeFromTranscript(path, [0]);
		assert.ok(Buffer.byteLength(out.text) < MAX_ENTRY_BYTES + 500);
		assert.match(out.text, /_\(truncated\)_/);
	});

	it("marks an empty entry rather than rendering a bare heading", async () => {
		const path = await transcript([
			{ type: "assistant", message: { content: [{ type: "text", text: "" }] } },
		]);
		const out = await composeFromTranscript(path, [0]);
		assert.match(out.text, /_\(empty\)_/);
	});
});

describe("titling a composed selection", () => {
	it("uses the first prompt, which is what a person recognises it by", () => {
		const title = composeTitle([
			{ kind: "thinking", text: "internal" },
			{ kind: "prompt", text: "make the parser handle CRLF" },
		]);
		assert.equal(title, "make the parser handle CRLF");
	});

	it("truncates a long prompt rather than making one up", () => {
		const title = composeTitle([{ kind: "prompt", text: "x".repeat(200) }]);
		assert.ok(title.length <= 60);
		assert.match(title, /…$/);
	});

	it("falls back to a count, never to an invented summary", () => {
		// A made-up title is a small false claim, and this corpus has enough.
		const title = composeTitle([
			{ kind: "reply", text: "a" },
			{ kind: "reply", text: "b" },
		]);
		assert.equal(title, "2 turns from a session");
	});
});
