/**
 * Virtual scrolling for large diffs.
 *
 * I previously recorded this module as untestable because "a stubbed DOM would
 * only test the stub". That was too broad, and this file is the correction.
 * Only ONE of the three methods is genuinely DOM-bound, and even there the
 * interesting part is arithmetic:
 *
 *   _renderScrollbarMarkers    pure — arrays and a number in, HTML out
 *   _renderVirtualScrollContent  returns HTML and sets two fields; no DOM read
 *   _initVirtualScroll         reads scrollTop/clientHeight, but the windowing
 *                              maths that decides WHICH lines render is real
 *                              logic and is what these assert
 *
 * The viewport below is a seam, not a stand-in for the browser: the assertions
 * are about which line indices the real code computes and writes, so a wrong
 * buffer or a wrong first index fails here. What is still NOT covered is
 * genuine layout — whether 20px per line matches what the browser lays out, and
 * whether the absolutely-positioned rows land where the scrollbar implies. That
 * needs a real panel and is stated rather than faked.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { HISTORY_LOAD_ORDER, existing, installGlobals, readMedia } from "./harness.js";

function loadHistory() {
	installGlobals();
	globalThis.requestAnimationFrame = (fn) => fn();
	for (const p of existing(HISTORY_LOAD_ORDER)) {
		// biome-ignore lint/security/noGlobalEval: classic script, see harness.js
		eval(readMedia(p));
	}
	return globalThis.window.HistoryView;
}

/** A viewport that reports a scroll position and captures what was written. */
function fakeViewport({ scrollTop = 0, clientHeight = 400 } = {}) {
	const content = { innerHTML: "" };
	const viewport = {
		scrollTop,
		clientHeight,
		querySelector: (sel) => (sel === ".hv-virtual-scroll-content" ? content : null),
		addEventListener: () => {},
	};
	return {
		content,
		viewport,
		container: {
			querySelector: (sel) => (sel === ".hv-virtual-scroll" ? viewport : null),
		},
	};
}

/** Line indices the rendered window contains, read back from the markup. */
function renderedLineNumbers(html) {
	return [...html.matchAll(/hv-line-num">(\d+)</g)].map((m) => Number(m[1]));
}

describe("scrollbar change markers", () => {
	const view = loadHistory();

	it("places a marker at the line's proportional position", () => {
		// Line 51 of 100 sits at (51-1)/100 = 50%.
        const html = view._renderScrollbarMarkers(new Set([51]), new Map(), 100);
		assert.match(html, /top: 50%/);
		assert.match(html, /hv-scrollbar-marker added/);
	});

	it("marks the first line at the top rather than off the top", () => {
		const html = view._renderScrollbarMarkers(new Set([1]), new Map(), 100);
		assert.match(html, /top: 0%/);
		assert.ok(!/top: -/.test(html), "a negative offset would sit outside the track");
	});

	it("distinguishes added from removed markers", () => {
		const html = view._renderScrollbarMarkers(
			new Set([10]),
			new Map([[20, ["gone"]]]),
			100,
		);
		assert.match(html, /hv-scrollbar-marker added/);
		assert.match(html, /hv-scrollbar-marker removed/);
	});

	it("reads removed markers by their key, not their position", () => {
		// removedMarkers is a Map keyed by line number, so forEach yields
		// (value, key). Taking the value would place every marker wrongly.
		const html = view._renderScrollbarMarkers(
			new Set(),
			new Map([[75, ["a", "b"]]]),
			100,
		);
		assert.match(html, /top: 74%/, "the key is the line number");
	});

	it("returns nothing for an empty file rather than dividing by zero", () => {
		assert.equal(view._renderScrollbarMarkers(new Set([1]), new Map(), 0), "");
	});

	it("returns an empty track when there is nothing to mark", () => {
		const html = view._renderScrollbarMarkers(new Set(), new Map(), 100);
		assert.match(html, /hv-scrollbar-markers/);
		assert.ok(!html.includes("hv-scrollbar-marker "), "no markers expected");
	});
});

describe("virtual scroll container", () => {
	const view = loadHistory();

	it("sizes the spacer to the whole document, not the window", () => {
		// The wrapper's height is what gives the scrollbar its correct length;
		// sizing it to the visible window would make a 5000-line diff look short.
		const html = view._renderVirtualScrollContent(new Array(1000).fill("x"), "js");
		assert.match(html, new RegExp(`height: ${1000 * view._LINE_HEIGHT}px`));
	});

	it("stashes the lines for the scroll handler to read", () => {
		const lines = ["a", "b", "c"];
		view._renderVirtualScrollContent(lines, "ts");
		assert.equal(view._virtualScrollLines, lines);
		assert.equal(view._virtualScrollLanguage, "ts");
	});
});

describe("virtual scroll windowing", () => {
	const view = loadHistory();
	const LINES = 5000;
	const lines = Array.from({ length: LINES }, (_, i) => `line ${i + 1}`);

	function windowAt(scrollTop, clientHeight = 400) {
		view._renderVirtualScrollContent(lines, "plaintext");
		const { container, content } = fakeViewport({ scrollTop, clientHeight });
		view._initVirtualScroll(container);
		return renderedLineNumbers(content.innerHTML);
	}

	it("renders only a window, not the whole document", () => {
		const shown = windowAt(0);
		assert.ok(shown.length < LINES, "the whole file was rendered");
		assert.ok(shown.length > 0, "nothing was rendered");
	});

	it("starts at the top when unscrolled", () => {
		assert.equal(windowAt(0)[0], 1);
	});

	it("does not run off the start when scrolled near the top", () => {
		// startLine is clamped at 0; without the clamp the buffer would produce a
		// negative index and the first lines would vanish.
		assert.equal(windowAt(view._LINE_HEIGHT * 5)[0], 1);
	});

	it("moves the window down as the viewport scrolls", () => {
		const top = windowAt(0);
		const middle = windowAt(view._LINE_HEIGHT * 2000);
		assert.ok(middle[0] > top[0], "the window did not advance");
		assert.ok(middle[0] > 1900 && middle[0] < 2001, `unexpected start ${middle[0]}`);
	});

	it("keeps a buffer above and below the visible area", () => {
		const scrollTop = view._LINE_HEIGHT * 2000;
		const shown = windowAt(scrollTop, 400);
		const firstVisible = 2001; // scrollTop / LINE_HEIGHT, 1-based
		assert.equal(
			firstVisible - shown[0],
			view._BUFFER_SIZE,
			"the buffer above is not BUFFER_SIZE lines",
		);
		const lastVisible = firstVisible + 400 / view._LINE_HEIGHT - 1;
		assert.ok(
			shown[shown.length - 1] >= lastVisible + view._BUFFER_SIZE,
			"the buffer below is short",
		);
	});

	it("does not run past the end when scrolled to the bottom", () => {
		const shown = windowAt(view._LINE_HEIGHT * (LINES - 10));
		assert.equal(shown[shown.length - 1], LINES, "the last line is not rendered");
		assert.ok(Math.max(...shown) <= LINES, "rendered a line beyond the end");
	});

	it("renders a short document whole", () => {
		view._renderVirtualScrollContent(["a", "b", "c"], "plaintext");
		const { container, content } = fakeViewport({ scrollTop: 0 });
		view._initVirtualScroll(container);
		assert.deepEqual(renderedLineNumbers(content.innerHTML), [1, 2, 3]);
	});

	it("positions each row at its own offset", () => {
		view._renderVirtualScrollContent(lines, "plaintext");
		const { container, content } = fakeViewport({ scrollTop: 0 });
		view._initVirtualScroll(container);
		assert.match(content.innerHTML, /top: 0px/);
		assert.match(content.innerHTML, new RegExp(`top: ${view._LINE_HEIGHT}px`));
	});

	it("escapes line content", () => {
		view._renderVirtualScrollContent(["<script>alert(1)</script>"], "plaintext");
		const { container, content } = fakeViewport({ scrollTop: 0 });
		view._initVirtualScroll(container);
		assert.ok(!content.innerHTML.includes("<script>"), "content was not escaped");
	});

	it("does nothing when the viewport is absent", () => {
		view._renderVirtualScrollContent(lines, "plaintext");
		assert.doesNotThrow(() => view._initVirtualScroll({ querySelector: () => null }));
	});

	it("does nothing when no lines were stashed", () => {
		view._virtualScrollLines = null;
		const { container } = fakeViewport();
		assert.doesNotThrow(() => view._initVirtualScroll(container));
	});
});
