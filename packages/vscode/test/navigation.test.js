/**
 * Navigation shell.
 *
 * The sidebar replaced a flat tab bar. That is a markup change, but three things
 * depend on the markup in ways nothing else checks, and all three fail silently:
 *
 *   - router.js and main.js both select on `.tab` with `data-view`. Rename the
 *     class and every view becomes unreachable with no error.
 *   - api.js writes badge counts to `tab-logs-count` / `tab-changes-count` BY
 *     ELEMENT ID. Drop an id and the badge simply stops updating.
 *   - SessionsView.isVisible() gates polling on State.currentView === "sessions".
 *     Change that view's name and the Sessions tab quietly stops refreshing.
 *
 * These assert against the rendered HTML rather than the source, so they cover
 * what the webview actually receives.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readMedia } from "./harness.js";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

/**
 * Render the webview HTML with a stub `vscode` module.
 *
 * buildWebviewHtml only uses `webview.asWebviewUri`, `webview.cspSource` and
 * `vscode.Uri.joinPath`, so a small stub renders the real template.
 */
function renderHtml() {
	const source = readFileSync(join(srcDir, "webview-html.ts"), "utf8")
		.replace(/^import \* as vscode from "vscode";$/m, "")
		.replace(/:\s*string\[\]\[\]/g, "")
		.replace(/export function buildWebviewHtml\([\s\S]*?\): string \{/, "function buildWebviewHtml(webview, extensionUri) {")
		.replace(/function getNonce\(\): string \{/, "function getNonce() {")
		.replace(/let text = "";/, 'let text = "";')
		.replace(/const getUri = \(\.\.\.paths: string\[\]\) =>/, "const getUri = (...paths) =>");

	// Referenced by the eval'd template, not by this file directly - the import
	// is stripped above and this binding takes its place in the eval's scope.
	const vscode = {
		Uri: { joinPath: (_base, ...parts) => parts.join("/") },
	};
	void vscode;
	// biome-ignore lint/security/noGlobalEval: renders the real template with a stub
	return eval(`${source}; buildWebviewHtml`)(
		{ asWebviewUri: (p) => `vscode-resource:/${p}`, cspSource: "vscode-resource:" },
		"/ext",
	);
}

const html = renderHtml();

/** Every view name the nav offers. */
const navViews = [...html.matchAll(/data-view="([^"]+)"/g)].map((m) => m[1]);

describe("navigation markup", () => {
	it("keeps the class router.js and main.js select on", () => {
		// Both do document.querySelectorAll('.tab'). Grouping must not rename it.
		assert.ok(/class="tab[ "]/.test(html), "no .tab elements in the nav");
	});

	it("offers every view that has a panel", () => {
		const panels = [...html.matchAll(/id="view-([\w-]+)"/g)].map((m) => m[1]);
		const unreachable = panels.filter((p) => !navViews.includes(p));
		assert.deepEqual(unreachable, [], "these views have a panel but no way to reach them");
	});

	it("points at no view that has no panel", () => {
		// The other direction: an unbuilt view listed in the nav is a dead entry.
		const panels = [...html.matchAll(/id="view-([\w-]+)"/g)].map((m) => m[1]);
		const dangling = navViews.filter((v) => !panels.includes(v));
		assert.deepEqual(dangling, [], "nav points at a view with no panel");
	});

	it("keeps the badge element ids api.js writes to", () => {
		// api.js _updateTabBadge looks these up by id; losing one is silent.
		for (const id of ["tab-logs-count", "tab-changes-count"]) {
			assert.ok(html.includes(`id="${id}"`), `badge id ${id} is gone`);
		}
	});

	it("still names the sessions view exactly what the poller checks", () => {
		// SessionsView.isVisible() gates polling on this exact string.
		assert.ok(navViews.includes("sessions"), "the sessions view name changed");
		const sessionsSrc = readMedia("scripts/views/sessions.js");
		assert.match(sessionsSrc, /State\.currentView === "sessions"/);
	});

	it("groups the views rather than listing them flat", () => {
		const groups = [...html.matchAll(/class="nav-group-label"[^>]*>([^<]+)</g)].map((m) =>
			m[1].trim(),
		);
		assert.ok(groups.length >= 2, `expected groups, found ${JSON.stringify(groups)}`);
		assert.ok(groups.includes("Monitor"));
		assert.ok(groups.includes("Changes"));
	});

	it("keeps the tablist semantics a keyboard user depends on", () => {
		assert.match(html, /role="tablist"/);
		const tabs = html.match(/role="tab"/g) || [];
		assert.equal(tabs.length, navViews.length, "every nav item must be a tab");
		// Exactly one item is in the tab order; the rest are reached with arrows.
		const zero = html.match(/tabindex="0"/g) || [];
		assert.equal(zero.length, 1, "exactly one nav item should be tabbable");
	});

	it("marks exactly one view active on first render", () => {
		const selected = html.match(/aria-selected="true"/g) || [];
		assert.equal(selected.length, 1);
		const active = html.match(/class="view active"/g) || [];
		assert.equal(active.length, 1, "exactly one panel starts visible");
	});

	it("wraps the sidebar and main in a row container", () => {
		// Without app-body the sidebar stacks above the content and eats the panel.
		assert.match(html, /class="app-body"/);
		const open = (html.match(/<div class="app-body">/g) || []).length;
		assert.equal(open, 1);
	});
});

describe("navigation styles", () => {
	const nav = readMedia("styles/components/nav.css");

	it("is loaded from the manifest", () => {
		const manifest = readFileSync(join(srcDir, "webview-html.ts"), "utf8");
		assert.match(manifest, /\["styles", "components", "nav\.css"\]/);
	});

	it("styles the sidebar rather than the old horizontal bar", () => {
		assert.match(nav, /\.sidebar/);
		assert.match(nav, /\.app-body/);
		assert.match(nav, /\.nav-group/);
	});

	it("overrides the horizontal tab presentation it inherits", () => {
		// layout.css still styles .tab for the old bar and loads earlier, so the
		// sidebar rules must be specific enough to win.
		assert.match(nav, /\.sidebar \.tab/);
	});

	it("keeps the badge visible in a full-width row", () => {
		assert.match(nav, /\.sidebar \.tab-badge/);
	});

	it("collapses on a narrow panel instead of eating half of it", () => {
		assert.match(nav, /@media[^{]*max-width/);
	});
});
