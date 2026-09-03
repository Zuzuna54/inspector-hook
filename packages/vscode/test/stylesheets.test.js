/**
 * Stylesheet integrity.
 *
 * CSS fails silently: a lost rule, an unbalanced brace or a class that nothing
 * styles produces no error, just a view that looks subtly wrong. These checks
 * are the net for the split, and they are the same ones that previously caught
 * five unstyled states and a `var(--accent-bg)` with no fallback and no
 * definition, which silently unset the property it was on.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { readMedia } from "./harness.js";

const SESSION_MODULES = [
	"styles/views/sessions/list.css",
	"styles/views/sessions/feed.css",
	"styles/views/sessions/tool-detail.css",
	"styles/views/sessions/detail.css",
];

const COMPONENT_MODULES = [
	"styles/components/controls.css",
	"styles/components/data-display.css",
	"styles/components/feedback.css",
];

const VIEW_STYLESHEETS = [
	...SESSION_MODULES,
	...COMPONENT_MODULES,
	"styles/views/file-changes.css",
	"styles/views/history.css",
	"styles/views/archived.css",
	"styles/components.css",
];

/** Strip comments so checks see rules, not prose about rules. */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Remove at-rule blocks (@media, @keyframes) with their contents.
 *
 * Rules inside a @media legitimately re-declare a selector defined outside it -
 * that is what a responsive override is - so they must not count as duplicate
 * definitions. Brace-aware rather than regex, because these blocks nest.
 */
function stripAtRuleBlocks(css) {
	let out = "";
	for (let i = 0; i < css.length; i++) {
		if (css[i] !== "@") {
			out += css[i];
			continue;
		}
		const open = css.indexOf("{", i);
		if (open === -1) break;
		let depth = 0;
		let j = open;
		for (; j < css.length; j++) {
			if (css[j] === "{") depth++;
			else if (css[j] === "}" && --depth === 0) break;
		}
		i = j;
	}
	return out;
}

describe("stylesheet integrity", () => {
	for (const relPath of VIEW_STYLESHEETS) {
		it(`${relPath} has balanced braces`, () => {
			const css = readMedia(relPath);
			assert.equal(
				(css.match(/\{/g) || []).length,
				(css.match(/\}/g) || []).length,
				"unbalanced braces silently swallow every rule after the error",
			);
		});
	}

	it("every custom property used has a definition or a fallback", () => {
		// var(--x) with neither is invalid at computed-value time: the property
		// unsets rather than erroring, so the element just loses that style.
		const all = VIEW_STYLESHEETS.concat([
			"styles/variables.css",
			"styles/layout.css",
		])
			.map((p) => stripComments(readMedia(p)))
			.join("\n");

		const defined = new Set(
			[...all.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]),
		);
		const missing = new Set();
		for (const m of all.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
			const hasFallback = m[2] === ",";
			if (!hasFallback && !defined.has(m[1])) missing.add(m[1]);
		}
		assert.deepEqual(
			[...missing],
			[],
			"used with no definition and no fallback - the declaration is dropped",
		);
	});
});

describe("components.css split", () => {
	it("leaves the parent as a pointer, not a duplicate", () => {
		const parent = stripComments(readMedia("styles/components.css"));
		assert.ok(!parent.includes("{"), "components.css must hold no rules");
	});

	it("splits the rules across the three modules", () => {
		for (const relPath of COMPONENT_MODULES) {
			assert.ok(stripComments(readMedia(relPath)).includes("{"), relPath);
		}
	});

	it("keeps the button variants in exactly one component module", () => {
		// Buttons are the class most at risk: they are also redefined in two view
		// stylesheets today, so the component definition must at least be single
		// and unambiguous on its own side of the manifest.
		const owners = COMPONENT_MODULES.filter((p) =>
			/(?<![\w-])\.btn-secondary(?![\w-])[^{}]*\{/.test(stripComments(readMedia(p))),
		);
		assert.deepEqual(owners, ["styles/components/controls.css"]);
	});
});

describe("sessions.css split", () => {
	it("leaves the parent file as a pointer, not a duplicate", () => {
		// A parent still holding rules would mean the same selectors are defined
		// twice, with load order deciding which wins.
		const parent = stripComments(readMedia("styles/views/sessions.css"));
		assert.ok(!parent.includes("{"), "sessions.css must hold no rules");
	});

	it("splits the rules across the four modules", () => {
		for (const relPath of SESSION_MODULES) {
			const css = stripComments(readMedia(relPath));
			assert.ok(css.includes("{"), `${relPath} should carry rules`);
		}
	});

	it("keeps every module under the size the split exists to achieve", () => {
		for (const relPath of SESSION_MODULES) {
			const lines = readMedia(relPath).split("\n").length;
			assert.ok(lines < 600, `${relPath} is ${lines} lines`);
		}
	});

	it("defines no base selector in more than one session module", () => {
		// Two modules defining the same selector reinstates load-order dependence
		// inside the split itself. @media blocks are excluded: a responsive
		// override re-declaring a base selector is the point of one.
		const seen = new Map();
		const duplicated = [];
		for (const relPath of SESSION_MODULES) {
			for (const m of stripAtRuleBlocks(stripComments(readMedia(relPath))).matchAll(
				/([^{}]+)\{[^{}]*\}/g,
			)) {
				const sel = m[1].split("\n").pop().trim();
				if (!sel || sel.startsWith("@") || sel.includes("%")) continue;
				if (seen.has(sel) && seen.get(sel) !== relPath) {
					duplicated.push(`${sel} in ${seen.get(sel)} and ${relPath}`);
				}
				seen.set(sel, relPath);
			}
		}
		assert.deepEqual(duplicated, []);
	});
});
