/**
 * API Communication with VS Code Extension
 * Handles message passing between webview and extension
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
	getSessionActivity(sessionId) {
		this.send("get-session-activity", { sessionId });
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
	// Version History API
	// ==========================================================================

	/**
	 * Get all tracked files with version history
	 */
	getTrackedFiles() {
		this.send("get-tracked-files", {});
	},

	/**
	 * Get version history for a file
	 * @param {string} filePath - File path
	 */
	getVersionHistory(filePath) {
		this.send("get-version-history", { filePath });
	},

	/**
	 * Restore a specific version
	 * @param {string} filePath - File path
	 * @param {number} versionNumber - Version number to restore
	 */
	restoreVersion(filePath, versionNumber) {
		this.send("restore-version", { filePath, versionNumber });
	},

	/**
	 * Compare two versions
	 * @param {string} filePath - File path
	 * @param {number} v1 - First version number
	 * @param {number} v2 - Second version number
	 */
	compareVersions(filePath, v1, v2) {
		this.send("compare-versions", { filePath, v1, v2 });
	},

	/**
	 * Compare a version to current disk content
	 * @param {string} filePath - File path
	 * @param {number} versionNumber - Version to compare from
	 */
	compareVersionToDisk(filePath, versionNumber) {
		this.send("compare-version-to-disk", { filePath, versionNumber });
	},

	/**
	 * Delete a specific version
	 * @param {string} filePath - File path
	 * @param {number} versionNumber - Version number to delete
	 */
	deleteVersion(filePath, versionNumber) {
		this.send("delete-version", { filePath, versionNumber });
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
	 * Handle incoming messages from the extension
	 * @param {MessageEvent} event - Message event
	 */
	handleMessage(event) {
		const { type, payload } = event.data || {};

		if (!type) {
			return;
		}

		switch (type) {
			case "ping":
				// Respond to ping from extension
				this.send("pong", {
					received: payload?.timestamp,
					responded: Date.now(),
				});
				break;

			case "init":
				// Initial data load
				State.batchUpdate({
					connected: true,
					stats: payload.stats || State.stats,
					logs: payload.logs || [],
					sessions: payload.sessions || [],
					fileChanges: payload.fileChanges || [],
				});
				if (payload.config) {
					State.update("config", { ...State.config, ...payload.config });
				}
				// Update tab badges with initial counts
				this._updateTabBadge("logs", (payload.logs || []).length);
				this._updateTabBadge("changes", (payload.fileChanges || []).length);
				break;

			case "stats":
				State.update("stats", payload);
				break;

			case "log": {
				// Single new log entry
				const logs = [payload, ...State.logs].slice(0, State.config.maxLogs);
				State.update("logs", logs);
				// Update tab badge
				this._updateTabBadge("logs", logs.length);
				break;
			}

			case "logs":
				// Bulk logs response
				State.update("logs", payload.logs || []);
				this._updateTabBadge("logs", (payload.logs || []).length);
				break;

			case "sessions":
				State.update("sessions", payload.sessions || []);
				break;

			case "session": {
				// Single session update
				const sessions = [...State.sessions];
				const sessionIdx = sessions.findIndex((s) => s.id === payload.id);
				if (sessionIdx >= 0) {
					sessions[sessionIdx] = payload;
				} else {
					sessions.unshift(payload);
				}
				State.update("sessions", sessions);
				break;
			}

			case "session-logs":
				// Session logs response
				State.update("sessionView", {
					...State.sessionView,
					sessionLogs: payload?.logs || [],
				});
				break;

			case "session-activity": {
				// Session activity feed response. The payload also carries the
				// session itself, so the poller does not need a separate
				// get-session round trip - that call returned the full session
				// (tool inputs and results included, megabytes on a long run)
				// for data already present here.
				const activities = payload?.activity || [];
				if (payload?.session?.id) {
					const sessions = [...State.sessions];
					const idx = sessions.findIndex((s) => s.id === payload.session.id);
					if (idx >= 0) {
						sessions[idx] = payload.session;
					} else {
						sessions.unshift(payload.session);
					}
					State.update("sessions", sessions);
				}
				State.update("sessionView", {
					...State.sessionView,
					sessionActivity: activities,
				});
				break;
			}

			case "fileChanges":
			case "file-changes":
				State.update("fileChanges", payload.changes || []);
				this._updateTabBadge("changes", (payload.changes || []).length);
				break;

			case "fileChange": {
				// Single file change update
				const changes = [...State.fileChanges];
				const changeIdx = changes.findIndex((c) => c.id === payload.id);

				if (payload.eventType === "kept" || payload.eventType === "reverted") {
					// Remove from pending
					if (changeIdx >= 0) {
						changes.splice(changeIdx, 1);
					}
				} else if (changeIdx >= 0) {
					// Update existing
					changes[changeIdx] = payload;
				} else {
					// Add new
					changes.unshift(payload);
				}
				State.update("fileChanges", changes);
				this._updateTabBadge("changes", changes.length);
				break;
			}

			case "diff-result":
				// Diff result - handled by file-changes view
				if (window.FileChangesView?.handleDiffResult) {
					window.FileChangesView.handleDiffResult(payload);
				}
				break;

			case "diff-error":
				// Diff error - handled by file-changes view
				if (window.FileChangesView?.handleDiffError) {
					window.FileChangesView.handleDiffError(payload);
				}
				break;

			case "tracked-files":
				// Store tracked files list in state
				State.update("trackedFiles", payload.files || []);
				// Notify history view
				if (window.HistoryView?.handleTrackedFiles) {
					window.HistoryView.handleTrackedFiles(payload);
				}
				break;

			case "version-history":
				// Handle null payload or missing fields
				if (payload && payload.filePath) {
					State.update("versionHistory", {
						...State.versionHistory,
						[payload.filePath]: payload.versions || [],
					});
					// Also notify history view
					if (window.HistoryView?.handleVersionHistory) {
						window.HistoryView.handleVersionHistory(payload);
					}
				}
				break;

			case "version-comparison":
				// Version comparison result - handled by history view
				if (window.HistoryView?.handleVersionComparison) {
					window.HistoryView.handleVersionComparison(payload);
				}
				break;

			case "archived":
				State.update("archivedChanges", payload.changes || []);
				break;

			case "error":
				// Handle error messages from extension
				// Could show a toast/notification here
				break;

			default:
				// Unknown message type - silently ignore
				break;
		}
	},
};

// Set up message listener
window.addEventListener("message", (event) => API.handleMessage(event));

// Make globally available
window.API = API;
