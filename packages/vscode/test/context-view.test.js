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
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { PAYLOADS } from "./fixtures/payloads.js";
import { apiSource } from "./api-sources.js";
import { installGlobals, readMedia } from "./harness.js";

const CONTEXT_LOAD_ORDER = [
	"scripts/views/context/memory-render.js",
	"scripts/views/context/injection-render.js",
	"scripts/views/context/handlers.js",
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

	it("says nothing for ANY success shape the backend actually returns", () => {
		// Driven by the generated fixtures, so this enumerates the real result
		// shapes rather than the three someone remembered. It used to list the
		// success keys and treat everything else as a refusal, so
		// memory.removeFromIndex -- which succeeds with `{changed:true}` and
		// names none of them -- reported "The action was refused." on its happy
		// path. Un-indexing is the reversible alternative offered next to
		// Delete, so the one safe action was the one that looked broken.
		const successes = ["written", "deleted", "indexed", "unindexed", "unindexNoop"];
		for (const key of successes) {
			assert.equal(
				view.renderRefusal(PAYLOADS.results[key]),
				"",
				`${key} is a success and must render nothing`,
			);
		}
	});

	it("renders every real failure shape", () => {
		for (const key of ["writeRefused", "deleteRefused", "indexRefused"]) {
			const html = view.renderRefusal(PAYLOADS.results[key]);
			assert.match(html, /ctx-notice-refused/, `${key} must render a refusal`);
			assert.ok(
				html.includes(PAYLOADS.results[key].reason),
				`${key} must show the backend's own words`,
			);
		}
	});

	it("says nothing about a shape it does not recognise", () => {
		// A result nobody anticipated must not become an assertion about it.
		// Guessing "refused" for an unknown shape is what produced the
		// un-index bug in the first place.
		assert.equal(view.renderRefusal({ somethingNew: true }), "");
	});

	it("falls back to a generic message when none was given", () => {
		// `written: false` with no reason still DECLARES failure, so it renders.
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

describe("context: cross-project search", () => {
	const { view } = loadContext();
	const projects = [
		{
			slug: "-Users-me-alpha",
			memoryDir: "/a",
			files: [
				file({ fileName: "auth.md", name: "auth-setup", description: "OAuth flow", body: "we used PKCE" }),
				file({ fileName: "misc.md", name: "misc", body: "nothing relevant" }),
			],
		},
		{
			slug: "-Users-me-beta",
			memoryDir: "/b",
			files: [file({ fileName: "notes.md", name: "notes", body: "the PKCE gotcha was the verifier" })],
		},
	];

	it("finds matches in a project you did not select", () => {
		// This is the whole reason the view exists: native memory is per-project,
		// so "where did I solve this before" has no answer from one folder.
		const hits = view.searchCorpus(projects, "pkce");
		assert.equal(hits.length, 2);
		assert.deepEqual([...new Set(hits.map((h) => h.project.memoryDir))].sort(), ["/a", "/b"]);
	});

	it("ranks a name or description match above a body match", () => {
		// A title hit is about the whole file; a body hit is about one passage.
		const hits = view.searchCorpus(projects, "auth");
		assert.equal(hits[0].where, "title");
	});

	it("ignores a query too short to be meaningful", () => {
		assert.deepEqual(view.searchCorpus(projects, "a"), []);
		assert.deepEqual(view.searchCorpus(projects, ""), []);
	});

	it("matches case-insensitively", () => {
		assert.equal(view.searchCorpus(projects, "OAUTH").length, 1);
	});

	it("names the project on every result", () => {
		const html = view.renderSearchResults(view.searchCorpus(projects, "pkce"), "pkce");
		assert.match(html, /ctx-result-project/);
		assert.match(html, /alpha/);
		assert.match(html, /beta/);
	});

	it("shows an excerpt around a body match so a hit is judgeable", () => {
		const excerpt = view.excerpt("the PKCE gotcha was the verifier", "pkce");
		assert.match(excerpt, /PKCE gotcha/);
	});

	it("prompts rather than showing an empty result for no query", () => {
		assert.match(view.renderSearchResults([], ""), /Search every project/);
	});
});

describe("context: editing", () => {
	const { view } = loadContext();
	const target = file({ body: "line one\nline two" });

	it("counts what will change before anything is written", () => {
		const summary = view.diffSummary("line one\nline two", "line one\nline CHANGED");
		assert.equal(summary.unchanged, 1);
		assert.ok(summary.added > 0);
		assert.ok(summary.removed > 0);
	});

	it("reports no change for an untouched draft", () => {
		const summary = view.diffSummary("same", "same");
		assert.equal(summary.added, 0);
		assert.equal(summary.removed, 0);
	});

	it("disables save until something actually changed", () => {
		const html = view.renderEditor(target, target.body);
		assert.match(html, /ctx-edit-save[^>]*disabled/);
		assert.match(html, /no changes/);
	});

	it("enables save and shows the line delta once edited", () => {
		const html = view.renderEditor(target, "line one\nline two\nline three");
		assert.ok(!/ctx-edit-save[^>]*disabled/.test(html), "save stayed disabled after an edit");
		assert.match(html, /\+\d+ \/ -\d+ lines/);
	});

	it("offers retype alongside the edit, so both are one write", () => {
		const html = view.renderEditor(file({ type: "reference" }), "x");
		assert.match(html, /ctx-type-select/);
		assert.match(html, /<option value="reference" selected>/);
	});

	it("preselects an inferred type rather than defaulting blindly", () => {
		const html = view.renderEditor(file({ inferredType: "feedback" }), "x");
		assert.match(html, /<option value="feedback" selected>/);
	});
});

describe("context: staged context", () => {
	const { view } = loadContext();

	it("says plainly when nothing is staged", () => {
		const html = view.renderStaged(null);
		assert.match(html, /Nothing staged/);
	});

	it("shows the exact text that will be injected", () => {
		// stageContext returns what the hook will emit, so preview and delivery
		// are the same artefact rather than two renderings of one intent.
		const html = view.renderStaged(PAYLOADS.stagedOk);
		assert.match(html, /Handled CRLF in the tokenizer/);
		assert.match(html, /used once/);
		assert.match(html, /ctx-clear-staged/);
	});

	it("never renders a staging REFUSAL as a successful stage", () => {
		// The refusal is `{staged:false, reason}` -- truthy, and previously
		// assigned straight to `staged`, so the success box was drawn over an
		// empty body with an invalid expiry and the reason was thrown away.
		// api.js now branches on the flag; this pins the renderer's half.
		const refusal = PAYLOADS.stagedRefusal;
		assert.equal(refusal.staged, false, "fixture is the refusal shape");
		assert.equal(refusal.text, undefined, "a refusal carries no text");

		const html = view.renderInjection(null, [], null, refusal.reason);
		assert.match(html, /no file changes and no tool executions/);
		assert.ok(!html.includes("Staged for the next session"), "drew a success box");
	});

	it("says the context lands on the NEXT session, not this one", () => {
		// Nothing in the panel makes that visible, and it is the one thing a
		// reasonable person would misread.
		const html = view.renderInjection(null, [], null);
		assert.match(html, /next session that starts/i);
	});

	it("escapes staged text rather than rendering it", () => {
		const html = view.renderStaged({ text: "<script>x</script>", expiresAt: "" });
		assert.ok(!html.includes("<script>"));
	});
});

describe("context: digest preview", () => {
	const { view } = loadContext();

	it("shows nothing before a digest is requested", () => {
		assert.equal(view.renderDigest(null), "");
	});

	it("previews the real digest body and offers to stage it", () => {
		// The fixture is what panel.ts actually forwards. The old version of
		// this test asserted `{sessionId, worthKeeping, text}` -- a shape the
		// backend has never produced -- which is why it stayed green while the
		// pane rendered an empty box for as long as it shipped.
		const html = view.renderDigest(PAYLOADS.digestPayload);
		assert.match(html, /make the parser handle CRLF/);
		assert.match(html, /ctx-stage-digest/);
	});

	it("renders nothing useful from the ENVELOPE, and says so", () => {
		// The precise regression: handed `{digest, written}` instead of the
		// digest, every field reads undefined. It must not look like an empty
		// session -- that ambiguity is what made this take three attempts to
		// diagnose.
		const html = view.renderDigest(PAYLOADS.digestEnvelope);
		assert.match(html, /payload-shape problem/);
		assert.ok(!html.includes("ctx-stage-digest"), "offered to stage an unusable digest");
	});

	it("carries a session id, so staging is reachable at all", () => {
		// B1: the stage handler guards on this. It was read off the envelope,
		// where it does not exist, so the button was a permanent no-op.
		assert.equal(typeof PAYLOADS.digestPayload.sessionId, "string");
		assert.ok(PAYLOADS.digestPayload.sessionId.length > 0);
	});

	it("reports a backend error instead of drawing an empty preview", () => {
		const html = view.renderDigest(PAYLOADS.digestError);
		assert.match(html, /No session nope/);
		assert.ok(!html.includes("ctx-stage-digest"));
	});

	it("explains a skip instead of showing an empty entry", () => {
		const html = view.renderDigest(PAYLOADS.emptyDigestPayload);
		assert.match(html, /no file changes and no tool executions/);
		assert.ok(!html.includes("ctx-stage-digest"), "offered to stage nothing");
	});

	it("has no write control anywhere in the preview", () => {
		// v1 previews only; the client cannot even express a write.
		const html = view.renderDigest(PAYLOADS.digestPayload);
		assert.ok(!/write/i.test(html), "a write affordance appeared in the preview");
	});
});

describe("context: what would load", () => {
	const { view } = loadContext();

	it("states affirmatively that a referenced file loads", () => {
		// A view that only flags failures never tells you the normal case works.
		const html = view.renderReachability(file({ indexState: "referenced" }));
		assert.match(html, /Loaded by name/);
	});

	it("stays silent where the orphan notice already explains it", () => {
		// Both unreachable states already carry a notice with the remedy;
		// repeating the diagnosis would be noise.
		assert.equal(view.renderReachability(file({ indexState: "unreferenced" })), "");
		assert.equal(view.renderReachability(file({ indexState: "no-index" })), "");
	});

	it("answers per file rather than by byte budget", () => {
		// The largest real index is 16 lines against a 200-line limit, so a budget
		// indicator would say "everything" for every project and always will.
		const detail = view.renderFileDetail(file({ indexState: "referenced" }), null);
		assert.match(detail, /ctx-reach/);
	});
});

describe("context: state changes actually re-render", () => {
	/**
	 * The failure this catches is the one that made Preview look broken: the
	 * request fired, the extension answered, the reply landed in state — and the
	 * subscription had no branch for it, so nothing repainted. Every layer was
	 * correct and the screen never changed.
	 *
	 * Asserted over the source because the wiring IS the behaviour here: a
	 * subscription that ignores a field is indistinguishable from one that
	 * handles it, right up until a user clicks.
	 */
	const src = readMedia("scripts/views/context.js");

	it("re-renders the injection pane when a digest arrives", () => {
		assert.match(src, /newVal\.digest !== oldVal\?\.digest/);
	});

	it("re-renders the injection pane when staged context changes", () => {
		assert.match(src, /newVal\.staged !== oldVal\?\.staged/);
	});

	it("re-renders when sessions arrive from their own slice", () => {
		// Sessions are owned by a different part of state and can load after this
		// view is open; without a subscription the list stays empty forever.
		assert.match(src, /State\.subscribe\("sessions"/);
	});

	it("has a render path for every field the injection pane reads", () => {
		// renderInjectionPane reads staged, sessions and digest. Each must have
		// something that triggers it, or that field is display-only-on-reload.
		for (const field of ["digest", "staged"]) {
			assert.ok(
				new RegExp(`newVal\\.${field} !== oldVal`).test(src),
				`${field} changes without re-rendering the pane`,
			);
		}
	});
});

describe("context: the index is reachable", () => {
	// renderIndex existed, was styled, and had five tests while being called
	// from nowhere and having no possible data source -- the backend read
	// MEMORY.md only to measure it and discarded the text. These pin the data
	// path that makes it real, because a renderer with no caller is the exact
	// shape of dead code that reads as covered.
	const { view } = loadContext();

	it("renderDetail shows the index when a project is selected but no file", () => {
		const src = readMedia("scripts/views/context.js");
		assert.match(
			src,
			/if \(!file && project\) \{[\s\S]*?this\.renderIndex\(/,
			"nothing calls renderIndex, so it is dead again",
		);
	});

	it("renders the index prose, not just its links", () => {
		const html = view.renderIndex(
			"# Memory\n\n## Notes\n\nSome prose a human wrote.\n\n- [A](a.md) — first\n",
			{ hasIndex: true, indexLines: 6, indexBytes: 70 },
		);
		assert.match(html, /Some prose a human wrote/, "prose was dropped");
		assert.match(html, /ctx-index-link/);
		assert.match(html, /data-file-name="a\.md"/);
	});

	it("says when it is showing only the slice Claude loads", () => {
		const truncated = view.renderIndex("# Memory\n", {
			hasIndex: true,
			indexLines: 900,
			indexBytes: 40000,
			indexTruncated: true,
		});
		assert.match(truncated, /the file continues past it/);

		const whole = view.renderIndex("# Memory\n", {
			hasIndex: true,
			indexLines: 6,
			indexBytes: 70,
		});
		assert.ok(!whole.includes("continues past it"));
	});

	it("uses the same load budget the protocol declares", () => {
		// Two copies of one constant is how a budget indicator starts lying, and
		// the webview cannot import from the protocol package.
		const protocolSrc = readFileSync(
			join(dirname(fileURLToPath(import.meta.url)), "..", "..", "protocol", "src", "memory.ts"),
			"utf8",
		);
		// Compared as NUMBERS, not as source text. Building a regex out of
		// "25 * 1024" makes the asterisk a quantifier, so a textual comparison
		// silently matches "25 1024" and passes whatever the values are -- a
		// vacuous guard, which is the thing this suite exists to not ship.
		const valueOf = (src, name) => {
			const m = new RegExp(`${name}\\s*=\\s*([0-9*\\s]+?);`).exec(src);
			if (!m) return null;
			return m[1]
				.split("*")
				.map((part) => Number(part.trim()))
				.reduce((a, b) => a * b, 1);
		};

		const viewSrc = readMedia("scripts/views/context/memory-render.js");
		for (const name of ["INDEX_LOAD_LINES", "INDEX_LOAD_BYTES"]) {
			const declared = valueOf(protocolSrc, `export const ${name}`);
			const used = valueOf(viewSrc, `const ${name}`);
			assert.ok(declared, `protocol no longer declares ${name}`);
			assert.equal(used, declared, `${name} drifted: view ${used}, protocol ${declared}`);
		}
	});
});

describe("context: retyping a file", () => {
	it("enables save on a type change with no body edit", () => {
		// The selector rendered and accepted a value, but save was gated purely
		// on the body diff -- so retyping alone could never be committed.
		const src = readMedia("scripts/views/context.js");
		assert.match(src, /ctx-type-select/, "no change handler for the selector");
		assert.match(
			src,
			/typeChanged/,
			"save is still gated on the body diff alone",
		);
		assert.match(
			src,
			/save\.disabled = !bodyChanged && !typeChanged/,
			"the save gate does not account for a retype",
		);
	});
});

describe("context: a staging refusal is not a staged context", () => {
	it("api.js branches on the flag rather than truthiness", () => {
		// B3's actual fix. The renderer half was tested; this half -- the one
		// that decides success from failure -- was not.
		const src = apiSource();
		assert.match(src, /payload\.staged === false/, "no explicit refusal branch");
		assert.match(
			src,
			/staged: refused \? null :/,
			"a refusal can still be stored as a staged context",
		);
		assert.match(src, /stageRefusal: refused \?/, "the reason is discarded");
	});
});
