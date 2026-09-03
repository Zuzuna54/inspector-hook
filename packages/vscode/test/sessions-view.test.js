/**
 * Sessions view tests, including regressions for shipped bugs:
 *   - tool durations derived from second-resolution timestamps (fiction)
 *   - copy buttons carrying JSON in an HTML attribute (copied "{")
 *   - running tools resolved by parsing a UUID as an array index
 *   - a malformed activity item taking out the whole feed
 *   - StopFailure rendered as something Claude said
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { loadSessionsView, readMedia } from "./harness.js";

const V = loadSessionsView();

const activity = (type, promptId, data = {}) => ({
	id: `${type}-${promptId}-${Math.random().toString(36).slice(2, 8)}`,
	type,
	timestamp: "2026-09-03T14:00:00.000Z",
	data: { promptId, ...data },
});

describe("tool duration", () => {
	it("prefers the hook-reported duration over subtracting timestamps", () => {
		// Hook timestamps were second-resolution, so a derived duration is always
		// a multiple of 1000ms or 0 - fiction for a call taking tens of ms.
		assert.equal(
			V.formatToolDuration({
				durationMs: 253,
				startTime: "2026-09-03T11:29:48Z",
				endTime: "2026-09-03T11:29:49Z",
			}),
			"253ms",
		);
	});

	it("finds the duration where it actually surfaces on a ToolExecution", () => {
		// SessionManager assigns exec.result = log.details, so the hook's
		// durationMs arrives nested rather than at the top level.
		assert.equal(
			V.formatToolDuration({ result: { durationMs: 44 } }),
			"44ms",
			"result.durationMs is the real path for the Tools tab",
		);
	});

	it("falls back to timestamps when no duration was reported", () => {
		assert.equal(
			V.formatToolDuration({
				startTime: "2026-09-03T11:29:48Z",
				endTime: "2026-09-03T11:29:49Z",
			}),
			"1000ms",
		);
	});

	it("returns empty rather than a bogus duration when it has neither", () => {
		assert.equal(V.formatToolDuration({}), "");
	});
});

describe("copy payloads", () => {
	const quotedJson = '{"command":"echo \\"hi\\"","file_path":"/a/b.ts"}';

	it("round-trips content containing quotes", () => {
		const key = V.registerCopyPayload(quotedJson);
		assert.equal(V._copyPayloads.get(key), quotedJson);
	});

	it("keeps the payload out of the HTML attribute entirely", () => {
		// Utils.escapeHtml assigns textContent and reads innerHTML, which does
		// NOT escape quotes. Tool input is JSON and always contains them, so the
		// attribute ended at the first quote and the button copied "{".
		const html = V.renderToolDetails({
			input: JSON.parse(quotedJson),
			result: "done",
			affectedFiles: ["/a/b.ts"],
		});
		assert.ok(!html.includes('data-copy="'), "must not use data-copy=");
		assert.ok(html.includes("data-copy-key="), "must reference a key");
		const keys = html.match(/data-copy-key="([^"]*)"/g) || [];
		assert.equal(keys.length, 2, "one key each for input and output");
	});
});

describe("item identity", () => {
	const feedSrc =
		readMedia("scripts/views/sessions/activity-feed.js") +
		readMedia("scripts/views/sessions/tool-detail.js");

	it("never parses an activity item id as an array index", () => {
		// data-item-id holds a log UUID. Parsing it gave NaN for a letter-leading
		// id (silent miss) or an arbitrary small integer for a digit-leading one -
		// 60% of real ids - which could match a DIFFERENT activity and render
		// another tool's markup into that bubble.
		//
		// The tools-tab form is exempt: its ids ARE indices by construction
		// (toolItemId returns `tools-tab-${idx}`) and it is reached only after
		// checking activeTab === "tools".
		const parses = feedSrc.match(/parseInt\([^)]*itemId[^)]*\)/g) || [];
		for (const parse of parses) {
			assert.ok(
				parse.includes("tools-tab-"),
				`itemId parsed as an index outside the tools tab: ${parse}`,
			);
		}
	});

	it("resolves a running tool by matching its id", () => {
		assert.match(feedSrc, /a\.id === itemId/);
	});

	it("builds tools-tab ids that round-trip", () => {
		assert.equal(V.toolItemId(4), "tools-tab-4");
		assert.equal(
			Number.parseInt(V.toolItemId(37).replace("tools-tab-", ""), 10),
			37,
		);
	});
});

describe("activity normalization", () => {
	it("rejects items that are not objects", () => {
		assert.equal(V.normalizeActivity(null), null);
		assert.equal(V.normalizeActivity(7), null);
		assert.equal(V.normalizeActivity("nope"), null);
	});

	it("guarantees a data object", () => {
		// Several renderers reach into activity.data.x, which throws on null -
		// one malformed item took out the whole feed instead of degrading to a
		// single "unknown" bubble.
		assert.equal(typeof V.normalizeActivity({ type: "user_prompt" }).data, "object");
		assert.notEqual(V.normalizeActivity({ type: "user_prompt", data: null }).data, null);
	});

	it("renders an item whose data is null without throwing", () => {
		assert.doesNotThrow(() =>
			V.renderActivityItem(V.normalizeActivity({ type: "user_prompt", data: null }), 0),
		);
	});

	it("renders every declared activity type without throwing", () => {
		for (const type of [
			"user_prompt",
			"ai_response",
			"tool_call",
			"session_start",
			"notification",
			"subagent_complete",
			"message",
		]) {
			assert.doesNotThrow(
				() => V.renderActivityItem(activity(type, "p1", { tool: "Bash" }), 0),
				`type ${type} must render`,
			);
		}
	});

	it("degrades an unrecognised type to a bubble rather than throwing", () => {
		const html = V.renderActivityItem(activity("no_such_type", "p1"), 0);
		assert.ok(html.includes("sv-unknown"));
	});
});

describe("turn grouping", () => {
	it("groups by promptId, one turn per user message", () => {
		const turns = V.groupIntoTurns([
			activity("user_prompt", "p1", { prompt: "first" }),
			activity("tool_call", "p1", { tool: "Read", status: "completed", file: "/a.ts" }),
			activity("tool_call", "p1", { tool: "Bash", status: "failed" }),
			activity("ai_response", "p1", { assistantMessage: "done" }),
			activity("user_prompt", "p2", { prompt: "second" }),
		]);
		assert.equal(turns.length, 2);
		assert.equal(turns[0].items.length, 4);
		assert.equal(turns[0].prompt, "first");
		assert.equal(turns[0].key, "p1", "the turn is keyed on its promptId");
	});

	it("groups by id, not adjacency", () => {
		// A tool call whose result lands after the next prompt still belongs to
		// the turn that issued it.
		const turns = V.groupIntoTurns([
			activity("user_prompt", "pA", { prompt: "A" }),
			activity("user_prompt", "pB", { prompt: "B" }),
			activity("tool_call", "pA", { tool: "Read", status: "completed" }),
		]);
		assert.equal(turns.length, 2);
		assert.equal(turns[0].items.length, 2, "the late item rejoined turn A");
	});

	it("counts tools, errors and distinct files per turn", () => {
		const [turn] = V.groupIntoTurns([
			activity("user_prompt", "p1", { prompt: "x" }),
			activity("tool_call", "p1", { tool: "Read", status: "completed", file: "/a.ts" }),
			activity("tool_call", "p1", { tool: "Edit", status: "completed", file: "/a.ts" }),
			activity("tool_call", "p1", { tool: "Bash", status: "failed" }),
		]);
		const stats = V.turnStats(turn);
		assert.equal(stats.tools, 3);
		assert.equal(stats.errors, 1);
		assert.equal(stats.files, 1, "the same file twice counts once");
	});

	it("segments on user prompts for sessions logged before promptId existed", () => {
		const turns = V.groupIntoTurns([
			{ id: "l1", type: "tool_call", timestamp: "t0", data: { tool: "Read" } },
			{ id: "l2", type: "user_prompt", timestamp: "t1", data: { prompt: "hello" } },
			{ id: "l3", type: "tool_call", timestamp: "t2", data: { tool: "Bash" } },
			{ id: "l4", type: "user_prompt", timestamp: "t3", data: { prompt: "again" } },
		]);
		assert.equal(turns.length, 3);
		assert.equal(turns[0].items.length, 1, "pre-prompt activity gets its own turn");
		assert.equal(turns[0].prompt, "", "and no prompt text to show");
	});
});

describe("turn collapse seeding", () => {
	it("collapses all but the newest turn", () => {
		V._collapsedTurns.clear();
		V._turnsSeededFor = null;
		const turns = V.groupIntoTurns([
			activity("user_prompt", "p1", { prompt: "a" }),
			activity("user_prompt", "p2", { prompt: "b" }),
			activity("user_prompt", "p3", { prompt: "c" }),
		]);
		V.seedTurnCollapse(turns, "sessionA");
		assert.equal(V._collapsedTurns.size, turns.length - 1);
		assert.ok(!V._collapsedTurns.has(turns[turns.length - 1].key));
	});

	it("does not re-seed the same session", () => {
		// Re-seeding on each poll would undo the user's expansions every 2s.
		const turns = V.groupIntoTurns([
			activity("user_prompt", "q1", { prompt: "a" }),
			activity("user_prompt", "q2", { prompt: "b" }),
		]);
		V._collapsedTurns.clear();
		V._turnsSeededFor = null;
		V.seedTurnCollapse(turns, "sessionB");
		V._collapsedTurns.delete(turns[0].key);
		V.seedTurnCollapse(turns, "sessionB");
		assert.ok(!V._collapsedTurns.has(turns[0].key), "expansion survived");
	});

	it("re-seeds when the selected session changes", () => {
		const turns = V.groupIntoTurns([
			activity("user_prompt", "r1", { prompt: "a" }),
			activity("user_prompt", "r2", { prompt: "b" }),
		]);
		V._collapsedTurns.clear();
		V._turnsSeededFor = "sessionB";
		V.seedTurnCollapse(turns, "sessionC");
		assert.ok(V._collapsedTurns.has(turns[0].key));
	});
});

describe("Stop versus StopFailure", () => {
	it("has no stop-reason lookup left", () => {
		// getStopReason read stopReason/stop_reason/finish_reason; no Claude Code
		// event carries any of them, so it could never return anything.
		assert.equal(typeof V.getStopReason, "undefined");
	});

	it("renders a failed turn as a failure, not as a reply", () => {
		// StopFailure reuses last_assistant_message for the API error string, so
		// this must never read as something Claude said.
		const html = V.renderActivityItem(
			{
				id: "sf",
				type: "message",
				timestamp: "t",
				data: { stopError: "rate_limit", errorDetails: "API Error: Rate limit reached" },
			},
			0,
		);
		assert.ok(html.includes("Turn failed"));
		assert.ok(html.includes("rate_limit"));
		assert.ok(!html.includes("sv-ai"), "must not be an assistant bubble");
	});

	it("renders Claude's actual reply when Stop supplied one", () => {
		const html = V.renderActivityItem(
			activity("ai_response", "p1", { assistantMessage: "Here is the answer." }),
			0,
		);
		assert.ok(html.includes("Here is the answer."));
	});

	it("reports outstanding background work instead of claiming completion", () => {
		const html = V.renderActivityItem(
			activity("ai_response", "p1", { assistantMessage: "x", backgroundTasks: 2 }),
			0,
		);
		assert.ok(html.includes("Paused"));
		assert.ok(html.includes("2 background task"));
	});
});

describe("session shape tolerance", () => {
	// A session arrives either full (sessions.getAll) or summarised (the activity
	// response, which omits toolExecutions because it dominated the payload).
	it("counts from a summary", () => {
		const summary = { id: "abc12345", toolExecutionCount: 7, fileChangeCount: 3, errorCount: 1 };
		assert.equal(V.toolCount(summary), 7);
		assert.equal(V.fileCount(summary), 3);
		assert.equal(V.countErrors(summary), 1);
	});

	it("counts from a full session", () => {
		const full = {
			id: "abc12345",
			toolExecutions: [{ status: "completed" }, { status: "failed" }],
			fileChanges: ["c1"],
		};
		assert.equal(V.toolCount(full), 2);
		assert.equal(V.fileCount(full), 1);
		assert.equal(V.countErrors(full), 1);
	});

	it("reads the git branch from either shape", () => {
		assert.equal(V.gitBranchOf({ metadata: { gitBranch: "main" } }), "main");
		assert.equal(V.gitBranchOf({ gitBranch: "dev" }), "dev");
		assert.equal(V.gitBranchOf({}), undefined);
	});
});
