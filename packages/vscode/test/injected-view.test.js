/**
 * "What was injected into this session" (P10).
 *
 * The direction matters more than anything else here. Every other Context
 * surface answers "where did this text go"; this one answers "what did this
 * session receive", and the two are not the same field. The plan is explicit:
 * do NOT derive it from `StagedContext.sourceSessionId`, which names the
 * session the text came FROM.
 *
 * Guarded:
 *
 * 1. **A reply for another session is stale, not empty.** Rendering it would
 *    attribute one session's deliveries to another — a confident wrong answer.
 * 2. **Pinned repeats are visible as repeats.** Arming happened once; the cost
 *    did not, and this is the only surface that can say so.
 * 3. **Unreadable log lines are reported, not hidden.** Shell scripts write it.
 * 4. **"I cannot tell" never renders as "there is none"** for the memory
 *    marker.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { installGlobals, readMedia } from "./harness.js";

function loadInjected(overrides = {}) {
	installGlobals(overrides);
	// biome-ignore lint/security/noGlobalEval: classic script, see harness.js
	eval(readMedia("scripts/views/sessions/injected-render.js"));
	return globalThis.window.InjectedRenderMixin;
}

const record = (over = {}) => ({
	at: "2026-09-01T10:00:00.000Z",
	sessionId: "s1",
	tier: "now",
	bytes: 400,
	...over,
});

/** A fake element, so rendering can be asserted without a DOM. */
function host() {
	return { innerHTML: "" };
}

describe("the records belong to the session on screen", () => {
	it("renders nothing when the reply is for a different session", () => {
		// A reply that arrives after the user selects another row must not be
		// drawn against it.
		const view = loadInjected({
			State: { injectionsView: { sessionId: "other", records: [record()] } },
		});
		const el = host();
		view.renderInjectedTab.call(view, el, { id: "s1" });
		assert.match(el.innerHTML, /Nothing was injected/);
		assert.ok(
			!/400/.test(el.innerHTML),
			"another session's delivery was shown",
		);
	});

	it("renders the records when they are this session's", () => {
		const view = loadInjected({
			State: { injectionsView: { sessionId: "s1", records: [record()] } },
		});
		const el = host();
		view.renderInjectedTab.call(view, el, { id: "s1" });
		assert.match(el.innerHTML, /Next prompt/);
		assert.match(el.innerHTML, /1 delivery/);
	});

	it("shows a loading state only for the session being loaded", () => {
		const view = loadInjected({
			State: {
				injectionsView: { sessionId: "s1", records: [], loading: true },
			},
		});
		const el = host();
		view.renderInjectedTab.call(view, el, { id: "s1" });
		assert.match(el.innerHTML, /Reading the delivery log/);

		const other = host();
		view.renderInjectedTab.call(view, other, { id: "elsewhere" });
		assert.ok(!/Reading the delivery log/.test(other.innerHTML));
	});
});

describe("what the log is for", () => {
	it("says when one pinned payload was delivered many times", () => {
		// Arming happened once. Three deliveries is three times the bytes, and
		// nothing else in the system reports that.
		const view = loadInjected({
			State: {
				injectionsView: {
					sessionId: "s1",
					records: [
						record({ tier: "pinned", at: "2026-09-01T10:00:00.000Z" }),
						record({ tier: "pinned", at: "2026-09-01T10:05:00.000Z" }),
						record({ tier: "pinned", at: "2026-09-01T10:09:00.000Z" }),
					],
				},
			},
		});
		const el = host();
		view.renderInjectedTab.call(view, el, { id: "s1" });
		assert.match(el.innerHTML, /3 of them from one pinned payload/);
		assert.match(el.innerHTML, /repeats on every prompt/);
	});

	it("does not call a single pinned delivery a repeat", () => {
		const view = loadInjected({
			State: {
				injectionsView: {
					sessionId: "s1",
					records: [record({ tier: "pinned" })],
				},
			},
		});
		const el = host();
		view.renderInjectedTab.call(view, el, { id: "s1" });
		assert.ok(!/of them from one pinned/.test(el.innerHTML));
	});

	it("names each tier and its consumption rule", () => {
		const view = loadInjected({
			State: {
				injectionsView: {
					sessionId: "s1",
					records: [
						record({ tier: "next-session" }),
						record({ tier: "now" }),
						record({ tier: "pinned" }),
					],
				},
			},
		});
		const el = host();
		view.renderInjectedTab.call(view, el, { id: "s1" });
		for (const label of ["At session start", "Next prompt", "Pinned"]) {
			assert.ok(el.innerHTML.includes(label), `${label} is not shown`);
		}
		assert.match(el.innerHTML, /one-shot, consumed at startup/);
	});

	it("reports lines it could not read rather than hiding them", () => {
		// Shell scripts write this file; a half-written line during a crash is a
		// real state, and silently showing fewer records would be a wrong count.
		const view = loadInjected({
			State: {
				injectionsView: {
					sessionId: "s1",
					records: [record()],
					unparseable: 2,
				},
			},
		});
		const el = host();
		view.renderInjectedTab.call(view, el, { id: "s1" });
		assert.match(el.innerHTML, /2 lines in the log could not be read/);
	});

	it("escapes a label", () => {
		const view = loadInjected({
			State: {
				injectionsView: {
					sessionId: "s1",
					records: [record({ label: "<img src=x onerror=1>" })],
				},
			},
		});
		const el = host();
		view.renderInjectedTab.call(view, el, { id: "s1" });
		assert.ok(!el.innerHTML.includes("<img"), "unescaped label");
	});
});

describe("the row markers", () => {
	it("marks a session that received something", () => {
		const view = loadInjected({
			State: { injectionsView: { counts: { s1: { count: 3, bytes: 1200 } } } },
		});
		assert.match(view.injectedMarker.call(view, "s1"), /3/);
	});

	it("says nothing about a session that received nothing", () => {
		// A zero against every row is noise, and the common case is zero.
		const view = loadInjected({ State: { injectionsView: { counts: {} } } });
		assert.equal(view.injectedMarker.call(view, "s1"), "");
	});

	it("marks a session that already has a memory file", () => {
		// Matched on the digest naming convention session-<date>-<first 8>.
		const view = loadInjected({
			State: {
				injectionsView: { counts: {} },
				contextView: {
					projects: [
						{
							files: [
								{
									name: "session-2026-09-01-abcdefgh",
									fileName: "session-2026-09-01-abcdefgh.md",
								},
							],
						},
					],
				},
			},
		});
		const marker = view.memoryMarker.call(view, {
			id: "abcdefgh-1111-2222-3333-444444444444",
			startTime: "2026-09-01T10:00:00.000Z",
		});
		assert.match(marker, /memory/);
	});

	it("says NOTHING when the memory corpus has not been loaded", () => {
		// "I cannot tell" and "there is none" are different claims. Before the
		// Context view has ever been opened, only the first one is true.
		const view = loadInjected({
			State: { injectionsView: { counts: {} }, contextView: { projects: [] } },
		});
		assert.equal(
			view.memoryMarker.call(view, {
				id: "abcdefgh-1111",
				startTime: "2026-09-01T10:00:00.000Z",
			}),
			"",
		);
	});

	it("does not mark a session whose digest is not in memory", () => {
		const view = loadInjected({
			State: {
				injectionsView: { counts: {} },
				contextView: { projects: [{ files: [{ name: "something-else" }] }] },
			},
		});
		assert.equal(
			view.memoryMarker.call(view, {
				id: "abcdefgh-1111",
				startTime: "2026-09-01T10:00:00.000Z",
			}),
			"",
		);
	});

	it("survives a session with no usable start time", () => {
		const view = loadInjected({
			State: {
				injectionsView: { counts: {} },
				contextView: { projects: [{ files: [{ name: "x" }] }] },
			},
		});
		assert.equal(
			view.memoryMarker.call(view, { id: "a", startTime: "not a date" }),
			"",
		);
	});
});
