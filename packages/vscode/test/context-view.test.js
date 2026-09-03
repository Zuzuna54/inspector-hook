/**
 * Context view — native auto memory.
 *
 * Fixtures are shaped from the real corpus on this machine rather than invented,
 * because the three shapes that matter are exactly the ones a made-up fixture
 * would miss:
 *
 *   - one file with NO frontmatter at all (1 of 33)
 *   - files with no declared type, only one inferable from the file name
 *     (6 of 33) — a count of "typed" must not silently include those guesses
 *   - a MEMORY.md that is a hybrid document: index links interleaved with
 *     headings and free-form prose that is content in its own right
 *
 * Plus the case that motivates the whole view: an orphaned file, and the
 * distinction between "the index does not name it" and "there is no index".
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { installGlobals, readMedia } from "./harness.js";

const CONTEXT_LOAD_ORDER = [
	"scripts/views/context/memory-render.js",
	"scripts/views/context/curation.js",
	"scripts/views/context.js",
];

function loadContext(overrides = {}) {
	const sent = [];
	installGlobals({
		API: {
			memoryGetProjects: (p) => sent.push({ getProjects: p }),
			memoryAddToIndex: (p) => sent.push({ addToIndex: p }),
			memoryRemoveFromIndex: (p) => sent.push({ removeFromIndex: p }),
			memoryWrite: (p) => sent.push({ write: p }),
			memoryDelete: (p) => sent.push({ delete: p }),
		},
		...overrides,
	});
	globalThis.State.contextView = {
		projects: [],
		selectedProject: null,
		selectedFile: null,
		showEmpty: false,
		lastResult: null,
	};
	for (const p of CONTEXT_LOAD_ORDER) {
		// biome-ignore lint/security/noGlobalEval: classic script, see harness.js
		eval(readMedia(p));
	}
	return { view: globalThis.window.ContextView, sent };
}

/** A file as readMemoryProject returns it. */
const file = (over = {}) => ({
	path: "/m/a.md",
	fileName: "a.md",
	name: "a",
	body: "body",
	hasFrontmatter: true,
	size: 1024,
	modified: "2026-09-03T12:00:00.000Z",
	orphaned: false,
	indexState: "referenced",
	...over,
});

describe("context: type badges", () => {
	const { view } = loadContext();

	it("shows a declared type plainly", () => {
		const html = view.renderTypeBadge(file({ type: "reference" }));
		assert.match(html, /reference/);
		assert.ok(!html.includes("inferred"), "a declared type is not a guess");
	});

	it("marks an inferred type as inferred", () => {
		// 6 of 33 real files declare no type but imply one by file name. Showing
		// that as declared would mislead anyone about to edit the frontmatter.
		const html = view.renderTypeBadge(file({ inferredType: "feedback" }));
		assert.match(html, /feedback/);
		assert.match(html, /\(inferred\)/);
	});

	it("says untyped rather than guessing", () => {
		const html = view.renderTypeBadge(file());
		assert.match(html, /\(untyped\)/);
		for (const t of ["project", "reference", "feedback", "user"]) {
			assert.ok(!html.includes(`>${t}<`), `invented a type: ${t}`);
		}
	});

	it("prefers the declared type over an inference", () => {
		const html = view.renderTypeBadge(file({ type: "user", inferredType: "project" }));
		assert.match(html, /user/);
		assert.ok(!html.includes("inferred"));
	});
});

describe("context: orphans", () => {
	const { view } = loadContext();

	it("says nothing for a referenced file", () => {
		assert.equal(view.renderOrphanNotice(file()), "");
	});

	it("offers a one-click fix when the index simply omits it", () => {
		const html = view.renderOrphanNotice(
			file({ orphaned: true, indexState: "unreferenced" }),
		);
		assert.match(html, /ctx-add-to-index/);
		assert.match(html, /never\s+loaded by name/);
	});

	it("offers to create the index when there is none", () => {
		// Every file in an index-less project reports as orphaned. Telling someone
		// to index thirty files one at a time is noise; the remedy is an index.
		const html = view.renderOrphanNotice(
			file({ orphaned: true, indexState: "no-index" }),
		);
		assert.match(html, /ctx-create-index/);
		assert.ok(!html.includes("ctx-add-to-index"), "wrong remedy for no-index");
		assert.match(html, /not just this file/);
	});
});

describe("context: authorship", () => {
	const { view } = loadContext();

	it("marks a file the tool wrote as generated", () => {
		assert.match(view.renderAuthorship(file({ source: "inspector-hook" })), /generated/);
	});

	it("marks a hand-written file as yours", () => {
		// Every file in the real corpus is this case, and nothing regenerates it.
		const html = view.renderAuthorship(file());
		assert.match(html, /yours/);
		assert.match(html, /Nothing regenerates/i);
	});
});

describe("context: provenance", () => {
	const { view } = loadContext();
	const withOrigin = file({ rawFrontmatter: "originSessionId: abc123def456" });

	it("links to the origin session when it is still held", () => {
		const html = view.renderOriginLine(withOrigin, { id: "abc123def456", name: "ordex" });
		assert.match(html, /ctx-origin-link/);
		assert.match(html, /ordex/);
	});

	it("states the origin without a link when the session is gone", () => {
		// The normal case: retention deletes sessions while memory persists, so
		// most origin ids no longer resolve. Saying so beats a dead link, and
		// beats hiding it — "where did this come from" still has a true answer.
		const html = view.renderOriginLine(withOrigin, null);
		assert.ok(!html.includes("ctx-origin-link"), "offered navigation to nothing");
		assert.match(html, /no longer retained/);
	});

	it("says nothing when the file records no origin", () => {
		assert.equal(view.renderOriginLine(file(), null), "");
	});
});

describe("context: body rendering", () => {
	const { view } = loadContext();

	it("turns wiki-links into navigation", () => {
		const html = view.renderBody("see [[ordex-project]] for the stack");
		assert.match(html, /ctx-wikilink/);
		assert.match(html, /data-link="ordex-project"/);
	});

	it("escapes the rest of the body", () => {
		const html = view.renderBody("<script>alert(1)</script>");
		assert.ok(!html.includes("<script>"));
	});

	it("leaves a body with no links alone", () => {
		assert.equal(view.renderBody("plain text"), "plain text");
	});
});

describe("context: the index is a document", () => {
	const { view } = loadContext();
	// Shaped from the real hybrid index: links, a heading, and prose bullets that
	// are content rather than pointers.
	const hybrid = [
		"# Memory",
		"",
		"- [No shortcuts](feedback_no_shortcuts.md) — follow research then plan",
		"",
		"## Tailwind 4 CSS Cascade Gotcha",
		"- Tailwind 4 generates an un-layered rule",
		"- Un-layered CSS beats ALL @layer rules",
	].join("\n");

	const project = { hasIndex: true, indexLines: 7, indexBytes: 240 };

	it("keeps the prose that is not an index entry", () => {
		// Rendering the index as a list of links would silently drop this.
		const html = view.renderIndex(hybrid, project);
		assert.match(html, /Tailwind 4 CSS Cascade Gotcha/);
		assert.match(html, /Un-layered CSS beats ALL/);
	});

	it("makes the entries that are links navigable", () => {
		const html = view.renderIndex(hybrid, project);
		assert.match(html, /ctx-index-link/);
		assert.match(html, /data-file-name="feedback_no_shortcuts\.md"/);
	});

	it("says so when a project has no index", () => {
		const html = view.renderIndex("", { hasIndex: false });
		assert.match(html, /No <code>MEMORY\.md<\/code>/);
	});

	it("reports the index budget without crying wolf", () => {
		// The largest real index is 16 lines against a 200-line budget.
		const html = view.renderIndexBudget(project);
		assert.match(html, /7 lines/);
		assert.ok(!html.includes("ctx-budget-over"), "warned when nowhere near the limit");
	});

	it("warns once the tail actually stops being read", () => {
		const html = view.renderIndexBudget({ indexLines: 250, indexBytes: 30000 });
		assert.match(html, /ctx-budget-over/);
	});
});

describe("context: refusals", () => {
	const { view } = loadContext();

	it("renders the backend's own words", () => {
		// The reasons name the file and the cause; a paraphrase loses exactly what
		// makes them actionable.
		const reason =
			"a.md exists and was not written by Inspector Hook (no metadata.source), so it is left untouched.";
		const html = view.renderRefusal({ written: false, refused: "not-authored-by-us", reason });
		assert.ok(html.includes("not written by Inspector Hook"));
		assert.ok(html.includes("metadata.source"));
	});

	it("says nothing when the action succeeded", () => {
		assert.equal(view.renderRefusal({ written: true }), "");
		assert.equal(view.renderRefusal({ deleted: true }), "");
		assert.equal(view.renderRefusal({ indexed: true }), "");
	});

	it("falls back to a generic message when none was given", () => {
		assert.match(view.renderRefusal({ written: false }), /refused/i);
	});
});

describe("context: curation actions", () => {
	function withProject(over = {}) {
		const ctx = loadContext();
		const project = {
			slug: "-Users-me-proj",
			memoryDir: "/m",
			hasIndex: true,
			totalSize: 100,
			indexLines: 4,
			indexBytes: 100,
			files: [file(), file({ fileName: "b.md", name: "b", orphaned: true, indexState: "unreferenced" })],
			...over,
		};
		globalThis.State.contextView = {
			projects: [project],
			selectedProject: "/m",
			selectedFile: null,
			showEmpty: false,
			lastResult: null,
		};
		return ctx;
	}

	it("indexes one file without touching it", () => {
		const { view, sent } = withProject();
		view.addToIndex("b.md");
		assert.deepEqual(sent, [{ addToIndex: { memoryDir: "/m", fileName: "b.md" } }]);
	});

	it("creating an index covers every file in the project", () => {
		const { view, sent } = withProject({ hasIndex: false });
		view.createIndex();
		assert.equal(sent.length, 2, "one call per file");
	});

	it("sets userInitiated on an explicit save, which is what allows it at all", () => {
		// The backend refuses a write to a file it did not author unless this is
		// set, and nothing automated may set it.
		const { view, sent } = withProject();
		view.saveEdit(file({ name: "a", type: "project" }), "new body");
		assert.equal(sent[0].write.userInitiated, true);
		assert.equal(sent[0].write.body, "new body");
	});

	it("does nothing without a selected project", () => {
		const { view, sent } = loadContext();
		view.addToIndex("b.md");
		view.createIndex();
		assert.deepEqual(sent, []);
	});
});

describe("context: destructive paths are guarded", () => {
	const src = readMedia("scripts/views/context/curation.js");

	it("requires the file name typed back before deleting", () => {
		// force is required for anything hand-written, which is everything in a
		// real corpus, and nothing regenerates those files.
		assert.match(src, /ctx-delete-confirm/);
		assert.match(src, /confirm\.disabled = input\.value\.trim\(\) !== file\.fileName/);
	});

	it("offers un-indexing as the reversible alternative", () => {
		assert.match(src, /ctx-unindex-instead/);
	});

	it("sets userInitiated in exactly one place", () => {
		// It exists to let a person edit their own note. Anywhere else it would
		// be an automated pass claiming to be a person.
		const occurrences = (src.match(/userInitiated:\s*true/g) || []).length;
		assert.equal(occurrences, 1);
	});
});
