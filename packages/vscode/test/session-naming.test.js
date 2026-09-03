/**
 * Session display names, shared between the Sessions and File Changes views.
 *
 * There were four independent derivations of "what is this session called" -
 * two in the Sessions view, one in File Changes, one in SessionManager. The
 * webview's now live in session-utils.js. These tests pin the behaviour File
 * Changes had before it delegated, because consolidating a helper is only safe
 * if the shared version is at least as forgiving as the callers it replaces -
 * which it was not: it dereferenced session.id unguarded and threw on a session
 * without one.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { installGlobals, loadSessionsView, readMedia } from "./harness.js";

/** Remove block and line comments so a check sees code, not prose. */
function stripComments(src) {
	return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Load the File Changes view.
 *
 * session-utils.js must load first: file-changes.js reads
 * window.SessionUtils at call time, so without it every name lookup throws.
 * panel.ts loads them in this order for the same reason.
 */
function loadFileChanges() {
	installGlobals();
	for (const relPath of ["scripts/session-utils.js", "scripts/views/file-changes.js"]) {
		// biome-ignore lint/security/noGlobalEval: classic script, see harness.js
		eval(readMedia(relPath));
	}
	return globalThis.window.FileChangesView;
}

describe("file changes session naming", () => {
	const FC = loadFileChanges();

	it("prefers the session name", () => {
		assert.equal(FC._getSessionName({ id: "abcdef123456", name: "proj" }), "proj");
	});

	it("falls back to the project name in metadata", () => {
		assert.equal(
			FC._getSessionName({ id: "abcdef123456", metadata: { projectName: "meta-proj" } }),
			"meta-proj",
		);
	});

	it("keeps the truncated-id fallback the local copy had", () => {
		assert.equal(FC._getSessionName({ id: "abcdef123456" }), "abcdef12...");
	});

	it("survives a session with no id at all", () => {
		// The shared helper dereferenced session.id unguarded, so delegating to
		// it made this case throw where the local copy had returned a label.
		assert.equal(FC._getSessionName({}), "Unknown Session");
	});

	it("now derives the folder name, which the local copy ignored", () => {
		assert.equal(
			FC._getSessionName({
				id: "abcdef123456",
				metadata: { workingDirectory: "/a/b/my-repo" },
			}),
			"my-repo",
		);
	});

	it("depends on session-utils being loaded first", () => {
		// A hard runtime dependency introduced by the consolidation: without
		// session-utils.js the name lookup throws rather than degrading.
		const src = readMedia("scripts/views/file-changes.js");
		assert.match(src, /window\.SessionUtils/);
	});

	it("has no local derivation left to drift", () => {
		const src = readMedia("scripts/views/file-changes.js");
		assert.match(src, /window\.SessionUtils\.getSessionDisplayInfo/);
		// Comments are stripped first: the code this replaced is described in a
		// comment there, and a check over raw text would match its own
		// explanation. Asserting over code only keeps the check honest and lets
		// comments mention what was removed.
		assert.ok(
			!/metadata\.cwd/.test(stripComments(src)),
			"metadata.cwd was a dead fallback - SessionManager writes workingDirectory",
		);
	});
});

describe("both views agree", () => {
	it("names the same session identically", () => {
		// The whole point of sharing the helper: a session should not be called
		// one thing in Sessions and another in File Changes.
		const FC = loadFileChanges();
		const V = loadSessionsView();
		for (const session of [
			{ id: "abcdef123456", name: "explicit" },
			{ id: "abcdef123456", metadata: { projectName: "from-meta" } },
			{ id: "abcdef123456", metadata: { workingDirectory: "/x/y/repo" } },
			{ id: "abcdef123456", projectName: "from-summary" },
		]) {
			assert.equal(
				FC._getSessionName(session),
				V.getSessionDisplayInfo(session).projectName,
				`disagreement for ${JSON.stringify(session)}`,
			);
		}
	});
});
