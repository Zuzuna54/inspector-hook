/**
 * API Communication with VS Code Extension
 * Handles message passing between webview and extension
 *
 * `mergeActivity` lives in scripts/shared/activity-merge.js and is loaded
 * before this file. It is referenced here as a bare global, which resolves
 * across classic script tags.
 */

const API = {
	// VS Code API instance
	vscode: typeof acquireVsCodeApi !== "undefined" ? acquireVsCodeApi() : null,

	/**
	 * Send a command to the extension
	 * @param {string} command - Command name
	 * @param {Object} params - Command parameters
	 */
	send(command, params = {}) {
		if (this.vscode) {
			this.vscode.postMessage({ command, params });
		}
	},

	// ==========================================================================
	// Logs API
	// ==========================================================================

	/**
	 * Get logs with optional filtering
	 * @param {Object} filter - Filter options (search, level, hook, session)
	 */
	getLogs(filter = {}) {
		this.send("get-logs", {
			filter,
			pagination: { limit: 100 },
		});
	},

	/**
	 * Clear logs
	 * @param {Object} filter - Optional filter to clear specific logs
	 */
	clearLogs(filter = {}) {
		this.send("clear-logs", { filter });
	},

	// ==========================================================================
	// Sessions API
	// ==========================================================================

	/**
	 * Get all sessions
	 * @param {Object} params - Optional params (status, limit)
	 */
	getSessions(params = {}) {
		this.send("get-sessions", params);
	},

	/**
	 * Get a single session by ID
	 * @param {string} sessionId - Session ID
	 */
	getSession(sessionId) {
		this.send("get-session", { sessionId });
	},

	/**
	 * Delete a session
	 * @param {string} sessionId - Session ID
	 */
	deleteSession(sessionId) {
		this.send("delete-session", { sessionId });
	},

	/**
	 * Get logs for a specific session
	 * @param {string} sessionId - Session ID
	 */
	getSessionLogs(sessionId) {
		this.send("get-session-logs", { sessionId });
	},

	/**
	 * Get activity feed for a session (ordered events: prompts, responses, tools)
	 * @param {string} sessionId - Session ID
	 */
	getSessionActivity(sessionId, options = {}) {
		// `since` asks for only what changed, which is the difference between a
		// few hundred bytes and the whole window every two seconds. `before`
		// backfills older items past the window cap.
		this.send("get-session-activity", {
			sessionId,
			...(options.since ? { since: options.since } : {}),
			...(options.before ? { before: options.before } : {}),
		});
	},

	// ==========================================================================
	// File Changes API
	// ==========================================================================

	/**
	 * Get pending file changes
	 * @param {Object} params - Optional params (sessionId)
	 */
	getFileChanges(params = {}) {
		this.send("get-file-changes", params);
	},

	/**
	 * Get diff for a specific change
	 * @param {string} changeId - Change ID
	 */
	getDiff(changeId) {
		this.send("get-diff", { changeId });
	},

	/**
	 * Keep (approve) a change
	 * @param {string} changeId - Change ID
	 */
	keepChange(changeId) {
		this.send("keep-change", { changeId });
	},

	/**
	 * Revert a change
	 * @param {string} changeId - Change ID
	 */
	revertChange(changeId) {
		this.send("revert-change", { changeId });
	},

	/**
	 * Keep all pending changes
	 */
	keepAllChanges() {
		this.send("keep-all-changes", {});
	},

	/**
	 * Revert all pending changes
	 */
	revertAllChanges() {
		this.send("revert-all-changes", {});
	},

	/**
	 * Update change content (for inline editing)
	 * @param {string} changeId - Change ID
	 * @param {string} afterContent - New content after editing
	 */
	updateChangeContent(changeId, afterContent) {
		this.send("update-change-content", { changeId, afterContent });
	},

	/**
	 * Keep an individual hunk (if supported by backend)
	 * @param {string} changeId - Change ID
	 * @param {number} hunkIndex - Hunk index to keep
	 */
	keepHunk(changeId, hunkIndex) {
		this.send("keep-hunk", { changeId, hunkIndex });
	},

	/**
	 * Revert an individual hunk (if supported by backend)
	 * @param {string} changeId - Change ID
	 * @param {number} hunkIndex - Hunk index to revert
	 */
	revertHunk(changeId, hunkIndex) {
		this.send("revert-hunk", { changeId, hunkIndex });
	},

	// ==========================================================================
	// Archived Changes API
	// ==========================================================================

	/**
	 * Get archived changes
	 */
	getArchivedChanges() {
		this.send("get-archived-changes", {});
	},

	/**
	 * Get the diff for an ARCHIVED change.
	 *
	 * Separate from getDiff because the tracker keeps kept/reverted changes in
	 * a different map: `fileChanges.getDiff` reads `this.changes` and returns
	 * null for anything archived, by construction. Every archived diff had
	 * therefore always come back empty -- 155 of 155 on this machine -- and
	 * rendered as "+0 / -0" rather than as an error.
	 *
	 * @param {string} changeId - Change ID
	 */
	getArchivedDiff(changeId) {
		this.send("get-archived-diff", { changeId });
	},

	/**
	 * Restore an archived change
	 * @param {string} changeId - Change ID
	 */
	restoreArchived(changeId) {
		this.send("restore-archived", { changeId });
	},

	// ==========================================================================
	// File Operations
	// ==========================================================================

	/**
	 * Open a file in the editor
	 * @param {string} filePath - File path
	 * @param {number} line - Optional line number
	 */
	openFile(filePath, line) {
		this.send("open-file", { filePath, line });
	},

	// ==========================================================================
	// UI Helpers
	// ==========================================================================

	/**
	 * Update tab badge count
	 * @param {string} badge - Badge type ('logs' or 'changes')
	 * @param {number} count - Count to display
	 * @private
	 */
	_updateTabBadge(badge, count) {
		const elementId = badge === "logs" ? "tab-logs-count" : "tab-changes-count";
		const element = document.getElementById(elementId);
		if (element) {
			element.textContent = count > 99 ? "99+" : count.toString();
		}
	},

	// ==========================================================================
	// Message Handler
	// ==========================================================================

	/**
	 * Inbound handlers, keyed by message type.
	 *
	 * A registry rather than a switch, and rather than a mixin merge: message
	 * types are data, so `Object.assign` would let two modules silently claim
	 * `"memory-staged"` with whichever loaded last winning. `on` throws on a
	 * duplicate instead, which turns that into a load-time error rather than a
	 * message quietly going to the wrong place.
	 */
	_inbound: {},

	/**
	 * Messages that arrived before their handler registered.
	 *
	 * In practice nothing arrives early -- panel.ts only sends `init` after
	 * `webview-ready`, which main.js posts last. But "in practice" is exactly
	 * how the digest envelope bug survived, so an early message is queued and
	 * flushed rather than dropped on the floor.
	 */
	_deferred: [],
	_ready: false,

	/**
	 * Register a handler for one or more message types.
	 * @param {string|string[]} types
	 * @param {Function} handler called with API as `this`
	 */
	on(types, handler) {
		for (const type of Array.isArray(types) ? types : [types]) {
			if (this._inbound[type]) {
				throw new Error(`Duplicate inbound handler for "${type}"`);
			}
			this._inbound[type] = handler;
		}
	},

	/** Flush anything that arrived before the handlers were in place. */
	ready() {
		this._ready = true;
		const queued = this._deferred;
		this._deferred = [];
		for (const { type, payload } of queued) this._dispatch(type, payload);
	},

	/**
	 * Handle incoming messages from the extension
	 * @param {MessageEvent} event - Message event
	 */
	handleMessage(event) {
		const { type, payload } = event.data || {};
		if (!type) return;
		if (!this._ready && !this._inbound[type]) {
			this._deferred.push({ type, payload });
			return;
		}
		this._dispatch(type, payload);
	},

	/** @param {string} type @param {*} payload */
	_dispatch(type, payload) {
		const handler = this._inbound[type];
		// An unknown type is ignored, as it always was: the extension may send
		// something a newer webview knows about, or vice versa.
		if (handler) handler.call(this, payload);
	},
};

// Set up message listener
window.addEventListener("message", (event) => API.handleMessage(event));

// Make globally available
// Senders split into ./api/, composed after the literal so a missing module
// is a load-time absence rather than a silently undefined method.
Object.assign(
	API,
	window.MemoryApiMixin,
	window.HistoryApiMixin,
	window.TrayApiMixin,
);

window.API = API;
