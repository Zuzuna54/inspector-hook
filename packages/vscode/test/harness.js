/**
 * Loads webview scripts in a Node process so they can be unit tested.
 *
 * The webview is classic scripts against a browser global scope, with no build
 * step and no module system, so there is nothing to `import`. This evaluates
 * the real shipped files in the real order panel.ts loads them, against the
 * smallest set of stubs they touch. That keeps the tests running the artifact
 * that ships, the same principle as the core suite testing dist/ rather than
 * src/.
 *
 * Deliberately not jsdom: the assertions here cover pure logic - derivation,
 * grouping, id handling, HTML string output - and a real DOM would add a
 * dependency to buy coverage this suite does not claim. Anything genuinely
 * DOM-dependent is called out as unverified rather than faked.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const mediaDir = join(dirname(fileURLToPath(import.meta.url)), "..", "media");

/** Scripts in panel.ts load order: modules before the parent that composes them. */
export const SESSIONS_LOAD_ORDER = [
	"scripts/session-utils.js",
	"scripts/views/sessions/session-list.js",
	"scripts/views/sessions/activity-items.js",
	"scripts/views/sessions/activity-feed.js",
	"scripts/views/sessions/tool-detail.js",
	"scripts/views/sessions/session-detail.js",
	"scripts/views/sessions.js",
];

/**
 * File Changes scripts in panel.ts load order.
 * session-utils and the shared diff helpers must precede the view: it reads
 * window.SessionUtils and window.DiffRenderMixin at call time.
 */
export const FILE_CHANGES_LOAD_ORDER = [
	"scripts/session-utils.js",
	"scripts/shared/diff-render.js",
	"scripts/views/file-changes/fc-session-list.js",
	"scripts/views/file-changes/fc-diff-view.js",
	"scripts/views/file-changes/fc-editor.js",
	"scripts/views/file-changes/fc-actions.js",
	"scripts/views/file-changes.js",
];

/** History scripts in panel.ts load order. */
export const HISTORY_LOAD_ORDER = [
	"scripts/shared/diff-render.js",
	"scripts/views/history/file-list.js",
	"scripts/views/history/version-list.js",
	"scripts/views/history/diff-viewer.js",
	"scripts/views/history/virtual-scroll.js",
	"scripts/views/history/restore.js",
	"scripts/views/history.js",
];

/** Media files that exist; modules not yet extracted are skipped. */
export function existing(relPaths) {
	return relPaths.filter((p) => existsSync(join(mediaDir, p)));
}

/** Read a media file as text. */
export function readMedia(relPath) {
	return readFileSync(join(mediaDir, relPath), "utf8");
}

/**
 * Install the globals the webview scripts expect, and return the registry the
 * Router writes into.
 *
 * Stubs are intentionally thin. Where a stub is more than a no-op it mirrors the
 * real behaviour closely enough that assertions about output stay meaningful -
 * escapeHtml really escapes, for instance, because tests check escaping.
 */
export function installGlobals(overrides = {}) {
	const registered = {};
	const restored = [];

	globalThis.Router = { register: (name, view) => (registered[name] = view) };
	globalThis.window = {};
	globalThis.State = {
		sessions: [],
		archivedChanges: [],
		fileChanges: [],
		currentView: "sessions",
		sessionView: {
			selectedSession: null,
			activeTab: "activity",
			autoScroll: true,
			searchQuery: "",
			sessionActivity: [],
			sessionLogs: [],
			activityTruncated: false,
			activityAvailableLogs: null,
		},
		fileChangesView: {
			expandedSessions: [],
			selectedFile: null,
			viewMode: "unified",
		},
		subscribe: () => () => {},
		update: () => {},
		...overrides.State,
	};
	globalThis.document = {
		getElementById: () => null,
		querySelector: () => null,
		querySelectorAll: () => [],
		createElement: () => ({ innerHTML: "", firstElementChild: null }),
		visibilityState: "visible",
		...overrides.document,
	};
	globalThis.CSS = { escape: (value) => String(value) };
	globalThis.API = {
		getSessions() {},
		getSession() {},
		getSessionActivity() {},
		getSessionLogs() {},
		getArchivedChanges() {},
		getTrackedFiles() {},
		getDiff() {},
		restoreArchived() {},
		getVersionContent() {},
		...overrides.API,
	};
	globalThis.confirm = overrides.confirm ?? (() => true);
	globalThis.Utils = {
		escapeHtml: (text) =>
			text === null || text === undefined
				? ""
				: String(text)
						.replace(/&/g, "&amp;")
						.replace(/</g, "&lt;")
						.replace(/>/g, "&gt;"),
		formatTime: (value) => String(value ?? ""),
		formatDate: (value) => String(value ?? ""),
		formatDuration: () => "1s",
		formatFileSize: (n) => `${n}b`,
		getFileName: (path) => String(path ?? "").split("/").pop(),
		getDirectory: (path) => String(path ?? "").split("/").slice(0, -1).join("/"),
		getShortPath: (path) => String(path ?? ""),
		highlightCode: (code) => code,
		detectLanguage: () => "json",
		debounce: (fn) => fn,
		throttle: (fn) => fn,
		generateId: () => "id",
		deepClone: (o) => JSON.parse(JSON.stringify(o)),
		...overrides.Utils,
	};

	return { registered, restored };
}

/**
 * Load a list of media scripts in order and return the Router registry.
 * @param {string[]} relPaths
 * @param {object} overrides passed to installGlobals
 */
export function loadScripts(relPaths, overrides = {}) {
	const { registered } = installGlobals(overrides);
	for (const relPath of relPaths) {
		// biome-ignore lint/security/noGlobalEval: classic scripts have no module
		// entry point; evaluating them is the only way to load the shipped files.
		eval(readMedia(relPath));
	}
	return registered;
}

/** Load the Sessions view and return the composed SessionsView object. */
export function loadSessionsView(overrides = {}) {
	return loadScripts(SESSIONS_LOAD_ORDER, overrides).sessions;
}
