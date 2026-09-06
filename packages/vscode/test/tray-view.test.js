/**
 * The context tray view.
 *
 * Every byte figure rendered here comes from the CORE's preview. That is the
 * property worth guarding: the moment the panel computes its own idea of "what
 * would be injected", it can disagree with what actually is — which is the
 * whole class of bug the tray was designed around, and the one the single-item
 * staging path spent three attempts failing to make visible.
 *
 * Fixtures are shaped like the real IPC payloads: `{ ok, tray, preview }` from
 * the mutating methods, and a refusal as `{ ok:false, reason }` with no tray.
 * A refusal is a DIFFERENT shape from a success, and treating it as one is
 * precisely what made a failed stage render as a success box.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { installGlobals, readMedia } from "./harness.js";

const TRAY_LOAD_ORDER = ["scripts/tray/tray-render.js", "scripts/tray/tray-host.js"];

function loadTray(overrides = {}) {
	const registered = {};
	installGlobals(overrides);
	globalThis.Router = { register: (name, view) => (registered[name] = view) };
	for (const relPath of TRAY_LOAD_ORDER) {
		// biome-ignore lint/security/noGlobalEval: classic script, see harness.js
		eval(readMedia(relPath));
	}
	return registered.tray;
}

const item = (over = {}) => ({
	id: "i1",
	kind: "free_text",
	title: "a note",
	originalText: "hello",
	include: true,
	source: {},
	addedAt: "2026-09-05T10:00:00.000Z",
	bytes: 5,
	...over,
});

const preview = (over = {}) => ({
	text: "### a note\n\nhello",
	bytes: 17,
	truncated: false,
	warnThresholdExceeded: false,
	items: [{ itemId: "i1", title: "a note", bytes: 5, included: true, truncated: false }],
	redactions: { total: 0, byName: [] },
	...over,
});

describe("tray rendering", () => {
	const view = loadTray();

	it("registers with the router", () => {
		// Built as a route FIRST, deliberately: if the panel is docked to VS
		// Code's narrow sidebar there is no room for a rail, and the tray has to
		// work either way.
		assert.ok(view, 'Router.register("tray", ...) did not run');
	});

	it("says plainly when nothing is staged", () => {
		const html = view.renderTray({ items: [] }, preview({ bytes: 0 }), null, null, "");
		assert.match(html, /Nothing staged/);
		assert.ok(!html.includes("tray-stage"), "offered to stage an empty tray");
	});

	it("shows the core's byte total, not one it computed", () => {
		// 9999 is not derivable from the item, so a rendered 9999 can only have
		// come from the preview.
		const html = view.renderTray(
			{ items: [item()] },
			preview({ bytes: 9999 }),
			null,
			null,
			"",
		);
		assert.match(html, /9\.8 KB/, "the byte total was not taken from the preview");
	});

	it("counts included items against the total", () => {
		const html = view.renderTray(
			{ items: [item(), item({ id: "i2", include: false })] },
			preview(),
			null,
			null,
			"",
		);
		assert.match(html, /1 of 2 items/);
	});

	it("warns past the advisory threshold without hiding the stage button", () => {
		const html = view.renderTray(
			{ items: [item()] },
			preview({ warnThresholdExceeded: true, bytes: 40000 }),
			null,
			null,
			"",
		);
		assert.match(html, /most of a context window/);
		assert.match(html, /tray-stage/, "warning must not remove the affordance");
	});

	it("names what was redacted, not just how much", () => {
		// "3 secrets removed" is only actionable if you can tell whether one was
		// a false positive in your own text.
		const html = view.renderTray(
			{ items: [item()] },
			preview({ redactions: { total: 2, byName: [{ name: "github-token", count: 2 }] } }),
			null,
			null,
			"",
		);
		assert.match(html, /2 redacted/);
		assert.match(html, /github-token ×2/);
	});

	it("marks an edited item and offers to revert it", () => {
		const html = view.renderTray(
			{ items: [item({ editedText: "changed" })] },
			preview(),
			null,
			null,
			"",
		);
		assert.match(html, /tray-item-edited/);
		assert.match(html, /tray-reset/);
	});

	it("offers no revert on an unedited item", () => {
		const html = view.renderTray({ items: [item()] }, preview(), null, null, "");
		assert.ok(!html.includes("tray-reset"));
	});

	it("dims an excluded item rather than removing it", () => {
		const html = view.renderTray(
			{ items: [item({ include: false })] },
			preview(),
			null,
			null,
			"",
		);
		assert.match(html, /tray-item excluded/);
		assert.match(html, /a note/, "an excluded item must still be listed");
	});

	it("disables Up on the first item and Down on the last", () => {
		const html = view.renderTray(
			{ items: [item(), item({ id: "i2" })] },
			preview(),
			null,
			null,
			"",
		);
		const rows = html.split("tray-item-actions");
		assert.match(rows[1], /tray-up" disabled/);
		assert.match(rows[2], /tray-down" disabled/);
	});

	it("renders a refusal in the core's own words", () => {
		const html = view.renderTray(
			{ items: [] },
			preview(),
			"That item is 70 KB, over the 64 KB per-item limit.",
			null,
			"",
		);
		assert.match(html, /over the 64 KB per-item limit/);
	});

	it("says WHEN each tier lands, which is the only thing separating them", () => {
		// The wording moved when the tiers were added: it used to be one line
		// about the next session, and is now one line per tier. The intent is
		// unchanged -- a reader must not have to discover the timing by being
		// surprised by it.
		const html = view.renderTray({ items: [item()] }, preview(), null, null, "");
		assert.match(html, /new session starts/i);
		assert.match(html, /already running/i);
		assert.match(html, /every<\/strong> prompt/i);
	});

	it("escapes item text rather than rendering it", () => {
		const html = view.renderTray(
			{ items: [item({ title: "<img src=x>", originalText: "<script>x</script>" })] },
			preview(),
			null,
			"i1",
			"<script>x</script>",
		);
		assert.ok(!html.includes("<script>"), "item text was rendered as markup");
		assert.ok(!html.includes("<img src=x>"), "a title was rendered as markup");
	});

	it("seeds the editor from the edit, falling back to the original", () => {
		const edited = view.renderTray(
			{ items: [item({ editedText: "my version" })] },
			preview(),
			null,
			"i1",
			null,
		);
		assert.match(edited, /my version/);

		const fresh = view.renderTray({ items: [item()] }, preview(), null, "i1", null);
		assert.match(fresh, /hello/);
	});
});

describe("staging sends the preview, not a re-render", () => {
	it("posts the preview text verbatim", () => {
		// Re-rendering here would put a second templating step between preview
		// and delivery, which is the one thing this path exists to avoid.
		const sent = [];
		const view = loadTray({
			API: {
				contextGetTray() {},
				memoryStageContext(params) {
					sent.push(params);
				},
			},
			State: {
				contextTray: { tray: { items: [item()] }, preview: preview(), lastRefusal: null, editing: null, draft: "" },
			},
		});
		view.stage();
		assert.equal(sent.length, 1, "nothing was staged");
		assert.equal(sent[0].text, preview().text, "the staged text was not the preview's");
	});

	it("stages nothing when the preview is empty", () => {
		const sent = [];
		const view = loadTray({
			API: { contextGetTray() {}, memoryStageContext: (p) => sent.push(p) },
			State: { contextTray: { tray: { items: [] }, preview: preview({ text: "", bytes: 0 }), lastRefusal: null, editing: null, draft: "" } },
		});
		view.stage();
		assert.deepEqual(sent, []);
	});
});

describe("the three tiers", () => {
	const view = loadTray();
	const targets = [
		{ sessionId: "sess-1", projectName: "inspector-hook", ageMs: 120000, armed: {} },
		{ sessionId: "sess-2", projectName: "other", ageMs: 7200000, armed: { pinned: true } },
	];

	it("offers all three, and says WHEN each arrives", () => {
		// The tiers differ only in timing, so the timing is the thing that has
		// to be on screen. "next session" vs "next prompt" is the difference
		// between needing a restart and not.
		const html = view.renderTray({ items: [item()] }, preview(), null, null, "", targets, "sess-1", null);
		assert.match(html, /tray-stage/);
		assert.match(html, /tray-arm-now/);
		assert.match(html, /tray-arm-pinned/);
		assert.match(html, /new session starts/i);
		assert.match(html, /already running/i);
	});

	it("says a pin repeats on EVERY prompt, and that it expires", () => {
		// Pinning deliberately breaks the one-shot guarantee. If the UI does not
		// say so, the cost is invisible until it is large.
		const html = view.renderTray({ items: [item()] }, preview(), null, null, "", targets, "sess-1", null);
		assert.match(html, /every<\/strong> prompt/i);
		assert.match(html, /24 hours/);
	});

	it("disables the running-session tiers until a target is chosen", () => {
		// Without a target, "send to this session" has no session.
		const noTarget = view.renderTray({ items: [item()] }, preview(), null, null, "", targets, null, null);
		assert.match(noTarget, /tray-arm-now" disabled/);
		assert.match(noTarget, /tray-arm-pinned" disabled/);
		// Next-session needs no target, so it stays available.
		assert.ok(!/tray-stage" disabled/.test(noTarget));
	});

	it("shows each target's age rather than a live/dead badge", () => {
		// There is no heartbeat and status decays on a timer, so a confident
		// "live" label would be an assertion nothing can support.
		const html = view.renderTray({ items: [item()] }, preview(), null, null, "", targets, "sess-1", null);
		assert.match(html, /2m ago/);
		assert.match(html, /2h ago/);
		assert.ok(!/\blive\b/i.test(html), "claimed liveness it cannot know");
	});

	it("says so when there is nothing to send to", () => {
		const html = view.renderTray({ items: [item()] }, preview(), null, null, "", [], null, null);
		assert.match(html, /nothing running to send to/i);
	});

	it("states what a pin has actually cost, not just its size", () => {
		// Pinned bytes are paid on every prompt. Showing only the payload size
		// would describe a recurring charge as a one-off.
		const html = view.renderTray({ items: [item()] }, preview(), null, null, "", targets, "sess-1", {
			pinned: { bytes: 1024, deliveries: 12, estimatedRepeatBytes: 12288, expiresAt: "2026-09-07T10:00:00.000Z" },
		});
		assert.match(html, /12 prompts/);
		assert.match(html, /12\.0 KB<\/strong> so far/);
		assert.match(html, /tray-disarm/);
	});

	it("offers to cancel a one-shot and to unpin a pin", () => {
		const html = view.renderTray({ items: [item()] }, preview(), null, null, "", targets, "sess-1", {
			now: { bytes: 100 },
			pinned: { bytes: 100, deliveries: 1, estimatedRepeatBytes: 100, expiresAt: "" },
		});
		assert.match(html, /data-tier="now"/);
		assert.match(html, /data-tier="pinned"/);
		assert.match(html, /Unpin/);
	});
});

describe("arming sends the tier and target, and nothing else", () => {
	it("posts the chosen tier for the chosen session", () => {
		const sent = [];
		const view = loadTray({
			API: { contextGetTray() {}, contextGetTargets() {}, contextArm: (p) => sent.push(p) },
			State: {
				contextTray: {
					tray: { items: [item()] }, preview: preview(), lastRefusal: null,
					editing: null, draft: "", targets: [], targetSessionId: "sess-1", armed: null,
				},
			},
		});
		view.arm("pinned");
		assert.deepEqual(sent, [{ tier: "pinned", targetSessionId: "sess-1", label: "Context tray" }]);
	});

	it("sends no TEXT: the core re-renders from the tray it holds", () => {
		// One renderer. Passing text from here would be a second path that could
		// drift from the preview, which is the failure the whole design avoids.
		const sent = [];
		const view = loadTray({
			API: { contextGetTray() {}, contextGetTargets() {}, contextArm: (p) => sent.push(p) },
			State: {
				contextTray: {
					tray: { items: [item()] }, preview: preview(), lastRefusal: null,
					editing: null, draft: "", targets: [], targetSessionId: "sess-1", armed: null,
				},
			},
		});
		view.arm("now");
		assert.equal(sent[0].text, undefined, "text was sent, creating a second render path");
	});

	it("arms nothing without a target", () => {
		const sent = [];
		const view = loadTray({
			API: { contextGetTray() {}, contextGetTargets() {}, contextArm: (p) => sent.push(p) },
			State: {
				contextTray: {
					tray: { items: [item()] }, preview: preview(), lastRefusal: null,
					editing: null, draft: "", targets: [], targetSessionId: null, armed: null,
				},
			},
		});
		view.arm("now");
		assert.deepEqual(sent, []);
	});
});
