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

	it("says the context lands on the NEXT session", () => {
		const html = view.renderTray({ items: [item()] }, preview(), null, null, "");
		assert.match(html, /next session that starts/i);
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
