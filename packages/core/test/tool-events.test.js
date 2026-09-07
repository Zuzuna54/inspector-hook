/**
 * Tool lifecycle events — declared, emitted, and now actually consumed.
 *
 * ## The defect
 *
 * `SessionManager` declared five `tool:*` events and emitted them from six
 * sites. Nothing listened, anywhere, and no test asserted them: a working-
 * looking event bus that reached nothing. The four `session:*` events next door
 * all forward to IPC, which is what made the gap invisible — the file looked
 * like it broadcast tool activity, and it never had.
 *
 * ## Why one of these tests reads source
 *
 * The behavioural half (do the emits fire?) passed before the fix and would
 * pass again if the listeners were deleted tomorrow, because emitting into the
 * void is indistinguishable from emitting to a listener when you only watch the
 * emitter. The thing that regressed here was the *absence of a subscriber*, so
 * one test asserts exactly that: every tool event declared is subscribed in
 * core.ts. Constructing a real core would mean standing up an HTTP server, an
 * IPC server and persistence to observe one notification.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { SessionManager } from "../dist/index.js";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const sessionManagerSrc = readFileSync(
	join(srcDir, "managers", "session-manager.ts"),
	"utf8",
);
const coreSrcRaw = readFileSync(join(srcDir, "core.ts"), "utf8");

/**
 * core.ts with comments removed.
 *
 * Load-bearing: core.ts has a long comment that names "tool:started" and
 * "tool:completed" while explaining why file tracking is NOT wired to them. A
 * plain substring search therefore reported those two as consumed while nothing
 * subscribed to them -- the test would have passed on a comment. Only three of
 * the five were caught until this stripped them.
 */
const coreSrc = coreSrcRaw
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/^[ \t]*\/\/.*$/gm, "");

/** Event names declared in SessionManager's event map. */
function declaredToolEvents() {
	return [...sessionManagerSrc.matchAll(/^\t"(tool:[a-z]+)":/gm)].map(
		(m) => m[1],
	);
}

describe("tool events: declared, emitted, consumed", () => {
	it("REGRESSION: every declared tool event has a subscriber", () => {
		// This is the assertion that was false. Six emit sites, zero listeners.
		const declared = declaredToolEvents();
		assert.ok(
			declared.length >= 5,
			`expected the tool:* family, got ${declared}`,
		);

		const unconsumed = declared.filter(
			(event) => !coreSrc.includes(`"${event}"`),
		);
		assert.deepEqual(
			unconsumed,
			[],
			`declared and emitted but nothing in core.ts consumes: ${unconsumed.join(", ")}`,
		);
	});

	it("the subscriber reads the RESIDENT session, never an awaited one", () => {
		// getSession returns a Promise; the first version of this listener
		// broadcast that Promise as the notification payload.
		const listener = coreSrcRaw.slice(
			coreSrcRaw.indexOf('"tool:started"'),
			coreSrcRaw.indexOf("file capture/tracking is deliberately NOT"),
		);
		assert.match(listener, /getResidentSession/);
		assert.ok(
			!/getSession\(/.test(listener),
			"the async getSession must not be used here",
		);
	});

	it("every declared event is actually emitted somewhere", () => {
		// The mirror of the first test: a declared event nobody emits is the
		// same dead weight from the other end.
		for (const event of declaredToolEvents()) {
			assert.match(
				sessionManagerSrc,
				new RegExp(`emit\\(\\s*\\n?\\s*.*"${event}"`, "s"),
				`${event} is declared but never emitted`,
			);
		}
	});

	it("emits tool:started when a tool call begins", () => {
		const manager = new SessionManager({ storagePath: "/tmp/does-not-matter" });
		const seen = [];
		manager.on("tool:started", (data) => seen.push(data));

		// trackActivity(sessionId, log) -- two arguments, not one.
		manager.trackActivity("s1", {
			id: "l1",
			timestamp: new Date().toISOString(),
			level: "info",
			sessionId: "s1",
			hook: "PreToolUse",
			event: "PreToolUse",
			message: "",
			tool: "Bash",
			details: { cwd: "/w", tool_use_id: "tu-1" },
		});

		assert.equal(seen.length, 1);
		assert.equal(seen[0].sessionId, "s1");
		assert.equal(seen[0].execution.tool, "Bash");
		manager.stop?.();
	});

	it("REGRESSION: a reaped call emits tool:unknown, never tool:failed", () => {
		// 39 of 39 "failed" executions in the live store were false. The status
		// was corrected to "unknown"; the event still said failed, so a listener
		// acting on the name was told the opposite of the record.
		assert.match(
			sessionManagerSrc,
			/emit\("tool:unknown"/,
			"the reaper must emit tool:unknown",
		);
		const reaper = sessionManagerSrc.slice(
			sessionManagerSrc.indexOf("markAbandoned"),
		);
		const firstEmit = reaper.slice(0, reaper.indexOf("}") + 400);
		assert.ok(
			!/emit\("tool:failed"/.test(firstEmit),
			"the reaper must not claim failure",
		);
	});
});
