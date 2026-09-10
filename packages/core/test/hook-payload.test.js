/**
 * The native HTTP-hook payload, reshaped (M2).
 *
 * Claude Code can POST a hook event straight to a URL, which means the core's
 * own HTTP server can BE the hook handler and the shell + jq + curl + port-file
 * layer becomes optional. The reshaping that made that layer necessary lived in
 * ~150 lines of jq; this is that logic ported, and these tests exist mostly to
 * pin the two transports to the SAME record. A difference between them means an
 * event captured one way and lost the other, which is the hardest kind of gap
 * to notice.
 *
 * The payload shapes here are not invented: they are the fields a real
 * PreToolUse HTTP hook delivered when this was measured on 2026-09-09 —
 * cwd, effort, hook_event_name, permission_mode, prompt_id, session_id,
 * tool_input, tool_name, tool_use_id, transcript_path.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
	eventFor,
	levelFor,
	messageFor,
	normaliseHookPayload,
} from "../dist/index.js";

/** A real PreToolUse payload, as captured from a live HTTP hook. */
const REAL_PRE_TOOL_USE = {
	hook_event_name: "PreToolUse",
	session_id: "097788a3-d6a3-45cc-b3c9-4d12390403d5",
	prompt_id: "5196bf94-e3ff-467f-9f6b-b7803d579a20",
	tool_use_id: "toolu_01ND3vRpV7BCsg3Tp6jUsxSn",
	tool_name: "Bash",
	tool_input: { command: "cat probe.txt", description: "read it" },
	cwd: "/tmp/probe",
	permission_mode: "bypassPermissions",
	effort: { level: "xhigh" },
	transcript_path: "/Users/me/.claude/projects/-tmp-probe/097788a3.jsonl",
};

describe("normalising a native payload", () => {
	it("promotes the correlation ids to the top level", () => {
		const log = normaliseHookPayload(REAL_PRE_TOOL_USE);
		// The core treats these as first-class rather than as metadata: B2's
		// whole fix was pairing executions on tool_use_id.
		assert.equal(log.tool_use_id, "toolu_01ND3vRpV7BCsg3Tp6jUsxSn");
		assert.equal(log.prompt_id, "5196bf94-e3ff-467f-9f6b-b7803d579a20");
		assert.equal(log.sessionId, "097788a3-d6a3-45cc-b3c9-4d12390403d5");
	});

	it("unwraps effort, which arrives as an object", () => {
		// `.effort.level` in the jq. A payload sending it as a bare string is
		// also accepted rather than dropped.
		assert.equal(
			normaliseHookPayload(REAL_PRE_TOOL_USE).details.effort,
			"xhigh",
		);
		assert.equal(
			normaliseHookPayload({ ...REAL_PRE_TOOL_USE, effort: "low" }).details
				.effort,
			"low",
		);
	});

	it("REGRESSION: derives level instead of hardcoding info", () => {
		// It was hardcoded "info", so the Errors / Warnings / Blocked counters
		// could never populate from real traffic no matter what happened.
		assert.equal(levelFor({ hook_event_name: "PostToolUseFailure" }), "error");
		assert.equal(levelFor({ hook_event_name: "StopFailure" }), "error");
		assert.equal(levelFor({ hook_event_name: "PermissionDenied" }), "blocked");
		assert.equal(levelFor({ hook_event_name: "PostToolUse" }), "info");
	});

	it("tells a permission block apart from a failure", () => {
		assert.equal(
			levelFor({
				hook_event_name: "PostToolUse",
				tool_error: "Permission denied by hook",
			}),
			"blocked",
		);
		assert.equal(
			levelFor({
				hook_event_name: "PostToolUse",
				tool_error: "ENOENT: no such file",
			}),
			"error",
		);
		// Also when it arrives inside the tool response rather than tool_error.
		assert.equal(
			levelFor({
				hook_event_name: "PostToolUse",
				tool_response: { error: "not allowed" },
			}),
			"blocked",
		);
	});

	it("maps only the events the core keys on, and passes the rest through", () => {
		assert.equal(eventFor("UserPromptSubmit"), "user.prompt");
		assert.equal(eventFor("Stop"), "ai.response");
		assert.equal(eventFor("StopFailure"), "ai.error");
		assert.equal(eventFor("SubagentStop"), "subagent.stop");
		// An event added by the platform must not be renamed to something the
		// core would silently ignore.
		assert.equal(eventFor("WorktreeCreate"), "WorktreeCreate");
	});

	it("keeps Stop and StopFailure apart, because they share a field", () => {
		// Stop carries the finished reply in last_assistant_message;
		// StopFailure reuses the same field for the error string.
		const stop = normaliseHookPayload({
			hook_event_name: "Stop",
			session_id: "s",
			last_assistant_message: "here is the answer",
		});
		const failure = normaliseHookPayload({
			hook_event_name: "StopFailure",
			session_id: "s",
			error: "the model timed out",
		});
		assert.equal(stop.event, "ai.response");
		assert.equal(stop.level, "info");
		assert.equal(failure.event, "ai.error");
		assert.equal(failure.level, "error");
		assert.match(failure.message, /the model timed out/);
	});

	it("builds a readable message per tool", () => {
		assert.equal(messageFor(REAL_PRE_TOOL_USE), "Bash: cat probe.txt");
		assert.equal(
			messageFor({
				hook_event_name: "PreToolUse",
				tool_name: "Read",
				tool_input: { file_path: "/a/b.ts" },
			}),
			"Read: /a/b.ts",
		);
		assert.equal(
			messageFor({
				hook_event_name: "PreToolUse",
				tool_name: "Task",
				tool_input: { subagent_type: "Explore", description: "find it" },
			}),
			"Task (Explore): find it",
		);
	});

	it("clips a long command rather than storing it unbounded", () => {
		const log = normaliseHookPayload({
			...REAL_PRE_TOOL_USE,
			tool_input: { command: "x".repeat(500) },
		});
		assert.ok(log.message.length < 150, `message was ${log.message.length}`);
		assert.match(log.message, /…$/);
	});

	it("refuses a body that is not a hook payload", () => {
		// A stray POST must not land in the store as an `unknown` event that
		// looks real.
		assert.equal(normaliseHookPayload({ hello: "world" }), null);
		assert.equal(normaliseHookPayload(null), null);
		assert.equal(normaliseHookPayload([1, 2]), null);
		assert.equal(normaliseHookPayload("string"), null);
	});

	it("carries subagent attribution, which the agent tree is built from", () => {
		const log = normaliseHookPayload({
			...REAL_PRE_TOOL_USE,
			agent_id: "a-123",
			agent_type: "Explore",
		});
		assert.equal(log.details.agentId, "a-123");
		assert.equal(log.details.agentType, "Explore");
	});
});

describe("the two transports must not drift", () => {
	const shell = readFileSync(
		join(
			dirname(fileURLToPath(import.meta.url)),
			"..",
			"..",
			"hooks",
			"claude",
			"inspector-hook.sh",
		),
		"utf8",
	);

	/** One `$hook == "X" then "Y"` section of the jq, scoped by its comment. */
	function branchesIn(startMarker, endMarker) {
		const from = shell.indexOf(startMarker);
		assert.ok(from > 0, `the shell hook no longer has: ${startMarker}`);
		const block = shell.slice(from, shell.indexOf(endMarker, from));
		return [...block.matchAll(/\$hook == "(\w+)" then "([\w.]+)"/g)];
	}

	it("covers every event name the shell hook renames", () => {
		// Derived from the shell source rather than duplicated, so a rename
		// added there and not here fails this instead of silently producing two
		// different records for one event. Scoped to the event-name section:
		// an unscoped scan also matches the LEVEL branches, which map the same
		// hook names to entirely different values.
		const renames = branchesIn("# Event name.", "as $event");
		assert.ok(renames.length >= 8, `found only ${renames.length} renames`);
		for (const [, hook, event] of renames) {
			assert.equal(eventFor(hook), event, `${hook} maps differently`);
		}
	});

	it("covers the levels the shell hook derives", () => {
		const levels = branchesIn("# Level.", "as $level");
		assert.ok(levels.length >= 2, `found only ${levels.length} level branches`);
		for (const [, hook, level] of levels) {
			assert.equal(
				levelFor({ hook_event_name: hook }),
				level,
				`${hook} gets a different level`,
			);
		}
	});

	it("produces every details key the shell hook sends", () => {
		const block = shell.slice(shell.indexOf("details: {"));
		const keys = [
			...block.slice(0, block.indexOf("\n    }")).matchAll(/^\s{6}(\w+):/gm),
		].map((m) => m[1]);
		assert.ok(keys.length >= 20, `found only ${keys.length} detail keys`);

		const produced = normaliseHookPayload(REAL_PRE_TOOL_USE).details;
		const missing = keys.filter((k) => !(k in produced));
		assert.deepEqual(missing, [], "the HTTP transport drops these fields");
	});
});
