/**
 * The webview <-> extension message contract.
 *
 * Three layers have to agree and nothing type-checks across them: api.js posts a
 * command string, panel.ts switches on it, and api.js switches on the reply
 * type. A mismatch anywhere is silent — the message is simply never handled, and
 * the UI sits on a loading state or an empty list forever.
 *
 * This is not hypothetical. `API.getVersionContent` was called by history.js for
 * months while being defined nowhere, so opening a version threw; and the
 * Archived view's diff was requested, delivered to a different view, and never
 * rendered. Both were exactly this shape.
 *
 * These read the shipped sources rather than mocking, so they cover what
 * actually ships.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readMedia } from "./harness.js";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const panel = readFileSync(join(srcDir, "panel.ts"), "utf8");
// api.js plus its sender mixins. The senders live in ./api/ now, and reading
// only api.js would make every "does the webview send this?" assertion here
// silently vacuous the moment a domain is extracted — which is exactly the
// drift this suite exists to catch, so it must follow the split.
const API_SOURCES = ["scripts/api.js", "scripts/api/memory-senders.js"];
const api = API_SOURCES.map((p) => readMedia(p)).join("\n");

/** Strip comments so a checked pattern cannot match its own explanation. */
const stripComments = (text) =>
	text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const apiCode = stripComments(api);
const panelCode = stripComments(panel);

/** Commands api.js posts to the extension. */
const sent = [...apiCode.matchAll(/this\.send\(\s*"([\w-]+)"/g)].map((m) => m[1]);
/** Commands panel.ts handles. */
const handled = [...panelCode.matchAll(/case\s+"([\w-]+)":/g)].map((m) => m[1]);
/** Reply types panel.ts sends back. */
const replied = [
	...panelCode.matchAll(/_sendMessage\(\s*\{\s*type:\s*"([\w-]+)"/g),
].map((m) => m[1]);
/** Reply types api.js handles. */
const received = [...apiCode.matchAll(/case\s+"([\w-]+)":/g)].map((m) => m[1]);

describe("every command the webview sends is handled", () => {
	/**
	 * Commands whose extension-side case has been requested but has not landed.
	 *
	 * Recorded rather than silently tolerated: each of these is a real gap - the
	 * webview posts it and nothing listens, so the feature renders its empty
	 * state. Keeping the list here means the gap is visible in the suite instead
	 * of only in a message thread, and the check below forces it to be cleaned up
	 * rather than lingering once the cases exist.
	 */
	// Empty: every message the webview posts now has a panel.ts case. The four
	// picker/digest entries that lived here were wired and removed, which is the
	// lifecycle this list is for -- an exemption that outlives its gap starts
	// covering nothing.
	const AWAITING_EXTENSION_WIRING = {};

	it("has a panel.ts case for each, or is a recorded pending gap", () => {
		const orphaned = [...new Set(sent)].filter(
			(c) => !handled.includes(c) && !(c in AWAITING_EXTENSION_WIRING),
		);
		assert.deepEqual(
			orphaned,
			[],
			"the webview posts these and nothing in the extension listens",
		);
	});

	it("drops the pending entry once the case lands", () => {
		// Otherwise the exemption outlives the gap and starts covering nothing.
		const landed = Object.keys(AWAITING_EXTENSION_WIRING).filter((c) =>
			handled.includes(c),
		);
		assert.deepEqual(landed, [], "these are wired now; remove them from the pending list");
	});
});

describe("every reply the extension sends is consumed", () => {
	/**
	 * Replies the webview deliberately ignores, with the reason.
	 *
	 * Each of these mutations ALSO emits a core event that arrives as
	 * "fileChange", which is what refreshes the view - so handling the reply as
	 * well would refetch for no reason. Anything not on this list and not
	 * handled is the Archived-diff bug: the work happens, the result arrives,
	 * and no view ever renders it.
	 */
	const DELIBERATELY_IGNORED = {
		"keep-all-result": "keepChange emits change:kept per change",
		"revert-all-result": "revertChange emits change:reverted per change",
		"keep-hunk-result": "emits change:kept",
		"revert-hunk-result": "emits change:reverted",
		"update-content-result": "updateChangeContent emits change:tracked",
	};

	it("has an api.js case for each, or a recorded reason not to", () => {
		const ignored = [...new Set(replied)].filter(
			(t) => !received.includes(t) && !(t in DELIBERATELY_IGNORED),
		);
		assert.deepEqual(ignored, [], "the extension replies with these and the webview drops them");
	});

	it("does not carry a stale exemption for a reply that is now handled", () => {
		// The other direction: an exemption left behind after the case was added
		// would quietly stop covering anything.
		const stale = Object.keys(DELIBERATELY_IGNORED).filter((t) => received.includes(t));
		assert.deepEqual(stale, [], "these are handled now; drop the exemption");
	});
});

describe("the memory contract specifically", () => {
	const memorySent = sent.filter((c) => c.startsWith("memory-"));

	it("posts the full memory surface", () => {
		assert.deepEqual(
			[...new Set(memorySent)].sort(),
			[
				"memory-add-to-index",
				"memory-build-digest",
				"memory-clear-staged",
				"memory-delete",
				"memory-get-projects",
				"memory-get-staged",
				"memory-remove-from-index",
				"memory-stage-context",
				"memory-write",
			],
		);
	});

	it("handles the curation half in panel.ts", () => {
		// The staging half is pending; tracked by AWAITING_EXTENSION_WIRING above.
		for (const command of [
			"memory-get-projects",
			"memory-add-to-index",
			"memory-remove-from-index",
			"memory-write",
			"memory-delete",
		]) {
			assert.ok(handled.includes(command), `panel.ts does not handle ${command}`);
		}
	});

	it("consumes both reply types the memory path produces", () => {
		for (const type of ["memory-projects", "memory-result"]) {
			assert.ok(received.includes(type), `api.js does not handle ${type}`);
		}
	});

	it("passes the refusal reason through rather than reshaping it", () => {
		// The view renders `reason` verbatim because the backend writes it for
		// people. A panel that rebuilt the object could drop it silently.
		assert.match(panelCode, /type: "memory-result", payload: result/);
	});
});

describe("API methods called by views actually exist", () => {
	// The getVersionContent shape: a view calls API.x() and no such method is
	// defined, so the call throws at the moment a user clicks.
	const viewFiles = [
		"scripts/views/context.js",
		"scripts/views/context/curation.js",
		"scripts/views/sessions.js",
		"scripts/views/history.js",
		"scripts/views/file-changes.js",
		"scripts/views/archived.js",
	];

	const defined = new Set(
		[...apiCode.matchAll(/^\t([a-zA-Z_][\w]*)\(/gm)].map((m) => m[1]),
	);

	for (const relPath of viewFiles) {
		it(`${relPath} calls only defined API methods`, () => {
			const src = stripComments(readMedia(relPath));
			const called = [...src.matchAll(/\bAPI\.([a-zA-Z_][\w]*)\s*\(/g)].map((m) => m[1]);
			const missing = [...new Set(called)].filter((name) => !defined.has(name));
			assert.deepEqual(missing, [], `these API methods do not exist`);
		});
	}
});
