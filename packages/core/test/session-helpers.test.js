/**
 * Unit tests for the helpers extracted out of SessionManager.
 *
 * These were inline private methods, and the naming logic in particular had
 * four copies that had already drifted. A shared helper has to be at least as
 * tolerant as the most tolerant caller it replaces — consolidating otherwise
 * introduces a crash exactly where each local copy happened to guard. So the
 * defensive cases are tested explicitly, not just the happy path.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
	createExecution,
	deriveSessionName,
	extractProjectName,
	findAbandonedExecutions,
	findRunningExecution,
	isToolCompletionEvent,
	isToolStartEvent,
	markAbandoned,
	mergeSessionMetadata,
	terminalStatusFor,
} from "../dist/index.js";

const log = (over = {}) => ({
	id: "l1",
	timestamp: new Date().toISOString(),
	level: "info",
	hook: "PreToolUse",
	event: "PreToolUse",
	message: "m",
	...over,
});

describe("extractProjectName", () => {
	it("takes the last path segment", () => {
		assert.equal(extractProjectName("/home/dev/my-project"), "my-project");
	});

	it("ignores a trailing separator", () => {
		assert.equal(extractProjectName("/home/dev/my-project/"), "my-project");
	});

	it("handles Windows separators", () => {
		assert.equal(extractProjectName("C:\\Users\\dev\\proj"), "proj");
	});

	// The defensive cases: each local copy guarded a different subset.
	it("returns undefined for undefined, null and non-strings", () => {
		for (const input of [undefined, null, 42, {}, []]) {
			assert.equal(extractProjectName(input), undefined, `input: ${input}`);
		}
	});

	it("returns undefined for an empty string and for separators only", () => {
		assert.equal(extractProjectName(""), undefined);
		assert.equal(extractProjectName("///"), undefined);
	});
});

describe("deriveSessionName", () => {
	it("prefers an explicit projectName", () => {
		assert.equal(
			deriveSessionName({ projectName: "explicit", workingDirectory: "/a/other" }),
			"explicit",
		);
	});

	it("falls back to the working directory", () => {
		assert.equal(deriveSessionName({ workingDirectory: "/a/inferred" }), "inferred");
	});

	it("returns undefined rather than a placeholder when it cannot tell", () => {
		assert.equal(deriveSessionName(undefined), undefined);
		assert.equal(deriveSessionName({}), undefined);
		assert.equal(deriveSessionName({ projectName: "" }), undefined);
	});
});

describe("mergeSessionMetadata", () => {
	it("fills fields from a SessionStart payload", () => {
		const m = mergeSessionMetadata(undefined, {
			cwd: "/home/dev/proj",
			projectName: "proj",
			gitBranch: "main",
			gitRemote: "origin",
		});
		assert.equal(m.projectName, "proj");
		assert.equal(m.gitBranch, "main");
		assert.equal(m.workingDirectory, "/home/dev/proj");
	});

	it("does NOT blank an existing field when a later event omits it", () => {
		const m = mergeSessionMetadata(
			{ projectName: "proj", gitBranch: "main" },
			{ cwd: "/home/dev/proj" },
		);
		assert.equal(m.gitBranch, "main", "must survive an event that omits it");
		assert.equal(m.projectName, "proj");
	});

	it("infers a project name from cwd only when none is known", () => {
		assert.equal(
			mergeSessionMetadata(undefined, { cwd: "/a/inferred" }).projectName,
			"inferred",
		);
		assert.equal(
			mergeSessionMetadata({ projectName: "kept" }, { cwd: "/a/other" }).projectName,
			"kept",
		);
	});

	it("tolerates no details at all", () => {
		assert.deepEqual(mergeSessionMetadata({ projectName: "p" }, undefined), {
			projectName: "p",
		});
	});
});

describe("tool event classification", () => {
	it("recognises the start events", () => {
		assert.ok(isToolStartEvent("PreToolUse"));
		assert.ok(isToolStartEvent("tool.start"));
		assert.equal(isToolStartEvent("PostToolUse"), false);
		assert.equal(isToolStartEvent(undefined), false);
	});

	it("recognises PostToolUseFailure as a completion", () => {
		// A distinct event from PostToolUse. Omitting it left every failed tool
		// call "running" forever.
		assert.ok(isToolCompletionEvent("PostToolUseFailure"));
		assert.ok(isToolCompletionEvent("PostToolUse"));
		assert.ok(isToolCompletionEvent("tool.end"));
		assert.equal(isToolCompletionEvent("PreToolUse"), false);
	});
});

describe("terminalStatusFor", () => {
	it("maps an error level to failed", () => {
		assert.equal(terminalStatusFor(log({ level: "error" })), "failed");
	});

	it("maps PostToolUseFailure to failed regardless of level", () => {
		assert.equal(
			terminalStatusFor(log({ event: "PostToolUseFailure", level: "info" })),
			"failed",
		);
	});

	it("maps a blocked level to blocked", () => {
		// Resolved here rather than in a later pass: blocked used to be handled
		// after "completed" had already been written, so the blocked branch could
		// no longer find the execution and blocked calls looked successful.
		assert.equal(terminalStatusFor(log({ level: "blocked" })), "blocked");
	});

	it("defaults to completed", () => {
		assert.equal(terminalStatusFor(log()), "completed");
	});
});

describe("findRunningExecution", () => {
	const running = (id, tool) => ({
		id, tool, input: {}, startTime: new Date().toISOString(), status: "running",
	});

	it("matches on executionId exactly, even among same-tool calls", () => {
		const execs = [running("t1", "Bash"), running("t2", "Bash"), running("t3", "Bash")];
		const found = findRunningExecution(execs, log({ tool: "Bash", executionId: "t2" }));
		assert.equal(found.id, "t2", "must not return the first Bash");
	});

	it("ignores an already-resolved execution with a matching id", () => {
		const done = { ...running("t1", "Bash"), status: "completed" };
		assert.equal(
			findRunningExecution([done], log({ tool: "Bash", executionId: "t1" })),
			undefined,
		);
	});

	it("falls back to tool name when no executionId is present", () => {
		const execs = [running("t1", "Read")];
		assert.equal(findRunningExecution(execs, log({ tool: "Read" })).id, "t1");
	});

	it("returns undefined when nothing matches", () => {
		assert.equal(findRunningExecution([], log({ tool: "Bash" })), undefined);
	});
});

describe("createExecution", () => {
	it("uses tool_use_id as the execution id when supplied", () => {
		assert.equal(createExecution(log({ tool: "Bash", executionId: "toolu_x" })).id, "toolu_x");
	});

	it("synthesises an id when the hook supplied none", () => {
		const e = createExecution(log({ tool: "Bash" }));
		assert.ok(e.id.startsWith("exec-"), `got ${e.id}`);
	});

	it("records the affected file when there is one", () => {
		assert.deepEqual(
			createExecution(log({ tool: "Edit", file: "/a.ts" })).affectedFiles,
			["/a.ts"],
		);
	});

	it("starts running", () => {
		assert.equal(createExecution(log({ tool: "Bash" })).status, "running");
	});
});

describe("findAbandonedExecutions", () => {
	const at = (iso, status = "running") => ({
		id: "x", tool: "Bash", input: {}, startTime: iso, status,
	});
	const NOW = Date.parse("2026-01-01T12:00:00.000Z");

	it("finds an execution older than the threshold", () => {
		const old = at("2026-01-01T11:00:00.000Z");
		assert.equal(findAbandonedExecutions([old], 60_000, NOW).length, 1);
	});

	it("leaves a recent one alone", () => {
		// A legitimately long Bash command must not be resolved out from under
		// itself.
		const recent = at("2026-01-01T11:59:30.000Z");
		assert.equal(findAbandonedExecutions([recent], 60_000, NOW).length, 0);
	});

	it("ignores executions that are not running", () => {
		const done = at("2026-01-01T01:00:00.000Z", "completed");
		assert.equal(findAbandonedExecutions([done], 0, NOW).length, 0);
	});

	it("treats an unparseable startTime as abandoned", () => {
		// It cannot be aged, and leaving it running forever is the worse failure.
		assert.equal(findAbandonedExecutions([at("not a date")], 60_000, NOW).length, 1);
	});

	it("maxAgeMs 0 resolves everything running, which is correct at load", () => {
		const fresh = at(new Date(NOW).toISOString());
		assert.equal(findAbandonedExecutions([fresh], 0, NOW).length, 1);
	});
});

describe("markAbandoned", () => {
	it("marks failed with an honest reason and an end time", () => {
		const e = { id: "x", tool: "Bash", input: {}, startTime: "2026-01-01T00:00:00.000Z", status: "running" };
		markAbandoned(e);

		assert.equal(e.status, "failed");
		assert.ok(e.endTime);
		// Not a claim that the call failed on its merits.
		assert.match(e.error, /outcome is unknown/i);
	});
});
