/**
 * Two transports, one record (M2.20).
 *
 * Making HTTP the default transport means the shell hook stays registered as
 * the fallback, so for a while both are registered and Claude Code delivers
 * every firing TWICE. Without idempotent ingest that double-counts the whole
 * store — which is B1 (one edit producing two FileChanges) returning by a
 * different route, and B1 is the bug this project was rebuilt around.
 *
 * The rule the tests below defend is asymmetric on purpose: a duplicate that
 * slips through is visible and annoying, while an event wrongly dropped is
 * invisible and permanent. So dedupe only ever fires on a key strong enough to
 * be certain, and anything thinner is stored.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
	DUPLICATE_WINDOW_MS,
	LogManager,
	normaliseHookPayload,
} from "../dist/index.js";

/** A LogManager with persistence disabled — these tests are about memory. */
function manager() {
	return new LogManager({ maxLogsInMemory: 500 });
}

/** The native payload a PreToolUse hook delivers. */
const PRE_TOOL_USE = {
	hook_event_name: "PreToolUse",
	session_id: "s-1",
	prompt_id: "p-1",
	tool_use_id: "toolu_abc123",
	tool_name: "Bash",
	tool_input: { command: "ls" },
	cwd: "/tmp/x",
};

describe("one firing delivered twice", () => {
	it("REGRESSION: the same tool call does not become two log entries", async () => {
		const log = manager();
		// Exactly what happens with both transports registered: the same native
		// payload, normalised twice, milliseconds apart.
		const first = await log.addLog(normaliseHookPayload(PRE_TOOL_USE));
		const second = await log.addLog(normaliseHookPayload(PRE_TOOL_USE));

		assert.equal(
			(await log.getLogs()).total,
			1,
			"one firing must be one record",
		);
		assert.equal(second.id, first.id, "the caller gets the record that exists");
		assert.equal(log.getDuplicatesDropped(), 1);
	});

	it("keeps PreToolUse and PostToolUse apart despite one tool_use_id", async () => {
		const log = manager();
		await log.addLog(normaliseHookPayload(PRE_TOOL_USE));
		await log.addLog(
			normaliseHookPayload({
				...PRE_TOOL_USE,
				hook_event_name: "PostToolUse",
				tool_response: "a\nb\n",
				duration_ms: 12,
			}),
		);
		// The pair shares a tool_use_id by design — that is how they correlate.
		assert.equal((await log.getLogs()).total, 2);
		assert.equal(log.getDuplicatesDropped(), 0);
	});

	it("keeps parallel calls to the SAME tool apart", async () => {
		// Three parallel Bash calls in one turn share hook, session and prompt
		// and differ only by tool_use_id. Collapsing them is the exact failure
		// B2 was about, arriving from the other direction.
		const log = manager();
		for (const id of ["toolu_1", "toolu_2", "toolu_3"]) {
			await log.addLog(
				normaliseHookPayload({ ...PRE_TOOL_USE, tool_use_id: id }),
			);
		}
		assert.equal((await log.getLogs()).total, 3);
		assert.equal(log.getDuplicatesDropped(), 0);
	});

	it("dedupes an event with no tool_use_id but a prompt id", async () => {
		const stop = {
			hook_event_name: "Stop",
			session_id: "s-1",
			prompt_id: "p-1",
			last_assistant_message: "done",
		};
		const log = manager();
		await log.addLog(normaliseHookPayload(stop));
		await log.addLog(normaliseHookPayload(stop));
		assert.equal((await log.getLogs()).total, 1);
	});

	it("keeps two different turns apart", async () => {
		const log = manager();
		await log.addLog(
			normaliseHookPayload({
				hook_event_name: "Stop",
				session_id: "s-1",
				prompt_id: "p-1",
				last_assistant_message: "first",
			}),
		);
		await log.addLog(
			normaliseHookPayload({
				hook_event_name: "Stop",
				session_id: "s-1",
				prompt_id: "p-2",
				last_assistant_message: "second",
			}),
		);
		assert.equal((await log.getLogs()).total, 2);
	});

	it("keeps the same event in two sessions apart", async () => {
		const log = manager();
		await log.addLog(normaliseHookPayload(PRE_TOOL_USE));
		await log.addLog(
			normaliseHookPayload({
				...PRE_TOOL_USE,
				session_id: "s-2",
				tool_use_id: "toolu_other",
			}),
		);
		assert.equal((await log.getLogs()).total, 2);
	});

	it("NEVER drops an event too thin to key confidently", async () => {
		// The asymmetry that matters. A duplicate is visible; a dropped event is
		// invisible and gone. Two events with no session, no prompt and no tool
		// id are indistinguishable from each other, so both are stored.
		const log = manager();
		const thin = { hook: "ConfigChange", event: "ConfigChange", message: "x" };
		await log.addLog({ ...thin });
		await log.addLog({ ...thin });
		assert.equal((await log.getLogs()).total, 2, "when unsure, store it");
		assert.equal(log.getDuplicatesDropped(), 0);
	});

	it("stops deduping once the window has passed", async () => {
		const log = manager();
		await log.addLog(normaliseHookPayload(PRE_TOOL_USE));
		// Reach into the window rather than waiting 10s: the behaviour under
		// test is that the key EXPIRES, not how long that takes.
		for (const key of log.recentDeliveries.keys()) {
			log.recentDeliveries.set(key, Date.now() - DUPLICATE_WINDOW_MS - 1);
		}
		await log.addLog(normaliseHookPayload(PRE_TOOL_USE));
		assert.equal(
			(await log.getLogs()).total,
			2,
			"a later firing is a real event",
		);
	});

	it("bounds what it remembers", async () => {
		const log = manager();
		for (let i = 0; i < 6000; i++) {
			await log.addLog(
				normaliseHookPayload({ ...PRE_TOOL_USE, tool_use_id: `toolu_${i}` }),
			);
		}
		assert.ok(
			log.recentDeliveries.size <= 5000,
			`dedupe kept ${log.recentDeliveries.size} keys`,
		);
	});

	it("counts what it dropped, so dedupe is never silent", async () => {
		const log = manager();
		await log.addLog(normaliseHookPayload(PRE_TOOL_USE));
		await log.addLog(normaliseHookPayload(PRE_TOOL_USE));
		await log.addLog(normaliseHookPayload(PRE_TOOL_USE));
		assert.equal(log.getDuplicatesDropped(), 2);
	});
});
