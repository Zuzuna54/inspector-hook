/**
 * SessionManager tests, including regressions for two shipped bugs:
 *   B2 - tool executions mispaired because completion matched on tool NAME
 *   B4 - the "Stop" hook was treated as a session end
 */

import { strict as assert } from "node:assert";
import { after, describe, it } from "node:test";

import { SessionManager } from "../dist/index.js";
import { cleanup, makeLog, makeTempStore } from "./helpers.js";

const tempDirs = [];
async function newManager(options = {}) {
	const storagePath = await makeTempStore();
	tempDirs.push(storagePath);
	return new SessionManager({ storagePath, ...options });
}

after(async () => {
	await Promise.all(tempDirs.map(cleanup));
});

describe("SessionManager", () => {
	describe("session creation", () => {
		it("creates a session from hook metadata on first activity", async () => {
			const mgr = await newManager();
			mgr.trackActivity("s1", makeLog({
				sessionId: "s1",
				hook: "SessionStart",
				event: "session.start",
				details: {
					cwd: "/home/dev/my-project",
					projectName: "my-project",
					gitBranch: "main",
				},
			}));

			const session = await mgr.getSession("s1");
			assert.equal(session.status, "active");
			assert.equal(session.name, "my-project");
			assert.equal(session.metadata.gitBranch, "main");
		});

		it("derives a project name from cwd when none is supplied", async () => {
			const mgr = await newManager();
			mgr.trackActivity("s1", makeLog({
				sessionId: "s1",
				hook: "SessionStart",
				event: "session.start",
				details: { cwd: "/a/b/inferred-name" },
			}));

			assert.equal((await mgr.getSession("s1")).name, "inferred-name");
		});
	});

	describe("tool execution pairing", () => {
		it("REGRESSION B2: pairs parallel same-tool calls by tool_use_id", async () => {
			const mgr = await newManager();

			// Three concurrent Bash calls, as happens when several tool calls are
			// issued in one assistant message.
			for (const id of ["toolu_1", "toolu_2", "toolu_3"]) {
				mgr.trackActivity("s1", makeLog({
					sessionId: "s1",
					tool: "Bash",
					event: "PreToolUse",
					executionId: id,
				}));
			}

			// They complete out of order - the case that used to mispair, because
			// "first running execution named Bash" is not necessarily this one.
			for (const id of ["toolu_3", "toolu_1", "toolu_2"]) {
				mgr.trackActivity("s1", makeLog({
					sessionId: "s1",
					tool: "Bash",
					event: "PostToolUse",
					executionId: id,
				}));
			}

			const session = await mgr.getSession("s1");
			assert.equal(session.toolExecutions.length, 3);
			assert.equal(
				session.toolExecutions.filter((e) => e.status === "running").length,
				0,
				"every execution should be completed, none left running",
			);
			// Each execution is the one its own completion resolved.
			for (const exec of session.toolExecutions) {
				assert.equal(exec.status, "completed");
				assert.ok(exec.endTime, "completed execution must have an endTime");
			}
		});

		it("falls back to tool-name matching when no tool_use_id is present", async () => {
			const mgr = await newManager();
			mgr.trackActivity("s1", makeLog({
				sessionId: "s1", tool: "Read", event: "PreToolUse",
			}));
			mgr.trackActivity("s1", makeLog({
				sessionId: "s1", tool: "Read", event: "PostToolUse",
			}));

			const [exec] = (await mgr.getSession("s1")).toolExecutions;
			assert.equal(exec.status, "completed");
		});

		it("marks a failed tool execution as failed", async () => {
			const mgr = await newManager();
			mgr.trackActivity("s1", makeLog({
				sessionId: "s1", tool: "Bash", event: "PreToolUse", executionId: "t1",
			}));
			mgr.trackActivity("s1", makeLog({
				sessionId: "s1",
				tool: "Bash",
				event: "PostToolUse",
				executionId: "t1",
				level: "error",
			}));

			const [exec] = (await mgr.getSession("s1")).toolExecutions;
			assert.equal(exec.status, "failed");
		});

		it("marks a blocked tool execution as blocked", async () => {
			const mgr = await newManager();
			mgr.trackActivity("s1", makeLog({
				sessionId: "s1", tool: "Bash", event: "PreToolUse", executionId: "t1",
			}));
			mgr.trackActivity("s1", makeLog({
				sessionId: "s1",
				tool: "Bash",
				event: "PostToolUse",
				executionId: "t1",
				level: "blocked",
				message: "denied by policy",
			}));

			const [exec] = (await mgr.getSession("s1")).toolExecutions;
			assert.equal(exec.status, "blocked");
			assert.equal(exec.error, "denied by policy");
		});
	});

	describe("session lifecycle", () => {
		it("REGRESSION B4: the Stop hook does NOT end the session", async () => {
			const mgr = await newManager();
			let endedEvents = 0;
			mgr.on("session:ended", () => endedEvents++);

			mgr.trackActivity("s1", makeLog({
				sessionId: "s1", hook: "SessionStart", event: "session.start",
			}));

			// Stop fires after every single assistant response.
			for (let i = 0; i < 3; i++) {
				mgr.trackActivity("s1", makeLog({
					sessionId: "s1", hook: "Stop", event: "ai.response",
				}));
			}

			const session = await mgr.getSession("s1");
			assert.equal(session.status, "active", "session must stay active");
			assert.equal(session.endTime, undefined, "endTime must not be set");
			assert.equal(endedEvents, 0, "no session:ended should be emitted");
		});

		it("SessionEnd does end the session", async () => {
			const mgr = await newManager();
			let ended = null;
			mgr.on("session:ended", (s) => (ended = s));

			mgr.trackActivity("s1", makeLog({
				sessionId: "s1", hook: "SessionStart", event: "session.start",
			}));
			mgr.trackActivity("s1", makeLog({
				sessionId: "s1", hook: "SessionEnd", event: "session.end",
			}));

			const session = await mgr.getSession("s1");
			assert.equal(session.status, "completed");
			assert.ok(session.endTime);
			assert.ok(ended, "session:ended should be emitted");
		});

		it("marks an inactive session idle once past the idle timeout", async () => {
			const mgr = await newManager({ idleTimeoutMs: 20 });
			mgr.trackActivity("s1", makeLog({ sessionId: "s1" }));

			// Backdate last activity rather than sleeping.
			const session = await mgr.getSession("s1");
			session.lastActivityTime = new Date(Date.now() - 10_000).toISOString();

			await mgr.checkStaleSessions();
			assert.equal((await mgr.getSession("s1")).status, "idle");
		});

		it("reactivates an idle session when activity resumes", async () => {
			const mgr = await newManager({ idleTimeoutMs: 20 });
			mgr.trackActivity("s1", makeLog({ sessionId: "s1" }));
			const session = await mgr.getSession("s1");
			session.lastActivityTime = new Date(Date.now() - 10_000).toISOString();
			await mgr.checkStaleSessions();
			assert.equal((await mgr.getSession("s1")).status, "idle");

			mgr.trackActivity("s1", makeLog({ sessionId: "s1" }));
			assert.equal((await mgr.getSession("s1")).status, "active");
		});
	});

	describe("stuck execution reconciliation", () => {
		it("REGRESSION: resolves executions that never received a completion", async () => {
			const mgr = await newManager();
			mgr.trackActivity("s1", makeLog({
				sessionId: "s1", tool: "Bash", event: "PreToolUse", executionId: "t1",
			}));

			// A PreToolUse denial produces neither PostToolUse nor
			// PostToolUseFailure, so this execution never terminates on its own.
			const [exec] = (await mgr.getSession("s1")).toolExecutions;
			assert.equal(exec.status, "running");

			// maxAgeMs 0 resolves everything currently running.
			const { resolved } = await mgr.reconcileStuckExecutions({ maxAgeMs: 0 });

			assert.equal(resolved, 1);
			// "unknown", not "failed". This assertion used to say "failed" while
			// the line below demanded the error text "must be honest, not claim
			// failure" -- the test contradicted itself and still passed.
			assert.equal(exec.status, "unknown");
			assert.ok(exec.endTime, "must be given an end time");
			assert.match(exec.error, /outcome is unknown/i, "must be honest, not claim failure");
		});

		it("leaves a genuinely recent execution alone", async () => {
			const mgr = await newManager();
			mgr.trackActivity("s1", makeLog({
				sessionId: "s1", tool: "Bash", event: "PreToolUse", executionId: "t1",
			}));

			// A long-running Bash command must not be resolved out from under itself.
			const { resolved } = await mgr.reconcileStuckExecutions({
				maxAgeMs: 60 * 60 * 1000,
			});

			assert.equal(resolved, 0);
			assert.equal((await mgr.getSession("s1")).toolExecutions[0].status, "running");
		});

		it("does not touch already-resolved executions", async () => {
			const mgr = await newManager();
			mgr.trackActivity("s1", makeLog({
				sessionId: "s1", tool: "Read", event: "PreToolUse", executionId: "t1",
			}));
			mgr.trackActivity("s1", makeLog({
				sessionId: "s1", tool: "Read", event: "PostToolUse", executionId: "t1",
			}));

			const { resolved } = await mgr.reconcileStuckExecutions({ maxAgeMs: 0 });

			assert.equal(resolved, 0);
			assert.equal((await mgr.getSession("s1")).toolExecutions[0].status, "completed");
		});

		it("drains executions left running by a previous process on load", async () => {
			const { PersistenceStore, SessionManager } = await import("../dist/index.js");
			const storagePath = await makeTempStore();
			tempDirs.push(storagePath);
			const persistence = new PersistenceStore({ basePath: storagePath });
			await persistence.initialize();

			// A store written by a core that died mid-execution.
			await persistence.saveJSON("sessions", "dead", {
				id: "dead",
				status: "active",
				startTime: "2026-01-01T00:00:00.000Z",
				lastActivityTime: "2026-01-01T00:00:00.000Z",
				toolExecutions: [
					{ id: "t1", tool: "Bash", input: {}, startTime: "2026-01-01T00:00:00.000Z", status: "running" },
				],
				fileChanges: [],
			});

			const mgr = new SessionManager({ storagePath, persistence });
			await mgr.load();

			const session = await mgr.getSession("dead");
			assert.equal(
				session.toolExecutions[0].status,
				"unknown",
				"nothing can still be running in a store we just loaded, and we " +
					"do not know whether it succeeded",
			);
		});
	});

	describe("persistence", () => {
		it("counts active and idle sessions in stats", async () => {
			const mgr = await newManager();
			mgr.trackActivity("a", makeLog({ sessionId: "a" }));
			mgr.trackActivity("b", makeLog({ sessionId: "b" }));

			const stats = mgr.getStats();
			assert.equal(stats.totalSessions, 2);
			assert.equal(stats.activeSessions, 2);
		});

		it("filters sessions by status", async () => {
			const mgr = await newManager();
			mgr.trackActivity("a", makeLog({ sessionId: "a" }));
			mgr.trackActivity("b", makeLog({
				sessionId: "b", hook: "SessionEnd", event: "session.end",
			}));

			const { sessions } = await mgr.getSessions({ status: "completed" });
			assert.equal(sessions.length, 1);
			assert.equal(sessions[0].id, "b");
		});
	});
});
describe("REGRESSION: an unreported outcome is not a failure", () => {
	// Found by an auditing peer session against the live store: 22 executions
	// had been reaped to `failed`, and NOT ONE had actually failed. Among them a
	// `Read` that succeeded, sat running for 15 minutes because no completion
	// event arrived, and was then reported as a failure. Some tools legitimately
	// emit no completion event at all -- ExitPlanMode and AskUserQuestion were
	// both in the reaped set -- so this is a normal outcome, not an error.
	//
	// The old code hedged in the error TEXT while the status still asserted
	// failure, which a status badge does not show.
	it("marks an abandoned execution unknown, not failed", async () => {
		const { markAbandoned } = await import("../dist/index.js");
		const exec = {
			id: "e1", tool: "Read", input: {}, startTime: "2026-09-03T10:00:00.000Z",
			status: "running",
		};

		markAbandoned(exec);

		assert.equal(exec.status, "unknown", "not failed — we do not know that it failed");
		assert.match(exec.error, /outcome is unknown/);
		assert.ok(exec.endTime, "and it is terminal, so it stops being reported as running");
	});

	it("does not count an unknown outcome as an error in session stats", async () => {
		// This is where the reaper's guess became a reported error count.
		const manager = await newManager();
		// trackActivity(sessionId, log) — synchronous, two arguments.
		manager.trackActivity("s1", makeLog({
			hook: "PreToolUse", event: "PreToolUse", sessionId: "s1",
			tool: "ExitPlanMode", executionId: "tu-x",
			details: { cwd: "/w/proj" },
		}));

		const session = await manager.getSession("s1");
		assert.equal(session.toolExecutions.length, 1, "the execution was recorded");
		const { markAbandoned } = await import("../dist/index.js");
		markAbandoned(session.toolExecutions[0]);

		const stats = await manager.getSessionStats("s1");
		assert.equal(stats.errors, 0, "an unreported outcome is not an error");
		assert.equal(stats.blocked, 0);
	});
});
